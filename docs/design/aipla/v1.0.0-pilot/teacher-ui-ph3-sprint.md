# Sprint: TEACHER-UI-PH3 — Firebase OAuth swap + multi-class + analytics chat

**Sprint ID:** `TEACHER-UI-PH3`
**Design doc:** [teacher-ui.md](teacher-ui.md) — Phase 3 section
**Branch:** `feature/teacher-ui-ph3`
**Base commit:** `c0d2870` (dev HEAD as of 2026-05-26)
**Estimate:** ~2-2.5 days
**Created:** 2026-05-26
**Status:** queued (not started; runs **after the 3 June Phase 2 demo**)

## Sprint goal

Replace the LOCAL_MODE teacher stub from 1.G-Ph2 with **real Firebase OAuth (Google sign-in)** at `/teacher/*`. Wire the dashboard against 1.A's `is_teacher` gate so a teacher signs in with their UCPH Google Workspace identity, lands on their dashboard, and sees real classes from `GET /api/classes`. Also: multi-class filter on reports + analytics chat skill template + CLI parity.

This is the sprint that 1.A explicitly does NOT do — 1.A produced the backend; this consumes it on the frontend.

## Scope locks

**In scope:**
- Firebase OAuth (Google provider) sign-in flow at `/teacher/sign-in` — extends existing `frontend/src/lib/firebase.ts` paths
- Route guard hook `useTeacherAuth` (or extension of `AuthContext`) that redirects unauthed `/teacher/*` to sign-in
- Token forwarding: every `/api/proxy/api/classes/*` call carries the Firebase ID token (already supported by `fetchWithAuth` — verify wiring)
- Drop the LOCAL_MODE teacher stub for `/teacher/*` (LOCAL_MODE auth still works for dev — students still hit anonymous-group)
- Multi-class filter dropdown on `/teacher/reports` and `/teacher/analytics`
- Class CRUD via the dashboard (POST/PATCH/DELETE flows already wired in 1.G-M7; just remove any LOCAL_MODE-only branches)
- New `analytics-chat` skill template (teacher-only via `role:teacher` tag from 1.A M8)
- Opt-in share flow on student side (session end → "send summary to teacher?" toggle) + teacher report flag
- CLI parity: confirm `aiplatform class new/list/get/lessons/groups/delete` (shipped in 1.A M9) work end-to-end against a deployed dev backend; document any auth-token-acquisition steps

**Out of scope:**
- UCPH SSO federation (still Firebase Google provider — UCPH teachers all have Google Workspace; UCPH SSO is v2 per teacher-permission-model.md non-goals)
- Multi-school institutional admin (UCPH-level admin above teachers — v2)
- Per-student analytics (only per-group, per ADR-001 anonymity model)
- Video/audio recording on report screen (1.H territory)
- Class transfer between teachers (v2 admin concern)

## Workflow

