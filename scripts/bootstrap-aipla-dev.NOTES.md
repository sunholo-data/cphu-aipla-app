# `bootstrap-aipla-dev.sh` — recipes and side-effect log

Companion to `bootstrap-aipla-dev.sh`. Captures **everything that happened on
`aipla-dev-2026`** during M0 of JUTLAND-V01 sprint that isn't already encoded
as a step in the script — manual UI clicks, side-effects from ad-hoc commands,
implicit resource creations, IAM cascades.

> **Purpose:** [SEQUENCE.md 1.1 `aipla-cloud-bootstrap.md`](../docs/design/aipla/SEQUENCE.md)
> will Terraformise this work for `aipla-test-2026` + `aipla-prod-2026`. Treat
> every entry below as a checklist item the TF module must either reproduce or
> explicitly skip-with-justification.
>
> Discipline driver: [feedback-record-side-effects](../.claude/projects/.../memory/feedback_record_side_effects.md).

Append entries chronologically, newest at the bottom.

---

## 2026-05-20 — M0 prerequisites (manual, pre-script)

### Manual one-time setup (NOT in the script, must be done before each new env)

1. **GCP project creation + billing link**
   - `aipla-dev-2026` was created 2026-05-18 (before this session), owner `m@sunholo.com`, billing account `01A211-266D3F-D96890`.
   - **For test/prod TF:** `google_project` + `google_billing_account` resources; billing-account ID lifted from a `var.billing_account` input.

2. **Cloud Build GitHub App install + connection** (user did manually 2026-05-20)
   - Installed "Google Cloud Build" GitHub App on `sunholo-data` org with access to `cphu-aipla-app`. URL: <https://github.com/apps/google-cloud-build>
   - Created Cloud Build connection `sunholo-github` in `europe-north1`, state `COMPLETE`.
   - **For test/prod TF:** the GitHub App install is org-wide (one-time, not per-project). The connection resource is `google_cloudbuildv2_connection` — Terraform-able. Repository link (`google_cloudbuildv2_repository`) is also TF-able.

3. **Firebase added to project** (user did manually 2026-05-20)
   - Converted `aipla-dev-2026` to a Firebase project via <https://console.firebase.google.com/> → "Add project" → select existing GCP project.
   - **For test/prod TF:** `google_firebase_project` resource. Requires `firebase.googleapis.com` enabled first, which is automatic when "adding to Firebase" through the console; for TF, enable explicitly first.

### Deferred (not done on dev; revisit pre-pilot)

4. **Vertex AI Data Residency org-policy**
   - User direction 2026-05-20: defer until impact on other sunholo.com org projects is reviewed.
   - **For test/prod TF:** before pilot, either set `google_org_policy_policy` constraining `gcp.resourceLocations` to EU-only at the AIPLA folder level, or document the residual gap with UCPH data-protection sign-off.

---

## 2026-05-20 — Side effects during ad-hoc inventory probes

### Side effect 1: `gcloud firestore locations list` enables `firestore.googleapis.com`

- **Command:** `gcloud firestore locations list --project=aipla-dev-2026`
- **What happened:** initial run errored with `API not enabled`, prompted to enable, we ran `gcloud services enable firestore.googleapis.com --project=aipla-dev-2026` to proceed.
- **Side effect:** Firestore API now enabled on the project.
- **Captured by script?** Yes — `ensure_apis()` lists `firestore.googleapis.com` and re-enabling is a no-op.
- **For test/prod TF:** `google_project_service` resource for `firestore.googleapis.com`. Must come before any `google_firestore_database` resource.

### Side effect 2: Verifying Cloud Build connection (read-only — no effect)

- **Command:** `gcloud builds connections list --region=europe-north1 --project=aipla-dev-2026`
- **What happened:** returned `sunholo-github` connection in `COMPLETE` state.
- **Side effect:** none — read-only.
- **Worth noting:** `gcloud builds connections describe ... --format='value(installationState.stage)'` is the right query for scripted checks because the human-friendly `list` output drifts; the script uses the verbose form.

### Side effect 3: Listing Firebase projects (read-only — no effect)

