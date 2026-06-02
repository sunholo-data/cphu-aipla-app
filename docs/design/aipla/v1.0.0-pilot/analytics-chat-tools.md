# Analytics-chat Tools — BigQuery query surface + per-teacher data isolation

**Status**: Planned
**Priority**: P1
**Estimated**: 4–5 days (backend tools 2d, skill wiring 0.5d, frontend wiring 1.5d, CLI + tests 0.5–1d)
**Scope**: Fullstack
**Dependencies**: 1.2 chat-log pipeline (shipped — BQ tables live in `europe-north1`), 1.A teacher permission model (shipped — `is_teacher`, `Class` entity, `role:teacher` tag), teacher-ui-ph3 M6 (shipped — `analytics-chat` skill template seeded)
**Created**: 2026-06-02
**Last Updated**: 2026-06-02

## Problem Statement

The `/teacher/analytics` surface is a mock and the `analytics-chat` skill ships with `tools: []`. The infrastructure that would make it useful — the chat-log BigQuery dataset, a region-pinned BQ client, the skill template with privacy constraints, teacher Firebase auth, the `Class` entity — has already landed across 1.A, 1.2, and teacher-ui-ph3. What's missing is the **query-tool layer that lets the skill actually answer questions**, together with the **per-teacher authorization** that prevents the skill from leaking another teacher's data, and the **frontend wiring** that replaces the disabled input with a real AG-UI conversation.

**Current State:**
- [/teacher/analytics page](../../../../frontend/src/app/teacher/analytics/page.tsx) renders mocked Q/A; input is `disabled` with tooltip *"Analytics chat skill wired in M6"*; suggested-question buttons are non-functional.
- [analytics-chat SKILL.md](../../../../backend/skills/templates/analytics-chat/SKILL.md) has the right prompt + access-control (`role:teacher` tag, no PII, paraphrase only) but its own text says *"Do NOT hallucinate statistics or pretend to query data"* — i.e. the skill is intentionally inert until tools exist.
- BigQuery dataset `chat_logs.aipla_chat_turn` + `chat_logs.aipla_workbench_event` are populated by the 1.2 sink emitter and queryable today (see [db/bigquery.py](../../../../backend/db/bigquery.py), [reports/session_summary.py](../../../../backend/reports/session_summary.py) `summarize_session_bq` for the working pattern).
- Teacher pilot starts **2026-08-14**. Teachers will expect to ask "how did the class go?" without scrolling through every session report.

**Impact:**
- **Teachers (10 in the DK pilot)**: today they can drill into one session at a time via [/teacher/reports/groups/{code}](../../../../frontend/src/app/teacher/reports/groups/%5BgroupId%5D/page.tsx) and CSV/JSON-export. There is no cross-group, cross-session aggregate view. Every comparison ("which group spent longest on Boldkast?") requires manual eyeballing or downloading every export and pivoting in Excel.
- **Privacy / institutional review (JB sign-off pending on student data)**: shipping a "chat with class data" surface without explicit per-teacher isolation creates a credible cross-tenant leak path. Must be designed-in, not bolted on.
- **Project axiom commitment (SKILLS, NOT FEATURES)**: the platform's user-facing abstraction *is* skills. An analytics surface that bypasses the skill in favor of bespoke chat-vs-data UI would split the platform's mental model. Wiring the existing skill template is the correct shape; building a parallel system is not.
- **Mid-point review (2026-06-26) + holiday freeze (2026-06-29 → 07-05)**: there is one usable engineering window before the freeze. After the freeze, the post-pilot 2.5 `session-analytics-rubric` work picks up — but that depends on the R1 framework pick (JB/AR-blocked). This skill is the **R1-independent fallback**: it ships "chat to the data" without committing to ICAP+FCI vs CPS+DRA.

## Goals

**Primary Goal:** Ship a working teacher analytics chat where a signed-in teacher can ask natural-language questions about their own classes' session data, gets answers backed by BigQuery aggregates (cited + paraphrased per the existing skill prompt), and is structurally incapable of seeing another teacher's data.

