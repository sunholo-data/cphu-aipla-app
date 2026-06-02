# Sprint: ANALYTICS-CHAT-AND-INSIGHTS — Wire 1.L analytics-chat tools + 1.M insights dashboard on a shared query layer

**Sprint ID:** `ANALYTICS-CHAT-AND-INSIGHTS`
**Design docs:**
- [analytics-chat-tools.md](analytics-chat-tools.md) — 1.L
- [teacher-insights-dashboard.md](teacher-insights-dashboard.md) — 1.M
**Branch:** `feature/analytics-chat-and-insights` (executor scratch space; FF to `dev` on each milestone gate)
**Base commit:** `374e9f0` (dev HEAD, 2026-06-02)
**Estimate:** ~5 calendar days serial (7–9 dev-days of work; assumes 2 dev-days/day cadence)
**Created:** 2026-06-02
**Status:** Planned
**Last Updated:** 2026-06-02

## Sprint goal

Wire the two surfaces — the analytics-chat skill (1.L) and the insights dashboard (1.M) — onto a **single shared** `backend/analytics/` query + authorization layer. Land per-tool authorization with byte-identical "not found / forbidden" error shape as the early hard gate; everything else depends on it. Ship before the 2026-06-26 mid-point review so the demo runs against real BigQuery numbers, then comfortably ahead of the 2026-06-29 → 07-05 holiday freeze.

The sprint is named for both docs because the milestones are tightly intertwined: M1–M3 land the shared infrastructure both surfaces consume, M4–M6 land 1.L (the chat surface), M7–M10 land 1.M (the dashboard surface). Splitting into two sprints would force duplicate query implementations or awkward sequencing.

## Workflow note — direct-to-dev, no PRs

