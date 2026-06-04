# Sim onboarding ergonomics — kill the bug class

**Status:** Planned (small follow-up sprint to PROACTIVE-SIM-REACTIVE)
**Last Updated:** 2026-06-04
**Priority:** P1 — directly enables 1.I jitt-dk artefacts (Pendul, Kredsløb, Videoanalyse, GPS Fart, Frekvensanalysator) to onboard mechanically without re-discovering the proactive-reactive wiring gotchas
**Estimated:** ~0.75d (~6h actual work; ~1d wall clock with quality gates)
**Scope:** Frontend — new denylist helper, refactor 3 existing per-artefact frames to use it, add per-sim integration tests, harden the `_sim-template/` scaffold
**Dependencies:** PROACTIVE-SIM-REACTIVE shipped + the M8 multi-fix work (the dual-surface architecture, central `useSimSnapshotPush`, tokenized mapper)
**Source:** User question 2026-06-04 — *"this must be reliable for any and all sims we add — and include good instructions for when we make new sims to be compatible. what is necessary currently and can it be easier?"*

## The bug class this kills

The PROACTIVE-SIM-REACTIVE sprint shipped over several iteration loops because the per-artefact-frame filter was an **allowlist** ("explicitly route each kind") rather than a **denylist** ("drop noisy kinds, forward everything else"). Symptoms during the iteration loops:

- **Boldkast** filtered out `boldkast.play` as "not pedagogically interesting" (pre-2026-06-03 comment). The proactive feature was dark until the filter was patched.
- **KineBot + LED Planck** emitted multi-word hyphenated kinds (`kinebot.sim-run`, `led-planck.auto-run`, `led-planck.step-change`, `.reading`, `.fit`, `.spectrum`) — the tokenizer didn't handle hyphens. Proactive reactions silently never fired for those two sims even after Boldkast was patched.
- Every iteration loop ended with the user reporting "still no proactive AI" and the engineer discovering another forgotten event kind.

These are all **bugs of omission** — the failure mode is "we forgot to wire something through" and the symptom is silent (no error, no warning, just no proactive turn).

**Inverting the filter from allowlist to denylist makes bugs of omission impossible** — the new artefact's events flow through automatically; the only way to break proactive-reactive is to actively drop a meaningful kind, which is far less common than forgetting to add one.

## What this sprint ships

### 1. `useArtefactReportEvent` helper (the denylist pattern)

A small helper that wraps the per-frame filter logic. Per-artefact frames declare:

- Which **noisy kinds** to drop (pause / reset / undo / errors / state-change syncs)
- An optional **shape narrower** for each forwarded kind (the only legitimate use of allowlist code today — extracting typed fields from `structuredContent`)

Everything else flows through to the snapshot hook automatically. The helper sits in `frontend/src/hooks/useArtefactReportEvent.ts` (new file).

```typescript
// Proposed shape — caller passes `report` callback + denylist + optional payload narrowers.
const forward = useArtefactReportEvent({
  report,
  drop: new Set(["boldkast.pause", "boldkast.reset"]),
  narrow: {
    "boldkast.state-change": (data) => Array.isArray(data.changed)
      ? { kind: "boldkast.state-change", changed: data.changed, state: data.state ?? {}, triggeredBy: data.triggeredBy }
      : null,
    "boldkast.show_value": (data) =>
      typeof data.marker === "string" && typeof data.revealed === "boolean"
        ? { kind: "boldkast.show_value", marker: data.marker, revealed: data.revealed }
        : null,
  },
});

// Then in handleStructuredContent:
const handleStructuredContent = useCallback(
  (structuredContent: Record<string, unknown>) => {
    forward(structuredContent);
  },
  [forward],
);
```

For kinds **not in either map**, the helper forwards `{kind}` with no extra payload. New event kinds the artefact starts emitting later automatically reach the snapshot hook.

### 2. Refactor the 3 existing frames

`BoldkastSimFrame.tsx`, `LedPlanckLabFrame.tsx`, `KineBotFrame.tsx` swap their allowlist filters for the new helper. Net code goes down (the explicit `if (kind === ...) report({...})` chains collapse) and all three frames become structurally identical apart from per-sim narrow / drop config.

### 3. Per-artefact integration tests

Three new vitest cases — one per existing sim — that simulate the artefact's full event vocabulary (every kind it actually emits) and assert:

- Meaningful kinds flow through to `report`
- Noisy kinds are dropped
- The mapper turns them into the right `MeaningfulEventKind` (or `null` correctly)

This is the **regression bar** — if a future PR breaks any sim's proactive-reactive wiring, these tests fail before merge. Today's "only Boldkast works" issue would have been caught at PR time, not via the deployed-dev iteration loop.

### 4. Harden the `_sim-template/` scaffold

The existing scaffold at `frontend/src/_sim-template/` is referenced in the `mcp-app-artefact` skill but doesn't include proactive-reactive setup. Update both templates (`useExampleSimSnapshot.ts.template`, `ExampleSimFrame.tsx.template`) so the scaffolded files include:

- `useSimSnapshotPush(sessionId, "<name>")` (already there if the scaffold was up to date)
- `useArtefactReportEvent` helper usage with a minimal `drop` set and empty `narrow` map
- Comments referencing the keyword vocab in `proactiveEventCheck.ts`

Plus a short `README.md` update in `_sim-template/` listing the four required tokens convention (`*.run`, `*.step`, `*.measure`, plus the noise-kinds that should go in the denylist).

## What it doesn't ship (filed out of scope)

