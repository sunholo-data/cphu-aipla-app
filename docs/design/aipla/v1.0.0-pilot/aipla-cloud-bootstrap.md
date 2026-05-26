# aipla-cloud-bootstrap — Terraform module for AIPLA infra

**Status**: Planned — SEQUENCE row 1.1
**Priority**: P1 (lifts the current shell-script bootstrap into reproducible IaC; immediate trigger is the 2026-05-26 cloud-build SA auth gap)
**Estimated**: 1.5d (per SEQUENCE)
**Scope**: Infra-only — Terraform module + IAM cascade + Cloud Build triggers + secrets schema + BigQuery dataset
**Dependencies**: ADR-006 (regional pinning), ADR-007 (`europe-north1`); the existing [`scripts/bootstrap-aipla-dev.sh`](../../../../scripts/bootstrap-aipla-dev.sh) + [`scripts/bootstrap-aipla-dev.NOTES.md`](../../../../scripts/bootstrap-aipla-dev.NOTES.md) are the source-of-truth inventory of what gets created
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

## Problem statement

The shell-script bootstrap (`scripts/bootstrap-aipla-dev.sh`) was the right shape for v0.1 — a single dev environment, fast iteration, every step idempotent. Once test/prod env need to be cut, the same work has to happen three times, and per-env drift (one IAM binding missing, one substitution mistyped) becomes the failure mode.

The **2026-05-26 demo-day incident** put a concrete cost on the bridge-state:

- The deploy-time `seed-platform-skills` Cloud Build step has been 403'ing silently *for every dev deploy since at least 2026-05-24*.
- Caused by: the build container can't mint a Google-signed ID token for the trigger's user-managed SA. Three variants tried, all failed:
  1. `curl metadata.google.internal/.../service-accounts/default/identity?audience=$URL&include_email=true` → returns the literal error string *"please provide a user-specified service account"* (which then becomes the Bearer value → backend `MalformedError`).
  2. Same URL with explicit `<email>/identity` instead of `default/` → identical error.
  3. `gcloud iam service-accounts generate-id-token <email> --audiences=$URL --include-email` → returned empty (`stderr` swallowed; likely a missing `iam.serviceAccountTokenCreator` self-binding or a wrong-context invocation).
- A fourth variant (`gcloud auth print-identity-token --audiences=$URL`) works in the inherited template's [`backend/cloudbuild.yaml:112`](../../../../backend/cloudbuild.yaml) — but that file isn't the active deploy config for AIPLA; the root `cloudbuild.yaml` is.

The downstream impact:
- PR #4's `platform_seed.py` upsert never ran on deployed dev (skipped silently).
- PR #5's `upsert-demo-codes` step couldn't seed `aipla-demo-1/2/3`.
- `local-demo` (LOCAL_MODE only) and any other demo code only worked on a developer's laptop.
- The team manually impersonated the SA from a laptop to seed Firestore (working but not durable).

The shell bootstrap is overdue for the planned Terraform rewrite. This doc is the design.

## Goals

**Primary goal:** Every per-env mutation that's currently in `bootstrap-aipla-dev.sh` is expressed as a Terraform resource, runnable as `terraform apply -target=...` against any of `aipla-{dev,test,prod}-2026` without per-env shell tweaks. New env = a `terraform.tfvars` file, not a checklist.

**Success metrics:**
- `bootstrap-aipla-dev.sh` is reduced to a tiny shim that runs `terraform init && terraform apply` against the dev workspace.
- A fresh GCP project gets fully provisioned (project APIs enabled, SA + IAM cascade, Firestore region pinned, Cloud Build trigger created, GitHub repo linked, secrets schema seeded, BigQuery dataset created) via `make tf-apply-dev`.
- The cloud-build SA auth gap that motivated this doc is **closed** — either the metadata-server path works once the IAM cascade is correctly applied, OR the deploy step shells out to `gcloud auth print-identity-token --audiences=$URL` which is known to work when the trigger's SA is properly attached.
- Test + prod environments can be cut from the dev module without re-deriving any auth incantations.
- Side effects 1–11 in [bootstrap-aipla-dev.NOTES.md](../../../../scripts/bootstrap-aipla-dev.NOTES.md) (the "implicit side effects of the fix" callouts) all become explicit Terraform resources.

**Non-goals (this doc):**
- Re-architecting deploys (Cloud Run topology unchanged).
- Switching providers (still GCP).
- Productionising LOCAL_MODE.

## The cloud-build SA auth gap — concretely

This is the load-bearing reason to ship the Terraform module sooner rather than later. Specifically what's missing on AIPLA dev (assertions to verify in Terraform):