**Success Metrics:**
- A teacher signed into `/teacher/analytics` can submit a question and receive a streamed answer that contains real numbers from BigQuery (verified via at least four canned scenarios: messages-per-group, time-on-task, sim-runs-per-skill, group-completion-rate).
- **Zero cross-teacher data exposure** in the analytics path: a test where teacher A asks "show me class XYZ" (XYZ owned by teacher B) returns "no such class accessible" — not a partial leak, not a denial that confirms existence. Enforced by `_assert_caller_owns(class_id)` in every tool, not by prompt instruction.
- First token (after the user submits) under 3s for queries that hit at most one BQ query; under 6s for queries that hit three. Matches the platform's INSTANT FEEL KPIs given the BQ-bound work.
- **R1 framework decision unaffected** — analytics-chat ships independently of the post-pilot 2.5 rubric work and provides a usable fallback if R1 slips past the freeze.

**Non-Goals:**
- Misconception clustering at scale. The SKILL.md mentions *"misconceptions came up most often"* — that needs a separate corpus-summarisation pattern. We ship a **lightweight version** (`summarise_chat_excerpts(class_id, topic, since)` that returns paraphrased themes from a small sample) but no clustering, no embedding index, no taxonomy. The full rubric layer is 2.5 / post-pilot.
- Per-student analytics. AIPLA's anonymity model (ADR-001 in the scoping site) doesn't carry per-student identity; the smallest unit is the anonymous group code.
- Multi-class joins ("compare Class A vs Class B"). Single-class scope per turn; comparison is a v1.1 concern.
- Building a parallel non-chat dashboard. The CSV/JSON exports already shipped for the row-level surface; chat is the aggregate surface.
- Replacing the existing per-session report page or the export buttons that just shipped.

## Axiom Alignment

Score each axiom per [Product Axioms](../../../product-axioms.md). Net score must be >= +4. Max 2 conflicts (-1) allowed.

