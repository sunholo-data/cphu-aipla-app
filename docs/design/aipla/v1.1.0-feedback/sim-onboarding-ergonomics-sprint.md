# Sprint: SIM-ERGONOMICS — sim onboarding ergonomics (kill the allowlist bug class)

**Sprint ID:** `SIM-ERGONOMICS`
**Design doc:** [sim-onboarding-ergonomics.md](sim-onboarding-ergonomics.md)
**Parent sprint (just shipped):** [implemented/proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md)
**Branch:** work on `dev` directly per [feedback-no-prs-commit-to-dev](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_prs_commit_to_dev.md). Commit per milestone; `git push origin dev` at sprint end after M8 quality gates pass.
**Estimate:** ~0.75d (~6h actual; ~1d wall clock with quality gates)
**Created:** 2026-06-04
**Scope:** Frontend only — no backend changes

## Sprint goal

Convert the per-artefact-frame event filter from **allowlist** ("explicitly route each kind, drop everything else") to **denylist** ("drop known-noisy kinds, forward everything else") so new sims onboarded via the scaffold get proactive-reactive wiring automatically without re-discovering the gotchas from PROACTIVE-SIM-REACTIVE. Sprint also hardens the `_sim-template/` scaffold and adds per-artefact integration tests as the regression bar.

**The bug class this kills:** during PROACTIVE-SIM-REACTIVE three separate iteration loops were spent finding silently-dropped events (Boldkast `play`, KineBot `sim-run`, LED Planck `auto-run` / `step-change` / `reading` / `fit` / `spectrum`). The pattern was always the same — author forgot to wire a kind through and the failure was silent (no error, no warning, just no proactive turn). Inverting allowlist → denylist makes that failure mode impossible: the new artefact's events flow through by default; the only way to break it is to actively drop a meaningful kind, which is a far less common author mistake than forgetting one.

## Scope locks

### In scope

- New `useArtefactReportEvent` hook at `frontend/src/hooks/useArtefactReportEvent.ts` implementing the denylist + optional payload-narrower pattern
- Vitest unit tests for the helper covering: drop-set drops, narrow funcs called, default-through path, invalid narrow returns
- Refactor `BoldkastSimFrame.tsx`, `LedPlanckLabFrame.tsx`, `KineBotFrame.tsx` to use the helper (their existing `if (kind === ...) report({...})` chains collapse to a per-frame `drop` set + `narrow` map)
- Per-artefact integration tests (one new vitest file per sim) simulating every emitted kind and asserting routing + mapping (`mapArtefactKindToMeaningful` for the meaningful ones, `null` for the dropped ones)
- Update `_sim-template/ExampleSimFrame.tsx.template` to use the helper + minimal `drop` set + empty `narrow` map
- Update `_sim-template/README.md` author checklist with the four token conventions (`*.run`, `*.step`, `*.measure`, plus noise-kinds to denylist)
- Cross-link the helper + scaffold from `.claude/skills/mcp-app-artefact/SKILL.md` so the new-sim author flow is one document

### Out of scope (deferred / explicit non-goals)

- CI lint that scans `handleStructuredContent` bodies for allowlist-shape antipatterns — helper makes the lint unnecessary unless author bypasses the helper
- YAML/JSON config for the keyword vocab — over-engineering; one-line edits in `proactiveEventCheck.ts` work fine
- Playwright end-to-end browser test covering the full proactive flow — too brittle for iframe + LLM combo; vitest + manual smoke covers it
- Cooldown event-banking (the user-raised future enhancement) — already filed at [cooldown-event-banking.md](cooldown-event-banking.md)
- Race fix for iframe-context 404s before session bootstrap — separate small follow-up if pilot teachers report it
- Backend changes — gate-decision logic, `proactiveEventCheck.ts` token lists, and `useSimSnapshotPush` already work; this sprint is purely about the frame-level filter shape

## Workflow

Per the no-PR memory: commit per-milestone locally as you go; each commit independently passes lint + relevant tests for fast bisect-ability later. `git push origin dev` only after M8 final-gate pass.

No worktrees / sub-agents. Sequential single-track. Each milestone is small (~30-90 min) and the refactors are file-disjoint but the helper API is shared, so the helper has to land first.

## Milestones

### M1 — `useArtefactReportEvent` helper + unit tests (~90 min)

Create the helper at `frontend/src/hooks/useArtefactReportEvent.ts`. Shape:

