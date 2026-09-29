# Review a group's work beside its conversation, not just the conversation

**Status:** Design (OPEN) — **1.1.136**
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
