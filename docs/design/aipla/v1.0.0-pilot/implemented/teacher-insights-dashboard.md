# Teacher Insights Dashboard — KPI cards + cross-class comparison + per-group breakdown

**Status**: Planned
**Priority**: P1
**Estimated**: 3–4 days (backend routes 0.5d, frontend charts 2d, integration + tests 0.5–1d) — *assumes 1.L Phase 1–2 has landed first; if 1.L slips, add 1d for query layer*
**Scope**: Fullstack
**Dependencies**: **1.L analytics-chat-tools** (Phase 1–2 — shares the `backend/analytics/` query + authorization layer), 1.2 chat-log pipeline (shipped), 1.A teacher permission model (shipped — `Class` entity provides the `class_id` → `group_codes` mapping that closes the schema gap)
**Created**: 2026-06-02
**Last Updated**: 2026-06-02

## Problem Statement

Teachers in the 2026-08-14 pilot will arrive at `/teacher/classes`, see a list of their classes, and want to answer two questions in under thirty seconds: *"how is this class going overall?"* and *"how does this class compare to my others / to last week?"* — neither answerable today. The only existing surfaces are per-session reports (one group, one session — too granular for an overview) and the in-progress analytics-chat (free-form Q&A — too slow for a glance).

The CSV/JSON exports that just shipped (and the analytics-chat skill from 1.L) cover the *deep-dive* and *ask-a-question* axes. What's missing is the *glance* axis — a dashboard that shows engagement signals at a class level, across classes, and broken down per group within a class, so the teacher can decide where to look closer before opening any session report or composing any analytics-chat question.

**Current State:**
- [/teacher/classes](../../../../frontend/src/app/teacher/classes/page.tsx) — class cards show `N groups · M activities configured` plus class name. No engagement signal at all. A teacher with five classes can't tell which one needs attention.
- [/teacher/classes/[id]](../../../../frontend/src/app/teacher/classes/%5Bid%5D/page.tsx) — header shows `N groups · M activities assigned`; "Recent activity" lists individual sessions but no per-group rollup ("which groups have been active this week?"), no per-activity engagement ("which activity has the most sim runs?"), no time trend.
- No cross-class comparison surface exists. A teacher running the same activity across two cohorts cannot diff them.
- The chat-log BQ tables ([backend/observability/chat_log.py:90](../../../../backend/observability/chat_log.py)) carry `session_id`, `group_id`, `skill_id` but **not `class_id`** — confirmed on inspection. Schema gap closed at query time by resolving owned `class_id`s → owned `group_codes` via Firestore (each `Class` already has `group_codes: list[str]`); no BQ schema change needed.

**Impact:**
- **Pilot teachers (10)**: with 4–6 groups per class running 2–3 activities, the cognitive load of "which group hasn't engaged this week?" without a dashboard is real friction. The pilot exit interview will not score well if the answer to "how was the experience?" is "I had to download CSVs to figure out who needed a nudge."
- **JB / AR (research stakeholders)**: a glanceable per-class rollup is what they'll point at when asked "show me how AIPLA is being used" without committing to the heavier 2.5 pedagogical-rubric layer (which is R1-gated and post-pilot).
- **Demo readiness for the mid-point review (2026-06-26)**: a working dashboard with real numbers is meaningfully more compelling than a working chat surface with the same numbers, in a 30-minute meeting. Both should ship; if scheduling forces sequencing, this one demos in 90 seconds and analytics-chat takes a full Q&A round-trip.
- **Engineering parsimony**: the BQ queries to compute "messages per group this week" already need to exist for 1.L. Building them once and exposing through both a dashboard REST endpoint and a chat FunctionTool is cheaper than two parallel implementations. This design depends on 1.L's `backend/analytics/queries.py` so the queries land **once**.

## Goals

**Primary Goal:** A teacher can land on `/teacher/classes`, see a one-line engagement signal per class, click into a class and see KPI cards + a per-group breakdown table, and navigate to `/teacher/insights` for a cross-class comparison — every number is real, every value carries its definition, every chart loads in under 3s.

