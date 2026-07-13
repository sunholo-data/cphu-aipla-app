# GCP side effects log

Every manual GCP operation against `aipla-{dev,test,prod}-2026` lands here with the date, the project, the exact command, and the Terraform module (if any) that now owns the same resource going forward.

The promise: when the time comes to bootstrap `aipla-test-2026` or `aipla-prod-2026`, this file plus the modules under `infrastructure/modules/` are enough to do it from scratch — no archaeology in Slack threads or commit messages.

Per [env-promotion-audit.md](env-promotion-audit.md): **manual IAM is a smell, not a goal.** Every entry below should either reference a committed Terraform module or have a `TODO: codify` line — anything else is debt.

---

## 2026-06-26 — Research view owner labels (1.1.5 follow-up) (aipla-dev-2026)

**Feature:** the researcher "Research view" (cross-teacher classes + "All activities")
resolves each owner's raw Firebase uid to a friendly label (display name → email)
via `auth.owner_labels.resolve_owner_labels` → Firebase Admin `auth.get_users`.
**Terraform module:** none yet — `TODO: codify` in the runtime-SA IAM module.

### IAM binding — REQUIRED (runtime SA needs read access to Firebase Auth users)

Symptom without it: the research view shows `Owner: <raw-uid>`; backend logs
`resolve_owner_labels: get_users failed … INSUFFICIENT_PERMISSION`. The Cloud Run
runtime SA can verify ID tokens but cannot READ user records (`firebaseauth.users.get`)
until granted `roles/firebaseauth.viewer`.

```bash
gcloud projects add-iam-policy-binding aipla-dev-2026 \
  --member=serviceAccount:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com \
  --role=roles/firebaseauth.viewer \
  --condition=None
```

`roles/firebaseauth.viewer` is read-only (includes `firebaseauth.users.get` +
`.list`). The code is best-effort: until the binding lands it silently falls back
to the raw uid (no crash), so this grant is what turns uids into names — nothing
else depends on it.

**Status:** NOT YET APPLIED — the agent's `add-iam-policy-binding` call is blocked
by the harness (same as the 2026-06-03 VOICE-PROVIDER entry). **Apply directly (M)**
with the command above.

### Verification (after IAM lands)

```bash
gcloud projects get-iam-policy aipla-dev-2026 \
  --flatten=bindings --format="value(bindings.role)" \
  --filter="bindings.members:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com AND bindings.role:roles/firebaseauth.viewer"
# expect: roles/firebaseauth.viewer
# then reload the teacher Research view → owner shows display name / email, not the uid.
```

### Test/prod promotion

Same binding for each env's runtime SA (`aipla-v6@aipla-{test,prod}-2026`).
`TODO: codify` — add `roles/firebaseauth.viewer` for the runtime SA to the IAM
module so test/prod don't repeat this manual step.

---

## 2026-06-23 — IMG-MAT sprint (activity image materials, 1.1.44) (aipla-dev-2026)

**Sprint:** [IMG-MAT (1.1.44)](../design/aipla/v1.1.0-feedback/activity-image-materials.md)
**Terraform module:** none new — reuses the **existing ADK artifact bucket** (`$ADK_ARTIFACT_BUCKET`, already provisioned + IAM-bound for ADK session artifacts).

### No API enabled, no bucket created, no new IAM

Teacher-attached activity images are stored via the **existing** ADK `GcsArtifactService`
(`adk/session.py` `get_artifact_service()`), under a new **blob-key prefix** in the
same bucket:

```
gs://$ADK_ARTIFACT_BUCKET/aipla/{teacher_uid}/{activity_id}/activity-image:{material_id}.{ext}/{version}
```

The Cloud Run runtime SA already has read/write on this bucket (it reads/writes
ADK session artifacts there), so **no IAM change** was needed. The only ops
prerequisite is that `ADK_ARTIFACT_BUCKET` is set (it is, for the dev backend);
with it unset the code falls back to the in-memory artifact service (local dev).

**Test/prod:** nothing to provision beyond `ADK_ARTIFACT_BUCKET` already being set
for that env's backend (same as ADK session artifacts). No `TODO: codify` — there
is no new resource to codify.

**Retention — RESOLVED (M, 2026-06-23): teacher images stay as long as needed.**
No per-object TTL / lifecycle rule is applied or wanted. The bytes live with the
activity and are removed only on explicit `DELETE` (or future activity-delete).
Nothing to apply on the bucket.

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

---

## 2026-06-12 — CURRICULUM M2 RAG corpus (aipla-dev-2026)

**Sprint:** [CURRICULUM (1.1.25)](../design/aipla/v1.1.0-feedback/curriculum-library.md) M2/M5 — Vertex AI RAG corpus for the curriculum library.
**Terraform module:** [`infrastructure/modules/curriculum-rag/`](../../infrastructure/modules/curriculum-rag/) — owns the durable resources (API, secret container, IAM) + a script bridge for the corpus. Per-env apply table in its README.
**Script (canonical create path):** [`scripts/provision-curriculum-rag.sh`](../../scripts/provision-curriculum-rag.sh) — idempotent, one command per env. Wraps `backend/scripts/bootstrap_rag_corpus.py`.

### What to run (when you have GCP credentials)

One command — enables the API, grants IAM, creates/finds the corpus, writes the secret, wires Cloud Run:

```bash
make provision-curriculum-rag ENV=dev      # or: scripts/provision-curriculum-rag.sh dev
```

This replaces the previous multi-step manual `gcloud` ritual (API enable → bootstrap → secret → Cloud Run env), all of which the script now does idempotently.

