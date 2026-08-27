# Activity-builder ergonomics — five things teachers asked for after using it

**Status**: Planned — **1.1.86**
**Priority**: **P2** — none of the five blocks a lesson; together they are what a teacher who has adopted the builder complains about. Item 13 arrived twice from two independent sources
**Estimated**: ~2–2.5d for all five, each independently shippable
**Scope**: Frontend — [`FloatingCopilot.tsx`](../../../../frontend/src/components/teacher/copilot/FloatingCopilot.tsx), the activity builder editors, [`useActivityBuilder.ts`](../../../../frontend/src/hooks/useActivityBuilder.ts), [`WorkbenchNote`](../../../../frontend/src/components/workspace/WorkbenchNote.tsx) authoring; backend only where the element model forbids what is asked
**Dependencies**: [activity-elements-palette.md](activity-elements-palette.md) — the element registry and its two-surface recipe; the full-overwrite POST contract (`useActivityBuilder.elementPayload()`)
**Created**: 2026-08-27
**Source**: [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md), items 9, 11, 12, 13, 14

## Problem Statement

Five asks from the 21 August feedback share a shape: the teacher has built activities, likes it
enough to keep doing it, and is now blocked by the *ergonomics* of the surface rather than by what
it can express. That is a different and better class of complaint than the June feedback, and it is
worth treating as one piece of work.

| Item | Ask | Verified state |
|---|---|---|
| 9 | "the co-builder window could be larger so you can read the entire conversation at once" | `FloatingCopilot` is `max-h-[70vh] w-[min(384px,calc(100vw-2rem))]`, not resizable, and its transcript scrolls in a `flex-1 overflow-y-auto` |
| 11 | "an equation editor in the note field, so formulas look neat" | KaTeX **rendering** works (`remarkMath` + `rehypeKatex` in `ChatMarkdown`, which `WorkbenchNote` uses). The gap is **input** — the teacher types raw LaTeX or gives up |
| 12 | "decide the sequence of elements in the workspace myself, so the table doesn't necessarily have to precede the graph" | No ordering control in the builder |
| 13 | "create multiple instances of the same element — one table for data processing and another for results" | **Already designed and deferred** — [multi-table-activities.md](multi-table-activities.md) (1.1.71), written 2026-08-10 from Aswin's *"sometimes we need multiple tables in physics lab"*, deferred during pilot week for id-migration risk. Also in the [25 August notes](../../../notes-2026-08-25.md): *"More than one table ?"* |
| 14 | "drag and rearrange columns so the first variable entered isn't automatically the first column" | No column reordering in the table editor |

**Item 13 is not new, and that is the point.** [1.1.71 multi-table-activities](multi-table-activities.md)
has been designed since 2026-08-10 and was deferred during pilot week — correctly, four days out
from a pilot, because it carries a stable-id migration over student data keyed
`${table}::${row}::${col}`. It has now been asked for by **three independent sources**: Aswin
(10 Aug), the 25 August notes, and a pilot teacher (21 Aug). **This doc does not redesign it — it
un-defers it.** Read 1.1.71 for the design; the milestone below is a pointer.