- **Command:** `firebase projects:list`
- **What happened:** confirmed `aipla-dev-2026` appears, "Resource Location ID: [Not specified]".
- **Side effect:** none — read-only.
- **Implication:** the "Resource Location ID" field is set by the *first* `gcloud firestore databases create` call (because Firestore default DB location pins this project-level default). After `ensure_firestore()` runs in M0, this field will say `europe-north1`.

---

## (entries appended during the actual `bootstrap-aipla-dev.sh` first run go below this line)

### Side effect 4 / gotcha — IAM eventual-consistency race after SA create

- **What happened on 2026-05-20 ~10:12:00:** Script created `aipla-v6@aipla-dev-2026` SA, then immediately tried `gcloud projects add-iam-policy-binding` for the first role and got `Service account ... does not exist` — even though `gcloud iam service-accounts create` had just returned success two seconds earlier.
- **Root cause:** GCP IAM is globally replicated with eventual consistency; a freshly-created SA is visible on the *describe* path before it's visible to the *policy modification* path. Window is usually 5–15s.
- **Mitigation in this script:** after `service-accounts create`, poll `describe` until it returns success 3 times in a row (capped at 40s wait), then bind roles with a 5-attempt exponential backoff (3s, 6s, 9s, 12s, 15s).
- **For test/prod TF:** Terraform's `google_service_account` + `google_project_iam_member` resources have implicit dependencies, but Terraform users have reported the same race. Standard fix: `time_sleep` resource between SA creation and binding, or wrap bindings in a `retry { ... }` block. Document explicitly in the TF module.
- **Capture in script?** ✅ yes — `ensure_sa()` now polls + retries.

### Side effect 5 / gotcha — Cloud Build repository link needs GitHub App per-repo grant

- **What happened on 2026-05-20 ~10:13:43:** `gcloud builds repositories create cphu-aipla-app ...` failed with `the authorized user doesn't have the admin permission to repo sunholo-data/cphu-aipla-app`. The connection (`sunholo-github`) was COMPLETE and visible, but registering the specific repo against it bounced.
- **Root cause hypothesis:** the Google Cloud Build GitHub App is installed on the `sunholo-data` org with a *selected-repos* allowlist that did not include `cphu-aipla-app`. Even though the connection exists, GCP needs the App to have access to the specific repo before registering it.
- **Alternative cause:** the gcloud user (`m@sunholo.com`) does not have a linked GitHub identity with admin on this repo (only `MarkEdmondson1234` does, per the earlier permissions probe).
- **Fix attempted on dev:** **(user action)** in <https://github.com/organizations/sunholo-data/settings/installations> → Google Cloud Build → Configure → grant access to `cphu-aipla-app` (or use "All repositories").
- **For test/prod TF:** The connection + repository resources are Terraform-able (`google_cloudbuildv2_connection`, `google_cloudbuildv2_repository`). But the GitHub App installation step + per-repo allowlist is **not** TF-able — it's a one-time manual GitHub-side configuration. Document explicitly in 1.1 as a manual prereq.
- **Capture in script?** ⚠️ partial — script attempts the create, fails loudly if permission missing, with a helpful error message pointing at the GitHub App config URL. To add: pre-check via `gh api` to detect installation+repo coverage before running gcloud.

### Side effect 6 / gotcha — voight-kampff needed admin (not push) for CB repository registration

- **What happened on 2026-05-20 ~10:18:33:** `gcloud builds repositories create cphu-aipla-app` failed with `the authorized user doesn't have the admin permission to repo sunholo-data/cphu-aipla-app`.
- **Root cause:** the Cloud Build connection (`sunholo-github`) was created with `sunholo-voight-kampff` as the OAuth authoriser. voight-kampff only had `push` on the repo. Cloud Build v2 repository-create needs the authorising GitHub user to have `admin` on the specific repo (it sets up webhooks server-side).
- **Fix on dev:** **(user-approved 2026-05-20)** promoted `sunholo-voight-kampff` from push → admin on `cphu-aipla-app` via `gh api -X PUT repos/sunholo-data/cphu-aipla-app/collaborators/sunholo-voight-kampff -f permission=admin` (executed as MarkEdmondson1234, who has org-admin). User memory `user-role.md` was created saying voight-kampff is the AIPLA push account — this elevates that single repo to admin while keeping push-only on other sunholo-data repos.
- **For test/prod TF:** the `google_cloudbuildv2_connection.authorizer_credential` field needs an OAuth token whose underlying GitHub user has admin on each repo the connection will register. Document in 1.1: either (a) use a GitHub bot account with admin on the AIPLA-Labs repos OR (b) bump voight-kampff to admin on AIPLA-Labs repos before TF run.
- **Capture in script?** ❌ no — this is a one-time GitHub-side permission grant, not scriptable from inside the gcloud bootstrap.

