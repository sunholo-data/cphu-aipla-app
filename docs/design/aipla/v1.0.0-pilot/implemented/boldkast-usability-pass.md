# Boldkast usability pass — journey framing + React state mirror

**Status**: Planned (Step-0 design done; execution ready)
**Priority**: P2 (the v0.1 demo sim never got the usability-first treatment the later two sims did)
**Branch**: `fix/boldkast-usability` off dev; FF-merge at the end
**Pairs with**: [Axiom 11 USABLE BY DESIGN](../../product-axioms.md),
[`.claude/skills/mcp-app-artefact/SKILL.md`](../../../.claude/skills/mcp-app-artefact/SKILL.md) (Step-0 + shared snapshot hook),
[`led-planck-ux-rework.md`](led-planck-ux-rework.md) (the reference pattern)
**Created**: 2026-05-28

## Why

Boldkast (the `problem-set-hints` sim) shipped as the very first AIPLA
artefact, before the one-sim-per-iframe + shared-snapshot-hook discipline
existed. It is already in good shape on two axes the later sims had to fix:
it is **Danish** and it is a **single sim** (no tabs to split). But its
React side is thin — the default workspace is just a launch button + a
progress checklist + the problem text. There is:

- **no journey framing** — nothing tells the student "what do I do now";
- **no React mirror of sim state** — the snapshot the agent sees
  (`v0`, `theta`, `g`, revealed markers) lives only in a ref inside
  `BoldkastSimFrame`; the student's own workbench never reflects what they
  did in the sim once they close it.

This pass brings Boldkast up to the same shape as LED Planck / KineBot
WITHOUT touching the shipped iframe (lower risk — the iframe already emits
everything we need).

## Scope decision (2026-05-28)

**Do NOT touch the Boldkast iframe.** It already emits `state-change`
(`{v0, theta, g}`), `show_value` (`{marker, revealed}` for markers
`range` / `tof` / `ymax`), and `open`/`play`/`pause`/`reset`. The React
workbench can derive everything from those events. The pass is purely
host-side: lift the snapshot into a shared hook and add a workbench.

**Computed results, reveal-gated.** The workbench computes range, flight
time, and max height from the committed `v0`/`theta`/`g` using the standard
projectile formulas — but only *displays* a result once the student has
revealed that marker in the sim (`show_value`). This preserves Boldkast's
predict-then-reveal pedagogy while giving a persistent results view.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses the shared-snapshot-hook pattern; no new wire formats; iframe untouched |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Result formulas are client render of emitted state; no business logic added |
| 11 | USABLE BY DESIGN | +1 | Adds the missing journey + state mirror + empty states; designed upfront (this doc) |
| | **Net Score** | **+2** | (others 0) Threshold met; no -1s |

## Step 0 — UX design (BEFORE code)

### Student journey
1. **Land** → workbench: a short "Sådan virker det" card (open the sim →
   set v₀ and θ, throw → predict, then reveal range / flight time / height
   → mark sub-parts done → ask the tutor). The launch button sits right
   under it.
2. **Open sim** → set v₀ / θ (and g), press Afspil. The bench shows the arc.
3. **Predict & reveal** → the student predicts a result, then clicks Vis on
   range / flight time / height. Each reveal appears in the workbench's
   **Resultater** card (computed value, reveal-gated).
4. **Track** → mark sub-parts done in the existing **Fremgang** checklist.
5. **Ask** → the tutor sees the same config + revealed results.

### Every state (no voids)
- **Config card empty** (no throw yet): "Åbn simulatoren og kast en bold for
  at se din opsætning her."
- **Results card empty** (nothing revealed): "Forudsig først — afslør så
  rækkevidde, flyvetid og højde i simulatoren."
- **Per-result hidden**: "Skjult — tryk Vis i simulatoren" until revealed.
- **Loading/Error**: none — all client-side from emitted events.

### Narrowest viewport (~700px and mobile)
Single scrolling column of full-width cards (journey, launch, config,
results, checklist, problem). No side-by-side. Matches LED Planck / KineBot.

### Motivation hooks
The config + results cards filling as the student throws and reveals; the
checklist count; the tutor reacting to what they revealed.

## Files

- `frontend/src/hooks/useBoldkastSnapshot.ts` — NEW shared hook (mirrors useLedPlanckSnapshot). Snapshot: `{lastEvent, v0, theta, g, revealedMarkers, lastTriggeredBy}`. Events: `open`, `state-change`, `show_value`, `play`/`pause`/`reset`.
- `frontend/src/components/workspace/BoldkastSimFrame.tsx` — slim to bench-only + route events to reportEvent (drop the in-frame snapshot ref + push logic).
- `frontend/src/components/workspace/BoldkastWorkbench.tsx` — NEW: journey card + launch button + config mirror + computed/reveal-gated results + ProgressChecklist + ProblemStatementCard.
- `frontend/src/app/chat/[...path]/page.tsx` — call useBoldkastSnapshot; pass snapshot + reportEvent to the frame and the workbench (parallel to LED Planck / KineBot).

## Acceptance gates
1. Boldkast iframe byte-identical (untouched) — no artefact redeploy needed.
2. Fits 700px + mobile-portrait, single column, no overlap.
3. Every workbench card has a designed empty state.
4. Throw in sim → config card shows v₀/θ/g; reveal a marker → result appears (computed); checklist unchanged.
5. Agent still sees the state (iframe-context POST, serverId boldkast) — observability unchanged.
6. KineBot + LED Planck unaffected.

## Risk / rollback
Single feature branch, FF-merge at end. Iframe untouched, so the live demo
sim cannot regress from this pass. Rollback = revert.
