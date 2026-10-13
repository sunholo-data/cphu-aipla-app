"""Verify a sim draft: the static gates, then the page run in a real browser.

One function for every caller that grades a generated sim: the benchmark
(``scripts/bench-sims.py``) now, the in-app authoring agent's ``verify_sim``
tool next (in-app-sim-authoring M4). The browser half is behind
``BrowserCheck`` so the same call works on a laptop (``LocalBrowserCheck``, the
repo's ``verify_sim.mjs``) and in the app (the sim-verify service, M3).

The verdict carries a **level** (in-app-sim-authoring "Score levels"):

    L0 two files parsed · L1 static gates pass · L2 it runs (self-test, no page
    errors, fits 390 and 700 px, and pressing start moves the drawing) · L3 it talks to the tutor (a labelled event,
    a verb that wakes it, every kind namespaced)

L4 (the physics probe) and L5 (the visual rubric) arrive with M2. A level is
reached only when every level below it is, and a check that could not run
stops the climb: an unread step is never assumed passed.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import sim_gates
from sim_gates.proactive import proactive_category

REPO_ROOT = Path(__file__).resolve().parents[2]


class BrowserCheck(Protocol):
    async def check(self, index_html: str, artefact_id: str, out_dir: Path) -> dict | None:
        """Run the page; return verify_sim.mjs's JSON result, or None if it could not run."""


@dataclass
class DraftVerdict:
    level: int
    static: sim_gates.VerifyReport
    browser: dict | None
    reasons: list[str] = field(default_factory=list)  # why the next level was not reached
    screenshots: dict[str, Path] = field(default_factory=dict)

    def for_model(self) -> dict:
        """What the authoring model is shown: verdicts and fixes, compact. Screenshots travel separately, as images."""
        failed = [
            {"id": g.id, "status": g.status, "detail": g.detail, "fix": g.fix}
            for g in self.static.gates
            if g.status in ("fail", "error", "skipped", "warning")
        ]
        out: dict = {
            "level": self.level,
            "ok": self.level >= 3,
            "static_failures": failed,
            "not_reached_because": self.reasons,
            "not_checked": self.static.not_checked,
        }
        if self.browser is not None:
            out["browser"] = {
                "self_test": self.browser.get("selfTest"),
                "page_errors": self.browser.get("pageErrors", [])[:5],
                "failed_checks": [c["msg"] for c in self.browser.get("checks", []) if not c["ok"]],
                "motion": self.browser.get("motion"),
                "events": [
                    {"kind": e.get("kind"), "label": e.get("label"), "state": e.get("state")}
                    for e in self.browser.get("events", [])[:12]
                ],
            }
        if self.screenshots:
            out["screenshots_attached"] = sorted(self.screenshots)
        return out

    def to_dict(self) -> dict:
        return {
            "level": self.level,
            "reasons": self.reasons,
            "static": self.static.to_dict(),
            "browser": self.browser,
            "screenshots": {k: str(v) for k, v in self.screenshots.items()},
        }


async def verify_draft(
    index_html: str | None,
    catalogue_yaml: str | None,
    *,
    hidden_terms: list[str] | None = None,
    browser: BrowserCheck | None,
    out_dir: Path,
) -> DraftVerdict:
    """Grade one draft. ``browser=None`` stops at L1 and says why."""
    if not index_html or catalogue_yaml is None:
        missing = [n for n, v in (("index.html", index_html), ("catalogue YAML", catalogue_yaml)) if not v]
        empty = sim_gates.VerifyReport([sim_gates.Gate("A.parse", "fail", f"missing: {', '.join(missing)}")])
        return DraftVerdict(-1, empty, None, [f"L0: {', '.join(missing)} not found in the answer"])

    static = sim_gates.run(index_html, catalogue_yaml=catalogue_yaml, hidden_terms=hidden_terms)
    level, reasons = 0, []
    blocking = [g for g in static.gates if g.tier in "ABC" and g.status not in ("pass", "warning")]
    if blocking:
        reasons.append("L1: " + "; ".join(f"{g.id} {g.status}" for g in blocking[:6]))
        return DraftVerdict(level, static, None, reasons)
    level = 1

    if browser is None:
        reasons.append("L2: no browser check configured")
        return DraftVerdict(level, static, None, reasons)
    artefact_id = sim_gates.conformance.artefact_name(sim_gates._text.strip_bridge(index_html)) or "draft"
    result = await browser.check(index_html, artefact_id, out_dir)
    if result is None:
        reasons.append("L2: the browser check could not run")
        return DraftVerdict(level, static, None, reasons)
    shots = {k: Path(v) for k, v in (result.get("screenshots") or {}).items() if Path(v).is_file()}

    runs = result.get("selfTest") == "pass" and not result.get("pageErrors")
    fits = [c for c in result.get("checks", []) if c["msg"].startswith(("390px", "700px"))]
    # Pressing start must move the drawing. A sim with no start control is not
    # failed here (some are driven by dragging); the report says it went unchecked.
    still = [c for c in result.get("checks", []) if c["msg"].startswith("motion:") and not c["ok"]]
    if not runs or not fits or not all(c["ok"] for c in fits) or still:
        why = []
        if result.get("selfTest") != "pass":
            why.append(f"self-test {result.get('selfTest')}")
        if result.get("pageErrors"):
            why.append(f"{len(result['pageErrors'])} page error(s)")
        why += [c["msg"] for c in fits if not c["ok"]] or ([] if fits else ["viewport checks did not run"])
        why += [c["msg"] for c in still]
        reasons.append("L2: " + "; ".join(why))
        return DraftVerdict(level, static, result, reasons, shots)
    level = 2

    events = result.get("events") or []
    labelled = any(isinstance(e.get("label"), str) and e["label"].strip() for e in events)
    waking = any(proactive_category(str(e.get("kind", ""))) for e in events)
    namespaced = bool(events) and all(str(e.get("kind", "")).startswith(f"{artefact_id}.") for e in events)
    if not (labelled and waking and namespaced):
        why = [
            m
            for ok, m in (
                (bool(events), "no events emitted when driven"),
                (labelled, "no labelled event"),
                (waking, "no event verb wakes the tutor"),
                (namespaced, f"not every kind starts with {artefact_id}."),
            )
            if not ok
        ]
        reasons.append("L3: " + "; ".join(why))
        return DraftVerdict(level, static, result, reasons, shots)
    return DraftVerdict(3, static, result, reasons, shots)