Per [feedback-aipla-git-workflow](file:///Users/voightkampff/.claude/projects/-Users-voightkampff-dev-sunholo-data-cphu-aipla-app/memory/feedback_aipla_git_workflow.md): commits land **direct on `dev`**. No PR for the `dev` branch. The `feature/analytics-chat-and-insights` branch is the executor's scratch space across milestones; FF-merge to `dev` as each milestone gate passes. Promotion to `test` and `prod` happens later via PRs.

## Velocity context

Recent throughput (last 14 days): **274 commits** across **~57k LOC** (includes roadmap docs, sims, and the teacher-reports CSV/JSON exports landed today). That's a sustained ~20 commits/day at this tree's docs+code rate. This sprint's ~2.5–3k LOC (impl + tests) over 5 calendar days fits comfortably inside that envelope.

## Scope locks

**In scope:**
- `backend/analytics/` package: `auth.py` (resolve_caller_class_ids + assert_caller_owns), `queries.py` (six canned SQL queries), `tools.py` (FunctionTool wrappers for analytics-chat), `summarise.py` (bounded LLM paraphrase pass)
- `backend/insights/` package: `aggregates.py` (KPI compositions over the shared `queries.py`), `cache.py` (60s LRU)
- `backend/protocols/analytics_routes.py` (2 routes for CLI probe) and `backend/protocols/insights_routes.py` (5 routes for dashboard)
- Amend `backend/skills/templates/analytics-chat/SKILL.md` to declare the six tools + add the citation rules
- `backend/adk/tools.py` — register the six new FunctionTools in `TOOL_REGISTRY`
- Frontend chat island for `/teacher/analytics` (replace mocked input with `useSkillAgent("analytics-chat")`)
- Frontend KPI strip on `/teacher/classes` cards, ClassInsightsPanel on `/teacher/classes/[id]`, new `/teacher/insights` cross-class page
- `recharts` added to `frontend/package.json`, code-split off the student bundle
- CLI: `aiplatform analytics {tools,probe,ask}` + `aiplatform insights {class,compare,groups}` subcommands
- ADK eval cases (one per analytics tool + one cross-tenant refusal)
- Smoke scripts: `scripts/smoke-analytics-chat.sh`, `scripts/smoke-insights.sh`

**Out of scope (do NOT start):**
- Per-student analytics (ADR-001 — anonymous group codes only)
- Multi-class join queries in 1.L tools (single-class scope per chat turn)
- Saved views / custom dashboards in 1.M (fixed cards only)
- PDF / printable reports (CSV/JSON exports already shipped)
- Misconception clustering at scale (post-pilot 2.5 rubric work)
- Adding `class_id` column to the chat-log emitter — deferred to v1.1; this sprint uses the resolution-at-query-time path via `Class.group_codes`
- Real-time dashboard updates (60s cache stale window is fine)
- UCPH SSO federation
- Long time-range queries on dashboard (>30d) — v1.1
- Misconception themes beyond the bounded `summarise_chat_excerpts` tool

## Hard early gate — authorization enumeration check

**M2 ships the per-tool `assert_caller_owns(class_id)` primitive and the test that asserts the error byte-shape is identical for "class doesn't exist" vs "class exists but isn't yours".** Every milestone from M3 onward depends on this. If M2's enumeration test fails or is weakened, **stop the sprint and redesign** — do not paper over a leak path with prompt instructions or a `WHERE` clause downstream. This is a SECURE-BY-CONSTRUCTION axiom obligation and the load-bearing safety control for both surfaces.

## Milestones

| #   | What | Files | LOC est | Stack | Depends on |
|-----|------|-------|---------|-------|------------|
| M1  | Recharts dependency + code-split verification — add to `frontend/package.json`, set up dynamic import wrapper, measure bundle delta on student route vs teacher route, confirm <2 KB student bundle impact | `frontend/package.json`, `frontend/src/components/teacher/insights/_chartsBundle.ts` (new wrapper), bundle-analyzer diff | 60 | frontend | — |
| M2  | **Shared auth layer + first query (HARD GATE)** — `backend/analytics/auth.py` (`resolve_caller_class_ids`, `assert_caller_owns`, owned `group_codes` resolver), `queries.py` (`count_messages` SQL only), enumeration-prevention test (byte-identical error for missing vs forbidden) | `backend/analytics/__init__.py`, `auth.py`, `queries.py`, `tests/unit/analytics/test_auth.py`, `test_queries_count_messages.py` | 320 | backend | — |
| M3  | Remaining 1.L queries + FunctionTool wrappers — `time_on_task`, `sim_runs_per_skill`, `most_active_groups`, `group_summary` SQL; `tools.py` wrapping all five `FunctionTool`s; register in `TOOL_REGISTRY` | `backend/analytics/queries.py`, `backend/analytics/tools.py`, `backend/adk/tools.py`, `tests/unit/analytics/test_tools_*.py` | 380 | backend | M2 |
| M4  | `summarise_chat_excerpts` — bounded BQ sample + group-code redaction + single gemini-flash call + verbatim-substring defense | `backend/analytics/summarise.py`, `tests/unit/analytics/test_summarise.py` | 280 | backend | M2 |
| M5  | Skill wiring + `/api/analytics/*` routes + `aiplatform analytics` CLI — amend SKILL.md (`tools:` list + citation rules), `analytics_routes.py` (`GET /api/analytics/tools`, `POST /api/analytics/probe/{tool}`), three CLI subcommands, re-seed verification | `backend/skills/templates/analytics-chat/SKILL.md`, `backend/protocols/analytics_routes.py`, `backend/admin/platform_seed.py` (verify), `cli/aiplatform/commands/analytics.py`, route + CLI tests | 410 | backend + CLI | M3, M4 |
| M6  | **1.L frontend chat island** — `_AnalyticsChat.tsx` extracted island wired to `useSkillAgent("analytics-chat")`, scope-prefill into system message, tool-call pills, "Show data" SQL disclosure, suggested-question prefill (enable + click-to-prefill) | `frontend/src/app/teacher/analytics/page.tsx` (rewire), `frontend/src/app/teacher/analytics/_AnalyticsChat.tsx` (new), tests, update existing `analytics/__tests__/page.test.tsx` | 420 | frontend | M5 |
| M7  | `backend/insights/aggregates.py` + `cache.py` + `/api/insights/*` routes — six KPI aggregate functions composing 1.L queries; 60s LRU cache keyed on `(teacher_uid, surface, since, until)`; five REST endpoints with `_debug.queries` echoes | `backend/insights/__init__.py`, `aggregates.py`, `cache.py`, `backend/protocols/insights_routes.py`, `tests/unit/insights/test_*.py`, `tests/api_tests/test_insights_routes.py` | 480 | backend | M3 |
| M8  | `aiplatform insights` CLI subcommands + `/teacher/insights` cross-class page — three CLI subcommands (`class`, `compare`, `groups`) with table/json output; cross-class page with `CrossClassTable` + sort + deep-link | `cli/aiplatform/commands/insights.py`, `frontend/src/app/teacher/insights/page.tsx` (new), `frontend/src/components/teacher/insights/CrossClassTable.tsx`, tests | 360 | fullstack | M7 |
| M9  | `/teacher/classes` KPI strip + `/teacher/classes/[id]` ClassInsightsPanel — KpiCard, EngagementBar, TrendSparkline primitives; KPI strip on each card; per-class panel above Recent activity (KPI grid + per-group bar + per-activity bar + 7d trend) | `frontend/src/components/teacher/insights/{KpiCard,EngagementBar,TrendSparkline}.tsx`, `frontend/src/hooks/useInsights.ts`, modifications to `teacher/classes/page.tsx` + `teacher/classes/[id]/page.tsx`, tests | 540 | frontend | M7, M8 |
| M10 | Eval + smoke + a11y + observability pass — ADK evalset (6 tool cases + 1 cross-tenant refusal); `smoke-analytics-chat.sh`, `smoke-insights.sh`; chart `aria-label` summaries + `<table>` fallback under disclosure; Cloud Logging `analytics_tool`, `insights_query`, `dashboard_load` structured entries | `backend/tests/eval/evalsets/analytics_chat.evalset.json`, `scripts/smoke-analytics-chat.sh`, `scripts/smoke-insights.sh`, `frontend/src/components/teacher/insights/*` (a11y), `backend/observability/structured.py` (extend with the three log keys) | 280 | fullstack | M6, M9 |

**Total:** ~3530 LOC (impl + tests). ~5 calendar days at the recent throughput.

## Parallelization map

Where two milestones share no files, they can run in parallel (e.g. by separate sub-agents or by hand-pairing).

```
       ┌── M1 (frontend, recharts)
       │     │
       │     ▼
       │   (waits for M9 to consume)
       │
M2 ───┬── M3 ──┬── M5 ──┬── M6
       │        │
       │        ├── M4 (parallel with M3 — different file, both depend only on M2)
       │        │
       │        └── M7 ──┬── M8 ──┐
       │                 │        │
       │                 └── M9 ──┴── M10
```

**Critical path:** M2 → M3 → M7 → M9 → M10. Everything else folds in.
**Highest-value parallelization:** M1 (frontend bundle work) is doable right after sprint start independent of all backend work — schedule it for day 1 in parallel with M2. M4 (`summarise_chat_excerpts`) is independent of M3 once M2 lands; run them in parallel during day 2.
**Optimistic schedule** (parallel, two tracks): M2 day 1, M1+M3+M4 day 2, M5+M7 day 3, M6+M8 day 4, M9+M10 day 5.
**Serial schedule** (one track, no parallelism): M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10 lands in 5–6 days at the recent throughput.

## Acceptance gates per milestone

Each milestone closes when its gate is green. **Do not proceed to the next milestone with a red gate.**

**M1:**
- [ ] `npm run quality:check` green; new chart wrapper file present
- [ ] Bundle analyzer report attached to commit message showing student route bundle delta < 2 KB
- [ ] `import("recharts")` works from a dynamic chunk; static-import lint catches direct `from "recharts"` in non-`_chartsBundle.ts` files

**M2 (HARD GATE — see *Hard early gate* above):**
- [ ] `assert_caller_owns(user, class_id)` raises identical error string for "class missing" and "class exists but not owned" (asserted via a dedicated `test_enumeration_resistance` test)
- [ ] `resolve_caller_class_ids(user)` returns owned-class set including the `group_codes` union
- [ ] `count_messages` query runs against a fake `run_query` returning rows in the expected shape; SQL contains `WHERE group_id IN UNNEST(@allowed_group_codes)`; no f-string interpolation
- [ ] Backend `make lint` + `make test-fast` green

**M3:**
- [ ] Five FunctionTools register in `TOOL_REGISTRY`; one unit test per tool asserting SQL shape + parameter binding + `assert_caller_owns` called before any `run_query`
- [ ] Backend `make test-fast` green

**M4:**
- [ ] `summarise_chat_excerpts` redacts group codes to `G1, G2, ...` before the LLM sees them (`test_summarise.py::test_group_code_redaction`)
- [ ] Returned themes do not contain any substring ≥40 chars matching a sampled student turn (`test_summarise.py::test_no_verbatim_leak`)
- [ ] Backend `make test-fast` green

**M5:**
- [ ] `GET /api/analytics/tools` lists six tools (returns name + description; no execution)
- [ ] `POST /api/analytics/probe/{tool}` for an owned class returns rows + SQL; for a non-owned class returns identical-shape error
- [ ] `aiplatform analytics tools` prints the six tool names; `aiplatform analytics probe <owned-class> count_messages` prints real rows; `aiplatform analytics probe <unowned> count_messages` prints the same "not accessible" error as a non-existent class
- [ ] SKILL.md `tools:` field lists the six tools; re-seed verified via `GET /api/skills/analytics-chat`
- [ ] Backend `make test-fast` + `make lint` green

**M6:**
- [ ] Signed-in test-teacher on `/teacher/analytics` can submit a question, see the AG-UI stream, see at least one tool-call pill, click "Show data" and see the SQL
- [ ] Empty state renders when no class is selected
- [ ] Suggested-question buttons enabled; click prefills input without auto-submit
- [ ] `npm run quality:check` green; new tests cover the chat island + suggested-question prefill

**M7:**
- [ ] Five `/api/insights/*` routes return real data on dev for an owned class; identical-shape refusal on unowned class
- [ ] `_debug.queries` field present on every response (frontend will consume it in M9)
- [ ] 60s cache: a second call within 60s of the first returns from cache (assert via `test_cache.py`); cache invalidation on simulated class-PATCH works
- [ ] Backend `make test-fast` + `make lint` green

**M8:**
- [ ] `aiplatform insights class <id>` prints KPI grid in table format; `--format json` prints raw payload
- [ ] `aiplatform insights compare` prints sortable cross-class table; `aiplatform insights groups <id>` prints per-group bar data
- [ ] `/teacher/insights` page renders the `CrossClassTable` with mocked data in unit tests; clicking a column header sorts
- [ ] `npm run quality:check` green

**M9:**
- [ ] `/teacher/classes` cards show the KPI strip with real numbers from `/api/insights/summary`
- [ ] `/teacher/classes/[id]` ClassInsightsPanel renders above Recent activity with KPI grid + per-group bar + per-activity bar + 7d trend
- [ ] Per-card error boundary: simulated one-card failure leaves other cards rendered
- [ ] Definition tooltip + "Show data" disclosure work on every card
- [ ] `npm run quality:check` green; existing class-page tests still pass

**M10:**
- [ ] `make eval` passes the 6 per-tool + 1 cross-tenant-refusal evalset cases
- [ ] `scripts/smoke-analytics-chat.sh` runs end-to-end against dev with the test-teacher account
- [ ] `scripts/smoke-insights.sh` hits all five insights routes + asserts cross-tenant refusal
- [ ] All chart components have `aria-label` + `<table>` fallback rendered under "Show data" disclosure
- [ ] Cloud Logging shows `analytics_tool`, `insights_query`, `dashboard_load` entries on dev (verified via `gcloud logging read`)
- [ ] Both docs (1.L + 1.M) moved to `implemented/`; Implementation Report stubs filled in

## Final sprint gates

- [ ] All ten milestones green
- [ ] Backend `make lint && make test-fast` green (CI parity)
- [ ] Frontend `npm run quality:check` green (CI parity, not the fast variant — per the [feedback_pre_push_ci_parity](file:///Users/voightkampff/.claude/projects/-Users-voightkampff-dev-sunholo-data-cphu-aipla-app/memory/feedback_pre_push_ci_parity.md) memory)
- [ ] No emoji introduced anywhere (per `feedback_no_emoticons` memory)
- [ ] No new `aiplatform_chat_turn`-level migration applied (the resolution-at-query-time path holds)
- [ ] Recharts bundle delta on student route < 2 KB (re-measured after M9)
- [ ] FF-merge `feature/analytics-chat-and-insights` → `dev`
- [ ] Both design docs moved to `docs/design/aipla/v1.0.0-pilot/implemented/`

## Code preservation rules

The recent CSV/JSON-export sprint and the upstream KineBot wrong-answer-card change both broke previously-passing tests because behavior was changed without updating the asserting tests in the same commit. Avoid the same trap here:

- **Do not delete or weaken existing tests** without an updating commit in the same milestone that states what behavior changed and why. If a test fails because the underlying behavior moved, **fix the test in the same PR/commit that moved the behavior** — never just silence the assertion.
- **Do not regress shipped surfaces.** The teacher-reports CSV/JSON exports landed earlier today (`a1947f8`); they must still work green at the end of this sprint. Run `npx vitest run src/app/teacher` before committing M9.
- **Do not touch the analytics-chat SKILL.md prompt** beyond the additions specified in M5. Pedagogical prompt iteration is a JB / AR concern, not an engineering one.
- **Do not change the chat-log emitter schema.** Q1 from 1.L is resolved by resolving owned `class_id` → owned `group_codes` at query time. Adding `class_id` to the emitter is v1.1 scope.
- **Do not add a new authorization primitive.** If a milestone seems to need one, it's the wrong shape — the shared `auth.py` from M2 covers both surfaces.
- **Bundle discipline.** Never `import { Foo } from "recharts"` outside `_chartsBundle.ts`. Lint rule TBD; M1 verifies the rule manually until it's automated.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| BQ tables in dev have insufficient data to validate KPI math | Medium | Medium — eyeballing zeros isn't a confidence-builder | Seed dev with the test-teacher running 3–5 sessions across 2 groups before starting M7. Smoke script can fail loudly if total messages < 10 |
| `recharts` bundle delta on the student route exceeds the 2 KB budget | Low | Medium — would block M9 acceptance | M1 measures up-front. Mitigation if exceeded: dynamic-import the entire `ClassInsightsPanel` so the chart code only loads on the teacher route |
| `useSkillAgent` doesn't surface tool-call events cleanly enough for the "Show data" disclosure UX | Medium | Low — fallback is plaintext SQL block | Confirm during M6 day 1; if it's awkward, render SQL inline in a `<details>` block as a degraded fallback rather than re-architecting |
| Enumeration test passes by accident (e.g. both branches happen to return the same string for unrelated reasons) | Low | High — the entire safety story rests on this | Test is intentionally written to assert byte-equality after stripping path/timestamp; add a second test where one user owns the class and gets a 200, confirming the test detects the difference |
| BQ query cost spike from a runaway tool | Low | Medium — `summarise_chat_excerpts` is the only unbounded-shape tool | Hard 200-row sample cap in `summarise.py`; bounded date window required on every query; Cloud Logging shows row-count + bytes-scanned per call |
| Mid-sprint conflict with parallel sim work landing on `dev` | Medium | Low — different file trees | Rebase `feature/analytics-chat-and-insights` onto `dev` at the start of each calendar day; smoke any conflicts immediately |
| The "long IN-list" path (owned group_codes union) hits BQ parameter limits at 50+ classes | Low for pilot, real for v1.1 | Medium long-term | Document the limit in code comment; revisit in v1.1 when the add-class_id-to-emitter path lands |
| JB / AR want prompt or KPI-definition tweaks mid-sprint | Medium | Low — the data layer doesn't care | Treat prompt+definition copy as text-only PRs that land after the sprint; don't block milestone gates on copy review |
| Test fixtures for BQ require special setup the integration tests can't run in CI | High | Low — unit tests mock `run_query` | Mark BQ-touching tests `@integration`; CI runs unit tests only; integration tests run from a dev box against `aipla-dev-2026` |
| The shared auth helper accidentally gets used outside `backend/analytics/` and starts importing unintended state | Low | Medium | Keep `assert_caller_owns` strictly in the `backend/analytics/` package; routes that need it import explicitly; do not re-export from `backend/auth/` |

## Daily checkpoint script

Run at the end of every calendar day to record progress + verify health:

```bash
#!/usr/bin/env bash
# scripts/sprint-checkpoint-analytics.sh — daily health check + status print
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "=== Daily checkpoint $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo
echo "--- Branch ---"
git status --short
git log --oneline -5

echo
echo "--- Backend tests ---"
(cd backend && make lint && make test-fast) || {
  echo "BACKEND GATE RED"
  exit 1
}

echo
echo "--- Frontend quality (CI parity) ---"
(cd frontend && npm run quality:check) || {
  echo "FRONTEND GATE RED"
  exit 1
}

echo
echo "--- Bundle delta on student route (M1 acceptance) ---"
(cd frontend && npx next build 2>&1 | grep -E "^\.\s+/(group|lessons|chat)" || true)

echo
echo "--- Milestone progress ---"
test -f .claude/state/sprints/sprint_ANALYTICS-CHAT-AND-INSIGHTS.json && \
  jq '.milestones | map({id, status, blocked_by})' .claude/state/sprints/sprint_ANALYTICS-CHAT-AND-INSIGHTS.json

echo
echo "GREEN — safe to FF to dev"
```

This script is the executor's single source of truth on "is the tree healthy?". If it exits non-zero, **fix the gate before resuming feature work** — do not stack new milestones on a red tree.

## Dependencies

- **1.2 chat-log pipeline** — shipped; BQ tables `chat_logs.aipla_chat_turn` + `aipla_workbench_event` live in `europe-north1`
- **1.A teacher-permission-model** — shipped; `Class.group_codes` field exists, `is_teacher` gate works, `role:teacher` tag on Firebase auth path
- **teacher-ui-ph3 M6** — shipped; `analytics-chat` skill template seeded with `tools: []`. This sprint amends `tools:` to the six new entries.
- **No new infra** — no terraform, no IAM, no GCP resource creation. All work is application-layer.

## Out of scope (do NOT start)

- Add `class_id` to the chat-log emitter (v1.1)
- Pedagogical-rubric layer (post-pilot 2.5)
- Per-student analytics (ADR-001)
- PDF / printable reports
- Saved dashboard views
- Real-time SSE updates on the dashboard
- 30d+ time-range queries
- Multi-class joins in tool calls
- Misconception clustering at scale
- Custom KPI configurations per teacher
- Adding a new auth primitive

## Related documents

- [analytics-chat-tools.md](analytics-chat-tools.md) — 1.L design
- [teacher-insights-dashboard.md](teacher-insights-dashboard.md) — 1.M design
- [v1.0.0-pilot SEQUENCE.md](SEQUENCE.md) — analytics critical path
- [chat-log-pipeline.md](implemented/chat-log-pipeline.md) — 1.2, the data source
- [teacher-permission-model.md](implemented/teacher-permission-model.md) — 1.A, the auth source
- [Product Axioms](../../../product-axioms.md)
