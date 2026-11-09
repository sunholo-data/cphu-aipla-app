---
name: ui-guidelines-check
description: Check AIPLA frontend code against Vercel's web interface guidelines (accessibility, focus, forms, navigation and URL state, copy) and this repo's own UI rules (useT copy, KU brand tokens, the components/ui kit, the 11px floor, the right auth helper per surface), reporting file:line findings. Use before pushing a change to frontend/src, when asked to review UI code, check accessibility or audit a component, or as the per-file pass inside a teacher/researcher/student UI sweep. Scoped to the files given or the diff; it does not judge layout or how busy a screen is.
---

# UI guidelines check

Ported from `platform-source` (`.claude/skills/ui-guidelines-check`, added
upstream 2026-11-05 in #175) and adapted to AIPLA. It catches what a visual
review misses: mouse-only controls, focus that disappears, errors no one hears,
Back that leaves the app. **It says nothing about layout or how busy a screen
is**; a simplification sweep has to judge that separately, per page.

## Steps

1. **Scope.** The files the user names, or the changed UI files:
   `git diff --name-only origin/dev...HEAD -- 'frontend/src/**/*.tsx' ':!**/__tests__/**'`
   (on `dev` with nothing unpushed, use `HEAD~N..HEAD`). Review the changed
   hunks and the component they sit in, not the whole repo.
2. **Rules.** Fetch the current guidelines:
   `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
   Then apply AIPLA's own rules below.
3. **Check** each file against both. Read the line before reporting it.
4. **Report** in the guideline's terse `file:line – issue → fix` format,
   grouped by file, real problems first. Fix what's in scope for the change.

## AIPLA's own rules (these fail CI or have shipped as bugs)

- **Copy goes through `useT(namespace)` from `@/i18n`**, messages in
  `frontend/messages/{da,en}/*.json`. Danish is the default locale. No inline
  JSX strings on student or teacher surfaces (`make check-i18n`).
- **Brand is a token.** `bg-primary` / `text-brand` / `--brand` (KU red), never a
  `red-*` literal (`make check-brand-literals`) and never the inherited Sunholo
  `orange-*` (not yet guarded; report it).
- **Use the kit** in `components/ui/`: `Button` (with `pending`), `Spinner`,
  `Skeleton`, `Badge`, `useConfirm()` instead of `window.confirm`, `notify()`
  for toasts, `useAsyncAction` for a click that awaits. A second hand-rolled
  spinner or confirm is a finding.
- **Nothing below 11px** (`src/app/__tests__/min-text-size.test.ts`).
- **Auth helper by surface:** student surfaces use `fetchWithAuth`, teacher
  surfaces `fetchWithTeacherAuth`; a dual-audience endpoint lets the caller pick.
  The wrong one is a 401 for every anonymous student (see CLAUDE.md).
- **No silent wait and no silent failure.** A load that fails shows Retry, not
  an empty state that reads as "you have none". A handled error the user cannot
  see is a finding even when nothing throws.

## Skip these (they don't fit this app)

- Title Case for headings and buttons: the app uses sentence case.
- Dark-mode rules (`color-scheme`, `theme-color`): `globals.css` carries `.dark`
  tokens, but no dark theme is switched on.
- `width`/`height` on images sized by CSS, and `touch-action` everywhere.
- Icons already marked `aria-hidden`, and lucide icons inside a labelled button.
- Sims under `infrastructure/mcp-sandbox/artefacts/`: they have their own gates
  (`mcp-app-artefact` skill).

Expect roughly a quarter of raw findings to be noise like this; leave it out of
the report rather than listing it.
