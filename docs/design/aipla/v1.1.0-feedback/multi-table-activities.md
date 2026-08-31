# Several data tables per activity

**Status:** Design (OPEN) — **P1.** Written 2026-08-10 from Aswin's 2026-08-10 feedback.
**Update 2026-08-31 — the KEY half is DONE, and the deferral premise was wrong.** This doc was
deferred during pilot week for "id-migration risk", and [1.1.88](group-shared-table.md) was told to
land the key change jointly to avoid migrating twice. On inspection there was no migration to do:
`mcp_app_context.table.state` is ADK **session state** (`append_event(state_delta)`), ephemeral and
overwritten on every push — it never held the `${table}::${row}::${col}` cell keys, which are the
client's own value map and are unchanged. 1.1.88 M2 changed the payload to `{"tables": [...]}` (the
calculator/writing shape) with the reader accepting both, in under an hour. **Two tables now report
separately to the tutor.** What remains here is the BUILDER half — several table elements per
activity, chart→table binding, co-pilot coverage — which is real work but carries none of the risk
this was deferred for.
**Priority:** **P1** — a real physics-lab shape ("sometimes we need multiple tables"), and the last singleton in the element builder. Not pilot-blocking: one table plus several charts covers most activities.
**Estimated:** ~1–1.5d (M1 builder list + conversion ~0.6d · M2 chart→table binding becomes real ~0.4d · M3 co-pilot + CLI ~0.25d)
**Scope:** Frontend-heavy — `TableEditor` becomes a list editor and `useActivityBuilder.table` becomes an array; `tableDefs` mints stable ids; `ChartEditor`'s hardcoded `TABLE_ID` becomes a picker. Backend already allows five.
**Dependencies:** [1.1.38 activity-elements-palette](activity-elements-palette.md) (**SHIPPED** M1 — the table element); [1.1.64 multi-chart-variable-selection](multi-chart-variable-selection.md) (**SHIPPED** — `ChartElement.tableId` exists and is currently always `"table-1"`; this is what makes it mean something); [tutor-sees-element-state](tutor-sees-element-state.md) (1.1.69 — fill-state must count per table)
**Source:** Aswin, 2026-08-10 — *"We can add options to put more tables. I now realized sometimes we need multiple tables in physics lab."*
**Created:** 2026-08-10 (M)
**Last Updated:** 2026-08-10 (M)

## Problem Statement

**Same shape as the chart singleton, one layer down — and 1.1.64 already paid part of the price.**

| Layer | State |
|---|---|
| Model | `ELEMENT_REGISTRY["table"].max_items` is **5** |
| Renderer | `WorkbenchTable` takes `tables={ctx.table}` — **already an array** |
| Resolver | `resolveChartBinding(chart, tables)` — **already takes a list** and looks up by `tableId` |
| Builder | `useActivityBuilder.table` is `TableEditorValue \| null` — **the singleton** |

So, as with charts, the backend and the render path are ready and the *authoring*
layer is the constraint.

**1.1.64 left a marker for this.** `ChartEditor` carries:

```ts
/** The builder authors ONE table, minted as `table-1` by `tableDefs`. */
const TABLE_ID = "table-1";
```

Every chart is bound to a constant. `ChartElement.tableId` was shipped as a real
field precisely so this doc could make it meaningful, and until then the
chart→table half of the binding is decorative.

### The id-minting problem, now twice as sharp

`tableDefs` mints ids **positionally**: `table-1`, and columns `col-{n}` over the
label-bearing columns. 1.1.64 found that deleting a column shifts every later id
and can silently re-point a chart at a different variable, and closed it with a
label-based reconcile in `setTable`.

With several tables the same hazard appears one level up: **deleting the first
table renames the second from `table-2` to `table-1`**, so every chart bound to
the old `table-1` now silently plots a different table's data. The existing
reconcile is column-level and will not catch it.

This is the second time positional minting has produced a silent-wrong-data bug.
**The reconcile approach does not scale to a second axis of shifting** — see the
core decision below.

## Goals

**Primary:** A teacher can author several data tables, and charts can say which one they plot.

**Success metrics:**

- Up to 5 tables, each with its own columns and row count.
- Existing single-table activities load, render and save **unchanged**.
- Deleting or reordering a table never silently re-points a chart.
- The tutor's manifest and fill-state name each table distinctly.

**Non-goals:**

- Cross-table charts (a series from two tables). Still out.
- Per-table student permissions or staged reveal.
- Computed columns.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Client-side; five tables is a bounded render. |
| 2 | EARNED TRUST | +1 | A chart names the table it plots. Today it silently plots the only one, which happens to be right for the wrong reason. |
| 3 | SKILLS, NOT FEATURES | 0 | Element-layer authoring. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Zero LLM. |
| 5 | GRACEFUL DEGRADATION | +1 | A chart whose table is gone falls back to the first table **with the visible note** the 1.1.64 ladder already renders. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses `resolveChartBinding`, which was written for a list from the start. |
| 7 | API FIRST | +1 | Rides the existing activity contract; the cap is already enforced. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Existing instrumentation. |
| 9 | SECURE BY CONSTRUCTION | +1 | Stable ids (below) remove a class of silent mis-binding, rather than adding a guard against it. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Authoring is client-side; resolution stays shared. |
| 11 | USABLE BY DESIGN | +1 | Asked for by the teacher running the lab this serves. |
| | **Net Score** | **+7** | Threshold: >= +4 |

