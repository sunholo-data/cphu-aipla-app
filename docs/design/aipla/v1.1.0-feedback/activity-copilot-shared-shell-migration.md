# Migrate the activity co-pilot onto the shared co-pilot shell

**Status:** IMPLEMENTED (2026-06-30) — code + tests + build green; one acceptance item open (browser-verify the live SSE round-trip behind the dark flag — see Acceptance). The fast-follow from [teacher-coworking-copilot.md](teacher-coworking-copilot.md) Part 1. The shared shell shipped and is reused by the class + analytics co-pilots; the **activity-authoring** co-pilot has now been folded back onto it (the duplicate chrome is deleted). One gap surfaced during the code read that the recon below missed: the card's inline-Edit textarea hardcoded `aria-label="Edit proposal"` (English) while the authoring suite asserts the Danish `Rediger forslag` — fixed by adding `editAriaLabel` to `CopilotLabels` (defaults to "Edit proposal").
**Last Updated:** 2026-06-27 (recon done while shipping Parts 1–4a).
**Priority:** **P2** — pure internal de-duplication (no new user-facing capability), so it's not urgent — BUT it's the thing that makes the centralisation real (one shell, not "a shell + the original"). Worth doing before the shell and `_AuthoringCopilot` drift.
**Estimated:** ~1–1.5d (mechanical but touches a 15-test file).
**Scope:** Frontend only — `frontend/src/components/teacher/copilot/` (small config additions), `frontend/src/app/teacher/activities/[id]/_AuthoringCopilot.tsx` (re-express on the shell, delete the duplicate chrome), `frontend/src/app/teacher/activities/[id]/__tests__/_AuthoringCopilot.test.tsx` (adapt to the shell). No backend, no reseed.
**Dependencies:** the shared shell (`TeacherCopilot`, `FloatingCopilot`, `ProposalCard`, `ProposalDescriptor`). ⚠ `_AuthoringCopilot.tsx` is the **other agent's actively-developed, richly-tested file** (7 element kinds, 15 tests) — coordinate so it isn't mid-edit; do it against their tests.

## Why this exists

The shared shell (`components/teacher/copilot/`) was **extracted from** the activity co-pilot, then used to build the class + analytics co-pilots. The activity co-pilot still runs its own copy of the floating panel, slug→UUID resolver, chat loop, and proposal card (~250 lines). Migrating it onto `TeacherCopilot` removes the duplication, gives it **cross-visit resume for free** (Part 4a), and means future co-pilot changes happen in one place.

**No behaviour change is the bar.** This is a refactor; all 15 authoring tests must still pass (after the adaptations below).

## A2UI considered (and why the cards stay custom)

The natural question when touching the proposal cards: should the co-pilot emit
them as **A2UI** (declarative UI JSON) instead of hand-rolled React, to "use the
protocol to full effect"? We checked the spec; the answer is **no**, and the
reasoning is recorded here so it isn't re-litigated each time someone opens this
doc.

- **A2UI is not chat-bound.** A2UI surfaces are host-named — `createSurface`
  takes a `surfaceId` the host mounts wherever it likes (main UI, side panel,
  not just the transcript; [a2ui-protocol-v0.10.md:180,207](../../../../.claude/skills/agent-protocols/references/a2ui-protocol-v0.10.md)).
  So "the proposal shows next to the builder, not in chat" is **not** a reason
  to avoid A2UI. The old teacher-SKILL.md rationale ("not A2UI cards in chat")
  was based on this misconception and has been corrected.
