# infra-privilege-separation — the laptop stops being able to destroy an environment

**Status**: Planned — written the day a single mistyped command destroyed prod (2026-08-03). Supersedes the "apply from a laptop" operating model assumed by [aipla-cloud-bootstrap.md](../v1.0.0-pilot/aipla-cloud-bootstrap.md) and the runbook in `infrastructure/env/README.md`.
**Priority**: **P0** — the pilot starts 2026-08-14. Today an operator typo can delete prod's data plane while teachers are on it; that risk is only acceptable while prod is empty, which it stops being in 11 days.
**Estimated**: ~0.5d for the state split + import dance; ~1h for the IAM change. Sequenced strictly after prod recovery.
**Scope**: Who may mutate test/prod infrastructure, and by what path. Covers the bootstrap/env state split, the `aipla-terraform@` identity, and the IAM posture of the human accounts. Does **not** cover application deploys (already CI-only via tag/promote — see [build-once-artifact-promotion.md](../v1.0.0-pilot/build-once-artifact-promotion.md)).
**Dependencies**: The Terraform CI landed in `34edc2b` (`infrastructure/env/terraform-ci.tf`, `cloudbuild.terraform.yaml`, `scripts/tf.sh`, `state-guard.tf`). This doc is the follow-on that makes those guards structural rather than advisory.
**Created**: 2026-08-03
**Last Updated**: 2026-08-03
**Upstream**: generically useful. The template ships no Terraform CI at all; the two-layer bootstrap/env split plus a state-stamped mismatch guard is worth upstreaming to `sunholo-data/ai-protocol-platform`. Log in [docs/upstream-feedback.md](../../../upstream-feedback.md).

## Problem Statement

On 2026-08-03 the whole of `aipla-prod-2026`'s Terraform-managed infrastructure was destroyed by one command. The sequence:

```bash
terraform init -reconfigure ... -backend-config="prefix=aipla-env/prod"
terraform plan -var-file=envs/prod.tfvars                    # fine

terraform init ... prefix=aipla-env/test && terraform apply -var-file=envs/test.tfvars
#   ^ blocked by a permission prompt, then RETRIED AS ONLY ITS SECOND HALF:
terraform apply -input=false -auto-approve -var-file=envs/test.tfvars
#   ^ inherited the PREVIOUS init's prod backend
```

Terraform did exactly what it was told. It compared prod's 77 resources in state against a configuration naming `aipla-test-2026`, concluded every one of them had to go, and `-auto-approve` obliged.

**Destroyed:** the runtime service account `aipla-v6@`, all three Cloud Build triggers (`aipla-prod-release`, `aipla-prod-sandbox-release`, `aipla-prod-promote`), every application secret, the `-config` and `-artifacts` buckets, and the `chat_logs` BigQuery dataset. The prod frontend served **500** until rebuilt — it had no runtime identity left.

**Survived:** Firestore and its data (deletion protection held), both Cloud Run *services* (not Terraform-managed), the sandbox (still 200), and the logs buckets.

The damage was contained only by luck of timing: prod had no users, because the pilot had not started. The same command on 2026-08-15 destroys live teacher and student data.

**The interesting failure is not the typo.** Three separate things had to be true for a typo to become this:

1. **Nothing tied the state file to the variables.** Two independently-specified inputs — which state, which tfvars — had to agree, with no mechanism forcing them to. Terraform will happily apply any config against any state.
2. **The blast radius and the control plane shared a state.** The CI triggers that should have been the only way to apply were themselves resources in the state being destroyed, so destroying the data plane also destroyed the mechanism that would have prevented it.
3. **The laptop had the rights to do it.** `m@sunholo.com` holds `roles/owner` on all three projects. No guard in code matters while the credential can do it directly.

`34edc2b` closed (1) with `state-guard.tf` and `scripts/tf.sh`. This doc closes (2) and (3).

## Progress — 2026-08-04

The incident writeup is [INFRA-1](../../../ops/incidents/infra-1-prod-destroyed-by-varfile-mismatch.md);
this doc remains the plan for the two structural items it does not close.

**Landed and verified:**

- Terraform CI proven end-to-end on **both** envs (builds `e0b3e75a` test, `e09f7d2a` prod): fmt → init → validate → plan → apply-gate → harden → posture. Running it for real found two missing roles that review had not.
- `roles/editor` removed via an authoritative empty binding — **test now reports `held by nobody`**, after the purpose-built resource proved inert (`service_accounts = {}`).
- Non-Terraform-representable hardening moved into the pipeline (`harden` step) rather than left as a documented manual step.
- `scripts/check-iam-posture.sh` — asserts posture against deployed reality, in CI and locally.
- Both envs past bootstrap; prod recovered; test applied in one pass.

