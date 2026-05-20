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