```typescript
interface UseArtefactReportEventArgs<TEvent> {
  /** The snapshot-hook's reportEvent callback. */
  report: (evt: TEvent) => void;
  /** Kinds to silently drop (noisy state syncs, pause / reset / undo, errors). */
  drop?: ReadonlySet<string>;
  /** Optional per-kind shape narrowers. If a narrower returns null, the
   *  event is dropped (failed shape validation). If a narrower returns
   *  an event, it's forwarded. Kinds not in `narrow` AND not in `drop`
   *  are forwarded as `{kind}` with no extra payload — the
   *  default-through path. */
  narrow?: Record<string, (data: Record<string, unknown>) => TEvent | null>;
}

export function useArtefactReportEvent<TEvent extends { kind: string }>(
  args: UseArtefactReportEventArgs<TEvent>,
): (structuredContent: Record<string, unknown>) => void;
```

Implementation notes:

- Use `useCallback` so the returned forwarder is stable across renders (the consumer wraps it in `handleStructuredContent` which is itself memoized).
- Use a `useRef` to capture `report` so the callback identity doesn't change when the caller's `report` prop swaps.
- Defensive: if `structuredContent.kind` is not a string, drop silently and `console.debug` — matches today's behaviour.

**Acceptance:**

- [ ] `frontend/src/hooks/useArtefactReportEvent.ts` exists with the shape above
- [ ] `frontend/src/hooks/__tests__/useArtefactReportEvent.test.ts` covers: noisy kind in `drop` → not forwarded; kind in `narrow` returning valid event → forwarded with payload; kind in `narrow` returning null → not forwarded; kind in neither → forwarded as `{kind}`; non-string `kind` → silently dropped
- [ ] `cd frontend && npm run lint && npm run typecheck` pass
- [ ] `cd frontend && npm run test:run -- useArtefactReportEvent` green
- [ ] Commit: `feat(workspace): useArtefactReportEvent denylist helper (M1 sprint SIM-ERGONOMICS)`

**Files:**

- `frontend/src/hooks/useArtefactReportEvent.ts` (new, ~80 LOC)
- `frontend/src/hooks/__tests__/useArtefactReportEvent.test.ts` (new, ~120 LOC)

### M2 — Refactor BoldkastSimFrame to use the helper (~30 min)

Replace the explicit `if (kind === "boldkast.open") ... else if (kind === "boldkast.play") ...` chain with:

```typescript
const handleStructuredContent = useArtefactReportEvent<BoldkastEvent>({
  report: reportEvent,
  drop: new Set(["boldkast.pause", "boldkast.reset"]),
  narrow: {
    "boldkast.state-change": (d) =>
      Array.isArray(d.changed)
        ? { kind: "boldkast.state-change", changed: d.changed, state: d.state ?? {}, triggeredBy: d.triggeredBy }
        : null,
    "boldkast.show_value": (d) =>
      typeof d.marker === "string" && typeof d.revealed === "boolean"
        ? { kind: "boldkast.show_value", marker: d.marker as BoldkastMarker, revealed: d.revealed }
        : null,
  },
});
```

`boldkast.open` and `boldkast.play` flow through the default-through path as `{kind}`. The snapshot hook already accepts that shape (verified during PROACTIVE-SIM-REACTIVE M8).

**Acceptance:**

- [ ] `BoldkastSimFrame.tsx` uses `useArtefactReportEvent`; no explicit `if/else` chain remains
- [ ] Existing `frontend/src/components/workspace/__tests__/BoldkastSimFrame.test.tsx` still green
- [ ] `cd frontend && npm run lint && npm run typecheck` pass
- [ ] Commit: `refactor(boldkast): use useArtefactReportEvent denylist (M2 sprint SIM-ERGONOMICS)`

**Files:**

- `frontend/src/components/workspace/BoldkastSimFrame.tsx` (modify, -30 / +15 LOC)

### M3 — Refactor LedPlanckLabFrame to use the helper (~30 min)

Same pattern as M2 but with LED Planck's vocabulary:

- `drop`: `["led-planck.pause", "led-planck.reset", "led-planck.led-polarity-error"]`
- `narrow`: shape narrowers for `state-change`, `reading`, `fit`, `spectrum`, `component-placed`, `calibrated`, `step-change`, `auto-run` (whichever ones already have typed payloads — read the current frame to confirm)

**Acceptance:**

- [ ] `LedPlanckLabFrame.tsx` uses `useArtefactReportEvent`; explicit chain removed
- [ ] Existing `LedPlanckLabFrame.test.tsx` still green
- [ ] `cd frontend && npm run lint && npm run typecheck` pass
- [ ] Commit: `refactor(led-planck): use useArtefactReportEvent denylist (M3 sprint SIM-ERGONOMICS)`

