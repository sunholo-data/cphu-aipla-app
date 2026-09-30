# Review a group's work beside its conversation, not just the conversation

**Status:** 🚧 PARTIAL — **1.1.136** · M0, M1, M3 shipped 2026-09-29 (sprint CLASSVISIT-1, lane D) · group-report Exports shipped 2026-09-30 · M2, M4 OPEN (next sprint, sequenced with 1.1.99)
**Priority:** **P1** — directly serves the extension's strategic bet (*"rubric-scored logs as assessment evidence"*, [plan](../v2.1.0-extension/plan-2026-09-to-2027-04.md) workstream D). A transcript without the table it discusses is half the evidence. Needs only researchers and **existing** data, so it is **un-gated** by either legal blocker
**Estimated:** ~3–4d phased (M0 labelled events ~0.5d · M1 interleaved timeline ~1.5d · M2 final-state panel ~0.75d · M3 researcher read + lens wiring ~0.5d · M4 rubric evidence ~0.5d)
**Scope:** Backend: `observability/chat_log.py` (`emit_workbench_event`), `protocols/iframe_context_routes.py`, `reports/session_summary.py`, `analytics/research_logs.py`, `protocols/{table,writing}_progress_routes.py`, `analytics/rubric_evidence.py`, the `aipla_workbench_event` BQ view (`infrastructure/modules/chat-logs/views.tf`). Frontend: `components/teacher/research/ChatLogTranscript.tsx`, `app/teacher/reports/groups/[groupId]/page.tsx`, `app/teacher/insights/conversations/page.tsx`, the four `Workbench*` elements (label on push)
**Dependencies:** [1.1.109 researcher-chat-log-lens](researcher-chat-log-lens.md) (**shipped** — the transcript this extends); [1.1.99 live-class-work-wall](live-class-work-wall.md) (**OPEN** — shares the per-element miniature renderers; build them **once**, see below); [1.1.88 group-shared-table](group-shared-table.md) + `db/{table,writing,checklist,concept}_progress.py` (**shipped** — the final-state source); [tutor-sees-element-state](tutor-sees-element-state.md) / `adk/element_state.py` (**shipped** — readers to reuse); [human-tool-use-card-persistence](human-tool-use-card-persistence.md) (**shipped** — the card labels; its non-goals explicitly left analytics out, this picks that up). **Un-gated**
**Created:** 2026-09-29
**Source:** [class-visit-2026-09-feedback-triage.md](class-visit-2026-09-feedback-triage.md), item 2 — *"In students evaluation, it would be nice we don't only see the full dialogue but also data/figures/writings that students input in the workbench."*

## Problem Statement

A researcher evaluating a group reads the conversation and cannot see the
work the conversation is about. When a student writes *"is our slope right?"*,
the slope is in a table the transcript does not show.

**The data is mostly already stored. What is missing is a screen that shows
it next to the conversation.** This is the same finding [1.1.99](live-class-work-wall.md)
reached for the live view (*"an assembly problem, not a data problem"*), made
for the after-the-lesson view.

### What each review surface shows today (verified 2026-09-29)

| Surface | Shows | Workbench? |
|---|---|---|
| Researcher lens `/teacher/insights/conversations` (`ChatLogTranscript.tsx`, backed by `analytics/research_logs.py:274` `session_transcript`) | role + text from `aipla_chat_turn` | **No** |
| Teacher group report `/teacher/reports/groups/[groupId]` | AI summary, transcript, audio transcript, **plus** a separate "Workbench activity" list (`page.tsx:466–497`) | **As raw `server · field · value` rows, values cut to 80 chars, not in time order with the chat, no labels.** CSV export is chat-only; JSON includes events |
| Rubric judge (`analytics/rubric_evidence.py`) | transcript + uploaded documents + activity images | **No table, writing or calculator** |

### Where each element's work lives

