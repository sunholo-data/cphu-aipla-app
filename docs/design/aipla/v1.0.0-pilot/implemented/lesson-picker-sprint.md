# Sprint: LESSON-PICKER-1B — `/lessons` route replaces hardcoded post-join redirect

**Sprint ID:** `LESSON-PICKER-1B`
**Design doc:** [lesson-picker.md](lesson-picker.md)
**Branch:** `feature/lesson-picker`
**Base commit:** `c0d2870` (dev HEAD as of 2026-05-26)
**Estimate:** ~0.5 day — FE-only, no backend changes
**Created:** 2026-05-26
**Status:** queued (not started)

## Sprint goal

After `/group` join, the student lands on `/lessons` — a page that fetches `GET /api/skills` and renders a card per accessible skill, linking to the existing `/chat/<skill_path>`. Replaces the v0.1 hardcoded `POST_JOIN_REDIRECT` env var that hard-locked the system to one skill. Unblocks 1.C/1.D visibility for students.

## Scope locks

**In scope (FE-only — `git diff backend/` empty at end of sprint):**
- New `/lessons` route component (Next.js app router)
- Uses existing `fetchWithAuth(GET /api/skills)` — endpoint already filtered by `AccessContext.can_access()` via M5 of teacher-permission-1A
- Card rendering: `displayName` (or `name` fallback) + `description` + link to `/chat/<owner-slug>/<skill-slug>`
- Empty-state copy (Danish + English): *"Ingen lektioner tilgængelige endnu. Spørg din lærer. / No lessons available yet. Ask your teacher."*
- Mobile-responsive (grid on desktop, stack on mobile — same pattern as `/teacher/classes` cards)
- Update `/group` page to `router.replace("/lessons")` (drops the `POST_JOIN_REDIRECT` env read)
- Optional: also reachable as the home redirect for anon-group sessions

**Out of scope:**
- Search / filtering UI (v1 has ~3 skills max; not warranted)
- Skill descriptions richer than `Skill.description` carries
- Per-student lesson history ("continue where you left off") — v2
- Teacher-curated lesson order (alphabetical by `displayName` for v1)
- Backend changes — `GET /api/skills` is already filtered

## Milestones

| # | What | Files | LOC | Tests |
|---|---|---|---|---|
| M1 | New `/lessons` route + page component fetching `GET /api/skills` via `fetchWithAuth` | `frontend/src/app/lessons/page.tsx` (new) | ~140 | 3 |
| M2 | Lesson card component + responsive grid | inline in `page.tsx` OR `frontend/src/components/lessons/LessonCard.tsx` | ~90 | 2 |
| M3 | Empty state + error state copy (Danish + English) | same page | ~30 | 2 |
| M4 | Update `/group` post-join redirect to `/lessons`; drop `POST_JOIN_REDIRECT` env-var read | `frontend/src/app/group/page.tsx` | ~10 | 1 |
| M5 | Tests + quality gates + direct-to-dev merge | `__tests__/page.test.tsx` | ~120 | — |

**Total:** ~390 LOC (impl + tests). ~0.5d wall-clock per design doc estimate.

## Acceptance gates

- [ ] After `/group` join, student lands on `/lessons` (not `POST_JOIN_REDIRECT`)
- [ ] Page TTI < 1s on local dev (one API call, no streaming)
- [ ] Each card links to a working `/chat/<skill>` URL
- [ ] Empty state renders when the user has access to zero skills
- [ ] Error state renders with retry when the API fails
- [ ] Class-bound student (after 1.A) sees only their class's lessons; anon-only student sees public skills only — same component renders both
- [ ] Mobile + desktop responsive
- [ ] No emoji
- [ ] No backend changes (`git diff backend/` shows zero modifications)
- [ ] Frontend `npm run quality:check` green
- [ ] Direct-to-dev FF merge, no PR

## Risks

| Risk | Mitigation |
|---|---|
| `/chat/<skill_path>` URL shape varies by owner (`@aipla-platform/<slug>` vs other owners) | Skill response carries `slug` + `ownerId`; derive the path consistently in one helper |
| Some skills lack `displayName` and only have `name` | Fall back to `name` when `displayName` is empty (defensive; platform_seed sets both for v1 skills) |
| The page renders before auth is established | Use existing `AnonymousGroupAuthProvider` gating pattern from `/chat/[...path]` — wait for token then fetch |

## Recommended position in queue

**FIRST** — small, FE-only, no dependencies, unblocks 1.C/1.D visibility. Good warm-up sprint while team reviews the larger work. Could execute in a single session.