**Written but NOT applied — blocked, deliberately:**

`project_owners` (the authoritative owner list that degrades `m@sunholo.com`) is
committed and its break-glass precondition is tested, but **it must not be
applied until someone has actually authenticated as
`mark.edmondson@ind.ku.dk`**. That account sits behind UCPH IT processes and its
usability is unconfirmed. With no parent org, degrading the everyday account
against an unusable break-glass is unrecoverable.

This is the doc's own "verify the escape hatch" criterion doing its job — the
gate is working, not stalling. The Terraform precondition prevents *removing*
break-glass from the list; it cannot tell whether the account behind it works.

**Also still open:** the bootstrap/env split itself, and secret bootstrap, which
remains the one genuine laptop-side gap in the CI story.

## Current State (post-`34edc2b`)

| Control | Status |
|---|---|
| `terraform_data.env_guard` stamps `env:project` into state; a mismatch forces replacement of a `prevent_destroy` resource, so the plan is refused before any real resource is touched | Landed |
| `scripts/tf.sh <env> <action>` binds env → backend prefix → tfvars from one argument; no `-auto-approve` | Landed |
| `aipla-<env>-infra-plan` / `-infra-apply` Cloud Build triggers, running as `aipla-terraform@` with 16 enumerated roles | Landed (not yet applied to either env) |
| `make tf-plan` / `tf-apply` route through Cloud Build; `make tf-local` is bootstrap/recovery only | Landed |
| Bootstrap and control plane share `aipla-env/<env>` state | **Open — this doc** |
| `m@sunholo.com` holds `roles/owner` on test and prod | **Open — this doc** |

These are seatbelts. They make the incident harder to repeat by that exact route; they do not make it impossible, and they all live in a repo that an operator can bypass by typing `terraform` directly.

## Design

### Two layers, two states

Split `infrastructure/env/` into a small, rarely-touched bootstrap layer and everything else.

| Layer | State prefix | Contains | Applied by | Frequency |
|---|---|---|---|---|
| **bootstrap** | `aipla-bootstrap/<env>` | APIs required for CI; `aipla-terraform@` + its role bindings; the 2nd-gen GitHub connection (console OAuth, gate G1) + repository link; the two `*-infra-*` triggers; state-bucket IAM | Laptop, as the **break-glass** account | Once per env, plus recovery |
| **env** | `aipla-env/<env>` | Everything else: runtime SA, secrets, buckets, Firestore, BigQuery, load balancer, app triggers | **Cloud Build only**, as `aipla-terraform@` | Every change |

The property this buys: the layer a human can apply contains nothing whose loss takes an environment down, and the layer that *would* take an environment down has no human-credential path at all. Repeating the 2026-08-03 command against the bootstrap state destroys an SA and some triggers — recoverable in minutes, with the data plane untouched.

It also removes the chicken-and-egg that made recovery painful: when prod's triggers were destroyed, CI was destroyed with them, so the only route back was the same laptop path that caused the incident. With the split, the control plane survives a data-plane disaster and vice versa.

**Resources that move to bootstrap:** `google_service_account.terraform` + `google_project_iam_member.terraform` + the two state-bucket IAM members + `google_cloudbuildv2_connection.github` + `google_cloudbuildv2_repository.app` + `google_cloudbuild_trigger.infra_plan` / `infra_apply`, plus the subset of `google_project_service.apis` that CI itself needs (`cloudbuild`, `iam`, `serviceusage`, `storage`, `secretmanager`).

**The one awkward edge:** the env layer's app triggers (`test_release`, `prod_release`, `*_sandbox_release`, `prod_promote`) reference `google_cloudbuildv2_repository.app`, which moves to bootstrap. They become a `data "google_cloudbuildv2_repository"` lookup in the env layer. This is the only cross-layer coupling and it is read-only, which is the right direction: env depends on bootstrap, never the reverse.

### IAM: the wall behind the seatbelts

Code guards are bypassable by anyone who types `terraform` instead of `scripts/tf.sh`. IAM is not.

| Principal | Today | Target |
|---|---|---|
| `m@sunholo.com` (daily driver — the ADC every local tool and agent uses) | `roles/owner` on dev, test, prod | `roles/viewer` on **test + prod**; unchanged on dev |
| `mark.edmondson@ind.ku.dk` (**break-glass**) | `roles/owner` on prod | `roles/owner`, unchanged. Used only via an explicit `gcloud --account=` / separate config, for bootstrap and recovery |
| `aipla-terraform@<project>` | (new, not yet applied) | The 16 enumerated admin roles. Reachable **only** by running a Cloud Build trigger |
| `aipla-v6@<project>` | runtime roles | unchanged |

