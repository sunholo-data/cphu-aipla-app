"""Researcher chat-log lens (1.1.109) — conversations grouped by what taught them.

The question this answers, which the pipeline could not answer for its first
four months: *show me every conversation that ran under ESRU, and let me read
them*. TUTOR-5 (2026-09-11) put ``framework_id`` / ``tutor_id`` / ``persona_id``
/ ``class_id`` / ``activity_id`` on every emitted turn; this module is the read
side of that.

⚠️ **Reads the RAW sink table, not the ``chat_turns`` view, and that is
deliberate.** The flattened views are a terraform option (``create_views``) that
exists on test and prod but **not on dev** — dev's dataset was bootstrapped by
script and has no infra trigger to apply one. A read path bound to the view is a
read path that 500s in the only environment anyone develops in. So the view's
own projection is repeated here as a CTE named ``turns``: the query bodies below
read with plain column names exactly as if they were hitting the view, while
depending on nothing but the table the sink itself creates.

The projection technique is the view's, for the view's reason
(see ``infrastructure/modules/chat-logs/views.tf``): every field is read with
``JSON_VALUE``, never as a struct member, because the sink infers the
``jsonPayload`` STRUCT only from fields it has actually seen non-null. A
struct-member SELECT over a never-populated field fails the *whole query* with
``Field name <x> does not exist in STRUCT<…>``. ``JSON_VALUE`` returns NULL for
an absent path, so these queries work on a dataset of any age — including one
where no tutor has ever been assigned.

⚠️ **NULL ``framework_id`` means "not recorded", never "no framework".** Every
row written before 2026-09-11 is null because the field did not exist, and the
values are deliberately not backfilled (a class's tutor changes; joining
group → class → tutor after the fact files old turns under arms they never ran
under). ``teaching_source`` separates the cases going forward: ``tutor`` means a
Tutor object decided, ``fields`` means the pre-tutor activity/class path did.
The API surfaces the null bucket under ``UNASSIGNED`` and the UI must label it
as unrecorded rather than as an absence of pedagogy.
"""

from __future__ import annotations

import logging
from typing import Any

from db.bigquery import CHAT_TURN_TABLE, run_query, table_ref

log = logging.getLogger(__name__)

#: Sentinel for "the framework_id IS NULL bucket" on the wire. Not a real
#: framework id (those are slugs like ``esru`` / ``accountable-talk``), so it
#: cannot collide with one.
UNASSIGNED = "__unassigned__"

#: Roles the emitter writes. Verified against prod 2026-09-11: 'student' and
#: 'tutor' — NOT the 'user'/'assistant' pair the ADK event stream uses. A
#: rollup that counts role='user' silently returns zero for every session.
ROLE_STUDENT = "student"
ROLE_TUTOR = "tutor"

#: Synthetic turns the system injects, which are NOT student utterances.
#: ``ag_ui_adk._convert_latest_message`` drops a message with falsy content, so
#: system-driven turns (session start, heartbeats) must send a non-empty
#: sentinel — and that sentinel is then logged under role='student' like
#: anything else. A researcher reading a transcript must not see "[session_start]"
#: as something a student typed. Marked, not filtered: dropping it would hide
#: that the conversation was opened by the system rather than by the student,
#: which is itself a fact about the interaction.
SYNTHETIC_CONTENT = ("[session_start]",)

#: Hard ceiling on any single query's returned rows. A researcher paging a
#: dataset is not a reason to stream an unbounded result into a browser.
MAX_LIMIT = 500
MAX_TRANSCRIPT_TURNS = 2000


#: The flattened projection over the raw sink table — the ``chat_turns`` view's
#: SELECT list, inlined. Keep in lockstep with views.tf; the emitter-side guard
#: (``test_view_selects_every_teaching_key_the_emitter_writes``) covers the view,
#: and ``test_projection_matches_view`` in the unit tests covers this copy.
def _turns_cte() -> str:
    j = 'JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.{}")'
    return f"""
      SELECT
        timestamp AS ts,
        {j.format("group_id")} AS group_id,
        {j.format("session_id")} AS session_id,
        {j.format("skill_id")} AS skill_id,
        SAFE_CAST(SAFE_CAST({j.format("turn_index")} AS FLOAT64) AS INT64) AS turn_index,
        {j.format("role")} AS role,
        {j.format("content")} AS content,
        {j.format("model")} AS model,
        SAFE_CAST(SAFE_CAST({j.format("token_in")} AS FLOAT64) AS INT64) AS token_in,
        SAFE_CAST(SAFE_CAST({j.format("token_out")} AS FLOAT64) AS INT64) AS token_out,
        SAFE_CAST(SAFE_CAST({j.format("latency_ms")} AS FLOAT64) AS INT64) AS latency_ms,
        {j.format("teacher_focus")} AS teacher_focus,
        {j.format("tutor_id")} AS tutor_id,
        {j.format("framework_id")} AS framework_id,
        {j.format("persona_id")} AS persona_id,
        {j.format("class_id")} AS class_id,
        {j.format("activity_id")} AS activity_id,
        {j.format("interaction_style")} AS interaction_style,
        {j.format("teaching_source")} AS teaching_source,
        {j.format("revision")} AS revision,
        {j.format("app_version")} AS app_version
      FROM {table_ref(CHAT_TURN_TABLE)}
    """


def _filter_sql(framework: str | None, class_id: str | None, activity_id: str | None) -> tuple[str, dict[str, Any]]:
    """Build the WHERE clause + bound params for the researcher's filter.

    Every value binds as a query parameter — none is interpolated. The only
    thing that varies structurally is whether ``framework_id`` is compared for
    equality or tested for NULL, which is a branch on a sentinel, not on caller
    text reaching the SQL.
    """
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if framework == UNASSIGNED:
        clauses.append("framework_id IS NULL")
    elif framework:
        clauses.append("framework_id = @framework")
        params["framework"] = framework
    if class_id:
        clauses.append("class_id = @class_id")
        params["class_id"] = class_id
    if activity_id:
        clauses.append("activity_id = @activity_id")
        params["activity_id"] = activity_id
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, params


