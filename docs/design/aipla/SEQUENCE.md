# AIPLA Build Sequence

> AIPLA-specific design and execution docs live under `docs/design/aipla/`,
> kept separate from the inherited template docs in `docs/design/v6.x.x/`.
> This is the **execution** layer. Architecture and strategy
> (ADRs 001–015, strand definitions, capability-floor eval framework)
> live in the **scoping site** at `~/Documents/clients/cph-uni`
> ([architecture.qmd](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd),
> [strands.qmd](file:///Users/mark/Documents/clients/cph-uni/strands.qmd),
> [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd),
> [evaluation.qmd](file:///Users/mark/Documents/clients/cph-uni/evaluation.qmd)).
> Cite ADRs from this repo's design docs — do not restate them.

## AIPLA versions

The 4-month contract has three product-version anchors. These are AIPLA's
own versions, **not** related to the template's `v6.x.x` versions.

| Version | Anchor date | Audience | Skill commitment |
|---|---|---|---|
| **v0.1.0-jutland** | 2026-05-27 (Wed) | JB + Aswin demo to ~2–3 Jutland stx teachers | Single physics-tutor skill, group-ID join, deployed dev URL |
| **v1.0.0-pilot** | 2026-08-14 (Fri) | Danish teacher pilot — 10 teachers + K | 5 skills + curated sim library + teacher config + multimodal + BigQuery logs + per-class budgets enforced |
| **v2.0.0-handover** | 2026-09-15 (Mon) | Final handover — co-owners run AIPLA after contract | v1 + runbooks + eval automation + DPIA + scoping-note Strand C delivered |

## Phase 0 — Jutland demo (v0.1.0)

**Status as of 2026-05-19:** in flight. Contract started 2026-05-15; repo
forked from `ai-protocol-platform` on 2026-05-19.

| Order | Doc | What it locks | Est | Status |
|-------|-----|---------------|-----|--------|
| 0.1 | [aipla/v0.1.0-jutland/jutland-demo.md](v0.1.0-jutland/jutland-demo.md) | First deployed AIPLA URL on `aipla-dev-2026`, anonymous group-ID join, `problem-set-hints` skill | 1d | Shipped (commit 1636038) |

**v0.1 explicit non-goals** (deferred to v1.0.0-pilot):
- Teacher configuration UI
- Multimodal upload (photos, CSVs)
- A2UI dashboards
- MCP App surfaces
- Multi-class / multi-group dashboards
- BigQuery chat-log export
- Per-class budget surfacing (the enforcer ships; the UI does not)

## Phase 1 — After the cloud is stood up (v1.0.0-pilot critical path)

Once `aipla-dev-2026` is live and v0.1 is demoed, the docs below sequence
the build between **2026-05-28 (post-Jutland)** and **2026-08-14 (pilot
start)**. Order roughly follows the [scoping site
timeline](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd) and
respects the **mid-point review (2026-06-26)** + **holiday freeze
(2026-06-29 → 07-05)** gates.

> The order column is the *intended* ordering, but in practice 1.1 / 1.2 /
> 1.3 should kick off in parallel as soon as v0.1 ships — they're
> independent surfaces. 1.4 onwards depends on at least 1.1 + 1.2 being
> in-place.

### 1.x — Foundation (target: pre-mid-point review, 2026-06-26)

| # | Doc (planned) | Why | ADRs it implements | Est |
|---|---|---|---|---|
| **1.1** | `aipla-cloud-bootstrap.md` | Make the GCP provisioning of `aipla-{dev,test,prod}-2026` reproducible: terraform module, IAM cascade, Firebase Auth tenants, Vertex AI region pinning, Cloud Build triggers, secrets schema, BigQuery dataset for chat logs. Pulls the manual M0 work from v0.1 into a documented, repeatable form. | 006, 007 | 1.5d |
| **1.2** | `chat-log-pipeline.md` | OTel → BigQuery sink for group-ID-keyed chat logs (full prompt + response, no PII per ADR-001). Consent-form-driven retention defaults. Researcher access pattern (a saved BQ query + a thin Looker board, not a custom UI). | 001, 005, 008 | 1.5d |
| **1.3** | `rag-pgvector-setup.md` | pgvector on Multivac Postgres for teacher-uploaded curriculum/problem-sets. Schema, chunking strategy, MCP server wrapping the retrieval, ACL by class/group. Excludes Strand C graph DB (deferred until C3 scoping recommends). | 010 | 2d |
| **1.4** | `model-router-aipla-config.md` | Wire the four-tier router (cloud API · self-hosted server · server-local · on-device) to AIPLA-specific skill→model mappings. Capability-floor eval feeds the routing decisions. Initial mapping is conservative (`gemini-3.5-flash` via Vertex AI for everything in v0.1 → eval-derived per-skill mapping for v1; Sonnet 4.6 retained as cross-provider fallback per ADR-003). | 003, 008 | 1d |
| **1.5** | `capability-floor-eval-runner.md` | Concrete eval set, task taxonomy (T1–T8), model panel, BigQuery results sink, scheduled CI run. The eval framework is in the scoping site — this doc is the runner. Built so AR can iterate the rubric without touching code. | (eval framework — strands.qmd) | 2d |

### 1.6–1.9 — Teacher surface (target: post-holiday, weeks 8–12)

| # | Doc (planned) | Why | ADRs | Est |
|---|---|---|---|---|
| **1.6** | `teacher-auth-ucph-sso.md` | UCPH SSO for teacher admin. Decision: Firebase Auth federated with UCPH IDP, or a thin OIDC proxy. Out-of-scope-for-v0.1 because we have no teacher-facing routes yet. | 001 (teacher-auth half) | 1d |
| **1.7** | `class-and-group-management.md` | `manage-class` skill (v1) — teacher creates a class, system mints anonymous group IDs, teacher hands them out. Backed by Firestore on `aipla-dev-2026`. | 001, 014, 015 | 2d |
| **1.7-ops** | [aipla/v0.1.0-jutland/group-tooling.md](v0.1.0-jutland/group-tooling.md) | `aiplatform group new/list/revoke` CLI + backend list/revoke admin endpoints. Replaces the v0.1 multi-step curl ritual with a single command. Ships alongside 1.7 (teacher GUI) so ops keeps a CLI fallback once teachers have the dashboard. Moved here from Phase 0 per user direction 2026-05-20 ("later in the sequence"). | 0.5d |
| **1.8** | `problem-set-helper-config-skill.md` | `problem-set-helper-config` (v1, teacher-facing) — teacher configures a tutor for a specific topic / problem set, pointing at one or more RAG-ingested documents. A2UI config form. | (skill catalogue — strands.qmd) | 2d |
| **1.9** | `concept-dialogue-config-skill.md` | `concept-dialogue-config` (v1) — standalone Socratic conceptual-exploration tutor for a topic. A2UI config form. | (skill catalogue) | 1.5d |

### 1.10–1.12 — Document handling + budget surfacing (target: pre-pilot, week 12)

| # | Doc (planned) | Why | ADRs | Est |
|---|---|---|---|---|
| **1.10** | `multimodal-ingestion-via-ailang-parse.md` | Wire AILANG Parse end-to-end for teacher and student uploads. 13 deterministic formats local; 2 AI formats (PDF, image) routed through the model router. | 004, 011 | 1.5d |
| **1.11** | `artefact-review-pipeline.md` | The MCP server gating generated HTML/SVG before any iframe render. v1 ships with the **hand-curated sim library**, so this lands as infrastructure groundwork for Year-2 artefact generation; tested against a small fixture library. | 013 | 2d |
| **1.12** | `budget-dashboard.md` | `class-status` skill (Year-2 from skills catalogue, but the v1 minimum is just surfacing the existing per-class enforcer's data in a small A2UI panel). | 014, 015 | 1d |

### 1.13 — Pilot readiness (target: 2026-08-08, one week before pilot)

| # | Doc (planned) | Why | ADRs | Est |
|---|---|---|---|---|
| **1.13** | `pilot-readiness-checklist.md` | Not a feature doc — a release checklist. DPIA scaffold, consent form sign-off (JB), capability-floor eval baseline locked, runbooks for "how to onboard a new teacher / class", smoke tests for the full v1 path, rollback procedures. | 005, 014 | 1d |

## Phase 2 — Strand B + Strand C (post-pilot, weeks 13–17)

These docs only get written if v1 is on track at the mid-point review.

| # | Doc (planned) | Strand | Status |
|---|---|---|---|
| 2.1 | `strand-b-student-as-creator.md` | B | Stub; depends on v1 working in the pilot |
| 2.2 | `strand-c-scoping-note-plan.md` | C | The scoping note itself ships in the scoping site, not here. This doc is just the per-RQ investigation plan (model panel, AILANG benchmark probes, lit review). |

## Phase 3 — Handover (weeks 16–17)

| # | Doc (planned) | Why |
|---|---|---|
| 3.1 | `handover-package.md` | Index of all runbooks, deep-dive sessions, sign-offs. Per the handover-fan-out table in [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd), each artefact has a named co-owner. This doc is the manifest. |

---

## Dependency graph (v0.1 → v1 critical path)

```
v0.1.0-jutland (1d)
    │
    └─► 1.1 cloud-bootstrap ──┬─► 1.2 chat-log-pipeline ──┐
                              ├─► 1.3 rag-pgvector ────────┤
                              └─► 1.4 model-router ────────┤
                                                            ▼
                              1.5 capability-floor-eval ──► (mid-point review 2026-06-26)
                                                            │
                            ──── holiday freeze 2026-06-29 → 07-05 ────
                                                            │
                              1.6 teacher-auth-ucph-sso ───┐
                              1.7 class-and-group-mgmt ────┤
                              1.8 problem-set-helper-cfg ──┼─► (all four
                              1.9 concept-dialogue-cfg ────┘    parallel; depend on 1.1+1.2)
                                                            │
                              1.10 multimodal-ingestion ───┐
                              1.11 artefact-review ────────┤
                              1.12 budget-dashboard ───────┘
                                                            │
                              1.13 pilot-readiness ────────► (pilot start 2026-08-14)
                                                            │
                                          ┌─────────────────┴──────────────────┐
                                          ▼                                     ▼
                              2.1 strand-b-student-creator           2.2 strand-c-scoping-plan
                                          │                                     │
                                          └─────────────► 3.1 handover ◄────────┘
                                                            (final: 2026-09-15)
```

## Estimating discipline

These estimates are **doc + implementation time combined** for the
referenced design doc's first draft + a v1-quality implementation. Per
[CLAUDE.md](../../../CLAUDE.md) AIPLA Fork Context, the inherited template
already provides the heavy lifting (auth, streaming, skills framework,
budget Protocol, etc.) — each AIPLA doc above is *configuration plus
domain glue*, not a from-scratch build. If an estimate balloons past 2×
the value above, surface to the user before continuing.

## Timeline anchors

- **2026-05-19** — Repo forked. v0.1 design doc landed (this commit).
- **2026-05-27** — Jutland v0.1 demo (Wed).
- **2026-06-26** — Mid-point review (Fri). v1 critical-path 1.1–1.5 should be at-or-near complete.
- **2026-06-29 → 07-05** — Holiday freeze week 27. No new merges.
- **2026-07-06 → 08-14** — v1 build (1.6–1.13). Strand B and C scoping kickoff.
- **2026-08-14** — Teacher pilot starts.
- **2026-09-15** — Final handover.
