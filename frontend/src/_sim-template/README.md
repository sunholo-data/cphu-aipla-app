# `_sim-template/` — scaffold for new sims

Two-file template for onboarding a new MCP-App sim (Pendul, Kredsløb, Videoanalyse, …) into the AIPLA frontend.

## Files

- `useExampleSimSnapshot.ts.template` — copy to `src/hooks/use<Name>Snapshot.ts`
- `ExampleSimFrame.tsx.template` — copy to `src/components/workspace/<Name>Frame.tsx`

The `.template` extension keeps these out of the TypeScript build. They contain `__NAME__` / `__name__` / `__SERVER_ID__` placeholders that need replacing.

## Manual onboarding (4 steps)

1. **Pick a name.** PascalCase + kebab-case. E.g. `Pendul` / `pendul`.

2. **Copy and rename the two template files.**

   ```bash
   cp src/_sim-template/useExampleSimSnapshot.ts.template src/hooks/usePendulSnapshot.ts
   cp src/_sim-template/ExampleSimFrame.tsx.template src/components/workspace/PendulFrame.tsx
   ```

3. **Find-and-replace placeholders.** In your editor:

   | Placeholder | Replace with | Example |
   |---|---|---|
   | `__NAME__` | PascalCase | `Pendul` |
   | `__name__` | kebab-case | `pendul` |
   | `__SERVER_ID__` | MCP server id (usually = `__name__`) | `pendul` |
   | `__TITLE__` | Display title | `Pendul — simulator` |
   | `__CLOSE_LABEL__` | Close button text | `Luk` |
   | `__CLOSE_ARIA__` | Close aria-label | `Luk simulator` |
   | `__FULLSCREEN_ARIA__` | Fullscreen aria-label | `Skift fuldskærm` |

4. **Customise the event types + reducer + handler.** The template gives you a working stub with `<name>.open` and `<name>.state-change` events. Add cases for whatever events your artefact emits via `ui/update-model-context`.

## After scaffolding — proactive-reactive wiring

The Frame uses `useArtefactReportEvent` (a **denylist** filter). Two edits are usually all you need to hook a new sim into the proactive AI tutor:

1. **Extend the `drop` set** in your new Frame with any sim-specific noise kinds your artefact emits (pause / reset / errors / debounced state syncs). Anything not in `drop` AND not in `narrow` gets forwarded as `{kind}` with no extra payload — so new event kinds you add later automatically light up without a host code edit.

2. **Extend the `narrow` map** ONLY for kinds where you need typed payload fields on the snapshot event (e.g. Boldkast's `state-change` carries `changed[]` + `state` + `triggeredBy`). The narrower returns `null` if the artefact's payload fails shape validation — that's a drop.

That's it. The chat page already wraps everything in `<ProactiveSimProvider>`; the central `useSimSnapshotPush` fires the gate check; the agent's `## REACTIVE TURN` block in the skill SKILL.md shapes the response.

## Naming conventions for proactive-reactive

For the central proactive-event-check to recognise one of your kinds as **meaningful** (and trigger a reactive tutor turn), name your meaningful kinds with one of these keyword tokens (suffix-tokenized on `-` and `_`):

| Category | Tokens | Examples that light up |
|---|---|---|
| `sim_run` | `play`, `run`, `simulate`, `afspil` | `boldkast.play`, `kinebot.sim-run`, `led-planck.auto-run` |
| `step_advance` | `step`, `next`, `advance`, `placed`, `calibrated` | `led-planck.step-change`, `led-planck.component-placed`, `pendul.next` |
| `measurement_commit` | `measure`, `record`, `commit`, `show_value`, `reading`, `fit`, `spectrum` | `boldkast.show_value`, `led-planck.reading`, `videoanalyse.measure` |

If your sim needs new vocab that fits a category but doesn't match a token, **add to the lists** in `frontend/src/lib/proactiveEventCheck.ts` (`SIM_RUN_TOKENS` / `STEP_ADVANCE_TOKENS` / `MEASUREMENT_COMMIT_TOKENS`). That file is the source of truth. Keep tokens tight — e.g. don't add `change` because `state-change` is exploration noise, not progress.

Pre-2026-06-04 the mapper compared the whole suffix against single-word keywords, so multi-word hyphenated kinds (`kinebot.sim-run`, `led-planck.step-change`) silently never fired. The mapper now tokenizes on `-` and `_`; per-artefact integration tests pin this so future PRs can't regress it.

## Automated onboarding

`aiplatform sim scaffold <name>` does steps 2-3 in one command (see the `aiplatform-cli` skill).

## What else you need

The frontend wiring above is one of several touchpoints. To get a sim live end-to-end:

- **Artefact code** — `infrastructure/mcp-sandbox/artefacts/<name>/v1/` (see the `mcp-app-artefact` skill)
- **Skill template** — `backend/skills/templates/<your-skill>/SKILL.md` with `tool_configs.mcp.servers: [<name>]` and `allow_context_writes: [<name>]`
- **Chat page mount** — wire `use<Name>Snapshot` + `<Name>Frame` into `src/app/chat/[...path]/page.tsx` (look at how Boldkast/LedPlanck/Kinebot are mounted as the canonical pattern)

## Canonical exemplars

These three sims are the templates' "this is what good looks like":

| Sim | Hook | Frame |
|---|---|---|
| Boldkast | [useBoldkastSnapshot.ts](../hooks/useBoldkastSnapshot.ts) | [BoldkastSimFrame.tsx](../components/workspace/BoldkastSimFrame.tsx) |
| LED-Planck | [useLedPlanckSnapshot.ts](../hooks/useLedPlanckSnapshot.ts) | [LedPlanckLabFrame.tsx](../components/workspace/LedPlanckLabFrame.tsx) |
| KineBot | [useKineBotSnapshot.ts](../hooks/useKineBotSnapshot.ts) | [KineBotFrame.tsx](../components/workspace/KineBotFrame.tsx) |
