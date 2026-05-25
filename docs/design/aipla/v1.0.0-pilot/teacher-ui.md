# Teacher UI — dashboard, class detail, activity config, session reports, analytics chat

**Status**: Planned
**Priority**: P0 — **demo target for Wed 3 June check-in** per the 2026-05-25 meeting
**Estimated**: ~4–5 days (minimum check-in scope is ~2.5d; full scope including analytics chat is ~5d)
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

## Implementation Plan (demo-scope minimum)

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