def framework_tabs() -> list[dict[str, Any]]:
    """One row per framework present in the logs, plus the unassigned bucket.

    This is the tab strip. A framework with no conversations does not appear —
    the caller merges it against the framework catalogue so a researcher can
    see that ESRU has been assigned to nobody yet, which is itself a finding.
    """
    sql = f"""
        WITH turns AS ({_turns_cte()})
        SELECT
          IFNULL(framework_id, '{UNASSIGNED}') AS framework_id,
          COUNT(DISTINCT session_id) AS sessions,
          COUNT(*) AS turns,
          COUNT(DISTINCT group_id) AS groups_seen,
          COUNTIF(role = '{ROLE_STUDENT}') AS student_turns,
          COUNTIF(role = '{ROLE_TUTOR}') AS tutor_turns,
          MIN(ts) AS first_ts,
          MAX(ts) AS last_ts
        FROM turns
        GROUP BY framework_id
        ORDER BY turns DESC
    """
    return [dict(r) for r in run_query(sql)]


def list_sessions(
    *,
    framework: str | None = None,
    class_id: str | None = None,
    activity_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Session-level rollup for one tab — the rows a researcher scans.

    Grouped by ``(session_id, framework_id)`` rather than session alone. A
    session whose class changed tutor mid-conversation genuinely has turns under
    two arms, and collapsing it to one would attribute half its turns to a
    framework that did not produce them. Such a session appears in both tabs,
    with the turn counts that belong to each — which is the honest shape, and
    keeps the tab counts summing to the total.
    """
    limit = max(1, min(int(limit), MAX_LIMIT))
    offset = max(0, int(offset))
    where, params = _filter_sql(framework, class_id, activity_id)
    sql = f"""
        WITH turns AS ({_turns_cte()})
        SELECT
          session_id,
          IFNULL(framework_id, '{UNASSIGNED}') AS framework_id,
          ANY_VALUE(group_id) AS group_id,
          ANY_VALUE(tutor_id) AS tutor_id,
          ANY_VALUE(persona_id) AS persona_id,
          ANY_VALUE(class_id) AS class_id,
          ANY_VALUE(activity_id) AS activity_id,
          ANY_VALUE(interaction_style) AS interaction_style,
          ANY_VALUE(teaching_source) AS teaching_source,
          ANY_VALUE(skill_id) AS skill_id,
          ANY_VALUE(revision) AS revision,
          COUNT(*) AS turns,
          COUNTIF(role = '{ROLE_STUDENT}') AS student_turns,
          COUNTIF(role = '{ROLE_TUTOR}') AS tutor_turns,
          COUNTIF(content IS NOT NULL AND content != '' AND content NOT IN UNNEST(@synthetic)) AS readable_turns,
          MIN(ts) AS started_at,
          MAX(ts) AS last_at
        FROM turns
        {where}
        GROUP BY session_id, framework_id
        ORDER BY last_at DESC
        LIMIT @limit OFFSET @offset
    """
    params.update({"limit": limit, "offset": offset, "synthetic": list(SYNTHETIC_CONTENT)})
    return [dict(r) for r in run_query(sql, params=params)]


def session_transcript(session_id: str) -> list[dict[str, Any]]:
    """Every turn of one conversation, in order — the drill-in.

    Ordered by ``turn_index`` with ``ts`` as the tiebreak: ``turn_index`` is the
    emitter's own counter and is the correct order, but it is SAFE_CAST from
    JSON and can be NULL on a malformed row, which would otherwise scatter such
    rows arbitrarily through the transcript.
    """
    sql = f"""
        WITH turns AS ({_turns_cte()})
        SELECT ts, turn_index, role, content, model, framework_id, tutor_id,
               persona_id, class_id, activity_id, interaction_style,
               teaching_source, group_id, skill_id, revision, app_version,
               content IN UNNEST(@synthetic) AS is_synthetic
        FROM turns
        WHERE session_id = @session_id
        ORDER BY turn_index NULLS LAST, ts
        LIMIT {MAX_TRANSCRIPT_TURNS}
    """
    return [dict(r) for r in run_query(sql, params={"session_id": session_id, "synthetic": list(SYNTHETIC_CONTENT)})]


def export_turns(
    *,
    framework: str | None = None,
    class_id: str | None = None,
    activity_id: str | None = None,
    limit: int = MAX_LIMIT,
) -> list[dict[str, Any]]:
    """Flat turn rows for CSV/JSONL export of whatever the current filter shows.

    Turn-level rather than session-level: an export a researcher can code by
    hand needs the text, and a session rollup has none.
    """
    limit = max(1, min(int(limit), MAX_LIMIT))
    where, params = _filter_sql(framework, class_id, activity_id)
    sql = f"""
        WITH turns AS ({_turns_cte()})
        SELECT ts, session_id, group_id, turn_index, role, content,
               framework_id, tutor_id, persona_id, class_id, activity_id,
               interaction_style, teaching_source, model, token_in, token_out,
               skill_id, revision, app_version
        FROM turns
        {where}
        ORDER BY ts DESC
        LIMIT @limit
    """
    params["limit"] = limit
    return [dict(r) for r in run_query(sql, params=params)]


__all__ = [
    "MAX_LIMIT",
    "SYNTHETIC_CONTENT",
    "UNASSIGNED",
    "export_turns",
    "framework_tabs",
    "list_sessions",
    "session_transcript",
]