| Element | Durable store | History? | Recoverable for review? |
|---|---|---|---|
| Table | Firestore `table_progress` `{group}:{activity}` + BQ event per commit | Latest in Firestore; history in BQ | **Yes** |
| Writing | Firestore `writing_progress` (full text) + BQ event (capped 4000 chars) | Same | **Yes** |
| Checklist | Firestore `checklist_progress` + BQ event | Same | **Yes** |
| Concept map | Firestore `concept_progress` | Latest | **Yes** (already shown class-level) |
| Calculator | BQ event + ADK state only | BQ | **Yes, from BQ** |
| Chart / figure | **Nothing** — drawn client-side from table data | — | **Re-renderable** from table data + the activity's chart definition |
| Sims | BQ event + ADK state delta | BQ | **Yes, from BQ** (as the parameters the student set) |
| Uploaded documents | `parsed_documents` + artifact | — | **Yes** |
| Solution photo / whiteboard | **Nowhere durable, by policy** ([student-multimodal-upload.md](student-multimodal-upload.md) §130–134) | — | **No** — see *Decision* below |

### Four small gaps stand between the data and the screen

1. **BQ workbench events carry no `activity_id`, `class_id` or human label.**
   `emit_workbench_event` (`chat_log.py`) takes `group, session, skill, server,
   tool, field, value`. The iframe-context route stores the card's `_label`
   in the ADK event but **does not pass it on** (`iframe_context_routes.py:375`).
2. **Table, writing, calculator and checklist pushes send no label at all.**
   Only sims do (`GenericArtefactFrame.tsx:154`). `WorkbenchTable.tsx`
   dispatches its card label client-side (:108) but calls
   `pushTableSnapshot(snap, kind)` without it (:196).
3. **The owner-only teacher GETs block researchers.** `table_progress_routes.py:72–78`
   and `writing_progress_routes.py:57–63` 404 unless `activity.owner_uid ==
   user.uid`. They should use `analytics.auth.assert_can_read_class`, which
   already knows researchers. No UI calls those GETs today.
4. **No renderer exists** for a table/writing/chart snapshot outside the
   student workspace. 1.1.99 needs the same miniatures.

## Design

### M0 — Every workbench event says what it was (~0.5d)

- `emit_workbench_event` gains `activity_id`, `class_id` and `label`
  (all optional, so old callers keep working). Add them to the BQ view.
- `iframe_context_routes.py` passes the `_label` it already receives.
- The four workbench elements send the same label their trust card shows
  (the client already has it). Extend `scripts/audit-trust-cards.sh` so
  **a push without a label fails CI**. That is the same "two-ended wiring"
  shape this repo keeps shipping half of (CLAUDE.md footguns: *trust card
  dropped*, *resolver with one consumer*).
- **Going forward only.** Past rows stay unlabelled; M1 falls back to a
  label derived from `server`/`field`.

### M1 — One timeline: turns and work, interleaved (~1.5d)

`session_transcript` gets a sibling, `session_timeline`: a single BQ query
that `UNION ALL`s `aipla_chat_turn` and `aipla_workbench_event` for the
session, ordered by timestamp. `ChatLogTranscript` renders workbench rows
**inline** as compact cards between the turns: *"📊 Table updated — 3 rows"*,
*"✏️ Writing — 214 words"*, *"🧮 Calculator: 9.82 × 0.35 = 3.44"*, *"🎛 Sim:
angle 30° → 45°"*. The cards look like the trust cards the student saw, so
researcher and student read the same record.

- **Collapse bursts.** Table edits arrive per commit; consecutive events of
  the same element within ~30 s fold into one card with a count, expandable.
- A card **expands** into the element's state at that moment: the table as
  a grid, the writing as text. That state is rebuilt from that event's
  `value`, since each commit carries the snapshot.
- Same component on both surfaces: the researcher lens **and** the teacher
  group report, which retires the raw 80-char list at `page.tsx:466–497`.

### M2 — "What they ended with" panel (~0.75d)

Beside the timeline, a panel shows the group's **final** work per element,
from the `*_progress` stores (the same reads `adk/element_state.py` already
does for the tutor). The panel shows the table as a grid, **the chart re-rendered**
from that table using the activity's chart definition, the full writing, and the checklist.