### Resources created (codified in the Terraform module)

| Step | Resource |
|---|---|
| API | `aiplatform.googleapis.com` enabled |
| IAM | backend SA `aipla-v6@` → `roles/aiplatform.user` (create corpus + upload + query) |
| Corpus | RagManagedDb corpus, display name `aipla-curriculum-v1` (bootstrap script; provider has no native resource) |
| Secret | `CURRICULUM_RAG_CORPUS_NAME` (container + version holding the resource name) |
| IAM | backend SA → `roles/secretmanager.secretAccessor` on that secret |
| Cloud Run | `aipla-v01-backend` env wired to the secret (`--update-secrets`) when the service exists |

### Notes

- **Backend:** RagManagedDb (managed vector store — no pgvector, ADR-010). Vertex AI handles chunking + embeddings.
- **Region:** `europe-north1` (ADR-007). Vertex AI RAG is available in this region as of 2026-06.
- **Graceful degradation:** if `CURRICULUM_RAG_CORPUS_NAME` is not set, `POST /api/curriculum/ingest` still creates the Firestore metadata record with `docArtifactId=""` (Axiom 5). RAG retrieval (M3) skips unavailable docs; the tutor falls back to ungrounded answers. No errors — so this is safe to defer.
- **Corpus display name:** `aipla-curriculum-v1` — override via `CURRICULUM_RAG_DISPLAY_NAME` (script) / `corpus_display_name` (module) if a second corpus is needed.
- **IAM role:** `roles/aiplatform.user` covers corpus create + RagFile upload + `retrieval_query`. (`roles/aiplatform.ragCorpusEditor` exists in some catalogues but `aiplatform.user` is the reliable superset.)

### Test/prod promotion

`terraform apply` the module per env (durable infra + corpus bridge):

```hcl
# envs/{test,prod}/main.tf
module "curriculum_rag" {
  source                        = "../../modules/curriculum-rag"
  project_id                    = "aipla-${env}-2026"
  env                           = "${env}"
  backend_service_account_email = "aipla-v6@aipla-${env}-2026.iam.gserviceaccount.com"
}
```

…or run `scripts/provision-curriculum-rag.sh {test,prod}` directly (same end state — the script IS the corpus bridge the module's `null_resource` invokes). The module's per-env apply table tracks which envs are bootstrapped.

---

## 2026-06-15 — anonymous-group session clean slate (dev Firestore data wipe)

**What:** deleted all documents in `group_sessions` (16) + `chat_sessions` (256)
in `aipla-dev-2026` Firestore. `anon_groups` (5 group codes) preserved.

**Why:** the 2026-06-13 stable-per-group-uid change (`_synthesize_uid` →
`anon-<group>`, dropping the old random suffix) orphaned pre-existing group
sessions: the group→session pointer is first-wins / 30-day-TTL, so reused
codes kept resuming a session whose frozen `owner_uid` was the OLD scheme,
while live students read/wrote under the new uid — so saved turns were
unreadable (`GET /sessions/{id}/messages` queries Vertex under the stale
`owner_uid`). No history worth preserving, so a clean slate was chosen over a
migration. Post-wipe every code starts a fresh session owned by the current
stable uid → history persists and displays.

**How (repeatable):** `make reset-group-state ENV=dev SESSIONS=1`
(= `scripts/reset-group-state.sh dev --sessions`). Needs gcloud Firestore
write (`datastore.user`). Add `GROUPS=1` to also wipe `anon_groups` (invalidates
all codes).

**Not deleted:** the ADK event store in Agent Engine (Vertex sessions) — those
orphan harmlessly; new sessions create new Vertex sessions. Only the Firestore
mirror + pointers were cleared.

**Test/prod:** if the same uid-scheme orphaning is ever observed there, run
`make reset-group-state ENV=<env> SESSIONS=1`. Better: land the auto-heal fix
(archive a pointer when its session's `owner_uid != _synthesize_uid(group_id)`)
so it self-heals without a manual wipe.

---

## 2026-07-13 — Rubric run store + BQ mirror (RUBRIC-2 M3) (aipla-dev-2026)

**Feature:** every competency-rubric score (RUBRIC-2) writes a provenance record
to Firestore `rubric_runs/{run_id}` and mirrors it to BigQuery. New Firestore
collections created implicitly on first write (no schema step): `rubric_defs`
(+ inline `versions` map), `rubric_runs`. No IAM change — same backend SA,
same `datastore.user`.

**New BigQuery table:** `chat_logs.aipla_rubric_run`, auto-created by the existing
`aipla-chat-logs` Log Router sink once the backend emits under the new log id
`aipla_rubric_run` (`observability/chat_log.py`). Requires the sink FILTER to
include the new log id, or rows are dropped silently.

**Terraform module:** `infrastructure/modules/chat-logs/` — `variables.tf`
`log_filter` default now includes `rubric_run`; no new resource (the sink
auto-creates the partitioned table under the dataset's default retention).

**How (repeatable):**
- Terraform-managed envs: `terraform apply` the `chat-logs` module (the filter
  change converges the existing sink; the table appears on first emit).
- Dev bootstrap script parity: `scripts/bootstrap-aipla-dev.sh` `sink_filter`
  updated to the same `aipla_(chat_turn|workbench_event|voice_cost|rubric_run)$`
  regex; re-running the bootstrap converges the live sink filter.

**Test/prod:** re-apply the `chat-logs` module (or re-run the bootstrap sink
step) before the first rubric score, so `aipla_rubric_run` rows aren't dropped.
No manual `bq mk` needed — the sink creates the table.
