# Sprint SETTINGS-1 — teacher account defaults + beta-features opt-in

**Design doc:** [teacher-account-defaults.md](teacher-account-defaults.md) (1.1.58)
**Sprint ID:** `SETTINGS-1` · **Created:** 2026-07-11 · **Estimated:** 1–1.5 days (~700 LOC incl. tests)

## Goal

Teachers get their first account-level settings: default activity language (seeds the builder),
default class persona (applied at class create), and the beta-features opt-in that lets a
dark-flagged feature graduate to runtime opt-in (`'1'` / `'beta'` / `''`) without a rebuild.
Defaults SEED contextual controls at create-time only — hydrate/edit paths never re-apply them.

## Milestones

### M0 — prefs store + API (backend, ~180 LOC)
`backend/db/teacher_prefs.py` (get/merge-put on `teacher_prefs/{uid}`) +
`backend/protocols/teacher_prefs_routes.py`: `GET /api/teacher/prefs` (`{}` when unset),
`PUT /api/teacher/prefs` (partial, `extra="forbid"`, validates language ∈ {da,en} and
`features` as str→bool). Own-uid only — the uid comes from the token, never a param.
Registered in `fast_api_app.py`. API tests: own-doc round-trip, partial merge, unknown-field 422,
students-can't (group-auth user has a synthetic uid — assert the route requires teacher auth
shape... see auth note in the code).

### M1 — Defaults card in settings (frontend, ~280 LOC)
`useTeacherPrefs` hook (GET once, PUT partial, optimistic local state) +
`_DefaultsCard.tsx` in `/teacher/settings` for ALL teachers (above the researcher panel):
language select (da/en/unset), persona select from the existing catalogue endpoint (unset option),
beta toggles listing flags currently in `'beta'` (designed empty state when none). Vitest.

### M2 — seeding + tri-state feature hook (fullstack, ~240 LOC)
- Builder `/new`: initial `language` from `prefs.defaultLanguage` (edit page hydrate untouched —
  tested explicitly, the anti-fight rule).
- Class create: on success, when `defaultPersonaId` set, apply via the same persona-update call
  ClassPersonaPanel uses.
- `useTeacherFeature(key, buildValue)`: `'1'`→true · `'beta'`→prefs opt-in · else false; convert
  the authoring-co-pilot visibility check to it (dev value stays `'1'` → behaviour unchanged).
  Vitest for all three states.

## Risks
Default-fights-control (mitigation: create-time seeding only, tested); dead-knob creep (three
settings, each with an existing consumer); `'beta'` ≠ security boundary (card copy states it).

## Gates
Per milestone: BE `make lint && make test-fast` · FE `npm run quality:check`. Commits straight to
dev, rebase before push.
