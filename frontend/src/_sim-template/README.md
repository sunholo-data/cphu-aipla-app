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
