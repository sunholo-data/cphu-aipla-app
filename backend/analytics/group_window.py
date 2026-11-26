"""What one group did in the last few minutes, counted (1.1.163 M0 + M1).

Design: docs/design/aipla/v2.1.0-extension/live-group-synopsis.md

The live view's status (active / quiet / stuck) is one word. A teacher who
wants to know *what* a group is doing had to leave the class page for the
report, which covers the whole session. This reads the same two BigQuery sink
tables the report reads, for ONE group and a short window, and counts:

- student turns, split into questions and *Ask for feedback* requests
  (synthetic turns such as ``[session_start]`` are not the group's);
- tutor turns and the tools they used (calculator, …);
- words written per writing sheet: the last snapshot before the window
  against the last one in it, since every push carries the whole text;
- changes per sim, data-table edits, and handouts opened.

No model and no cost: it is what the teacher can trust when an AI line and
their own eyes disagree. M2 (a written synopsis) builds on it.

The query is synchronous (``run_query`` blocks until BigQuery answers), so a
route must call ``read_group_window`` through ``asyncio.to_thread`` (1.1.131).
Rows reach the sink tables through the Cloud Logging sink, typically within
seconds; a window can therefore lag the classroom by that much.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from adk.superseded_drafts import feedback_title
from reports.session_summary import NOT_STUDENT_WORK_TOOLS

#: How far back to look for the writing snapshot a window's word count starts
#: from. A lesson is under two hours; a sheet last touched yesterday starts at 0.
_WRITING_LOOKBACK = timedelta(hours=6)


@dataclass
class SheetChange:
    title: str
    words_before: int
    words_now: int


@dataclass
class SimChange:
    server: str
    name: str
    changes: int


@dataclass
class GroupWindow:
    group_code: str
    since: datetime
    until: datetime
    questions: int = 0
    feedback_requests: int = 0
    tutor_turns: int = 0
    tools: dict[str, int] = field(default_factory=dict)
    sheets: list[SheetChange] = field(default_factory=list)
    sims: list[SimChange] = field(default_factory=list)
    documents_opened: int = 0
    table_edits: int = 0
    last_activity_at: datetime | None = None

    @property
    def empty(self) -> bool:
        return not (
            self.questions
            or self.feedback_requests
            or self.tutor_turns
            or self.sheets
            or self.sims
            or self.documents_opened
            or self.table_edits
        )


def _words(text: str) -> int:
    return len(text.split())


def _writing_docs(value: Any) -> dict[str, tuple[str, int]]:
    """{doc id: (title, words)} from one writing push, or {} if unreadable."""
    try:
        snap = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError):
        return {}
    if isinstance(snap, dict) and isinstance(snap.get("structuredContent"), dict):
        snap = snap["structuredContent"]
    out: dict[str, tuple[str, int]] = {}
    for d in (snap or {}).get("docs") or [] if isinstance(snap, dict) else []:
        if not isinstance(d, dict) or not d.get("id"):
            continue
        words = d.get("words")
        out[str(d["id"])] = (
            str(d.get("title") or "").strip(),
            words if isinstance(words, int) else _words(str(d.get("text") or "")),
        )
    return out


def _sim_name(server: str) -> str:
    try:
        from artefacts.loader import builtin_artefact

        meta = builtin_artefact(server)
        if meta is not None and meta.display_name:
            return meta.display_name
    except Exception:
        pass
    return server


def build_window(
    group_code: str,
    since: datetime,
    until: datetime,
    turn_rows: list[dict[str, Any]],
    wb_rows: list[dict[str, Any]],
) -> GroupWindow:
    """Count a window from already-fetched rows. Pure, so it is testable.

    ``turn_rows``: ``ts, role, content, tools_called`` for turns inside the window.
    ``wb_rows``: ``ts, server, tool, value``, ordered by time, from the window
    AND from before it (writing snapshots only matter there, as a starting point).
    """
    win = GroupWindow(group_code=group_code, since=since, until=until)
    tools: Counter[str] = Counter()
    last: datetime | None = None

    for r in turn_rows:
        ts = r.get("ts")
        if ts is None or ts < since or ts > until:
            continue
        content = (r.get("content") or "").strip()
        if r.get("role") == "student":
            if not content or content.startswith("["):
                continue  # [session_start], [ui_language=…]: the platform's, not the group's
            if feedback_title(content) is not None:
                win.feedback_requests += 1
            else:
                win.questions += 1
        else:
            win.tutor_turns += 1
            for name in (r.get("tools_called") or "").split(","):
                if name.strip():
                    tools[name.strip()] += 1
        last = ts if last is None or ts > last else last

    before: dict[str, tuple[str, int]] = {}
    now: dict[str, tuple[str, int]] = {}
    sims: Counter[str] = Counter()
    for r in wb_rows:
        ts = r.get("ts")
        if ts is None or ts > until:
            continue
        server = r.get("server") or ""
        tool = r.get("tool") or ""
        # The tutor's hidden assessment, and the tutor moving a sim (the
        # control_sim tool), ride the same table; neither is the group's work.
        if tool in NOT_STUDENT_WORK_TOOLS or tool == "control_sim":
            continue
        if server == "writing":
            (before if ts < since else now).update(_writing_docs(r.get("value")))
        if ts < since:
            continue
        last = ts if last is None or ts > last else last
        if server == "documents":
            if tool == "document.open":
                win.documents_opened += 1
        elif server == "table":
            win.table_edits += 1
        elif server and server not in ("writing", "progress"):
            sims[server] += 1

    for doc_id, (title, words_now) in now.items():
        words_before = before.get(doc_id, ("", 0))[1]
        if words_now != words_before:
            win.sheets.append(SheetChange(title=title, words_before=words_before, words_now=words_now))
    win.sims = [SimChange(server=s, name=_sim_name(s), changes=n) for s, n in sims.most_common()]
    win.tools = dict(tools.most_common())
    win.last_activity_at = last
    return win


def read_group_window(group_code: str, minutes: int, *, now: datetime | None = None) -> GroupWindow:
    """Query BigQuery for one group's window. Blocking: call via ``asyncio.to_thread``.

    Raises on a BigQuery error. The caller must not turn an unreadable window
    into an empty one: "nothing happened" and "could not read" are different
    answers (the footgun ``deploy-status`` was bitten by).
    """
    from db.bigquery import CHAT_TURN_TABLE, WORKBENCH_EVENT_TABLE, run_query, table_ref

    until = now or datetime.now(UTC)
    since = until - timedelta(minutes=minutes)
    turn_rows = run_query(
        "SELECT timestamp AS ts, jsonPayload.role AS role, jsonPayload.content AS content, "
        "JSON_VALUE(TO_JSON_STRING(jsonPayload), '$.tools_called') AS tools_called "
        f"FROM {table_ref(CHAT_TURN_TABLE)} "
        "WHERE jsonPayload.group_id = @group AND timestamp >= @since AND timestamp <= @until "
        "ORDER BY timestamp",
        params={"group": group_code, "since": since, "until": until},
    )
    wb_rows = run_query(
        "SELECT timestamp AS ts, jsonPayload.server AS server, jsonPayload.tool AS tool, "
        "jsonPayload.value AS value "
        f"FROM {table_ref(WORKBENCH_EVENT_TABLE)} "
        "WHERE jsonPayload.group_id = @group AND timestamp <= @until "
        "AND (timestamp >= @since OR (timestamp >= @floor AND jsonPayload.server = 'writing')) "
        "ORDER BY timestamp",
        params={"group": group_code, "since": since, "until": until, "floor": since - _WRITING_LOOKBACK},
    )
    return build_window(group_code, since, until, [dict(r) for r in turn_rows], [dict(r) for r in wb_rows])