| Binding | Member | Role | Resource | Verified working? |
|---|---|---|---|---|
| `aipla-v6@aipla-dev-2026.iam` exists | — | — | `google_service_account` | ✅ |
| Cloud Build service agent (`service-${PROJECT_NUMBER}@gcp-sa-cloudbuild.iam`) can impersonate `aipla-v6@` | CB agent | `roles/iam.serviceAccountUser` on aipla-v6@ | `google_service_account_iam_member` | ✅ (per Side effect 7) |
| `aipla-v6@` can mint ID tokens for itself | aipla-v6@ | `roles/iam.serviceAccountTokenCreator` on aipla-v6@ | `google_service_account_iam_member` | ❓ **likely missing** — explains why `generate-id-token` returned empty |
| Cloud Build trigger uses `aipla-v6@` | trigger | `serviceAccount: aipla-v6@` | `google_cloudbuild_trigger.service_account` | ✅ |
| The build VM's metadata server exposes `aipla-v6@` under `default/identity` | — | requires the trigger AND build infra to be running in the "user-managed SA" mode | (infrastructural, Cloud Build platform-level) | ❌ — empirically returns the error string |

**Hypothesis (testable):** the missing `serviceAccountTokenCreator on self` binding is the root cause. Without it, the SA can't mint ID tokens via the iamcredentials API (which is what both metadata-server AND `gcloud iam service-accounts generate-id-token` are calling under the hood). Once Terraform adds that binding declaratively, all four variants we tried should start working.

## What the Terraform module covers

Bucketed by what's in `bootstrap-aipla-dev.sh` today:

### A. Project + APIs (~10 resources)
- `google_project_service` × N (enable Firestore, Cloud Build, Run, Artifact Registry, Vertex AI, IAM Credentials, Secret Manager, Identity Toolkit, Eventarc)
- `google_project_iam_audit_config` (logging defaults)
- Region pinning via `google_firestore_database` with `location_id = "europe-north1"` (per ADR-007)

### B. Service accounts + IAM cascade (~15 resources)
- `google_service_account.aipla_v6`
- `google_service_account_iam_member` ×:
  - Cloud Build agent → `serviceAccountUser` on aipla-v6@ (Side effect 7)
  - aipla-v6@ → `serviceAccountTokenCreator` on aipla-v6@ ← **the missing one**
- `google_project_iam_member` × N (aipla-v6@ gets `aiplatform.user`, `storage.admin` scoped, `secretmanager.secretAccessor`, `run.invoker`)
- `google_project_service_identity.cloudbuild` to force-materialise the CB service agent

### C. Cloud Build connection + triggers (~5 resources)
- `google_cloudbuildv2_connection.github` (the existing `sunholo-github` connection)
- `google_cloudbuildv2_repository.cphu` linking the repo
- `google_cloudbuild_trigger.dev_deploy` (replaces `aipla-dev-deploy` from the script)
- `google_cloudbuild_trigger.mcp_sandbox` (replaces `aipla-mcp-sandbox-deploy`)
- All triggers carry the `service_account` field per Side effect 7

### D. Storage + buckets (~5 resources)
- `google_storage_bucket` × {`${PROJECT}-config`, `${PROJECT}-aipla-v01-logs`, `${PROJECT}-firestore-export`, etc.}
- Versioning + lifecycle rules from script

### E. Secrets (~3 resources)
- `google_secret_manager_secret.firebase_env` (the FIREBASE_ENV blob the seed step reads)
- `google_secret_manager_secret.group_auth_signing_secret`
- `google_secret_manager_secret_iam_member` granting aipla-v6@ access

### F. BigQuery (~2 resources)
- `google_bigquery_dataset.chat_logs` per ADR-005 (the sink lands later in SEQUENCE 1.2, but the dataset existing in dev is a 1.1 concern)

### G. Per-env wiring
- `terraform.tfvars` files for `{dev,test,prod}` carrying project_id, billing_account, github_repo, region
- A `Makefile` target `make tf-apply-<env>` that wraps `terraform workspace select <env> && terraform apply`

## Manual seed runbook (interim — until Terraform lands)

Until the module is in, this is the recipe for "the deploy didn't seed the platform-skill upsert or demo codes" — applies to any AIPLA env where the cloud-build SA auth gap persists.

**Pre-reqs:**
- gcloud installed locally and authenticated as a user with `roles/iam.serviceAccountTokenCreator` on `aipla-v6@`.
- `m@sunholo.com` has this binding on aipla-dev-2026 (verified working 2026-05-26).

**Run (one-time per env, after each `bootstrap-aipla-dev.sh` or after each "platform skill template changed" commit):**

