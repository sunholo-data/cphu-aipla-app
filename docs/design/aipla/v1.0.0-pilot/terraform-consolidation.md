# terraform-consolidation — one IaC source of truth, portable-shaped for migration

**Status**: Planned — this month's infra focus (opened 2026-07-27)
**Priority**: P1 — on the pilot critical path. Cutting `test`/`prod` (the release safety net per [env-promotion-dev-test-prod.md](env-promotion-dev-test-prod.md)) is blocked on completing Terraform **increment 2**; the top-level [SEQUENCE "current execution priority"](../SEQUENCE.md) item 2 ("provision test from committed infrastructure") cannot happen until it lands.
**Estimated**: ~1 week focused infra (increment 2 + dev import to zero-diff + config extraction), then the test/prod cut runbook from [1.3](env-promotion-dev-test-prod.md) M2–M5.
**Scope**: Infra + handover. Completes the GCP Terraform so **all three envs — dev included — are provisioned from committed HCL**, retires the imperative bootstrap as source of truth, and shapes the module boundary so the on-prem Layer-2 deliverable ([3.2](../v2.0.0-handover/self-hosting-and-terraform-handover.md)) can mirror it 1:1. Does **not** build the on-prem stack or execute any migration.
**Dependencies**: [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) (1.1 — the module this completes; increment 1 landed 2026-06-17), [env-promotion-dev-test-prod.md](env-promotion-dev-test-prod.md) (1.3 — whose "dev stays imperative" decision this **supersedes**), [build-once-artifact-promotion.md](build-once-artifact-promotion.md) (1.3a — the promotion-trigger model increment 2 must follow), [self-hosting-and-terraform-handover.md](../v2.0.0-handover/self-hosting-and-terraform-handover.md) (3.2 — the portability layer this feeds), [firestore-portability-seam.md](../v2.0.0-handover/firestore-portability-seam.md) (3.3 — the seam-audit pattern the remaining seams follow). ADR-006/007 (regional pinning). `infrastructure/env/` + `infrastructure/modules/`.
**Created**: 2026-07-27
**Last Updated**: 2026-07-27

---

## Problem Statement

The Terraform story is two-thirds built and stalled at a decision that was right for June and wrong for handover.

- **1.1 ([aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md), 2026-05-26)** set the goal: *every* per-env mutation in [`scripts/bootstrap-aipla-dev.sh`](../../../../scripts/bootstrap-aipla-dev.sh) becomes a Terraform resource, the script shrinks to a shim, and dev's existing resources get `terraform import`ed (Open Q3). Increment 1 landed the foundation (APIs, IAM, Firestore, chat-logs, storage, secrets, artifact registry).
- **1.3 ([env-promotion-dev-test-prod.md](env-promotion-dev-test-prod.md), 2026-06-17)** then *deferred* the dev half: **"dev stays imperative; test/prod are Terraform-only."** Pragmatic under pilot time-pressure — but it splits the source of truth in two and writes a manual-drift rule into [`infrastructure/env/README.md`](../../../../infrastructure/env/README.md): *"When [the script] changes, mirror the change here."* That mirror is by-hand, and the 701-line script is the authoritative inventory the Terraform is a hand-copy of.

Two things have changed since June that flip the trade:

1. **Increment 2 is now a pilot blocker, not a nicety.** The un-Terraformed surface — Firebase anonymous auth + Web App + `FIREBASE_ENV`, and the Cloud Build connection/repository/triggers + the CB-service-agent `actAs` binding — lives *only* in the dev bootstrap script. `test`/`prod` cannot be cut from committed infra (pilot-readiness item 2) until those are HCL. The 2026-05-26 cloud-build SA auth gap (1.1) is inside this same surface and still only "hypothesis, fix pending."
2. **Handover needs one reviewable source of truth.** 3.2 (the contracted UCPH self-host package) commits to a *"two-layer, shared-variable"* design where the on-prem modules mirror the GCP modules — *"swap the backend module, keep the contract."* You cannot mirror a 701-line imperative shell script. Layer 1 must be clean, declarative, and capability-shaped for Layer 2 to exist at all.

**The systemic pattern (per the design-doc audit rule):** every prior infra incident has been *another special-case patched into the shell script* — Side effect 7 (~6h), the SA auth gap (~5h+). 1.1's own decision-criterion #2 named the tripwire: *"the shell script accumulates a non-trivial second gap."* It has. The fix is not a third patch; it is to make the declarative path cover **all** envs uniformly and delete the script as an authority.

