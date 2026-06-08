# Implementation Report — ANALYTICS-CHAT-AND-INSIGHTS

Sprint window: 2026-06-02 (one-day actual; 10 milestones in sequence).
Closes design docs [analytics-chat-tools.md](analytics-chat-tools.md) (1.L) and
[teacher-insights-dashboard.md](teacher-insights-dashboard.md) (1.M).

## What shipped

| Milestone | Surface | LOC est / actual | Tests |
|---|---|---:|---:|
| M1 | recharts + `_chartsBundle.ts` | 60 / 60 | n/a (manual bundle check) |
| M2 | `backend/analytics/auth.py` + `queries.py` + HARD GATE | 320 / 320 | 15 unit |
| M3 | 5 more queries + FunctionTool wrappers | 380 / 380 | 16 unit |
| M4 | `summarise_chat_excerpts` + verbatim defense | 280 / 280 | 10 unit |
| M5 | SKILL.md tools + `/api/analytics/*` routes + CLI | 410 / 806 | 9 route + 9 CLI |
| M6 | `/teacher/analytics` chat island | 420 / 657 | 13 frontend |
| M7 | insights aggregates + 60s cache + 5 REST routes | 480 / 1318 | 12 unit + 13 api |
| M8 | `aiplatform insights` CLI + `/teacher/insights` page | 360 / 1144 | 8 CLI + 11 frontend |
| M9 | KPI strip + ClassInsightsPanel + trend chart | 540 / 865 | 15 frontend + 4 backend |
| M10 | eval + smoke + observability + docs move | 280 / ~250 | 1 evalset + 2 smoke scripts |

**Final totals.** Backend: 1636 tests passing, 0 failing, 1 skipped (pre-existing).
Frontend: 792 tests passing, 0 failing. `make lint`, `make test-fast`,
`npm run quality:check` all green at sprint close.

## Surfaces delivered

- `/teacher/analytics` — AG-UI chat island wired to the `analytics-chat`
  skill, six tools, scope-prefixed teacher questions, tool-call pills,
  "Show data" disclosure, suggested-question prefill (no auto-submit).
- `/teacher/insights` — sortable cross-class comparison table.
- `/teacher/classes` — KPI strip on every card from one
  `/api/insights/summary` round-trip.
- `/teacher/classes/[id]` — `ClassInsightsPanel` above Recent activity
  with KPI grid + per-group bar + per-activity bar + 7-day trend line.
- `aiplatform analytics {tools, probe, ask}` CLI.
- `aiplatform insights {class, groups, compare}` CLI.

## REST surface added

| Route | Notes |
|---|---|
| `GET /api/analytics/tools` | Discovers the six analytics tools |
| `POST /api/analytics/probe/{tool}` | Per-tool execution |
| `GET /api/insights/summary` | Per-class strip for `/teacher/classes` |
| `GET /api/insights/classes/{id}/kpis` | Six-card KPI grid |
| `GET /api/insights/classes/{id}/groups` | Per-group bar data |
| `GET /api/insights/classes/{id}/activities` | Per-activity bar data |
| `GET /api/insights/classes/{id}/trend` | Dense per-day messages series |
| `GET /api/insights/compare` | Cross-class table |

All eight routes are teacher-gated; per-class routes go through
`analytics.auth.assert_caller_owns` and surface
``404 class not accessible`` byte-identically for both missing and
not-owned. Tests assert `.content` equality, not just status code.

## HARD GATE evidence

- `backend/tests/unit/analytics/test_auth.py::test_enumeration_resistance`
  — byte-identical message at the auth layer.
- `backend/tests/api_tests/test_analytics_routes.py::TestProbe::test_cross_tenant_class_returns_identical_payload_as_missing`
  — byte-identical at the analytics REST surface.
- `backend/tests/api_tests/test_insights_routes.py::TestClassKpis::test_cross_tenant_byte_identical_to_missing`
  — byte-identical at every insights per-class route.
- `backend/tests/unit/insights/test_aggregates.py::test_class_trend_cross_tenant`
  — same shape for the trend addition.

## Observability

Cloud Logging filters for the dev project:

- `jsonPayload.message:"analytics_tool"` — every `/api/analytics/probe`
  hit, with `tool`, `class_id`, `teacher_uid`, `outcome`.
- `jsonPayload.message:"insights_query"` — every `/api/insights/*` hit.
- `jsonPayload.message:"dashboard_load"` — first-meaningful-paint marker
  on `/api/insights/summary`, includes `class_count`.

## Operational follow-ups (post-sprint)

- The PATCH `/api/classes/{id}` route should call
  `insights.cache.CACHE.invalidate_for_teacher(user.uid)` on success.
  The invalidation hook ships in M7; the wiring is a one-liner that
  doesn't change cache semantics — landing it after the sprint avoids
  scope creep on M9.
- Bundle delta: `/teacher/classes/[id]` jumped from 5.58 kB / 219 kB
  to 120 kB / 333 kB after recharts landed via `ClassInsightsPanel`.
  Student routes (`/group`, `/lessons`, `/chat`) are unchanged.
- The smoke scripts (`scripts/smoke-{analytics-chat,insights}.sh`) need
  a real owned `SMOKE_CLASS_ID` against the dev environment — they
  ship green-on-syntax but need an integration test slot in CI.
- The ADK evalset (`backend/tests/eval/evalsets/analytics_chat.evalset.json`)
  has seven cases; running `make eval` against them needs a seeded dev
  BigQuery dataset (the agent will refuse against `cls-eval-001` until
  one exists).

## Sprint plan deviations

- **Per-card error boundary** in `ClassInsightsPanel` ships as
  per-section error states (one `Section` wrapper per fetch) rather
  than React error boundaries. Functionally identical for the
  acceptance ("one slow query doesn't block the rest") and simpler to
  test.
- **No `useInsights` composite hook** — replaced with a single
  primitive `useInsightsFetch(fetcher, deps)` because the panel only
  needs four parallel fetches with the same shape. A higher-level
  hook would have hidden the per-section state machines the panel
  needs to render its loading and error rows individually.