| #  | Axiom | Score | Notes |
|----|-------|-------|-------|
| 1  | INSTANT FEEL | +1 | AG-UI streaming on the analytics chat; tool calls stream progress; first token target <3s. The frontend stays on a hot tab — no page transition for the teacher between asking and seeing the answer. |
| 2  | EARNED TRUST | +1 | Every tool returns the exact SQL + parameters it ran alongside the rows, and the skill prompt is amended to require citing the underlying numbers (e.g. *"42 messages across 5 groups over 2026-06-01–2026-06-07"*) rather than a fluent summary. Paraphrase constraint already exists in the SKILL.md. |
| 3  | SKILLS, NOT FEATURES | +1 | This is *literally* wiring the existing `analytics-chat` skill. No parallel feature surface; the teacher discovers it via the skill list (gated by `role:teacher`). |
| 4  | RIGHT MODEL, RIGHT MOMENT | 0 | Skill is already on `gemini-2.5-flash` per the SKILL.md frontmatter; that's the right tier for aggregate Q/A. No change. |
| 5  | GRACEFUL DEGRADATION | +1 | If BQ is unreachable (missing table, missing creds, region outage) every tool returns a structured error, the skill is instructed to surface *"data isn't queryable right now, try again in a minute"* rather than fabricate. Mirrors the `summarize_session_bq` fallback pattern in `reports/session_summary.py`. |
| 6  | PROTOCOL OVER CUSTOM | +1 | Uses ADK `FunctionTool` (existing pattern in `backend/adk/tools.py`), AG-UI for the chat transport (already the platform's streaming protocol), Agent Skills `SKILL.md` for the skill spec (no new format). **Explicitly rejects ADK's built-in raw-SQL `BigQuery` toolset** (see *Standards Compliance Check* below) — that toolset is a real ADK primitive, but using it here would conflict with axiom 9. |
| 7  | API FIRST | +1 | Tools are FunctionTools registered via `TOOL_REGISTRY`; the same surface is reachable from the CLI via `aiplatform analytics ask <class-id> "<question>"` (new command, see *CLI Surface* below). Frontend uses no privileged path. |
| 8  | OBSERVABLE BY DEFAULT | +1 | Every tool call emits a Cloud Logging `analytics_tool` structured log entry (teacher uid, class id, tool name, SQL hash, row count, latency). Cost-attribution-friendly. Hooks into the existing chat-log pipeline naming. |
| 9  | SECURE BY CONSTRUCTION | +1 | The whole architectural choice — narrow named-query tools + per-tool `_assert_caller_owns(class_id)` — is in service of this axiom. Authorization happens *in the Python tool function*, not in a SQL `WHERE` clause the model writes, and not in a prompt instruction the model can be jailbroken past. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Frontend is the existing `useSkillAgent` hook + AG-UI streaming; no new chat UI primitives. All query logic lives server-side. |
| 11 | USABLE BY DESIGN | +1 | The surface already exists in v0 mocked form ([analytics/page.tsx](../../../../frontend/src/app/teacher/analytics/page.tsx)); this design fills it in, including the suggested-question buttons (which today are also disabled). Bilingual copy where it exists in adjacent teacher surfaces. |
|    | **Net Score** | **+9** | Threshold: >= +4 ✅ |

**Conflict Justifications:** None — no -1 scores.

## Standards Compliance Check

- **ADK has a built-in `BigQuery` toolset** (`google.adk.tools.bigquery`) that gives the model the ability to write and execute arbitrary SQL. **We are not using it.** Reasoning, recorded here so the decision is auditable:
  - Multi-tenant data isolation: every analytics query must be parameterised by the calling teacher's `owner_uid` (or the set of `class_id`s they own). A prompt-injected teacher input ("show me classes for owner_uid='someoneelse'") would be honored by the raw-SQL toolset. Authorization-in-prompt is a CWE-rated anti-pattern.
  - Cost control: a raw-SQL toolset lets the model run an unbounded BQ scan. The chat-log tables grow per session; without an `_assert_partition_filter()` guard a single bad query is a real bill event.
  - This is precisely the call axiom 6 PROTOCOL OVER CUSTOM is about — *the protocol exists, we evaluated it, we have a written reason it's wrong for this case*. Narrow `FunctionTool` wrappers per query type ARE the standard ADK tool primitive; we're using that primitive, just not the higher-level wrapper.
- **AG-UI streaming** is the platform's chat transport — reused.
- **Agent Skills `SKILL.md`** format — reused (analytics-chat already exists in this shape).
- **Firebase Auth** for the teacher identity — reused; no new auth path.

## CLI Surface

Per the design-doc-creator CLI affordance heuristic, this feature adds a developer-facing query surface that today requires "curl + Firebase token + JSON by hand". Adding a CLI command in the same sprint:

```bash
# List the canned query tools the analytics skill has available.
aiplatform analytics tools

# Probe one tool against a class the calling teacher owns. Returns the
# raw rows + SQL so the dev can verify the query and authorization
# without going through the chat surface.
aiplatform analytics probe <class-id> <tool-name> [--since <iso>] [--until <iso>]

# Send a question end-to-end through the analytics-chat skill. Mints a
# session, streams the answer, prints tool calls + final text. Used for
# eval / smoke / "is the skill actually working in dev".
aiplatform analytics ask <class-id> "<question>"
```

`tools` and `probe` are pure HTTP calls (new `/api/analytics/tools` and `/api/analytics/probe/{tool}` endpoints — see *API Changes*). `ask` reuses the existing `aiplatform chat` session-creation + AG-UI streaming code paths, pointed at the `analytics-chat` skill.

Each command is ~30–60 LOC of Click + httpx + a unit test (the [aiplatform-cli skill](../../../../.claude/skills/aiplatform-cli/SKILL.md) shows the existing patterns). Add a row to the v1.0.0-pilot `SEQUENCE.md` analytics critical path once this doc is in.

## Design

### Overview

Three layers. (1) Backend: a `backend/analytics/` module with one Python function per named query, registered as ADK `FunctionTool`s via the existing `TOOL_REGISTRY` pattern; an authorization helper that resolves the calling teacher's `User` into a set of owned `class_id`s and refuses any tool call whose `class_id` argument isn't in that set. (2) Skill: amend the existing `analytics-chat` SKILL.md to declare these tools and to include result-citation rules. (3) Frontend: replace the disabled input + mocked Q/A on `/teacher/analytics` with a `useSkillAgent`-backed AG-UI chat against the analytics-chat skill, prefilling the selected class+time scope into the system message.

### Frontend Changes

**Modified Components:**
- [frontend/src/app/teacher/analytics/page.tsx](../../../../frontend/src/app/teacher/analytics/page.tsx) — remove `MOCK_ANALYTICS_*` imports; wire the input + send button to a `useSkillAgent("analytics-chat")` instance; pass `{ classId, className, timeScope, sinceIso, untilIso }` as initial system context. The class + time-scope dropdowns already work — they just need to be plumbed into the system message and survive re-renders.
- Suggested-question buttons become enabled — clicking one prefills the input (no auto-submit, so the teacher can edit).

**New Components:**
- `frontend/src/app/teacher/analytics/_AnalyticsChat.tsx` (extracted from the page so the test surface is the chat island, not the whole page). Renders the message stream, tool-call indicators ("Querying message counts…"), the input bar, and a small SQL-reveal disclosure under each agent turn that shows the executed query + parameters when the teacher clicks "Show data" — supports axiom 2 EARNED TRUST in the surface.

**State Management:**
- No new contexts. Uses existing `useSkillAgent` + `useAuthContext` + `listClasses`.
- Local component state for the selected class id (already present) and the time scope (already present).

**UI/UX:**
- The header layout stays. Below it: the new chat island. The "Suggested questions" section moves below the chat (today it's mocked content above an input; the new shape is question → answer → suggested-followups).
- Tool calls stream as pill indicators inline (existing AG-UI pattern). Each tool's "results" event opens a collapsible "Show data" panel — paraphrase-only response copy in the main bubble per the skill prompt, but the underlying rows are one click away.
- Empty state: when no class is selected (new teacher), the chat panel renders "Pick a class from the dropdown to start asking questions." instead of an open input.

### Backend Changes

**New Module:**
- `backend/analytics/` — new package.
  - `__init__.py`
  - `auth.py` — `resolve_caller_class_ids(user: User) -> set[str]` and `assert_caller_owns(user: User, class_id: str)`. The second raises `PermissionError("class not accessible")` with no distinction between "doesn't exist" and "not yours" (prevents enumeration).
  - `tools.py` — one async function per canned query. Each is a `FunctionTool`-compatible signature with typed args and docstring; takes a `tool_context: ToolContext` so it can pull `user_id` out of session state (already the pattern in [backend/adk/tools.py](../../../../backend/adk/tools.py)).
  - `queries.py` — the SQL strings, kept separate from the Python wrappers so they're greppable and reviewable in isolation. Every query uses `@class_id` / `@since` / `@until` parameters; no f-string interpolation; mandatory `WHERE class_id IN UNNEST(@allowed_class_ids)` guard even though the tool only ever passes one class id (defense in depth).
  - `summarise.py` — the LLM-summarisation helper for misconception/topic-cluster questions. Fetches a bounded sample (≤200 turns) via BQ, calls a single LLM (gemini-2.5-flash) with a paraphrase-strict prompt, returns themes + counts. Separate from `tools.py` because the contract is different (lossy summary vs deterministic aggregate).

**Canned query tools (v1 set — six tools):**

| Tool name | Signature | Returns | SQL shape |
|---|---|---|---|
| `count_messages` | `class_id, since, until` | `{ total, per_group: [{group_code, count}] }` | `SELECT group_id, COUNT(*) FROM aipla_chat_turn WHERE jsonPayload.class_id = @class_id AND timestamp BETWEEN @since AND @until GROUP BY group_id` |
| `time_on_task` | `class_id, since, until` | `{ per_group: [{group_code, skill_id, first_ts, last_ts, duration_min}] }` | windowed `MIN`/`MAX` over `aipla_chat_turn` per `(group_id, skill_id)` |
| `sim_runs_per_skill` | `class_id, since, until` | `{ per_skill: [{skill_id, run_count, unique_groups}] }` | `aipla_workbench_event WHERE jsonPayload.tool = 'sim_run'` grouped by skill |
| `most_active_groups` | `class_id, since, until, limit` | `{ groups: [{group_code, message_count, session_count}] }` | join of turn-counts + session-counts capped at `limit` (default 10) |
| `group_summary` | `class_id, group_code` | `SessionSummary[]` (full session list for one group) | exists already — `find_latest_session_for_group` + per-session `summarize_session_bq` |
| `summarise_chat_excerpts` | `class_id, topic_keyword, since, until, sample_size=50` | `{ themes: [{theme, frequency, example_paraphrase}] }` | BQ sample + LLM call in `summarise.py`; see *Misconception pattern* below |

**Why six?** Covers the four scoping-site-mentioned question shapes (messages, time-on-task, misconceptions, group-summary) plus two engagement variants that JB has independently asked for (sim-runs, most-active). Each is small, testable, and authorization-trivial. Adding a seventh later is one PR; removing one is a deletion.

**Misconception pattern (`summarise_chat_excerpts`):**

This is the only tool that touches free-form chat content. The pattern is intentionally constrained:

1. BQ query pulls ≤200 student-role turns from `aipla_chat_turn` matching `topic_keyword` in content (or all turns for the topic-bound skill, e.g. all `kinebot-kinematics-tutor` turns), within the date window, for classes the caller owns.
2. A single `gemini-2.5-flash` call receives the bounded list as a `[{group_code_redacted, content}, ...]` JSON array — group codes are replaced with `G1`, `G2`, … so the LLM can't smuggle a real group code into its output. Prompt instructs *"extract up to 5 themes; paraphrase every example; do not quote verbatim; output JSON matching this schema"*.
3. Returns to the agent as structured data, not as a generated paragraph.

This stays well clear of the post-pilot 2.5 rubric scope. It's "what came up in chats about X" not "did this group reach ICAP+constructive engagement".

**Modified Modules:**
- [backend/adk/tools.py](../../../../backend/adk/tools.py) — extend `TOOL_REGISTRY` with the six new entries (one line each, mirroring the existing `list_documents` / `get_document_content` rows).
- [backend/skills/templates/analytics-chat/SKILL.md](../../../../backend/skills/templates/analytics-chat/SKILL.md) — set `tools: [count_messages, time_on_task, sim_runs_per_skill, most_active_groups, group_summary, summarise_chat_excerpts]`; amend the prompt to: (a) require citing returned numbers explicitly in answers, (b) require calling the tool rather than guessing, (c) when `summarise_chat_excerpts` is used, surface that the themes are LLM-paraphrased + sampled.
- [backend/admin/platform_seed.py](../../../../backend/admin/platform_seed.py) — verify the seeder picks up the amended skill (it should — re-seeding the template after the tools-list change ought to be enough; this is a "verify, don't re-architect" item).

**Data Model Changes:**
- None. The chat-log tables (`aipla_chat_turn`, `aipla_workbench_event`) are populated today and have a `class_id` column already (via the JWT minted by 1.A — see `backend/observability/chat_log.py`). If, on inspection, a class id is **not** flowing into the BQ rows, this design's prerequisite is "add `class_id` to the chat-log emitter" — quick fix, but called out so it doesn't slip.

### API Changes

| Method | Endpoint | Description | Breaking? |
|--------|----------|-------------|-----------|
| GET    | /api/analytics/tools | List the analytics tools the caller can probe (just the names + descriptions; metadata only) | No (new) |
| POST   | /api/analytics/probe/{tool_name} | Run one analytics tool synchronously. Body: `{ class_id, args }`. Returns the tool's structured output + the SQL + row count. Used by the CLI `analytics probe` command. | No (new) |

Both endpoints are teacher-gated (`_assert_teacher(user)` + `assert_caller_owns(user, class_id)`). They are not the path the frontend chat takes — the frontend goes through the standard skill chat route. They exist so the CLI can exercise tools without going through the LLM, and so eval cases can assert "given this class state, the tool returns these rows".

### Architecture Diagram

```
[Teacher /teacher/analytics] → useSkillAgent("analytics-chat")
            ↓                            ↓
       AG-UI stream                 /api/proxy → FastAPI → ADK Runner
                                                              ↓
                                                    LlmAgent("analytics-chat")
                                                              ↓ tool call
                                                   backend/analytics/tools.py
                                                              ↓ assert_caller_owns()
                                                       backend/db/bigquery.py
                                                              ↓ run_query()
                                                   chat_logs.aipla_chat_turn
                                                   chat_logs.aipla_workbench_event
                                                              ↓
                                                       result rows + SQL
                                                              ↑
                                              agent paraphrases (per SKILL.md)
                                                              ↑
                                                     AG-UI stream back to UI
```

For `summarise_chat_excerpts` the post-BQ step branches into a single gemini-2.5-flash call in `backend/analytics/summarise.py` before returning to the agent.

## Implementation Plan

### Phase 1: Authorization + first tool (~1d)
- [ ] `backend/analytics/auth.py` — `resolve_caller_class_ids` + `assert_caller_owns` with negative-test coverage (~80 LOC + ~120 LOC tests)
- [ ] `backend/analytics/queries.py` — `count_messages` SQL with parameter binding + an integration test against a seeded BQ table (~50 LOC + ~150 LOC tests)
- [ ] `backend/analytics/tools.py` — `count_messages` FunctionTool wrapper that pulls user from `tool_context` and calls `assert_caller_owns` (~60 LOC + ~100 LOC tests)
- [ ] **Gate: a unit test where caller A asks for caller B's class returns `PermissionError`, and a test that asserts the error string does not distinguish between "missing" and "forbidden".**

### Phase 2: Remaining tools (~1.5d)
- [ ] `time_on_task`, `sim_runs_per_skill`, `most_active_groups`, `group_summary` (~50 LOC each + tests)
- [ ] `summarise_chat_excerpts` including the bounded BQ sample + the gemini-flash paraphrase pass (~150 LOC + ~200 LOC tests; mock the LLM call in unit tests, hit a real Gemini in one integration test)
- [ ] Verify `class_id` is in fact populated in `aipla_chat_turn` rows in dev; if not, patch the emitter (1.2 follow-up that this design depends on)

### Phase 3: Skill wiring + API + CLI (~1d)
- [ ] Update `backend/skills/templates/analytics-chat/SKILL.md`: `tools:` list, citation+paraphrase amendments (~30 LOC change)
- [ ] Re-seed via `platform_seed.py`; verify the skill surfaces the tools via `GET /api/skills/analytics-chat`
- [ ] `backend/protocols/analytics_routes.py` — `GET /api/analytics/tools`, `POST /api/analytics/probe/{tool}` (~150 LOC + ~200 LOC tests)
- [ ] `cli/aiplatform/commands/analytics.py` — three subcommands (`tools`, `probe`, `ask`) (~120 LOC + ~150 LOC tests)

### Phase 4: Frontend (~1d)
- [ ] `frontend/src/app/teacher/analytics/_AnalyticsChat.tsx` extracted island (~200 LOC + tests)
- [ ] `/teacher/analytics/page.tsx` rewired: drop mocked imports; pass scope into `_AnalyticsChat` (~80 LOC change)
- [ ] Suggested-question buttons enable, prefill the input on click (~30 LOC)
- [ ] "Show data" disclosure under each agent message that renders the SQL + row count from the tool call event (~100 LOC + tests)

### Phase 5: Eval + smoke (~0.5d)
- [ ] One ADK eval case per tool (six tool eval cases + one "should refuse cross-class question" eval case)
- [ ] `scripts/smoke-analytics-chat.sh` — runs `aiplatform analytics ask` against the deployed dev env with the test-teacher account and asserts the response cites real numbers

## Migration & Rollout

**Database Migrations:**
- None for the new feature. **One conditional migration**: if dev inspection shows `class_id` is absent from `aipla_chat_turn` rows, add it to the chat-log emitter and either (a) re-run sessions to backfill, or (b) accept that pre-class-id rows are invisible to analytics-chat (acceptable for v1 because the pilot generates fresh data starting 2026-08-14).

**Feature Flags:**
- No flag. The skill is gated by `role:teacher` tag (already shipped); students never see it. Teachers without classes see the empty-state copy. Rolling out = re-seeding the skill template with the amended `tools:` list.

**Rollback Plan:**
- Reverting the SKILL.md tools list to `[]` returns the skill to its current inert behavior. Frontend rollback = restoring the `MOCK_ANALYTICS_*` imports + the disabled input. Both are single-file reversions.

**Environment Variables:**
- None new. `GCP_PROJECT` already configured for BQ; analytics tools inherit it via the existing region-pinned client.

## Testing Strategy

### Frontend Tests (Vitest + React Testing Library)
- [ ] `_AnalyticsChat.test.tsx` — renders empty state when no class selected; sends message via mocked `useSkillAgent`; streams agent response; renders tool-call pill; opens "Show data" disclosure on click
- [ ] `analytics/page.test.tsx` (existing test file) — update mocked-content assertions to assert the chat island renders, not the placeholder text
- [ ] Suggested-question click prefills the input but does not auto-submit

### Backend Tests (pytest)
- [ ] `tests/unit/analytics/test_auth.py` — `resolve_caller_class_ids` returns owned set; `assert_caller_owns` raises for non-owned; **enumeration test** (error string identical for missing vs forbidden)
- [ ] `tests/unit/analytics/test_tools_count_messages.py` (and one per other tool) — mock `run_query`, assert SQL shape + parameter binding; assert `assert_caller_owns` called before any BQ call; assert structured output schema
- [ ] `tests/unit/analytics/test_summarise.py` — mocked Gemini call; assert group codes are redacted before the LLM sees them; assert returned themes do not contain raw group codes
- [ ] `tests/api_tests/test_analytics_routes.py` — `/api/analytics/tools` lists six tools; `/api/analytics/probe/count_messages` returns rows for owned class; returns 403 for non-owned class with identical-shape error to "does not exist"
- [ ] `tests/integration/test_analytics_e2e.py` (marked `@integration`) — seed two teachers + two classes + chat-log rows; assert each teacher's tools only see their own data; hit real BQ in `aipla-dev-2026`
- [ ] `tests/eval/evalsets/analytics_chat.evalset.json` — one case per tool, plus the "cross-tenant refusal" case

### Manual Testing
- [ ] Sign in as test teacher; pick a class with sessions; ask "how many messages did this class send?" — get a number that matches a CSV export I do alongside
- [ ] Same teacher: ask about a class they don't own (by guessing a class id) — get a "no such class accessible" refusal
- [ ] Ask "what misconceptions came up?" on a class with KineBot sessions; verify paraphrased themes, no verbatim student text
- [ ] Inspect Cloud Logging: every tool call has a structured `analytics_tool` entry with teacher uid + tool name + latency

## Security Considerations

- **Per-tool authorization** is the load-bearing security primitive. Authorization in the prompt or in the SQL WHERE clause the model writes are both rejected. Every tool function is `(user, class_id, ...) → assert_caller_owns(user, class_id) → query → result`.
- **Enumeration prevention**: the error returned for "class doesn't exist" and "class exists but isn't yours" is byte-identical. Tested in `test_auth.py`.
- **Group code redaction** before LLM summarisation in `summarise_chat_excerpts`. The LLM sees `G1, G2, G3` not `bold-kazoo-87`. Tested in `test_summarise.py`.
- **No verbatim student content** in agent responses. The skill prompt enforces paraphrase; the `summarise_chat_excerpts` tool also rejects (via a test) any returned theme that contains a substring ≥40 chars matching a sampled turn (string-match defense in depth on top of prompt instruction).
- **Cost / DoS posture**: `summarise_chat_excerpts` is bounded to 200 turns + one LLM call per invocation; `count_messages` etc. are O(rows) BQ aggregates with mandatory date-range parameters. No tool accepts free-form SQL. The model cannot trigger a table scan on the full dataset.
- **Logging contains no PII**: structured logs record teacher uid (already non-PII per the auth model), class id, tool name, SQL hash, row count, latency. No query results, no chat content, no group codes.

## Performance Considerations

- **Latency budget** per turn (target):
  - First AG-UI event: <300ms (axiom 1 KPI; unchanged from platform default)
  - First tool call kickoff after user submit: <1s
  - Tool call wall time: 1–3s per BQ query (BQ small-result latency in `europe-north1`)
  - First answer token after final tool returns: <1s
  - Total user-perceived "asked → started seeing answer": <4s for one-tool queries, <8s for three-tool queries
- BQ result cache: BQ's own query cache makes repeat questions in the same session near-instant; we rely on it rather than building an app-level cache.
- **No frontend bundle impact** — `_AnalyticsChat` is a new island but uses libraries already in the bundle (`useSkillAgent`, AG-UI client).
- `summarise_chat_excerpts` is the heaviest tool — bounded sample + single LLM call keeps p95 under 6s.

## Success Criteria

- [ ] All frontend tests passing (`npm run quality:check`)
- [ ] All backend tests passing (`cd backend && make test`)
- [ ] Backend lint clean (`make lint`)
- [ ] Six new analytics tools registered + reachable via `aiplatform analytics tools` on dev
- [ ] `aiplatform analytics probe <class-id> count_messages` returns real rows on dev for an owned class; returns identical-shape "no such class accessible" for a non-owned class id
- [ ] `aiplatform analytics ask <class-id> "how many messages did this class send?"` returns a cited numeric answer that matches a hand-run BQ query
- [ ] Frontend: a signed-in teacher on `/teacher/analytics` can submit a question and see streamed answer with at least one tool-call pill and a working "Show data" disclosure
- [ ] Eval suite (`make eval`) passes the six per-tool cases + the cross-tenant refusal case
- [ ] Cloud Logging shows structured `analytics_tool` entries for every tool call on dev
- [ ] SKILL.md prompt updated; re-seed verified via `GET /api/skills/analytics-chat` listing the six tools
- [ ] Doc moved to `implemented/` and an Implementation Report stub filled in

## Open Questions

- **Q1: Does `aipla_chat_turn` already carry `class_id`?** Needs a quick query in dev BQ. If yes, no upstream change. If no, a small 1.2 follow-up lands first (~1h work). Assumed yes for the estimate; will confirm on day 1 of Phase 1.
- **Q2: Does the existing `useSkillAgent` hook surface tool-call events on the AG-UI stream cleanly, or does the analytics surface need a thin adapter to render the pills?** I expect cleanly — the boldkast/kinebot skills already render tool-call indicators in the chat shell — but worth confirming before Phase 4 estimate is firm.
- **Q3: Should the teacher be able to switch class mid-conversation, or does each `class_id` start a fresh session?** Default plan: fresh session per class (clearer authorization model in the session state). Confirm with JB during mid-point review.
- **Q4: Should the analytics-chat skill be available to teachers in LOCAL_MODE?** Yes for dev ergonomics — the LOCAL_MODE workshop user already carries `role:teacher`. Tested via the smoke script.
- **Q5: Do we need a usage cap per teacher per day?** Probably not in v1 (10 pilot teachers). Listed because once we add 100+ teachers it matters and we should know that *now*, not on the day BQ costs spike.

## Related Documents

- [v1.0.0-pilot SEQUENCE.md](SEQUENCE.md) — where this design slots in (analytics critical path)
- [chat-log-pipeline.md](implemented/chat-log-pipeline.md) — the 1.2 sink that populates the BQ tables this skill queries
- [teacher-ui-ph3-sprint.md](teacher-ui-ph3-sprint.md) — M6 shipped the inert `analytics-chat` skill template; this design wires its tools
- [teacher-permission-model.md](implemented/teacher-permission-model.md) — 1.A `Class` entity + `role:teacher` tag this design depends on
- [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — the heavier post-pilot pedagogical layer; this design is the lighter R1-independent fallback
- [aiplatform-cli skill](../../../../.claude/skills/aiplatform-cli/SKILL.md) — patterns for the new `aiplatform analytics` subcommands
- [local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — CLI affordance backlink per the design-doc-creator heuristic
- [Product Axioms](../../../product-axioms.md)
