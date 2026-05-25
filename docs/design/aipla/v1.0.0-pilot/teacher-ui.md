# Teacher UI — dashboard, class detail, activity config, session reports, analytics chat

**Status**: Planned (phased — see "Phased delivery" below)
**Priority**: P0 — **demo target for Wed 3 June check-in** per the 2026-05-25 meeting
**Estimated**: ~5-6 days total split across three phases (mockup → wired → stretch). Per the 2026-05-25 evening compression decision M asked for "teacher UI or at least a mockup ASAP" — see "Phased delivery" below for how that reshapes execution
**Cloud agent ready**: this doc + the SEQUENCE update commit lands on `dev`; a cloud agent can branch from `dev` and start Phase 1 immediately
**Scope**: Fullstack — frontend (5 new screens, 4 routes under `/teacher/*`), backend (activity-config CRUD, session-report aggregator, analytics-chat skill template), CLI (extend `aiplatform` for ops parity)
**Dependencies**: [teacher-permission-model.md](teacher-permission-model.md) (1.A — provides Firebase teacher auth + `Class` entity + Group → Class binding). **1.A is the structural prerequisite — this doc consumes the teacher-auth path 1.A introduces and adds the surfaces on top.** Soft dep on [session-persistence.md](session-persistence.md) (1.F) for "reset session" + accurate "last-active" timestamps; soft dep on [lesson-picker.md](lesson-picker.md) (1.B) for the activity-library browse pattern.
**Pedagogical source-of-truth:** [`teacher-ui-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/teacher-ui-brief.md) in the scoping site
**Created**: 2026-05-25
**Last Updated**: 2026-05-25

## Problem Statement

The 2026-05-25 meeting committed to a Wed 3 June teacher demo. Teachers in that demo need to:

1. **Sign in** (Firebase / UCPH SSO via 1.A)
2. **See their classes + groups**
3. **Configure an activity for their class** — most importantly: enter a *teaching goal* in plain language, not write a system prompt
4. **See session reports** — what happened with a specific group + the option to share back to students
5. **Chat with session data** — ask analytical questions across their classes ("what did students struggle with this week?")

[teacher-permission-model.md](teacher-permission-model.md) (1.A) gave us the **data + auth model** (teacher Firebase auth, `Class` entity, tag namespace, group→class binding, AccessControl propagation). It deliberately did **not** scope UI screens — that's this doc. The two are designed as a pair: 1.A is the foundation, 1.G is the surface.

**Current State:**

- No `/teacher/*` routes exist on the frontend.
- No teacher dashboard, no class detail screen, no activity config screen.
- Activity config (the "teaching goal" injection) doesn't exist as a concept — current platform skills carry their own static system prompts. The teaching-goal injection is a new pattern.
- Session reports don't exist; chat history lives in ADK session state, not in any aggregated report surface.
- BigQuery sink for chat logs (1.2 in [../SEQUENCE.md](../SEQUENCE.md)) isn't live yet — analytics chat depends on it being landed first OR on a Firestore-only fallback for the demo.
- No "analytics chat" skill template — the teacher-facing skill that answers questions about session data.

**Impact:**

- **Demo blocker** for Wed 3 June if not built.
- v1.0.0-pilot's teacher commitment per [strands.qmd](file:///Users/mark/Documents/clients/cph-uni/strands.qmd) ("5 skills + curated sim library + teacher config + ...") goes un-delivered without the config surface.
- Per-group accountability and pedagogical iteration (teachers refining their teaching goal based on what students did) becomes impossible without reports.
- "AIPLA = a platform teachers run, not an end-user app" framing requires teachers to feel ownership of their classes inside the platform.

## Phased delivery (per 2026-05-25 evening compression decision)

M asked for **"teacher UI or at least a mockup ASAP"** to give JB / AR something visual to iterate against in days rather than weeks. The 1.A→1.G dependency chain (~6-8d minimum) was at risk for the Wed 3 June check-in. Compression: split the work into three phases that each ship value without throwing away earlier work.

### Phase 1 — Static mockup (start NOW, ~0.5-1d)

**Goal:** All five teacher screens render in the actual Next.js app at `/teacher/*` with **hardcoded data**, **no backend**, **no Firebase**. LOCAL_MODE bypass for any auth check. Real React + Tailwind code path — not a Figma file — so Phase 2 wires the data without rewriting the UI.

**What ships:**

- `/teacher/classes` — dashboard with hardcoded class list + recent activity list
- `/teacher/classes/[id]` — class detail with hardcoded groups + activities, "+ New group" button shows a fake code in a toast
- `/teacher/activities/[id]` — activity config screen, teaching-goal textarea, "Save" shows a "Saved (mock)" toast
- `/teacher/reports/groups/[groupId]` — single-group session report with hardcoded conversation log
- `/teacher/analytics` — analytics chat surface with a single hardcoded "What did students struggle with?" answer

**Auth in Phase 1:** route guard checks `isLocalMode()` OR `process.env.NEXT_PUBLIC_TEACHER_MOCK === "1"`. No Firebase. Cloud agent runs against LOCAL_MODE backend. JB / AR can be shown the mockup by hitting `/teacher` directly with no sign-in.

**What's deliberately NOT in Phase 1:**

- No `ActivityConfig` Firestore writes
- No `Class` entity
- No real session data lookup (reports use the hardcoded conversation log)
- No CLI parity (deferred to Phase 3)
- No analytics chat skill template (Phase 3)

**Acceptance gates for Phase 1:**

- [ ] `/teacher/classes` loads at LOCAL_MODE root within 1s
- [ ] All five screens reachable + visually polished (mobile + desktop)
- [ ] "+ New group" interaction works (fake code appears in toast)
- [ ] Activity config "Save" round-trips visually (toast appears, value stays in textarea)
- [ ] Reports screen shows realistic-looking session data
- [ ] `npm run quality:check` green; no emoji per [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md)
- [ ] M + JB visual sign-off on the mockup before Phase 2 starts

### Phase 2 — Wired to real backend, LOCAL_MODE teacher auth (~2-2.5d)

**Goal:** Phase 1's screens get wired to real backend endpoints. Teacher auth still uses LOCAL_MODE stub (1.A's Firebase path lands in parallel and gets swapped in for Phase 3). `ActivityConfig` is real; session reports read from real ADK session state.

**What ships:**

- Real `ActivityConfig` Pydantic model + Firestore CRUD + REST CRUD
- Activity config save writes to Firestore; next student session reads `{teacher_focus}` from the doc + injects into the skill prompt
- Reports screen reads from real ADK session state via the existing `GET /api/sessions/{id}/state` + new session-summary aggregator
- Class detail screen reads from a **mocked `Class` entity** stored in Firestore but not gated by Firebase ownership yet — every LOCAL_MODE teacher is treated as the owner of one seeded demo class
- All Phase 1 acceptance gates still pass (Phase 1's screens are the same screens — just wired)

**What's deliberately NOT in Phase 2:**

- Firebase teacher auth (Phase 3 — comes with 1.A)
- Multi-class scoping (one demo class only)
- Class CRUD UI (creating new classes from the UI; Phase 3)
- Group mint via API (Phase 2 uses a backend endpoint stub; the real `aiplatform group new` integration is Phase 3)

**Acceptance gates for Phase 2:**

- [ ] Activity config save round-trips through Firestore; next student session sees the injected teaching goal
- [ ] Session report renders real data from a recent v0.1 Boldkast session
- [ ] Tests: `test_activity_config_routes.py` + `test_session_summary.py` + the frontend vitest suite all green
- [ ] **Wed 3 June teacher demo runs against this state**

### Phase 3 — 1.A integration + stretch (~2-2.5d, post-3-June)

**Goal:** Replace LOCAL_MODE teacher stub with Firebase Auth + the `Class` entity from 1.A. Land the analytics chat skill, opt-in share, CLI parity, multi-class filter, suggested questions.

**Dependencies on 1.A:**

- Phase 3 cannot start until 1.A's `Class` entity + Firebase teacher auth path are merged. Phase 2 unblocks 1.A development in parallel (Phase 2 doesn't need 1.A — that's the whole compression win).

**What ships:**

- Firebase teacher auth swap (delete LOCAL_MODE stub for `/teacher/*`)
- Class CRUD (teacher can create new classes from the UI)
- Group mint via real backend endpoint (calls `aiplatform group new` equivalent)
- Multi-class filter in analytics + reports
- Analytics chat skill template (`backend/skills/templates/analytics-chat/SKILL.md`)
- Opt-in share flow (student side at session end + teacher report flag)
- CLI parity (`aiplatform activity`, `aiplatform reports`, `aiplatform analytics`)

**Acceptance gates for Phase 3:**

- [ ] Real Firebase teacher auth gates `/teacher/*`
- [ ] Multi-class teacher can switch between classes via dropdown
- [ ] Analytics chat answers 3+ of the brief's suggested questions against seeded data
- [ ] CLI commands all work end-to-end against deployed dev
- [ ] Per-class teacher opt-in toggle for [1.H audio capture](audio-capture-and-tts.md) integration works

### Why this phasing works

1. **No throwaway work.** Phase 1's screens are the same screens in Phase 2 + Phase 3 — just with progressively more real wiring underneath. Each phase adds capability without replacing.
2. **Unblocks 1.A from being the critical path.** Original ordering had 1.G *blocked* on 1.A. Now 1.A runs in parallel with Phase 2; the swap happens in Phase 3 when both are ready.
3. **Demo dates land cleanly.** Wed 3 June = Phase 2 state. Wed 2026-05-27 (Jutland) = unchanged (this work is segregated). v1.0.0-pilot 2026-08-14 = Phase 3 + stretch complete with weeks of margin.
4. **Cloud agent has clear scope per phase.** Phase 1 is small + self-contained + needs no backend coordination. Easy hand-off.

## Goals

**Primary Goal:** A teacher signs in with UCPH SSO (or Firebase stub in LOCAL_MODE for the Wed 3 June demo), lands on a dashboard showing their classes + recent activity, drills into a class, configures Boldkast with a free-text teaching goal (the goal gets injected into the activity skill's system prompt), generates group codes for students, and after a session views a report including a conversation log + a "share with student group" toggle. The analytics-chat surface (stretch scope for the demo) lets the teacher ask freeform questions about session data.

**Success Metrics (minimum demo scope for Wed 3 June):**

- Teacher login via UCPH SSO completes and lands on `/teacher/classes` within ~1.5s TTI.
- Class list + class-detail screen render with seeded demo data (1.A's `Class` entity).
- Group code generation works from the class detail screen — clicks "+ New group" produces a code in the `adjective-noun-NN` style and copies it to clipboard.
- Activity config screen for Boldkast accepts a teaching-goal free-text input; "Save configuration" writes a `ActivityConfig` Firestore doc and the next student session for that group renders with the teaching goal injected into the skill's system prompt.
- One session report renders for a seeded session (v0.1 Boldkast log).
- All `/teacher/*` routes return 401 for unauthed; redirect to SSO flow.

**Success Metrics (full scope — Wed 3 June if achievable, otherwise post-demo):**

- Analytics-chat surface renders teacher-facing prompts against BigQuery-backed session data (or Firestore-backed if 1.2 isn't live yet — fall back gracefully).
- Opt-in share flow on student side at session end ("send summary to teacher? yes/no") — flag visible on teacher's report screen.
- Multi-class scope filter on analytics chat (`[7B Physics A ▾]` filter).
- "Suggested questions" surface populated from a static list of analytics templates.

**Non-Goals:**

- v2 admin role (UCPH-level admin above teachers). v1 has only "teacher" role above students.
- Cross-teacher class transfer. Teachers own their classes; transfer is a v2 admin concern per 1.A.
- Per-student analytics (only per-group; matches ADR-001's anonymity model).
- Direct teacher-to-student messaging. Share is one-shot at session end, not a live channel.
- Video / audio recording on the report screen (those are 1.H / audio-capture territory).
- Real-time live view of a group session (teacher watching a class chat as it happens). v2.
- LMS integration (LTI, SCORM, etc.). Not in v1 scope.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Dashboard load includes a Firestore query for classes + recent activity (~300ms acceptable). Activity config save is async-with-toast (~500ms). Demo speed = acceptable, not instant |
| 2 | EARNED TRUST | +1 | Teaching-goal-as-input (not system-prompt-as-input) means teachers stay inside their expertise (pedagogy) without needing to understand prompt engineering. Closes a trust gap with non-technical teachers |
| 3 | SKILLS, NOT FEATURES | +1 | Activity config = a per-teacher-per-class instance of a skill; teaching goal = a structured config that shapes the skill's behaviour. Analytics chat = its own teacher-facing skill (NOT a special-cased UI route). Keeps skills-as-the-primary-abstraction holding across teacher surfaces too |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Analytics chat will eventually want a different model than the student tutor (analysis vs Socratic). For v1 we keep gemini-3.5-flash and tune the prompt; per-skill model selection lives in 1.4 |
| 5 | GRACEFUL DEGRADATION | +1 | Analytics chat falls back to "BigQuery not yet available — showing in-memory aggregates only" if 1.2 isn't live; class list falls back to "no classes yet, [+ create one]" if first-login; session report renders an empty state if no sessions for the group yet |
| 6 | PROTOCOL OVER CUSTOM | +1 | Activity config is a Pydantic model + Firestore doc + REST CRUD — standard. Teaching-goal injection uses the same `{teacher_focus}` template-substitution pattern as existing skill templates (e.g. `problem-set-hints/SKILL.md` uses `{initial_message}`); just a new variable |
| 7 | API FIRST | +1 | Every teacher screen is backed by a documented endpoint; CLI gets parity (`aiplatform class lessons`, `aiplatform activity config`, `aiplatform reports`) so teachers' ops co-owners can use the platform from a terminal. Demo doesn't require CLI but the contract does |
| 8 | OBSERVABLE BY DEFAULT | +1 | Every teacher action emits an OTel span tagged `teacher_uid` + `class_id`. Researchers can study teacher usage patterns; teachers can audit their own action history. Critical for institutional accountability |
| 9 | SECURE BY CONSTRUCTION | +1 | All `/teacher/*` routes gated by Firebase JWT verification per 1.A; cross-teacher access blocked by `AccessControl(type: "private", ownerId: teacher_uid)` on classes; analytics chat reads only the teacher's own class's session data (server-side filter, never client) |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | All filtering / aggregation server-side; frontend is forms + lists + charts consuming typed APIs. Analytics chat is itself a skill — same chat surface, different prompt |
| | **Net Score** | **+8** | Threshold >= +4 OK |

**Conflict Justifications:** None.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Teacher auth | Firebase Auth + Google OAuth (UCPH-federated v2 upgrade path) | Inherited from [teacher-permission-model.md](teacher-permission-model.md) (1.A) — no auth code here |
| Activity config storage | Firestore `activity_configs/{teacher_uid}:{class_id}:{activity_id}` doc, Pydantic `ActivityConfig` model | Standard CRUD; same access pattern as the inherited template's `SkillConfig` |
| Teaching-goal injection | Template substitution in skill body (`{teacher_focus}` placeholder) | Same pattern as existing `{initial_message}` substitution at `backend/skills/templates/*/SKILL.md` |
| Session report aggregation | Read from ADK session state (today) + BigQuery (post-1.2). Aggregation is a deterministic Python function, not a model call | No new protocol |
| Analytics chat | New teacher-facing skill in `backend/skills/templates/analytics-chat/SKILL.md`. Same agent infrastructure (ADK, AG-UI, etc.) | Reuses the platform's chat surface; the only difference is the system prompt + data-source access |
| Frontend routing | Next.js App Router under `/teacher/*` | Same stack as existing routes |

**No new protocols.** Every primitive reuses existing patterns.

## CLI Surface

Per the API-first axiom, every teacher action gets a CLI parallel:

| Command | Purpose |
|---|---|
| `aiplatform activity config set <class_id> <activity_id> --teaching-goal "..."` | Write activity config for a (class, activity) pair |
| `aiplatform activity config get <class_id> <activity_id>` | Read current config |
| `aiplatform reports group <group_code> [--session <sid>]` | Generate / fetch a session report |
| `aiplatform reports class <class_id>` | All sessions for a class |
| `aiplatform analytics query <class_id> "what did students struggle with"` | Run an analytics-chat query against a class's data (CLI parallel to the chat surface) |

Estimate: **~0.4 day** for the five subcommands (Click + httpx + tests, same pattern as MCPAPP-SPEC CLI work).

**Backlink:** [local-dev-cli.md](../../v6.1.0/local-dev-cli.md) for the parent CLI structure (inherited from template).

## Design

### Route map

```
/teacher                          (root — redirects to /teacher/classes)
/teacher/classes                  Dashboard: class list + recent activity
/teacher/classes/:id              Class detail: groups + assigned activities
/teacher/activities               Activity library (browse available activities)
/teacher/activities/:id           Activity configuration (teaching goal + settings)
/teacher/reports                  Reports index (across all classes)
/teacher/reports/groups/:groupId  Per-group session report
/teacher/analytics                Analytics chat ("chat to the data")
```

All routes gated by `useTeacherAuth()` hook (from 1.A) — redirect to Firebase login if unauthed.

### Activity config — the core new concept

The brief's central insight: *"teachers don't write system prompts; they write teaching intentions."*

**Wire shape:**

```typescript
interface ActivityConfig {
  activityId: string;                     // skill_id e.g. "boldkast"
  teacherUid: string;                     // Firebase uid
  classId: string;                        // Class.classId
  teachingGoal: string;                   // free-text, ~1000 char limit
  language: "da" | "en";
  difficulty: "standard" | "guided";
  paired_workbench: string | null;        // skill_id of paired workbench skill, or null
  updatedAt: Date;
}
```

**Injection mechanism:** The skill template gets a new placeholder variable. Existing `problem-set-hints/SKILL.md` already substitutes `{initial_message}`; we add `{teacher_focus}` at the end of the body:

```
... existing Socratic prompt ...

TEACHER'S FOCUS FOR THIS SESSION:
{teacher_focus}

Use this to shape which concepts you guide toward first. Never state these concepts
directly — only ask questions that lead the student there.
```

At agent-instantiation time (when the student joins a group in this class), `backend/adk/agent.py` looks up the active `ActivityConfig` and substitutes `{teacher_focus}` with the teaching goal. If no config exists for this (class, activity), substitute an empty string (the trailing section becomes a no-op).

### Session report aggregator

A pure Python function (`backend/reports/session_summary.py`) takes a `session_id` and returns:

```typescript
interface SessionSummary {
  groupId: string;
  activityId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;
  messageCount: number;
  simRunCount: number;             // from mcp_app_context.* state events
  checklistProgress: {
    [stepId: string]: boolean;
  };
  topicsCovered: string[];          // from workbench state
  flaggedTurns: number;             // off-topic redirects
  conversationLog: Array<{
    timestamp: Date;
    role: "user" | "assistant";
    content: string;
  }>;
}
```

Pre-1.2 (BigQuery sink not live), the aggregator reads directly from ADK session state. Post-1.2, it reads from BigQuery (richer; faster for cross-session queries).

### Analytics chat skill

New skill template: `backend/skills/templates/analytics-chat/SKILL.md`. Same agent infrastructure (LlmAgent, AG-UI, etc.) as student-facing skills, with:

- System prompt focused on **factual analysis**, not Socratic dialogue
- A new tool: `query_session_data(class_id, time_range)` — server-side, scoped to teacher's own classes only
- Suggested-questions surface (4–6 static templates rendered as quick-pick buttons)

For Wed 3 June demo, the analytics-chat skill can be a stub returning canned responses tied to fixture data. Real BigQuery-backed analytics ships post-1.2.

### Files to create

| File | Purpose | LOC est. |
|---|---|---|
| `frontend/src/app/teacher/layout.tsx` | Auth gate + breadcrumbs + nav | ~80 |
| `frontend/src/app/teacher/classes/page.tsx` | Dashboard | ~150 |
| `frontend/src/app/teacher/classes/[id]/page.tsx` | Class detail | ~200 |
| `frontend/src/app/teacher/activities/page.tsx` | Activity library | ~120 |
| `frontend/src/app/teacher/activities/[id]/page.tsx` | Activity config | ~180 |
| `frontend/src/app/teacher/reports/page.tsx` | Reports index | ~100 |
| `frontend/src/app/teacher/reports/groups/[groupId]/page.tsx` | Per-group report | ~200 |
| `frontend/src/app/teacher/analytics/page.tsx` | Analytics chat surface | ~150 |
| `frontend/src/hooks/useTeacherAuth.ts` | Teacher session hook (Firebase-backed via 1.A) | ~80 |
| `frontend/src/lib/teacherApi.ts` | API client for the new endpoints | ~120 |
| `frontend/src/app/teacher/**/__tests__/*.test.tsx` | Vitest cases per screen (~6 each) | ~600 |
| `backend/db/models/activity_config.py` | `ActivityConfig` Pydantic model | ~60 |
| `backend/db/activity_configs.py` | Firestore CRUD | ~80 |
| `backend/protocols/activity_config_routes.py` | REST CRUD for activity config | ~120 |
| `backend/reports/session_summary.py` | Aggregator | ~150 |
| `backend/protocols/reports_routes.py` | `GET /api/reports/groups/{gid}`, `GET /api/reports/classes/{cid}` | ~100 |
| `backend/adk/agent.py` | Teaching-goal substitution at agent instantiation | +20 |
| `backend/skills/templates/analytics-chat/SKILL.md` | New teacher-facing skill | ~80 |
| `backend/protocols/analytics_chat_routes.py` (or reuse skill stream) | If needed; likely reuses existing skill-stream endpoint with tenant filter | minor |
| `backend/tests/api_tests/test_activity_config_routes.py` | Pytest cases for activity config CRUD + access policy | ~150 |
| `backend/tests/unit/test_session_summary.py` | Aggregator unit tests | ~120 |
| `backend/tests/api_tests/test_reports_routes.py` | Reports access policy + summary integration | ~120 |
| `cli/aiplatform/commands/activity.py` (new) | CLI parity | ~100 |
| `cli/aiplatform/commands/reports.py` (new) | CLI parity | ~80 |
| `cli/tests/test_cli_activity.py`, `test_cli_reports.py` | CLI tests | ~120 |

### Demo-scope vs full-scope split

**Demo scope (Wed 3 June, ~2.5d effort):**
- Dashboard + class detail + activity config + one session report
- Backend: activity config CRUD + session summary aggregator (ADK-session-state-backed)
- Tests: pytest + vitest coverage for the demo screens

**Stretch / post-demo (~2.5d additional effort):**
- Analytics chat surface + skill template
- Multi-class analytics filter + suggested questions
- Opt-in share flow on student side
- BigQuery-backed analytics (depends on 1.2)
- CLI parity commands

## API Changes

**New endpoints:**

```
POST /api/activity-configs
   body: { activity_id, class_id, teaching_goal, language, difficulty, paired_workbench }
GET /api/activity-configs/{teacher_uid}/{class_id}/{activity_id}
PATCH /api/activity-configs/{teacher_uid}/{class_id}/{activity_id}
DELETE /api/activity-configs/{teacher_uid}/{class_id}/{activity_id}

GET /api/reports/groups/{group_id}
GET /api/reports/groups/{group_id}/sessions/{session_id}
GET /api/reports/classes/{class_id}/sessions  (paginated)

POST /api/reports/groups/{group_id}/share-with-students  (opt-in share)
```

All gated by `verify_teacher_owns_class(teacher_uid, class_id)` middleware that consults [1.A](teacher-permission-model.md)'s `Class.owner_uid`.

## Migration

- **No data migration** — new collections.
- **No frontend feature flag.** Either v1 ships the teacher UI or it doesn't.
- **Rollback:** revert the commits. v0.1 student-only flow continues to work; the `/teacher/*` routes just disappear.

## Testing Strategy

Standard mix: pytest (backend), vitest (frontend), CLI tests, manual end-to-end. ~10 backend cases + ~30 frontend cases (across 7 screens) + 6 CLI cases.

**Critical path for Wed 3 June demo:**

- pytest: `test_activity_config_routes.py` happy path + access policy
- pytest: `test_session_summary.py` against a seeded v0.1 Boldkast session
- vitest: `teacher/classes/page.test.tsx` renders class list; `teacher/activities/[id]/page.test.tsx` saves activity config; `teacher/reports/groups/[groupId]/page.test.tsx` renders the report
- Manual: full teacher journey login → create class → mint group code → student joins → student plays Boldkast → teacher views report

**Stretch path:**

- Analytics chat test set
- Opt-in share end-to-end

## Implementation Plan — by phase

### Phase 1: Static mockup (cloud-agent target — start here)

| Step | What | Where | Est |
|---|---|---|---|
| 1.1 | Create `frontend/src/app/teacher/` route group + `layout.tsx` with LOCAL_MODE / `NEXT_PUBLIC_TEACHER_MOCK=1` bypass | `frontend/src/app/teacher/layout.tsx` | 0.1 d |
| 1.2 | Build five page components with hardcoded data | `frontend/src/app/teacher/classes/page.tsx`, `classes/[id]/page.tsx`, `activities/[id]/page.tsx`, `reports/groups/[groupId]/page.tsx`, `analytics/page.tsx` | 0.3-0.5 d |
| 1.3 | Hardcoded fixture data file (single source for the mock screens) | `frontend/src/app/teacher/_mock-data.ts` | 0.1 d |
| 1.4 | Lucide-react icons, Tailwind styling, mobile + desktop responsive (per [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md) — no emoji) | (across the above) | (inline) |
| 1.5 | "+ New group" toast interaction + "Save configuration" toast interaction (purely cosmetic, no backend) | (inline) | 0.05 d |
| 1.6 | Basic vitest smoke per screen (renders without crashing) | `frontend/src/app/teacher/**/__tests__/*.test.tsx` | 0.15 d |
| 1.7 | Manual verification + M+JB visual sign-off | — | 0.1 d |
| | **Phase 1 total** | | **~0.85-1.05 d** |

### Phase 2: Wire to real backend (LOCAL_MODE teacher auth still)

| Step | What | Where | Est |
|---|---|---|---|
| 2.1 | `ActivityConfig` Pydantic model + Firestore CRUD | `backend/db/models/activity_config.py`, `backend/db/activity_configs.py` | 0.2 d |
| 2.2 | Activity-config API routes + tests | `backend/protocols/activity_config_routes.py`, `tests/api_tests/test_activity_config_routes.py` | 0.3 d |
| 2.3 | Teaching-goal substitution at agent instantiation | `backend/adk/agent.py` + skill template `{teacher_focus}` placeholder | 0.2 d |
| 2.4 | Session summary aggregator (ADK-session-state-backed) + unit tests | `backend/reports/session_summary.py`, `tests/unit/test_session_summary.py` | 0.3 d |
| 2.5 | Reports API routes + tests | `backend/protocols/reports_routes.py`, `tests/api_tests/test_reports_routes.py` | 0.25 d |
| 2.6 | Replace hardcoded data with API calls in all 5 screens | `frontend/src/lib/teacherApi.ts`, all 5 page components | 0.4 d |
| 2.7 | Seeded demo class for LOCAL_MODE teacher | `backend/db/local_fixture.py` | 0.1 d |
| 2.8 | Vitest updates (real API contract assertions) | all 5 test files | 0.2 d |
| 2.9 | Manual end-to-end + Wed 3 June demo dry run | — | 0.2 d |
| | **Phase 2 total** | | **~2.15 d** |

#### Phase 2 acceptance walkthrough (the demo path)

The Phase 2 deploy lands at https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/teacher with `NEXT_PUBLIC_TEACHER_MOCK=1` baked into the dev frontend image (via the `_TEACHER_MOCK=1` substitution on the `aipla-dev-deploy` Cloud Build trigger — recorded in [scripts/bootstrap-aipla-dev.NOTES.md](../../../../scripts/bootstrap-aipla-dev.NOTES.md) Decision 11). The bypass renders the editorial surface without Firebase teacher auth, which doesn't ship until Phase 3.

This walkthrough is the **acceptance script for Phase 2** — both the internal demo (M + JB + AR before Wed 3 June) and the Wed 3 June teacher demo. Use it to verify the build, drive design-review feedback, and as the baseline for Phase 3 regression checks.

**Setup** — open the URL in an incognito tab. No sessionStorage leftovers means the auth bypass triggers cleanly. Open the browser devtools Network panel for step 3a.

##### Editorial surface (the five screens)

1. **`/teacher/classes` — dashboard.** Two class cards ("7B Physics A" 4 groups active, "8A Physics A" 2 groups). Recent-activity rows for `bold-kazoo-87` / `ruby-petal-72` / `fluffy-goose-56`. *"Chat with all session data →"* goes to `/teacher/analytics`. "New class" disabled (Phase 3).

2. **`/teacher/classes/7b-physics-a-2026` — class detail.** 4 groups with status badges (active / idle / completed). "+ New group" mints a fake `adjective-noun-NN` code + copies to clipboard + toast. "Copy code" per row works. Activities list: Boldkast (configured), LED Planck (configured), Pendul (not). "Configure" links to the activity-config screen.

3. **`/teacher/activities/boldkast` — activity config (key screen).** Four tabs across the top: **Teaching goal** (active), **Parameters** [v1.1], **Code** [v2], **History** [v2]. Yellow `v1.1` / `v2` pills make the not-committed framing visually obvious.

   - **3a. Teaching goal tab (live — real backend wired).** Textarea pre-filled from mock defaults on first load. Edit the goal → Save → Network panel shows `POST /api/proxy/api/activity-configs` returning **201**, toast confirms *"Saved — students see your teaching goal on their next turn."* Refresh → goal persists (Network shows `GET /api/proxy/api/activity-configs/mine/...`).
   - **3b. Parameters tab.** Yellow "Roadmap preview — v1.1" banner. Disabled sliders (angle range), toggles (velocity vectors, trail, drag), trials-per-round input, labels language dropdown. *Feedback prompt for JB/AR:* **"Are these the right knobs? Per-class overrides?"*
   - **3c. Code tab.** Yellow "Roadmap preview — v2" banner — framing is AI-assist via `.claude/skills/mcp-app-artefact`, draft → review → publish, per-teacher namespace. Read-only Boldkast HTML snippet, 12.4 KB / 200 KB cap badge, three green-dot validator badges (CSP-safe, size OK, no external fetches). *Feedback prompt:* **"What would 'edit with AI assist' mean to you? What's the review-queue model?"*
   - **3d. History tab.** Yellow "Roadmap preview — v2" banner. Mock version log (v4 live, v3, v2, v1) with disabled rollback per row.

4. **`/teacher/reports/groups/bold-kazoo-87` — session report (mock-fallback path).** Briefly shows "Loading report…" while the real-API fetch 404s (no real session for this group), then renders the mock fixture with a small **"mock data"** pill in the header. Summary metrics (22 min / 34 messages / 8 sim runs), Danish conversation log renders correctly.

5. **`/teacher/reports/groups/local-demo` — session report (real-backend path).** If no chat has happened yet against the seeded group, the screen renders a polite *"No sessions yet — students need to join and chat before a report appears here"* empty state (added 2026-05-25 in commit `d1b0712`). **To prove the real wiring,** have someone join `/group` with the code `local-demo`, chat for a minute, then return — the report should render without the "mock data" pill, with the conversation log + sim_run_count derived from real ADK session events.

6. **`/teacher/analytics`.** Scope pills (7B Physics A ▾ / All time ▾, disabled), hardcoded Q&A about vx/vy independence, disabled input + suggested questions. 100% placeholder — Phase 3 / Year-2 surface.

##### End-to-end teacher-focus proof (the magic moment)

This is the demo's load-bearing moment — it proves the Phase 2 wiring is real, not mock theatre.

1. At `/teacher/activities/boldkast`, set the teaching goal to something **distinctive** (e.g. *"Make sure students discover that 30° and 60° launches land at the same place."*) → Save.
2. In a fresh incognito tab, open `/group`, enter the code `local-demo`, start a Boldkast session.
3. The first couple of agent turns should reflect the teacher's distinctive goal — questions about 30°/60° symmetry, not generic projectile prompts. This proves `{teacher_focus}` substitution at agent instantiation is wired end-to-end.

##### Mobile + desktop check

Resize to ~375px → all five screens usable. ~1280px+ → polished desktop layout. Tab bar wraps cleanly on narrow screens; toasts position correctly.

#### Phase 2 — what's *not* in this build (avoid surprises)

| Reviewer might expect | Phase 2 reality | Lands in |
|---|---|---|
| Sign in with Google / UCPH | Bypassed via `NEXT_PUBLIC_TEACHER_MOCK=1` | Phase 3 (post-3-June) |
| Multiple classes | Only seeded `7b-physics-a-2026` works fully | Phase 3 |
| Create a new class | Button disabled | Phase 3 |
| Real analytics chat | Hardcoded canned answer | Phase 3 / Year-2 |
| Parameters / Code / History tabs functional | Wireframes only — for design feedback | v1.1 / Year-2 (decision after pilot) |
| Audio / TTS | Not wired | 1.H (TTS independent; audio JB-gated) |
| Browse `/teacher/activities` library | Not built | Phase 3 |

#### Demo talking points (what to lead with)

1. **What's real today:** activity-config save round-trips to Firestore; the next student session reads `{teacher_focus}` from that doc and injects it into the agent prompt at instantiation. That's the Wed 3 June demo target landed a week early.
2. **What's signalled but not built:** the three roadmap tabs on the activity-config screen. They drive the *"how much teacher control do we want?"* conversation — bounded parameters (v1.1) vs code-level authoring (v2 / Year-2). See [`post-pilot/teacher-artefact-parameters.md`](../post-pilot/teacher-artefact-parameters.md) and [`post-pilot/teacher-artefact-authoring.md`](../post-pilot/teacher-artefact-authoring.md) for the full pros/cons + decision criteria.
3. **What still mocks:** dashboard cards, class detail, analytics chat — by design (Phase 3 scope). The *"mock data"* pill on reports makes the not-real status explicit so reviewers don't conflate the editorial-surface mock data with the activity-config + reports real-backend wiring.

### Phase 3: Firebase swap + stretch (post-demo)

| Step | What | Est |
|---|---|---|
| 3.1 | Swap LOCAL_MODE teacher stub for Firebase auth (consumes 1.A) | 0.2 d |
| 3.2 | Class CRUD frontend (creating new classes from UI) | 0.3 d |
| 3.3 | Group mint via real backend endpoint integration | 0.2 d |
| 3.4 | Analytics chat skill template + suggested questions | 0.4 d |
| 3.5 | Analytics chat surface wiring to skill | 0.3 d |
| 3.6 | Opt-in share flow (student side + teacher report flag) | 0.4 d |
| 3.7 | Multi-class filter | 0.15 d |
| 3.8 | Reports index page + class-scoped aggregation | 0.25 d |
| 3.9 | Activity library browse page | 0.2 d |
| 3.10 | CLI parity (`activity`, `reports`, `analytics`) | 0.4 d |
| | **Phase 3 total** | **~2.8 d** |

| **Grand total across all phases** | **~5.8 d** |

## Cloud-agent kick-off note (Phase 1)

A cloud agent picking up Phase 1 from a branch off `dev` should:

1. Branch: `git checkout -b feature/teacher-ui-mockup origin/dev`
2. Read this doc end-to-end, with particular attention to the **Phased delivery** section and the **Phase 1: Static mockup** acceptance gates above
3. Read the source-of-truth brief: [`teacher-ui-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/teacher-ui-brief.md) in the scoping site — has the ASCII wireframes for all five screens
4. Read [feedback-no-emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md) — lucide-react icons, no emoji anywhere
5. Implement Phase 1 step-by-step against the "Implementation Plan — Phase 1" table above
6. Open a PR against `dev` when Phase 1 acceptance gates are met
7. DO NOT start Phase 2 — that needs a separate PR after Phase 1 M+JB sign-off

Existing patterns to mirror:
- `frontend/src/app/group/page.tsx` for the LOCAL_MODE bypass pattern (`isLocalMode()` check at top)
- `frontend/src/components/AppFooter.tsx` for the global footer (use on `/teacher` routes too)
- `frontend/src/lib/branding.ts` for brand assets / strings
- Existing test files under `frontend/src/app/**/__tests__/` for the vitest smoke pattern

Existing routes NOT to touch:
- `/`, `/group`, `/chat/*`, `/skills/*`, `/lessons` (if landed) — student-facing surfaces
- Any backend route — Phase 1 is FE-only

## Implementation Plan (legacy — superseded by phase split above)

| Step | What | Where | Est |
|---|---|---|---|
| 1 | `ActivityConfig` model + Firestore CRUD | `backend/db/models/activity_config.py`, `backend/db/activity_configs.py` | 0.2 d |
| 2 | Activity-config API routes + tests | `backend/protocols/activity_config_routes.py`, `tests/api_tests/test_activity_config_routes.py` | 0.3 d |
| 3 | Teaching-goal substitution at agent instantiation | `backend/adk/agent.py` + skill template `{teacher_focus}` placeholder | 0.2 d |
| 4 | Session summary aggregator (ADK-session-state-backed) + unit tests | `backend/reports/session_summary.py`, `tests/unit/test_session_summary.py` | 0.3 d |
| 5 | Reports API routes + tests | `backend/protocols/reports_routes.py`, `tests/api_tests/test_reports_routes.py` | 0.25 d |
| 6 | `useTeacherAuth` hook + teacher layout | `frontend/src/hooks/useTeacherAuth.ts`, `app/teacher/layout.tsx` | 0.2 d |
| 7 | Teacher dashboard page + tests | `app/teacher/classes/page.tsx` + tests | 0.25 d |
| 8 | Class detail page + tests | `app/teacher/classes/[id]/page.tsx` + tests | 0.3 d |
| 9 | Activity config page + tests | `app/teacher/activities/[id]/page.tsx` + tests | 0.3 d |
| 10 | Per-group report page + tests | `app/teacher/reports/groups/[groupId]/page.tsx` + tests | 0.3 d |
| 11 | Manual end-to-end | — | 0.2 d |
| | **Subtotal (demo scope)** | | **~2.8 d** |

## Implementation Plan (full scope additions)

| Step | What | Est |
|---|---|---|
| 12 | Analytics chat skill template + suggested questions | 0.4 d |
| 13 | Analytics chat surface frontend | 0.3 d |
| 14 | Opt-in share flow (student side at session end + teacher report flag) | 0.4 d |
| 15 | Reports index page + class-scoped aggregation | 0.25 d |
| 16 | Activity library browse page | 0.2 d |
| 17 | CLI parity (`activity`, `reports`, `analytics`) | 0.4 d |
| | **Subtotal (stretch)** | **~1.95 d** |
| | **Grand total** | **~4.75 d** |

## Success Criteria (demo)

- [ ] Teacher signs in (Firebase or LOCAL_MODE stub) → lands on `/teacher/classes`.
- [ ] Dashboard renders class list + recent activity.
- [ ] Class detail screen renders groups + assigned activities.
- [ ] `+ New group` button mints a code in `adjective-noun-NN` style.
- [ ] Activity config screen saves a teaching goal; the next student session shows the teaching-goal-shaped tutor behaviour.
- [ ] One session report renders for a seeded session.
- [ ] All `/teacher/*` routes return 401 unauthed.
- [ ] `npm run quality:check` + `make test-fast` green.

## Success Criteria (full)

- [ ] Analytics chat answers at least 3 of the brief's suggested questions against seeded data.
- [ ] Opt-in share works end-to-end (student opts in → teacher sees the flag → can send the summary back to the group's chat).
- [ ] CLI parity: `aiplatform activity config set/get`, `aiplatform reports group/class`, `aiplatform analytics query` all work against deployed dev.
- [ ] BigQuery-backed analytics works once 1.2 lands (fallback shows in-memory aggregation pre-1.2).

## Out of Scope (deferred)

- v2 admin role (UCPH-level admin above teachers).
- Cross-teacher class transfer.
- Per-student analytics (anonymity model is per-group only).
- LMS integration.
- Real-time live view of a group session.
- Audio / video in the report screen (covered by [audio-capture-and-tts.md](audio-capture-and-tts.md), 1.H).

## Related Documents

- **Source of truth:** [`teacher-ui-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/teacher-ui-brief.md)
- [SEQUENCE.md](SEQUENCE.md) row 1.G
- [teacher-permission-model.md](teacher-permission-model.md) (1.A) — structural prerequisite (auth + Class entity)
- [session-persistence.md](session-persistence.md) (1.F) — provides reset-session + last-active timestamps
- [lesson-picker.md](lesson-picker.md) (1.B) — student-side counterpart for browsing activities
- [audio-capture-and-tts.md](audio-capture-and-tts.md) (1.H) — adds audio-data dimension to reports
- ADR-001 (group ID anonymity), ADR-005 (chat log storage), ADR-014 (per-group/per-class budget)
- [strands.qmd](file:///Users/mark/Documents/clients/cph-uni/strands.qmd) — v1 teacher commitment
