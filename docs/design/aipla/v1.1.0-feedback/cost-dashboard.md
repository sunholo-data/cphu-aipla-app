# Cost dashboard — teacher + researcher spend visibility

**Status:** Planned (P1); **supersedes the originally-planned 1.12** `budget-dashboard.md`
**Last Updated:** 2026-06-13

> ## Implementation reconciliation (2026-06-13) — grounded against current code
>
> Read before the original design body; these correct assumptions that the
> 2026-06-03 draft got wrong against the shipped schema:
>
> - **BQ rows key on `group_id`, not `class_id`.** `aipla_chat_turn` carries
>   `group_id` / `token_in` / `token_out` / `model` / `skill_id` (see
>   `backend/observability/chat_log.py`) — there is no `class_id` column. So
>   `class_spend` resolves the class → its `group_codes` (exactly like
>   `analytics.auth.resolve_caller_group_codes`) and filters
>   `WHERE group_id IN UNNEST(@codes)`. The design's "JOIN on class_id" is replaced.
> - **Rate card lives in code, not a BQ table.** A `MODEL_RATE_CARD` dict in
>   `backend/analytics/rate_card.py` (EUR per-1k in/out per model) + a
>   `cost_eur()` helper. Cost is computed in Python after the query sums tokens —
>   we already pull rows into Python, so no SQL join. Rationale: version-controlled
>   + code-reviewed (no silent staleness), unit-testable, and no Terraform-seed /
>   deploy dependency. Update procedure = edit the dict + PR.
> - **Multimodal cost needs no new column.** Gemini bills image/PDF Part tokens as
>   `token_in`, which `aipla_chat_turn` already records — so per-turn cost already
>   includes multimodal. The design's "add `tokens_image`" risk is moot.
> - **Cap progress bar is DEFERRED.** There is no class-level budget cap — the
>   shipped enforcer (`backend/budget/`) is skill/identity-level, not per-class. v1
>   ships spend visibility (this-month, projected, top activities/groups) + the
>   researcher cross-class/cohort/model views; the cap bar waits for a class-level
>   cap field + enforcer wiring (separate row).
> - **Researcher view = an Insights tab.** Per the shipped 1.1.26 consolidation,
>   the cross-class cost view is a new tab in `InsightsTabs`
>   (`/teacher/insights/cost`), researcher-gated via the now-shipped
>   [1.1.5 researcher-role](researcher-role.md) (`useIsResearcher` + backend
>   `assert_can_read_class`), not a standalone page.
> - **`cohort`** is added to the `Class` model + accepted on create/PATCH +
>   serialized; the researcher view groups by it (defaulting to "uncategorised").
>   No dedicated teacher UI setter in v1 (set via the class API/CLI).
>
> Sprint plan: [implemented/cost-dashboard-sprint.md](implemented/cost-dashboard-sprint.md).
**Priority:** P1 — priority lifted by DK's Indian beta cohort scaling to ~100s of students. Teachers and researchers need per-session, per-class, per-month spend visibility
**Estimated:** ~1d
**Scope:** Mostly a BigQuery query + display; no new instrumentation (token counts already in BQ via OTel)
**Dependencies:** [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped — token counts already in BQ); per-class budget enforcer (already in tree per parent SEQUENCE row 1.12)
**Source brief:** [`june-03-feedback-sprint-brief.md` §9](../_scoping-snapshot/prototypes/june-03-feedback-sprint-brief.md)

## Relationship to existing planned doc

Parent [SEQUENCE.md](../SEQUENCE.md) row **1.12** was `budget-dashboard.md` — a small A2UI panel surfacing the existing per-class enforcer's data. The brief reframes the scope:

- **Add**: cross-class researcher view; per-activity / per-group breakdown; projected monthly spend
- **Keep**: per-class teacher view from the original 1.12 plan
- **Inherit**: existing per-class enforcer (unchanged); BQ token-count rows from 1.2

Update the parent SEQUENCE.md to mark 1.12 as superseded by this row. The enforcer ships separately and is untouched.

## Why this matters now

DK's Indian beta cohort scales to ~100s of students. At pilot-cohort scale (10 teachers × ~25 students = 250 students), per-session and per-class spend becomes a real planning question for the contract's running costs. Without surfacing it:

- Teachers don't know they're approaching the per-class cap until the enforcer trips
- Researchers can't compare model + skill cost-effectiveness (key signal for the capability-floor eval framework decisions)
- Cost surprises get discovered post-hoc rather than monitored

## Design

### Data source

Token counts per turn already live in BigQuery via OTel (the [chat-log-pipeline](../v1.0.0-pilot/implemented/chat-log-pipeline.md) writes `tokens_in`, `tokens_out`, and `model` columns on `chat_turns`). Cost is derived: `(tokens_in × in_rate) + (tokens_out × out_rate)` from a model-rate-card table.

