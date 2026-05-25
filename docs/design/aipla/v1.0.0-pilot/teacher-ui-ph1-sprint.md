# Sprint: TEACHER-UI-PH1 — teacher-UI Phase 1 (static mockup)

**Sprint ID:** `TEACHER-UI-PH1`
**Design doc:** [teacher-ui.md](teacher-ui.md) (sections "Phased delivery" + "Implementation Plan — Phase 1" + "Cloud-agent kick-off note (Phase 1)")
**Wireframes (source of truth):** `teacher-ui-brief.md` in the scoping site at `/Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/teacher-ui-brief.md` — **not in this repo; cloud agent needs filesystem access OR the wireframes pasted into the PR description**
**Branch:** `feature/teacher-ui-mockup` (off `c05d9be` on `origin/dev`)
**PR target:** `dev`
**Estimate:** ~0.85–1.05 day (4 milestones)
**Created:** 2026-05-25

## Sprint Goal

Ship a click-through, visually polished static mockup of the five teacher screens at `/teacher/*` so JB and M can iterate on the UI within 48h, without waiting on the 1.A → 1.G dependency chain. **No backend, no Firestore, no Firebase.** All data hardcoded in one fixture file.

This unblocks 1.G's critical path off 1.A and de-risks the Wed 3 June teacher demo.

## Scope (locked from design doc)

**In scope:**
- 5 routes under `/teacher/*` rendering hardcoded data
- `LOCAL_MODE` OR `NEXT_PUBLIC_TEACHER_MOCK=1` route-guard bypass (no Firebase)
- Mobile + desktop responsive (Tailwind)
- lucide-react icons throughout — **no emoji** (per [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md))
- Cosmetic toast interactions for "+ New group" and "Save configuration"
- Vitest smoke per screen (renders without crash)
- `npm run quality:check` green

**Out of scope (Phase 2 / Phase 3):**
- Any backend changes (no `ActivityConfig`, no Firestore writes, no `Class` entity)
- Firebase auth (Phase 3)
- Real session-report data (Phase 2 uses real ADK session state)
- CLI parity (Phase 3)
- Analytics-chat skill template (Phase 3)
- `/teacher/activities` library index, `/teacher/reports` index — Phase 1 only ships the 5 named screens

**Routes NOT to touch:** `/`, `/group`, `/chat/*`, `/skills/*`, `/lessons`, anything in `backend/` or `cli/`.

## Velocity context

Last-14-day repo velocity: 90 commits / 23,862 insertions across 147 files including a full 6-milestone sprint (MCPAPP-SPEC), 5 new design docs, and assorted bug fixes. Phase 1's ~1-day target sits comfortably below the demonstrated single-sprint throughput. Risk is misalignment with the scoping-site wireframes, not capacity.

## Milestones

### M1 — Scaffolding (~0.15d, ~160 LOC)

**Scope:** frontend
**Goal:** Route group + layout + auth bypass + single-source-of-truth fixture file.

| File | Purpose | LOC |
|---|---|---|
| `frontend/src/app/teacher/layout.tsx` | Route guard: pass if `isLocalMode()` OR `process.env.NEXT_PUBLIC_TEACHER_MOCK === "1"`; else show "sign-in required" placeholder. Breadcrumb / nav chrome. `<AppFooter />`. | ~80 |
| `frontend/src/app/teacher/_mock-data.ts` | Single fixture file: `MOCK_CLASSES`, `MOCK_GROUPS`, `MOCK_ACTIVITIES`, `MOCK_SESSION_LOG`, `MOCK_ANALYTICS_ANSWER`. Typed exports. | ~60 |
| `frontend/src/app/teacher/page.tsx` | `/teacher` root → redirect to `/teacher/classes`. | ~20 |

**Acceptance:**
- [ ] `/teacher` redirects to `/teacher/classes` when bypass is active
- [ ] `/teacher` shows "sign-in required" placeholder when bypass is inactive (no Firebase call)
- [ ] All five Phase 1 screens import from `_mock-data.ts` (no duplicated fixture data)

**Patterns to mirror:**
- `frontend/src/app/group/page.tsx` — `isLocalMode()` check at top
- `frontend/src/components/AppFooter.tsx` — global footer
- `frontend/src/lib/branding.ts` — brand strings

---

### M2 — Five screens (~0.5d, ~880 LOC)

**Scope:** frontend
**Goal:** All 5 `/teacher/*` screens render hardcoded data, visually polished, responsive.

| File | Screen | LOC est | Per design doc |
|---|---|---|---|
| `frontend/src/app/teacher/classes/page.tsx` | Dashboard: class list + recent-activity list | ~150 | line 306 |
| `frontend/src/app/teacher/classes/[id]/page.tsx` | Class detail: groups + assigned activities + "+ New group" button | ~200 | line 307 |
| `frontend/src/app/teacher/activities/[id]/page.tsx` | Activity config: teaching-goal textarea + language + difficulty + "Save" button | ~180 | line 309 |
| `frontend/src/app/teacher/reports/groups/[groupId]/page.tsx` | Per-group session report with conversation log | ~200 | line 311 |
| `frontend/src/app/teacher/analytics/page.tsx` | Analytics chat surface, single hardcoded Q&A | ~150 | line 312 |

**Acceptance:**
- [ ] All 5 routes reachable from `/teacher/classes` (or via direct URL) in <1s with LOCAL_MODE backend
- [ ] Mobile-first responsive: usable at 375px width, polished at desktop 1280px+
- [ ] All icons are lucide-react components; **no emoji** anywhere in JSX or strings
- [ ] No prop drilling of mock data — each page imports directly from `_mock-data.ts`
- [ ] Visual hierarchy + Tailwind classes consistent with existing pages (`/group`, `/skills`)