Direct-to-dev per [feedback-aipla-git-workflow](file:///Users/voightkampff/.claude/projects/-Users-voightkampff-dev-sunholo-data-cphu-aipla-app/memory/feedback_aipla_git_workflow.md). Branch `feature/teacher-ui-ph3` is the executor scratch space; FF-merge to `dev`. Test/prod gates still PR-based.

## Milestones

| # | What | Files | LOC est |
|---|---|---|---|
| M1 | `useTeacherAuth` hook — Firebase Auth state subscription + redirect to sign-in when missing | `frontend/src/hooks/useTeacherAuth.ts` (new), tests | 180 |
| M2 | `/teacher/sign-in` page — Google OAuth button → `signInWithRedirect` → redirect to `/teacher/classes` on success | `frontend/src/app/teacher/sign-in/page.tsx` (new), tests | 160 |
| M3 | AuthContext extension — surface Firebase teacher token alongside (not instead of) anon-group state; `fetchWithAuth` picks the right one per route | `frontend/src/contexts/AuthContext.tsx`, tests | 200 |
| M4 | Route guard wiring — `/teacher/*` layout uses `useTeacherAuth`; unauthed → redirect; LOCAL_MODE stub remains for dev | `frontend/src/app/teacher/layout.tsx`, tests | 100 |
| M5 | Multi-class filter dropdown on reports + analytics pages | `frontend/src/app/teacher/reports/page.tsx`, `analytics/page.tsx`, tests | 250 |
| M6 | `analytics-chat` skill template (teacher-only via role:teacher tag) | `backend/skills/templates/analytics-chat/SKILL.md`, `backend/admin/platform_seed.py` (verify seeding), tests | 200 |
| M7 | Student-side opt-in share toggle on session end + teacher report flag display | `frontend/src/app/chat/[...path]/page.tsx` (session-end UI), `frontend/src/app/teacher/reports/...`, backend route for the flag | 280 |
| M8 | CLI smoke against deployed dev — `aiplatform class new/list/get/lessons/groups/delete` round-trips against real Firebase auth | `scripts/smoke-v1-teacher-cli.sh` (new) | 80 |
| M9 | Quality gates + direct-to-dev merge | — | 60 |

**Total:** ~1500 LOC (impl + tests). ~2-2.5d wall-clock.

## Acceptance gates

- [ ] Visiting `/teacher/classes` unauthed redirects to `/teacher/sign-in`
- [ ] Google OAuth sign-in completes, lands on `/teacher/classes` within ~1.5s TTI
- [ ] Real teacher token forwarded to `/api/classes/*` calls; teacher sees only their own classes
- [ ] Existing 1.G-M7 forms (create class, mint codes) work against real Firebase auth
- [ ] Multi-class filter dropdown works on reports + analytics
- [ ] `analytics-chat` skill visible to teachers via `GET /api/skills` (carries `role:teacher` tag); hidden from anonymous students
- [ ] Student session-end share toggle flips a Firestore flag the teacher report reads
- [ ] CLI `aiplatform class new/list/get/lessons/groups/delete` work against deployed dev with real auth
- [ ] LOCAL_MODE auth still works for dev (workshop user still flagged `is_teacher` per 1.A M3)
- [ ] No emoji
- [ ] Backend `make test-fast` + frontend `npm run quality:check` both green
- [ ] Direct-to-dev FF merge

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Firebase console config (OAuth redirect URIs, allowed domains) not set up for production | Medium | Document the manual gcloud / Firebase console steps in `aipla-cloud-bootstrap.md`; surface in M2 acceptance gate that this is a manual prerequisite |
| Firebase Auth's signInWithRedirect cookie/COOP/COEP interactions with the existing Next.js setup | Medium | The inherited template already has the `signInWithRedirect` paths wired (just unused); reuse them. Test on staging first |
| AuthContext extension breaks existing `/group` + `/chat/*` flows | Medium | Extend (not replace) the existing state; add tests for both auth-mode branches before touching shared code |
| `analytics-chat` skill prompt design needs JB input | Low | Ship a v0.1 skeleton this sprint; JB iterates on the prompt content separately (no extra sprint needed for prompt tweaks) |
| Opt-in share toggle changes session-end UX in ways v0.1 demo flow wasn't designed for | Medium | Make it strictly opt-in + dismissible; default off; verify the existing chat flow unchanged when the toggle is off |

## Dependencies

- **1.A teacher-permission-model** — must be merged (done as of `997a85b`)
- **Firebase project console** — OAuth provider must be enabled with the production redirect URIs added. Manual step (M's action, not the executor's)
- **1.G-Ph2 LOCAL_MODE wiring** — already shipped; this sprint REPLACES the stub gate, not the data layer

## Out of scope (do NOT start)

- UCPH SSO federation (v2)
- Multi-school admin
- Per-student analytics
- Audio/video on reports (1.H)
- Class transfer between teachers
- BigQuery chat-log pipeline (1.2 separate sprint)