### Side effect 7 / gotcha — new GCP projects have no legacy Cloud Build SA; triggers MUST specify `--service-account`

- **What happened on 2026-05-20 ~10:18:33 → ~10:20:52:** `gcloud beta builds triggers create github` failed with `INVALID_ARGUMENT: Request contains an invalid argument.` — opaque error, no field info. Same payload via direct REST API (`POST /v1/projects/.../triggers`) returned the same generic 400. Took five tries varying flags, payload shapes, and substitution sets before isolating.
- **Root cause:** post-2024 GCP projects no longer auto-provision the legacy Cloud Build service account (`{PROJECT_NUMBER}@cloudbuild.gserviceaccount.com`). New trigger creates that don't specify an explicit `serviceAccount` field fail validation because Cloud Build can't pick a default. Confirmed: `gcloud iam service-accounts list --filter='email:cloudbuild'` returned nothing for `aipla-dev-2026`.
- **Fix on dev:** specify `--service-account=projects/${PROJECT}/serviceAccounts/aipla-v6@...` on the trigger, AND ensure the Cloud Build service agent (`service-${PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com`) has `roles/iam.serviceAccountUser` on `aipla-v6@` so it can impersonate it during builds.
- **Implicit side effects of the fix:**
  - `gcloud beta services identity create --service=cloudbuild.googleapis.com` materialises the Cloud Build service agent (auto-created on first use of certain APIs, but to be safe we force it).
  - Granting `iam.serviceAccountUser` on `aipla-v6@` to the CB service agent.
- **For test/prod TF:** Critical for `aipla-{test,prod}-2026`. Add `google_project_service_identity.cloudbuild` resource, then `google_service_account_iam_member` granting `roles/iam.serviceAccountUser` to the CB service agent. Every `google_cloudbuild_trigger` resource in TF must set `service_account = "projects/.../serviceAccounts/aipla-v6@..."`. Document this as a *load-bearing* gotcha — the failure mode is a deceptively opaque INVALID_ARGUMENT.
- **Capture in script?** ✅ yes — new `ensure_cb_service_agent()` step + `--service-account` on the trigger create.

### Side effect 8 — gcloud-vs-curl observation

- **What happened:** When debugging the trigger INVALID_ARGUMENT, switched from `gcloud beta builds triggers create` to a direct `curl POST /v1/.../triggers` to get a more detailed error. **The curl response was identical** — Cloud Build's API returns the same generic 400 either way.
- **Lesson:** `gcloud` is the right tool here; the API doesn't give a more detailed error to direct REST callers. The script uses gcloud throughout.
- **For test/prod TF:** Terraform's `google_cloudbuild_trigger` provider wraps the same API, so the same opaque 400 can surface. The fix (set `service_account` explicitly) is the same.

## 2026-05-21 — MCP sandbox second-service deploy

### Decision 9 — MCP App sandbox runs as a SEPARATE Cloud Run service (`aipla-v01-sandbox`)

