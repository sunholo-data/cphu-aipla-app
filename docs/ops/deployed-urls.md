# Deployed URLs — AIPLA fork (inherited template doc, AIPLA section first)

Canonical list of live Cloud Run services, per environment.

## AIPLA release-readiness status

> **Version numbers have been REMOVED from this file — run `make deploy-status`.**
>
> ```bash
> make deploy-status   # reads the running services; prints the drift + promote command
> ```
>
> They were written by hand and drifted twice in a single day (2026-08-04): the
> file said v0.1.4/v0.1.4 while test was on v0.1.5, which is why prod was
> restored a release behind; the correction to v0.1.5/v0.1.4 was stale again
> within hours (test v0.1.6, prod v0.1.5). A number that is wrong more often
> than right is worse than no number — the durable facts stay here, the
> perishable ones come from the services themselves.

| Environment | Status |
|---|---|
| dev | Live. Deploys on every push to `dev`. |
| test | Live, smoke green. Reached by pushing a `v*` tag. |
| prod | Live, smoke green. Reached only by `make promote`. Restored 2026-08-04 after [INFRA-1](incidents/infra-1-prod-destroyed-by-varfile-mismatch.md) destroyed all 77 Terraform-managed resources; the Artifact Registry repository went with them, taking both images, which is why the service was unstartable. Recovered by promoting the version its revision referenced. **Normally trails test — `make deploy-status` says by how much.** |

> The sandbox is versioned INDEPENDENTLY of the app: `aipla-prod-sandbox-release`
> is tag-fired while the app reaches prod only by promote, so prod can serve a
> newer sandbox than app. Deliberate — see the note in `infrastructure/env/cloudbuild.tf`.

## Historical status (2026-07-30)

| Environment | Status | Release gate |
|---|---|---|
| dev | **Live (v0.1.4 source, 2026-07-30)** | Auto-seed job verified green; smoke green |
| test | **Live (v0.1.4, 2026-07-30)** | Cut from committed Terraform; **full smoke green** (incl. sandbox), e2e + teacher round-trips + curriculum (A/B/C, cleared) verified. Remaining: ≥24h soak |
| prod | **Live (v0.1.4, 2026-07-30)** | **Reached by trigger-based copy-promote, validated end-to-end.** Backend pinned by digest `sha256:cef15770…` — byte-identical to test's `backend:v0.1.4`. Smoke green (incl. sandbox); curriculum A/B/C (cleared) seeded; demo code `aipla-demo-1`. Remaining: domains, hardening |

> **v0.1.4 (2026-07-30) — the laptop is out of the release path.** The promote
> now runs as a Cloud Build **trigger** checked out at the tag
> (`gcloud builds triggers run aipla-prod-promote --tag=vX.Y.Z`), not
> `gcloud builds submit .` which uploaded the operator's working tree. Matches
> `sunholo-data/docparse` `scripts/release.sh promote`, which had this right all
> along — AIPLA's design doc had reimplemented the promotion *model* without the
> *mechanism*. Confirmed by promoting from a `dev` checkout: the build used the
> TAG's code, not the working tree's. No `git checkout <tag>` needed any more.
>
> **v0.1.3 (2026-07-30) — prod is now gated.** A `v*` tag reaches **test only**
> (`aipla-prod-release` disabled). Prod is reached deliberately:
>
> ```bash
> git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z   # -> test builds
> make promote VERSION=vX.Y.Z FROM=test TO=prod          # dry-run plan
> make promote VERSION=vX.Y.Z FROM=test TO=prod GO=1     # copy digest + deploy
> ```
>
> Validated for real, not just configured — three latent bugs surfaced on the
> pipeline's FIRST execution, all of which would have hit whoever tried it during
> the pilot:
> 1. `copy-backend` called `gcloud artifacts docker images copy`, **which does not
>    exist** in any SDK version. Now `crane copy`, with a post-copy digest
>    equality assertion.
> 2. `promote-env.sh` passed no `--service-account`, so the CLI ran as the Compute
>    Engine default SA while the trigger ran as `aipla-v6@` — two identities, so a
>    grant to either one leaves the other broken.
> 3. That SA then needed `storage.objectViewer` on `<project>_cloudbuild` to read
>    the uploaded source tarball (trigger builds fetch from the repo and never hit
>    this).
>
> **v0.1.2 (2026-07-30)** — curriculum 1.1.60 (subject as broad class, narrowed
> facets, ingest capture fix, explicit retrieval `top_k`), plus the nine
> physics-area shared folders seeded in all three envs by
> `make seed-curriculum-folders` (metadata only — creates no documents, so prod's
> cleared-content gate is untouched). That tag still fired test AND prod
> simultaneously; v0.1.3 is what closed that.

