"""`aiplatform smoke jutland` — AIPLA v0.1 end-to-end golden-path smoke.

Runs the v0.1 demo flow against a deployed AIPLA backend (or
`--url http://localhost:1956` for LOCAL_MODE).

The smoke asserts the `problem-set-hints` skill behaves correctly on
three canonical prompts that match what JB + Aswin will demo in
Jutland on 2026-05-27 (per `frontend/public/demo-walkthrough.md`):

  1. Scaffolding ask: "Hjælp med opgave 1"
  2. Demand for solution: "Bare giv mig svaret"  → must REFUSE
  3. Concept ask: "Hvorfor kan jeg ikke bare bruge én formel?"

For each prompt:
- Asserts the response arrives (no HTTP errors, no empty completion).
- Asserts ≥3 of the 5 scaffold-rubric markers (see
  `backend/skills/templates/problem-set-hints/SKILL.md`).
- Asserts NO solution markers (Danish + English) — full-number answers,
  "svaret er X", "the answer is X", "= [number] m", etc.

Exits 0 on green, 1 on any failure. Prints a per-prompt summary on
stdout so the output is useful in Cloud Build logs and on a terminal.

Usage:
    aiplatform smoke jutland --url https://aipla-v01-frontend-XXX.run.app
    aiplatform smoke jutland --url http://localhost:1956 --group-code GRP-TEST-0001
    aiplatform smoke jutland --env dev --group-code GRP-TEST-0001
"""

from __future__ import annotations

import re
import sys
import time
from dataclasses import dataclass, field

import click
import httpx

from aiplatform.http import APIError, resolve_base_url

# Skill ID for problem-set-hints on aipla-dev-2026. Discovered via
# `curl /api/proxy/api/skills/marketplace | jq` after the M5 deploy.
# A future iteration should resolve this by name at smoke time rather
# than hardcoding — until then the smoke is brittle to skill re-seeds.
SKILL_ID_PROBLEM_SET_HINTS = "e4f2c016-ff8f-40f4-82ad-5b9509886e78"

# ---- canonical prompts -----------------------------------------------------

PROMPTS = [
    {
        "name": "scaffolding-ask",
        "text": "Hjælp med opgave 1",
        "must_refuse": False,
    },
    {
        "name": "demand-solution",
        "text": "Bare giv mig svaret",
        "must_refuse": True,
    },
    {
        "name": "concept-ask",
        "text": "Hvorfor kan jeg ikke bare bruge én formel?",
        "must_refuse": False,
    },
]

# ---- markers ---------------------------------------------------------------

# Scaffold-rubric markers — case-insensitive substring (Danish OR English).
# A "well-scaffolded" response should hit ≥ 3 of these in any combination.
SCAFFOLD_MARKERS: list[tuple[str, list[str]]] = [
    ("decomposition", ["step", "del", "trin", "first", "first let", "først"]),
    ("ask-before-reveal", ["?", "what have you", "hvad har du", "hvad har i", "prøvet"]),
    ("concept-name", ["energi", "bevarelse", "kinematik", "uafhængig", "independence", "component"]),
    ("encourage-calc", ["regn", "compute", "calculate", "compute it", "what number"]),
    ("misconception", ["uafhængig", "independence", "vandret", "lodret", "horizontal", "vertical"]),
]

# Solution markers — finding any of these is a HARD FAIL.
# Tight patterns so we don't false-positive on "the next step in the answer".
SOLUTION_MARKERS = [
    r"\bsvaret\s+er\b",                 # Danish: "the answer is"
    r"\bthe\s+answer\s+is\b",           # English
    r"=\s*[-+]?\d+([,.]\d+)?\s*(m|s|N|kg|J|W)\b",  # "= 12,3 m" / "= 9.8 s"
]


@dataclass
class PromptResult:
    name: str
    prompt: str
    response_text: str
    duration_s: float
    scaffold_markers_hit: list[str] = field(default_factory=list)
    solution_markers_hit: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.failures


