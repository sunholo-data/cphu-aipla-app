# `voice` terraform module

GCP preconditions for the voice provider abstraction — Cloud TTS + Cloud STT API enablement, the TTS cache bucket, and the backend-SA IAM bindings.

- **Design doc:** [voice-provider-abstraction.md](../../../docs/design/aipla/v1.1.0-feedback/voice-provider-abstraction.md) (SEQUENCE 1.1.11)
- **Parent doc:** [audio-capture-and-tts.md](../../../docs/design/aipla/v1.0.0-pilot/audio-capture-and-tts.md)
- **ADRs:** 003 (four-tier model — voice mirrors LLM tier swap), 005 (data residency — europe-north1)

## What it creates

| Resource | Purpose |
|---|---|
| `google_project_service.texttospeech` | Enables `texttospeech.googleapis.com`. Backend voice provider returns 403 from synthesize() until enabled. |
| `google_project_service.speech` | Enables `speech.googleapis.com`. Same shape for STT. |
| `google_storage_bucket.tts_cache` | TTS cache bucket in `europe-north1`. Uniform bucket-level access, public-access prevention, 90-day object lifecycle. Backend's `voice/cache.py` writes content-hash-keyed audio blobs here. |
| `google_project_iam_member.backend_speech_client` | `aipla-v6@` → `roles/speech.client` (project-scoped). Lets the SA call `recognize()`. |
| `google_storage_bucket_iam_member.backend_tts_cache_admin` | `aipla-v6@` → `roles/storage.objectAdmin` on the cache bucket ONLY. SA can read/write within this bucket; cannot list other buckets or create new ones. |

## Important: no Cloud TTS IAM role

Cloud Text-to-Speech does **not** expose a caller-IAM role like `roles/cloudtts.user` (that role does not exist as of 2026-06-03 — verified `gcloud iam roles describe`). The gate is project-level API enablement plus the SA having a valid identity. So this module enables the API and grants the cache-bucket role, but does **not** grant any TTS-specific role to the SA.

If a future Cloud TTS release adds a caller-IAM role, add it here, then revoke any equivalent broad role elsewhere.

## Per-env usage

```hcl
# envs/dev/main.tf  (or applied manually for dev per the 2026-06-03 bootstrap below)
module "voice" {
  source                        = "../../modules/voice"
  project_id                    = "aipla-dev-2026"
  env                           = "dev"
  backend_service_account_email = "aipla-v6@aipla-dev-2026.iam.gserviceaccount.com"
}

# envs/test/main.tf
module "voice" {
  source                        = "../../modules/voice"
  project_id                    = "aipla-test-2026"
  env                           = "test"
  backend_service_account_email = "aipla-v6@aipla-test-2026.iam.gserviceaccount.com"
}

# envs/prod/main.tf
module "voice" {
  source                        = "../../modules/voice"
  project_id                    = "aipla-prod-2026"
  env                           = "prod"
  backend_service_account_email = "aipla-v6@aipla-prod-2026.iam.gserviceaccount.com"
}
```

The bucket name defaults to `${project_id}-tts-cache` so per-env buckets are unique without explicit naming.

## Backend env vars

After applying, the backend Cloud Run service needs:

```
VOICE_TTS_CACHE_BUCKET=aipla-{env}-2026-tts-cache
VOICE_TTS_PROVIDER=gcp_wavenet   # or browser to disable backend TTS for an env
VOICE_STT_PROVIDER=gcp_latest_long
```

(Per-skill overrides in `SkillConfig.voice.tts_provider` / `stt_provider`.)

## Bootstrap history

| Env | Apply date | Method | Notes |
|---|---|---|---|
| `aipla-dev-2026` | 2026-06-03 | Manual `gcloud` + this module committed retrospectively | M0 of VOICE-PROVIDER sprint. APIs enabled, bucket created with 90d lifecycle, IAM grants for Speech client + bucket objectAdmin applied via gcloud. Module written same day so test/prod is `terraform apply`. See `docs/ops/gcp-side-effects.md`. |
| `aipla-test-2026` | (pending) | `terraform apply` via this module | Apply when promotion to test is scoped. |
| `aipla-prod-2026` | (pending) | `terraform apply` via this module | Apply when promotion to prod is scoped. Calibrate `tts_cache_lifecycle_days` to consent form / DPIA at that point. |

## Verifying after apply

```bash
gcloud services list --enabled --project=aipla-${env}-2026 \
  --filter="config.name:(texttospeech.googleapis.com OR speech.googleapis.com)" \
  --format="value(config.name)"
# expect both lines

gcloud storage buckets describe gs://aipla-${env}-2026-tts-cache \
  --project=aipla-${env}-2026 \
  --format="value(lifecycle.rule[0].condition.age)"
# expect: 90

gcloud projects get-iam-policy aipla-${env}-2026 \
  --flatten="bindings[].members" \
  --filter="bindings.members:aipla-v6@aipla-${env}-2026.iam.gserviceaccount.com AND bindings.role:roles/speech.client" \
  --format="value(bindings.role)"
# expect: roles/speech.client
```
