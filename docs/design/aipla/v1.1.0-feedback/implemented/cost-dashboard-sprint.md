# Sprint plan — 1.1.9 cost-dashboard

**Design doc:** [../cost-dashboard.md](../cost-dashboard.md) (see the 2026-06-13 reconciliation note)
**Created:** 2026-06-13
**Estimate:** ~1.5d
**Depends on:** [1.1.5 researcher-role](../researcher-role.md) (SHIPPED) — researcher views reuse `assert_can_read_class` + `useIsResearcher`.

## Milestones

### M1 — Rate card + spend queries (backend, TDD)
- `backend/analytics/rate_card.py`: `MODEL_RATE_CARD` (EUR per-1k in/out, current Gemini/Sonnet/OpenAI models) + `cost_eur(model, token_in, token_out) -> float` (unknown model → 0.0 + logged warning, never raises).
- `backend/analytics/cost_queries.py` (or extend `queries.py`):
  - `spend_rows(group_codes, since, until)` — SUM(token_in)/SUM(token_out) GROUP BY model, skill_id, group_id; parameter-bound; empty codes → no BQ call.
  - `class_spend(class_id, period)` — resolve class→group_codes, run `spend_rows`, fold to EUR via rate card; return `{total_eur, by_activity, by_group, by_model, token_in, token_out}`.
  - `cohort_spend(period, *, cohorts=None)` — cross-class (all group codes), grouped by cohort (from Class docs) + by model. Researcher-only at the route layer.
- Period helper: `this_month` / `last_month` / `all_time` → (since, until) UTC.
- **Tests:** rate-card math; SQL shape (param binding, group_id filter, no interpolation); empty-codes short-circuit; cohort grouping.

### M2 — `cohort` on Class + spend endpoints (backend, TDD)
- `Class.cohort: str | None`; serialize (alias `cohort`); accept on create + PATCH; `update_class` learns `cohort`.
- `GET /api/classes/{id}/spend?period=` — `assert_can_read_class` (owner or researcher); returns the `class_spend` breakdown + `projected_eur` (linear: spend × days_in_month / days_elapsed for this_month).
- `GET /api/insights/cost?period=` — researcher-only (403 otherwise); returns `cohort_spend` (totals, by_cohort, by_model) + per-class rows.
- **Tests:** owner gets own spend; researcher gets any class; non-owner non-researcher 404; `/insights/cost` 403 for non-researcher; projection math.

### M3 — Frontend BudgetPanel + researcher Cost tab
- `frontend/src/lib/costApi.ts`: `fetchClassSpend(classId, period)`, `fetchCostInsights(period)`.
- `BudgetPanel.tsx` on class-detail (a `SettingsSection`): this-month spend, projected, top activities, top groups. No cap bar (deferred). EUR formatting; no emoji.
- Add a **Cost** tab to `InsightsTabs` (researcher-only via `useIsResearcher`) + `/teacher/insights/cost/page.tsx`: totals, by-cohort, by-model, per-class table.
- **Tests:** BudgetPanel renders with mocked data + empty state; cost page hidden/!researcher; tab visibility.

## Acceptance (adapted from design)
- Spend matches `Σ token_in·in_rate + token_out·out_rate` for the period (rate card).
- Multimodal turn cost included (via `token_in`).
- Projected = spend × days_in_month / days_elapsed; labelled "at current usage rate".
- Researcher cost view renders cross-class + per-cohort + per-model; 403 for non-researchers (URL-hack included).
- Both surfaces use the shared `class_spend` / `cohort_spend` helpers — no duplicated SQL.
- `make lint` + `make test-fast` + `npm run quality:check` green.

## Deferred / out of scope
Cap progress bar (needs class-level cap), BQ `model_rate_card` table (using code rate-card), cost alerts, per-student cost, multi-currency, materialised views, dedicated cohort-setter UI.
