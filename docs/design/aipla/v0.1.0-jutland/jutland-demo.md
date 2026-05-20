# Jutland v0.1 Demo — AIPLA's first deployed URL

**Status**: Planned
**Priority**: P0 (High) — single hardest deadline in the contract
**Estimated**: 1 day (Wed 2026-05-20, with M0 cloud-bootstrap spillover risk to Thu morning)
**Scope**: Fullstack + infra
**Dependencies**: None inside this repo; soft dep on AR providing one problem set (fallback: projectile motion from [examples.qmd](file:///Users/mark/Documents/clients/cph-uni/examples.qmd))
**Created**: 2026-05-19
**Last Updated**: 2026-05-19

## Problem Statement

Per [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd), JB and Aswin visit Jutland on **2026-05-27–29** to show 2–3 Danish stx physics teachers what AIPLA will be. They need a **deployed URL** they can open on a teacher's phone or laptop and demonstrate the core AIPLA loop: a student group joins anonymously, asks for help on a physics problem, and gets pedagogical scaffolding — not a solution.

**Current State:**
- Repo was forked from `sunholo-data/ai-protocol-platform` today (2026-05-19, commit `160c9fe`).
- Upstream already ships group-ID auth ([backend/auth/group_id_auth.py](../../../../backend/auth/group_id_auth.py)), the BudgetEnforcer Protocol ([backend/budget/enforcer.py](../../../../backend/budget/enforcer.py)), AG-UI streaming, ADK + skills framework, the tenant-span OTel hook, and the artefact-review pipeline — see [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd) "Upstream group-ID auth landed 2026-05-19".
- The AIPLA GCP project (`aipla-dev-2026`) does not yet exist. No deployed URL.
- No physics skill exists in [backend/skills/templates/](../../../../backend/skills/templates/) — the 7 existing templates (general-assistant, code-assistant, data-extractor, document-analyst, web-researcher, workspace-demo, workspace-demo-interactive) are platform-generic.
- Branding is still "Aitana Platform v6" everywhere — not appropriate for a UCPH-hosted demo.

**Impact:**
- **Who is affected:** JB + Aswin + 2–3 Jutland teachers in the room. Downstream, AR (who will iterate the tutor prompt against the deployed URL the following week).
- **How significant:** Hard contractual deadline. Slipping past 2026-05-27 means JB walks into the Jutland visit with slides only. That's recoverable but undermines the "working pilot by end of contract" credibility we promised.

## Goals

**Primary Goal:** Deploy `https://aipla-dev-2026.example` (final URL TBD) running an AIPLA-branded chat UI where an anonymous student group can join with a group ID, ask `problem-set-hints` for help on one Danish stx physics problem, and receive scaffolding responses streamed via AG-UI — by **2026-05-20 EOD**, with 5 working days of buffer for AR-led prompt iteration before the Jutland visit.

**Success Metrics:**
- Demo URL reachable from outside the UCPH network (verified from M's laptop and JB's laptop).
- Time-to-first-AG-UI-event on a problem-set-hint query: **<3s** (Axiom 1 KPI for tool-using paths; this skill has no tools in v0.1 so realistic target is **<1.5s**).
- Tutor passes a 5-question scaffolding rubric (no full solutions; gives hints at the level of the seeded problem) — checked manually before the Jutland visit.
- Zero PII collected from any student-side interaction (verified by inspecting Cloud Trace + chat-log spans; the only "identifier" is the group ID).
- Zero non-EU egress paths for student-facing data (verified: Anthropic API is the only outbound; explicitly named in ADR-003).

**Non-Goals (deferred to v1.0.0-pilot per [SEQUENCE.md](../SEQUENCE.md)):**
- Teacher configuration UI (`problem-set-helper-config` skill).
- Multimodal upload (photos, CSVs, scans).
- Multi-class management (`manage-class` skill).
- BigQuery chat-log export (logs go to Cloud Trace in v0.1; the BQ sink is 1.2).
- pgvector RAG (v0.1 inlines one problem set in the skill system prompt; RAG is 1.3).
- A2UI dashboards, MCP App surfaces, sidebar/modal surfaces (per ADR-015 "v1 scope: chat-primary with `workspace` surface for embedded sims").
- Per-class budget *surfacing* (the enforcer ships; the UI does not).
- UCPH SSO for teachers (no teacher routes in v0.1).
- DPIA scaffold (lands in 1.13 pilot-readiness).

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md). The axioms are the platform's — AIPLA's GDPR stance is *stricter* than the platform default but does not conflict with the axiom set.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | AG-UI streaming inherited from template; first event <1.5s realistic without tools |
| 2 | EARNED TRUST | +1 | Tutor's job is to *not* give full solutions — system prompt + 5-question rubric verify pedagogical scaffolding. Seeded problem set is cited in the prompt |
| 3 | SKILLS, NOT FEATURES | +1 | Entire deliverable is one Agent Skills spec `SKILL.md` + system prompt; teacher could in principle re-configure it (we just don't ship the UI for that yet) |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | v0.1 uses one model (Sonnet) for all queries. The router architecture is in place and ready for per-task routing in 1.4; honest score is neutral until then |
| 5 | GRACEFUL DEGRADATION | +1 | Router falls Sonnet→Gemini on Anthropic outage; ultimate fallback is LOCAL_MODE on JB's laptop if cloud is down on demo day |
| 6 | PROTOCOL OVER CUSTOM | +1 | Adopts Agent Skills, AG-UI, ADK as-is. Zero new protocols. Group-ID join is the only AIPLA-specific addition and that landed upstream as a generic auth provider |
| 7 | API FIRST | +1 | Same `/v6/skill/invoke` (or equivalent template endpoint) the inherited CLI hits; `aipla smoke jutland` exercises it identically to the browser |
| 8 | OBSERVABLE BY DEFAULT | +1 | OTel + tenant-span hook (landed upstream 2026-05-19) means every Sonnet call is traced in Cloud Trace, keyed by `group_id`. `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` by default — content stays inside `aipla-dev-2026`, not Langfuse Cloud (matches Axiom 9's trust boundary) |
| 9 | SECURE BY CONSTRUCTION | +1 | No PII collectable (ADR-001). EU region pinned (ADR-007). Only egress is Anthropic API — explicit per ADR-003. Anonymous group IDs are minted server-side; no client-supplied identifiers |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Frontend renders AG-UI + Anonymous group flow from upstream; AIPLA-specific frontend change is branding only (logo, colors, copy) — no business logic |
| | **Net Score** | **+9** | Threshold ≥ +4 ✓ — strong alignment |

**Conflict Justifications:** None. Axiom 4 scored neutral, not negative, and will rise to +1 once 1.4 (model-router-aipla-config) lands.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Skill definition | [Agent Skills spec](https://agentskills.io/specification) | `SKILL.md` in `backend/skills/templates/problem-set-hints/` |
| Agent runtime | ADK `LlmAgent` via `load_skill_from_dir()` | Same as all other template skills |
| Streaming to UI | [AG-UI protocol](https://ag-ui.com/) | Inherited from template's `ag-ui-adk` adapter |
| Tool integration | n/a in v0.1 | No tools wired this sprint; RAG/code-exec land later |
| UI rendering | Plain AG-UI text events; no A2UI components in v0.1 | A2UI hint cards are a v1 polish |
| Auth | [ADR-001](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd#adr-001-student-identity-no-auth-anonymous-group-ids) anonymous group IDs (no auth standard exists for "deliberately no identity") | Inherited template provider |
| Document parsing | n/a in v0.1 (no uploads) | AILANG Parse (ADR-004) wires up in 1.10 |
| Observability | OpenTelemetry → Cloud Trace + Cloud Logging | Template default; AIPLA pins region in 1.1 cloud-bootstrap |

**No custom formats invented.** The closest call is the group-ID minting endpoint — it's already in the upstream template as `/group/*` routes ([backend/auth/group_routes.py](../../../../backend/auth/group_routes.py)) so AIPLA inherits, doesn't reinvent.

## CLI Surface

Per [design-doc-creator skill 5b-bis](../../../../.claude/skills/design-doc-creator/SKILL.md), every developer-facing surface needs a CLI affordance. AIPLA's CLI is `aipla` (rebranded from the inherited `aiplatform` — see [cli/](../../../../cli/)).

| Command | Purpose | Position in tree |
|---|---|---|
| `aipla skill push problem-set-hints` | Push the new skill to a deployed AIPLA backend. Already implemented for inherited skills; verify it works unchanged for AIPLA skills. | existing `aipla skill push <name>` |
| `aipla smoke jutland [--url <url>] [--group-id <id>]` | One-shot end-to-end smoke: mint a fresh group ID, start a session, ask for a hint, assert response contains scaffolding markers + does not contain full-solution markers. Exits 0 / 1. | new `aipla smoke <name>` family |
| `aipla group new --class <slug>` | Mint an anonymous group ID for testing. (Wraps `POST /group/new`.) | existing if available; verify |

Backlink: [local-dev-cli.md](../../v6.1.0/local-dev-cli.md).

## Design

### Overview

Three loosely-coupled pieces ship in parallel: a **physics skill** (backend), an **AIPLA branding pass** (frontend + infra config), and a **GCP project bootstrap** (infra). They converge in a smoke test against a deployed URL. The skill itself is intentionally minimal: a `SKILL.md` with a careful system prompt + one Danish stx physics problem set inlined as `resources/seed-problem.md`. No tools, no RAG, no multimodal in v0.1.

### Backend Changes

**New skill template:**
- `backend/skills/templates/problem-set-hints/SKILL.md` — Agent Skills spec; model defaults to `gemini-3.5-flash` on Vertex AI `global` endpoint (GA from 2026-05-19); router-overridable. Default thinking budget left at provider default — verified 2026-05-20 to produce Danish-language scaffolding of the right pedagogical shape; cost monitoring deferred until capability-floor eval data lands ([Resolved Decision 1](#resolved-decisions)).
- `backend/skills/templates/problem-set-hints/resources/seed-problem.md` — one Danish stx physics problem (projectile motion from AR's existing trial if AR doesn't supply a fresh one this week — see Open Question 2).
- `backend/skills/templates/problem-set-hints/resources/scaffold-rubric.md` — internal rubric the system prompt references; 5 markers the response should contain ("step-by-step prompt", "ask before reveal", "encourage own-calculation", etc.).

**System prompt design principles** (encoded in `SKILL.md` instructions):
1. **Never offer a full solution.** If the student asks "what's the answer", redirect to the next sub-step.
2. **Decompose the problem** into 3–5 sub-steps before offering any specific hint.
3. **Ask what the student has already tried** before giving guidance.
4. **Use Danish stx vocabulary** where the seeded problem uses Danish terms; English fallback for AR-trial alignment with [examples.qmd](file:///Users/mark/Documents/clients/cph-uni/examples.qmd).
5. **Cite the seeded problem set** when referencing givens (the only "RAG citation" v0.1 needs since the corpus is one document).

**No new endpoints.** The skill mounts via the existing template skill-loading machinery.

### Frontend Changes

**Modified files:**
- `frontend/src/lib/branding.ts` — replace Aitana → AIPLA strings (app name, page title, welcome copy, logo path).
- `frontend/public/logo.svg` (or equivalent) — swap to AIPLA mark (TBD: do we have one yet? if not, plain text wordmark is fine for v0.1).
- `frontend/src/app/group/page.tsx` — Danish-friendly copy on the group-ID entry form (e.g., "Indtast din gruppekode" alongside the English fallback). Keep the form logic identical.
- `frontend/src/app/page.tsx` (or marketplace landing) — single-skill view; hide the marketplace shelf, route directly into `problem-set-hints` after group join. v0.1 only has one skill; no need to make teachers/students browse.

**State management:** none new. The existing `AnonymousGroupAuthProvider` handles the session.

**UI/UX flow:**
```
Open URL → "Indtast din gruppekode" form (group-ID entry, no PII) →
   → Group ID validated server-side → Chat surface, AIPLA branding →
   → Student types "Hjælp med opgave 1" →
   → AG-UI tokens stream → `gemini-3.5-flash` (Vertex AI global) system prompt + seeded problem →
   → Tutor responds with first sub-step + asks what student has tried
```

### Infra Changes (M0 — the cloud bootstrap)

**New GCP project:** `aipla-dev-2026` in `europe-north1` (Finland) per [ADR-007](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd#adr-007-cloud-region).

**Resources to provision:**
- Firebase project + Auth (anonymous + email/password for future teacher SSO).
- Vertex AI API enabled in `europe-north1` (for fallback model + future Gemini routes).
- Cloud Run service `aipla-v0-frontend` (multi-container with backend sidecar, matching the inherited [cloudbuild.yaml](../../../../cloudbuild.yaml) pattern).
- Artifact Registry repo.
- Cloud Build trigger on `main` push → deploy.
- Service account `aipla-v6@aipla-dev-2026.iam.gserviceaccount.com` (matching inherited naming).
- Firestore (Native mode) in `europe-north3` (Finland equivalent; verify in 1.1 cloud-bootstrap).
- Cloud Storage bucket for static assets.
- Secrets: `ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, OTel exporter creds.
- Substitute the template's `aitana-multivac-*` references in [cloudbuild.yaml](../../../../cloudbuild.yaml) and [.env.example](../../../../.env.example) with AIPLA equivalents.

**Region pin:** every resource explicitly in `europe-north1` or its multi-region equivalent. No default-region resources.

**Out of v0.1 scope (rolls into 1.1 cloud-bootstrap):** Terraform module, full IAM cascade, BigQuery dataset, Cloud Build for `test`/`prod` branches, secrets-manager rotation policy. v0.1 sets the resources up by hand; 1.1 captures them as Terraform.

### Architecture Diagram

```
[Student group (1 phone)]
        │
        │ HTTPS
        ▼
[Cloud Run: aipla-v0-frontend]   europe-north1
   ├─ Next.js frontend (branding swap)
   └─ FastAPI backend sidecar
        │
        ├─► /group/* (anonymous mint + validate) ──► Firestore (group sessions)
        │
        └─► /skill/invoke (problem-set-hints)
               │
               ├─► ADK LlmAgent loads SKILL.md
               ├─► System prompt + seed-problem.md
               ├─► Tenant-span hook stamps group_id on OTel span
               │
               ▼
        Vertex AI (gemini-3.5-flash, global endpoint)
               │   ⚠ EU regional rollout pending; data-residency policy
               │     pins global → EU on aipla-dev-2026 (ADR-007 commitment)
               ▼
        AG-UI events stream back to frontend
               │
        Cloud Trace + GenAI logging (inside aipla-dev-2026)
        (telemetry + model call both stay inside Google Cloud edge)
```

## Implementation Plan

Six milestones (M0–M5). The sprint plan (companion `jutland-demo-sprint.md`, written next via `sprint-planner`) breaks each into LOC-estimated tasks.

### M0 — Cloud bootstrap (sequential, blocks deploy) (~3–4h)
- [ ] Create `aipla-dev-2026` GCP project, link billing
- [ ] Enable APIs: Firebase, Vertex AI, Cloud Run, Cloud Build, Artifact Registry, Firestore, Secret Manager, Cloud Trace, Cloud Logging
- [ ] Pin region `europe-north1` on Cloud Run + Artifact Registry; Firestore to Finland multi-region
- [ ] **Configure Vertex AI Data Residency policy** to pin `global`-endpoint requests to EU storage + processing (covers `gemini-3.5-flash` until europe-north1 is GA)
- [ ] Create `aipla-v6@` SA + role bindings (Cloud Run Invoker, Firestore User, **Vertex AI User**, Secret Accessor)
- [ ] Firebase project init; enable anonymous auth
- [ ] Cloud Build connection to `sunholo-data/cphu-aipla-app` GitHub repo
- [ ] Secrets seeded: Firebase admin SA JSON. **No Anthropic API key needed** — model access is via Vertex AI ADC, no third-party API egress
- [ ] Substitute `_PROJECT_ID`, `_SERVICE_NAME`, `_REGION` in [cloudbuild.yaml](../../../../cloudbuild.yaml) for `dev → aipla-dev-2026`
- [ ] Smoke: trigger one Cloud Build, verify it deploys and `/health` responds

### M1 — `problem-set-hints` skill (parallel A) (~2–3h, ~150 LOC)
- [ ] Create `backend/skills/templates/problem-set-hints/SKILL.md` (Agent Skills spec, model = `gemini-3.5-flash`, provider = Vertex AI global; no `thinkingConfig` override — leave at provider default)
- [ ] Write `resources/seed-problem.md` (use AR's projectile-motion problem from [examples.qmd](file:///Users/mark/Documents/clients/cph-uni/examples.qmd) as fallback; see Open Question 2)
- [ ] Write `resources/scaffold-rubric.md` (5 markers; referenced from SKILL.md instructions)
- [ ] Write system prompt embodying the 5 principles in Backend Changes
- [ ] Pytest unit: `backend/tests/unit/skills/test_problem_set_hints.py` — verify the SKILL.md loads via `load_skill_from_dir()` and produces an `LlmAgent` with the expected model

### M2 — AIPLA branding swap (parallel B) (~2h, ~120 LOC)
- [ ] Edit `frontend/src/lib/branding.ts` — AIPLA strings
- [ ] Add Danish copy to `frontend/src/app/group/page.tsx`
- [ ] Single-skill landing (hide marketplace shelf, route group join → `problem-set-hints` directly)
- [ ] AIPLA logo or text wordmark in header/favicon
- [ ] Region pin in [cloudbuild.yaml](../../../../cloudbuild.yaml) substitutions
- [ ] Vitest: `frontend/src/app/group/__tests__/page.test.tsx` — assert Danish copy renders alongside English

### M3 — Group-ID + seed-corpus glue (parallel C, depends on M1 path) (~2h, ~80 LOC)
- [ ] Verify `LOCAL_MODE` seed loads `problem-set-hints` so JB's laptop fallback works
- [ ] Mint one test group ID `grp-jutland-test-1` via `aipla group new --class jutland-pilot`
- [ ] Document the demo flow in `frontend/public/demo-walkthrough.md` (one-page script JB can read off)

### M4 — Smoke test (depends M1 + M3) (~1–2h, ~80 LOC)
- [ ] Implement `aipla smoke jutland` in [cli/aipla/commands/smoke.py](../../../../cli/aipla/) (new file or extend existing)
- [ ] Test asserts: AG-UI first event <3s, response contains ≥3 of the 5 scaffold markers, response does NOT contain "the answer is" / "= [final number]" / Danish equivalents
- [ ] Add `scripts/smoke-jutland.sh` wrapper for ops use
- [ ] Run against `LOCAL_MODE` and against the deployed URL once M5 lands

### M5 — Deploy + verify (depends all) (~1h)
- [ ] Push to `main` → Cloud Build triggers → Cloud Run deploys
- [ ] Verify URL externally from M's laptop (curl + browser)
- [ ] Run `aipla smoke jutland --url <deployed>` → green
- [ ] Share URL with JB + AR via the scoping-site internal Slack/email (URL not committed to repo; lives in scoping-site `notes/`)

## Migration & Rollout

**Database migrations:** None. Firestore is fresh — only group-ID session collection in use.

**Feature flags:** None.

**Rollback plan:**
- If `aipla-dev-2026` deploy fails on demo day: **JB runs `LOCAL_MODE=1` on his laptop, demos from the projector**. Same skill, same UX, no cloud. This is the explicit fallback (Axiom 5).
- If `gemini-3.5-flash` thinking budget makes TTFT unacceptable for the demo: switch the skill's `model:` field to `claude-sonnet-4-6` (Anthropic API direct, ANTHROPIC_API_KEY required) via PR + redeploy (10-min round-trip if M is at keyboard). Or set `thinkingConfig.thinkingBudget: 0` on the existing Gemini config to disable thinking — same redeploy time, no auth change.
- If group-ID auth misbehaves: hard-coded test group `grp-jutland-test-1` exists for the demo regardless.

**Environment variables (new in v0.1):**
- `AIPLA_DEPLOY_ENV` = `dev` | `test` | `prod` (only `dev` for v0.1)
- `AIPLA_REGION` = `europe-north1` (validated at startup; backend refuses to boot in non-EU regions)
- Replaces inherited `AITANA_*` env vars where they appear

## Testing Strategy

### Frontend Tests (Vitest)
- [ ] Group-ID page renders Danish copy
- [ ] Branding strings come from `branding.ts`, no hard-coded Aitana mentions remain (regex test)
- [ ] Single-skill landing routes to `problem-set-hints` on join

### Backend Tests (pytest)
- [ ] `problem-set-hints` skill loads via `load_skill_from_dir()`
- [ ] Skill's `LlmAgent` has expected model + system prompt fragment
- [ ] OTel span emitted by a mock invocation carries `group_id` attribute (tenant-span hook still works after rebrand)

### Manual / E2E Testing
- [ ] `aipla smoke jutland --url $LOCAL_URL` passes against `LOCAL_MODE`
- [ ] `aipla smoke jutland --url $DEPLOYED_URL` passes against `aipla-dev-2026`
- [ ] Open the deployed URL in incognito, enter `grp-jutland-test-1`, ask "Hjælp med opgave 1" — verify scaffolding (no full solution) in the response
- [ ] Repeat with "what's the answer?" — verify the tutor declines and redirects to the next sub-step

## Security Considerations

- **No PII collected.** Anonymous group ID is the only identifier ([ADR-001](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd#adr-001-student-identity-no-auth-anonymous-group-ids)).
- **EU residency.** All AIPLA-controlled resources in `europe-north1`. Backend refuses to boot if `AIPLA_REGION` is unset or non-EU. **Vertex AI `gemini-3.5-flash` caveat:** the model is GA on the `global` endpoint only as of 2026-05-19; europe-north1 regional availability is pending Google's typical 1–4-week rollout. Project-level **Data Residency policy** on `aipla-dev-2026` pins global-endpoint storage and processing to EU. This holds the GDPR posture from ADR-007 while we wait for europe-north1 to light up. Re-evaluate before the v1.0.0-pilot teacher rollout — at that point either europe-north1 is GA (preferred) or we explicitly re-confirm the data-residency policy with UCPH data-protection.
- **Egress audit.** **Zero egress outside Google Cloud** for student-facing data. Model calls go to Vertex AI (in-project), traces and logs stay in Cloud Trace + Cloud Logging (in-project). Trust boundary is the GCP project edge per Axiom 9 — stronger story than the previous Anthropic-direct design because there is no third-party API at all in the request path.
- **Input validation.** Student messages bounded at 4KB per request (template default). Group IDs validated against Firestore-minted set; client cannot inject arbitrary IDs.
- **No teacher-side auth in v0.1.** All admin functions (creating classes, minting group IDs) happen through the CLI or M's local terminal — no public teacher routes. UCPH SSO ships in 1.6.
- **Prompt-injection resistance.** System prompt placed *before* the seeded problem-set content; student input is the last context block. Eval coverage of injection comes in 1.5.

## Performance Considerations

- **Expected load:** ~5 concurrent group sessions (Jutland visit + AR's iterations). No scale concern.
- **First-token target:** <1.5s (no tools). `gemini-3.5-flash` has thinking enabled by default — TTFT will be governed by `thoughtsTokenCount` (≈1.2k thought tokens on a typical scaffolding turn from the 2026-05-20 verification probe). Streaming should still surface "thinking…" status via AG-UI events before the visible reply lands; verify in M4 smoke and adjust if perceived latency suffers.
- **Cost note:** thinking-mode default produced 1182 thought tokens vs 75 visible tokens (94% of output spend) on the verification probe. **Cost monitoring deferred** to v1 — capability-floor eval data (post-pilot) will tell us whether to enable `thinkingConfig.thinkingBudget` caps or rely on cached-input ($0.15/1M) on the system prompt. v0.1 demo audience is small enough that per-turn cost is not load-bearing.
- **Cold start:** Cloud Run min-instances=0 in v0.1 is fine — first request of the day pays cold-start penalty, but the buffer week catches this. v1.0.0-pilot will set min-instances=1.
- **Bundle size:** No new frontend dependencies. Branding-string swap is a ~0KB delta.

## Success Criteria

- [ ] All frontend tests passing (`cd frontend && npm run test:run`)
- [ ] All backend tests passing (`cd backend && make test-fast`)
- [ ] Lint and typecheck clean (frontend `npm run quality:check:fast`; backend `make lint`)
- [ ] `aipla smoke jutland` passes against the deployed URL
- [ ] Demo URL reachable from outside UCPH network, verified by M and JB independently
- [ ] Manual scaffolding-rubric check: 5 sample student questions produce non-solution responses
- [ ] Zero `aitana-multivac-*` or `Aitana-Labs/platform` references in deploy config (grep test)
- [ ] OTel span on a Sonnet call shows `group_id` attribute and `aipla-dev-2026` project ID
- [ ] Demo walkthrough script shared with JB

## Resolved Decisions

1. **Default model: `gemini-3.5-flash` on Vertex AI `global` endpoint.** Switched from `claude-sonnet-4-6` on 2026-05-20, the day after Gemini 3.5 Flash GA at I/O 2026. Three reasons:
   - **Zero third-party egress** — Vertex AI sits inside the Google Cloud trust boundary alongside Cloud Trace + Cloud Logging. Stronger Axiom 9 / ADR-006 posture than going direct to Anthropic.
   - **EU residency via project policy** — europe-north1 regional availability hasn't arrived yet (probed 2026-05-20: only `global` returns 200). Vertex AI's project-level Data Residency policy on `aipla-dev-2026` pins `global` requests to EU storage + processing. Re-evaluate at v1.0.0-pilot.
   - **Verified behaviour** — probe on 2026-05-20 with a Danish stx physics scaffolding prompt produced a textbook energy-conservation Socratic hint without giving the final answer. Fit-for-purpose for `problem-set-hints`.

   Thinking budget left at provider default for v0.1 (94% of output spend is thoughts at default). Cost optimisation deferred until capability-floor eval data lands; v0.1 demo audience is small enough that per-turn cost is not load-bearing. Router-overridable per ADR-008 — Sonnet 4.6 remains a viable fallback in 1.4 model-router-aipla-config.
2. **Branch strategy** → `dev` is the working branch (replaces inherited `main`); `test` and `prod` exist for promotion. `main` is deleted both locally and on `sunholo-data/cphu-aipla-app` GitHub. Cloud Build trigger points at `dev` for `aipla-dev-2026`. Matches v5 convention and the AIPLA Fork Context table in [CLAUDE.md](../../../../CLAUDE.md).
3. **IaC strategy: gcloud script on dev, Terraform on test/prod.** `aipla-dev-2026` (already exists, created 2026-05-18, owner `m@sunholo.com`) is the scratchpad — provisioned by an idempotent `scripts/bootstrap-aipla-dev.sh` that the M0 task fills in as it goes. The script becomes the spec for the Terraform module that lands in **1.1 `aipla-cloud-bootstrap.md`** post-Jutland; that module then stands up `aipla-test-2026` and `aipla-prod-2026` cleanly. Drift on dev is tolerated; every ~2 weeks the script is re-run and `gcloud asset export` confirms convergence. Reference: [SEQUENCE.md 1.1](../SEQUENCE.md).

## Open Questions

1. **Seeded problem set source.** Use AR's projectile-motion problem from [examples.qmd](file:///Users/mark/Documents/clients/cph-uni/examples.qmd) as the v0.1 seed? Or ask AR for a fresh one (turnaround risk vs. authenticity gain)? **Recommend: use the projectile-motion example for v0.1**, ask AR for fresh content during the buffer week.
2. **AIPLA wordmark / logo.** Do we have a brand asset, or ship with a plain text wordmark for v0.1? **Recommend plain text wordmark** unless M has an SVG ready.
3. **When does europe-north1 light up for `gemini-3.5-flash`?** Probe weekly; switch the model config from `global` to `europe-north1` the day it returns 200. The model ID itself stays the same; only the Vertex AI endpoint URL changes.

## Related Documents

- [docs/design/aipla/SEQUENCE.md](../SEQUENCE.md) — AIPLA's overall build sequence
- [docs/product-axioms.md](../../../product-axioms.md) — axiom set scored above (template-inherited; AIPLA-aligned)
- [docs/design/v6.1.0/local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — `aipla` CLI design (inherited as `aitana`; rebranded)
- Scoping site (external, design source-of-truth):
  - [architecture.qmd](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd) — ADRs 001 (anonymous group IDs), 002 (template adoption), 003 (model tiers), 006 (GCP EU), 007 (europe-north1), 008 (model router), 015 (multi-surface UI — v0.1 uses chat surface only)
  - [strands.qmd](file:///Users/mark/Documents/clients/cph-uni/strands.qmd) — v0.1 skill commitment: "Problem-set hints (v0.1 Jutland demo + v1)"
  - [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd) — phase 0.5 "Jutland demo (v0.1)"
  - [examples.qmd](file:///Users/mark/Documents/clients/cph-uni/examples.qmd) — AR's projectile-motion example, fallback seed problem set