**Success Metrics:**
- A signed-in teacher with at least one class and one session sees real numbers (not placeholder/loading skeletons) within 3s of page load on each of the three surfaces. Measured via Cloud Trace TTFB + frontend `performance.mark` on first chart render.
- The teacher can identify the **single least-engaged group in a class** in under 15 seconds, from a cold page load. (Self-test via the smoke script in CI.)
- **Zero cross-teacher data leak**: any KPI route called for a class id the caller does not own returns the same shape as "class not found" — identical to the 1.L authorization contract.
- The dashboard does not invent engagement signals not surfaced in the chat-log data. Every KPI card carries a tooltip / disclosure explaining (a) what it measures, (b) what counts as "active" / "completed" / etc., (c) the BQ query that produced it (collapsed by default; one click to expand).

**Non-Goals:**
- **Learning signals.** This dashboard surfaces engagement (counts, durations, recency), not learning (conceptual progress, misconception resolution, ICAP-style coding). The pedagogical lens is the post-pilot 2.5 [session-analytics-rubric](../post-pilot/session-analytics-rubric.md), gated on the R1 framework pick.
- **Per-student analytics.** ADR-001 anonymity model — the smallest unit is the anonymous group code. No per-student leaderboards, no individual progress tracking.
- **Real-time live updating.** A 60-second stale window is fine for a teacher's workflow. No SSE / WebSockets / live cursors. Manual refresh button + a "last updated 30s ago" timestamp.
- **Long time-range queries.** v1 = last 7 days + "since class start" only. A 6-month date picker is v1.1.
- **Saved views / custom dashboards.** Fixed card set, no teacher-configurable layouts. v1.1.
- **PDF / printable reports.** CSV/JSON exports already cover the data-out need.
- **Replacing the analytics-chat surface (1.L).** Dashboard answers *"how is it going?"*; chat answers *"why?"*. Both ship.

## Axiom Alignment

Score each axiom per [Product Axioms](../../../product-axioms.md). Net score must be >= +4. Max 2 conflicts (-1) allowed.

