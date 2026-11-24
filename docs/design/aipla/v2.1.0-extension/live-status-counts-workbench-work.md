# The teacher's live status counts work in the workbench, not only chat

**Status**: **PROPOSED** 2026-11-24 — **1.1.161**
**Priority**: **P1**. Today the label is wrong in the direction that costs the most: it can send the teacher to the group that is working hardest. It is also the trigger [1.1.162](tutor-interjects.md) would build on, so it has to be right first
**Estimated**: **~1.5d** (M0 evidence ~0.25d · M1 one "last work" stamp ~0.5d · M2 signals read it ~0.25d · M3 teacher copy ~0.25d · M4 tests ~0.25d)
**Scope**: Backend: `db/group_sessions.py` (one stamp beside lock, pulse and presence), the four `protocols/*_progress_routes.py` writers plus `iframe_context_routes.py` (stamp on write), `analytics/live_class.py` (read it), `protocols/classes_routes.py:828` (unchanged call). Frontend: `app/teacher/classes/[id]/_GroupsTable.tsx` (status chip), `frontend/messages/{da,en}/` (copy). No new collection
**Dependencies**: [1.1.31 teacher-analytics-framework](../v1.1.0-feedback/teacher-analytics-framework.md) (**shipped**, the live signals) · [1.1.53 group-shared-session-sync](../v1.1.0-feedback/group-shared-session-sync.md) (**shipped**, the `group_sessions` doc and presence)
**Source**: [notes-2026-11-23-session-feedback.md](../../../notes-2026-11-23-session-feedback.md), point 2: *"does the student active/nonactive work when they are in the workbench or is it just chat?"*

## Problem

`analytics/live_class.py` derives every group's live label from the chat-session
index alone (`last_message_at`, `turn_count`):

| Label | Rule today |
|---|---|
| *active* | last **chat turn** under 5 min ago |
| *stuck* | at least 2 turns, then 6–30 min with no new **turn** |
| dropped from the live view | 90 min with no **turn** |

A group filling a measurement table, writing a conclusion or running a sim
without talking to the tutor shows as *quiet* after 5 minutes, and as *stuck*
after 6. The teacher is pointed at the group that needs them least, and the
groups that are actually stuck are buried among false alarms.

## Findings

### F1. The evidence of work is already written, in five places

| Signal | Where it lands today | Timestamp |
|---|---|---|
| Table edit | `db/table_progress.py` | `updatedAt` |
| Writing | `db/writing_progress.py` | `updatedAt` |
| Checklist mark | `db/checklist_progress.py` | `updatedAt` |
| Concept-map node | `db/concept_progress.py` | `updatedAt` |
| Sim event | `POST /sessions/{id}/iframe-context` → ADK session state, plus the sim ledger (1.1.155) | push time |

Reading all five per group on every teacher poll would be 5×N Firestore reads in
an `async def`, which is the *Blocking I/O* footgun. It is cheaper to stamp
once on write.

### F2. "Page open" is already known, separately

`touch_presence` (`db/group_sessions.py:400`) heartbeats every ~2.5 s while a
student tab is visible, with a 15 s window. It only feeds the "a classmate is
asking…" banner today. It answers a different question from work: a page open
and untouched for ten minutes is its own state, and teachers would want to see
it.

## Decision

**One stamp, written where the work is written, read where the label is
computed.**

- `group_sessions/{group, activity}` (already the one doc for lock, pulse,
  pointer and presence) gains `lastWorkAt` and `lastWorkKind`
  (`chat | table | writing | checklist | concept_map | sim`).
- Each writer in F1 stamps it as a merge write. It is throttled to one write
  per group per ~20 s in-process, so a fast typist doesn't double the write rate.
- `compute_group_signals` takes `last = max(last chat turn, lastWorkAt)` and
  carries `lastWorkKind` through, so the chip can say *where*.
- Presence adds one state: page open, no work for over 5 min.

Group level only, no per-student data (ADR-001). The kind is a surface name,
never content.

### The labels after the change

| Label | Rule |
|---|---|
| *Working — in the table* (or sim, writing…) | last work under 5 min ago, and it was not chat |
| *Talking to the tutor* | last work under 5 min ago, and it was chat |
| *Page open, nothing for N min* | presence fresh, last work over 5 min ago |
| *Quiet* | no presence and no work for over 5 min |
| *Stuck?* | was working (≥2 units of work), then 6–30 min with **no work of any kind**, presence fresh |

*Stuck* now needs the page to be open. A group that closed the laptop is
*quiet*, not stuck.

## Milestones

### M0 — evidence (~0.25d, M runs the queries)

Read-only, prod, 2026-11-23: for each group, list chat turns next to
progress-route and `iframe-context` request times. Count the minutes that group
would have shown as *quiet* or *stuck* while it was writing to the workbench.
That number goes in the release note.

### M1 — the stamp (~0.5d)

`touch_work(group_id, activity_id, kind)` in `db/group_sessions.py`, called by
the four progress writers, the iframe-context route and the chat-turn commit.
Throttled, never raises (a failed stamp must not fail the student's write).

### M2 — signals read it (~0.25d)

`compute_group_signals` reads the group's `group_sessions` docs in one batch,
off the event loop. `LiveGroupSignal` gains `last_work_kind` and `page_open`.
The thresholds stay where they are.

### M3 — the teacher sees where (~0.25d)

The status chip in `_GroupsTable.tsx` says where, in `da` and `en` copy through
`useT`. Status text goes in the copy object, never inline (`make check-i18n`).

### M4 — tests

- A group that only edits the table for 8 minutes reads *Working — in the
  table*, not *stuck*. **This is the test that fails today.**
- A group with presence and no work for 10 minutes reads *Page open*.
- A group with no presence and no work is never *stuck*.
- The stamp is throttled, and a stamp failure leaves the progress write intact.
- `test_blocking_queries_off_the_loop.py` covers the new read.

## What this does not do

- No new per-student signal, and no keystroke-level tracking. "Work" is what
  the existing stores already persist.
- It does not change what the **tutor** sees. Workbench state already reaches
  the tutor's context (`adk/element_state.py`), including empty elements.
- It does not make *stuck* trigger anything. That is
  [1.1.162](tutor-interjects.md)'s question.