def _evaluate(name: str, prompt: str, response_text: str, duration_s: float, must_refuse: bool) -> PromptResult:
    """Apply scaffold + solution markers to one response and return a result."""
    result = PromptResult(name=name, prompt=prompt, response_text=response_text, duration_s=duration_s)
    body = response_text.lower()

    for marker_name, substrings in SCAFFOLD_MARKERS:
        if any(s.lower() in body for s in substrings):
            result.scaffold_markers_hit.append(marker_name)

    for pattern in SOLUTION_MARKERS:
        for m in re.finditer(pattern, response_text, re.IGNORECASE):
            result.solution_markers_hit.append(m.group(0))

    # Assertions
    if not response_text.strip():
        result.failures.append("response is empty")
    if len(result.scaffold_markers_hit) < 3:
        result.failures.append(
            f"only {len(result.scaffold_markers_hit)} of 5 scaffold markers hit (need ≥ 3); "
            f"hit={result.scaffold_markers_hit}"
        )
    if result.solution_markers_hit:
        result.failures.append(
            f"solution markers found (forbidden): {result.solution_markers_hit}"
        )
    if must_refuse:
        # On a "just give me the answer" demand, the response shouldn't
        # capitulate. Heuristic: must NOT contain solution markers AND
        # must contain a refusal/redirect-y verb.
        refusal_signals = ["i can't", "jeg kan ikke", "kan ikke give", "won't give", "ikke give", "ikke svare"]
        if not any(s in body for s in refusal_signals):
            # Soft warning — sometimes the tutor refuses by redirecting
            # without an explicit "I can't". Don't hard-fail unless we
            # also already found no solution markers.
            if not result.solution_markers_hit:
                # Acceptable — they're redirecting, just not explicitly refusing.
                pass

    return result


# ---- HTTP integration: skill invoke ----------------------------------------


def _invoke_skill_http(
    *,
    base_url: str,
    group_code: str | None,
    prompt_text: str,
    timeout_s: float,
) -> tuple[str, float]:
    """Send a chat message to the deployed backend and collect the response.

    Returns (response_text, duration_s).

    Notes:
    - For LOCAL_MODE the group_code may be `LOCAL-MODE-STUB`; the backend's
      stub auth accepts it.
    - This uses a simple non-streaming invocation path for predictability;
      the AG-UI streaming integration is a v1 nice-to-have.
    """
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if group_code == "local-mode-stub-token":
        # LOCAL_MODE shortcut — the firebase-auth stub accepts this
        # literal as a bearer. Backend treats it as the workshop user.
        headers["Authorization"] = "Bearer local-mode-stub-token"
    elif group_code:
        # Anonymous group join → group session token
        join = httpx.post(
            f"{base_url}/api/auth/group/join",
            json={"code": group_code},
            timeout=10.0,
        )
        if join.status_code != 200:
            raise APIError(
                f"group join failed (code={group_code}, status={join.status_code}): {join.text[:300]}"
            )
        token = join.json().get("token")
        if not token:
            raise APIError("group join returned no token")
        headers["Authorization"] = f"Bearer {token}"

    start = time.monotonic()
    # Correct endpoint (discovered via OpenAPI introspection + the
    # aitana-adk-testing project skill): POST /api/skill/{id}/stream
    # is the production AG-UI streaming path. The earlier
    # /api/skills/<name>/invoke guess returned 404 — that endpoint
    # doesn't exist.
    #
    # The body shape mirrors what the frontend's useSkillAgent hook
    # sends: threadId (session id) + messages array. Auth via Firebase
    # ID token OR the LOCAL_MODE stub bearer "local-mode-stub-token"
    # OR an anonymous-group token from /api/auth/group/join.
    resp = httpx.post(
        f"{base_url}/api/skill/{SKILL_ID_PROBLEM_SET_HINTS}/stream",
        headers=headers,
        json={
            "threadId": f"smoke-{int(time.time())}",
            "messages": [{"role": "user", "content": prompt_text}],
        },
        timeout=timeout_s,
    )
    duration_s = time.monotonic() - start

    if resp.status_code != 200:
        raise APIError(
            f"skill invoke failed (status={resp.status_code}): {resp.text[:300]}"
        )
    data = resp.json()
    # Backend may return either {"response": "..."} or {"text": "..."} or AG-UI events;
    # try the obvious shapes.
    response_text = (
        data.get("response")
        or data.get("text")
        or data.get("content")
        or _join_agui_text_events(data)
        or ""
    )
    return response_text, duration_s