- **What:** Created Cloud Build trigger `aipla-mcp-sandbox-deploy` that watches push to `dev` AND change inside `infrastructure/mcp-sandbox/**`. On match, builds `infrastructure/mcp-sandbox/Dockerfile` → pushes to `europe-north1-docker.pkg.dev/aipla-dev-2026/cphu/aipla-v01-sandbox:dev` → deploys to Cloud Run as `aipla-v01-sandbox`.
- **Why a separate service** (vs sidecar / same-service): ADR-013 mandates the sandbox iframe runs on a **different origin** from the host frontend so `allow-same-origin` on the inner iframe never leaks host cookies. Sidecars share the ingress origin → defeats the security model. Sandbox MUST be its own `*.run.app` URL.
- **Substitutions captured by the trigger** (these become Terraform locals for test/prod):
  - `_PROJECT_ID=aipla-dev-2026`
  - `_REGION=europe-north1`
  - `_ARTIFACT_REGISTRY_REPO_URL_CLIENT=europe-north1-docker.pkg.dev/aipla-dev-2026/cphu` (reuses the `cphu` AR repo created in M0)
  - `_LOGS_BUCKET=gs://aipla-dev-2026-aipla-v01-logs` (reuses the M0 bucket)
  - `_ALLOWED_HOST_ORIGINS=https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app` — pinned per-env; test/prod TF must override
  - `_SERVICE_NAME=aipla-v01-sandbox`
- **Filter (`--included-files`):** `infrastructure/mcp-sandbox/**` — without this, every `dev` push (frontend, backend, docs) would rebuild the sandbox. Saves ~80% of wasted builds. **For TF:** `google_cloudbuild_trigger.included_files` is the equivalent.
- **Permissions reused (none new needed):** The trigger runs under the same `aipla-v6@aipla-dev-2026.iam.gserviceaccount.com` SA used by the root trigger. That SA already has the AR push + Cloud Run deploy bindings established in M0 + Side effect 7 (`iam.serviceAccountUser` on itself via the CB service agent).
- **Captured in script:** ✅ `ensure_mcp_sandbox_trigger()` step in `bootstrap-aipla-dev.sh`; appended to the `main()` flow.
- **For test/prod TF:**
  - New `google_cloudbuild_trigger.mcp_sandbox` resource, scoped to `infrastructure/mcp-sandbox/**` with the same `service_account` reference as the root trigger.
  - `_ALLOWED_HOST_ORIGINS` is per-env (dev/test/prod each have a distinct frontend `*.run.app` URL) — should live in `terraform/envs/{dev,test,prod}/terraform.tfvars`.
  - First deploy creates the Cloud Run service `aipla-v01-sandbox-{test,prod}` automatically; subsequent deploys update in-place.
  - No new IAM beyond what the root trigger already has.

### Decision 10 — Static artefact pattern under `mcp-sandbox/artefacts/<name>/v<version>/`

- **What:** Hand-curated MCP App artefacts (Boldkast sim, future physics sims, parameter-driven dashboards) live as static HTML+JS files in `infrastructure/mcp-sandbox/artefacts/<name>/v<version>/index.html`. The same Cloud Run service serves them at `https://aipla-v01-sandbox-<hash>.run.app/artefacts/<name>/v<version>/index.html`.
- **Why one shared service, not per-artefact:** Cloud Run cold-start + min-instance overhead is per-service; a static artefact has zero server-side state and zero per-artefact code. Sharing one service across N artefacts is the right amortisation. Dynamic MCP servers (which DO have per-server logic, e.g. `mcp-ext-apps-map`) get their own Cloud Run per ADR-013, but those don't exist for AIPLA yet.
- **Security model unchanged:** Each artefact loads in an iframe with `sandbox="allow-scripts"`, no `allow-same-origin`. The artefact lives on the sandbox origin (cross-origin to the frontend) so any same-origin attack surface is contained.
- **For test/prod TF:** No new infra — same Cloud Run service, just more files in the image. Artefact dir is `COPY artefacts ./artefacts` in the Dockerfile. CI gates: image size + a per-artefact static check (size limit ≤200KB per ADR-013).

## 2026-05-25 — 1.G-Ph2 teacher UI mockup substitution

### Decision 11 — `_TEACHER_MOCK=1` baked into dev frontend image (Phase 2 only)

