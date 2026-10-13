"""SIM-BENCH: can a model build a usable sim from a teacher's brief?

Each cell is one brief, one model, one harness and one sample. The model gets the
published authoring prompt (frontend/public/sim-authoring-prompt.txt) with the
brief in its slot; what it returns is graded by ``sim_authoring.verify`` — the
static gates, then the page driven in headless Chromium — to a level:

    L0 two files · L1 static gates · L2 runs and fits · L3 talks to the tutor
    (L4 physics probe and L5 visual rubric arrive with in-app-sim-authoring M2)

Harnesses:
    h1  one call, as a teacher pasting the prompt into a chat gets today
    h2  the same prompt plus a ``verify_sim`` tool: the model submits both files,
        sees the verdict and screenshots of its page, repairs, and answers
    h3  h2 plus the anatomy kit: a guide to it in the prompt
        (backend/sim_authoring/references/anatomy-lite.md) and the kit served
        as a vendored library, so the apparatus can be a crafted figure

    make bench-sims ARGS=--dry-run                              # plan + rough cost, ZERO model calls
    make bench-sims ARGS="--go --briefs otto-engine --harness h1,h2 --samples 3"
    make bench-sims ARGS="--report-only ../research/sim-bench/runs/<run>"            # ZERO calls
    make bench-sims ARGS="--report-only ../research/sim-bench/runs/<run> --rescore"  # re-grade saved files, ZERO calls

Without --go it refuses to call a model. A real run costs money: get M's go-ahead.
Outputs: research/sim-bench/runs/<UTC>/ (gitignored) with report.md, raw.jsonl
and one directory per cell holding the response, the two files, the verdict and
the screenshots. Cost is the app's rate card (analytics.rate_card), thinking
tokens priced as output, no cache discount, so it is what the app would be
charged, roughly. Needs ADC with Vertex on the project (``gcloud auth
application-default login``), Node, and Playwright's Chromium for grading.
Design: docs/design/aipla/v2.1.0-extension/in-app-sim-authoring.md
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from statistics import mean
from typing import Any

import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from analytics.rate_card import cost_eur  # noqa: E402
from sim_authoring.verify import DraftVerdict, LocalBrowserCheck, verify_draft  # noqa: E402

BENCH = REPO / "research" / "sim-bench"
PROMPT = REPO / "frontend" / "public" / "sim-authoring-prompt.txt"
ANATOMY_LITE = REPO / "backend" / "sim_authoring" / "references" / "anatomy-lite.md"
KIT_PREAMBLE = """

--- A SECOND PERMITTED LIBRARY: THE ANATOMY KIT ---

Besides three.js there is ONE more vendored library, the anatomy kit. For this
sim you MUST draw the apparatus with it, as a crafted isometric figure: load it
with the exact script tag in its guide and build the apparatus from its solids
(slabOf, cylinder, extrude, …) rendered with solidSvg and figureSvg. Do not
write your own renderer for the apparatus. Charts (p-V, T-t) stay plain SVG or
canvas. It is served same-origin and hash-checked, exactly like three.js. Its
guide follows.

"""
DEFAULT_MODEL = "gemini-3.8-flash"
LOCATION = "eu"

H2_ADDENDUM = """

--- YOU HAVE A CHECKING TOOL ---

You can call `verify_sim(index_html, catalogue_yaml)`. It runs the platform's
real gates on your two files, then opens the page in a real browser, runs its
self-test, checks it fits 390px and 700px, clicks through it and records the
events it emits, and returns the verdict with screenshots of the page.