- **The real mismatch is ownership.** A2UI fits agent-**owned** surfaces with an
  agent-owned data model — a self-contained form the agent drives end-to-end
  (the spec's contact-form example). Our proposals are the opposite shape: they
  PROPOSE a patch to **frontend-owned** state (the `useActivityBuilder` React
  state, or the class list via REST). The Apply path (`applyCopilotProposal` →
  `builder.addChecklistItems()` / `createClass()`) must integrate with live
  frontend state the agent does not own. A2UI's action/event model could carry
  the "apply" intent back, but *something* host-side still has to map it onto the
  builder mutation — so the genuinely custom part (the Apply router) is
  irreducible and stays either way.
- **It would move complexity, not remove it.** Today the backend emits a tiny
  domain envelope (`{ok, proposal:{kind,...}}`). A2UI would push full
  component-tree construction into the backend; the frontend's bespoke
  `parseProposal` + previews would generify, but only the *presentation* half
  (~90 lines), at the cost of a verbose backend emission path.
- **The decision lever is type-count.** At ~8 proposal kinds, typed envelopes +
  this shared shell win. If the catalogue balloons (25–30 kinds), the per-type
  frontend cost scales linearly and a declarative renderer would start to pay
  off — revisit then. This migration (one shared shell) is the right
  centralisation for the current scale; A2UI is the next step only if breadth
  forces it.

**Conclusion:** finish the shared-shell migration below (custom, typed); keep
A2UI off for the teacher co-pilots; revisit only if proposal-type count balloons.

## Recon — what the migration needs (gathered 2026-06-27)

`_AuthoringCopilot.tsx` today: `AuthoringCopilot` (dark-flag `authoringCopilotEnabled()`) → `FloatingCopilot` (own copy) → `AuthoringCopilotResolver` (already uses the shared `useSkillSlugResolver`) → `AGUIProvider` → `AuthoringCopilotInner` (chat) + its own `ProposalCard` + `AddElementBody`. Exports consumed elsewhere: `Proposal`, `parseProposal` (tested directly), and `applyCopilotProposal` (from `applyCopilotProposal.ts`, used by both `[id]/page.tsx` and `new/page.tsx`).

**Keep unchanged:** `Proposal` union, `parseProposal`, `applyCopilotProposal`, the dark-flag, the `AuthoringCopilot({activityId, onApplyProposal})` public signature.

**Build an `authoringProposalDescriptor: ProposalDescriptor<Proposal>`:**
- `title` ← existing `proposalTitle` (Danish: "Forslag til lærer-prompt" / "Forslag: {label}" / "Forslag: brug en simulation").
- `editableText` ← existing `proposalEditableText` (`set_lesson_prompt.value`, else null).
- `withEditedText` ← existing `withEditedText`.
- `body` ← move the existing element/artefact previews here, **preserving their testids** (tests assert them): checklist→`proposal-items`, set_artefact→`proposal-sim`, note→`proposal-note`, solution/document→`proposal-prompt`, table→`proposal-table`, calculator→`proposal-calc` (+ chart). This is the bulk of the work (move `AddElementBody` + the artefact/note/prompt renderers into one `body(proposal)` function).

**Shell config additions** (so authoring keeps its Danish + testids — the shell defaults to English/`teacher-copilot`):
- `testId?: string` on the config → `CopilotChat` root data-testid (authoring passes `"authoring-copilot"`).
- `inputAriaLabel?: string` (input `aria-label`, distinct from `placeholder`) → `"Beskriv hvad du vil undervise i"`.
- `loadingText?: string` (the resolver loading line) → `"Indlæser medbygger…"`.
- `minimizeLabel?: string` on `FloatingCopilot` → `"Skjul medbygger"`.
- `labels` (already supported): `apply:"Anvend"`, `edit:"Rediger"`, `useEdited:"Brug denne"`, `dismiss:"Afvis"`, `applied:"Anvendt ✓ — du kan stadig rette det i feltet."`, `thinking:"Tænker…"`.
- `placeholder` → `"Fx: energibevarelse for en B-klasse…"`, `emptyText` → the existing Danish empty line.
- `scopePrefix` → `activityId ? `[activity_id=${activityId}] ` : ""` (conditional — the shell takes a plain string, so compute it).
- `stripPrefix` ← existing `stripActivityPrefix`.
- `persistKey` → `activity-authoring:${activityId}` (per-activity resume — a *new* benefit the migration grants).
- `onApplyProposal` → `(p) => applyCopilotProposal(p, builder)` (passed from the page, unchanged).

**Test adaptations** (`_AuthoringCopilot.test.tsx`):
- Add a `useSessionMessages` mock + an in-memory `localStorage` stub (the shell now resumes — see how `components/teacher/copilot/__tests__/TeacherCopilot.test.tsx` does it).
- The element-preview tests (`proposal-items`/`proposal-sim`/`proposal-note`/`proposal-prompt`/`proposal-table`/`proposal-calc`) pass unchanged **if** `descriptor.body` keeps those testids.
- The label/aria/testid tests (`anvend`, `rediger`, `afvis`, `skjul medbygger`, `beskriv hvad du vil undervise`, `authoring-copilot`) pass via the config knobs above.
- `parseProposal` direct tests are unaffected (it's unchanged).

## Milestones
- **M1** — add the shell config knobs (`testId`, `inputAriaLabel`, `loadingText`, `FloatingCopilot.minimizeLabel`). Tiny; keep defaults so the class/analytics co-pilots are unchanged.
- **M2** — build `authoringProposalDescriptor` (move the previews into `body`, preserving testids).
- **M3** — re-express `_AuthoringCopilot.tsx` on `<TeacherCopilot>`; delete the duplicate `FloatingCopilot`/resolver/inner/`ProposalCard`/`AddElementBody`. Keep the exports.
- **M4** — adapt the tests; run the full authoring + shell suites green; `quality:check`.

## Acceptance
- ✅ `_AuthoringCopilot.tsx` renders via `TeacherCopilot`; the duplicate chrome is gone (442 → 278 lines; the local `FloatingCopilot`/resolver/inner/`ProposalCard`/`AddElementBody` card path is deleted — `AddElementBody` survives only as the descriptor's per-kind `body` preview).
- ✅ All authoring tests pass (20 tests; adapted only for the `useSessionMessages` mock + an in-memory `localStorage` stub + the config knobs). `parseProposal` direct tests unchanged.
- ✅ The activity co-pilot now resumes across visits (per-activity, `persistKey: activity-authoring:${activityId}`), like the others — a new benefit.
- ✅ The class + analytics co-pilots are unchanged (shell defaults preserved; their suites + the full `/teacher` test scope (253 tests) + `tsc` + `next build` are green).
- ⏳ Browser-verify (per the co-pilot's own gate, behind `NEXT_PUBLIC_AUTHORING_COPILOT=1`): proposals still render + Apply round-trips on `/teacher/activities/[id]` and `/new`. **Open** — the unit tests cover render + Apply for every proposal kind with mocked tool results; the live SSE tool-result shapes are the part only a browser run exercises. Run via the `aitana-frontend-verify` skill before un-dark-flagging.

## Risk
The single real risk is regressing the other agent's shipped feature. Mitigations: it's their tests that gate it (run them constantly); the public signature + `parseProposal`/`applyCopilotProposal` are untouched; the shell is already proven on two surfaces. Coordinate timing so the file isn't being edited in parallel.
