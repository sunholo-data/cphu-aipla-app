# INFRA-1 — prod's Terraform-managed infrastructure destroyed by one command

- **Status:** Recovered 2026-08-03. Hardening partially landed; the IAM wall is written but **not applied** (see *Still open*).
- **Scope:** `aipla-prod-2026`. All 77 Terraform-managed resources destroyed. `aipla-test-2026` and `aipla-dev-2026` untouched.
- **User impact:** **None.** The pilot starts 2026-08-14 and prod had no users. Contained by timing, not by design — that is the whole point of this writeup.
- **Why this writeup:** the typo is the least interesting part. Three independent properties had to hold for a mistyped command to destroy an environment, and each is a general lesson. Two *further* failures during recovery were worse than the original: two separate resources reported success having done nothing.

## TL;DR

A `terraform init … prefix=aipla-env/test && terraform apply -var-file=envs/test.tfvars`
was blocked by a permission prompt and then retried **as only its second half**.
The apply inherited the *previous* `init`'s **prod** backend, compared prod's
state against a config naming `aipla-test-2026`, and `-auto-approve` obliged.

Destroyed: runtime SA `aipla-v6@`, all three Cloud Build triggers, every
application secret, the `-config` and `-artifacts` buckets, the `chat_logs`
dataset. The frontend served **500** for ~2h — it had no runtime identity.

Survived: Firestore and its data (deletion protection), both Cloud Run
*services* (not Terraform-managed), the Agent Engine and RAG corpus (both in
`europe-west1`, never in this state), the logs buckets.

## Timeline (condensed)

