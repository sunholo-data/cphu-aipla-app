# LED Planck UX rework — full workbench split + design pass

**Status**: Planned (Step-0 design done; execution ready)
**Priority**: P1 (demo usability; first end-to-end run of the Axiom-11 "design UX upfront" process)
**Estimated**: ~1.5 days
**Branch**: `fix/led-planck-ux-rework` off dev; FF-merge at the end
**Pairs with**: [Axiom 11 USABLE BY DESIGN](../../product-axioms.md),
[`.claude/skills/mcp-app-artefact/SKILL.md`](../../../.claude/skills/mcp-app-artefact/SKILL.md) (one-sim-per-iframe + shared snapshot hook),
[`implemented/kinebot-migration.md`](implemented/kinebot-migration.md) (the reference split)
**Created**: 2026-05-28

## Scope decision (2026-05-28)

Started toward a full KineBot-style split, but on reading the code the
analysis is woven into the bench's `update()` loop (`update → updateTable
→ drawIU`; `drawSpec` both collects *and* renders; `fitLine` reads the
local dataset) — a full split means rewriting the working sim's core
loop (high risk before a demo). **Landed on the middle path:** move the
pure-data surfaces (**Measurement table** + **Results / h-calc**) to
React; keep the **bench + I-U Graph + Spectrum** in the iframe (they're
tied to the live loop / fiber position). Then a `frontend-design`
polish pass on everything. The split table below is annotated for this.

## Why

LED Planck still ships the monolithic source lab: the bench **plus** the
Measure / Graph / Spectrum / Results tabs all inside the iframe. The
1.C "integration follow-up" only made it *fit* ~700px; it never split.
On a small screen it cramps and labels overlap. Per Axiom 11 and the
one-sim-per-iframe rule (learned the hard way on KineBot 1.D), the fix
is the same: **iframe = the bench (one apparatus); all analysis +
records → the React workbench.**

This is the first port done with the new "design the UX before the UI"
discipline — Step 0 below is written before any code.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | No latency-path change |
| 2 | EARNED TRUST | 0 | — |
| 3 | SKILLS, NOT FEATURES | 0 | Same skill |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses the spec path + the shared-snapshot-hook pattern from KineBot; no new wire formats |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Analysis logic moves to React but stays client-render of emitted data; no business logic added |
| 11 | USABLE BY DESIGN | +1 | The point: removes the cramped multi-role iframe, fixes overlap/alignment, gives a clear journey + states; designed upfront (this doc) not patched after |
| | **Net Score** | **+3** | (others 0) Threshold met for a focused UX fix; no -1s |

## Step 0 — UX design (BEFORE code)

### Student journey
1. **Land** → workbench: "what is this experiment" + the 4-step progress
   (Kredsløb → I-U-måling → Spektroskopi → Rapport) + "Åbn laboratorium"
   button. Tutor greets first (proactiveGreet already on).
2. **Open lab** (iframe) → wire the circuit (or Auto-build), drop an LED,
   turn the knob until it glows.
3. **Take readings** → each reading appears in the **Measurement table**
   (workbench). The student watches the table fill.
4. **I-U graph** (workbench) → plot the points, fit the upper line → U₀.
5. **Spectrum** (workbench) → the measured λ for the current LED.
6. **Results** (workbench) → U₀ + λ → h; table + average vs accepted.

### Every state (no voids)
- **Empty:** measurement table → "Ingen målinger endnu — åbn laboratoriet
  og tryk Take reading." Graph → "Saml målinger først." Spectrum →
  "Ingen spektrum endnu." Results → "Gem et resultat."
- **Loading:** none needed (all client-side from emitted data).
- **Error:** circuit-incomplete / reversed-LED messages already exist in
  the bench; surface them there.

### Narrowest viewport (~700px and resizable)
The bench fills the iframe (full-height, responsive — already done in
1.C). The workbench is a single scrolling column of cards (table, graph,
spectrum, results, progress, formula) — each card is full-width, no
side-by-side cramming. Mobile-portrait: same column, scrolls.

### The split
| Source surface | Disposition | Why |
|---|---|---|
| Bench (PSU, LED holder, resistor, ammeter, voltmeter, breadboard, spectrometer, fiber, knob, wiring, parts shelf, live instrument readouts) | **iframe** | The one live apparatus |
| Bench actions: Take reading, Collect automatic run, Calibrate probes, Collect spectrum | **iframe** (emit results) | They sample the live apparatus; keep them on the bench, emit the data |
| Measure tab (table of I-U points) | **React** | Pure record of emitted readings |
| Graph tab (I-U canvas + Fit → U₀) | **React** canvas | Plots emitted points; Fit is pure math (port `fitLine`) |
| Spectrum tab (spectrum canvas + λ) | **React** | Renders the emitted λ/peak |
| Results tab (U₀+λ → h, table, average) | **React** | Pure computation on collected values |

### Motivation hooks
Step progress advancing as they work; the measurement table filling;
the "average h vs accepted (% error)" payoff in Results; the tutor
reacting to their measurements.

## Event vocabulary (iframe → host)

Keep: `step-change` is **removed from the iframe** — the hook now derives
`currentStep` from accumulated state (circuit-correct + has-readings +
has-fit + has-spectrum + has-result). Keep `component-placed`,
`led-polarity-error`, `state-change` (voltage commit-on-submit).

New raw-data events the bench emits:
- `led-planck.reading` `{led, I, U, Vs}` — one Take-reading
- `led-planck.auto-run` `{led, points:[{I,U,Vs}…]}` — a full sweep
- `led-planck.calibrated` `{}` — probes calibrated
- `led-planck.spectrum` `{led, lambda, peak}` — a collected spectrum
- `led-planck.circuit` `{correct:boolean}` — circuit completeness (so the
  hook can derive step 1→2)

React-originated events (via `reportEvent`):
- `led-planck.fit` `{led, u0}` — student fit the graph in React
- `led-planck.measurement` `{data:{led,u0,lambda,h_computed}}` — saved a result (kept)

## Files

- `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` — strip the 4 tabs + the iuCanvas/specCanvas + the analysis JS; bench-only; emit raw data
- `frontend/src/hooks/useLedPlanckSnapshot.ts` — NEW shared hook (mirrors useKineBotSnapshot)
- `frontend/src/components/workspace/LedPlanckMeasureTable.tsx` — NEW
- `frontend/src/components/workspace/LedPlanckIUGraph.tsx` — NEW (canvas + fit)
- `frontend/src/components/workspace/LedPlanckSpectrum.tsx` — NEW
- `frontend/src/components/workspace/LedPlanckResults.tsx` — NEW
- `frontend/src/components/workspace/LedPlanckLabFrame.tsx` — slim to bench-only + reportEvent
- `frontend/src/components/workspace/LedPlanckWorkbench.tsx` — rework: lesson + progress + the 4 React surfaces + notes
- `frontend/src/app/chat/[...path]/page.tsx` — hook + prop wiring

## Phases

- **Phase A (M1–M5):** the structural split + tests.
- **Phase B:** `frontend-design` skill pass — aesthetic direction +
  alignment/spacing/type scale on the React surfaces and a responsive
  pass on the bench. Run the pre-ship usability gate.

## Acceptance gates

1. iframe contains the bench only — no Measure/Graph/Spectrum/Results tabs, no iuCanvas/specCanvas. ADR-013 clean, <200 KB.
2. Fits 700px + mobile-portrait with no overlap/clipping (the original complaint).
3. Every React surface has a designed empty state — no voids.
4. Take-reading → row appears in the React table; auto-run → dataset fills; Fit → U₀ in React; Collect-spectrum → λ in React; Save → h in Results + average.
5. Step progress advances correctly (derived in the hook).
6. Agent still sees the state (iframe-context POST, serverId led-planck) — observability unchanged; backend observability test still green.
7. Boldkast + KineBot unaffected.
8. Pre-ship usability gate (skill) passes; frontend-design polish applied.

## Risk / rollback
Single feature branch, FF-merge at end. Bench sim behaviour must not be
touched during the strip (only the tab/analysis panels + their JS go).
Rollback = revert.