**Current State (verified against [`infrastructure/env/`](../../../../infrastructure/env/) + `cloudbuild.yaml`, 2026-07-27):**
- Increment 1 Terraform: ✅ (`apis/iam/firestore/storage/secrets/artifact_registry.tf` + `modules/{chat-logs,curriculum-rag,voice}`).
- Increment 2 Terraform: ⏳ absent (`firebase.tf`, `cloudbuild.tf` not written).
- `envs/dev.tfvars`: exists **for `plan`-diffing only** — never `apply`ed (would adopt live script-managed resources without import).
- Runtime config (`AIPLA_THINKING_BUDGET`, model region block, min-instances, origins) hardcoded in `cloudbuild.yaml` — a GCP-only file, so those values are stranded on any non-Cloud-Build runtime.

**Impact:** blocks the test/prod cut (pilot safety net); leaves the handover Layer-1 un-mirror-able; keeps the SA auth-gap fix unverified; carries a standing manual-drift liability between the script and the Terraform.

---

## Goals

**Primary Goal:** One IaC source of truth. `dev`, `test`, and `prod` are each cut by `terraform apply -var-file=envs/<env>.tfvars` against committed HCL, with **no** imperative `gcloud`/script mutation as authority on any env. The module boundary is capability-named and shares a variable contract with 3.2's on-prem Layer 2.

**Success Metrics:**
- `terraform plan -var-file=envs/dev.tfvars` against live `aipla-dev-2026` reaches **zero diff** — proving the HCL fully describes dev, including the resources the script created.
- `scripts/bootstrap-aipla-dev.sh` is reduced to a shim (`terraform init && terraform apply -var-file=envs/dev.tfvars`) or moved to `legacy/` with a pointer; `bootstrap-aipla-dev.NOTES.md` is retained as historical inventory, no longer a live authority.
- Increment 2 resources exist in HCL and a fresh `test` project is cut end-to-end from them (Firebase anonymous auth + Web App + `FIREBASE_ENV`; CB connection/repo/triggers; the `serviceAccountTokenCreator`-on-self binding that closes the 1.1 auth gap).
- The 1.1 auth-gap hypothesis is **confirmed or refuted** by a real `test` apply (the deploy-time seed step runs green, no 403).
- Runtime container config is sourced from a provider-neutral surface (Terraform-rendered), not hardcoded in `cloudbuild.yaml`; prod-hardening values (min-instances, ingress/auth) are per-env variables.
- Every module input/output name that has an on-prem twin matches 3.2 §6's Layer-2 module contract (documented in the GCP↔on-prem mapping table).