The operational source of truth for changing these states is the
[v1.0 pilot-readiness checklist](../design/aipla/v1.0.0-pilot/pilot-readiness-checklist.md).
Add test/prod URLs here only after the services exist; do not pre-fill expected
URLs.

## AIPLA — dev (`aipla-dev-2026`, region `europe-north1`)

- **Frontend (public, multi-container):** https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app
  - Main container: `ui:dev` — Next.js 15, listens on 8080 (Cloud Run ingress)
  - Sidecar: `backend:dev` — FastAPI + ADK, listens on 1956
  - Cloud Build trigger: `aipla-dev-deploy` (root `cloudbuild.yaml`, fires on `dev` push)
- **MCP App sandbox (public, separate origin per ADR-013):** https://aipla-v01-sandbox-wgwhd7mspa-lz.a.run.app
  - Image: `aipla-v01-sandbox:dev` from `infrastructure/mcp-sandbox/`
  - Hosts `/sandbox.html` (iframe shell) + `/artefacts/<name>/v<version>/index.html` (curated artefacts — Boldkast, future physics sims)
  - Cloud Build trigger: `aipla-mcp-sandbox-deploy` (filter `infrastructure/mcp-sandbox/**`, fires on `dev` push when sandbox files change)
  - Public smoke: `curl https://aipla-v01-sandbox-wgwhd7mspa-lz.a.run.app/sandbox.html` → 200