Call it with BOTH complete files before you answer. Read the failures and fixes,
and LOOK AT THE SCREENSHOTS: check that what is drawn agrees with the numbers
your model computes at that moment (positions, directions, which parts move).
Fix what is wrong and call it again, always with BOTH COMPLETE files, never a
part or a diff. STOP checking once the level is 3, unless a screenshot shows the
picture disagreeing with the physics; then answer with the two final files in
the format above.
"""

VERIFY_DECL = {
    "name": "verify_sim",
    "description": "Check a sim draft: the static gates, then the page run, driven and screenshotted in a browser.",
    "parameters_json_schema": {
        "type": "object",
        "properties": {
            "index_html": {"type": "string", "description": "The complete index.html."},
            "catalogue_yaml": {"type": "string", "description": "The complete catalogue YAML."},
        },
        "required": ["index_html", "catalogue_yaml"],
    },
}


# ---- briefs, prompt, extraction ----------------------------------------------------


def load_briefs(ids: list[str]) -> list[dict]:
    briefs = [yaml.safe_load(p.read_text()) for p in sorted((BENCH / "briefs").glob("*.yaml"))]
    if ids:
        briefs = [b for b in briefs if b["id"] in ids]
        missing = set(ids) - {b["id"] for b in briefs}
        if missing:
            raise SystemExit(f"unknown brief(s): {sorted(missing)}")
    return briefs


def build_prompt(brief: dict, harness: str) -> str:
    text = PROMPT.read_text()
    filled, n = re.subn(r"<<< BRIEF.*?\n>>>", lambda _m: brief["brief"].strip(), text, count=1, flags=re.S)
    if n != 1:
        raise SystemExit("the authoring prompt has no <<< BRIEF … >>> slot")
    if harness == "h3":
        filled += KIT_PREAMBLE + ANATOMY_LITE.read_text()
    return filled + (H2_ADDENDUM if harness in ("h2", "h3") else "")


_FILENAME_LINE = re.compile(r"\A[ \t]*[\w./-]+\.(?:html|ya?ml)[ \t]*\n")


def extract_files(text: str) -> tuple[str | None, str | None]:
    """The largest html block and the last yaml block. A bare filename on a block's
    first line (``otto-engine.yaml``) is a formatting slip, dropped as a person would."""
    htmls = [_FILENAME_LINE.sub("", b, count=1) for b in re.findall(r"```html\s*\n(.*?)\n```", text, re.S)]
    yamls = [_FILENAME_LINE.sub("", b, count=1) for b in re.findall(r"```ya?ml\s*\n(.*?)\n```", text, re.S)]
    return (max(htmls, key=len) if htmls else None, yamls[-1] if yamls else None)


# ---- model calls --------------------------------------------------------------------


def _client() -> Any:
    from google import genai

    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "aipla-dev-2026")
    return genai.Client(vertexai=True, project=project, location=LOCATION)


def _config(thinking: str, tools: bool) -> Any:
    from google.genai import types

    cfg: dict[str, Any] = {"max_output_tokens": 65536}
    if thinking != "off":
        cfg["thinking_config"] = types.ThinkingConfig(thinking_level=thinking.upper())
    if tools:
        cfg["tools"] = [types.Tool(function_declarations=[types.FunctionDeclaration(**VERIFY_DECL)])]
        cfg["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(disable=True)
    return types.GenerateContentConfig(**cfg)


def _add_usage(acc: dict, resp: Any) -> None:
    u = resp.usage_metadata
    if u is None:
        return
    acc["in"] += u.prompt_token_count or 0
    acc["out"] += u.candidates_token_count or 0
    acc["thinking"] += u.thoughts_token_count or 0
    acc["cached"] += u.cached_content_token_count or 0
    acc["calls"] += 1


async def _generate(client: Any, model: str, contents: Any, config: Any, retries: int = 3) -> Any:
    for attempt in range(retries + 1):
        try:
            return await client.aio.models.generate_content(model=model, contents=contents, config=config)
        except Exception as exc:  # 429 / 5xx: back off and retry, anything else fails the cell
            code = getattr(exc, "code", None)
            if attempt == retries or code not in (429, 500, 502, 503, 504):
                raise
            await asyncio.sleep(2**attempt * 5)
    raise RuntimeError("unreachable")


async def run_h1(client: Any, model: str, prompt: str, thinking: str, usage: dict) -> str:
    resp = await _generate(client, model, prompt, _config(thinking, tools=False))
    _add_usage(usage, resp)
    return resp.text or ""


async def run_h2(
    client: Any, model: str, prompt: str, thinking: str, usage: dict, cell_dir: Path, brief: dict, max_tools: int
) -> tuple[str, list[dict], tuple[str | None, str | None]]:
    from google.genai import types

    contents: list[Any] = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
    config = _config(thinking, tools=True)
    trail: list[dict] = []
    last_files: tuple[str | None, str | None] = (None, None)
    browser = LocalBrowserCheck()
    while True:
        resp = await _generate(client, model, contents, config)
        _add_usage(usage, resp)
        cand = resp.candidates[0] if resp.candidates else None
        if cand is None or cand.content is None:
            return resp.text or "", trail, last_files
        contents.append(cand.content)
        calls = [p.function_call for p in cand.content.parts or [] if p.function_call]
        if not calls:
            return resp.text or "", trail, last_files
        replies = []
        for call in calls:
            args = dict(call.args or {})
            last_files = (args.get("index_html"), args.get("catalogue_yaml"))
            n = len(trail) + 1
            verdict = await verify_draft(
                last_files[0],
                last_files[1],
                hidden_terms=brief.get("hidden_terms"),
                browser=browser,
                out_dir=cell_dir / f"attempt-{n}",
            )
            trail.append({"attempt": n, "level": verdict.level, "reasons": verdict.reasons})
            images = [
                types.FunctionResponsePart.from_bytes(data=verdict.screenshots[k].read_bytes(), mime_type="image/png")
                for k in ("700", "driven")
                if k in verdict.screenshots
            ]
            replies.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        name="verify_sim", id=call.id, response=verdict.for_model(), parts=images or None
                    )
                )
            )
        contents.append(types.Content(role="user", parts=replies))
        if len(trail) >= max_tools:
            contents.append(
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(
                            text="The checking budget is used up. Answer now with the two final files."
                        )
                    ],
                )
            )
            config = _config(thinking, tools=False)


# ---- one cell -----------------------------------------------------------------------


async def run_cell(client: Any, cell: dict, run_dir: Path, args: argparse.Namespace) -> dict:
    brief, model, harness, thinking, sample = (
        cell["brief"],
        cell["model"],
        cell["harness"],
        cell["thinking"],
        cell["sample"],
    )
    name = f"{brief['id']}__{model}__{harness}__{thinking}__s{sample}"
    cell_dir = run_dir / "cells" / name
    cell_dir.mkdir(parents=True, exist_ok=True)
    usage = {"in": 0, "out": 0, "thinking": 0, "cached": 0, "calls": 0}
    prompt = build_prompt(brief, harness)
    row: dict[str, Any] = {
        "cell": name,
        "brief": brief["id"],
        "model": model,
        "harness": harness,
        "thinking": thinking,
        "sample": sample,
    }
    t0 = time.monotonic()
    trail: list[dict] = []
    try:
        if harness not in ("h1", "h2", "h3"):
            raise ValueError(f"unknown harness {harness!r}")
        if harness == "h1":
            text = await run_h1(client, model, prompt, thinking, usage)
            files = extract_files(text)
        else:
            text, trail, last = await run_h2(
                client, model, prompt, thinking, usage, cell_dir, brief, args.max_tool_calls
            )
            files = extract_files(text)
            if files[0] is None or files[1] is None:
                files = (files[0] or last[0], files[1] or last[1])
                row["files_from"] = "last tool call"
    except Exception as exc:
        row.update(error=f"{type(exc).__name__}: {exc}"[:500], level=-1, seconds=round(time.monotonic() - t0, 1))
        row.update(usage=usage, eur=_eur(model, usage))
        _write_cell(cell_dir, row)
        return row
    row["seconds"] = round(time.monotonic() - t0, 1)
    (cell_dir / "response.md").write_text(text)
    if files[0]:
        (cell_dir / "index.html").write_text(files[0])
    if files[1]:
        (cell_dir / "catalogue.yaml").write_text(files[1])
    verdict = await grade(cell_dir, brief)
    row.update(
        usage=usage,
        eur=_eur(model, usage),
        tool_calls=len(trail),
        trail=trail,
        level=verdict.level,
        reasons=verdict.reasons,
    )
    _write_cell(cell_dir, row)
    return row


async def grade(cell_dir: Path, brief: dict) -> DraftVerdict:
    html = (cell_dir / "index.html").read_text() if (cell_dir / "index.html").is_file() else None
    yml = (cell_dir / "catalogue.yaml").read_text() if (cell_dir / "catalogue.yaml").is_file() else None
    verdict = await verify_draft(
        html, yml, hidden_terms=brief.get("hidden_terms"), browser=LocalBrowserCheck(), out_dir=cell_dir / "final"
    )
    (cell_dir / "verdict.json").write_text(json.dumps(verdict.to_dict(), indent=1, ensure_ascii=False, default=str))
    return verdict


def _eur(model: str, usage: dict) -> float:
    return round(cost_eur(model, usage["in"], usage["out"] + usage["thinking"]), 4)


def _write_cell(cell_dir: Path, row: dict) -> None:
    (cell_dir / "cell.json").write_text(json.dumps(row, indent=1, ensure_ascii=False))


# ---- plan, report -------------------------------------------------------------------


def plan_cells(args: argparse.Namespace) -> list[dict]:
    return [
        {"brief": b, "model": m, "harness": h, "thinking": t, "sample": s}
        for b in load_briefs(_csv(args.briefs))
        for m in _csv(args.models)
        for h in _csv(args.harness)
        for t in _csv(args.thinking)
        for s in range(1, args.samples + 1)
    ]


def render_plan(cells: list[dict], args: argparse.Namespace) -> str:
    # Rough per-cell tokens from the 2026-10-12 hand runs: ~6k in, ~16k out, ~22k thinking at HIGH.
    est = 0.0
    for c in cells:
        out = 16_000 + (22_000 if c["thinking"] != "off" else 0)
        if c["harness"] == "h1":
            est += cost_eur(c["model"], 6_000, out)
        else:
            k = max(1, args.max_tool_calls // 2)  # assume half the budget used
            est += cost_eur(c["model"], 6_000 * (k + 1) + 30_000 * k * (k + 1) // 2, out * (k + 1))
    briefs = sorted({c["brief"]["id"] for c in cells})
    return "\n".join(
        [
            "SIM-BENCH plan",
            f"  briefs     : {', '.join(briefs)}",
            f"  models     : {args.models}   harness: {args.harness}   thinking: {args.thinking}",
            f"  samples    : {args.samples} per cell   max tool calls (h2): {args.max_tool_calls}",
            f"  cells      : {len(cells)}",
            f"  est. cost  : EUR {est:.2f}  (rough: rate card, token sizes from the 2026-10-12 hand runs)",
            "  project    : " + os.environ.get("GOOGLE_CLOUD_PROJECT", "aipla-dev-2026") + f"  location: {LOCATION}",
        ]
    )


def build_report(rows: list[dict], run_dir: Path) -> str:
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault((r["brief"], r["model"], r["harness"], r["thinking"]), []).append(r)
    lines = [
        f"# SIM-BENCH run {run_dir.name}",
        "",
        "Levels: L0 two files · L1 static gates · L2 runs and fits · L3 talks to the tutor. "
        "**L3 is not 'correct physics'**: the physics probe (L4) and visual rubric (L5) are M2.",
        "Cost: the app's rate card, thinking priced as output, no cache discount.",
        "",
        "| Brief | Model | Harness | Thinking | n | Levels | Mean level | ≥L3 | Mean EUR | Mean s | Mean tool calls |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for (brief, model, harness, thinking), rs in sorted(groups.items()):
        levels = [r.get("level", -1) for r in rs]
        lines.append(
            f"| {brief} | {model} | {harness} | {thinking} | {len(rs)} | {' '.join(str(x) for x in levels)} | "
            f"{mean(levels):.1f} | {sum(x >= 3 for x in levels)}/{len(rs)} | {mean(r.get('eur', 0) for r in rs):.3f} | "
            f"{mean(r.get('seconds', 0) for r in rs):.0f} | {mean(r.get('tool_calls', 0) for r in rs):.1f} |"
        )
    lines += [
        "",
        "## Cells",
        "",
        "| Cell | Level | Why not higher | EUR | s | Tokens in/out/thinking | Trail |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in sorted(rows, key=lambda r: r["cell"]):
        u = r.get("usage", {})
        why = r.get("error") or "; ".join(r.get("reasons", [])) or "—"
        trail = " → ".join(f"L{t['level']}" for t in r.get("trail", [])) or "—"
        lines.append(
            f"| [{r['cell']}](cells/{r['cell']}/) | {r.get('level', -1)} | {why[:160].replace('|', '/')} | "
            f"{r.get('eur', 0):.3f} | {r.get('seconds', 0):.0f} | {u.get('in', 0):,}/{u.get('out', 0):,}/{u.get('thinking', 0):,} | {trail} |"
        )
    return "\n".join(lines) + "\n"


async def report_only(run_dir: Path, rescore: bool) -> None:
    rows = []
    briefs = {b["id"]: b for b in load_briefs([])}
    for cell_json in sorted((run_dir / "cells").glob("*/cell.json")):
        row = json.loads(cell_json.read_text())
        if rescore and "error" not in row:
            verdict = await grade(cell_json.parent, briefs[row["brief"]])
            row.update(level=verdict.level, reasons=verdict.reasons)
            _write_cell(cell_json.parent, row)
        rows.append(row)
    out = run_dir / ("report-rescored.md" if rescore else "report.md")
    out.write_text(build_report(rows, run_dir))
    print(f"wrote {out}")


def _csv(s: str) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()]


def _parse(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dry-run", action="store_true", help="print the plan and rough cost; make no calls")
    p.add_argument("--go", action="store_true", help="actually call the models (costs money)")
    p.add_argument("--briefs", default="", help="comma-separated brief ids (default: all)")
    p.add_argument("--models", default=DEFAULT_MODEL)
    p.add_argument("--harness", default="h1,h2,h3")
    p.add_argument("--thinking", default="high", help="comma-separated: off, low, high")
    p.add_argument("--samples", type=int, default=3)
    p.add_argument("--max-tool-calls", type=int, default=6)
    p.add_argument("--concurrency", type=int, default=3)
    p.add_argument("--out", type=Path, default=None)
    p.add_argument("--report-only", type=Path, default=None, metavar="RUN_DIR")
    p.add_argument("--rescore", action="store_true", help="with --report-only: re-grade saved files (no model calls)")
    return p.parse_args(argv)


async def main(argv: list[str] | None = None) -> int:
    args = _parse(argv)
    if args.report_only:
        await report_only(args.report_only.resolve(), args.rescore)
        return 0
    cells = plan_cells(args)
    print(render_plan(cells, args))
    if not args.go:
        print("\nDry run: no model was called. Add --go to run (costs money).")
        return 0
    LocalBrowserCheck()  # fail now, not after the first paid call, if grading cannot run
    run_dir = (args.out or BENCH / "runs" / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    client = _client()
    sem = asyncio.Semaphore(args.concurrency)

    async def one(c: dict) -> dict:
        async with sem:
            row = await run_cell(client, c, run_dir, args)
            print(
                f"  {row['cell']}: L{row.get('level')} EUR {row.get('eur', 0):.3f} {row.get('seconds', 0):.0f}s",
                flush=True,
            )
            return row

    rows = await asyncio.gather(*(one(c) for c in cells))
    with (run_dir / "raw.jsonl").open("w") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    (run_dir / "report.md").write_text(build_report(rows, run_dir))
    print(f"\nwrote {run_dir / 'report.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
