# 1.1.109 — Researcher chat-log lens: conversations by teaching approach

**Status:** SHIPPED (dev) 2026-09-11 · **Owner:** M · **Reviewed:** 2026-09-11
**Surface:** `/teacher/research/logs` (researcher-only) · **API:** `/api/research/logs/*`
**Predecessor:** [handover-2026-09-11.md](handover-2026-09-11.md) action 3 —
*"researchers see every conversation grouped by teaching style, in tabs, with an
unassigned tab, plus general observability."*

## What this is

The read side of TUTOR-5. Until 2026-09-11 the chat-log pipeline recorded
`skill_id` and nothing about the pedagogy, so *"show me every conversation that
ran under ESRU"* was not an answerable question. TUTOR-5 put `tutor_id`,
`framework_id`, `persona_id`, `class_id`, `activity_id`, `interaction_style` and
`teaching_source` on every emitted turn. This surface reads them.

One tab per teaching approach, one row per conversation, the transcript one
click away, and a CSV/JSONL export of whatever the filter shows.

## It is not the other two transcript surfaces

Both already exist and neither answers this question:

| Surface | What it shows | Reached from |
|---|---|---|
| `GroupTranscriptSection` | the **audio** lesson recording (consent-gated STT) | a teacher report |
| `/api/reports/sessions/{id}` | one session's AI summary + chat turns | a class or group |
| **this** | **every** conversation, across classes and teachers, **grouped by what taught it** | the researcher nav |

The first two are per-group and teacher-facing. The question here is
cross-corpus and comparative, which is why it is a researcher surface with its
own read path rather than a filter on a report.

## Three decisions worth keeping

### 1. It reads the RAW sink table, not the `chat_turns` view

The handover said to read the view. I did not, and the reason is
environmental rather than aesthetic: **the flattened views exist on test and
prod and not on dev.** `create_views` is a terraform option, dev's dataset was
bootstrapped by script, and dev has no infra trigger to apply one. A read path
bound to the view is a read path that 500s in the only environment anyone
develops in.

So `analytics/research_logs._turns_cte()` repeats the view's projection as a CTE
named `turns`. The query bodies read with plain column names exactly as if they
were hitting the view, while depending on nothing but the table the sink itself
creates. Verified identical on both: 870 rows / 48 with a framework on prod
through either path, and the same query runs on dev (288 rows, 0 with a
framework) where the view does not exist.

The cost is a second copy of a projection, and two copies drift. That is what
`test_projection_selects_every_field_the_view_does` is for — and it earned its
place on its first run, catching four fields (`token_in`, `token_out`,
`latency_ms`, `teacher_focus`) the view selects and the lens had missed.

Every field is read with `JSON_VALUE`, never as a struct member, for the reason
views.tf gives at length: the sink infers the `jsonPayload` STRUCT only from
fields it has seen non-null, so a struct-member SELECT over a never-populated
field fails the **whole query**. That is how enabling the views failed on
2026-09-11, and the lens would fail the same way on a fresh environment.

### 2. An unreadable store is never rendered as an empty one

This is the footgun table's *"a checker answers when it could not read its
subject"* applied to evidence, and it is worse here than in ops. An empty tab
and a failed query are byte-identical on screen, and the empty one reads as a
**research finding**: *nothing ran under ESRU*.

So `db/bigquery.py`'s established "callers wrap BQ in try/except and degrade to
empty" contract — right for a spend dashboard — is deliberately **not** followed.
`_read()` converts any query exception into a `503` whose detail says *this is a
failed read, not an empty result*, and the page renders "could not read the
conversation store". Netted by
`test_unreadable_store_is_503_not_an_empty_result`.

### 3. NULL is "not recorded", never "no framework"

Every row before 2026-09-11 is null because the field did not exist, and the
values are deliberately not backfilled — a class's tutor changes, so joining
group → class → tutor after the fact files old conversations under arms they
never ran under. A wrong label that looks like evidence is worse than a null.

The tab is therefore labelled **"Not recorded"**, carries a note saying why, and
a test asserts it never says "no framework". `teaching_source` separates the
cases going forward: `tutor` = a Tutor object decided, `fields` = the pre-tutor
class/activity path did.

## Two things the real data taught that a mock would not

- **`[session_start]` is not something a student typed.** It is the non-empty
  sentinel a system-driven turn must send, because
  `ag_ui_adk._convert_latest_message` silently drops a message with falsy
  content — and it is logged under `role='student'` like anything else. Shown
  raw, a transcript puts those words in a student's mouth in a research record.
  It is **marked, not filtered**: dropping it would hide that the system rather
  than the student opened the conversation. `readable_turns` excludes it, so a
  4-turn session correctly reads "3 of 4".
- **Roles are `student`/`tutor`, not `user`/`assistant`.** A rollup counting
  `role='user'` returns zero for every session — a silently empty column rather
  than an error. Asserted against the emitter in `test_research_logs_sql.py`.

## Sessions are grouped by `(session_id, framework_id)`, not by session

A session whose class changed tutor mid-conversation genuinely has turns under
two arms. Collapsing it to one would attribute half its turns to a framework
that did not produce them. Such a session appears in both tabs with the turn
counts belonging to each, which also keeps the tab counts summing to the total.

## Evidence, as of 2026-09-11

The handover recorded that `tutor_id` / `framework_id` / `persona_id` had
**never been seen non-null in production**. That is no longer true, and this
surface is how it was noticed:

```
tabs (prod)          sessions  turns  student  tutor
authentic-dialogue          8     48       24     24   ← henrik, teaching_source='tutor'
__unassigned__             78    822      402    399
```

TUTOR-5 works end to end in production. The remaining six pairings are still
M's to make (handover action 2), and the 1-1 confound warning there applies
directly to this surface: **if the product mapping is 1-1, a per-framework tab
is also a per-persona tab**, and anyone reading the tabs as a pedagogy
comparison is reading a confound. That is an argument for persona variants as
the research instrument, not against the tabs.

## What is not built

- **No human-readable class/activity names** — the table shows truncated ids.
  The names live in Firestore and want a join the query layer does not do yet.
  Cheap, and the obvious next increment.
- **No date-range filter.** `limit`/`offset` paging only, capped at 500 rows.
- **No cross-tab comparison view.** Deliberately: that is
  [1.1.107 framework-fit-profile](framework-fit-profile.md)'s job, which scores
  *fit* rather than counting *assignment*, and must stay blind to the arm.
- **Consent is not filtered on here.** [1.1.3](student-consent-prompt.md) gates
  what reaches BigQuery at write time, so a row's presence already implies it.
  Worth re-checking before this surface is used for publication.

## Files

| Path | What |
|---|---|
| `backend/analytics/research_logs.py` | the query layer + the inlined projection |
| `backend/protocols/research_logs_routes.py` | researcher-only API, loud on a failed read |
| `frontend/src/app/teacher/research/logs/page.tsx` | tabs, session table, export |
| `frontend/src/components/teacher/research/ChatLogTranscript.tsx` | the drill-in |
| `backend/tests/unit/test_research_logs_sql.py` | projection lockstep + SQL shape |
| `backend/tests/api_tests/test_research_logs_routes.py` | auth + the 503-not-empty rule |
| `frontend/src/app/teacher/research/logs/__tests__/page.test.tsx` | the UI rules above |