```bash
GCLOUD=/path/to/gcloud
URL="https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app"  # or test/prod equivalent
SA="aipla-v6@aipla-dev-2026.iam.gserviceaccount.com"

# 1. Mint an ID token via SA impersonation (your user must have
#    serviceAccountTokenCreator on the SA).
TOKEN=$($GCLOUD auth print-identity-token \
  --impersonate-service-account="$SA" \
  --audiences="$URL" \
  --include-email)

# 2. Apply the platform_seed.py upsert (syncs SKILL.md template fields
#    into existing Firestore SkillConfig docs — without this,
#    SKILL.md edits to problem-set-hints, kinebot, led-planck etc.
#    never reach deployed Firestore once the skill is created).
curl -s -X POST "$URL/api/proxy/api/admin/seed-platform-skills" \
  -H "Authorization: Bearer $TOKEN"

# 3. Mint / refresh demo codes.
for code in aipla-demo-1 aipla-demo-2 aipla-demo-3; do
  curl -s -X POST "$URL/api/proxy/api/admin/mint-demo-group" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"code\": \"$code\", \"skill_name\": \"problem-set-hints\", \"title\": \"dev demo $code\", \"ttl_days\": 30}"
done

# 4. Verify a code works end-to-end (no auth needed — public join endpoint).
curl -s -X POST "$URL/api/proxy/api/auth/group/join" \
  -H "Content-Type: application/json" \
  -d '{"group_id": "aipla-demo-1"}'
# Should return 200 with a JWT + uid + expires_at.
```

**When to re-run:**
- After any deploy that touched a `SKILL.md` template (so the upsert applies your edits)
- Monthly to refresh the demo codes' 30-day TTL
- After cutting a new env from Terraform (initial seed)

**What's been deleted (2026-05-26):**
- `cloudbuild.yaml` no longer contains `seed-platform-skills` or `upsert-demo-codes` steps — they 403'd silently every build and confused diagnostics. Will be reinstated as a Cloud Build step in the Terraform module once the SA auth path works.

## Decision criteria — when to ship

Build the Terraform module when **all three** are true:

1. **A test or prod env needs to be cut.** Today it's only dev; the cost of re-deriving the bootstrap script is hypothetical until a second env is wanted. Plan says 2026-07-15 → cut `aipla-test-2026` from the script vs from Terraform — whichever is ready.
2. **The shell script accumulates a non-trivial second gap.** First was Side effect 7 (~6 hours to diagnose); second was today's auth gap (~5 hours so far). Third gap and the cumulative shell-archaeology time exceeds the Terraform port cost.
3. **AIPLA team has 1.5d of focused time** outside of feature work. v1.0.0-pilot milestones are P1; this is P1-infra and trades against feature work.

## Open questions

1. **Hosted Terraform state or local backend?** Local backend with `.tfstate` checked into a private bucket is the simplest. Hosted (Terraform Cloud / Spacelift) is overkill for a 4-month contract.
2. **How much of the test/prod cut is "do nothing"?** A well-shaped module makes test/prod cuts mostly free; an underspecified one makes them painful. Time-box the module at 1.5d — if it spills, drop scope (Secrets module last, BigQuery module last).
3. **Where do existing-env imports happen?** Dev is half-bootstrapped from the script; we need `terraform import` calls for each existing resource. Estimated ~1h of import-mapping per resource type; total 4-6h. Worth doing once before the test/prod cut.
4. **Who maintains the module long-term?** The 4-month contract ends 2026-09-15. Either UCPH ops takes over (likely) or AIPLA's open-source upstream absorbs it (unlikely, since AIPLA-specific). Hand-off plan is part of `handover-package.md` (SEQUENCE 3.1).

## Out of scope

- Productionising the demo codes (e.g. teacher-minted codes via the 1.G teacher UI replaces them in v1.0.0-pilot anyway — see [teacher-permission-model.md](teacher-permission-model.md)).
- Re-architecting the multi-container Cloud Run deploy (frontend + backend sidecar pattern stays).
- LOCAL_MODE parity — that's its own concern (the `local_fixture.py` + LOCAL_MODE bypass in the bootstrap script).

## Related

- [SEQUENCE.md](../SEQUENCE.md) row 1.1 (this is the design doc for it)
- [scripts/bootstrap-aipla-dev.sh](../../../../scripts/bootstrap-aipla-dev.sh) — current source of truth, to be Terraformised
- [scripts/bootstrap-aipla-dev.NOTES.md](../../../../scripts/bootstrap-aipla-dev.NOTES.md) — every side-effect / IAM binding / gotcha that the module must reproduce
- [backend/admin/auth.py](../../../../backend/admin/auth.py) — the endpoint that gates seed + mint behind SA-signed ID tokens (the auth gap surfaces here)
- ADR-006, ADR-007 in the scoping site — regional pinning + Cloud Build connection model
- [feedback-check-existing-patterns-first](file:///Users/voightkampff/.claude/projects/-Users-voightkampff-dev-sunholo-data-cphu-aipla-app/memory/feedback_check_existing_patterns_first.md) — memory entry capturing the lesson learned today