**Build the miniature renderers here, once, for 1.1.99 to reuse.**
Whichever of the two ships first builds them. Doing it here first is
the better order: a static snapshot is a subset of the live one, with no
transport.

### M3 — Researchers can read it (~0.5d)

Switch the table/writing GETs to `assert_can_read_class` (and add the same
for checklist/concept if not already there). Add a dual-audience test in the shape of
`test_dual_auth_rejection`: researcher allowed, a teacher of a *different*
class refused, student refused.

### M4 — The rubric judge sees the work too (~0.5d)

`rubric_evidence.py` appends the M2 final-state block (table as text grid,
writing, calculator results) to the judge's evidence. **This is the M that
makes it assessment evidence** rather than a nicer viewer. Re-run the
existing rubric evals before/after to show the change in scores. The
change should be most visible on items about data handling, which the judge
cannot currently see.

### Exports

The CSV/JSON exports gain the timeline rows (`kind = turn | work`). The CSV
must use the fixed `downloadCsv` from [1.1.137](class-list-on-the-teacher-device.md)
M0 (BOM + Excel-safe). Otherwise Danish writing arrives garbled in Excel.

**Shipped 2026-09-30 for the group report** (`/teacher/reports/groups/[groupId]`,
`components/teacher/research/timelineExport.ts`). Both buttons read the
labelled timeline fresh at click time (`getGroupReportTimeline`, the same client
the transcript uses), so an export no longer depends on the transcript being
open; if it cannot be read, or is empty, they interleave the report's own
payload — the same fallback the page renders.

- **CSV** — one row per timeline item, in time order:
  `timestamp, role, content, kind, label`. The first three are the chat-only
  file's columns, **unchanged in name and position**, so an existing sheet or
  script still finds them; `kind` (`turn` | `work`) and `label` are appended,
  and the filename is unchanged. That is the compatibility choice: appending
  columns keeps old consumers working, and `kind` lets them filter back to the
  chat-only view. Work rows leave `role` empty, carry the card's label (the
  derived fallback — *"Writing updated"* — for rows before M0) and a readable
  summary of the state in `content` (table as header + rows, writing as text,
  calculators as inputs → result, checklist as ☑/☐) — never the raw JSON.
  Timestamps are the raw ISO values, not the page's HH:MM.
- **JSON** — the SessionSummary payload as before, plus `timeline` (the API's
  items as-is, raw `value` included), `timelineSource` (`server` | `report`) and
  `timelineWorkStatus`.

**Not changed:** the researcher lens's export on `/teacher/insights/conversations`
is a server-generated bulk file of chat turns across many sessions
(`fetchChatLogExport` → `/api/research/logs/export`), not a per-session
download. Adding work rows there is a backend change to that route — left open.

## Decision needed — photos and whiteboard drawings (JB)

The solution element's photos and drawings are the one piece of student
work that is **not recoverable**, and that is deliberate: images are
not retained ([student-multimodal-upload.md](student-multimodal-upload.md)).
A photo of a hand-drawn graph can contain a face or a name, and
[1.1.93 uploaded-image-anonymisation](uploaded-image-anonymisation.md) exists
for that reason.

**Recommendation: do not change this in 1.1.136.** Show a placeholder card
(*"📷 Photo shared with the tutor — not kept"*) in the timeline, and show the
tutor's reply, which usually describes what it saw. Retaining images is a
retention and DPIA question for JB, not an engineering one. Park it until the
Google data agreement lands (Nov–Dec).

## Out of scope

- Per-student attribution inside a group. The group is the finest grain
  (ADR-001). This view is per group.
- Live updates. That is 1.1.99.
- History in the Firestore stores. BQ already is the history, so do not add
  a second one.

## What shipped — 2026-09-29

Sprint CLASSVISIT-1, lane D. M0, M1 and M3; M2 and M4 are the next sprint.