**Anti-scope (do not do):**
- No API calls, no `fetch`, no `useEffect` with network side-effects
- No state stored in localStorage / sessionStorage
- No real `Class` / `Group` / `ActivityConfig` types yet — use plain inline TypeScript types in `_mock-data.ts`

---

### M3 — Interactions + tests (~0.2d, ~150 LOC tests)

**Scope:** frontend
**Goal:** Cosmetic interactions on the two screens that need them; vitest smoke per screen.

| Interaction / test | Where | LOC |
|---|---|---|
| "+ New group" button → toast with fake `adjective-noun-NN` code + copy-to-clipboard | `classes/[id]/page.tsx` | inline ~20 |
| "Save configuration" button → toast `"Saved (mock)"`, textarea value persists in local component state | `activities/[id]/page.tsx` | inline ~15 |
| `classes/__tests__/page.test.tsx` — renders class list | new | ~30 |
| `classes/[id]/__tests__/page.test.tsx` — renders class + "+ New group" toast on click | new | ~35 |
| `activities/[id]/__tests__/page.test.tsx` — renders form + "Save" toast on click | new | ~35 |
| `reports/groups/[groupId]/__tests__/page.test.tsx` — renders conversation log | new | ~25 |
| `analytics/__tests__/page.test.tsx` — renders Q&A | new | ~25 |

**Acceptance:**
- [ ] Both interactions produce a visible toast on click (use the project's existing toast mechanism; mirror what `/group` does for inline errors if no toast component exists)
- [ ] Activity-config textarea value persists across re-renders within the same session (component state)
- [ ] All 5 vitest files pass — `npm run test:run -- teacher` green
- [ ] `npm run quality:check:fast` green (lint + typecheck)

**Patterns to mirror:**
- Existing vitest tests under `frontend/src/app/group/__tests__/` and `frontend/src/app/dev/mcp-apps/__tests__/`

---

### M4 — Acceptance + PR (~0.15d)

**Scope:** frontend (no new code, verification + PR prep)
**Goal:** Pass all Phase 1 acceptance gates and open PR against `dev`.

**Acceptance gates (from design doc lines 69–75):**
- [ ] `/teacher/classes` loads at LOCAL_MODE root within 1s
- [ ] All five screens reachable + visually polished (mobile + desktop)
- [ ] "+ New group" interaction works (fake code appears in toast)
- [ ] Activity config "Save" round-trips visually (toast appears, value stays in textarea)
- [ ] Reports screen shows realistic-looking session data
- [ ] `npm run quality:check` green (full CI parity — lint + typecheck + tests + build)
- [ ] No emoji anywhere — grep `frontend/src/app/teacher` for emoji unicode ranges to confirm
- [ ] **Awaits M + JB visual sign-off** before Phase 2 starts (out-of-scope for agent — agent opens PR + tags reviewers)

**PR description must include:**
- Link to [teacher-ui.md](teacher-ui.md) Phase 1 section
- A screenshot of each of the 5 screens at mobile + desktop widths (10 total)
- Confirmation that the scoping-site `teacher-ui-brief.md` was followed (or, if unreachable, a request for M to verify visual fidelity)
- Explicit "Phase 2 + 3 not included — separate PRs" note

**STOP after this milestone.** Do not begin Phase 2 work.

## Quality gates

- `cd frontend && npm run quality:check:fast` after each milestone
- `cd frontend && npm run quality:check` (full CI parity — tests + build) before opening PR
- No backend commands needed — Phase 1 is FE-only

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Cloud agent can't reach scoping-site wireframes (`/Users/mark/Documents/clients/cph-uni/...`) | High (depends on agent's environment) | If unreachable: paste ASCII wireframes into the PR description as a fallback source of truth; flag in M1 of the agent's first commit |
| Visual drift from JB's expectations | Medium | M4 mandates 10 screenshots in PR description; M+JB sign-off is a hard gate |
| Toast component doesn't exist in the project | Low | Audit `frontend/src/components/` first; if missing, use a minimal inline `aria-live` div rather than introducing a dependency |
| Emoji slip past review | Low | Lint config + explicit grep in M4 acceptance gate |
| Scope creep into Phase 2 (e.g. "while I'm here, let me wire one API call…") | Medium | Hard STOP after M4; sprint plan explicitly forbids it |

## Files NOT to touch

- Anywhere in `backend/`
- Anywhere in `cli/`
- `frontend/src/app/{,group,chat,skills,lessons,dev,skill,credits,workshop,privacy,terms,api}/...`
- `frontend/src/contexts/AnonymousGroupAuthProvider.tsx` and friends
- `firebase.json`, `firestore.rules`

## Success criteria

- [ ] PR opened against `dev` from `feature/teacher-ui-mockup`
- [ ] All 4 milestones' acceptance gates met
- [ ] All Phase 1 acceptance gates from [teacher-ui.md](teacher-ui.md#phase-1--static-mockup-start-now-051d) met
- [ ] No Phase 2 / Phase 3 work mixed in
- [ ] CI green on the PR

## Out of scope (do not start)

Per "STOP after Phase 1" instruction in the design doc:

- Real `ActivityConfig` model + CRUD (Phase 2)
- Firestore writes (Phase 2)
- Firebase auth swap (Phase 3)
- Analytics-chat skill template (Phase 3)
- CLI parity (Phase 3)
- 1.E debounce, 1.A backend work — separate sprints, agent does not begin these