- **Public MCP endpoint (EXT-MCP / 1.1.49):** `https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/mcp`
  - The backend FastMCP server (mounted at `/mcp`) reached via the dedicated `frontend/src/app/api/mcp/route.ts` (forwards to backend `mcp/` with the trailing slash — avoids the 307 the catch-all proxy can't replay).
  - **Public, no auth** (matches the public-skills posture). Speaks Streamable HTTP — point a ChatGPT remote connector or Claude Desktop `mcp-remote` here, no tunnel.
  - Offers the public skills as tools **and** the sims as `ui://` MCP Apps (`show_boldkast|kinebot|led_planck`; artefact HTML lazily fetched from the sandbox via `MCP_SANDBOX_URL`).
  - Smoke: `REQUIRE_SIMS=1 ./scripts/smoke-deployed-mcp.sh dev` → initialize + sims listed + `ui://` readable. (Visual render is host-dependent — Claude Desktop is currently blocked by upstream claude-ai-mcp#165; ChatGPT/MCP Inspector render reliably.)
## ACCESS-1 rollout state (2026-08-12)

Access tiers and spend control ([1.1.75](../design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md))
are **deployed to dev and test**, and **not to prod**.

| Env | Code | `teacher_access` register | Vertex daily token ceiling |
|---|---|---|---|
| dev | live (branch tip) | **EMPTY — every teacher is a visitor** | applied + verified (50M/day/base model) |
| test | live (`v0.1.15`) | **EMPTY — every teacher is a visitor** | not applied |
| prod | **not deployed** | n/a | not applied |

**An empty register means no live tutor for anyone on that env.** Teachers can
sign in and explore; the tutor replays a recorded session. That is the intended
posture, but dev and test are consequently not representative for anyone
testing the live tutor until the register is populated.

To populate, per env — roster and sign-off in
[access-register-signoff-2026-08-12.md](access-register-signoff-2026-08-12.md):

```bash
cd backend && GOOGLE_CLOUD_PROJECT=<project> uv run python -m scripts.grandfather_access          # dry run
cd backend && GOOGLE_CLOUD_PROJECT=<project> uv run python -m scripts.grandfather_access --apply
make spend-ceiling ENV=<env> APPLY=1        # the Vertex ceiling; verify-only without APPLY
```

**Prod is the one that bites.** `jbruun@ind.ku.dk` owns 5 real named classes
there and the pilot starts 2026-08-14 — the grandfather must run in the SAME
change window as the prod deploy, not after it.

---

## Custom domains — `ku.dk` (provisioned 2026-08-03, **app names LIVE 2026-08-11**)

**The app is live on its ku.dk names.** Use these as the addresses to give
teachers; the `run.app` URLs stay valid and are still what every smoke script
and the promote path use.

| | Address | Certificate |
|---|---|---|
| **prod** | **https://aipla.ku.dk** | ACTIVE 2026-08-11 17:46 UTC, renews 2026-11-09 |
| **test** | **https://aipla-test.ku.dk** | ACTIVE 2026-08-11 15:17 UTC, renews 2026-11-09 |
| prod sandbox | `aipla-sandbox.ku.dk` | **not delegated — with UCPH IT** |
| test sandbox | `aipla-test-sandbox.ku.dk` | **not delegated — with UCPH IT** |

The two sandbox names are not blocking: the frontend serves sims from the
`run.app` sandbox origin, which is a distinct origin and satisfies ADR-013 on
its own. Both envs' deployed `ALLOWED_HOST_ORIGINS` already list the ku.dk app
origin, so nothing needed redeploying when the names came up.

UCPH granted four names. Each env has ONE global external Application Load
Balancer; the app and the sandbox share its IP pair and are split by **Host
header** (a distinct hostname is a distinct origin, so ADR-013 holds without a
second address).

| Name | Env | A | AAAA |
|---|---|---|---|
| `aipla.ku.dk` | prod | `8.233.216.35` | `2600:1901:0:faa7::` |
| `aipla-sandbox.ku.dk` | prod | `8.233.216.35` | `2600:1901:0:faa7::` |
| `aipla-test.ku.dk` | test | `136.68.144.79` | `2600:1901:0:e627::` |
| `aipla-test-sandbox.ku.dk` | test | `136.68.144.79` | `2600:1901:0:e627::` |

Addresses are reserved and anycast — they do not change. **UCPH IT needs only
these A/AAAA records: no CNAME, no TXT, no ownership-verification record, and
nothing at `ku.dk` itself.**

**Cost — $18.25/month per environment, ~$36.50/month total.** From the Cloud
Billing Catalog API (service `E505-1604-58F8`), not a marketing page:
`Cloud Load Balancer Forwarding Rule Minimum Global` is **$0.025/hour**, and the
SKU name is the model — it is a FLAT charge covering the first 5 forwarding
rules, with `…Additional Global` ($0.010/hour) applying only beyond that. Each
env has 4 rules (IPv4/IPv6 × HTTPS/HTTP-redirect), so both sit inside the flat
tier. Consequence worth knowing: **dropping the HTTP→HTTPS redirect or IPv6
would save nothing** — under 5 rules the price is identical. The reserved IPv4
addresses are free while `IN_USE` (`Static Ip Charge` = $0.000/hour; the
$0.010–0.011/hour rate applies only to reserved-but-unattached addresses), IPv6
is free, and data processing (~$0.01/GiB) is cents at pilot volume.

**Why an ALB and not a Cloud Run domain mapping:** a mapping needs Google Search
Console ownership verification, which for a subdomain means a TXT at the name —
and a CNAME cannot coexist with a TXT at the same name (RFC 1034). The
alternative is getting UCPH's root-domain owners into a Search Console property.
A Google-managed cert on an ALB validates by the name simply *resolving* to the
LB, so none of that applies.

**One cert per hostname, deliberately** — a managed cert stays PROVISIONING until
every domain on it validates, so a combined cert would let a missing sandbox
record hold the frontend hostage. That paid off exactly as designed on
2026-08-11: the two sandbox names are still undelegated, and the app names went
ACTIVE regardless.

### What went wrong 2026-08-03 → 08-11, and the diagnostic that found it

UCPH IT created the records on 2026-08-10 with correct IPs, and they still did
not work: the certs sat at `FAILED_NOT_VISIBLE` for eight days. The delegations
were **missing from the `ku.dk` parent zone**, so the parent served a signed
NSEC proof that the names did not exist while ns1/ns2 answered A queries for
them from the child zones. Strict validators (Google — hence Google's cert
prober) call that forged and refuse; lenient ones (UCPH's own resolver,
Cloudflare) return the record. That asymmetry is why UCPH could not reproduce
it and closed two tickets.

**The one query that settles it, needing no third-party tool:**

```bash
dig @ns1.ku.dk +norec science.ku.dk DS   # NOERROR  — name exists, no DS: correct insecure delegation
dig @ns1.ku.dk +norec aipla.ku.dk   DS   # NXDOMAIN — name absent from the parent's signed data
```

NXDOMAIN does not mean "no DS" — that is NOERROR. It means the name does not
exist. Note `science.ku.dk` is itself unsigned and works fine, so "sign the
child zone" is never the fix; the delegation must be inside `ku.dk`'s
signatures. Once UCPH added the delegations, certs issued in 2.5–5 hours with
no action, no deploy and no config change on our side.

**This will not self-heal for the remaining two names.** Re-signing only signs
what is in the zone, and the sandbox delegations are absent from it — so the
2026-08-20 signature expiry will come and go without fixing them. They need
UCPH IT to create the delegations.

`make check-domains` encodes all of the above, including telling "record
missing" apart from "record present but DNSSEC-bogus", and refusing to render a
verdict when it cannot read the project.

```bash
gcloud compute ssl-certificates list --global --project=aipla-prod-2026 \
  --format="table(name,managed.status)"
```

**Still outstanding, once the two sandbox names are delegated:** flip
`mcp_sandbox_url` in the env's tfvars to the ku.dk sandbox origin and re-apply,
then cut a tag / promote — the sandbox reads `ALLOWED_HOST_ORIGINS` at *deploy*
time, so sims would stay blocked on a newly-added origin until it redeploys.
Firebase `authorized_domains` is a live config change and needs no redeploy.
Both origins (run.app and ku.dk) are kept authorized throughout; dropping
run.app would break every smoke script and the promote path.

**Also outstanding:** `MCP_WIDGET_DOMAIN` is still the `run.app` frontend origin
in both envs (`cloudbuild.tf`: `_MCP_WIDGET_DOMAIN = var.frontend_url`). It was
deliberately held there until the ku.dk names actually served, which they now
do. It only declares a widget domain to *external* MCP hosts (ChatGPT rendering
the sims) and has no in-app effect, so it is safe to leave. When it is changed
it needs the `cloudbuild.promote.yaml` twin as well, or it will never reach
prod — see the footgun table in CLAUDE.md.

## AIPLA — test (`aipla-test-2026`, region `europe-north1`) — cut 2026-07-27 (v0.1.0)

- **Frontend (public, multi-container):** https://aipla-v01-frontend-y2bmxayxca-lz.a.run.app
  - Cut entirely from committed Terraform (`infrastructure/env/`, 77 resources); first release tag `v0.1.0`.
  - Main container `ui:v0.1.0` (Next.js) + sidecar `backend:v0.1.0` (FastAPI+ADK).
  - Cloud Build trigger: `aipla-test-release` (root `cloudbuild.yaml`, fires on tag `^v.*$`; build-once, CI-gated — 1.3a). Connection: `github-aipla`.
  - Agent Engine + curriculum RAG corpus in `europe-west1`. Auto-seed job ran green (auth-gap resolved). Demo code `aipla-demo-1` live.
- **MCP App sandbox (public, separate origin per ADR-013):** https://aipla-v01-sandbox-y2bmxayxca-lz.a.run.app
  - Deployed v0.1.1 via the `aipla-test-sandbox-release` tag trigger. Hosts `/sandbox.html` (iframe shell) + `/artefacts/<name>/v<version>/` (Boldkast etc.). The frontend bakes this as `NEXT_PUBLIC_MCP_SANDBOX_URL`; smoke green.
- **2026-08-05 (v0.1.10) — parity with dev.** Preview feature flags are now ON here
  (`preview_feature_flags = true`): the authoring co-pilot, the concept map, and the
  floating **"AIPLA Hjælp"** help co-pilot all render. The in-product **guide corpus**
  (6 docs, subject "AIPLA guides") + the **"AIPLA onboarding"** class with teacher /
  student / researcher tutors are seeded — `make seed-guide-corpus ENV=test`, idempotent,
  re-run to publish updated guides. Onboarding group code: `wide-compass-23`.
## AIPLA — prod (`aipla-prod-2026`, region `europe-north1`) — cut 2026-07-28 (v0.1.1)

- **Frontend (public, multi-container):** https://aipla-v01-frontend-6vwz657g3a-lz.a.run.app
  - Cut from committed Terraform in ONE clean apply (every test-cut fix was already in the shared code — identity config applied first-try). Deploy: `aipla-prod-release` tag trigger (first-cut **tag-build**; copy-promote is the steady-state follow-up — 1.3a). Agent Engine + RAG corpus in `europe-west1`; auto-seed job ran green; demo code `aipla-demo-1` live.
  - Teachers: email sign-in **enabled (pilot phase)** for a seed-teacher + team eval; UCPH SSO is the handover target (ADR-001). Curriculum: **A/B/C (cleared) seeded**.
- **MCP App sandbox (public, separate origin per ADR-013):** https://aipla-v01-sandbox-6vwz657g3a-lz.a.run.app
  - Deployed v0.1.1 via `aipla-prod-sandbox-release`. Hosts `/sandbox.html` + `/artefacts/*`; frontend bakes it as `NEXT_PUBLIC_MCP_SANDBOX_URL`; smoke green.
- **2026-08-05 (v0.1.10) — parity with dev, and two gaps closed.**
  - Preview flags ON, so the help co-pilot / authoring co-pilot / concept map render here
    too. This needed BOTH `preview_feature_flags = true` and a fix to
    `cloudbuild.promote.yaml`, which passed no feature-flag build-args at all — prod is
    reached only by promote, so no tfvar alone could ever have lit them up.
  - **The promote pipeline now seeds SKILL.md → Firestore.** It never did, and promote is
    prod's only path, so prod's skill docs had been frozen at the 2026-07-28 env cut for a
    week. First run of the new step reconciled them (8 skills, `aipla-help` included).
  - Guide corpus + "AIPLA onboarding" tutors seeded (`make seed-guide-corpus ENV=prod`).
    Onboarding group code: `brave-thicket-77`.

---

# Inherited: Aitana Platform v6 deployed URLs

The section below is from the inherited template and refers to the upstream
Aitana services, NOT AIPLA. Kept for reference until the template is bumped
and the inherited section can be pruned. Both services are deployed by
`cloudbuild.yaml` (multi-container frontend) and `backend/cloudbuild.yaml`
(standalone backend). The URLs are assigned by Cloud Run on first deploy and
stay stable unless the service is deleted and recreated.

## dev (Aitana — upstream)

- **Frontend (public, multi-container):** https://aitana-v6-frontend-66pa3y5xnq-ew.a.run.app
  - Main container: `ui:dev` — Next.js 15, listens on 8080 (Cloud Run ingress)
  - Sidecar: `backend:dev` — FastAPI + ADK, listens on 1956
  - Public health checks: `/`, `/api/health`, `/api/proxy/health` (all 200)
- **Backend (IAM-protected, standalone):** resolve with
  ```bash
  gcloud run services describe aitana-v6-backend \
    --project=aitana-multivac-dev --region=europe-west1 \
    --format='value(status.url)'
  ```
  - Needs identity-token auth: `gcloud auth print-identity-token --audiences=$URL`
  - Used by channels (Telegram/email/WhatsApp) and other SA-invoked callers.
- **MCP App sandbox proxy (public):** https://mcp-sandbox-66pa3y5xnq-ew.a.run.app
  - Image: `mcp-sandbox/sandbox:dev` from `infrastructure/mcp-sandbox/`
  - Public smoke: `GET /sandbox.html` → 200 (NOT `/healthz` — Cloud Run's
    GFE intercepts that path for its own probes; user containers never see it)
  - Separate origin from frontend per MCP Apps spec — `allow-same-origin`
    on the inner iframe is only safe when the sandbox is on a different
    origin than the host. See `docs/design/v6.1.0/implemented/mcp-sandbox-separate-origin.md`.
- **MCP map server (public):** https://mcp-ext-apps-map-66pa3y5xnq-ew.a.run.app
  - Image: `mcp-ext-apps-map/server:dev` from `infrastructure/mcp-ext-apps-map/`
    (clones `modelcontextprotocol/ext-apps` at pinned commit `0008d3b7`
    inside the Dockerfile — no vendoring; license MIT upstream)
  - Public smoke: `POST /mcp` with a `tools/list` JSON-RPC body → 200 + SSE
    `event: message data: {"result":{"tools":[{"name":"show-map", ...}]}}`
  - Reached by both: (a) the agent's `McpToolset` (server-side from
    `aitana-v6-backend`); (b) the frontend's MCP Client via the backend
    proxy `/api/proxy/mcp/ext-apps-map` (gated by Firebase auth + per-skill
    allowlist, sprint 1.7 M2B)
  - Bump pinned commit by editing `EXT_APPS_REF` in the Dockerfile.
- **Project:** `aitana-multivac-dev`
- **Region:** `europe-west1`
- **Branch → env:** `dev` branch deploys here via:
  - `trigger-aitana-dev-aitana-v6-frontend` + `trigger-aitana-dev-aitana-v6-backend`
  - `trigger-aitana-dev-mcp-sandbox` (sprint 1.7 M4)
  - `trigger-aitana-dev-mcp-ext-apps-map` (sprint 1.7 M4)

## test

Not yet cut. Will be live once the `test` branch is created and
`trigger-test` / `trigger-test-backend` fire (Terraform already reserves the
triggers — see `multivac-aitana` infrastructure repo).

- **Project:** `aitana-multivac-test`
- **Region:** `europe-west1`
- **Branch:** `test`

## prod

Not yet cut. Same story as `test`.

- **Project:** `aitana-multivac-production`
- **Region:** `europe-west1`
- **Branch:** `prod`

## Vertex AI Agent Engine resources

ADK's `VertexAiSessionService` and `VertexAiMemoryBankService` use a Vertex AI
Agent Engine (a.k.a. Reasoning Engine) resource as the persistence anchor.
The numeric ID is read from the per-project `AGENT_ENGINE_ID` Secret Manager
secret and injected into Cloud Run as an env var. **Bootstrap once per env**
with [`backend/scripts/bootstrap_agent_engine.py`](../../backend/scripts/bootstrap_agent_engine.py)
(idempotent — re-running just prints the existing ID).

| Env  | Display name | Numeric ID            | Region        |
|------|--------------|-----------------------|---------------|
| dev  | `aitana-v6`  | `6224370509212024832` | europe-west1  |
| test | `aitana-v6`  | `6388611158122692608` | europe-west1  |
| prod | `aitana-v6`  | `7741942846147526656` | europe-west1  |

Local laptop dev should set `AGENT_ENGINE_ID=6224370509212024832` in
`backend/.env` so chat history persists to the same Agent Engine the deployed
dev Cloud Run instance uses (same "laptop talks to cloud" pattern as Firebase
Auth and Firestore — relies on ADC credentials).

To re-fetch the value into Secret Manager (if the placeholder ever resurfaces
or someone reseeds with `dummy_value`):

```bash
ENV_PROJECT=aitana-multivac-dev   # or -test / -production
ID=$(GOOGLE_CLOUD_PROJECT=$ENV_PROJECT GOOGLE_CLOUD_LOCATION=europe-west1 \
     uv run python backend/scripts/bootstrap_agent_engine.py)
printf '%s' "$ID" | gcloud secrets versions add AGENT_ENGINE_ID \
  --data-file=- --project=$ENV_PROJECT
```

## How to verify

From a laptop (after `gcloud auth login`):

```bash
./scripts/smoke-deployed.sh              # dev, both services
./scripts/smoke-deployed.sh dev frontend # just the public one
./scripts/smoke-deployed.sh test         # when test is cut
```

In CI, the same checks run automatically as the last step of each cloudbuild
config (`smoke-deployed` in `cloudbuild.yaml`, `smoke-backend` in
`backend/cloudbuild.yaml`). A non-200 from any path fails the build — the
deployment does not silently succeed with a broken sidecar.

## Smoke tests

- [auth-smoke-testing.md](auth-smoke-testing.md) — `/api/auth/whoami`
  round-trip (verifies Firebase custom claims reach the backend)
- [agent-factory-smoke.md](agent-factory-smoke.md) — authenticated
  SSE stream against `/api/skill/{skill_id}/stream` (verifies the
  AGENT-FACTORY sprint output end-to-end)
- [platform-skills.md](platform-skills.md) — platform-owned seed skills
  (`ownerId=aitana-platform`), how the Cloud Build seed step runs, and
  how to verify/re-seed manually
- `/api/buckets` (RESOURCE-ACCESS sprint) — bucket + folder CRUD, IAM-gated
  via Firebase ID token. The smoke step exercises:
  - anon `GET /api/buckets` → 401/403 (auth gate present)
  - authed `GET /api/buckets` → 200 (router mounted, empty list OK)

## Known defect history

- **FE-BRINGUP-1** (2026-04-15) — `/api/proxy/health` 404 on Cloud Run while
  passing locally. Four compounding root causes (sidecar/ingress port
  collision, `BACKEND_URL` → self, `localhost` IPv6 vs uvicorn IPv4, no
  sidecar startup probe). Writeup:
  [incidents/fe-bringup-1-proxy-404.md](incidents/fe-bringup-1-proxy-404.md).
  The smoke step above exists specifically to make this class of bug fail
  loud on the next deploy instead of after-the-fact.