**Files:**

- `frontend/src/components/workspace/LedPlanckLabFrame.tsx` (modify, -50 / +25 LOC)

### M4 — Refactor KineBotFrame to use the helper (~30 min)

Same pattern. KineBot's vocabulary is smaller — likely `drop: ["kinebot.pause", "kinebot.reset"]` + a few narrowers for state-change and any structured payloads.

**Acceptance:**

- [ ] `KineBotFrame.tsx` uses `useArtefactReportEvent`; explicit chain removed
- [ ] Existing `KineBotFrame.test.tsx` still green
- [ ] `cd frontend && npm run lint && npm run typecheck` pass
- [ ] Commit: `refactor(kinebot): use useArtefactReportEvent denylist (M4 sprint SIM-ERGONOMICS)`

**Files:**

- `frontend/src/components/workspace/KineBotFrame.tsx` (modify, -15 / +10 LOC)

### M5 — Per-artefact integration tests (~90 min, 3 files)

Three new vitest cases, one per existing sim, that simulate the artefact's full event vocabulary and assert:

- Meaningful kinds (per `mapArtefactKindToMeaningful` in `frontend/src/lib/proactiveEventCheck.ts`) flow through `report` and map to the right `MeaningfulEventKind`
- Noisy kinds in the frame's `drop` set don't reach `report`
- The mapper turns each forwarded kind into the expected generic kind (or `null` correctly)

These are integration tests (not unit tests on the helper alone) — they exercise the helper-as-used-by-the-frame against the mapper. If a future PR breaks any sim's proactive-reactive wiring, these tests fail before merge.

**Files (all new):**

- `frontend/src/components/workspace/__tests__/BoldkastSimFrame.integration.test.tsx` (~80 LOC)
- `frontend/src/components/workspace/__tests__/LedPlanckLabFrame.integration.test.tsx` (~80 LOC)
- `frontend/src/components/workspace/__tests__/KineBotFrame.integration.test.tsx` (~80 LOC)

**Acceptance:**

- [ ] Three integration test files exist; each enumerates every emitted kind from its sim's artefact
- [ ] All three green via `npm run test:run`
- [ ] Commit: `test(workspace): per-artefact proactive-reactive integration tests (M5 sprint SIM-ERGONOMICS)`

### M6 — Harden `_sim-template/` scaffold + README (~45 min)

Update both templates to ship with the helper wired in:

`ExampleSimFrame.tsx.template`:

- Replace the inline `handleStructuredContent` with a `useArtefactReportEvent` call
- Default `drop: new Set(["__name__.pause", "__name__.reset"])` (most common noise kinds)
- Default empty `narrow: {}` — author edits this to add typed payload narrowers
- Comments referencing the keyword vocab in `proactiveEventCheck.ts` (`SIM_RUN_TOKENS` / `STEP_ADVANCE_TOKENS` / `MEASUREMENT_COMMIT_TOKENS`)

`useExampleSimSnapshot.ts.template`:

- Already has `useSimSnapshotPush(sessionId, "<name>")` per parent sprint; verify and leave alone if so
- Add a comment block explaining the four token conventions (`*.run`, `*.play`, `*.step`, `*.measure` etc.)

`_sim-template/README.md`:

- Add an "After scaffolding" section listing the two edits a sim author needs to make: (1) extend the `drop` set with any sim-specific noise kinds; (2) extend the `narrow` map for any kinds with typed payloads
- Add a "Naming conventions for proactive-reactive" section listing the four token categories and pointing at `proactiveEventCheck.ts` as source of truth

**Acceptance:**

- [ ] `_sim-template/ExampleSimFrame.tsx.template` uses the helper
- [ ] `_sim-template/README.md` documents the helper edits + token conventions
- [ ] Smoke: `aiplatform sim scaffold test-sim` produces files that pass `cd frontend && npm run typecheck` (delete the scaffolded files after the smoke; this is a dry-run gate)
- [ ] Commit: `docs(sim-template): proactive boilerplate + author checklist (M6 sprint SIM-ERGONOMICS)`

**Files:**

- `frontend/src/_sim-template/ExampleSimFrame.tsx.template` (modify, ~30 LOC delta)
- `frontend/src/_sim-template/README.md` (modify, +40 LOC)

### M7 — Cross-link `mcp-app-artefact` skill to the helper + scaffold (~30 min)

The `mcp-app-artefact` skill is the canonical new-sim author guide. Add a section near the "Frontend wiring" portion pointing at:

