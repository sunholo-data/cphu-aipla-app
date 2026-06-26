---
name: workbench-element-builder
description: Wire a new student-facing workbench/activity element so it reaches the tutor on BOTH surfaces — the iframe-context state push AND the visible "shared with the AI" human-tool-use trust card. Use when adding a workbench element, a new activity element, when a student interaction (table/calculator/checklist/etc.) does not show in the chat, when "the AI didn't see what the student did", when wiring or debugging the trust card, or reviewing an element PR for the dropped-card bug.
---

# Workbench Element Builder

Adding a student-facing workbench element means wiring **two** tutor surfaces.
Shipping one and dropping the other is the single most-repeated bug on this axis
(the calculator and the data table both shipped with the push but no card). This
skill exists so that never happens silently again.

## The one rule: sharing with the tutor is TWO wirings

When a student **interacts** with an element (enters data, computes, writes,
selects), both of these are required:

1. **THE PUSH (data → AI).** `useSimSnapshotPush(sessionId, "<kind>")` → POSTs to
   `/api/sessions/{id}/iframe-context` → lands in `mcp_app_context.<kind>.state`,
   which `wrap_with_iframe_context` injects into **every** agent prompt. Without
   it the AI never sees what the student did.
2. **THE TRUST CARD (confirmation → student).** On a *deliberate* action, also
   `useHumanToolEvents().dispatch({ label, push: () => req })` → renders a
   pending→confirmed card in the chat so the student can **see** their work
   reached the tutor.

The data flows with only #1, so the gap passes unit tests (which mock both
hooks) and demos — but leaves the student blind. #2 is the half that keeps
getting dropped. Why it matters: the chat card is the student's *evidence* that
the silent workspace and the conversation are connected; without it the element
feels inert even when it's working.

## Decision rule — does this element need a card, and what kind?

Pick by the **shape of the interaction**, not the element name:

| Interaction shape | Card? | Pattern | Reference |
|---|---|---|---|
| **One-shot action** (toggle a step, compute a value) | one card **per action** | dispatch in the commit handler | `ProgressChecklist`, `WorkbenchCalculator` |
| **Continuous entry** (a grid of cells) | one **debounced** card per editing burst, NOT per cell | debounce the dispatch; push still fires per cell | `WorkbenchTable` (`TABLE_CARD_DEBOUNCE_MS`) |
| **Sends a real chat turn** (submit work as a message) | **no card** — the turn IS the confirmation | `onProactiveTrigger(text, attachments)` | `SolutionElementMount` |
| **Read-only** (teacher note) / **catch-up sync** (the silent `sessionId`-arrival re-push) | **no card** | — | `WorkbenchNote`; the `*.sync` effect |

A label should name what was shared, in Danish (student-facing UI is Danish):
`Beregnede Fart = 10`, `Datatabel delt med vejlederen (3 felter)`,
`Markerede 'a' som klar`.

## Workflow

1. **Find the interaction shape** in the table above. If the element is
   read-only or sends a real turn, you're done — no card.
2. **Wire the push** — see the recipe step 4 (below). Use a `<kind>.commit`
   event name so it's *passive* context (no unprompted tutor reply).
3. **Wire the card** — copy the matching snippet from
   [resources/snippets.md](resources/snippets.md).
4. **Write the test** — the push assertion AND the card assertion. For a
   debounced card use fake timers. Stubs in
   [resources/snippets.md](resources/snippets.md).
5. **Audit** before you call it done:
   ```bash
   .claude/skills/workbench-element-builder/scripts/audit-trust-cards.sh
   ```
   Lists every workspace component that pushes but does **not** dispatch a card —
   your new element should not be a new red row (unless it's a no-card shape).

## Canonical references (read these, don't re-derive)

- **The full "add element N" recipe:**
  `docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md` — step 4 (push)
  + **step 4b (card)**. This skill is the operational shortcut for steps 4/4b/7.
- **In-code contract:** the header comment in
  `frontend/src/components/workspace/elementRenderers.tsx` states the two-wiring
  rule right where you add a renderer.
- **Hook internals:** `frontend/src/hooks/useHumanToolEvents.ts` (dispatch flow,
  the no-provider warning) and `frontend/src/hooks/useSimSnapshotPush.ts` (push +
  proactive gate). The card system runs alongside the AG-UI stream — it is NOT
  part of `agent.messages`.
- **Memory:** `feedback-trust-card-with-tutor-push` — the why, and the running
  list of what's still un-carded (the document element).

## Gotchas

- **Provider scope.** `useHumanToolEvents()` falls back to a no-op (POST still
  fires, no card) when no `HumanToolEventsProvider` is an ancestor — and warns
  once in dev. Render your element inside `StudentWorkspace`, which is already
  under the provider; the checklist proves that subtree is covered.
- **The dispatch reuses the in-flight request.** Pass `push: () => req` where
  `req` is the promise `useSimSnapshotPush` already returned — it does NOT fire a
  second POST; dispatch just awaits it to flip the card to confirmed/failed.
- **`req` is null before the session bootstraps.** `useSimSnapshotPush` returns
  `null` when `sessionId` is null — guard `if (!req) return;` and let the
  catch-up `*.sync` effect (silent, no card) re-push once the id arrives.
- **Don't card the catch-up sync.** Only the deliberate action gets a card; the
  `sessionId`-arrival re-push is silent.