| | Why not now |
|---|---|
| **CI lint** that scans `handleStructuredContent` bodies for allowlist-shape antipatterns | The denylist helper makes this less necessary — new sims using the helper can't accidentally allowlist. Revisit if a sim author bypasses the helper |
| **YAML/JSON config** for the keyword vocab so non-engineers can extend it | Over-engineering for current team size; the lists live in one file and are one-line edits |
| **End-to-end browser test** (Playwright) covering the full proactive flow | Too brittle for the iframe + LLM combo; vitest at the unit level + manual smoke covers it pragmatically |
| **Cooldown event-banking** (the user-raised future enhancement) | Already filed at [cooldown-event-banking.md](cooldown-event-banking.md) — separate concern, validate from pilot first |
| **Race fix for iframe-context 404s** before session bootstrap completes | Observed today (2026-06-03 session d3c9943d showed 404s) but doesn't block proactive turns from working post-bootstrap — log a separate small follow-up if pilot teachers report it |

## Acceptance gates

- [ ] `useArtefactReportEvent` helper exists; tested independently (denylist drops noisy kinds; narrow funcs called; default-through path works)
- [ ] Boldkast / LED Planck / KineBot frames use the helper; all existing vitest tests still green
- [ ] Per-artefact integration tests for all three sims pass: simulate every emitted kind, assert correct routing + mapping
- [ ] `_sim-template/` scaffold updated with proactive boilerplate + README + comments pointing at keyword vocab
- [ ] `mcp-app-artefact` skill doc cross-links the new helper + scaffold so the new-sim author flow is one document
- [ ] No regression in proactive-reactive for the three existing sims (manual LOCAL_MODE smoke OR — if Playwright-style is wanted — extend `aiplatform sim scaffold` to also run a generated assertion)
- [ ] FE quality gates: `npm run quality:check` green (108+ test files; expect ~+10-15 new tests)
- [ ] Backend untouched — no backend code changes in this sprint

## Files touched (estimate)

| File | Change | LOC |
|---|---|---|
| `frontend/src/hooks/useArtefactReportEvent.ts` | new helper | ~80 |
| `frontend/src/hooks/__tests__/useArtefactReportEvent.test.ts` | new test file | ~120 |
| `frontend/src/components/workspace/BoldkastSimFrame.tsx` | swap allowlist for helper | -30 / +15 |
| `frontend/src/components/workspace/LedPlanckLabFrame.tsx` | same | -50 / +25 |
| `frontend/src/components/workspace/KineBotFrame.tsx` | same | -15 / +10 |
| `frontend/src/components/workspace/__tests__/<each-sim>.integration.test.tsx` | three new files | ~80 each |
| `frontend/src/_sim-template/<files>.template` | proactive boilerplate | ~30 |
| `frontend/src/_sim-template/README.md` | author checklist + keyword vocab pointer | ~40 |
| `.claude/skills/mcp-app-artefact/SKILL.md` | cross-link the new helper + scaffold | ~10 |

## Author checklist (post-sprint — what a new sim onboards through)

After this sprint ships, the new-sim author checklist becomes:

1. **Run `aiplatform sim scaffold <name>`** — generates frame + snapshot hook + workbench + button using the template
2. **Edit the new frame's `drop` set** to add any noisy kinds your artefact emits (pause / reset / errors / pure-noise state syncs). LEAVE the default `narrow` empty; the helper will forward everything else with `{kind}` shape.
3. **Edit the new frame's `narrow` map** ONLY for kinds where you want typed payload fields on the snapshot event (e.g. Boldkast's `state-change` carries `changed[]` + `state` + `triggeredBy`).
4. **Name your meaningful kinds** with a keyword token: `*.run`, `*.play`, `*.step`, `*.measure`, `*.reading`, etc. — check `SIM_RUN_TOKENS` / `STEP_ADVANCE_TOKENS` / `MEASUREMENT_COMMIT_TOKENS` in `proactiveEventCheck.ts` for the current vocab. If your sim needs new vocab, add to those lists.
5. **Write the per-artefact integration test** — `simulate(kind)` for every kind your artefact emits; assert routing + mapping. Three existing integration tests are the template.

That's it. The chat page wraps everything in `<ProactiveSimProvider>` already; the central `useSimSnapshotPush` fires the gate-check; the agent's `## REACTIVE TURN` block in the skill's SKILL.md shapes the response.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Denylist helper too magical — author misses subtle bugs because everything "just works" | Low | Comments in the helper + the scaffold README spell out exactly what's auto-forwarded |
| Refactor breaks existing sims | Low | Per-sim vitest + the new integration tests catch it; manual LOCAL_MODE smoke is the final gate |
| Author writes new `narrow` shapes that violate the snapshot hook's expected event type | Medium | TypeScript narrows the type signature — the snapshot hook's union type forces correct shape at compile time |
| Keyword vocab needs extending more often than expected | Low | Adding a token is one line; no test churn needed if the new vocab matches an existing category |
| `_sim-template/` scaffold rot — gets out of date as the helper API evolves | Medium | Add a vitest case that the scaffold compiles + passes its own integration test as part of `quality:check` |

## Related

- [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) — the design doc this extends
- [implemented/proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md) — the shipped sprint that established the central plumbing
- [cooldown-event-banking.md](cooldown-event-banking.md) — separate roadmap signal (validate from pilot first)
- `.claude/skills/mcp-app-artefact/SKILL.md` — the canonical new-sim author guide this sprint consolidates with
- `frontend/src/_sim-template/` — the scaffold this sprint hardens
- 1.I jitt-dk artefacts in [v1.0.0-pilot/jitt-dk-artefacts.md](../v1.0.0-pilot/jitt-dk-artefacts.md) — the 5 sims this sprint unblocks for clean onboarding
