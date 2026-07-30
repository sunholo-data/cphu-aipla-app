# Runbook — cutting `prod` (and any fresh AIPLA env)

**What:** the ordered, gotcha-annotated procedure to stand up `aipla-prod-2026`
from committed Terraform + the scripted post-apply steps. Distilled from the
**test cut on 2026-07-27** ([terraform-consolidation-sprint.md](../../design/aipla/v1.0.0-pilot/terraform-consolidation-sprint.md)),
so every friction we hit going dev→test is either **smoothed** (automated/fixed)
or **flagged** (an inherent manual gate) here — no re-discovery.

> **Status legend:** ✅ smoothed (automated or fixed in shared code) · ✋ manual
> gate (inherent, e.g. a browser OAuth) · 🔨 still-to-build (deferred work that
> must land before this step works for prod).

## Preconditions

- `aipla-prod-2026` exists with **billing linked** (org-level; not in this repo).
- You are authed as an owner/editor of the project: `gcloud config set account m@sunholo.com`.
- The tfstate bucket **`gs://aipla-deploy-tfstate`** exists (created for test 2026-07-27, in the `aipla-deploy` project — shared across envs). ✅
- `terraform`, `uv`, `gcloud` on PATH.
- **`make cli-install`** — reinstall the `aiplatform` CLI from current source. A stale installed CLI carries old `*-placeholder.a.run.app` URLs (bit the test curriculum seed); the current CLI resolves test/prod URLs live via gcloud. (Scripts that shell to the *installed* CLI — e.g. `seed-curriculum.sh` — otherwise use the stale URL; the `uv run --directory cli` make targets always use source.)

## Steps

### 1. Pre-stage APIs ✅ (was a dev→test surprise)
A bare project has **only `serviceusage` enabled**; the GitHub-connection wizard
(step 2) needs `cloudbuild` + `secretmanager` first, and the full apply needs the
rest. Enable them declaratively in one shot:
```bash
cd infrastructure/env
# serviceusage + cloudresourcemanager BOTH first: google_project_service uses the
# Cloud Resource Manager API to enable the others. (test had CRM on by default;
# prod did NOT — projects vary in default-enabled APIs. Found 2026-07-28.)
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com --project=aipla-prod-2026
terraform init -reconfigure -backend-config="bucket=aipla-deploy-tfstate" -backend-config="prefix=aipla-env/prod"
terraform apply -target=google_project_service.apis -var-file=envs/prod.tfvars   # 15 APIs, review then yes
```

### 2. Create + import the GitHub connection ✋ (inherent OAuth gate)
A 2nd-gen GitHub connection can't be created by Terraform (browser OAuth). In the
**console → Cloud Build → Repositories → 2nd gen** (project `aipla-prod-2026`,
region `europe-north1`): create host connection → GitHub → authorize → name it
**`github-aipla`** (already pre-set in `envs/prod.tfvars`), grant the
`sunholo-data/cphu-aipla-app` repo. Skip "link repository" (Terraform does it).
Verify + import:
```bash
gcloud builds connections describe github-aipla --region=europe-north1 --project=aipla-prod-2026 --format="value(installationState.stage)"   # COMPLETE
terraform import -var-file=envs/prod.tfvars 'google_cloudbuildv2_connection.github' 'projects/aipla-prod-2026/locations/europe-north1/connections/github-aipla'
```

### 3. Set the ADC quota project ✅ (belt-and-braces; `user_project_override` in the providers already covers it)
```bash
gcloud auth application-default set-quota-project aipla-prod-2026
```
Without this (and before the provider fix), `google_identity_platform_config` +
Firebase resources 403 with "requires a quota project".

### 4. Full apply ✅ (four latent bugs fixed in shared TF; no longer bite)
```bash
terraform plan  -var-file=envs/prod.tfvars   # REVIEW — expect ~62 to add, 0 destroy; connection shows no-change (imported)
terraform apply -var-file=envs/prod.tfvars
terraform output   # note runtime SA + artifact registry URL
```
The dev→test apply surfaced (all now fixed in `modules.tf`/`storage.tf`/`firebase.tf`/`versions.tf`): voice `tts_cache_bucket` unwired · curriculum `manage_corpus_via_script` running mid-apply · `storage_bucket_iam_member` `for_each` anti-pattern · identity-platform ADC-quota 403 + perma-diff. The operator-impersonation grant (`admin_operator_members`) is applied here too. ✅

### 5. M3a — pre-deploy secret values ✅ (now one command each)
The backend reads these at startup, so fill them BEFORE the deploy:
```bash
make provision-agent-engine ENV=prod            # AGENT_ENGINE_ID (europe-west1)
make provision-curriculum-rag ENV=prod          # empty RAG corpus + CURRICULUM_RAG_CORPUS_NAME
make copy-docparse-secret FROM=dev TO=prod      # DOCPARSE_API_KEY
```
(Terraform created the secret *shells* + SA accessors; these fill the values.)

### 6. Wire the prod deploy trigger ✅ (done 2026-07-30)
Prod does **not** tag→build like test; it **copy-promotes** the tested artifact
(1.3a). Landed in `infrastructure/env/`:

* `google_project_iam_member.promote_source_reader` (iam.tf) — cross-project
  `roles/artifactregistry.reader` for the target's runtime SA on the SOURCE
  project. The one permission the promote's `copy-backend` step lacked.
* `google_cloudbuild_trigger.prod_release` — **disabled**. It stayed armed after
  the first cut, so `v0.1.2` (2026-07-30) deployed test and prod simultaneously,
  prod running code test had not been verified on. Safe only because nobody was
  on prod yet; not acceptable past the 2026-08-14 pilot start.