## Design

### The core decision: stop minting ids positionally

1.1.64 patched the symptom with a label-based reconcile. Adding a second
shifting axis (tables as well as columns) means either a second reconcile or a
combinatorial one. The cheaper and more honest fix is to remove the cause:
**mint stable ids at creation and never recompute them.**

The builder's `TableEditorColumn` already carries a stable `key`; tables get the
same. `tableDefs` then emits `table-{key}` / `col-{key}` instead of
`table-{index+1}` / `col-{index+1}`, and deleting anything renames nothing.

**The migration risk is real and must be handled, not assumed away.** Student
data is keyed `${table.id}::${row}::${col.id}` in session storage, and saved
charts hold `col-N` strings. Changing minting without care orphans in-flight
student work and every existing chart binding.

Proposed, in order of preference:

1. **Preserve existing ids on load.** Hydrating an activity keeps whatever ids
   were saved and assigns keys to match; only *newly added* tables/columns get
   key-based ids. Existing activities never re-mint, so nothing orphans. New
   authoring is stable from birth.
2. Re-mint with a one-off migration over saved activities. More code, and a
   backfill on live data — worse a week from a pilot.

**(1) is the recommendation**, and it makes the 1.1.64 reconcile redundant for
anything authored afterwards while leaving it as a safety net for what came
before.

### M1 — Builder holds a list

`table: TableEditorValue[]`, `TableEditor` becomes a list editor matching the
shipped `ChartEditor` idiom (add / remove, capped at 5, Add disabled **with a
reason** at the cap). The same care 1.1.64 needed applies: `hydrate` must read
**every** table, not `[0]`, or the next save silently drops the rest — the
full-overwrite footgun, which has now bitten `subject`, `language` and charts.

### M2 — Chart→table binding becomes real

Delete `const TABLE_ID = "table-1"`. `ChartEditor` gains a table picker (shown
only when the activity has more than one table — one table should not grow a
dropdown for it), and the axis pickers offer **that** table's numeric columns.
`resolveChartBinding` already handles the rest, including the dangling-table
fallback and its note.

### M3 — Co-pilot, CLI, manifest

`add_element(element_kind="table")` can already be called repeatedly; it must
**append** rather than replace (the fix 1.1.64 M3 made for charts). The element
manifest and the 1.1.69 fill-state block must name tables distinctly — *"Data
table 'Faldforsøg': EMPTY"* is useless when there are three.

## Implementation Plan

- **M1** builder list + preserve-ids-on-load + hydrate-all (~0.6d)
- **M2** table picker, `TABLE_ID` deleted (~0.4d)
- **M3** co-pilot append, CLI, distinct manifest naming (~0.25d)

## Testing Strategy

- **Frontend:** hydrate reads every table; `elementPayload()` round-trips all of
  them (the wipe guard, extended); loading an existing activity **preserves its
  saved ids**; deleting the first of three tables leaves the others' ids
  unchanged and charts still bound to the same data; the cap disables Add with a
  reason; a chart whose table was deleted renders the fallback note.
- **The regression test:** two tables, a chart bound to the second; delete the
  first; assert the chart still plots the same table. Under positional minting
  this fails — which is the point.
- **Backend:** 6 tables rejected by the element-cap validator; a chart
  referencing an unknown `tableId` still rejected at write time.

## Success Criteria

- [ ] Up to 5 tables per activity, each independently authored
- [ ] Charts pick which table they plot; picker hidden when there is only one
- [ ] Deleting a table never re-points another chart's data
- [ ] Existing activities load with their saved ids preserved and save unchanged
- [ ] `elementPayload()` round-trips every table
- [ ] Manifest and fill-state name each table distinctly
- [ ] `TABLE_ID` constant is gone

## Open Questions

1. **Does preserve-ids-on-load interact badly with the 1.1.64 column reconcile?**
   The reconcile clears bindings whose column label changed. With stable ids it
   should become unnecessary for new activities but must not start clearing
   valid bindings. Verify both paths coexist before deleting anything.
2. **Should a chart default to the table nearest it in the builder** rather than
   the first? Probably; cosmetic, decide during M2.
3. **Row-count per table** is already per-`TableElement`, so nothing to do — but
   worth confirming the student surface renders several tables legibly before
   assuming five is usable.

## Related Documents

- [multi-chart-variable-selection.md](multi-chart-variable-selection.md) — 1.1.64, the same shape one layer up; `tableId` and the positional-id hazard both come from there
- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38, the table element
- [tutor-sees-element-state.md](tutor-sees-element-state.md) — 1.1.69, fill-state per table
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's feedback
