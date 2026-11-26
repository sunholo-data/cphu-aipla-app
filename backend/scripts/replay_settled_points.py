"""Re-run the tutor on a real session, before and after 1.1.164 M1+M2 (M4).

Design: docs/design/aipla/v2.1.0-extension/tutor-tracks-what-is-settled.md

On 2026-11-25 (prod, ``green-beetle-49``) the tutor told a group "protoner" was
still in their text 17 minutes after they fixed it, and asked for a typo fix
that was in the message it was replying to. M1 collapses older *Ask for
feedback* drafts in the request; M2 renders the current sheet text as the
version that wins. A replay of the REQUEST showed the old drafts gone. This
re-runs the MODEL, so we know whether the reply changes.

For each probe (a student turn the tutor replied to badly) it rebuilds:

- the history before that turn, from the prod chat log;
- the writing sheets as they were at that moment, from the workbench log;

and asks the tutor's model N times in three arms:

- **prod**: the request as prod built it. Compaction had fired (four times in
  this session, read from Agent Engine): each summary stands in for the turns
  it covers, as one of the tutor's own earlier turns, and the sheets are the
  old raw JSON dump;
- **prod+fix**: the same summaries, plus 1.1.164 M1 + M2;
- **fixed**: no compaction (the interval no longer counts workbench pushes),
  every turn present, plus M1 + M2.

A reply FAILS when it again asks for the already-fixed point (a regex per
probe, printed so a person can check it). Nothing from the session is written
to disk or committed: it is read from BigQuery each run.

Limits, stated so the result is not over-read: the system instruction is NOT
the one ``create_agent`` assembled on prod (which needs the prod activity,
persona and class). ``--prompt full`` (the default) gets closer: the real
``concept-dialogue`` SKILL.md and the CER approach, rendered by the same
functions the tutor uses, plus a line about the activity. ``--prompt short`` is
a ~150-token stand-in. Tools are not offered in either. What it isolates is the
two things M1 and M2 changed: the history and the writing block.

Usage (read-only on prod BigQuery; the model runs on the project in
GOOGLE_CLOUD_PROJECT, so point that at dev):

    cd backend && GOOGLE_CLOUD_PROJECT=aipla-dev-2026 GOOGLE_CLOUD_LOCATION=global \\
        uv run python scripts/replay_settled_points.py --n 5
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any

from google.cloud import bigquery
from google.genai import types

import adk.iframe_context as iframe_context
from adk.iframe_context import render_instruction_with_iframe_context
from adk.superseded_drafts import collapse_superseded_drafts
from llm.generate import Turn, generate

PROD = "aipla-prod-2026"
SESSION_SUFFIX = "950f22"  # green-beetle-49, 2026-11-25
GROUP = "green-beetle-49"
DAY = "2026-11-25"

SYSTEM = (
    "Du er Jonas, en AI-tutor i fysik på et dansk gymnasium. Du hjælper eleverne med at tænke selv "
    "i stedet for at give dem svarene, og du arbejder efter Claim-Evidence-Reasoning: eleverne fremsætter "
    "en påstand, underbygger den med data og begrunder den. Svar kort, på dansk, og slut med ét spørgsmål. "
    "Aktiviteten er 'Lithium-ion-batteriet Fysik B': forforståelse, ladningstransport, energiregnskab, "
    "ældning og kortslutning, med en simulering og skriveark."
)


def full_system() -> str:
    """The skill text and the CER approach, as the tutor gets them (no activity, persona or tools)."""
    from pathlib import Path

    from adk.teaching_precedence import TEACHING_PRECEDENCE_BLOCK
    from frameworks.instruction import build_framework_instruction
    from frameworks.loader import load_framework

    skill = (Path(__file__).resolve().parents[1] / "skills/templates/concept-dialogue/SKILL.md").read_text()
    body = skill.split("---", 2)[2] if skill.startswith("---") else skill
    return "\n\n".join(
        [body.strip(), build_framework_instruction(load_framework("cer")), TEACHING_PRECEDENCE_BLOCK, SYSTEM]
    )


@dataclass
class Probe:
    name: str
    at: str  # the student turn's timestamp (UTC, as in the log)
    fails: re.Pattern[str]
    what: str


PROBES = [
    Probe(
        name="10:00 protons",
        at="2026-11-25 10:00:35",
        fails=re.compile(r"proton", re.I),
        what="mentions protons again (fixed at 09:42:40)",
    ),
    Probe(
        name="10:11 double unit",
        at="2026-11-25 10:11:57",
        fails=re.compile(r"1,1\s?W\s*1,1\s?W|dobbelt", re.I),
        what="asks again to fix '1,1W 1,1W' (fixed in this very message)",
    ),
]


_FIXED = re.compile(r"(har|fået)\s+(\w+\s+){0,3}(rettet|fjernet|luget|ændret)|er\s+(rettet|væk)", re.I)


def _says_fixed(text: str) -> bool:
    """The reply acknowledges the fix ("I har fået fjernet dobbelt-skrivningen")."""
    return bool(_FIXED.search(text))


def _rows(sql: str, params: list[Any]) -> list[dict[str, Any]]:
    client = bigquery.Client(project=PROD)
    job = client.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params), location="europe-north1")
    return [dict(r) for r in job.result()]


def load() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    turns = _rows(
        "SELECT ts, role, content FROM `aipla-prod-2026.chat_logs.chat_turns` "
        "WHERE group_id = @g AND DATE(ts) = @d AND ENDS_WITH(session_id, @s) AND role IN ('student', 'tutor') "
        "ORDER BY ts, turn_index",
        [
            bigquery.ScalarQueryParameter("g", "STRING", GROUP),
            bigquery.ScalarQueryParameter("d", "DATE", DAY),
            bigquery.ScalarQueryParameter("s", "STRING", SESSION_SUFFIX),
        ],
    )
    writing = _rows(
        "SELECT ts, value FROM `aipla-prod-2026.chat_logs.workbench_events` "
        "WHERE group_id = @g AND DATE(ts) = @d AND server = 'writing' ORDER BY ts",
        [bigquery.ScalarQueryParameter("g", "STRING", GROUP), bigquery.ScalarQueryParameter("d", "DATE", DAY)],
    )
    return turns, writing


def load_summaries() -> list[dict[str, Any]]:
    """The session's compaction summaries, from Agent Engine (prod, read-only).

    ``[{start, end, text}]`` with UTC 'YYYY-MM-DD HH:MM:SS' strings. The engine
    id is read from Secret Manager, so no prod resource id lives in the repo.
    """
    import subprocess
    from datetime import UTC, datetime

    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    engine = (
        subprocess.run(
            ["gcloud", "secrets", "versions", "access", "latest", "--secret=AGENT_ENGINE_ID", f"--project={PROD}"],
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .rsplit("/", 1)[-1]
    )
    session_id = _rows(
        "SELECT DISTINCT session_id FROM `aipla-prod-2026.chat_logs.chat_turns` "
        "WHERE group_id = @g AND DATE(ts) = @d AND ENDS_WITH(session_id, @s)",
        [
            bigquery.ScalarQueryParameter("g", "STRING", GROUP),
            bigquery.ScalarQueryParameter("d", "DATE", DAY),
            bigquery.ScalarQueryParameter("s", "STRING", SESSION_SUFFIX),
        ],
    )[0]["session_id"]
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    http = AuthorizedSession(creds)
    url = (
        f"https://europe-west1-aiplatform.googleapis.com/v1beta1/projects/{PROD}/locations/europe-west1/"
        f"reasoningEngines/{engine}/sessions/{session_id}/events"
    )
    out, token = [], ""
    while True:
        page = http.get(url, params={"pageSize": 100, **({"pageToken": token} if token else {})}).json()
        for e in page.get("sessionEvents", []):
            c = (e.get("eventMetadata") or {}).get("customMetadata", {}).get("_compaction")
            if c:
                fmt = lambda ts: datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731
                text = " ".join(p.get("text", "") for p in c["compacted_content"]["parts"])
                out.append({"start": fmt(c["start_timestamp"]), "end": fmt(c["end_timestamp"]), "text": text})
        token = page.get("nextPageToken", "")
        if not token:
            return sorted(out, key=lambda x: x["start"])


def build(
    turns: list[dict[str, Any]],
    writing: list[dict[str, Any]],
    probe: Probe,
    *,
    fixed: bool,
    base: str,
    summaries: list[dict[str, Any]] | None = None,
):
    """(system, history, prompt) as the tutor would have had them at ``probe.at``.

    With ``summaries``, every summary that ended before the probe replaces the
    turns it covers, placed where it starts, as the tutor's own turn: what ADK's
    ``_process_compaction_events`` does.
    """
    at = probe.at
    before = [t for t in turns if str(t["ts"])[:19] < at and t["content"] and not t["content"].startswith("[")]
    current = next(t for t in turns if str(t["ts"])[:19] == at and t["role"] == "student")
    items: list[tuple[str, str, str]] = [
        (str(t["ts"])[:19], "user" if t["role"] == "student" else "model", t["content"]) for t in before
    ]
    for sm in summaries or []:
        if sm["end"] >= at:
            continue
        items = [i for i in items if not (sm["start"] <= i[0] <= sm["end"])]
        items.append((sm["start"], "model", sm["text"]))
    items.sort(key=lambda i: i[0])
    contents = [types.Content(role=r, parts=[types.Part(text=x)]) for _, r, x in items] + [
        types.Content(role="user", parts=[types.Part(text=current["content"])])
    ]
    if fixed:
        collapse_superseded_drafts(type("Req", (), {"contents": contents})())
    snap = [w for w in writing if str(w["ts"])[:19] <= at]
    value = snap[-1]["value"] if snap else None
    state: dict[str, Any] = {}
    if value:
        sc = json.loads(value) if isinstance(value, str) else value
        state["mcp_app_context.writing.state"] = {"structuredContent": sc}
    original = iframe_context._writing_prose
    if not fixed:
        iframe_context._writing_prose = lambda _v: None  # the old raw-JSON dump
    try:
        system = render_instruction_with_iframe_context(base, state)
    finally:
        iframe_context._writing_prose = original
    history = [Turn(role=c.role, text=c.parts[0].text) for c in contents[:-1]]  # type: ignore[arg-type]
    return system, history, contents[-1].parts[0].text


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--n", type=int, default=5, help="samples per probe and arm")
    ap.add_argument("--model", default="gemini-3.5-flash-lite", help="the tutor's model (api name)")
    ap.add_argument("--show", action="store_true", help="print every reply")
    ap.add_argument("--prompt", choices=("full", "short"), default="full", help="system instruction (see Limits)")
    args = ap.parse_args()

    turns, writing = load()
    summaries = load_summaries()
    base = full_system() if args.prompt == "full" else SYSTEM
    print(
        f"session …{SESSION_SUFFIX}: {len(turns)} turns, {len(writing)} writing snapshots; "
        f"model {args.model}; prompt {args.prompt} ({len(base)} chars); {len(summaries)} compaction summaries\n"
    )
    for probe in PROBES:
        arms = [("prod    ", False, summaries), ("prod+fix", True, summaries), ("fixed   ", True, None)]
        for arm, fixed, sums in arms:
            system, history, prompt = build(turns, writing, probe, fixed=fixed, base=base, summaries=sums)
            replies = await asyncio.gather(
                *(generate(prompt, model=args.model, history=history, system=system) for _ in range(args.n))
            )
            bad = [r.text for r in replies if probe.fails.search(r.text) and not _says_fixed(r.text)]
            print(f"{probe.name:18} {arm}: {len(bad)}/{args.n} replies {probe.what}")
            for text in [r.text for r in replies] if args.show else bad[:1]:
                print("    ↳", text.replace("\n", " ")[:400])
        print()


if __name__ == "__main__":
    asyncio.run(main())
