# The data table is the group's, not the tab's — `table_progress`, the fourth per-group store

**Status**: Planned — **1.1.88**
**Priority**: **P0** — silent data loss in the canonical physics-lab shape. Reported from a real lesson
**Estimated**: ~1–1.5d (M1 the store ~0.6d · M2 the snapshot key ~0.4d · M3 live convergence ~0.5d)
**Scope**: Backend — a new `db/table_progress.py` + routes, and the `element_state` table reader; frontend — `WorkbenchTable` stops using `sessionStorage`
**Dependencies**: [1.1.73 student-writing-element](student-writing-element.md) / `db/writing_progress.py` (**SHIPPED** — the idiom this is the fourth instance of); [1.1.53 group-shared-session-sync](group-shared-session-sync.md) (the decision this revises, with M's 2026-08-27 call); [1.1.71 multi-table-activities](multi-table-activities.md) (**shares the key change — read together**)
**Created**: 2026-08-27
**Source**: [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md) item 26. Decision D3 taken by M, 2026-08-27: the table becomes genuinely shared; item 27 (individual codes) is scoped separately

## Problem Statement

Two students, one group, one activity, one table of measurements:

> We each saw the numbers we typed, but the AI only 'saw' the most recently entered values. As
> students, we couldn't accurately see what each other was doing.

That is the canonical physics-lab shape — two people taking readings into one table — and it does
not work.

### It is not one bug, it is the table being the last element left behind

[`WorkbenchTable.commit()`](../../../../frontend/src/components/workspace/WorkbenchTable.tsx#L136)
persists a cell like this:

```js
window.sessionStorage.setItem(storageKey, JSON.stringify(values));
```

**Per browser tab.** Every other student-fillable element migrated off that years ago, to a
per-group Firestore store: `checklist_progress`, `concept_progress`, `writing_progress`. The idiom
is explicit — `writing_progress.py` opens by calling itself *"sibling of `db/checklist_progress.py`
and `db/concept_progress.py`, and deliberately the same shape: one idiom for per-group student
state, not a third bespoke store."*

And it names the table, by name, as the thing that has not moved:

> **Why this is not sessionStorage.** `WorkbenchTable` keys its cells by `sessionStorage`, per
> browser. `checklist_progress` records what that costs, in as many words: *"three group members had
> three private checklists and none of them survived a closed tab."*

So item 26 is a **known, documented, already-solved-three-times** defect that was left un-fixed on
the one element where physics data actually lives. The teacher's report is the fourth independent
statement of the same cost, and the first from a real classroom.

There is a second half the teacher did not see, because their students did not close a tab: the
table dies with the tab, exactly as the writing element did before 1.1.73.

### The tutor half: one slot, two writers

Separately, [`element_state.py:194`](../../../../backend/adk/element_state.py#L194) says:

> Only ONE table's snapshot can be live at a time — every table pushes to the same `table.state`
> key, which is the stable-id problem 1.1.71 exists to fix.

Two group members pushing from two devices land in that one slot, last write wins — which is
precisely *"the AI only saw the most recently entered values"*. **Item 26 and
[1.1.71](multi-table-activities.md) are the same key.** One collides two students, the other two
tables. They must be fixed together or that key gets migrated twice over student data keyed
`${table}::${row}::${col}`.

### What this revises

[1.1.53 M2](group-shared-session-sync.md) deliberately dissolved "workbench clobber" on 2026-07-01,
reasoning that *"the group shares one conversation, not one mouse"* and the workbench is per-device
scratch. **That reasoning holds for sims and does not hold for the table.** Two students poking
their own simulations is genuinely not a conflict; two students recording measurements into one
table is not two scratchpads, it is one artifact. The decision has in any case already been
overtaken in practice — three of the four fillable elements moved to per-group stores after it was
taken. This doc finishes that migration rather than reopening the argument.

## Goals

**Primary Goal:** a group's table is one table — every member sees every reading, and so does the tutor.

**Success Metrics:**
- Two devices in one group converge on the same grid.
- The tutor's view of the table contains every member's cells, not the last writer's.
- A closed tab loses nothing.

**Non-Goals:**
- Real-time collaborative editing with cursors. Convergence, not co-presence.
- Per-student attribution of cells. ADR-001 keeps student state group-keyed; recording *who* typed
  a value would be the first individual-level student record in the system and is item 27's
  conversation, not this one.
- Item 24 (an isolated mode inside a group) — separately scoped, and it pulls the other way.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | A debounced write replaces a synchronous `sessionStorage` write; the grid stays the immediate feedback. |
| 2 | EARNED TRUST | **+2** | The tutor currently discusses a partial table as though complete, and the students cannot see that it is partial. Both halves of the axiom, in one defect. |
| 3 | SKILLS, NOT FEATURES | 0 | No change to the skill abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involvement. |
| 5 | GRACEFUL DEGRADATION | **+1** | A failed write is currently invisible; the store gives it the same save-state affordance the writing element already has. |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Fourth instance of a stated idiom, not a fourth bespoke store — the thing `writing_progress` explicitly asks the next author not to do. |
| 7 | API FIRST | 0 | New routes, mirroring the three siblings. |
| 8 | OBSERVABLE BY DEFAULT | **+1** | Table data becomes inspectable server-side; today it exists only inside a browser tab and is unrecoverable after the lesson. |
| 9 | SECURE BY CONSTRUCTION | 0 | Group-keyed with the same ACL as its three siblings. **Must import from `auth`, the dispatcher — never `auth.firebase_auth`**; all three sibling stores shipped that 401 first. |
| 10 | THIN CLIENT, FAT PROTOCOL | **+1** | Moves student state out of the client, which is where the other three already are. |
| | **Net Score** | **+6** | Threshold: >= +4 |

**Conflict Justifications:** None — no axiom scores -1.

## Design

**M1 — `db/table_progress.py`.** Firestore at `table_progress/{group_id}:{activity_id}`, the same
shape as its three siblings. Copy `writing_progress.py` structurally; it was written to be copied.
`WorkbenchTable` loads on mount and saves debounced on commit, keeping `sessionStorage` only as an
offline buffer, never as the source of truth.

**M2 — the snapshot key, jointly with [1.1.71](multi-table-activities.md).** `mcp_app_context.table.state`
becomes id-keyed, in the calculator/writing shape that already exists (*"EVERY writing element in
one array, matched by id"*). The tutor then reads the whole group's grid for each authored table.
Do this **once**, covering both collisions, over data keyed `${table}::${row}::${col}` — the
migration 1.1.71 was deferred for is the same migration, and doing it twice is the outcome to avoid.

**M3 — convergence.** Reuse 1.1.53's revision-bump-and-refetch idiom rather than inventing a
transport; the group session already carries a revision. Last-write-wins **per cell** rather than
per grid, so two students filling different rows never clobber each other — which is the shape a
lab actually has.

**Conflict policy, stated rather than assumed.** Two students typing the same cell is rare and
must still be defined: last write wins, the losing value is not silently discarded but shown to its
author as a changed cell. A silent overwrite is the defect this doc exists to remove; re-creating a
smaller version of it inside the fix would be the obvious failure.

## Testing Strategy

**Backend (pytest)**
- CRUD on `table_progress` mirroring the three sibling suites.
- **A real minted group token through the real dispatcher** (`test_dual_auth_rejection` shape). Per
  the CLAUDE.md footgun, a route's own tests `dependency_overrides` the same symbol the route
  imports, so they pass in lockstep with the bug. All three siblings shipped this 401 first.
- `element_state` reports the union of the group's cells, and reports **two tables separately** (the
  1.1.71 half).
- Reset-session clears it, matching `checklist_progress`; group erasure covers it, which
  [1.1.80](group-erasure-cascade.md)'s registry should enforce rather than this doc remembering.

**Frontend (Vitest)**
- Two mounted instances with the same group/activity converge.
- A remount restores the grid from the store, not from `sessionStorage`.
- A failed save surfaces a visible state rather than failing silently.
- The trust card still fires per the debounce (`audit-trust-cards.sh` must stay green).

**Manual, on deployed dev**
- Two browsers, one group code, one activity: fill alternating rows and confirm both grids and the
  tutor agree.

## Migration

- **`sessionStorage` data is not migrated.** It is tab-scoped and by definition already lost. Say so
  rather than writing a best-effort import that would silently resurrect one student's copy as the
  group's truth.
- **M2 is a stored-shape migration** over `${table}::${row}::${col}` keys. It is the risky step, it
  is why 1.1.71 was deferred four days from a pilot, and it should land in its own change window —
  not alongside [1.1.86](activity-builder-ergonomics.md) M2's `order` field, which touches the same
  payload.
- **Rollback:** M1 is additive; the client can fall back to `sessionStorage` if the store is
  unreachable, which is also the offline story.

## Success Criteria

- [ ] Two devices in one group see the same grid.
- [ ] The tutor's table state contains both students' cells.
- [ ] A closed tab loses nothing.
- [ ] Two tables report separately (1.1.71 satisfied by the same key change).
- [ ] A real group token through the real dispatcher passes — not a `dependency_overrides` mock.
- [ ] Reset-session and group erasure both cover the new store.
- [ ] The reporting students repeat the lesson and both see each other's readings.

## Open Questions

1. **Does item 24 (isolated mode) contradict this?** One teacher wants the group's work shared; another
   wants students not to see each other's answers. Both are real. The likely answer is that sharing is
   a property of the *activity*, not of the platform — but that is a design decision, and building this
   without settling it risks a second mode bolted on later.
2. **Per-cell or per-grid last-write-wins?** Per-cell is obviously better and slightly more work.
   Recommendation: per-cell; a lab has two people filling different rows, which per-grid handles worst.
3. **Should the table carry a fill timestamp?** Useful for the teacher's live view and for research,
   but it approaches per-student attribution, which is item 27's conversation. Default: no.

## Related Documents

- [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md) — item 26 and decision D3
- [group-shared-session-sync.md](group-shared-session-sync.md) — the 2026-07-01 decision this revises for the table
- [multi-table-activities.md](multi-table-activities.md) — 1.1.71, the same key change
- [student-writing-element.md](student-writing-element.md) — the per-group store idiom, and the docstring that named the table
- [group-erasure-cascade.md](group-erasure-cascade.md) — 1.1.80's eraser registry, which this store must register with