- **What:** Added `_TEACHER_MOCK=1` to the `aipla-dev-deploy` trigger's substitutions. The dev Cloud Build pipeline now passes `--build-arg NEXT_PUBLIC_TEACHER_MOCK=1` to the frontend Dockerfile, so the deployed dev image's `/teacher/*` routes render the static mockup without Firebase teacher auth.
- **Why:** Phase 1 (PR #1) shipped a static mockup at `/teacher/*` gated by `isLocalMode()` or `NEXT_PUBLIC_TEACHER_MOCK=1`. Phase 2 (PR #2) wires the activity-config + reports screens to real Firestore + ADK reads, but the auth gate stays `LOCAL_MODE` / `TEACHER_MOCK` until Phase 3 lands Firebase teacher auth (via 1.A `teacher-permission-model.md`). The deployed dev URL needs to render the mockup so M + JB can iterate; production must NOT have this flag set.
- **Substitution captured by the trigger:** `_TEACHER_MOCK=1` (default empty in `cloudbuild.yaml`; dev trigger overrides).
- **Captured in script:** ✅ `ensure_cb_trigger()` was refactored 2026-05-25 to use `gcloud builds triggers import` (upsert) instead of the old "describe → early-return if exists" pattern. That earlier pattern broke idempotency — substitution edits on a re-run were silently skipped. The new shape applies edits in place.
- **For test/prod TF:** explicitly DO NOT set `_TEACHER_MOCK` (leave it empty/unset). `cloudbuild.yaml`'s default empty value renders the "sign-in required" placeholder on test/prod. **Phase 3 should remove this substitution from dev too** — when Firebase teacher auth replaces the bypass, the override becomes obsolete.

### Side effect 9 — `gcloud builds triggers update github` doesn't speak 2nd-gen repo schema

- **What I tried first:** `gcloud builds triggers update github aipla-dev-deploy --update-substitutions=_TEACHER_MOCK=1 --repository=projects/aipla-dev-2026/.../repositories/cphu-aipla-app` — returns **`400 INVALID_ARGUMENT`** with no further detail. Tried with both the trigger short-name and the UUID; tried `--repository` and without; same generic 400 every time.
- **Root cause (best guess):** `gcloud builds triggers update github` predates the 2nd-gen Cloud Build connection model and doesn't construct a PATCH payload that the API accepts for `repositoryEventConfig` triggers. The `--repository=<2nd-gen-connection-resource>` arg is documented but doesn't propagate cleanly. The same gap likely affects `bitbucket*` / `bitbucket-data-center` for 2nd-gen connections.
- **What worked:** `gcloud builds triggers import --source=<yaml>` is the supported create-or-update path. Import is keyed off `name`, so re-importing a modified YAML upserts in place. **The trigger id is preserved** (verified: `9d211df6-9a90-428d-bde3-ac312a1a8e0f` before and after).
- **For test/prod TF:** Terraform's `google_cloudbuild_trigger` provider wraps the *PATCH* endpoint directly and handles the 2nd-gen schema correctly; `terraform apply` updates substitutions in place. Only the gcloud CLI has the gap.

### Live trigger update — applied 2026-05-25

```bash
# 1. Export the current trigger to YAML
gcloud builds triggers describe aipla-dev-deploy \
  --project=aipla-dev-2026 --region=europe-north1 \
  --format=yaml > /tmp/trigger.yaml

# 2. Edit the YAML: add `_TEACHER_MOCK: "1"` under `substitutions:`
#    (strip the read-only `id`, `createTime`, `resourceName` lines —
#    import rejects them when present).

# 3. Re-import — upserts in place
gcloud builds triggers import \
  --source=/tmp/trigger.yaml \
  --project=aipla-dev-2026 --region=europe-north1
```

**Verified:** `gcloud builds triggers describe aipla-dev-deploy --format='value(substitutions)'` now lists `_TEACHER_MOCK=1`. Trigger id preserved.

After this, the next dev push (or a manual `gcloud builds triggers run aipla-dev-deploy --branch=dev`) will rebuild the frontend image with `NEXT_PUBLIC_TEACHER_MOCK=1` baked in. **Prerequisite:** PR #2 (`feature/teacher-ui-phase2`) must be merged to `dev` first so `cloudbuild.yaml` has the matching `--build-arg NEXT_PUBLIC_TEACHER_MOCK=${_TEACHER_MOCK}` line — without that, the substitution exists on the trigger but isn't consumed by the build.

## 2026-05-29 — BigQuery chat-log pipeline preconditions (SEQUENCE 1.2 + 1.1 §F)

### Decision 12 — chat-log dataset + Log Router sink: gcloud for dev (in the bootstrap script), Terraform for test/prod

- **Why now:** teacher monitoring + analysis was promoted to committed v1 (2026-05-28). The BigQuery sink ([chat-log-pipeline.md](../docs/design/aipla/v1.0.0-pilot/chat-log-pipeline.md)) is the keystone everything analytical reads from, so its infra preconditions need to be reproducible for test/prod, not a one-off dev hack.
- **Live dev state, verified 2026-05-29** (`m@sunholo.com` via `/Users/voightkampff/dev/google-cloud-sdk/bin`):
  - `bq --project_id=aipla-dev-2026 ls` → **empty** (zero datasets). `bq show aipla-dev-2026:chat_logs` → **Not found**.
  - `gcloud logging sinks list --project=aipla-dev-2026` → only the built-in `_Required` + `_Default` buckets. **No chat-log sink exists.**
  - `bigquery.googleapis.com` + `logging.googleapis.com` → **already enabled** (the script's `ensure_apis()` covers them).
  - **Conclusion:** the dataset + sink do NOT exist yet anywhere. Nothing to `terraform import` on dev — the module creates fresh.
- **Dev path (gcloud):** added as `ensure_chat_logs()` in [`bootstrap-aipla-dev.sh`](bootstrap-aipla-dev.sh) (idempotent `bq mk` dataset + `gcloud logging sinks create --use-partitioned-tables` + writer-identity `dataEditor` grant). `bigquery.googleapis.com` added to `ensure_apis()`; `roles/bigquery.dataViewer` + `roles/bigquery.jobUser` added to the `aipla-v6@` bindings in `ensure_sa()`. **No terraform is set up yet — dev is gcloud, same as every other resource here.**
- **Test/prod path (Terraform):** the parallel module [`infrastructure/modules/chat-logs/`](../infrastructure/modules/chat-logs/) (dataset `chat_logs` region-pinned `europe-north1`; `google_logging_project_sink` with `use_partitioned_tables` + `unique_writer_identity`; sink-writer `dataEditor` + backend `dataViewer` dataset IAM; backend project-level `jobUser`; opt-in flattened views). Keep it in sync with `ensure_chat_logs()` — same dataset id, sink name, filter, partitioned-tables, writer grant.
- **Why one module (not split):** keeps dataset + sink + tables + IAM cohesive and independently appliable, rather than splitting the dataset into 1.1 and the sink into 1.2. The 1.1 bootstrap module, when written, calls this module per env.
- **For test/prod TF:**
  - `module "chat_logs" { source = "../../modules/chat-logs" project_id = "aipla-test-2026" env = "test" backend_service_account_email = "aipla-v6@aipla-test-2026.iam.gserviceaccount.com" partition_expiration_days = 180 }` (prod: 365, calibrate to the consent form / DPIA at SEQUENCE 1.13).
  - **Prereqs the module assumes** (owned by 1.1): `bigquery.googleapis.com` + `logging.googleapis.com` enabled (dev: ✅ already; test/prod: add `google_project_service`), `aipla-v6@<project>` SA exists, TF principal has `bigquery.admin` + `logging.admin`.
  - **Two-phase apply:** first apply with `create_views = false` (default — the sink's raw tables don't exist until the first log write); after the 1.2 backend emitter is deployed and data flows, re-apply with `create_views = true` for the flattened `chat_turns` / `workbench_events` views. Verify with `bq --project_id=<project> ls chat_logs`.
- **Captured in script?** ✅ yes — `ensure_chat_logs()` (dev). The Terraform module is the test/prod equivalent. Earlier draft of this entry wrongly said "TF-only, not in the script" — corrected: dev uses gcloud like everything else here.

### Side effect 10 — gcloud/bq are not on the default PATH; default config project is the template's, not AIPLA

- **What:** the SDK lives at `/Users/voightkampff/dev/google-cloud-sdk/bin` (not on `$PATH` for non-interactive shells). Active account `m@sunholo.com`; **default configured project is `aitana-multivac-dev`** (the inherited template's), so any AIPLA command MUST pass `--project=aipla-{dev,test,prod}-2026` explicitly.
- **For test/prod TF:** n/a (operator note). Recorded in agent memory `reference_gcloud_sdk_location.md`.

## 2026-06-03 — Vertex AI Agent Engine for ADK session/memory persistence

### Decision 13 — Vertex AI Agent Engine anchors ADK session + memory services

- **Why now:** sprint 1.F (session-persistence) shipped the group→session_id Firestore mapping + the `POST /api/sessions/{id}/restore` endpoint, but the underlying ADK SessionService was falling back to `InMemorySessionService` because `AGENT_ENGINE_ID` was deliberately omitted (cloudbuild.yaml line 178-181, original AIPLA decision: "v0.1 runs ADK on Cloud Run directly, not Agent Engine"). Verified end-to-end against deployed dev on 2026-06-03: `messages: []` on rejoin even when `turn_count` showed 2 turns happened — because Cloud Run is `minScale=1, maxScale=3` with `sessionAffinity=true`, and ANY scale-up or redeploy evaporates the in-memory session. The 1.F Firestore mapping pointed at a session_id whose contents no longer existed anywhere. Every push to `dev` was wiping every student's chat history.
- **Decision:** provision an Agent Engine resource in each env as a pure session/memory namespace anchor. ADK still runs on Cloud Run (the original AIPLA decision); Agent Engine is just the persistence backend for `VertexAiSessionService` + `VertexAiMemoryBankService`. Pay-per-use; no model deploys to it.
- **Region:** `europe-west1` (Belgium). Agent Engine isn't hosted in `europe-north1`. europe-west1 is the closest EU region that hosts `reasoningEngines` and stays GDPR-compliant. Pinned via a dedicated `VERTEX_SESSION_LOCATION` env var so `GOOGLE_CLOUD_LOCATION=global` (needed for gemini-3.5-flash GA routing) stays untouched for model calls.
- **Live dev state, verified 2026-06-03:**
  - Agent Engine resource: `projects/784116621297/locations/europe-west1/reasoningEngines/5594904500356775936`
  - Display name: `aipla-v01` (used for idempotent re-find on subsequent bootstrap runs)
  - Secret Manager: `AGENT_ENGINE_ID` v1 = `5594904500356775936`
  - SA grant: `aipla-v6@aipla-dev-2026.iam.gserviceaccount.com` → `roles/secretmanager.secretAccessor` on `AGENT_ENGINE_ID`
  - `roles/aiplatform.user` on the runtime SA is already bound by `ensure_sa()` — sufficient for VertexAiSessionService/VertexAiMemoryBankService access.

### Dev path (gcloud + Python SDK):

`ensure_agent_engine()` in [`bootstrap-aipla-dev.sh`](bootstrap-aipla-dev.sh).

**Why Python SDK (not pure gcloud):** `gcloud ai reasoning-engines` / `gcloud alpha ai reasoning-engines` does NOT exist in any released SDK channel (verified 2026-06-03 against gcloud 557.0.0). The vertexai Python SDK is the only first-party tool that wraps the reasoningEngines REST surface. Delegating to `backend/scripts/bootstrap_agent_engine.py` keeps the operation reproducible, idempotent (by display name), and in-repo.

The function:
1. Calls `bootstrap_agent_engine.py --display-name aipla-v01` via `uv run`. The script lists existing engines by display name (idempotent) and returns the numeric resource ID on stdout.
2. Upserts Secret Manager `AGENT_ENGINE_ID` (creates on first run, adds a new version only if the stored value drifts).
3. Grants the runtime SA `roles/secretmanager.secretAccessor` on the secret.

### Test/prod path (Terraform):

Module **does not exist yet** — write [`infrastructure/modules/agent-engine/`](../infrastructure/modules/agent-engine/) when promoting v0.1 to test. Recipe:

```hcl
# 1. Provision the Agent Engine itself.
# The terraform-provider-google-beta has google_vertex_ai_reasoning_engine
# (added 2025 — verify provider version when wiring).
resource "google_vertex_ai_reasoning_engine" "aipla" {
  provider     = google-beta
  project      = var.project_id
  location     = "europe-west1"    # NOT region — Agent Engine is europe-west1-only in the EU.
  display_name = "aipla-${var.env}"  # e.g. aipla-test, aipla-prod
  description  = "AIPLA session + memory anchor (backend runs on Cloud Run)."

  # spec.package_spec.requirements pins runtime deps for any code that
  # WERE deployed to Agent Engine — irrelevant here (we use it only as
  # a namespace). Leave default if the provider allows; otherwise pin
  # to match `backend/scripts/bootstrap_agent_engine.py` defaults:
  # cloudpickle + pydantic.
}

# 2. Extract the numeric ID — VertexAiSessionService expects only the
# trailing numeric, not the full resource name (see _normalize_agent_engine_id
# in backend/adk/session.py).
locals {
  agent_engine_numeric_id = element(split("/", google_vertex_ai_reasoning_engine.aipla.name), length(split("/", google_vertex_ai_reasoning_engine.aipla.name)) - 1)
}

# 3. Mirror into Secret Manager so cloudbuild's --set-secrets line works.
resource "google_secret_manager_secret" "agent_engine_id" {
  project   = var.project_id
  secret_id = "AGENT_ENGINE_ID"
  replication { auto {} }
}

resource "google_secret_manager_secret_version" "agent_engine_id_v1" {
  secret      = google_secret_manager_secret.agent_engine_id.id
  secret_data = local.agent_engine_numeric_id
}

resource "google_secret_manager_secret_iam_member" "runtime_sa_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.agent_engine_id.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.runtime_sa_email}"
}
```

**Provider note:** if `google_vertex_ai_reasoning_engine` isn't yet GA on the provider version pinned by `infrastructure/`, fall back to a `null_resource` + `local-exec` that calls `backend/scripts/bootstrap_agent_engine.py` from Terraform — the script is already idempotent on display name, so re-applies are safe. Worst case is the resource lives in state as a `null_resource`; the secret + IAM stay first-class.

**Prereqs the module assumes** (owned by 1.1 / `ensure_apis` already on dev): `aiplatform.googleapis.com` enabled (✓), `roles/aiplatform.user` on the runtime SA (✓ — bound in `ensure_sa()`), `gs://${PROJECT}-artifacts` staging bucket exists (✓ — created in `ensure_runtime_buckets()`).

**Two-phase apply:** Agent Engine creation takes 2–4 min and the LRO returns before the resource is fully ready for session writes. First apply provisions; let it settle ~5 min before deploying the Cloud Run service that consumes the secret. The dev gcloud path doesn't need this because `cloudbuild.yaml` reads the secret at deploy time, by which point the LRO is done.

### Backend wiring

[`backend/adk/session.py`](../backend/adk/session.py) (updated 2026-06-03):
- New helper `_session_location()` returns `VERTEX_SESSION_LOCATION` if set, else `GOOGLE_CLOUD_LOCATION`. This isolates the Agent Engine region from the model region (AIPLA needs `global` for gemini-3.5-flash GA).
- `get_session_service()` + `get_memory_service()` use `_session_location()` for the `location=` arg to `VertexAiSessionService` / `VertexAiMemoryBankService`.
- `get_session_service_uri()` + `get_memory_service_uri()` now return the FULL resource path (`agentengine://projects/.../locations/europe-west1/reasoningEngines/NNN`) instead of the bare numeric form, so ADK's service registry parses location off the URI itself rather than falling back to `GOOGLE_CLOUD_LOCATION=global`.

### cloudbuild.yaml (root) wiring

Two lines added to the Cloud Run sidecar deploy step:
- `--set-secrets=AGENT_ENGINE_ID=AGENT_ENGINE_ID:latest`
- `--set-env-vars=VERTEX_SESSION_LOCATION=europe-west1`

The original `AGENT_ENGINE_ID omitted` comment was replaced with a pointer to this decision.

### Captured in script? ✅ yes — `ensure_agent_engine()`. The Terraform recipe above is the test/prod equivalent.