- `useArtefactReportEvent` as the canonical way to filter artefact events in a Frame component
- The `_sim-template/` scaffold + the `aiplatform sim scaffold <name>` CLI
- The four token conventions (`*.run`, `*.step`, `*.measure`, `*.show_value`/`*.reading`/`*.fit`/`*.spectrum`)
- The known-kinds matrix already in the skill (verify it's current — the recent PROACTIVE-SIM-REACTIVE M8-fix series should already have updated it)

Goal: a sim author reading the skill should not need to read the design doc or this sprint's plan to onboard a new sim correctly.

**Acceptance:**

- [ ] `.claude/skills/mcp-app-artefact/SKILL.md` references the helper, the scaffold, and the token vocab
- [ ] Commit: `docs(skill): mcp-app-artefact cross-links useArtefactReportEvent (M7 sprint SIM-ERGONOMICS)`

**Files:**

- `.claude/skills/mcp-app-artefact/SKILL.md` (modify, +10-15 LOC)

### M8 — Quality gates + push origin/dev + finalize (~30 min)

The final commit lands the sprint markdown into `implemented/` and the JSON state flips to `shipped`.

**Pre-push commands (in order):**

```bash
cd frontend && npm run quality:check           # FULL, not :fast — last sprint burned 9 dev commits on this
cd frontend && npm run test:run                # already covered by quality:check but explicit for traceability
# Backend untouched — no make lint / make test-fast needed (verify with `git diff origin/dev -- backend/`)
git push origin dev
```

**Acceptance:**

- [ ] `npm run quality:check` green (108+ test files; expect ~+10-15 new tests from this sprint)
- [ ] `git diff origin/dev -- backend/` empty (backend untouched)
- [ ] `git push origin dev` succeeded; live URL shows the new helper deployed
- [ ] Sprint markdown moved to `docs/design/aipla/v1.1.0-feedback/implemented/sim-onboarding-ergonomics-sprint.md`
- [ ] Design doc moved to `docs/design/aipla/v1.1.0-feedback/implemented/sim-onboarding-ergonomics.md`
- [ ] SEQUENCE.md row 1.1.X updated to point at the implemented/ path
- [ ] JSON state file `.claude/state/sprints/sprint_SIM-ERGONOMICS.json` `status: shipped`
- [ ] Final commit: `chore(sprint): finalize SIM-ERGONOMICS — sim onboarding ergonomics shipped`

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Helper too magical — author misses subtle bugs because everything "just works" | Low | Comments in helper + scaffold README spell out the auto-forward path; integration tests catch shape mismatches |
| Refactor breaks existing sims | Low | Per-sim vitest + new integration tests; manual LOCAL_MODE smoke before push |
| Author writes `narrow` shapes violating the snapshot hook's event-type union | Medium | TypeScript compile-time check via the generic type parameter `<TEvent extends {kind: string}>` |
| `_sim-template/` rot — scaffold gets out of date as helper API evolves | Medium | Add a smoke step to M6 that scaffolds + typechecks a throwaway sim |
| Token-vocab needs extending more often than expected | Low | Adding a token is a one-line edit in `proactiveEventCheck.ts`; no test churn if it matches an existing category |

## Quality gates (recap)

Per [feedback-pre-push-ci-parity](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_pre_push_ci_parity.md): the FAST variants miss build errors. Use the FULL variants before push.

- `cd frontend && npm run quality:check` — lint + typecheck + tests + build
- Backend untouched this sprint — verify with `git diff origin/dev -- backend/`

## No emoji

Per [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md): no emoji in commits, code, docs, or prompts. Lucide-react icons in UI only.

## Out of scope (recap from design doc)

- CI lint scanning for allowlist antipatterns
- YAML/JSON keyword-vocab config
- Playwright end-to-end browser test
- Cooldown event-banking (separate roadmap signal)
- Race fix for iframe-context 404s on session bootstrap

## Related

- [sim-onboarding-ergonomics.md](sim-onboarding-ergonomics.md) — design doc this sprint executes
- [implemented/proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md) — parent sprint that established the central plumbing
- [cooldown-event-banking.md](cooldown-event-banking.md) — separate roadmap signal
- `.claude/skills/mcp-app-artefact/SKILL.md` — canonical new-sim author guide this sprint cross-links
- `frontend/src/_sim-template/` — scaffold this sprint hardens
- `frontend/src/lib/proactiveEventCheck.ts` — token vocab + `mapArtefactKindToMeaningful` mapper
