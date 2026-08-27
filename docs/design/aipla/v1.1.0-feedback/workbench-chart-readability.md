# Workbench chart readability — a plot you can read a number off

**Status**: Planned — **1.1.84**
**Priority**: **P1** — the most-repeated complaint in the 2026-08-21 teacher feedback: four of 28 items (4, 5, 6, 7), from at least two independent teachers
**Estimated**: ~1.5d for M1+M2 · M3 (regression) ~1–1.5d and gated on decision D2
**Scope**: Frontend — [`WorkbenchChart.tsx`](../../../../frontend/src/components/workspace/WorkbenchChart.tsx), [`resolveChartBinding.ts`](../../../../frontend/src/lib/resolveChartBinding.ts), and the workspace panel that hosts them
**Dependencies**: none. `axisLabel()` (units on labels, 1.1.64 + 1db461f) already supplies the label text this builds on
**Created**: 2026-08-27
**Source**: [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md), items 4, 5, 6, 7

## Problem Statement

`WorkbenchChart` renders a hand-rolled 186-line SVG. It draws two axis lines, an x label and a
rotated y label, and then the data. It draws **no tick marks, no tick numbers and no gridlines** —
there is not one occurrence of `tick` in the drawing code. The domain is `[min(data), max(data)]`
with a fixed `300 × 200` viewBox and 36px of left padding.

The teachers said so four times:

> We miss numbers and divisions on the axes. *(item 4)*

> We miss axis division in the point plot that appears when entering data (looking at the
> oscillation time activity). *(item 7)*

> We wish the starting point was visible in the window from the beginning; we have to scroll to see
> the graph. The graph could comfortably fill the window (zoom). *(item 5)*

> It would be great if regression could be performed on data points in a graph (linear,
> exponential, power, logistic). Additionally, it would be cool to read peak points and other graph
> metrics. *(item 6)*

Items 4 and 7 are the same defect reported from two different activities, which is the strongest
signal in the whole feedback set.

**Why this matters more than its size.** The 1db461f commit made the argument already, for labels:
a plot with a bare "tid" axis models bad practice at the moment a student is learning the habit.
An axis with no numbers is worse — it does not merely model bad practice, it makes the core
activity of a Physics C data lesson (read a gradient, find a value, judge whether the fit is
straight) **impossible**. The student can see a shape and nothing else.

## Goals

**Primary Goal:** a student can read a quantity off any workbench plot without leaving the page.

**Success Metrics:**
- Every plot renders labelled tick numbers on both axes, at human-readable intervals.
- A plot's data fills its plotting area; no scrolling is needed to see the whole plot at its default size.
- (M3, if D2 says yes) A student can fit a line to their points and see its parameters with units.

**Non-Goals:**
- A general charting library. The SVG is 186 lines, has no dependencies, is theme-aware and
  server-renders; replacing it with Recharts to get ticks would be a large regression in weight for
  a feature we can add in ~60 lines.
- Pan/zoom interaction. Item 5 asks for the plot to *fit*, not for a zoomable canvas.
- Log axes, error bars, multi-series. Not asked for; revisit when they are.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Pure client-side render; tick computation is O(n) over ~5 ticks. |
| 2 | EARNED TRUST | **+1** | A plot you cannot read a number off invites the student to take the tutor's word for the number. Ticks let them check it. |
| 3 | SKILLS, NOT FEATURES | 0 | No change to the skill abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involvement. |
| 5 | GRACEFUL DEGRADATION | **+1** | Degenerate data (one point, all-equal values, NaN) currently produces a silently meaningless axis; the tick algorithm must state a domain even then. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Extends the existing SVG; introduces nothing new on the wire. |
| 7 | API FIRST | 0 | No new endpoints. |
| 8 | OBSERVABLE BY DEFAULT | 0 | No new signals. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new inputs. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Rendering concern, correctly client-side. |
| | **Net Score** | **+2** | Below the usual +4 threshold — recorded honestly. This is a **defect-shaped** item: it fixes something that does not work rather than adding capability, and the axioms score capability. The four-item teacher signal is the justification, not the score. |

**Conflict Justifications:** None — no axiom scores -1.

## Design

### M1 — ticks, numbers, gridlines, and a domain a human would choose

A `niceTicks(min, max, target = 5)` helper in `resolveChartBinding.ts` (pure, unit-testable,
no component involvement): expand `[min, max]` outward to a "nice" interval whose step is
1, 2, 2.5 or 5 × 10ⁿ, and return the tick values. This is the standard extended-Wilkinson shape
and is ~30 lines.

