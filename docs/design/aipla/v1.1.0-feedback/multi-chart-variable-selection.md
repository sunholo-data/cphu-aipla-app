# Multi-chart with explicit variable selection

**Status:** Design (OPEN) — **P1, pre-pilot.** Written 2026-08-06 from Aswin's 2026-08-06 trial feedback.
**Priority:** **P1** — smallest of the pre-pilot set and the one with a real experiment behind it. Aswin has a dataset where students plot several variable pairs; today they can plot exactly one, and cannot choose which.
**Estimated:** ~1d (M1 model + axis binding ~0.4d · M2 editor + preview ~0.5d · M3 co-pilot ~0.15d)
**Scope:** Fullstack, narrow — `ChartElement` gains axis fields, [`ChartEditor`](../../../../frontend/src/components/teacher/ChartEditor.tsx) becomes a list editor, `WorkbenchChart` honours explicit binding, and the authoring co-pilot's `add_element` learns the new shape.
**Dependencies:** [1.1.38 activity-elements-palette](activity-elements-palette.md) (**SHIPPED** M2 — the chart element this extends); the `workbench-element-builder` skill (the co-pilot-proposability rule M3 satisfies); [workbench-element-awareness](workbench-element-awareness.md) (1.1.62 — the chart describer must name the axes this adds)
**Source:** Aswin, 2026-08-06 — *"I think option to add more than one chart would be great. Because in the experiment dataset, students can draw multiple graphs with different variables."* M's reply: *"Cool can add."*
**Created:** 2026-08-06 (M)
**Last Updated:** 2026-08-06 (M)

## Problem Statement

**The backend already supports five charts. The authoring UI allows one, and neither allows choosing the variables.**

Three layers disagree:

| Layer | State |
|---|---|
| Model | `ELEMENT_REGISTRY["chart"]` has `max_items=5` ([activity_config.py:412](../../../../backend/db/models/activity_config.py#L412)) |
| Renderer | `WorkbenchChart` takes `charts={ctx.chart}` — **already an array** ([elementRenderers.tsx:86](../../../../frontend/src/components/workspace/elementRenderers.tsx#L86)) |
| Editor | `ChartEditor` is a hardcoded singleton — *"Single chart for v1.1; `null` means no chart"* ([ChartEditor.tsx:27-30](../../../../frontend/src/components/teacher/ChartEditor.tsx#L27)) |

So "more than one chart" is mostly an editor change. But that alone does not
give Aswin what he asked for, because of the second half:

```python
class ChartElement(BaseModel):
    """v1.1 auto-binds to the activity's data table and plots its first two
    numeric columns (x, y) — deterministic, zero LLM. Per-column selection and
    teacher-supplied static series are future extensions; keeping it auto-bound
    avoids fragile column-id coupling between the chart and table at author time."""
    id: str
    title: str
    chart_kind: ChartKind
```

A chart has **no axis fields**. It plots columns 1 and 2 of the table. Five
charts of the same two columns differing only in `chart_kind` is not "multiple
graphs with different variables" — it is the same graph drawn five ways. Aswin's
ask is the axis selection, and the multiplicity is what makes it useful.

The original decision was sound at the time: auto-binding avoided coupling a
chart to column ids that a teacher might rename mid-authoring, and one chart
needed no disambiguation. The ask is exactly the "future extension" that comment
anticipated.

## Goals

**Primary:** A teacher can add several charts to an activity and choose which
table columns each one plots.

**Success metrics:**

- Up to 5 charts per activity, each with independently chosen x and y columns.
- Existing single-chart activities render **identically** with no edit and no backfill.
- Renaming or deleting a table column degrades a bound chart gracefully — no crash, no silent wrong plot.
- The authoring co-pilot can propose a chart with axes named.

**Non-goals:**

- Multi-series charts (two y columns on one axis). Additive later; not asked for.
- Teacher-supplied static reference series (e.g. a theoretical curve). Real, separate.
- Cross-table charts. Charts stay bound to one table.
- Computed axes / derived columns. That is calculator territory.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Client-side plotting of data already in the DOM. Five charts is a bounded render. |
| 2 | EARNED TRUST | +1 | A chart states the variables it plots. Today it silently picks columns 1 and 2, so a student reading a chart cannot be sure what it shows. |
| 3 | SKILLS, NOT FEATURES | 0 | Element-layer authoring. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Zero LLM. Axis binding is an id lookup; the deterministic character of the original design is preserved. |
| 5 | GRACEFUL DEGRADATION | +1 | Unset axes fall back to the shipped auto-bind, so every existing chart keeps working. A dangling column id falls back rather than erroring — see below. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Internal element schema. |
| 7 | API FIRST | +1 | Rides the existing activity POST/PATCH; CLI parity from the same contract. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Existing instrumentation. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new data access; caps enforced by the existing element-cap validator. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Binding is config; resolution is client-side rendering, which is where it belongs. |
| 11 | USABLE BY DESIGN | +1 | Directly asked for by the teacher running the experiment this serves. |
| | **Net Score** | **+5** | Threshold: >= +4 |

## Framework-Native Capability Check

- **No new store, no new endpoint.** Charts are already a list field on
  `ActivityConfig` with a cap enforced by the shipped element-cap validator.
- **The renderer already accepts an array** — no new mount, no new surface.
- **`useActivityBuilder.elementPayload()` already serialises the chart array.**
  It must keep sending the **complete** array (memory
  `reference-activity-config-full-overwrite`): a partial chart payload wipes the
  others. The existing `useActivityBuilder.test.ts` guard covers this and gains
  a multi-chart case.

## Design

### Data Model Changes

```python
class ChartElement(BaseModel):
    """A chart plotting columns of the activity's data table (1.1.38 M2, extended 1.1.64).

    ``table_id`` / ``x_column`` / ``y_column`` are optional. When unset the chart
    auto-binds to the first table's first two numeric columns — the shipped v1.1
    behaviour — so every existing chart renders unchanged with no backfill.
    """

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=120)
    chart_kind: ChartKind = Field(default="scatter", alias="chartKind")
    table_id: str | None = Field(default=None, alias="tableId", max_length=64)
    x_column: str | None = Field(default=None, alias="xColumn", max_length=64)
    y_column: str | None = Field(default=None, alias="yColumn", max_length=64)
```

**Optional, not required.** Making them required would force a migration over
every existing activity for a pre-pilot change — the wrong trade a week before
students arrive. Unset means "behave as before".

### Resolution and degradation

Binding is resolved at render, in one helper, with a defined fallback ladder:

1. `table_id` names a table and `x_column` / `y_column` name columns on it → plot those.
2. Any referenced id is missing (column renamed or deleted) → **fall back to
   auto-bind** and render a visible note on the chart: *"Column no longer exists —
   showing the first two numeric columns."*
3. No table on the activity → today's empty state.

Case 2 is the risk the original comment named ("fragile column-id coupling").
The mitigation is that a dangling reference is **visible and non-fatal**: it
neither crashes nor silently plots the wrong variables. Silently plotting the
wrong variables is the only genuinely bad outcome here, and the fallback note is
what rules it out.

The `TableEditor` additionally warns when deleting a column a chart references —
prevention alongside the graceful fallback.

### Frontend Changes

`ChartEditor` becomes a list editor matching the shipped `TableEditor` /
`CalculatorEditor` idiom (add / remove / reorder, capped at 5, cap surfaced as a
disabled Add button with a reason rather than a silent no-op):

```
Charts (2 of 5)
┌──────────────────────────────────────────────┐
│ Hastighed mod tid          [scatter ▾]   [×] │
│   Table:  Faldforsøg ▾                        │
│   X:      tid (s) ▾        Y: hastighed (m/s) ▾│
├──────────────────────────────────────────────┤
│ Højde mod tid              [line ▾]      [×] │
│   Table:  Faldforsøg ▾                        │
│   X:      tid (s) ▾        Y: højde (m) ▾     │
└──────────────────────────────────────────────┘
                                    [+ Add chart]
```

Column dropdowns are populated from the selected table's `columns` and offer
**numeric columns only** for both axes (`TableColumn.kind == "number"`) — a text
column on an axis is not a plot. When the activity has no table, the editor
keeps today's hint rather than showing empty dropdowns.

`WorkbenchChart` maps over charts, resolving each independently, and labels axes
with the column `label` + `unit` — which the current auto-bound chart does not do
reliably, and which matters for a physics activity.

`ActivityPreview` renders all charts, so the teacher sees the arrangement before
students do.

### Co-pilot

`add_element` for `kind="chart"` accepts `tableId` / `xColumn` / `yColumn` and
the authoring skill's element documentation gains the axis vocabulary — so
*"add a graph of velocity against time"* becomes proposable. Per the
`workbench-element-builder` rule, an element the co-pilot cannot propose is a
half-shipped element; this is the third surface, not an optional extra.

### 1.1.62 interaction

[Workbench element awareness](workbench-element-awareness.md) adds a chart
describer to the tutor's element manifest. It must name the axes:

> *Chart "Hastighed mod tid" (scatter) — plots tid (s) against hastighed (m/s) from the data table "Faldforsøg".*

Without that, the tutor can invite a student to "use the chart" but not to
compare the two graphs — which is the pedagogical point of having several.

### CLI Surface

`aiplatform activity add-chart <activity-id> --table <id> --x <col> --y <col>
[--kind scatter|line|bar]` — parity with the existing `activity` command family,
and the fastest way to build Aswin's multi-graph activity for a smoke test
without clicking. ~0.15d.

## Implementation Plan

### M1 — Model + resolution (~0.4d)
- Axis fields on `ChartElement`; route validation (referenced table exists when set)
- Shared `resolveChartBinding()` helper with the three-step fallback ladder
- pytest for validation + the cap; vitest for the resolver

### M2 — Editor, renderer, preview (~0.5d)
- `ChartEditor` → list editor, capped, numeric-column dropdowns
- `WorkbenchChart` per-chart resolution + axis labels with units
- `TableEditor` warns on deleting a referenced column
- `ActivityPreview` renders all charts

### M3 — Co-pilot + CLI + manifest (~0.15d)
- `add_element` axis params + skill element docs
- `aiplatform activity add-chart`
- Chart describer names axes (lands with 1.1.62 M1)

## Migration & Rollout

**No migration.** New fields optional; unset = shipped behaviour. No backfill,
no flag — the change is additive and the fallback ladder means the worst case is
today's behaviour.

## Testing Strategy

### Backend (pytest)
- Chart with valid axis ids validates; 6 charts rejected by the element-cap validator
- Chart referencing a non-existent `table_id` is rejected **at write time**
  (the write path is where we can still tell the teacher)
- A chart whose `x_column` no longer exists still *loads* (degradation is a read
  concern — a column deleted after the chart was saved must not brick the activity)

### Frontend (Vitest + RTL)
- `resolveChartBinding` — all three ladder steps
- `ChartEditor` add/remove; Add disabled with a reason at 5; only numeric columns offered
- `WorkbenchChart` renders two charts with different axes; dangling column shows the note
- **`useActivityBuilder.elementPayload()` round-trips the full chart array** —
  the full-overwrite wipe guard, extended to multi-chart

### Manual (aitana-frontend-verify)
Rebuild Aswin's activity: one table, two charts on different variable pairs.
Fill the table as a student; both charts update. Delete a referenced column;
the note appears and nothing crashes.

## Security Considerations

None new. Axis ids are opaque strings validated against the activity's own
table, rendered as chart labels — escape them like any teacher-authored text.
Caps are enforced by the shipped element-cap validator, so this adds no new
unbounded field.

## Success Criteria

- [ ] Up to 5 charts per activity, each with independent x/y columns
- [ ] Only numeric columns offered as axes
- [ ] Existing single-chart activities render identically, no backfill
- [ ] Deleting a referenced column shows the fallback note; no crash
- [ ] `TableEditor` warns before deleting a referenced column
- [ ] Axis labels carry units
- [ ] Co-pilot can propose a chart with named axes
- [ ] `aiplatform activity add-chart` works end-to-end
- [ ] `elementPayload()` multi-chart round-trip test passes

## Open Questions

1. **Is 5 the right cap?** Inherited from the registry, never examined. Aswin's
   dataset suggests 2–3 typical. Keep 5 unless he says otherwise.
2. **Should a chart be able to bind a text column on x** (categorical bar chart)?
   Defensible for a bar chart. Excluded for now — narrows the change and avoids a
   per-`chart_kind` validation matrix. Revisit if asked.
3. **Multi-series** (two y columns, one chart) is the natural next ask once
   teachers have several charts. Deliberately out of scope; the axis fields
   generalise to a `series: list[...]` without a breaking change.

## Related Documents

- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38, the parent
- [workbench-element-awareness.md](workbench-element-awareness.md) — 1.1.62, the chart describer
- [offline-lab-workbench.md](offline-lab-workbench.md) — 1.1.24, ground-truth checking of table values
- `.claude/skills/workbench-element-builder/SKILL.md` — the three-surface rule
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's raw feedback
