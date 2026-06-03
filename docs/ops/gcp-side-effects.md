# GCP side effects log

Every manual GCP operation against `aipla-{dev,test,prod}-2026` lands here with the date, the project, the exact command, and the Terraform module (if any) that now owns the same resource going forward.

The promise: when the time comes to bootstrap `aipla-test-2026` or `aipla-prod-2026`, this file plus the modules under `infrastructure/modules/` are enough to do it from scratch — no archaeology in Slack threads or commit messages.

Per [env-promotion-audit.md](env-promotion-audit.md): **manual IAM is a smell, not a goal.** Every entry below should either reference a committed Terraform module or have a `TODO: codify` line — anything else is debt.

---

## 2026-06-03 — VOICE-PROVIDER sprint M0 (aipla-dev-2026)

**Sprint:** [VOICE-PROVIDER (1.1.11)](../design/aipla/v1.1.0-feedback/voice-provider-abstraction.md)
**Terraform module:** [`infrastructure/modules/voice/`](../../infrastructure/modules/voice/) — produces an identical end state when applied to test/prod.

### APIs enabled

```bash
gcloud services enable texttospeech.googleapis.com --project=aipla-dev-2026
gcloud services enable speech.googleapis.com       --project=aipla-dev-2026
```

Both succeeded 2026-06-03. Idempotent. `disable_on_destroy = false` in the Terraform module — these stay on across `terraform destroy`.

### Cache bucket created

```bash
gcloud storage buckets create gs://aipla-dev-2026-tts-cache \
  --project=aipla-dev-2026 \
  --location=europe-north1 \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update gs://aipla-dev-2026-tts-cache \
  --project=aipla-dev-2026 \
  --lifecycle-file=infrastructure/gcs-lifecycle-90d.json
```

Bucket exists, region `europe-north1` (ADR-005), 90-day lifecycle applied. Terraform module owns the equivalent shape via `google_storage_bucket.tts_cache`.

### IAM bindings — APPLIED 2026-06-03 (M directly)

Sprint plan originally referenced `roles/cloudtts.user` for TTS and `roles/speech.client` for STT. **Sprint-plan drift discovered:** `roles/cloudtts.user` does not exist (`gcloud iam roles describe roles/cloudtts.user` → 404). Cloud TTS has no caller-IAM role; API enablement + a valid identity is the gate. Only STT and the bucket scope need bindings.

Backend SA in this project is `aipla-v6@aipla-dev-2026.iam.gserviceaccount.com` (not `aipla-v6-backend@` as the sprint plan assumed — also corrected).

**Commands to run** (these are the canonical commands the Terraform module produces; until terraform is wired per-env, applying them manually here keeps dev in sync):

```bash
gcloud projects add-iam-policy-binding aipla-dev-2026 \
  --member=serviceAccount:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com \
  --role=roles/speech.client \
  --condition=None

gcloud storage buckets add-iam-policy-binding gs://aipla-dev-2026-tts-cache \
  --member=serviceAccount:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

**Status:** APPLIED 2026-06-03 by M directly (harness blocked the `add-iam-policy-binding` calls from the agent). Verified via `gcloud projects get-iam-policy` and `gcloud storage buckets get-iam-policy`:

```
roles/speech.client       -> serviceAccount:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com
roles/storage.objectAdmin -> serviceAccount:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com   (bucket-scoped: gs://aipla-dev-2026-tts-cache)
```

### Verification (run after IAM lands)

```bash
gcloud projects get-iam-policy aipla-dev-2026 \
  --flatten="bindings[].members" \
  --filter="bindings.members:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com AND bindings.role:roles/speech.client" \
  --format="value(bindings.role)"
# expect: roles/speech.client

gcloud storage buckets get-iam-policy gs://aipla-dev-2026-tts-cache \
  --flatten="bindings[].members" \
  --filter="bindings.members:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com" \
  --format="value(bindings.role)"
# expect: roles/storage.objectAdmin
```

### Test/prod promotion

When promoting to test or prod, **do not repeat these gcloud commands**. Instead:

```hcl
# envs/{test,prod}/main.tf
module "voice" {
  source                        = "../../modules/voice"
  project_id                    = "aipla-${env}-2026"
  env                           = "${env}"
  backend_service_account_email = "aipla-v6@aipla-${env}-2026.iam.gserviceaccount.com"
}
```

Then `terraform init && terraform apply`. The module's per-env apply table in [infrastructure/modules/voice/README.md](../../infrastructure/modules/voice/README.md) tracks which envs are bootstrapped.