The component then draws, per axis: a short tick mark, the tick value formatted to the data's
significant figures, and a faint gridline (`stroke-border/40`). Danish decimal formatting — the
tutors are already instructed to use `,` not `.` for decimals, and an axis reading `0.25` beside a
tutor writing `0,25` is the same inconsistency item 18 objects to. Use `Intl.NumberFormat` with
the workspace locale rather than hand-rolling it.

The domain changes from `[min(data), max(data)]` to the nice interval. This subsumes half of item 5:
"the starting point is not in the window" is largely that a dataset from 2.1 to 9.8 currently starts
the axis at 2.1, so the origin — the thing a physics student is looking for — is off the plot. A
nice domain that includes 0 when the data is close to it is what the teacher is describing.

Padding must grow with the tick labels: `PAD_L = 36` was chosen for a rotated label alone and will
clip a y tick reading `1200`. Measure from the formatted tick strings.

### M2 — the plot fills its space

`viewBox="0 0 300 200"` with `className="w-full"` scales the whole drawing, including text, to the
container width — so on a wide panel the tick numbers become large and blurry, and on a narrow one
unreadable. Give the SVG an explicit aspect ratio and a `preserveAspectRatio`, or measure the
container and render at its true size. The second half of item 5 ("we have to scroll to see the
graph") is a **panel layout** question, not a chart one: it is the same complaint as item 12
(element ordering) — the chart sits below the table and is below the fold. Resolve the chart's own
sizing here and let [activity-builder-ergonomics](activity-builder-ergonomics.md) M2 own the order.

### M3 — regression and readout (gated on decision D2)

Not started until D2 lands. When it does: linear first (`y = ax + b` with R², parameters shown
**with units** taken from the same `axisLabel` source), then exponential/power via log-transformed
least squares, then logistic — which needs iterative fitting and is the one to question, since a
Physics C syllabus rarely calls for it. Peak/intercept readout is a separate, smaller ask than
regression and is worth splitting from it.

The parameters must be **labelled with units** — a gradient reported as `0.2` when it is 0.2 m/s
reintroduces exactly the defect item 18 raised.

## Testing Strategy

**Frontend (Vitest)**
- `niceTicks` over: ordinary ranges; a single data point; all-equal values; negative ranges; ranges
  spanning zero; very large and very small magnitudes. Each asserts a finite, ordered, non-empty
  tick list — the degenerate cases are where a hand-rolled scale goes wrong silently.
- `WorkbenchChart` renders a `<text>` per tick and the count matches `niceTicks`.
- Tick labels use `,` as the decimal separator under the Danish locale.
- Left padding grows for a wide y tick label (render with a 4-digit domain, assert no clipping).
- Existing chart tests continue to pass unchanged.

**Manual, on deployed dev**
- The oscillation-time activity named in item 7, since that is where the teacher saw it.

## Migration

None. No stored shape changes, no API changes. `WorkbenchChart` is read-only over data the table
element already owns, so a bad tick render can never corrupt student data — the whole change is
recoverable by revert.

## Success Criteria

- [ ] Both axes carry tick marks and numbers on every chart kind (line, bar, scatter).
- [ ] Tick numbers use Danish decimal notation.
- [ ] A dataset that does not include the origin still shows a domain a physics teacher would accept.
- [ ] No tick label is clipped at any panel width tested (narrow phone through wide desktop).
- [ ] The teacher who reported items 4 and 7 confirms on the oscillation-time activity.
- [ ] (M3) A fitted line reports its parameters with units.

## Open Questions

1. **Does item 5's "scroll to see the graph" survive M1+M2?** If the complaint is really element
   order, it is item 12's, and this doc should say so rather than quietly claim the fix. Verify with
   the teacher before closing item 5.
2. **Is the bar chart's `yMin = min(0, …)` behaviour right for the others?** Anchoring a scatter at
   zero is sometimes wrong (a temperature series in °C); anchoring it *never* is wrong for a
   proportionality check, which is most of Physics C. Possibly an authoring-time choice.
3. **Logistic regression — does any Physics C activity need it?** Asked for by name, but it is the
   only one of the four needing an iterative fit. Worth confirming with JB before building it.

## Related Documents

- [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md) — the triage this comes from
- [activity-builder-ergonomics.md](activity-builder-ergonomics.md) — owns element ordering, item 5's other half
- [activity-elements-palette.md](activity-elements-palette.md) — the element recipe
