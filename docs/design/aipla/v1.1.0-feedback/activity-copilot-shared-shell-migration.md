# Migrate the activity co-pilot onto the shared co-pilot shell

**Status:** DESIGN (2026-06-27). The fast-follow from [teacher-coworking-copilot.md](teacher-coworking-copilot.md) Part 1. The shared shell shipped and is reused by the class + analytics co-pilots; the **activity-authoring** co-pilot still has its own duplicate copy of the chrome. No code yet.
**Last Updated:** 2026-06-27 (recon done while shipping Parts 1–4a).
**Priority:** **P2** — pure internal de-duplication (no new user-facing capability), so it's not urgent — BUT it's the thing that makes the centralisation real (one shell, not "a shell + the original"). Worth doing before the shell and `_AuthoringCopilot` drift.
**Estimated:** ~1–1.5d (mechanical but touches a 15-test file).
**Scope:** Frontend only — `frontend/src/components/teacher/copilot/` (small config additions), `frontend/src/app/teacher/activities/[id]/_AuthoringCopilot.tsx` (re-express on the shell, delete the duplicate chrome), `frontend/src/app/teacher/activities/[id]/__tests__/_AuthoringCopilot.test.tsx` (adapt to the shell). No backend, no reseed.
**Dependencies:** the shared shell (`TeacherCopilot`, `FloatingCopilot`, `ProposalCard`, `ProposalDescriptor`). ⚠ `_AuthoringCopilot.tsx` is the **other agent's actively-developed, richly-tested file** (7 element kinds, 15 tests) — coordinate so it isn't mid-edit; do it against their tests.

## Why this exists

The shared shell (`components/teacher/copilot/`) was **extracted from** the activity co-pilot, then used to build the class + analytics co-pilots. The activity co-pilot still runs its own copy of the floating panel, slug→UUID resolver, chat loop, and proposal card (~250 lines). Migrating it onto `TeacherCopilot` removes the duplication, gives it **cross-visit resume for free** (Part 4a), and means future co-pilot changes happen in one place.

**No behaviour change is the bar.** This is a refactor; all 15 authoring tests must still pass (after the adaptations below).

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
- `_AuthoringCopilot.tsx` renders via `TeacherCopilot`; the duplicate chrome is gone (~250 lines removed).
- All 15 authoring tests pass (adapted only for the resume mock + the config knobs).
- The activity co-pilot now resumes across visits (per-activity), like the others.
- The class + analytics co-pilots are byte-for-byte unchanged (shell defaults preserved).
- Browser-verify (per the co-pilot's own gate): proposals still render + Apply round-trips on `/teacher/activities/[id]` and `/new`.

## Risk
The single real risk is regressing the other agent's shipped feature. Mitigations: it's their tests that gate it (run them constantly); the public signature + `parseProposal`/`applyCopilotProposal` are untouched; the shell is already proven on two surfaces. Coordinate timing so the file isn't being edited in parallel.