**New BQ table: `model_rate_card`** — `(model_id, in_rate_per_1k, out_rate_per_1k, currency, effective_from, effective_to)`. Updated manually when Vertex / Anthropic / OpenAI pricing changes. Seeded with the current Gemini, Sonnet, OpenAI rates for the providers in tree.

**Image / multimodal cost** — per [student-multimodal-upload.md](student-multimodal-upload.md), multimodal calls are pricier than text. The `chat_turns` row's `model` column already captures which model fielded the turn; add `tokens_image: int | null` (or `multimodal_units`, depending on the provider's billing unit) so the cost computation can include image-call premiums. Pull this from the existing OTel span attributes — likely already there per AILANG observability conventions; verify.

### Teacher view: "Budget" section on class detail

Lives on the teacher class-detail screen, alongside the existing class metadata:

```
┌────────────────────────────────────────────────────────┐
│  Class: Physics A — period 3  (35 students)            │
│  Group code: ABC-123  ·  Active                        │
│                                                        │
│  ──── Budget ─────────────────────────────────────────│
│                                                        │
│  This month:  €4.20 of €25.00 cap                      │
│  ▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 17%                  │
│                                                        │
│  Top activities (this month):                          │
│   • Boldkast            €1.80                          │
│   • LED Planck          €1.40                          │
│   • KineBot             €1.00                          │
│                                                        │
│  Top groups (this month):                              │
│   • ABC-123             €1.60                          │
│   • DEF-456             €1.40                          │
│   • GHI-789             €1.20                          │
│                                                        │
│  Projected this month:  €8.40 (at current usage rate)  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Behaviour:**
- "This month" = current calendar month (UTC). Resets on the 1st.
- Cap value comes from the per-class enforcer's existing config (read-only display here; enforcer manages writes)
- Projected = `current_spend × (days_in_month / days_elapsed)`; simple linear extrapolation; label it "at current usage rate"
- Top activities + top groups: top 3 by spend this month, descending
- All values in EUR by default; per-class currency override is a stretch (not v1.1)

### Researcher view

For users with `role:researcher` claim ([researcher-role.md](researcher-role.md)) — a new `/teacher/insights/cost` page or a section on the existing insights dashboard:

```
┌────────────────────────────────────────────────────────┐
│  Spend overview (researcher view)                      │
│                                                        │
│  Total this month:    €42.50                           │
│  Total last month:    €28.00 (+52%)                    │
│                                                        │
│  ──── By cohort ──────────────────────────────────────│
│   • Danish cohort     €28.50  (180 sessions)           │
│   • Indian (DK beta)  €14.00  (320 sessions)           │
│                                                        │
│  ──── By model ───────────────────────────────────────│
│   • gemini-3.5-flash  €18.00  (450 sessions)           │
│   • claude-sonnet-4-6 €20.00  ( 40 sessions)           │
│   • gemini-pro        € 4.50  ( 10 sessions)           │
│                                                        │
│  ──── By skill ───────────────────────────────────────│
│   ( per-skill table )                                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Cohort identification:** read from class metadata's tag namespace (e.g. `cohort:dk` vs `cohort:in-beta` set during class creation). If tags aren't reliably set, fall back to teacher-uid grouping (DK teachers' classes vs others). M to wire the cohort tag on class creation if not already present.

### Queries

All cost computation lives in **one** BQ query function in [backend/analytics/queries.py](../../../../backend/analytics/queries.py) (shared with the analytics-chat tools per [analytics-chat-tools.md](../v1.0.0-pilot/implemented/analytics-chat-tools.md)) — single source of truth, both surfaces consume it.

```python
def class_spend(
    class_id: str,
    period: Literal["this_month", "last_month", "all_time"],
) -> ClassSpendBreakdown:
    """
    JOIN chat_turns × model_rate_card on chat_turns.model = model_rate_card.model_id
    WHERE class_id = ... AND ts in period range
    GROUP BY activity, group_id, model
    """

def cohort_spend(
    cohort: str,
    period: ...,
) -> CohortSpendBreakdown:
    """Same shape, scoped to cohort tag."""
```

**Pre-aggregation:** if per-class queries get slow (>2s) at pilot scale, add a scheduled daily materialised view `daily_class_spend` rather than caching in-app. For v1.1, query on-demand — the data volume doesn't justify the materialisation overhead yet.

### Permissions

- Teacher: sees their own classes' budget panel; cannot see cross-class
- Researcher (per [researcher-role.md](researcher-role.md)): sees the cross-class / cohort / model views
- No new permission tier — leverages the existing claim + `assert_can_read_class` from [researcher-role.md](researcher-role.md)

## Acceptance

- [ ] `model_rate_card` BQ table created, seeded with current Gemini / Sonnet / OpenAI rates in EUR
- [ ] Teacher class-detail page renders the "Budget" section with: this-month spend, cap progress bar, top activities, top groups, projected monthly
- [ ] Spend matches a manual calculation `Σ tokens_in × in_rate + tokens_out × out_rate` for the period
- [ ] Multimodal turn cost included (image / PDF Part tokens counted in the per-turn cost)
- [ ] Projected this month = current spend × (days in month / days elapsed); label explicit
- [ ] Researcher view (`/teacher/insights/cost`) renders cross-class totals, per-cohort, per-model breakdowns
- [ ] Researcher view hidden / 403 for non-researchers (URL hack returns 403)
- [ ] Both surfaces use the same `class_spend` / `cohort_spend` helpers in `backend/analytics/queries.py` — no duplicated SQL
- [ ] Spend query returns in <2s for a class with 1000 sessions (typical pilot upper bound)
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green
- [ ] Pytest: cost computation correct for a known fixture; per-class permission enforced; researcher claim grants cross-class view
- [ ] Vitest: budget panel renders with mocked data; researcher page hidden for non-researchers

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Model rate card goes stale; reported spend ≠ actual Vertex billing | Medium | Document the update procedure in the runbook; lookup is by `effective_from / effective_to` so historical rows stay correct after a price change |
| Per-class query slow at scale | Low-medium | If >2s for typical workloads, add a daily materialised view; for v1.1 the data volume doesn't warrant it |
| Cohort tags not reliably set on existing classes | Medium | Backfill script during the change; document in the runbook |
| Researcher cross-class view leaks PII | Low | No PII in `chat_turns` per ADR-001; aggregates further reduce risk |
| Spending overshoots projection due to nonlinear day-by-day usage | Low | Label projection as "at current usage rate"; teachers understand the caveat |
| Multimodal cost wrong because OTel doesn't capture image-Part counts | Medium | Verify the OTel span attributes before assuming; if missing, add to [student-multimodal-upload.md](student-multimodal-upload.md)'s instrumentation as a prerequisite |
| Currency conversion edge cases (Vertex bills in USD, dashboard shows EUR) | Low | Store rate-card in EUR; refresh during periodic rate-card updates; document |

## Open questions

1. **Where does the cohort tag get set?** Class-creation UI? Per-class config? Recommend: a small `cohort: str | null` field on the `Class` Firestore doc, settable from the existing class-create flow. Default null = uncategorised.
2. **Currency** — EUR throughout, or per-cohort (USD for DK Indian beta)? Recommend: EUR-only for v1.1 with a stored exchange-rate annotation; per-cohort currency is over-engineering for now.
3. **Per-skill cost on the teacher view** — surfaced explicitly or implicit via the "top activities" list? Recommend: top activities only (the list IS the per-skill breakdown for the class's actual usage).
4. **Cost alerts** — email / notification when a class hits 80% of cap? Out of scope v1.1; the existing enforcer already blocks at 100%. Notification infrastructure deferred.
5. **Spend by individual student** — explicitly *not* a goal (anonymity per ADR-001). Spend bins to group-id at the lowest grain.

## Files

| File | Purpose | LOC est. |
|---|---|---|
| Terraform (BQ) | `model_rate_card` table + seed rows | +60 |
| `backend/analytics/queries.py` | `class_spend`, `cohort_spend` helpers (extend the shared module from analytics-chat-tools) | +120 |
| `backend/analytics/auth.py` | Reuse `assert_can_read_class`; no new logic | small |
| `backend/protocols/analytics_routes.py` | `GET /api/classes/{id}/spend` + `GET /api/cohort-spend` endpoints | +80 |
| `frontend/src/components/teacher/BudgetPanel.tsx` | New panel; renders on class-detail | ~120 |
| `frontend/src/app/teacher/insights/cost/page.tsx` | New researcher cost page | ~150 |
| `frontend/src/components/teacher/__tests__/BudgetPanel.test.tsx` | New | ~80 |
| `backend/tests/api_tests/test_cost_dashboard.py` | New: spend computation correctness, permissions, multimodal pricing | ~150 |
| `backend/db/models/class.py` | Add `cohort: str | None` field | +5 |
| Runbook (in `.claude/skills/` or `docs/ops/`) | "How to update the model rate card" | +40 |

## Out of scope

- Cost alerts / notifications (no notification infrastructure in v1)
- Per-student / per-message detailed cost breakdown (anonymity-preserving aggregation only)
- Historical trend lines / charts (recharts integration deferred unless researchers ask)
- Multi-currency display (EUR-only v1.1)
- Budget approval workflows (UCPH-level governance — year-2)
- Cost forecasting beyond simple linear projection (year-2 if needed)

## Related

- [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) — token-count rows this reads
- [analytics-chat-tools.md](../v1.0.0-pilot/implemented/analytics-chat-tools.md) — same shared `backend/analytics/queries.py` module
- [researcher-role.md](researcher-role.md) — cross-class researcher access pattern
- [student-multimodal-upload.md](student-multimodal-upload.md) — multimodal cost premium must be captured in OTel
- Parent [SEQUENCE.md](../SEQUENCE.md) row 1.12 — supersedes; mark as superseded
- ADR-003 (four-tier model router) — cost dashboard is the empirical feedback loop for routing decisions