The everyday credential — the one in the shell where mistakes happen, and the one agentic tooling runs as — can read everything and change nothing. Privileged work requires switching accounts, which is a deliberate act rather than a default.

**This was verified feasible before proposing it.** The AIPLA projects have **no parent organisation** (`gcloud projects describe` returns no parent), so project-level `roles/owner` is the only escape hatch — there is no org admin to re-grant from. Degrading the sole owner would be unrecoverable. `mark.edmondson@ind.ku.dk` already holds `roles/owner` on prod, which is what makes this safe. **Confirm the same binding exists on test before degrading anything there.**

**Honest limit.** Break-glass holds `roles/owner`, and the bootstrap layer needs `resourcemanager.projectIamAdmin`, which is self-escalating by definition — anyone who can grant IAM can grant themselves anything. So this is not a cryptographic wall; it is *deliberate act plus audit trail*. The value is that the destructive path is no longer the default one, and every use of it is a distinguishable identity in the audit log. That is the achievable property for a two-person project without an org.

### Standing risk, noted not fixed

`300514327263-compute@developer.gserviceaccount.com` holds `roles/editor` on prod — the Compute Engine default SA, granted automatically at project creation. It is a broader standing privilege than anything this doc introduces. Out of scope here; worth a follow-up to disable default-SA grants.

## Migration Plan

**Strictly after prod recovery completes.** Moving resources between states while an environment is half-restored is how a second incident happens.

1. **Recover prod** (in flight — see the recovery runbook below). Prod green, smoke passing.
2. **Create `infrastructure/bootstrap/`** as a new root module; move the resource *definitions* listed above out of `infrastructure/env/`.
3. **Move the state, don't recreate it.** For each env: `terraform state mv -state-out=` the bootstrap resources into the new prefix, then `terraform state rm` them from `aipla-env/<env>`. Verify with a plan on both layers showing **0 to add, 0 to destroy**. Do test first, in full, before touching prod.
4. **Convert the repository reference** in the env layer to a data source; confirm the app triggers still plan clean.
5. **Apply once through CI** (`make tf-apply ENV=test GO=1`) to prove the env layer no longer needs a laptop.
6. **Degrade IAM.** Confirm break-glass owner on both projects first; then `m@sunholo.com` → `roles/viewer` on test and prod. Verify: `make tf-plan ENV=prod` still works (it triggers a build), a direct `terraform apply` fails with a permission error, and the break-glass account can still bootstrap.

## Acceptance Criteria

- [ ] `terraform plan` on both layers, both envs: 0 to add, 0 to destroy, after the split
- [ ] `m@sunholo.com` cannot delete a prod resource — verified by an actual attempt returning `PERMISSION_DENIED`, not by reading the policy
- [ ] `make tf-apply ENV=prod GO=1` still applies successfully as `aipla-terraform@`
- [ ] Destroying the entire bootstrap state leaves the prod frontend serving 200
- [ ] Break-glass account documented in `docs/ops/` with when-to-use, and confirmed working on both test and prod
- [ ] `infrastructure/env/README.md` runbook no longer instructs a bare `terraform init`/`apply`

## Open Questions

1. **Should dev join this model?** dev is script-provisioned and plan-only, so it has no apply path to protect. Leaving `m@sunholo.com` as owner on dev preserves the fast local loop. Provisionally: yes, leave dev alone.
2. **Does UCPH inherit break-glass?** At handover (2026-09-15) `mark.edmondson@ind.ku.dk` is the natural owner, but the sunholo account disappears. The handover checklist needs an explicit IAM transfer step, or UCPH inherits an environment whose only privileged identity belongs to someone who has left the project.
3. **Is `chat_logs` worth a backup?** It was destroyed and is unrecoverable. Empty at the time, but from 2026-08-14 it holds the research data the entire programme exists to collect. A scheduled BigQuery export is cheap insurance and is not currently configured.

## Postscript — what this cost

Recovery required a state restore from a GCS generation, a console OAuth step Terraform cannot perform, repopulating four secret values by hand, a new Firebase web app ID (so a full frontend rebuild), and the permanent loss of the `chat_logs` dataset. Roughly half a day, on an environment with no users.

The same command during the pilot would have destroyed live research data mid-collection, in a programme whose entire output is that data. That is the number that justifies the P0.
