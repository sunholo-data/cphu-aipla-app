---
name: workbench-element-builder
description: Wire a new student-facing workbench/activity element so it reaches the tutor on BOTH surfaces — the iframe-context state push AND the visible "shared with the AI" human-tool-use trust card — AND make it proposable by the activity-authoring co-pilot (the add_element tool). Use when adding a workbench element, a new activity element, when a student interaction (table/calculator/checklist/etc.) does not show in the chat, when "the AI didn't see what the student did", when wiring or debugging the trust card, when a new element isn't offered by the authoring co-pilot, or reviewing an element PR for the dropped-card or dropped-co-pilot-coverage bug.
---

# Workbench Element Builder

Adding a student-facing workbench element means wiring **two** tutor surfaces.
Shipping one and dropping the other is the single most-repeated bug on this axis
(the calculator and the data table both shipped with the push but no card). This
skill exists so that never happens silently again.

## The one rule: sharing with the tutor is THREE wirings

Two of these are about what happens when a student *interacts*. The third is
about what the tutor knows **before anyone touches anything**, and it was added
on 2026-08-07 after 1.1.62 found that six element kinds had been invisible to
the tutor for six weeks — while passing every check in this skill.

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

And regardless of interaction:

3. **PROMPT-TIME PRESENCE (existence → AI).** The element must be described in
   `backend/adk/element_manifest.py` so the tutor knows it is there *before* the
   student touches it. Add a `_DESCRIBERS` entry for the new kind — name the
   element and say what the student does with it, never its current values (the
   manifest is composed once per session and would go stale; values arrive live
   over #1).

The data flows with only #1, so the gap passes unit tests (which mock both
hooks) and demos — but leaves the student blind. #2 is the half that keeps
getting dropped. Why it matters: the chat card is the student's *evidence* that
the silent workspace and the conversation are connected; without it the element
feels inert even when it's working.

**Why #3 exists.** 1.1.38 shipped four element kinds — table, chart, calculator,
note — each correctly wired for #1 and #2, each independently verified. But
`compose_teacher_focus` described only sims, solutions and concept maps, so the
tutor's system prompt contained no evidence any of them existed. The only
element→tutor path was #1, which fires **on interaction**, so the tutor could
not invite a student to use a tool it had never been told about. Aswin,
2026-08-06: *"The chat never asked me to work on those tools."*

`describe_elements()` iterates `ELEMENT_REGISTRY` with a generic fallback, so a
new kind is visible **by default** — but a generic one-liner is a nudge, not a
description. Write a real describer.

**The guard:** `test_every_registered_element_kind_is_described` fails when a
registered kind produces no manifest text. If you add an element and that test
goes red, this is the rule you missed.

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
   make audit-trust-cards        # = scripts/audit-trust-cards.sh
   ```
   Lists every workspace component that pushes but does **not** dispatch a card —
   your new element should not be a new red row (unless it's a no-card shape).
   This is the same script the CI `local-mode-safety` job runs as a blocking gate
   (P1.4), so a dropped card fails the build, not just this manual check.
6. **Wire the co-pilot** — see the section below. A teacher-authorable element the
   co-pilot can't propose is a silent gap.

## Also: make the element co-pilot-authorable

The two wirings above are the **student**-facing tutor surfaces. There is a third,
separate requirement on the **teacher**-authoring side: the activity-authoring
co-pilot (`docs/design/aipla/v1.1.0-feedback/activity-authoring-assistant.md`, its
`add_element` tool) must be able to **propose** the new element — or a teacher can
add it by hand but can't ask the co-pilot for it. Every element except the three
structured ones (table/chart/calculator) shipped before the co-pilot could propose
them; COPILOT-2 closed that gap, and this step keeps it closed.

This is **recipe step 5b** in
`docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md`. Wire **both** sides:

- **Backend** `backend/adk/authoring_tools.py`: add the kind to
  `_SUPPORTED_ELEMENT_KINDS` (under `_TEXT_ELEMENT_KINDS` for a prompt/text element,
  `_STRUCTURED_ELEMENT_KINDS` for a richer spec) + a `_build_element_spec` branch
  that **validates by constructing the Pydantic element model** and returns a spec
  shaped for the **FE editor value**; accept the kind's params on `add_element`;
  list it in the authoring `SKILL.md`. Test owner-scoping + validation in
  `backend/tests/unit/test_authoring_tools.py`.
- **Frontend** `frontend/src/app/teacher/activities/[id]/_AuthoringCopilot.tsx`: a
  `Proposal` variant + `parseProposal` case + `AddElementBody` preview, and the
  **Apply-router case** in `[id]/page.tsx` mapping the proposal to the builder
  setter from recipe step 5 (`setTable`/`setNote`/…). Test parse + Apply in
  `_AuthoringCopilot.test.tsx`.

Skip only for elements that are **not** teacher-authored (none today). The pattern
is mechanical — each kind mirrors an existing one (`set_lesson_prompt` for
owner-scoping; the text vs structured branches for the spec).

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