| #  | Axiom | Score | Notes |
|----|-------|-------|-------|
| 1  | INSTANT FEEL | +1 | Skeleton states for every card during BQ fetch; cards render independently (one slow query doesn't block the whole grid); 60s server-side cache on KPI routes so navigation back to a recently-viewed class is instant. |
| 2  | EARNED TRUST | +1 | Every KPI card has an info disclosure that surfaces its definition (e.g. *"Active group = sent ≥1 message in the last 7 days"*) and a "Show data" button that reveals the SQL + raw rows. No hidden assumptions; teacher can audit any number on the page. |
| 3  | SKILLS, NOT FEATURES | 0 | This is a teacher-administrative surface, not a skill. Neutral — same status as `/teacher/classes` and `/teacher/reports` which exist for the same reason. Surfaces a path *to* skills (clicking a low-engagement group deep-links into that group's session report). |
| 4  | RIGHT MODEL, RIGHT MOMENT | 0 | No AI on this surface. BQ aggregates only. |
| 5  | GRACEFUL DEGRADATION | +1 | Per-card error boundaries — if one query fails (BQ outage, missing dataset, slow path), that card shows *"data unavailable, retry"* and the rest of the page renders. Mirrors the per-session-report fallback pattern from `summarize_session_bq`. |
| 6  | PROTOCOL OVER CUSTOM | +1 | REST endpoints for the KPI data (vanilla JSON), `recharts` for the viz (de-facto React standard), Tailwind for styling (already in tree). Nothing invented. **Reuses 1.L's `backend/analytics/queries.py` + `auth.py`** rather than duplicating query code. |
| 7  | API FIRST | +1 | Every dashboard number is reachable via the new `/api/insights/*` endpoints; same data is reachable from CLI via `aiplatform insights class <id>` and `aiplatform insights compare`. Frontend has no privileged path. |
| 8  | OBSERVABLE BY DEFAULT | +1 | Each dashboard load emits `dashboard_load` structured log (teacher uid, surface name, card-render latency p95); each KPI route emits `insights_query` (route, class id, cache hit/miss, row count, latency). Tied to the same naming scheme as 1.L's `analytics_tool` logs. |
| 9  | SECURE BY CONSTRUCTION | +1 | Authorization is `assert_caller_owns(class_id)` from 1.L on every route, plus a `resolve_caller_class_ids(user)` for the cross-class endpoint. No new authorization primitive; the load-bearing safety code is shared with 1.L. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Charts are by nature client-side. Data shaping (aggregation, percentile calc, percent-change) happens server-side; the client only renders. Neutral rather than +1 because adding `recharts` is a meaningful bundle-size additon (~50 KB gzipped). |
| 11 | USABLE BY DESIGN | +1 | Bilingual where adjacent surfaces are; explicit empty states ("No sessions yet — students need to join a group and start chatting"); definitions inline on every card; accessibility — every chart has an `aria-label` summary + a `<table>` fallback under a "Show data" disclosure for screen readers. |
|    | **Net Score** | **+8** | Threshold: >= +4 ✅ |

**Conflict Justifications:** None — no -1 scores.

## Standards Compliance Check

- **No new query layer.** Reuses `backend/analytics/queries.py` from 1.L. If 1.L hasn't landed when this starts, the first half-day of work is "extract the query layer from 1.L's scope and land it under shared ownership" — same code, different sequencing.
- **`recharts`** ([npm](https://www.npmjs.com/package/recharts)) — verified package exists, currently ~v2.x stable, MIT-licensed, peer deps satisfied by React 19 in this tree. Standard React viz library. Alternatives considered: `victory` (heavier, more opinionated), raw `d3` (too low-level for this scope), `chart.js` (canvas-based, less Tailwind-friendly).
- **REST over GraphQL.** Three to five endpoints; GraphQL would be overkill for the scope.
- **AG-UI / A2UI not applicable** — this is a server-data-rendered dashboard, not a chat surface or a tool-emitted UI artefact.
- **Agent Skills `SKILL.md` not applicable** — not a skill.

## CLI Surface

Per the design-doc-creator CLI affordance heuristic, the dashboard's underlying data is also a developer-debug surface (eyeball the numbers from a terminal without spinning up the frontend).

```bash
# Per-class KPI snapshot — same payload as /api/insights/classes/{id}/kpis.
aiplatform insights class <class-id> [--since 7d] [--format table|json]

# Cross-class comparison — same payload as /api/insights/compare.
aiplatform insights compare [--since 7d] [--format table|json]

# Per-group breakdown within a class — same payload as
# /api/insights/classes/{id}/groups.
aiplatform insights groups <class-id> [--since 7d] [--format table|json]
```

Each command is ~30 LOC of Click + httpx + a unit test. Uses the same auth path as the existing `aiplatform class` commands (the [aiplatform-cli skill](../../../../.claude/skills/aiplatform-cli/SKILL.md) documents the token-mint pattern). Add a row to the v1.0.0-pilot `SEQUENCE.md` analytics critical path once this doc is in.

## Design

### Overview

Two REST routes per class plus one cross-class route, each backed by 1.L's `backend/analytics/queries.py` + `auth.py`. Three frontend surfaces: (a) a small KPI strip on the existing `/teacher/classes` cards (one query per teacher per page-load — `/api/insights/summary`), (b) a "Class insights" panel on `/teacher/classes/[id]` above the existing "Recent activity" section (per-class + per-group), and (c) a new `/teacher/insights` page for cross-class comparison.

### Frontend Changes

**New Components:**
- `frontend/src/app/teacher/insights/page.tsx` — the cross-class comparison page. Renders a table of all the teacher's classes side-by-side on the same KPI columns, plus a small bar chart per column for quick visual diff.
- `frontend/src/components/teacher/insights/KpiCard.tsx` — reusable card primitive. Props: `label`, `value`, `unit?`, `delta?` (percent-change vs prior period), `definitionTooltip`, `sqlRevealable`. Renders the headline value big, the delta as a colored sub-line, the definition under a `<button aria-label="What is this?">` icon, and the SQL/data under a "Show data" disclosure (same pattern as the analytics-chat "Show data" panel from 1.L).
- `frontend/src/components/teacher/insights/EngagementBar.tsx` — one-row horizontal bar chart (recharts `BarChart` with `layout="vertical"`) for the per-group distribution.
- `frontend/src/components/teacher/insights/TrendSparkline.tsx` — tiny recharts `LineChart` for the 7-day-trend cards.
- `frontend/src/components/teacher/insights/CrossClassTable.tsx` — sortable table primitive for the `/teacher/insights` page.

**Modified Components:**
- [frontend/src/app/teacher/classes/page.tsx](../../../../frontend/src/app/teacher/classes/page.tsx) — under the existing class card body, add a thin KPI strip: `Active groups: X · Messages 7d: Y · Last activity: <relative time>`. One backend call (`/api/insights/summary`) returns all classes' summaries in one round-trip so the dashboard doesn't fan out N requests.
- [frontend/src/app/teacher/classes/[id]/page.tsx](../../../../frontend/src/app/teacher/classes/%5Bid%5D/page.tsx) — add a `<ClassInsightsPanel classId={id}>` section between the "Activities assigned" section and "Recent activity". The panel contains: (a) a KPI card grid (4–6 cards), (b) a per-group engagement bar (one bar per group code in the class, sortable by message count or recency), (c) a per-activity engagement bar (one bar per assigned activity, message-count + sim-run-count side-by-side).
- [frontend/src/app/teacher/_TeacherClientShell.tsx](../../../../frontend/src/app/teacher/_TeacherClientShell.tsx) — if a side nav exists, add a "Insights" link to `/teacher/insights`. (Check first; if no shell nav today, defer to v1.1 — the page is reachable from a button on `/teacher/classes`.)

**State Management:**
- New `useInsights(classId)` hook in `frontend/src/hooks/useInsights.ts` — fetch + cache-by-class-id within the React tree. Per-card loading state so cards render independently.
- No global state. Each surface fetches on mount; stale-while-revalidate on remount within the same session is opportunistic, not required.

**UI/UX:**
- Each KPI card: headline value + unit, delta vs prior period (e.g. `+12% vs last week`), definition icon (hover for tooltip; click for full modal on mobile), "Show data" disclosure under a chevron.
- Bar charts: stable color per group code (`group-code → consistent color` via simple hash → palette index) so the same group is the same color across pages.
- Empty states: "No sessions yet — students need to join a group and start chatting." (already the phrasing in the existing Recent activity empty state.)
- Bilingual: Danish + English where the surrounding teacher pages are bilingual; English-only where they're already English-only.

### Backend Changes

**New Module:**
- `backend/insights/` — new package, mirrors the `backend/analytics/` shape from 1.L.
  - `__init__.py`
  - `aggregates.py` — wraps 1.L's `queries.py` to compute the KPI shapes (sometimes that's one query, sometimes it's two queries + a percent-change calc).
  - `cache.py` — in-memory LRU + TTL (60s) on the aggregate functions. Keyed by `(teacher_uid, surface, since, until)`. Eviction on `class_id` change for that teacher (i.e. PATCH to a class invalidates that teacher's cached summaries). Trivial implementation — `functools.lru_cache` with manual invalidation, not Redis.

**KPI catalogue — six per-class cards + one trend chart per surface:**

| Card | Definition | Underlying query (from 1.L) |
|---|---|---|
| Active groups (7d) | Groups with ≥1 message in the last 7 days | `count_messages(class_id, since=7d)` → distinct group_codes |
| Total messages (7d) | All chat turns this class produced in the last 7 days | `count_messages(class_id, since=7d).total` |
| Active activities (7d) | Activities with ≥1 message in the last 7 days | `sim_runs_per_skill(class_id, since=7d)` ∪ `count_messages` per skill |
| Sim runs (7d) | Workbench sim executions across all groups in the last 7 days | `sim_runs_per_skill(class_id, since=7d).total` |
| Avg time-on-task (7d) | Median minutes-per-session across groups this week | `time_on_task(class_id, since=7d)` → median duration |
| Last activity | Recency of the most recent message in the class | `most_active_groups(class_id, limit=1)` → max last_message_at |
| **7-day trend** (chart) | Messages-per-day for the last 7 days, stacked by group code | `count_messages` with `GROUP BY DATE(timestamp), group_id` over the 7d window |

**Per-group breakdown chart (inside `/teacher/classes/[id]`):**

| Bar | Per-group | Per-activity |
|---|---|---|
| Bar value | Messages 7d | Messages 7d + sim runs 7d (grouped) |
| Sort | Default: most active → least active | Default: most active → least active |
| Click | Deep-links to `/teacher/reports/groups/{code}` | Deep-links to `/teacher/classes/[id]` filtered (TBD or noop in v1) |

**Cross-class comparison columns (on `/teacher/insights`):**

Class | Groups | Messages 7d | Δ vs prior 7d | Sim runs 7d | Last activity | (small spark for 7d trend)

Sort by any column. Click a class row to deep-link into that class's detail page.

**New Endpoints:**

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/insights/summary` | All classes the caller owns, with the small KPI strip data (Active groups, Messages 7d, Last activity) | teacher only |
| GET | `/api/insights/classes/{class_id}/kpis` | Per-class card grid + 7-day trend chart data | teacher + `assert_caller_owns(class_id)` |
| GET | `/api/insights/classes/{class_id}/groups` | Per-group engagement breakdown (used by the bar chart) | teacher + `assert_caller_owns(class_id)` |
| GET | `/api/insights/classes/{class_id}/activities` | Per-activity engagement breakdown | teacher + `assert_caller_owns(class_id)` |
| GET | `/api/insights/compare` | Cross-class table data | teacher only |

All routes accept `?since=7d|30d|all` (default 7d) and `?until=<iso>` (default now). All return the SQL + parameters used for the response in a `_debug.queries: [{name, sql, params}]` field — the frontend uses this to populate the "Show data" disclosure. Token-budget cost: small (<1 KB per response).

**Closing the `class_id` schema gap:**

Chat-log BQ rows don't carry `class_id` today (confirmed via [chat_log.py:90](../../../../backend/observability/chat_log.py)). Two paths:

- **Resolve at query time (chosen for v1)**: `auth.resolve_caller_class_ids(user)` already returns the teacher's owned `class_id` set; expand it to also return the union of `group_codes` for those classes (via the existing `list_classes_for_owner`). Queries then filter `WHERE jsonPayload.group_id IN UNNEST(@allowed_group_codes)`. No BQ schema change.
- **Add `class_id` to the emitter (deferred to v1.1)**: cleaner long-term, especially when teachers grow past 50–100 classes and the IN-list gets long, but a backfill is awkward (early rows would be NULL). Listed as future work; not blocking.

This decision is made in this doc rather than 1.L because the resolution-at-query-time approach is what both designs need; landing it once under 1.L Phase 1 is the right shape.

### API Changes

| Method | Endpoint | Description | Breaking? |
|--------|----------|-------------|-----------|
| GET | /api/insights/summary | New — KPI strip for all owned classes | No |
| GET | /api/insights/classes/{id}/kpis | New — per-class KPI grid + 7d trend | No |
| GET | /api/insights/classes/{id}/groups | New — per-group breakdown | No |
| GET | /api/insights/classes/{id}/activities | New — per-activity breakdown | No |
| GET | /api/insights/compare | New — cross-class comparison | No |

### Architecture Diagram

```
[/teacher/classes]    [/teacher/classes/[id]]    [/teacher/insights]
        ↓                       ↓                        ↓
useInsights(undefined)   useInsights(classId)    useInsights(undefined)
        ↓                       ↓                        ↓
/api/insights/summary    /api/insights/classes/{id}/*    /api/insights/compare
        ↓                       ↓                        ↓
              backend/insights/aggregates.py
                          ↓
              backend/insights/cache.py  (60s TTL)
                          ↓
              backend/analytics/queries.py   ← shared with 1.L
              backend/analytics/auth.py      ← shared with 1.L
                          ↓
              backend/db/bigquery.py.run_query()
                          ↓
              chat_logs.aipla_chat_turn
              chat_logs.aipla_workbench_event
```

## Implementation Plan

### Phase 1: Backend KPI routes (~0.5–1d, +1d if 1.L hasn't landed)
- [ ] `backend/insights/aggregates.py` — six KPI functions, each wrapping a 1.L query (~120 LOC)
- [ ] `backend/insights/cache.py` — TTL LRU helper (~60 LOC)
- [ ] `backend/protocols/insights_routes.py` — five endpoints (~200 LOC)
- [ ] Tests: `tests/api_tests/test_insights_routes.py` for auth + shape (~250 LOC); a cross-tenant refusal test mirroring 1.L's contract

### Phase 2: Class-card KPI strip + class-detail panel (~1.5d)
- [ ] `frontend/src/hooks/useInsights.ts` (~80 LOC + tests)
- [ ] `KpiCard`, `EngagementBar`, `TrendSparkline` components (~250 LOC + tests)
- [ ] Modify `/teacher/classes/page.tsx` to render the strip per card (~50 LOC change)
- [ ] Add `ClassInsightsPanel` to `/teacher/classes/[id]/page.tsx` (~150 LOC + tests)
- [ ] Wire definition tooltips + "Show data" disclosures (~100 LOC)

### Phase 3: Cross-class comparison page (~1d)
- [ ] `frontend/src/app/teacher/insights/page.tsx` (~200 LOC + tests)
- [ ] `CrossClassTable` component with sort (~150 LOC + tests)
- [ ] Empty state ("Once you have classes with sessions, comparisons appear here")
- [ ] Navigation entry — add a "Insights" link to the teacher shell or a button on `/teacher/classes`

### Phase 4: CLI + smoke (~0.5d)
- [ ] `cli/aiplatform/commands/insights.py` — three subcommands (~100 LOC + tests)
- [ ] `scripts/smoke-insights.sh` — hits each endpoint on the deployed dev env with the test-teacher account; asserts non-empty payloads + cross-tenant refusal

### Phase 5: Accessibility + observability pass (~0.5d)
- [ ] `aria-label` summary on every chart; `<table>` fallback under disclosure for screen readers
- [ ] Cloud Logging `dashboard_load` + `insights_query` structured entries
- [ ] Frontend `performance.mark` on first chart render → log to console + (eventually) ship as a perf metric

## Migration & Rollout

**Database Migrations:**
- None. Resolution-at-query-time closes the `class_id` schema gap (see *Closing the `class_id` schema gap* above).
- Optional follow-up: add `class_id` to the chat-log emitter. Tracked as v1.1 cleanup; ship after pilot start.

**Feature Flags:**
- No flag. Surfaces are gated by `is_teacher` (already in place). A teacher landing on the modified `/teacher/classes` page sees the new KPI strip; nothing else changes.

**Rollback Plan:**
- Frontend: revert the page modifications (each surface is a single PR-able change). Server-side routes can stay — unused endpoints don't harm anyone.
- Backend: revert `insights_routes.py` registration in `fast_api_app.py`; routes 404 cleanly.

**Environment Variables:**
- None new. Inherits 1.L's setup.

## Testing Strategy

### Frontend Tests (Vitest + React Testing Library)
- [ ] `KpiCard.test.tsx` — renders value/unit/delta; opens definition tooltip; opens "Show data" disclosure; renders empty state when value is null
- [ ] `EngagementBar.test.tsx` — renders bars in sorted order; clicking a bar fires the deep-link
- [ ] `TrendSparkline.test.tsx` — renders a line for 7 data points; renders empty state for zero points
- [ ] `CrossClassTable.test.tsx` — sorts by column on header click; deep-links on row click
- [ ] `useInsights.test.ts` — fetches once per class id, surfaces loading + error states per card
- [ ] `/teacher/classes/page.test.tsx` (existing) — assert the KPI strip renders with mocked summary data
- [ ] `/teacher/classes/[id]/page.test.tsx` (existing) — assert ClassInsightsPanel renders above Recent activity
- [ ] `/teacher/insights/page.test.tsx` (new) — empty state + populated state

### Backend Tests (pytest)
- [ ] `tests/unit/insights/test_aggregates.py` — mock `run_query`, assert KPI shapes + percent-change math (7 cards × ~50 LOC each)
- [ ] `tests/unit/insights/test_cache.py` — 60s TTL behavior; invalidation on class-id change
- [ ] `tests/api_tests/test_insights_routes.py` — auth gate (`is_teacher`), per-route `assert_caller_owns`, identical-shape cross-tenant refusal, `_debug.queries` field present
- [ ] `tests/integration/test_insights_e2e.py` (`@integration`) — seed two teachers + two classes + chat-log rows in dev BQ; assert each teacher's dashboard shows only their own data

### Manual Testing
- [ ] As test teacher: land on `/teacher/classes`, see KPI strip on each card; numbers match what `aiplatform insights class <id>` returns
- [ ] Click into a class with sessions: KPI grid + per-group bar + per-activity bar all render with real numbers
- [ ] Click a group bar → deep-link to that group's session report
- [ ] Click the definition icon on every card; click "Show data" on at least three — verify SQL + params display
- [ ] Navigate to `/teacher/insights`: cross-class table renders; sort by Messages 7d works
- [ ] As test teacher, try to GET `/api/insights/classes/<other-teacher-class-id>/kpis` via curl: same shape as 404 (no enumeration leak)
- [ ] Inspect Cloud Logging: `insights_query` entries for each card load; `dashboard_load` entry per page visit

## Security Considerations

- **Authorization reuses 1.L's primitives.** `assert_caller_owns(class_id)` on per-class endpoints; `resolve_caller_class_ids(user)` for summary + compare. No new authorization code.
- **Cross-tenant enumeration prevention** — same byte-identical "not found / forbidden" response as 1.L. Tested in `test_insights_routes.py`.
- **The `_debug.queries` field** echoes the SQL + parameters that ran. Reveals query structure but not query results beyond what the endpoint already returns; bound parameters mean no SQL injection surface. Acceptable for teacher-facing surface; would be revisited if we ever expose this outside the teacher tenant.
- **Cache key includes teacher uid.** A cache hit for teacher A never leaks to teacher B. Tested in `test_cache.py`.
- **No raw chat content in any KPI payload.** Counts, durations, recency only. No paraphrase pass, no content surfacing. (Content surfacing is the analytics-chat surface, with the privacy controls that ship with 1.L.)

## Performance Considerations

- **Latency budget per surface:**
  - `/teacher/classes` (KPI strip): one batched call, ~1.5–2.5s p50 (BQ aggregate over the teacher's full `group_codes` set). Cache hit: <100ms.
  - `/teacher/classes/[id]`: three parallel calls (kpis, groups, activities), each ~1–2s; cards render independently as each resolves.
  - `/teacher/insights`: one batched call, ~2–3s p50; cache hit <100ms.
- **Cache TTL = 60s.** Tradeoff: a teacher hitting refresh sees the same numbers for the first minute (acceptable for a dashboard) but the second class detail load on the same page session is instant. The chat-log emitter already buffers in BQ for ~1–2 min via the Log Router sink, so a sub-60s cache TTL would not surface fresher data anyway.
- **Bundle size impact**: `recharts` adds ~50 KB gzipped to the teacher-route bundle. Code-split via dynamic `import()` so it doesn't bloat the student bundle.
- **Long IN-lists**: a teacher with 100+ classes would have a long `group_codes` IN-list (potentially 500+ codes). BQ handles this fine up to a few thousand parameters. If/when this becomes a real problem (well past pilot scale), revisit the *add-class_id-to-emitter* path.

## Success Criteria

- [ ] All frontend tests passing (`npm run quality:check`)
- [ ] All backend tests passing (`cd backend && make test`)
- [ ] Backend lint clean (`make lint`)
- [ ] Five new `/api/insights/*` routes registered + reachable via `aiplatform insights *` on dev
- [ ] Test teacher signed-in on dev sees real numbers on all three surfaces within 3s of page load
- [ ] Cross-tenant access attempt returns the same shape as 404 (no enumeration leak); verified via curl in the smoke script
- [ ] Definition tooltip + "Show data" disclosure work on every KPI card
- [ ] Empty states render gracefully for classes with no sessions
- [ ] Cloud Logging shows `dashboard_load` + `insights_query` entries on dev
- [ ] Recharts code-split confirmed (student route bundle size unchanged within 2 KB)
- [ ] Doc moved to `implemented/` and an Implementation Report stub filled in

## Open Questions

- **Q1: Add `class_id` to the chat-log emitter now, or defer to v1.1?** Plan: defer. Resolution-at-query-time via group_codes IN-list ships v1; emitter change is v1.1 cleanup. Confirm sequencing with the 1.2 owner.
- **Q2: Is a teacher shell with a side-nav in place to host the "Insights" link, or does the page need a button on `/teacher/classes` as the entry?** Check current `_TeacherClientShell.tsx`; if no shell nav, add the button instead.
- **Q3: Should the "Sim runs (7d)" card include or exclude the `state-change` workbench event type?** It includes only `tool='sim_run'` entries per the SKILL-aligned interpretation. Confirm with JB during the mid-point review since "what counts as a sim run" affects 1.E-Ph2 commit-on-submit math too.
- **Q4: Bilingual labels — Danish + English on every chart, or English-only where the surrounding page already trends English?** Match the surrounding page. Class detail page is mostly English; `/teacher/classes` card area is mostly English; `/lessons` is bilingual. Insights surfaces follow suit.
- **Q5: Does the `useInsights` cache need to invalidate on the existing class CRUD operations (mint group code, patch activities)?** Plan: yes — those operations already trigger a page-level refresh; piggyback an `invalidateInsights(classId)` call in the same client-side success handler. Worth a code-path audit during Phase 2.

## Related Documents

- [analytics-chat-tools.md](analytics-chat-tools.md) — 1.L, the chat analytics surface. **Critical dependency** — shares the `backend/analytics/queries.py` + `auth.py` layer
- [v1.0.0-pilot SEQUENCE.md](SEQUENCE.md) — analytics critical path
- [chat-log-pipeline.md](implemented/chat-log-pipeline.md) — 1.2 sink populating the BQ tables this dashboard reads
- [teacher-permission-model.md](implemented/teacher-permission-model.md) — 1.A `Class` entity provides the `class_id` → `group_codes` mapping that closes the schema gap
- [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — 2.5, the post-pilot pedagogical-rubric layer. **This doc is explicit about NOT being a learning-signal surface**; 2.5 is the right home for that.
- [aiplatform-cli skill](../../../../.claude/skills/aiplatform-cli/SKILL.md) — patterns for the new `aiplatform insights` subcommands
- [local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — CLI affordance backlink per the design-doc-creator heuristic
- [Product Axioms](../../../product-axioms.md)
