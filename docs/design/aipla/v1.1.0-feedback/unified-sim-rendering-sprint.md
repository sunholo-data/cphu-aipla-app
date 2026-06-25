# Sprint Plan: USR-1 — Unified sim rendering (no dual systems)

## Summary
Retire the slug-driven legacy sim path and render every sim through the **one**
generic artefact mount (`StudentWorkspace`/`GenericArtefactFrame`), driven by
`activity.artefactId` — so the builder preview === the student runtime. Smaller than
the design doc's 4–6d estimate because the artefacts are **already self-contained**
and the event bridge is **already shared**.

**Duration:** ~1 day (the artefact-rewrite risk evaporated — see below)
**Scope:** Frontend (dispatch + delete) + a backend data-migration script
**Dependencies:** [unified-sim-rendering.md](unified-sim-rendering.md) (the design),
[activity-library-sharing.md](activity-library-sharing.md) (ALS-1 — artefactId on Activity)
**Risk Level:** Medium (visual parity on 3 sims; same-deploy data+dispatch ordering)
**Design Doc:** [unified-sim-rendering.md](unified-sim-rendering.md)

## What changed vs the design doc's estimate
- **M0 (artefact self-containment) is already done.** The sandboxed artefacts already
  render setup + results: `boldkast/v1/index.html` has a `Resultater` section (Maks
  højde / Rækkevidde / Flyvetid + "Vis" reveal buttons). The bespoke React workbenches
  **duplicate** it. So no artefact rewrite — just verify parity.
- **The bespoke workbench decomposes into the existing model (resolves Q1):**
  | `BoldkastWorkbench` part | Lands as |
  |---|---|
  | "Din opsætning" + "Resultater" (v₀/θ/g, range/tof/ymax) | already in the **artefact** |
  | "Sådan virker det" (how-to) | the artefact / a short `note` |
  | `ProgressChecklist` (sub-parts a/b/c/d) | a **`checklist`** element on the activity |
  | `ProblemStatementCard` | a **`note`** element on the activity |
  No new mechanism — the generic `StudentWorkspace` already renders artefact + checklist
  + note. The migration moves the hardcoded `BOLDKAST_SUBPARTS` / problem text into the
  activity config, which **also** makes them teacher-editable in the builder.

## Current Status Analysis
- **Velocity:** sustained very-high throughput (100+ commits this window). A 1-day
  frontend-refactor + small backend script is comfortably in range.
- **Already exists:** `StudentWorkspace`/`GenericArtefactFrame` (one already runs
  `Kastebevægelse` = concept-dialogue + artefactId=boldkast), `useSimSnapshotPush` +
  `iframe-context` (the shared event bridge), the 3 sandboxed artefacts.
- **The dual system lives in:** `SIM_WORKSPACE_SLUGS` (workspaceContent.ts) + the
  `skillSlug === "…"` render branches in the chat page + `BoldkastSimFrame`/
  `LedPlanckLabFrame`/`KineBotFrame` + `*Workbench` + `use*Snapshot` hooks.

## Milestones

### M1 — Migrate the 3 sim activities' content (data) — do FIRST (no-regression order)
**Scope:** backend · **Goal:** give each sim activity its `artefactId` + the
checklist/note elements that the bespoke workbench used to render, so the generic path
has everything BEFORE the dispatch flips. The slug path still renders during this step
(slug wins in the current dispatch), so no regression.
- [ ] `scripts/backfill_sim_artefacts.py`: for each activity whose `skill_id` is a sim
  skill, set `artefact_id` (problem-set-hints→`boldkast`, led-planck-tutor→`led-planck`,
  kinebot-kinematics-tutor→`kinebot`), and seed `checklist` (the skill's sub-parts) +
  `note` (the problem statement) if absent. Idempotent; dry-run then `--apply` on dev.
- [ ] Source the per-sim sub-parts/problem text from the current constants
  (`BOLDKAST_SUBPARTS` etc. + the skills' problem statements).
- [ ] Tests: maps each sim skill → artefact id + elements; idempotent; dry-run safe.

**Acceptance:** the 3 sim activities carry `artefactId` + checklist + note; re-run is a
no-op; slug path still renders them unchanged.

### M2 — Unify the runtime dispatch on `artefact_id`
**Scope:** frontend · **Goal:** render every sim through `StudentWorkspace` (generic
artefact mount); the slug special-cases go away.
- [ ] `workspaceContent.ts`: `workspaceContentKind` returns `"sim"` from
  `activeArtefact != null` (already a clause) — **remove** the `SIM_WORKSPACE_SLUGS`
  branch as the selector.
- [ ] chat page: delete the `skillSlug === "problem-set-hints" | "led-planck-tutor" |
  "kinebot-kinematics-tutor"` render branches; `usesStudentWorkspace` true for sims; all
  activities render via the single `StudentWorkspace` (artefact + elements + documents).
- [ ] Verify the artefact's iframe-context payloads (`mcp_app_context.{sim}.*`) are
  unchanged so tutor behaviour is identical.
- [ ] Update `workspaceContent.test.ts` (selector is artefact-driven).

**Acceptance:** opening a migrated sim activity renders the artefact (sim + results) +
the checklist + note via the generic mount; **builder preview shows the same**; tutor
still receives the sim events.

### M3 — Delete the legacy path
**Scope:** frontend · **Goal:** no dual system — the bespoke code is gone.
- [ ] Delete `SIM_WORKSPACE_SLUGS`, `BoldkastSimFrame`, `BoldkastWorkbench`,
  `LedPlanckLabFrame`, `LedPlanckLabButton`, `LedPlanckWorkbench`, `KineBotFrame`,
  `KineBotWorkbench`, `useBoldkastSnapshot`, `useLedPlanckSnapshot`, `useKineBotSnapshot`,
  the hardcoded `BOLDKAST_SUBPARTS` + sim refs/snapshot state in the chat page.
- [ ] Keep `useSimSnapshotPush` (the shared bridge — still used by `GenericArtefactFrame`).
- [ ] Remove dead imports; `npm run quality:check` green; no orphaned tests.

**Acceptance:** `SIM_WORKSPACE_SLUGS` + the 3 bespoke frames/workbenches/hooks no longer
exist; exactly one sim render path; full CI green.

## Day plan
1. **M1** — backfill script + per-sim element data + dry-run/apply on dev (morning).
2. **M2** — flip the dispatch; browser-verify Boldkast end-to-end (sim + checklist +
   note + tutor events) on a scratch run.
3. **M3** — delete the legacy components; fix imports; full quality gate.
4. Push once (M1+M2+M3 together → one deploy, no regression window); browser-verify on dev.

## Quality Gates
```bash
cd frontend && npm run quality:check     # lint + typecheck + test + build
cd backend && make lint && make test-fast
```
Browser-verify each sim (Boldkast, LED-Planck, KineBot) through the generic mount vs the
old bespoke render (same controls, results, and tutor events) per `aitana-frontend-verify`.

## Success Metrics
- [ ] Builder preview shows the live sim for a sim activity (the reported bug).
- [ ] All 3 sims render identically pre/post; tutor still gets the sim events.
- [ ] `SIM_WORKSPACE_SLUGS` + the 3 bespoke frames/workbenches/hooks deleted.
- [ ] Frontend + backend CI green; dev data migrated.

## Notes
- Ordering matters: **M1 (data) before M2 (dispatch)** so the generic path has
  `artefactId`+elements before the slug path is removed — no regression window.
- This supersedes the design doc's M0 (artefact self-containment) — already satisfied.
