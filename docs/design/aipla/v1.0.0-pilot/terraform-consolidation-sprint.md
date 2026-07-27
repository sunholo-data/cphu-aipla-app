# terraform-consolidation — Sprint plan (Phase A: cut `test` from committed infra)

**Design doc**: [terraform-consolidation.md](terraform-consolidation.md) (SEQUENCE 1.3b) · consumes the 1.3 [env-promotion](env-promotion-dev-test-prod.md) M2–M6 runbook
**Sprint goal**: `aipla-test-2026` is a fully provisioned, working AIPLA environment cut entirely from committed Terraform (increment 2 completed), with a teacher + anon-group student round-trip verified — the release safety net the 2026-08-14 pilot needs.
**Scope this sprint**: design-doc **Phase A only**. NOT in scope: folding dev into Terraform (Phase B), prod cut (post-pilot), the capability-module refactor + config extraction (Phase C — only the minimum needed for test).
**Created**: 2026-07-27
**Estimated**: ~3–4 focused engineering days + two human-gated waits (GitHub-connection OAuth, Firebase-add).

## Progress log

- **2026-07-27 — M0 done.** State bucket `gs://aipla-deploy-tfstate` created (versioned, `europe-north1`, in the `aipla-deploy` project — D1) + `terraform init` against `aipla-env/test` (google/google-beta 6.50.0). Docs pending update to the real deploy-project name.
- **2026-07-27 — M1 core done + validated.** Wrote `infrastructure/env/firebase.tf` (Firebase project + anonymous auth + Web App + `FIREBASE_ENV` env-file secret) and `cloudbuild.tf` (connection [import-pattern], repo, CB service agent + actAs + the **auth-gap `tokenCreator`-on-self** binding, `aipla-test-release` tag trigger). `cloudbuild.yaml` image tags → `${_IMAGE_TAG}` (default `${BRANCH_NAME}`; tag trigger overrides `${TAG_NAME}`) — behavior-preserving for dev, confirmed against the Cloud Build substitution docs. `terraform validate` + `fmt` clean. **Connection decision:** console-OAuth (G1) then `terraform import` with `ignore_changes=[github_config]` (avoids provider issue #14162 perma-diff) → M2 is a single clean apply.
- **M1 remainder (deferred, not dropped):** the `aipla-mcp-sandbox` test trigger (needs the sandbox `cloudbuild.yaml` to take `_IMAGE_TAG` too) — next iteration. `aipla-prod-promote` manual trigger + cross-project AR-reader grant are the PROD cut (out of this sprint).
- **2026-07-27 — two decisions recorded (review with M).** (1) **CB in-env, not centralised** — connection + triggers live in each env project; only tfstate is central (`aipla-deploy`). Reverses the 1.3-M0 note; rationale in [terraform-consolidation.md](terraform-consolidation.md) §2. (2) **Promotion model confirmed** = branch→dev, **tag→test**, **copy-backend + rebuild-frontend→prod** (1.3a; matches ailang-parse/docparse). (3) **Frontend runtime-config (1.3a option A) deferred** to its own ~1d sprint; pilot ships rebuild-from-tag.
- **2026-07-27 — G1 + M2 DONE. Test env provisioned from committed Terraform (77 resources).** Connection is named `github-aipla` on test (not `sunholo-github`; per-env `cb_connection` in test.tfvars) — imported with `ignore_changes`. **Four latent bugs fixed by actually applying** (all were validate-only before): (1) voice `tts_cache_bucket` never wired → null name; (2) curriculum-rag `manage_corpus_via_script` defaulted true → would run the seed script mid-apply → set false; (3) `storage_bucket_iam_member.admin` used `for_each` over a resource map (apply-unknown keys, broke `terraform import`) → iterate the static set; (4) `google_identity_platform_config` 403'd on ADC quota project → `user_project_override=true` on both providers + `gcloud auth application-default set-quota-project`. APIs pre-staged via `terraform apply -target=google_project_service.apis`.
- **NEXT: M3** (post-apply data) — Agent Engine · **RAG corpus content (see decision below)** · `DOCPARSE_API_KEY` = **reuse dev's value** (M steer 2026-07-27) · `make seed ENV=test` · demo codes. Then M4 (tag → deploy → auth-gap verdict).
- **OPEN (M): RAG corpus content.** M questioned "cleared A-level only" (2026-07-27) — wants all of dev's content. Cleared-only is a **copyright** gate (B/C + 2010 exam archive not cleared for a shared corpus), not technical. Resolution: if dev's corpus is cleared-only (as policy requires) then "all of dev" == the cleared set; verify dev's corpus contents before seeding test.

---

## Ground truth (verified 2026-07-27)

| Fact | State | Consequence |
|---|---|---|
| Projects `aipla-{dev,test,prod}-2026` + `aipla-deploy` | all ACTIVE | deploy project is **`aipla-deploy`**, NOT `aipla-deploy-2026` as docs assumed → **DECISION D1** |
| State bucket `gs://aipla-deploy-2026-tfstate` | **404, does not exist** | M0 must create it |
| `aipla-test-2026` billing | ✅ enabled | precondition met |
| `aipla-test-2026` APIs | only `serviceusage` on | TF's `google_project_service` enables the rest (README precondition satisfied) |
| `aipla-test-2026` SAs | none (`aipla-v6@` absent) | greenfield — **no `terraform import` needed for test** (contrast Phase B/dev) |
| `sunholo-github` CB connection in test | **not installed** (CB API off) | **human gate G1** — 2nd-gen connection needs GitHub OAuth in console |
| Increment-1 Terraform (`infrastructure/env/`) | present, clean; inc-2 vars already declared | write `firebase.tf` + `cloudbuild.tf` only |

---

## Milestones

Ordered by dependency. Each `apply`/mutation step is a **gate** (review before run).

### M0 — State backend `(0.25d, gate: D1)`
- Create the tfstate bucket in the deploy project (versioning on), per D1.
- `terraform init -backend-config="bucket=<state-bucket>" -backend-config="prefix=aipla-env/test"`.
- Update [README](../../../../infrastructure/env/README.md) + [1.3 M0](env-promotion-dev-test-prod.md) to the real deploy-project name.
- **Done when**: `terraform init` succeeds against the real backend.

### M1 — Author increment 2 HCL `(1–1.5d, no cloud mutation)`
Write against the `google`/`google-beta` `~> 6.0` providers already pinned in [versions.tf](../../../../infrastructure/env/versions.tf); verify schemas against the provider registry (design-doc rule 5c), not memory.
- `firebase.tf` (google-beta): `google_firebase_project`, `google_identity_platform_config` (anonymous auth), `google_firebase_web_app`, `FIREBASE_ENV` secret from the Web App config.
- `cloudbuild.tf`: `google_cloudbuildv2_connection` (`sunholo-github`) + `google_cloudbuildv2_repository`; `google_cloudbuild_trigger` for test deploy + mcp-sandbox + the **1.3a** build-once promotion triggers; `google_project_service_identity.cloudbuild` + its `serviceAccountUser` (actAs) on `aipla-v6@`; the `serviceAccountTokenCreator`-on-self binding (the **1.1 auth-gap fix hypothesis**).
- Update `outputs.tf` (Web App config, trigger ids) + the post-apply `post_apply_todo`.
- **Done when**: `terraform validate` clean + `terraform plan -var-file=envs/test.tfvars` renders with no schema errors (a real plan needs M0 + G1's connection to exist; see G1).

### G1 — Human gate: install the GitHub connection `(human, ~0.5d wall)`
- **Precondition (confirmed on test 2026-07-27):** the connection wizard needs **`cloudbuild.googleapis.com` + `secretmanager.googleapis.com`** enabled first (the 2nd-gen connection stores its GitHub OAuth token in a Secret Manager secret). A bare project has only `serviceusage` on. Enable both before the wizard (console prompts, or `gcloud services enable cloudbuild.googleapis.com secretmanager.googleapis.com`); Terraform's `apis.tf` adopts them idempotently afterward — no conflict. **The prod cut will hit this same step** — or pre-stage with `terraform apply -target=google_project_service.apis` to enable all 15 at once.
- Install/authorize the `sunholo-github` 2nd-gen Cloud Build connection in `aipla-test-2026`/`europe-north1` (GitHub OAuth — **console/manual**; TF can create the connection resource but the GitHub App authorization is completed by a human).
- Firebase is now **Terraform-managed** (`google_firebase_project` in `firebase.tf`) — no separate manual Firebase-add step (earlier draft over-listed it).
- **Done when**: `gcloud builds connections describe sunholo-github --region=europe-north1 --project=aipla-test-2026` shows COMPLETE.

### M2 — `terraform apply` against test `(0.25d, gate: review plan)`
- `terraform plan -var-file=envs/test.tfvars` → **review every line** → `terraform apply`.
- Creates: APIs, `aipla-v6@` + IAM cascade, Firestore (`europe-north1`), buckets, secrets (shells), artifact repo, chat-logs dataset+sink, curriculum-rag + voice module resources, Firebase + identity config, CB connection-link + triggers.
- **Done when**: apply succeeds; `terraform output` lists the substitution values.

### M3 — Post-apply data steps (scripted, not TF) `(0.5d)`
Per `outputs.tf` `post_apply_todo` + [1.3 M2](env-promotion-dev-test-prod.md):
- `backend/scripts/bootstrap_agent_engine.py` → fills `AGENT_ENGINE_ID` (europe-west1).
- `scripts/provision-curriculum-rag.sh` → RAG corpus (europe-west1), **seed CLEARED (A-level) content only** (copyright gate).
- Populate the real `DOCPARSE_API_KEY` secret value.
- `make seed ENV=test` (platform skill templates → Firestore) + mint demo codes.
- **Done when**: secrets populated; a demo code joins.

### M4 — First deploy + auth-gap verdict `(0.25d)`
- Promote code to test per **1.3a** (tag→test build-once trigger) — the trigger from M1 builds + deploys the multi-container service + the mcp-sandbox.
- **Confirm/refute the 1.1 SA auth-gap hypothesis**: the deploy-time `aipla-seed-skills` job runs green, **no 403**. This is the experiment the whole increment-2 auth work is built to settle.
- Set `frontend_url` in `test.tfvars` from the assigned `*.run.app` URL → re-apply (sandbox `ALLOWED_HOST_ORIGINS`, chicken-egg per README).
- **Done when**: build green, service reachable, seed job succeeded.

### M5 — Verify (acceptance) `(0.5d)`
- `scripts/smoke-deployed.sh test all` → all green (public 200s + auth 401s).
- `make verify-chat-logs GROUP=<code> ENV=test` → join → turn → BigQuery e2e.
- One teacher (Firebase) + one anon-group student complete a turn each on a **fresh** session (do NOT migrate dev sessions — 1.3 Risks).
- **Done when**: all three pass; `docs/ops/deployed-urls.md` updated with test URLs.

---

## Human gates (cannot be fully automated)

1. **D1 — state backend name** (decision, blocks M0).
2. **G1 — GitHub connection OAuth** (manual console step, blocks M2's trigger resources).
3. **Every `apply`** (M2, M4 re-apply) — reviewed before run.
4. **Firebase add** (may need a console/CLI step if TF enablement ordering fights it).

## Risks / watch-items (from 1.3 + this recon)

- **Increment-2 schema risk** — Firebase (google-beta) + CB v2 resources are the schema-riskiest (1.3 M1 flagged this). Mitigation: author against a real `plan`, verify against the provider registry. If a resource fights the provider `~> 6.0` pin, fall back to a scripted post-apply step (as Agent Engine already is) rather than blocking the cut.
- **Curriculum copyright** — only CLEARED (A-level) content seeds the test RAG corpus. B/C + 2010 archive are OUT.
- **Region split** — Agent Engine + RAG corpus in `europe-west1`; compute in `europe-north1`. `GOOGLE_CLOUD_LOCATION=global` + `VERTEX_SESSION_LOCATION=europe-west1` per env exactly as dev.
- **Fresh sessions only** — clean env sidesteps the legacy anon-group uid-ownership issue (2026-06-17 outage).
- **Cost** — test adds a full Cloud Run + Agent Engine + RAG footprint. Expected, budgeted.

## Out of scope (later phases)

- **Phase B** — fold dev into Terraform via `terraform import` to zero-diff (retire the bootstrap script). Separate sprint.
- **Phase C** — capability-module refactor + full runtime-config extraction from `cloudbuild.yaml`. Only the minimum needed to cut test is done here.
- **Prod cut** — closer to / after the pilot, with hardening (min-instances, ingress/auth, domain).
- **Security dep pile** — separate branch (user directive 2026-07-27).

## Acceptance (sprint done)

- [ ] `test` provisioned entirely from `terraform apply -var-file=envs/test.tfvars` (+ scripted post-apply); no ad-hoc `gcloud` mutation.
- [ ] Increment-2 resources (`firebase.tf`, `cloudbuild.tf`) committed; `terraform plan` clean against test.
- [ ] 1.1 SA auth-gap **verdict recorded** (seed job green / or the fix iterated until it is).
- [ ] `smoke-deployed.sh test all` + `verify-chat-logs ENV=test` green.
- [ ] Teacher + anon-group student round-trip on test; `deployed-urls.md` updated.
