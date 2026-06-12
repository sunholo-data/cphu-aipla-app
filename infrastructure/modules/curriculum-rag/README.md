# `curriculum-rag` terraform module

GCP preconditions for the curriculum library's RAG layer — Vertex AI API enablement, the `CURRICULUM_RAG_CORPUS_NAME` secret, the backend-SA IAM bindings, and (via a script bridge) the RagManagedDb corpus itself.

- **Design doc:** [curriculum-library.md](../../../docs/design/aipla/v1.1.0-feedback/curriculum-library.md) (SEQUENCE 1.1.25, M2/M5)
- **ADRs:** 004 (AILANG Parse — deterministic ingestion), 010 (RAG), 005/007 (data residency / region — europe-north1)
- **Side-effects log:** [docs/ops/gcp-side-effects.md](../../../docs/ops/gcp-side-effects.md) → CURRICULUM M2 entry

## What it creates

| Resource | Purpose |
|---|---|
| `google_project_service.aiplatform` | Enables `aiplatform.googleapis.com`. Ingestion/retrieval error until enabled; the backend degrades to metadata-only meanwhile. |
| `google_project_iam_member.backend_aiplatform_user` | `aipla-v6@` → `roles/aiplatform.user` (project-scoped). Create corpus + upload RagFiles + `retrieval_query`. |
| `google_secret_manager_secret.corpus_name` | The `CURRICULUM_RAG_CORPUS_NAME` secret container (automatic replication). The backend reads its value as an env var. |
| `google_secret_manager_secret_iam_member.backend_corpus_name_accessor` | `aipla-v6@` → `roles/secretmanager.secretAccessor` on that secret ONLY. SA reads the corpus name at runtime; no project-wide secret access. |
| `null_resource.corpus` (bridge) | Runs `scripts/provision-curriculum-rag.sh` to create the RagManagedDb corpus + write the secret version. Skipped when `manage_corpus_via_script = false`. |

## Important: no native Vertex RAG corpus resource

The hashicorp/google provider has **no** Vertex AI RAG corpus resource (as of provider 5/6.x). So Terraform owns the durable, codifiable pieces (API, secret container, IAM), and the corpus — plus the secret *version* holding its resource name, which isn't known until creation — is created by [`scripts/provision-curriculum-rag.sh`](../../../scripts/provision-curriculum-rag.sh) (wrapping the idempotent [`backend/scripts/bootstrap_rag_corpus.py`](../../../backend/scripts/bootstrap_rag_corpus.py)).

A `null_resource` invokes that script on apply so a single `terraform apply` fully provisions an env. The apply host needs `gcloud` + `uv`. If a future provider release adds a native resource, switch `manage_corpus_via_script = false` and add the resource here.

## Dev vs test/prod

**Dev is provisioned by the script, not Terraform** — AIPLA dev is a hand-deployed
scratchpad (no per-env Terraform workspaces are cut yet). Run:

```bash
make provision-curriculum-rag ENV=dev    # scripts/provision-curriculum-rag.sh dev
```

**This module is the codified recipe for `aipla-test-2026` / `aipla-prod-2026`** —
applied with `terraform apply` when those projects are stood up, so promotion is
reproducible instead of a manual `gcloud` ritual (mirrors the `voice` module).

## Per-env usage (test/prod)

```hcl
# envs/test/main.tf
module "curriculum_rag" {
  source                        = "../../modules/curriculum-rag"
  project_id                    = "aipla-test-2026"
  env                           = "test"
  backend_service_account_email = "aipla-v6@aipla-test-2026.iam.gserviceaccount.com"
}

# envs/prod/main.tf
module "curriculum_rag" {
  source                        = "../../modules/curriculum-rag"
  project_id                    = "aipla-prod-2026"
  env                           = "prod"
  backend_service_account_email = "aipla-v6@aipla-prod-2026.iam.gserviceaccount.com"
}
```

## Backend env var

After apply, the backend reads the corpus name from the secret. Wire it into the Cloud Run service (the provision script does this automatically when the service exists):

```
CURRICULUM_RAG_CORPUS_NAME  ← secret CURRICULUM_RAG_CORPUS_NAME:latest
```

Absent → the backend stores curriculum metadata only (empty `docArtifactId`), retrieval returns nothing, and the tutor falls back to ungrounded answers (Axiom 5). No errors.

## Script-only path (no Terraform)

The same provisioning is available standalone — useful for dev or before the per-env Terraform workspaces are cut:

```bash
scripts/provision-curriculum-rag.sh dev      # or test / prod
make provision-curriculum-rag ENV=dev        # equivalent
```

## Bootstrap history

| Env | Apply date | Method | Notes |
|---|---|---|---|
| `aipla-dev-2026` | (pending) | `scripts/provision-curriculum-rag.sh dev` or `terraform apply` | Needs gcloud auth as project owner + `roles/aiplatform.user` grantable. Until run, curriculum is metadata-only (graceful). |
| `aipla-test-2026` | (pending) | `terraform apply` via this module | Apply when promotion to test is scoped. |
| `aipla-prod-2026` | (pending) | `terraform apply` via this module | Apply when promotion to prod is scoped. Confirm region/residency + corpus-size limits against the DPIA at that point. |

## Verifying after apply

```bash
gcloud services list --enabled --project=aipla-${env}-2026 \
  --filter="config.name:aiplatform.googleapis.com" --format="value(config.name)"
# expect: aiplatform.googleapis.com

gcloud secrets versions access latest --secret=CURRICULUM_RAG_CORPUS_NAME --project=aipla-${env}-2026
# expect: projects/.../locations/europe-north1/ragCorpora/<id>

gcloud projects get-iam-policy aipla-${env}-2026 \
  --flatten="bindings[].members" \
  --filter="bindings.members:aipla-v6@aipla-${env}-2026.iam.gserviceaccount.com AND bindings.role:roles/aiplatform.user" \
  --format="value(bindings.role)"
# expect: roles/aiplatform.user
```

End-to-end smoke (CLI, M5): `aiplatform curriculum query "energibevarelse" --level B --env <env>` should return chunks once docs are ingested.