class LocalBrowserCheck:
    """The repo's verify_sim.mjs, for a laptop (Node + Playwright's Chromium).

    Stamps the bridge into a scratch copy first, as ``make sim-build`` would: a
    draft carries only the placeholder, and without the bridge it cannot emit.
    """

    def __init__(self, repo_root: Path = REPO_ROOT, timeout_s: float = 120.0) -> None:
        self.repo_root = repo_root
        self.timeout_s = timeout_s
        self.verify = repo_root / ".claude" / "skills" / "mcp-app-artefact" / "scripts" / "verify_sim.mjs"
        self.stamper = repo_root / "scripts" / "build-artefact-bridge.mjs"
        self.bridge = repo_root / "infrastructure" / "mcp-sandbox" / "bridge" / "aipla-mcp-bridge.js"
        if not (self.verify.is_file() and self.stamper.is_file() and self.bridge.is_file() and shutil.which("node")):
            raise RuntimeError("LocalBrowserCheck needs the repo checkout and node on PATH")

    async def check(self, index_html: str, artefact_id: str, out_dir: Path) -> dict | None:
        out_dir = out_dir.resolve()  # the subprocess runs from the repo root
        out_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="simcheck-") as tmp:
            root = Path(tmp)
            art = root / "infrastructure" / "mcp-sandbox" / "artefacts" / artefact_id / "v1"
            art.mkdir(parents=True)
            (root / "infrastructure" / "mcp-sandbox" / "bridge").mkdir(parents=True)
            shutil.copy(self.bridge, root / "infrastructure" / "mcp-sandbox" / "bridge" / self.bridge.name)
            (art / "index.html").write_text(index_html, encoding="utf-8")
            if await self._run("node", str(self.stamper), "--root", str(root)) is None:
                return None
            json_path = out_dir / "browser.json"
            json_path.unlink(missing_ok=True)
            await self._run(
                "node",
                str(self.verify),
                artefact_id,
                "--path",
                str(art / "index.html"),
                "--drive",
                "--out",
                str(out_dir),
                "--json",
                str(json_path),
            )
            if not json_path.is_file():
                return None
            return json.loads(json_path.read_text())

    async def _run(self, *cmd: str) -> int | None:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, cwd=self.repo_root
        )
        try:
            return await asyncio.wait_for(proc.wait(), self.timeout_s)
        except TimeoutError:
            proc.kill()
            return None


class ServiceBrowserCheck:
    """The sim-verify Cloud Run service (in-app-sim-authoring M3), for the deployed app.

    Private service: the request carries a Google ID token for the service URL,
    minted from the runtime service account (the only identity granted
    ``run.invoker``). Screenshots come back as base64 and are written to
    ``out_dir`` so the verdict has the same shape as the local check's.
    """

    def __init__(self, url: str, timeout_s: float = 170.0) -> None:
        self.url = url.rstrip("/")
        self.timeout_s = timeout_s

    def _token(self) -> str:
        import google.auth.transport.requests
        import google.oauth2.id_token

        return google.oauth2.id_token.fetch_id_token(google.auth.transport.requests.Request(), self.url)

    async def check(self, index_html: str, artefact_id: str, out_dir: Path) -> dict | None:
        import base64
        import logging

        import httpx

        log = logging.getLogger(__name__)
        try:
            token = await asyncio.to_thread(self._token)
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                resp = await client.post(
                    f"{self.url}/verify",
                    json={"index_html": index_html, "artefact_id": artefact_id},
                    headers={"Authorization": f"Bearer {token}"},
                )
        except Exception as exc:  # unreachable service = could not run, never a pass
            log.warning("sim-verify call failed: %s", type(exc).__name__)
            return None
        if resp.status_code != 200:
            log.warning("sim-verify returned %s", resp.status_code)
            return None
        body = resp.json()
        result = body.get("result") or {}
        out_dir.mkdir(parents=True, exist_ok=True)
        paths = {}
        for name, b64 in (body.get("screenshots") or {}).items():
            if b64:
                p = out_dir / f"{name}.png"
                p.write_bytes(base64.b64decode(b64))
                paths[name] = str(p)
        result["screenshots"] = paths
        return result


def browser_from_env() -> BrowserCheck | None:
    """The service when ``SIM_VERIFY_URL`` is set (deployed), else the local script when the repo
    and Node are present (a laptop), else None — the verdict then stops at L1 and says why."""
    import os

    url = os.environ.get("SIM_VERIFY_URL", "").strip()
    if url:
        return ServiceBrowserCheck(url)
    try:
        return LocalBrowserCheck()
    except RuntimeError:
        return None