| Time (UTC) | Event |
|---|---|
| 08:18 | Last good prod state written (that morning's `authorized_domains` fix) |
| 15:56–15:57 | The apply. State 106,147 → 19,306 bytes |
| ~16:0x | Detected: `aipla-v6@` absent, triggers gone, frontend 500 |
| 17:57 | State restored from GCS generation `#1785745102525501` |
| 18:xx | GitHub connection recreated by console OAuth (Terraform cannot mint one) |
| 19:xx | Recovery apply — 100 resources. Two errors, both new defects |
| 19:3x | CI pipeline exercised end-to-end on both envs, green |

## Root causes

### 1. Nothing tied the state file to the variables

Which state and which tfvars were two independently-specified inputs that had to
agree, with no mechanism forcing them to. Terraform will apply any config
against any state; that is not a bug in Terraform.

**Fixed** ([34edc2b](https://github.com/sunholo-data/cphu-aipla-app/commit/34edc2b)):

- `infrastructure/env/state-guard.tf` — `terraform_data.env_guard` stamps `env:project` into state. A mismatch forces replacement of a `prevent_destroy` resource, so Terraform refuses to produce the plan at all.
- `scripts/tf.sh <env> <action>` — binds env → backend prefix → tfvars from **one** argument. No `-auto-approve`.

### 2. The control plane and the blast radius shared a state

The CI triggers that should have been the only way to apply were themselves
resources in the state being destroyed. So destroying the data plane also
destroyed the mechanism that would have prevented it — and forced recovery back
through the exact laptop path that caused the incident.

**Not yet fixed.** This is the bootstrap/env split, SEQUENCE 1.1.60.

### 3. The laptop had the rights

`m@sunholo.com` held `roles/owner` on all three projects — the everyday shell,
and the identity agentic tooling runs as. No guard in code matters while the
credential can do it directly.

**Written, not applied** ([9105190](https://github.com/sunholo-data/cphu-aipla-app/commit/9105190)). See *Still open*.

## The worse failures, found during recovery

Both are the same shape, and it is a shape worth naming: **a resource that
reports success without acting**. `terraform plan` then says `No changes`
forever, so the state asserts a hardening the project does not have and nothing
will ever contradict it. This is strictly worse than an error.

### `google_project_default_service_accounts` is inert in these projects

Applied with `action = "DISABLE"` it recorded `service_accounts = {}` — it
enumerated nothing — while the compute default SA stayed enabled holding
`roles/editor`. Adding `depends_on` and forcing `-replace` did not change the
empty map.

**Replaced** ([1c0baee](https://github.com/sunholo-data/cphu-aipla-app/commit/1c0baee)) with
`google_project_iam_binding` for `roles/editor` with `members = []` —
authoritative for that one role. Verified first that the compute default SA was
the *only* editor holder on both envs; an authoritative binding is a loaded gun
otherwise.

Disabling the *account* cannot be Terraform at all (`google_service_account`
only creates `<project>.iam.gserviceaccount.com`; the default lives at
`<number>-compute@developer.gserviceaccount.com`), so it is a step in the
Terraform pipeline ([642d18c](https://github.com/sunholo-data/cphu-aipla-app/commit/642d18c))
plus an assertion in `scripts/check-iam-posture.sh`.

### `bootstrap_agent_engine.py` built in the wrong project

Run to repopulate prod's `AGENT_ENGINE_ID`, it created a live Agent Engine in
`multivac-internal-dev` — the upstream template's project — and reported
success. Two template relics ([a1a1121](https://github.com/sunholo-data/cphu-aipla-app/commit/a1a1121)):

1. Project came from ambient `GOOGLE_CLOUD_PROJECT`, with no way to state it. **Same root cause as the destroy: ambient context silently deciding which environment gets mutated.**
2. `DEFAULT_DISPLAY_NAME` was `aitana-v6` while every AIPLA engine is `aipla-v01`. Idempotency is a display-name match, so this *guaranteed* a miss against the real engine and a duplicate on every run, in any project — which would have pointed the backend at empty session storage and made every prior session appear to vanish.

Now `--env` binds the project explicitly, ambient is reported and ignored, and
creation is opt-in (`--allow-create`); the default is find-or-fail.

> **Stray resource, not yet deleted:** Agent Engine `2586253658668662784`
> (`aitana-v6`) in `multivac-internal-dev`. Billable. Check that project has no
> legitimate `aitana-v6` engine before removing.

## Other defects the recovery surfaced

| Defect | Fix |
|---|---|
| `timeout_sec` is rejected on a serverless-NEG backend service (HTTP 400). For Cloud Run the request timeout belongs to the *service*, not the LB | [e050127](https://github.com/sunholo-data/cphu-aipla-app/commit/e050127) |
| `google_compute_url_map.frontend_http_redirect` had no implicit dependency on API enablement — the only compute resource without one, and the only one that 403'd `SERVICE_DISABLED` on **both** envs' first apply | `depends_on`, same commit. Ordering only; Google-side propagation may still need a second run |
| Two IAM gaps in the CI runner, found by actually running it: `cloudbuild.connections.get` (2nd-gen connections are a separate surface from builds/triggers) and `storage.buckets.getIamPolicy` on the state bucket | [4bb2ad7](https://github.com/sunholo-data/cphu-aipla-app/commit/4bb2ad7) |

The second IAM gap is itself an argument for the split: **a CI runner that
manages its own permissions is circular** — it must already hold a right in
order to grant itself that right.

## What made recovery possible

- **GCS object versioning on the state bucket.** The single reason this was recoverable in hours. Restored generation `#1785745102525501`.
- **`delete_contents_on_destroy = false`** on the BigQuery dataset — it would have *refused* to destroy a populated `chat_logs`. It died because it was empty.
- **Firestore deletion protection.**
- **Resources outside Terraform state survived** — Agent Engine, RAG corpus, Cloud Run services. Recovery was a lookup, not a rebuild.

## Still open

1. **The IAM wall is not applied.** `project_owners` is written and validated, but applying it is gated on confirming that break-glass (`mark.edmondson@ind.ku.dk`) is *usable* — it sits behind UCPH IT processes. **Do not apply `project_owners` until someone has authenticated as that account.** These projects have no parent org, so if break-glass turns out to be unusable after the everyday account is degraded, there is no way back.
2. **Bootstrap/env split** — SEQUENCE 1.1.60.
3. **`make tf-apply ENV={prod,test} GO=1`** not yet run: `no_editor`, the `harden` step, and the operator baseline are all pending.
4. **Secret bootstrap is still laptop work** — the one genuine gap left in the CI story.
5. **`chat_logs` had no backup.** Now exports daily to `gs://<project>-chat-logs-backup` ([baedd74](https://github.com/sunholo-data/cphu-aipla-app/commit/baedd74)). Motivated less by this incident than by the 365-day partition expiry: AIPLA is year one of a three-year programme.

## Lessons

1. **Two inputs that must agree, with nothing forcing them to, will eventually disagree.** True of state/tfvars, and of ambient `GOOGLE_CLOUD_PROJECT`/`--env`. Bind them into one input.
2. **A resource that succeeds without acting is worse than one that fails.** Two of these in one day. State cannot be the witness for its own correctness — hence `check-iam-posture.sh` comparing against deployed reality.
3. **Never retry half of a blocked compound command.** The `&&` was carrying the safety.
4. **Run the pipeline before trusting it.** The CI path had been committed and reviewed and was missing two roles. One real run found both.
5. **Verify the escape hatch before you need it.** Applying the owner degrade is blocked on exactly this, correctly.
