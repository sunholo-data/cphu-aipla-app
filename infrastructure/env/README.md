# `infrastructure/env` — per-env Terraform root (test/prod provisioning)

Cuts a complete AIPLA environment by `terraform apply` with a per-env tfvars.
Implements the decision in
[`docs/design/aipla/v1.0.0-pilot/env-promotion-dev-test-prod.md`](../../docs/design/aipla/v1.0.0-pilot/env-promotion-dev-test-prod.md):
**dev stays imperative (`scripts/bootstrap-aipla-dev.sh`); test/prod are
Terraform-only.** This root composes the existing
[`../modules/{chat-logs,curriculum-rag,voice}`](../modules/) and adds everything
else the dev bootstrap script does.

## Source of truth

`scripts/bootstrap-aipla-dev.sh` is the imperative inventory this module
reproduces. When that script changes, mirror the change here.

## What Terraform owns vs what scripts own

| dev `ensure_*` | Here? | Resource(s) |
|---|---|---|
| `ensure_apis` | ✅ | `apis.tf` (15 `google_project_service`) |
| `ensure_sa` | ✅ | `iam.tf` (SA + 13 `google_project_iam_member`) |
| `ensure_firestore` | ✅ | `firestore.tf` |
| `ensure_chat_logs` | ✅ | `module.chat_logs` |
| `ensure_artifact_registry` | ✅ | `artifact_registry.tf` |
| `ensure_config_bucket` / `ensure_runtime_buckets` / `ensure_research_audio_bucket` | ✅ | `storage.tf` (TTS cache → `module.voice`) |
| `ensure_group_auth_signing_secret` | ✅ | `secrets.tf` (`random_id` value) |
| `ensure_docparse_api_key_secret` | ✅ | `secrets.tf` (placeholder; operator fills) |
| `ensure_agent_engine` (secret shell) | ✅ | `secrets.tf` (`AGENT_ENGINE_ID` shell) |
| curriculum RAG secret shell | ✅ | `module.curriculum_rag` |
| `ensure_firebase_anonymous_auth` | ⏳ inc. 2 | `firebase.tf` (`google_identity_platform_config`) |
| `ensure_firebase_web_app_and_secret` | ⏳ inc. 2 | `firebase.tf` (`google_firebase_web_app` + `FIREBASE_ENV`) |
| `ensure_cb_repository` / `ensure_cb_service_agent` | ⏳ inc. 2 | `cloudbuild.tf` |
| `ensure_cb_trigger` / `ensure_mcp_sandbox_trigger` | ⏳ inc. 2 | `cloudbuild.tf` |

**Increment 1 (this commit):** the foundation above — validated, no GCP mutation.
**Increment 2 (next):** Firebase (google-beta) + Cloud Build triggers — the
schema-riskiest resources; authored after a real `terraform plan` against an
enabled `test` project so the provider schemas are verified, not guessed.

### Never Terraform (scripted post-apply — see `outputs.tf` `post_apply_todo`)

- **Agent Engine** reasoning-engine (no TF resource) → `backend/scripts/bootstrap_agent_engine.py` writes the `AGENT_ENGINE_ID` version. `europe-west1`.
- **Curriculum RAG corpus** → `scripts/provision-curriculum-rag.sh` writes `CURRICULUM_RAG_CORPUS_NAME`. `europe-west1`. **Seed CLEARED (A-level) content only.**
- **Real `DOCPARSE_API_KEY`** value (external key).
- **Platform skill seed** (`make seed ENV=<env>`) + **demo codes**.

## Preconditions (manual, per `verify_prereqs`)

Project exists + billing linked; Cloud Build GitHub connection (`sunholo-github`)
installed + COMPLETE in the project/region; Firebase added to the project;
`serviceusage.googleapis.com` enabled (so TF can enable the rest); the
`terraform init` actor has owner/editor + `serviceAccountTokenCreator` as needed.

## State backend

Partial `backend "gcs"` (`versions.tf`). One state bucket, per-env prefix:

```bash
terraform init \
  -backend-config="bucket=<tf-state-bucket>" \
  -backend-config="prefix=aipla-env/test"
```

**Decision pending:** which bucket holds state (a dedicated `aipla-tfstate`
bucket vs an existing ops bucket). Create it before first `init`.

## Runbook — cut `test`

```bash
cd infrastructure/env
# 0. Preconditions above. Enable serviceusage on aipla-test-2026 first.
terraform init -backend-config="bucket=<state>" -backend-config="prefix=aipla-env/test"
terraform plan  -var-file=envs/test.tfvars      # REVIEW before apply
terraform apply -var-file=envs/test.tfvars
# Post-apply (scripted, not TF) — see outputs.tf post_apply_todo:
#   bootstrap_agent_engine.py · provision-curriculum-rag.sh (cleared content) ·
#   populate DOCPARSE_API_KEY · make seed ENV=test · mint demo codes
# Then promote code: git checkout test && git merge --ff-only dev && git push origin test
#   → the (increment-2) test deploy trigger builds + deploys, gated by ci-gate-*.
terraform output   # frontend URL → set frontend_url in test.tfvars, re-apply (sandbox origin)
```

## Notes

- **Duplicate APIs are intentional & harmless.** Root enables the full list with
  `disable_on_destroy = false`; the composed modules also enable their specific
  APIs (aiplatform, bigquery, texttospeech, speech). Both idempotently enable;
  neither disables. No conflict.
- **dev parity:** `envs/dev.tfvars` exists only to `plan` against dev for
  drift-checking. Do **not** `apply` against dev — that would adopt live,
  script-managed resources.
- **`teacher_mock` is dev-only.** test/prod tfvars set it `false`.