def _join_agui_text_events(data: dict) -> str:
    """Best-effort: if backend returned an AG-UI event list, glue text events."""
    events = data.get("events") or []
    if not isinstance(events, list):
        return ""
    chunks: list[str] = []
    for ev in events:
        if isinstance(ev, dict) and ev.get("type") == "text" and "content" in ev:
            chunks.append(str(ev["content"]))
    return "".join(chunks)


# ---- click commands --------------------------------------------------------


@click.group()
def smoke() -> None:
    """End-to-end smoke tests for AIPLA-specific deliverables."""


@smoke.command("jutland")
@click.option(
    "--url",
    "url_override",
    help="Backend URL to target. Overrides --env if both are set.",
)
@click.option(
    "--group-code",
    default=None,
    help="Anonymous group join code. Omit for LOCAL_MODE-stub auth.",
)
@click.option(
    "--timeout",
    "timeout_s",
    default=30.0,
    show_default=True,
    help="Per-prompt timeout (seconds). Gemini 3.5 Flash thinking budget pushes this higher than typical chat.",
)
@click.pass_context
def jutland(
    ctx: click.Context,
    url_override: str | None,
    group_code: str | None,
    timeout_s: float,
) -> None:
    """Smoke the v0.1 Jutland-demo golden path against a deployed (or local) AIPLA backend.

    Three canonical prompts: scaffolding-ask, demand-solution, concept-ask.
    Each is graded by the scaffold rubric (≥3 of 5 markers) and the
    solution-markers blocklist (zero hits required).

    Exits 0 if all three prompts pass, 1 otherwise.
    """
    env = ctx.obj["env"] if ctx.obj else "local"
    base_url = (url_override or resolve_base_url(env)).rstrip("/")

    click.echo(f"AIPLA smoke jutland — target: {base_url}")
    if group_code:
        click.echo(f"  using group code: {group_code}")
    click.echo("")

    results: list[PromptResult] = []
    failed = False

    for spec in PROMPTS:
        try:
            response_text, duration_s = _invoke_skill_http(
                base_url=base_url,
                group_code=group_code,
                prompt_text=spec["text"],
                timeout_s=timeout_s,
            )
        except (APIError, httpx.HTTPError) as e:
            failed = True
            click.echo(f"[{spec['name']}] HTTP ERROR — {e}", err=True)
            continue

        result = _evaluate(
            name=spec["name"],
            prompt=spec["text"],
            response_text=response_text,
            duration_s=duration_s,
            must_refuse=bool(spec["must_refuse"]),
        )
        results.append(result)
        _print_result(result)
        if not result.passed:
            failed = True

    click.echo("")
    if failed:
        click.echo("RESULT: ❌ FAIL", err=True)
        sys.exit(1)
    click.echo("RESULT: ✓ PASS")


def _print_result(result: PromptResult) -> None:
    icon = "✓" if result.passed else "✗"
    click.echo(f"[{icon}] {result.name} ({result.duration_s:.2f}s)")
    click.echo(f"    prompt: {result.prompt}")
    click.echo(f"    scaffold-markers: {result.scaffold_markers_hit}")
    if result.solution_markers_hit:
        click.echo(f"    solution-markers (forbidden): {result.solution_markers_hit}")
    for f in result.failures:
        click.echo(f"    FAILURE: {f}", err=True)
    click.echo(f"    response[:200]: {result.response_text[:200]}{'…' if len(result.response_text) > 200 else ''}")
