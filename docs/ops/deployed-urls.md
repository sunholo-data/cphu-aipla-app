# Deployed URLs — AIPLA fork (inherited template doc, AIPLA section first)

Canonical list of live Cloud Run services, per environment.

## AIPLA release-readiness status (2026-07-30)

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
## AIPLA — test (`aipla-test-2026`, region `europe-north1`) — cut 2026-07-27 (v0.1.0)

- **Frontend (public, multi-container):** https://aipla-v01-frontend-y2bmxayxca-lz.a.run.app
  - Cut entirely from committed Terraform (`infrastructure/env/`, 77 resources); first release tag `v0.1.0`.
  - Main container `ui:v0.1.0` (Next.js) + sidecar `backend:v0.1.0` (FastAPI+ADK).
  - Cloud Build trigger: `aipla-test-release` (root `cloudbuild.yaml`, fires on tag `^v.*$`; build-once, CI-gated — 1.3a). Connection: `github-aipla`.
  - Agent Engine + curriculum RAG corpus in `europe-west1`. Auto-seed job ran green (auth-gap resolved). Demo code `aipla-demo-1` live.
- **MCP App sandbox (public, separate origin per ADR-013):** https://aipla-v01-sandbox-y2bmxayxca-lz.a.run.app
  - Deployed v0.1.1 via the `aipla-test-sandbox-release` tag trigger. Hosts `/sandbox.html` (iframe shell) + `/artefacts/<name>/v<version>/` (Boldkast etc.). The frontend bakes this as `NEXT_PUBLIC_MCP_SANDBOX_URL`; smoke green.
## AIPLA — prod (`aipla-prod-2026`, region `europe-north1`) — cut 2026-07-28 (v0.1.1)

- **Frontend (public, multi-container):** https://aipla-v01-frontend-6vwz657g3a-lz.a.run.app
  - Cut from committed Terraform in ONE clean apply (every test-cut fix was already in the shared code — identity config applied first-try). Deploy: `aipla-prod-release` tag trigger (first-cut **tag-build**; copy-promote is the steady-state follow-up — 1.3a). Agent Engine + RAG corpus in `europe-west1`; auto-seed job ran green; demo code `aipla-demo-1` live.
  - Teachers: email sign-in **enabled (pilot phase)** for a seed-teacher + team eval; UCPH SSO is the handover target (ADR-001). Curriculum: **A/B/C (cleared) seeded**.
- **MCP App sandbox (public, separate origin per ADR-013):** https://aipla-v01-sandbox-6vwz657g3a-lz.a.run.app
  - Deployed v0.1.1 via `aipla-prod-sandbox-release`. Hosts `/sandbox.html` + `/artefacts/*`; frontend bakes it as `NEXT_PUBLIC_MCP_SANDBOX_URL`; smoke green.

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