**M0 — every workbench event says what it was.**
- `emit_workbench_event` takes optional `activity_id`, `class_id`, `label`;
  the `workbench_events` view selects them (`views.tf` — **committed, not
  applied**; `make tf-apply` is a human step). A lockstep test fails if the
  emitter writes a key the view does not select.
- The iframe-context route passes the card label through, the class from the
  student's **verified group tags** (never a request field), and the activity
  from the client (telemetry only — it grants nothing).
- ⚠️ **Deviation: a second wire field, `logLabel`.** Putting the card label on
  *every* push would have broken two things the design did not account for:
  `_label` is what the transcript restore renders, and a labelled push bumps
  the group revision. A table pushes per cell commit and a writing element per
  autosave, but each shows ONE debounced card — so a card label per push would
  restore one card per cell on reload and trigger a groupmate refetch per
  cell. One-shot elements (calculator, checklist, sims) send the card label as
  before (and now also sync live to a groupmate, which 1.1.53 intended);
  per-commit and `.sync` pushes send the same text as `logLabel`, which reaches
  BigQuery only. The BQ `label` column is `label or logLabel`.
- `scripts/audit-trust-cards.sh` now also fails any `useSimSnapshotPush` call
  with neither a card label (3rd argument) nor a `logLabel` (4th), naming the
  file and line.

**M1 — one timeline.**
- `analytics/research_logs.session_timeline`. ⚠️ **Deviation: two queries, not
  one `UNION ALL`.** The workbench sink table only exists once an event has been
  written, so a union would fail the whole read — the transcript included — on
  a fresh environment. The turns query raises (the route's 503); the work query
  degrades to `workStatus: "unreadable"`, which the UI states rather than
  showing "no work".
- **Ordering:** both turns of an invocation are logged *after* the reply, so a
  student turn carries its answer's time. It is re-anchored at `tutor.ts −
  latency_ms`; otherwise table edits made while the tutor was thinking would
  sort before the question. Turn order itself is never changed.
- Routes (both off the event loop): `GET /api/research/logs/sessions/{id}/timeline`
  (researcher-only) and `GET /api/research/logs/groups/{code}/sessions/{id}/timeline`
  for the group report — class owner or researcher, narrowed to that group, the
  same 404 for everyone else. It lives in `research_logs_routes.py` rather than
  `reports_routes.py` so the report's summary path was untouched (lane A owned it).
- `ChatLogTranscript` renders work as compact cards carrying the trust-card
  label (a derived label for rows before today), folds same-element bursts
  within 30 s with a count, and expands into the state at that moment (table
  as a grid, writing as text, calculator and checklist as lists). Used on
  `/teacher/insights/conversations` and on the group report, which **retires the
  80-char "Workbench activity" list**. If the labelled timeline cannot be read
  (a session with no BigQuery rows yet), the report interleaves its own payload.

**M3 — researchers can read it.** The all-groups branch of the table, writing,
checklist **and** concept progress GETs goes through one rule
(`protocols/progress_read_access.py`): `?classId=` → `assert_can_read_class`,
narrowed to that class's group codes; no class → the activity owner (unchanged)
or a researcher (span-tagged). Anyone else: the same 404 as an unknown
activity. Students still read only their own group. The Firestore scan moved off
the event loop. No UI calls these yet — M2 is the first consumer.

**Not done here:** the Exports section (timeline rows in CSV/JSON — needs
1.1.137's `downloadCsv`, lane C; **since shipped 2026-09-30 for the group report**,
see §Exports; the researcher lens's server-side bulk export is still chat-only) · M2 · M4 · the photo placeholder card (the
solution element does not push, so there is no event to hang it on; M2).

## Acceptance

- A researcher opens a session from the lens and sees table/writing/calculator/sim
  activity **in time order between the turns**, with human labels, and can
  expand any card into the state at that moment.
- The final-state panel shows the table, the re-rendered chart and the full
  writing for a group that used them on 2026-09-22 (retro-test on prod data).
- A teacher of another class gets 404 on those reads; a researcher gets 200.
- CI fails if a workbench element pushes state without a label.
- Rubric evidence includes the final-state block; the eval diff is recorded
  in this doc.