**Non-Goals:**
- Building the on-prem Layer-2 stack (Supabase/pgvector/vLLM/Helm) or running any migration — that is 3.2 Phase 2, eval- and UCPH-hosting-gated, out of contract window unless both gates land.
- Re-architecting the deploy (frontend + backend-sidecar multi-container topology is unchanged).
- Switching providers or writing "multi-cloud HCL" — see [Anti-goal](#anti-goal-no-premature-multi-cloud-hcl).
- Re-deriving the on-prem component inventory / model sizing — that is 3.2 §1–§5, cited not restated.

---

## Axiom Alignment

Scored per [Product Axioms](../../../product-axioms.md). Net must be >= +4; max 2 conflicts.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Infra; no runtime-latency change. |
| 2 | EARNED TRUST | 0 | No factual-claim surface. |
| 3 | SKILLS, NOT FEATURES | 0 | Invisible to end users. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Routing unchanged. |
| 5 | GRACEFUL DEGRADATION | +1 | A drift-free, reproducible `test` tier is the safety net the 2026-06-17 dev-only outage showed we lacked; a bad apply is caught before prod. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Declarative HCL over a bespoke idempotent shell script; capability-named modules with a shared variable contract (the same discipline as the `FirestoreClient` Protocol in 3.3). |
| 7 | API FIRST | 0 | One API surface; hosting/provisioning concern only. |
| 8 | OBSERVABLE BY DEFAULT | +1 | `terraform plan` is a reviewable, diffable statement of the whole environment — the inventory becomes legible instead of buried in 701 lines of shell. |
| 9 | SECURE BY CONSTRUCTION | +1 | Every IAM binding + secret + `actAs` grant becomes explicit and reviewable; the implicit side-effect grants (log-sink writer, CB service agent, `allUsers` invoker) stop being invisible. Closes the standing SA auth-gap declaratively. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Frontend unchanged. |
| 11 | USABLE BY DESIGN | 0 | No student-facing surface. |
| | **Net Score** | **+5** | Threshold met. Zero conflicts. |

**Conflict Justifications:** None (no -1 scores).

---

## Design

### 1. Decision: fold dev into Terraform (supersedes 1.3's "dev stays imperative")

> **Supersession note.** [1.3 §"Provisioning model"](env-promotion-dev-test-prod.md) decided *"dev is the imperative reference env; test/prod are Terraform-only."* That is **superseded here**: dev is imported into Terraform and provisioned declaratively like the other tiers. 1.3's *code-promotion* flow and per-env checklist are unaffected — only the "dev stays imperative" clause changes. This restores 1.1's original Primary Goal (script → shim, import dev).

**Why now, not at handover:** the two June rationales for keeping dev imperative — "dev is where we *discover* infra" and "import is fiddly" — have expired. Discovery is done (the surface is known and inventoried in `bootstrap-aipla-dev.NOTES.md`); and the import is now a bounded, one-time ~4–6h task (1.1 Open Q3) whose payoff is exactly the single source of truth handover requires.

**Mechanism:**
1. Make `envs/dev.tfvars` an *apply* target (today it is plan-only). Populate it from the live dev project.
2. `terraform import` each existing dev resource into state (SA, IAM members, buckets, secrets, Firestore, artifact repo, chat-logs). Import mapping is the concrete deliverable — one `import` block per resource, committed.
3. Iterate `terraform plan` against dev until **zero diff**. Every non-zero diff is either (a) a real drift to reconcile, or (b) an undocumented side effect the script created that the HCL was missing — both are *findings*, and reaching zero-diff is the proof the HCL is complete.
4. Only then retire the script's authority (shim or `legacy/`).

**Risk & guard:** the danger in importing is a destructive plan (a rename/replace that deletes a live resource under the pilot). Guard: **never `apply` against dev until `plan` is zero-diff**; review every `plan` line-by-line during import; the GCP resources with `prevent_destroy` where a replace would be catastrophic (Firestore DB, buckets with data, secrets). Dev carries live pilot-prep data — treat it as prod-grade during this window.

### 2. Complete increment 2 (Firebase + Cloud Build)

Authored against a real `terraform plan` of an enabled `test` project (per 1.3 M1 — these are the schema-riskiest resources; verify provider schemas, don't guess). Structure the identity resources as a self-contained module precisely because identity is the least-portable seam (§3).

- **`firebase.tf` (google-beta):** `google_identity_platform_config` (anonymous auth enabled — replaces the REST PATCH in the script), `google_firebase_web_app`, and the `FIREBASE_ENV` secret populated from its SDK config. The Web App is created only to harvest SDK config; document that side-effect purpose.
- **`cloudbuild.tf`:** `google_cloudbuildv2_connection` (`sunholo-github`) + `google_cloudbuildv2_repository` (`cphu-aipla-app`); `google_cloudbuild_trigger` for the dev deploy, the mcp-sandbox deploy, and — per **1.3a** — the build-once promotion triggers (`aipla-test-release` tag-trigger + `aipla-prod-promote` manual), **not** per-branch rebuild triggers.
- **The auth-gap fix (1.1):** add `google_service_account_iam_member` granting `aipla-v6@` `roles/iam.serviceAccountTokenCreator` **on itself** (1.1's testable hypothesis for why `generate-id-token` returned empty), plus `google_project_service_identity.cloudbuild` to force-materialise the CB service agent and its `serviceAccountUser` (`actAs`) binding on `aipla-v6@`. The `test` apply is the experiment that confirms/refutes the hypothesis: if the deploy-time `aipla-seed-skills` step runs green with no 403, the binding was the root cause.
- **Home of the connection/triggers (DECIDED 2026-07-27): in-env, not centralised.** The CB connection + triggers live in each env project (`aipla-test-2026`, etc.), **reversing** the 1.3-M0 "move to the deploy project" note. AIPLA is one app × three envs (handed to UCPH, possibly migrated off GCP), so the centralise-and-amortise pattern that fits `multivac-deploy-aitana` (many apps behind one deploy plane) does not pay off here; blast-radius isolation (no single SA that deploys to all envs — Axiom 9), per-env self-containment for handover, and off-GCP portability all favour in-env. Only **tfstate** is centralised (in the existing `aipla-deploy` project). The sole deliberate cross-project edge stays the 1.3a promote path (prod build reads test's Artifact Registry, read-only).

### 3. Portable capability-module boundary (feeds 3.2 Layer 1)

The portability question from the framing — *"it may migrate from GCP to on-prem or other clouds"* — is **not** answered by making the HCL run anywhere (it can't; `google_*` resources have no cross-provider form). It is answered by shaping Layer 1 so 3.2's Layer 2 mirrors it. Concretely:

- **Name modules by capability, not GCP product**, so each maps to exactly one 3.2 Layer-2 module and one row of the on-prem resource list:

  | Capability (Layer 1, this repo) | GCP impl today | 3.2 Layer-2 twin | Shared contract (inputs/outputs) |
  |---|---|---|---|
  | `document-db` | Firestore | Postgres (Supabase) | connection secret out; `env`, `project`/`namespace` in |
  | `object-store` | GCS buckets | MinIO / NFS | bucket/URI out |
  | `analytics-sink` | BigQuery + Log Router | Postgres / ClickHouse | dataset/DSN out |
  | `vector-retrieval` | Vertex RAG (post-apply) | pgvector (post-apply) | corpus/DSN secret out |
  | `identity` | Firebase + group JWT | UCPH OIDC + group JWT | issuer + signing-secret out |
  | `secrets` | Secret Manager | Vault / k8s Secrets | secret refs out |
  | `app-runtime` | Cloud Run multi-container | k8s/Helm | image + env + probes in |
  | `observability` | Cloud Logging/Trace | OTEL → Grafana | exporter endpoint in |

- **The module's input/output contract is the stable seam; the resources inside are throwaway per-cloud.** This is 3.2 §6's *"swap the backend module, keep the contract,"* made concrete in Layer 1. The existing `modules/{chat-logs,curriculum-rag,voice}` already point this way; the increment-2 identity work and the dev-import consolidation should adopt the same shape rather than flat top-level `.tf` files where a capability boundary is natural.
- **It doubles as the handover artifact.** Even if UCPH never runs `terraform apply`, the module inputs *are* the annotated resource list 3.2 §5 promises IT — one capability = one module = one costable line.

### 4. Extract runtime config out of `cloudbuild.yaml`

Runtime env (`AIPLA_THINKING_BUDGET`, the model/region block, `VOICE_*`, sandbox/frontend origins, `--min-instances`, ingress/auth) is currently hardcoded in `cloudbuild.yaml` — a GCP-only build file. That is the single biggest concrete portability smell and a prod-hardening trap (dev-tuned values like `AIPLA_THINKING_BUDGET=0` silently reach prod).

- Move runtime config to a **provider-neutral, per-env source** — Terraform-rendered env from `envs/<env>.tfvars` (and, on the on-prem side, a Helm `values.yaml` consuming the same keys). The `app-runtime` module renders it into the Cloud Run container today and a k8s Deployment tomorrow.
- This makes prod-hardening a per-env variable set (1.3 Risks: `--min-instances` for pilot cold-start, ingress/auth reconsidering `--allow-unauthenticated`, `AIPLA_THINKING_BUDGET` for prod) rather than an edit to a shared build file.
- **Frontend runtime config (1.3a "option A") — reviewed + deferred, DECIDED 2026-07-27.** The promotion model (reviewed with M) is confirmed as 1.3a's: branch→dev, **tag→test**, **copy-backend-by-digest + rebuild-frontend-from-tag→prod** (matches the ailang-parse/docparse pattern). The one place AIPLA can't pure-copy is the frontend, because Next.js bakes `NEXT_PUBLIC_*` at build time (1.3a §What's copy-promotable). Making the frontend read config at **runtime** (`/api/config` / `window.__ENV__`) is this same config-extraction principle applied to the frontend, and would make its image env-agnostic → **pure copy-promote, full build-once**. Deferred to its own ~1d sprint (touches `frontend/src/lib/firebase.ts` + the sandbox-URL read); the pilot ships 1.3a option B (rebuild-from-tag). Strongest upstream-template item here.

### 5. The never-Terraform post-apply layer (name by capability)

Agent Engine (`reasoningEngines`) and the curriculum RAG corpus have no google-provider resource and stay scripted post-apply (1.1 "Never Terraform"; 3.2 confirms). Keep them — but **name the step by capability** ("provision session store", "provision retrieval store") so the on-prem twin ("stand up `DatabaseSessionService` on Postgres", "stand up pgvector") slots into the same runbook position. The post-apply layer is part of the portable design, not an exception to it.

### 6. State backend (settled, with one migration caveat)

State lives in the existing **`aipla-deploy`** project / `gs://aipla-deploy-tfstate`, per-env prefix (1.3 M0; project name corrected 2026-07-27 — `aipla-deploy`, not the earlier-proposed `aipla-deploy-2026`; bucket created 2026-07-27). **Caveat to record for the on-prem trigger:** GCS state couples the *operator's* toolchain to live GCP creds; a genuine off-GCP migration would move state to a neutral store (UCPH MinIO / local). Not a now-problem — flagged so it is not discovered at cutover (mirrors 3.2 Open Q3).

### CLI Surface

Operators, not per-developer daily loops — so `make` targets are the ergonomic surface, not an `aiplatform` subcommand (an `aiplatform infra` command is explicitly out of scope; operators run `terraform`/`make` directly).

- `make tf-plan ENV=<env>` / `make tf-apply ENV=<env>` — wrap `terraform init -backend-config=… && terraform {plan,apply} -var-file=envs/<env>.tfvars` (extends 1.1 §G's `tf-apply-<env>`).
- `make tf-import-dev` — runs the committed dev `import` blocks, then `plan` (must show zero diff before the script is retired).

Add both to `scripts/` + the root `Makefile` in the same PR (Automation Principle).

### Anti-goal: no premature multi-cloud HCL

Do **not** write HCL that tries to target GCP and on-prem from one config, or add provider-switching `count`s. The migration is gated (3.2: UCPH confirms hosting **and** the capability-floor eval clears local-readiness **and** — per the July steer in `self-hosting.qmd` — student-data collection begins), Medium-effort behind real seams, and likely post-contract. The right investment now is **clean capability seams + honest per-module "GCP-only" labelling + config extraction**. Build Layer 1 well; Layer 2 (3.2 Phase 2) gets written against a real UCPH cluster when the gates land, not guessed now.

---

## Implementation Plan

Sequenced so the pilot-blocking path (increment 2 → test cut) lands first; dev-import consolidation and config extraction run alongside/after.

### Phase A — Increment 2 + first fresh cut (pilot-blocking, ~week 1)
- [ ] `firebase.tf` (google-beta) authored against a real `plan` of an enabled `aipla-test-2026`.
- [ ] `cloudbuild.tf` — connection/repo + dev/mcp-sandbox triggers + 1.3a promotion triggers + the `serviceAccountTokenCreator`-on-self binding + CB service-agent `actAs`.
- [ ] `terraform apply -var-file=envs/test.tfvars` cuts `test` fresh; post-apply steps (Agent Engine, RAG corpus **cleared content only**, `DOCPARSE_API_KEY`, `make seed ENV=test`, demo codes).
- [ ] **Confirm/refute the 1.1 auth-gap hypothesis** — the deploy-time seed step runs green on `test` with no 403.

### Phase B — Fold dev in to zero-diff (~week 1–2)
- [ ] Populate `envs/dev.tfvars` as an apply target; author committed `import` blocks per dev resource.
- [ ] `make tf-import-dev`; iterate `plan` to **zero diff**; log every discovered side effect / drift as a finding.
- [ ] Retire `bootstrap-aipla-dev.sh` to a shim (or `legacy/`); keep `NOTES.md` as history; update `infrastructure/env/README.md` (delete the "mirror the change here" manual-drift rule).

### Phase C — Portability shaping + config extraction (~week 2)
- [ ] Reorganise natural capability boundaries into modules with the §3 shared-variable contract; add the GCP↔on-prem mapping table (feeds 3.2 §6).
- [ ] Extract runtime config from `cloudbuild.yaml` into per-env tfvars-rendered env via the `app-runtime` module; set prod-hardening values as per-env variables.
- [ ] Name the post-apply steps by capability (§5).

### Phase D — Prove test, cut prod (closer to / after 2026-08-14 pilot)
- [ ] 1.3 M3–M5: `smoke-deployed.sh test all`, `verify-chat-logs ENV=test`, teacher + anon-group student round-trip on fresh sessions; then prod with hardening.

**Remaining 3.2 Phase-1 seam audit** (session-service / RAG / auth / GCS) rides along as each capability module is shaped — it is the same work viewed from the portability side, and 3.3 is the template.

---

## Migration & Rollout

- **Order:** increment 2 → cut `test` fresh (no import needed — greenfield) → import `dev` to zero-diff → retire script → cut `prod`.
- **Non-destructive:** the live GCP stack stays authoritative until each env's `plan` is clean; import never applies against dev before zero-diff; no env is cut over destructively.
- **Rollback:** dev's script + `NOTES.md` remain in git history as the fallback inventory until zero-diff is proven; test/prod are greenfield so rollback is "destroy and re-apply."
- **Co-owners:** infra hand-off is part of [handover-package.md](../v2.0.0-handover/SEQUENCE.md) (3.1); UCPH ops / P2 inherit a single declarative source, which is the point.

## Testing Strategy

- **`terraform plan` zero-diff against dev** — the acceptance gate for Phase B (proves the HCL fully describes the live env).
- **A fresh `test` apply** — the acceptance gate for Phase A (proves increment 2 cuts an env from committed infra, and closes the auth gap).
- **`scripts/smoke-deployed.sh <env> all`** + **`make verify-chat-logs ENV=<env>`** — the per-env post-cut acceptance gates (already env-parameterised, from 1.3).
- **`make security-check`** on any new IAM — the increment-2 bindings widen the auth surface; run the dep-security gate's IAM assertions.

## Success Criteria

- [ ] `terraform plan -var-file=envs/dev.tfvars` → zero diff against live `aipla-dev-2026`.
- [ ] `bootstrap-aipla-dev.sh` retired to a shim / `legacy/`; the README manual-drift rule deleted.
- [ ] Increment-2 resources in HCL; a fresh `test` cut end-to-end from them; the 1.1 SA auth gap confirmed closed (seed step green, no 403).
- [ ] Runtime config sourced from per-env tfvars (not hardcoded in `cloudbuild.yaml`); prod-hardening values are variables.
- [ ] Capability modules carry the shared input/output contract + a committed GCP↔on-prem mapping table matching 3.2 §6.
- [ ] `make tf-plan/tf-apply/tf-import-dev` exist and are documented in the Makefile.

## Open Questions

1. **Import dev, or re-create dev fresh?** Import preserves live pilot-prep data (safer, but fiddlier `plan` reconciliation). A fresh re-create is cleaner HCL but throws away dev's seeded state. **Lean: import** — dev holds pilot-prep work we should not lose, and import is the 1.1-scoped path.
2. ~~**Move the CB connection/triggers to the deploy project?**~~ **RESOLVED 2026-07-27: no — CB stays in-env** (see §2 "Home of the connection/triggers"). Only tfstate is centralised. Reverses the 1.3-M0 intent.
3. **How far to push module reorganisation before the pilot?** Full capability-module refactor vs. minimal (identity module + mapping table, defer the rest to handover). **Lean: minimal now** (identity module + config extraction + the mapping table, since those are the pilot-critical + handover-load-bearing parts); the fuller refactor is a handover-window task shared with 3.2.
4. **`prevent_destroy` scope.** Which live dev resources get the lifecycle guard during import (Firestore DB, data buckets, secrets — clearly; the artifact repo, the SA — probably)?

## Related Documents

- [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) — 1.1, the module this completes (increment 1 landed; increment 2 + dev import are here)
- [env-promotion-dev-test-prod.md](env-promotion-dev-test-prod.md) — 1.3, whose "dev stays imperative" clause this supersedes; its promotion flow + per-env checklist stand
- [build-once-artifact-promotion.md](build-once-artifact-promotion.md) — 1.3a, the promotion-trigger model increment 2 follows
- [self-hosting-and-terraform-handover.md](../v2.0.0-handover/self-hosting-and-terraform-handover.md) — 3.2, the on-prem Layer-2 deliverable this feeds (§6 shared-variable design, §1 resource list)
- [firestore-portability-seam.md](../v2.0.0-handover/firestore-portability-seam.md) — 3.3, the seam-audit pattern the remaining capability seams follow
- [`infrastructure/env/`](../../../../infrastructure/env/) + [`infrastructure/modules/`](../../../../infrastructure/modules/) — the Terraform root + modules
- [`scripts/bootstrap-aipla-dev.sh`](../../../../scripts/bootstrap-aipla-dev.sh) + [`scripts/bootstrap-aipla-dev.NOTES.md`](../../../../scripts/bootstrap-aipla-dev.NOTES.md) — the imperative inventory being retired
- Scoping site: [`self-hosting.qmd`](file:///Users/mark/Documents/clients/cph-uni/self-hosting.qmd) (product why/when-to-migrate), ADR-006/007 (regional pinning)