* `scripts/promote-env.sh` — now passes `--service-account`. Without it,
  `gcloud builds submit` fell back to the Compute Engine default SA, so the CLI
  and trigger paths ran as **different identities** and the AR grant above would
  have covered only one: promote works from the console, 403s from the CLI.

The `aipla-prod-promote` MANUAL trigger the original TODO called for was
deliberately NOT added — `promote-env.sh` submits `cloudbuild.promote.yaml`
directly, so promotion works without it; the trigger would only add a console
button and a second entry point to keep in sync.

`aipla-prod-sandbox-release` stays tag-fired on purpose: static artefact HTML,
built deterministically from the tag, no tested digest to preserve, and the
promote pipeline does not carry it.

**Validated 2026-07-30** by promoting `v0.1.3` test→prod for real. Prod now runs
`backend@sha256:b3554d99…`, byte-identical to test's `backend:v0.1.3`, pinned by
digest. The first execution surfaced three latent bugs — worth knowing, because
each would have hit whoever ran the first promote under pilot pressure:

1. `copy-backend` called `gcloud artifacts docker images copy`, **a command that
   does not exist** in any SDK version. Now `crane copy` + a digest-equality
   assertion after the hop.
2. `promote-env.sh` passed no `--service-account`, so `gcloud builds submit` ran
   as the Compute Engine default SA while the trigger ran as `aipla-v6@`. Two
   identities for one pipeline means a grant to either leaves the other broken.
3. That SA also needed `storage.objectViewer` on `<project>_cloudbuild` to read
   its own uploaded source tarball — trigger builds fetch source from the repo
   connection and never hit this, so it was CLI-promote-only.

Lesson for the remaining 🔨 rows: "configured" and "works" are different claims.
None of the three was visible by reading the config.

### 7. Deploy prod by promotion ✅ (copy backend digest; rebuild frontend from tag)
```bash
aiplatform deploy promote --from test --to prod --version vX.Y.Z   # or run the aipla-prod-promote trigger
aiplatform deploy status --env test --env prod                     # confirm SAME backend digest
```
Frontend rebuilds from the tag with prod config (Next.js bakes `NEXT_PUBLIC_*`); the empty-`_MCP_SANDBOX_URL` prerender crash is fixed (`??`→`||`), so a sandbox-less prod builds fine. ✅

### 8. M3b — content + join codes
```bash
make seed-demo-codes ENV=prod                   # dynamic URL (fixed) — no placeholder
# Curriculum: CLEARED CONTENT ONLY on prod (copyright gate — B/C textbook + 2010 archive OUT):
#   scripts/seed-curriculum.sh prod "A B C"      # A/B/C læreplan+vejledning are cleared (2026-06-12); needs a teacher token
```
> **Prod ≠ test on content + teachers:** prod enforces the copyright gate (cleared
> only), and teachers authenticate via **UCPH SSO**, not the email `test-teacher@example.dk`
> used on dev/test. Do NOT promote test's corpus (full/uncleared) to prod.

### 9. Verify ✅
```bash
scripts/smoke-deployed.sh prod all              # public 200s + auth 401s (sandbox FAILs until step 10)
make verify-chat-logs GROUP=<code> ENV=prod     # CLI resolves the URL live (fixed) — join→turn→BigQuery
```

### 10. Sandbox + hardening (finish the env)
- Sandbox: deploy `aipla-v01-sandbox` for prod (its trigger is the deferred M1-remainder — 🔨), then set `mcp_sandbox_url` + `frontend_url` in `prod.tfvars` and re-apply.
- Prod hardening: reconsider `--allow-unauthenticated`, add `--min-instances` for pilot cold-start, custom domain/DNS.

## The dev→test friction ledger (what this runbook encodes)

| Friction hit on the test cut | Resolution | Status |
|---|---|---|
| Bare project: only `serviceusage` on | pre-stage all 15 APIs (step 1) | ✅ |
| GitHub connection OAuth is manual | console step + `terraform import` (step 2) | ✋ documented |
| Connection named `github-aipla` (not `sunholo-github`) | `cb_connection` pre-set in `prod.tfvars` | ✅ |
| identitytoolkit ADC-quota 403 | `user_project_override` in providers + set-quota-project | ✅ |
| voice `tts_cache_bucket` unwired → null | fixed in `modules.tf` | ✅ |
| curriculum seed script ran mid-apply | `manage_corpus_via_script=false` | ✅ |
| `storage_bucket_iam_member` for_each anti-pattern | iterate the static set | ✅ |
| identity-platform cosmetic perma-diff | declared disabled email/phone/multi_tenant | ✅ |
| Agent Engine / DOCPARSE were manual gcloud | `make provision-agent-engine` / `copy-docparse-secret` | ✅ |
| operator couldn't impersonate SA (demo codes 403) | `admin_operator_members` in TF | ✅ |
| frontend `new URL("")` crash on empty sandbox URL | `??`→`||` fallback | ✅ |
| `seed-demo-codes.sh` hardcoded `*-placeholder` URL | derive via `gcloud run services describe` | ✅ |
| CLI `http.py` hardcoded `*-placeholder` URL | resolve live via gcloud when default is a placeholder | ✅ |
| prod deploy trigger (copy-promote) | done + VALIDATED 2026-07-30 (v0.1.3 promoted test→prod, digests match) | ✅ |
| sandbox not deployed | still to build (step 10) | 🔨 |

## Related
- [terraform-consolidation.md](../../design/aipla/v1.0.0-pilot/terraform-consolidation.md) (1.3b) + [-sprint.md](../../design/aipla/v1.0.0-pilot/terraform-consolidation-sprint.md)
- [build-once-artifact-promotion.md](../../design/aipla/v1.0.0-pilot/build-once-artifact-promotion.md) (1.3a — the promote model)
- [deployed-urls.md](../deployed-urls.md)