The reason it belongs in this cluster rather than standing alone is what
[`element_state.py:194`](../../../../backend/adk/element_state.py#L194) says out loud:

> Only ONE table's snapshot can be live at a time — every table pushes to the same `table.state`
> key, which is the stable-id problem 1.1.71 exists to fix. Until then a snapshot is matched by
> `tableId` and any *other* authored table reports EMPTY.

That single shared slot is **the same root cause as item 26** in the triage, where two students in
one group overwrite each other's table data and the tutor sees only the last write. One collision is
between tables, the other between students, and both are `mcp_app_context.table.state` being one
slot. Whatever fixes 1.1.71 should be designed knowing that decision D3 may need the same slot to
carry per-student identity.

## Goals

**Primary Goal:** a teacher can lay an activity out the way the lesson runs, rather than the way the
builder happens to order it.

**Success Metrics:**
- Elements can be reordered, and the student workspace honours the order.
- An activity can contain two tables and the tutor can tell them apart.
- Table columns can be reordered without retyping them.
- The co-pilot transcript can be read without scrolling on a normal laptop.
- A formula can be entered in a note without knowing LaTeX.

**Non-Goals:**
- Redesigning the builder. These are five additions to a surface that works.
- A full WYSIWYG rich-text editor for notes — item 11 asks for formulas, not for Word.
- Drag-and-drop *between* activities.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | No latency change. |
| 2 | EARNED TRUST | **+1** | Item 13's data-model half: two tables that silently share one snapshot would have the tutor confidently discussing the wrong data — the same defect class as item 26. |
| 3 | SKILLS, NOT FEATURES | 0 | The element palette is unchanged; this is how it is arranged. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involvement, except that the authoring co-pilot must learn the new controls (see Design). |
| 5 | GRACEFUL DEGRADATION | 0 | No new failure paths. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Ordering rides the existing element payload. |
| 7 | API FIRST | 0 | No new endpoints; ordering is a field. |
| 8 | OBSERVABLE BY DEFAULT | 0 | No new signals. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new inputs. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | No shift. |
| | **Net Score** | **+1** | Recorded honestly. Ergonomics work scores low against capability axioms; the justification is two independent teacher sources and an adoption signal, not the score. |

**Conflict Justifications:** None — no axiom scores -1.

## Design

Five independent milestones, orderable by whatever is most annoying first. **M3 (multiple
instances) must resolve the snapshot-keying question before any UI ships.**

**M1 — a resizable co-pilot (item 9).** Give `FloatingCopilot` a drag handle and persist the size,
or offer an expand-to-half-screen toggle. Sizing lives in the shared shell, so both the authoring
and class co-pilots gain it; that is correct — the same complaint applies to both.

**M2 — element order (item 12).** An `order` field on the element payload, up/down controls (drag is
nicer and much more expensive to make accessible; up/down first). The student workspace renders by
order. Watch the **full-overwrite POST** footgun: reordering must go through
`useActivityBuilder.elementPayload()` so a reorder does not wipe the elements it did not touch.

**M3 — multiple instances of a kind (item 13).** Ship [1.1.71](multi-table-activities.md) as
designed. Nothing to redesign here; the only change this feedback makes is priority — three
independent requests and a pilot behind us, so the reason for the deferral has expired. Its
id-migration is the risky part and should not ride alongside M2's `order` field in one change
window: two shape changes to the same payload, landing together, is how a bad migration becomes
unattributable.

**M4 — column reordering (item 14).** Column order is a property of the table element's `columns`
array, so this is up/down or drag on that array — with the same overwrite caution as M2, and one
extra consequence: a chart bound to a column by **position** rather than id would silently re-bind.
Check `resolveChartBinding` before shipping.

**M5 — formula input (item 11).** The cheapest useful version is not an equation editor: it is a
**live preview** beside the note field, since rendering already works — the teacher types `v_0 = 5
\,\mathrm{m/s}` and sees it set. A palette of common physics symbols is the next increment. A full
MathLive-style editor is a dependency decision, not a default.

**The authoring co-pilot must learn each control it gains.** Per the `workbench-element-builder`
skill, a builder capability the co-pilot cannot propose is half-shipped — the same dropped-coverage
bug the skill exists to prevent.

## Testing Strategy

**Frontend (Vitest)**
- Reordering elements emits a **complete** element payload (the full-overwrite regression).
- The student workspace renders elements in `order`.
- Column reorder preserves each column's id, and a bound chart still resolves to the same column.
- Two table elements produce two distinct snapshot entries (M3's load-bearing assertion).
- The co-pilot panel persists its size across a remount.

**Backend (pytest)**
- `element_state` reports two tables separately, keyed by id.
- The authoring tool contract accepts and round-trips `order`.

**Manual**
- Build the two-table activity item 13 describes (data processing + results) and confirm the tutor
  distinguishes them by name.

## Migration

- **M2/M4 are payload shape changes.** `order` must default sensibly for existing activities —
  absent `order` means current array position, so nothing shifts under a teacher who never touches it.
- **M3 is a stored-shape migration** if the snapshot keying changes. Existing single-table activities
  must keep working; the writing element's id-keyed shape is the precedent to copy, not invent.
- Rollback: M1, M4 and M5 are frontend-only. M2 and M3 need the default-order and snapshot-shape
  compatibility above to be revertable.

## Success Criteria

- [ ] A teacher reorders elements and the student sees the new order.
- [ ] An activity holds two tables; `element_state` reports both; the tutor names them separately.
- [ ] Table columns reorder without retyping, and bound charts still point at the right column.
- [ ] The co-pilot panel is resizable and remembers its size.
- [ ] A note formula can be composed with a live preview.
- [ ] Each new control is proposable by the authoring co-pilot.

## Open Questions

1. **Should 1.1.71's stable-id work anticipate decision D3?** The `table.state` single slot is the
   root cause of both item 13 and item 26. If D3 says a group's table becomes genuinely shared, the
   slot needs per-student identity as well as per-table identity, and doing both at once is cheaper
   than migrating the same key twice.
2. **Up/down buttons or drag?** Drag is what the teacher asked for ("drag and rearrange"); up/down
   is accessible by default and much cheaper. Recommendation: ship up/down, add drag if asked again.
3. **How far does item 11 go?** Live preview is hours; a real equation editor is a dependency and an
   accessibility surface. Start with preview and re-ask.

## Related Documents

- [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md) — the triage this comes from
- [activity-elements-palette.md](activity-elements-palette.md) — the element recipe and the two-surface footgun
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — the builder these extend
- [workbench-chart-readability.md](workbench-chart-readability.md) — item 5's chart half; item 12 is its layout half
- `.claude/skills/workbench-element-builder` — the co-pilot-coverage step M3 must follow
