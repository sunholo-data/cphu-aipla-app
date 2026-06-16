# CLAUDE.md — AIPLA execution repo (forked from AI Protocol Platform v6)

> ⚠️ **This repo is AIPLA, not Aitana.** The bulk of this file is inherited
> from the upstream template (`sunholo-data/ai-protocol-platform`) and still
> describes itself as "Aitana Platform v6". The **architecture, commands,
> dev workflow, code style, ADK patterns, testing, and ports below are all
> still correct** for AIPLA — they describe the template AIPLA runs on.
>
> **What is *not* correct below for AIPLA:** project IDs, Cloud Run service
> names, GitHub org/repo, deployed-URL pointers, git push account, and any
> Aitana-specific skills referenced. Use the **AIPLA Fork Context** section
> directly below as the authoritative override.

## AIPLA Fork Context

This repo is **`sunholo-data/cphu-aipla-app`** — the execution fork for AIPLA
(AI in Physics Learning and Assessment), a 4-month technical-infrastructure
contract for the University of Copenhagen Center for Digital Education,
inside a 3-year research programme.

- **Forked from upstream template:** 2026-05-19 (initial commit `160c9fe`).
- **Contract window:** 2026-05-15 → 2026-09-15 (~17 weeks).
- **First hard gate:** **Jutland v0.1 demo on Wed 2026-05-27.** Minimum chat
  URL + one physics-tutor skill + anonymous group-ID join.
- **Mid-point review:** Fri 2026-06-26 (week 6), *before* the M+JB holiday
  freeze week 27 (2026-06-29 → 07-05).
- **Teacher pilot starts:** 2026-08-14.
- **Final handover:** 2026-09-15.

### Source of truth for AIPLA design

**The major scoping location is a separate Quarto site at
`/Users/mark/Documents/clients/cph-uni`** (public preview at
<https://www.sunholo.com/aipla/>, internal-team-only URL).

All AIPLA design lives there — read it, don't re-derive it here:

| File | What it contains |
|---|---|
| `index.qmd` / `about.qmd` | Project context, ADDIE method, research questions |
| `strands.qmd` | The three strands (A bots, B sims/games, C scoping), full skill catalogue with v0.1 / v1 / Year-2 scope markers |
| `timeline.qmd` | 17-week plan, handover fan-out, ownership map |
| `architecture.qmd` | **ADRs 001–015** for Strand A — read for any architectural question |
| `evaluation.qmd` | Capability-floor framework — task taxonomy, model panel, KPIs |
| `self-hosting.qmd` | UCPH on-prem migration table |

The scoping site has private dirs (`briefs/`, `notes/`, `admin/`,
`sources/aipla-proposal/`) that are gitignored and never published. Don't
copy from them into this repo. People are referred to by **initials**
(M, JB, AR, DS, ZL, P2, K) in the scoping site for light anonymisation —
keep that convention in commits and PR descriptions here too.

**This repo is execution.** Don't write new AIPLA design docs in this
repo's `docs/`; that directory still holds the template's own design
material. AIPLA-specific ADRs and progress live in the scoping site.

### How AIPLA diverges from the template's defaults

| | Template ("Aitana Platform v6") | **AIPLA** |
|---|---|---|
| GCP project IDs | `aitana-multivac-{dev,test,production}` | `aipla-{dev,test,prod}-2026` |
| Cloud Run services | `aitana-v6-{backend,frontend}` | `aipla-v01-{backend,frontend}` (deployed dev — first frontend at `aipla-v01-frontend-wgwhd7mspa-lz.a.run.app`); `aipla-v01-sandbox` for the MCP-app sandbox (Boldkast / LED Planck / KineBot iframes) |
| GitHub repo | `Aitana-Labs/platform` | **`sunholo-data/cphu-aipla-app`** |
| Region | EU (multi) | **`europe-north1` (Finland)** — see ADR-007 |
| Git push account | `sunholo-voight-kampff` → Aitana-Labs org | `sunholo-voight-kampff` → `sunholo-data` org |
| Default branch | `dev` (template's `main` deploys to dev env) | **`dev`** is the default and working branch. `test` and `prod` exist for promotion. `main` does not exist (renamed to `dev` on 2026-05-19). |
| Skills | Aitana skill set | Physics-specific (v1: `problem-set-helper-config`, `concept-dialogue-config`, `manage-class`, student problem-set hints, student conceptual exploration) — see `strands.qmd` |
| Auth | Firebase Auth (student + teacher) | **Anonymous group IDs for students** (ADR-001), UCPH SSO for teachers |
| Document parsing | Generic | **AILANG Parse** (ADR-004) — 13 deterministic formats, 2 AI |
| Model providers | Gemini / Claude / OpenAI | 4 tiers (ADR-003): cloud API · self-hosted GPU cluster (DeepSeek) · server-local (Qwen / Gemma) · on-device (Apple Intelligence / Gemini Nano) |

### Skills referencing Aitana

The `.claude/skills/` directory still contains Aitana-named skills
(`aitana-frontend-verify`, `aitana-adk-testing`, `aitana-v6-deploy`).
They may reference Aitana service URLs, project IDs, or CLI auth flows.
**Check what they actually run before invoking** — most logic is reusable,
but URLs and IDs need AIPLA equivalents. The generic skills
(`adk-cheatsheet`, `adk-dev-guide`, `adk-eval-guide`, `adk-deploy-guide`,
`adk-scaffold`, `design-doc-creator`, `sprint-planner` / `sprint-executor` /
`sprint-evaluator`) work as-is.

### Upstream tracking

The template is M's own work and has its own roadmap. Pull from upstream
periodically; AIPLA-specific divergence accumulates in this repo's config,
skills, and deployment files. Pin a known-good upstream SHA in
`.template-fork-target` once a release-worthy state is reached (per
ADR-002 "update cadence" consequence).

---

> The rest of this file is **inherited from the template** and describes
> the v6 architecture, commands, dev workflow, code style, ADK patterns,
> testing, and project structure. All still applies to AIPLA — read the
> overrides above when project IDs / service names / repo URLs differ.

## Overview (template — applies to AIPLA)

Aitana Platform v6 is a greenfield rebuild of the Aitana AI assistant platform. Skills replace assistants as the user-facing abstraction. Google ADK replaces Sunholo for agent orchestration.


## Architecture

- **Backend**: Python 3.11+, FastAPI, Google ADK — `backend/`
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind — `frontend/`
- **CLI**: `aiplatform` CLI tool — `cli/`
- **Infrastructure**: Cloud Run (same as v5), Firestore, Firebase Auth

### Key Principles

1. **Pure ADK + FastAPI** — no Sunholo, no LangChain, no Flask
2. **Skills, not assistants** — skills are the primary user-facing concept
3. **Protocol-native** — AG-UI (streaming), A2UI (declarative UI), MCP Apps (tool UIs), A2A (discovery), MCP (tools)
4. **Three model providers** — Gemini, Claude, OpenAI
5. **Copy proven code from v5** — don't reinvent, wrap as ADK FunctionTools
6. **Speed** — first token <1s without tools, <3s with tools

### Protocol Stack

```
Layer 4 — UI: A2UI (declarative JSON) + MCP Apps (sandboxed iframes)
Layer 3 — Transport: AG-UI / CopilotKit (SSE streaming)
Layer 2 — Coordination: A2A (agent discovery) + MCP (tools)
Layer 1 — Framework: Google ADK (orchestration, sessions, memory)
```

## Project Structure

```
platform/
├── frontend/          # Next.js 15 + React 19
├── backend/           # FastAPI + Google ADK
│   ├── app.py         # Root ADK agent definition
│   ├── fast_api_app.py # FastAPI application (uses ADK's get_fast_api_app)
│   ├── skills/        # Skill config, processor, templates
│   ├── adk/           # Agent factory, tool wrappers, sessions
│   ├── tools/         # AI search, file browser, code execution, MCP
│   ├── channels/      # Telegram (primary), email, WhatsApp
│   ├── protocols/     # A2A, MCP server, AG-UI
│   ├── auth/          # Firebase auth, permissions
│   ├── db/            # Firestore client, Pydantic models
│   ├── observability/ # OpenTelemetry, logging
│   └── tests/         # Unit, integration, eval
├── cli/               # `aiplatform` CLI
├── docs/              # Design docs, versioned
├── cloudbuild.yaml    # Branch-based deployment
└── firestore.rules    # Skills collection rules
```

## Commands

### Backend
```bash
cd backend
make install           # Install dependencies with uv
make dev               # FastAPI on port 1956 with hot-reload
make playground        # ADK dev UI on port 8501
make test              # Run all tests
make test-fast         # Fast CI tests (skip slow/integration)
make eval              # Run ADK evaluation suite
make lint              # Ruff + codespell
make format            # Auto-format with ruff
```

**CRITICAL:** Always use `uv run` for backend commands. Never use global `python` or `pip`.

### Frontend
```bash
cd frontend
npm install
npm run dev            # Next.js on port 3000
npm run build          # Production build
npm run quality:check:fast  # Lint + typecheck
```

### Server Ports
- Frontend: http://localhost:3000
- Backend API: http://localhost:1956
- ADK Playground: http://localhost:8501

## Deployment

Same GCP projects as v5, but v6 runs as **new parallel Cloud Run services** so v5 stays untouched during bring-up. DNS cutover is a separate later decision.

- **Project IDs**: `aitana-multivac-dev`, `aitana-multivac-test`, `aitana-multivac-production` (unchanged)
- **v6 Cloud Run services**: `aitana-v6-backend`, `aitana-v6-frontend` (new; live in dev once CI-WIRE lands)
- **v5 Cloud Run services**: `backend-api`, `frontend` (still running, will be decommissioned after DNS cutover)
- **Branch deployment (v6)**: `dev` → dev. `test` and `prod` branches will deploy once cut (not yet — dev-only until v6 is proven). Default branch is `dev` (matches v5 convention and terraform's `workspace → branch` mapping).
- **Cloud Build connection**: `github-voight` in `multivac-deploy-aitana/europe-west1` (authorizer `sunholo-voight-kampff`). v5 still uses the older `github` connection.
- **SA for Cloud Run**: `aitana-v6@{project_id}.iam.gserviceaccount.com`
- **CI gate**: `.github/workflows/ci.yml` — lint + test-fast on PR and push to `dev`.
- **Post-deploy smoke**: both `cloudbuild.yaml` pipelines end with a smoke step that curls critical endpoints and fails the build on any non-200. Run the same checks from a laptop with `./scripts/smoke-deployed.sh [dev|test|prod] [all|frontend|backend]`. Live service URLs are recorded in [docs/ops/deployed-urls.md](docs/ops/deployed-urls.md).
- **⚠ Manual seed after any SKILL.md template change** (avatar, `multimodalInput`, persona, tools, accessControl, instructions): a code deploy does **NOT** propagate `backend/skills/templates/**/SKILL.md` → Firestore for already-registered skills (the seed token-mint can't run inside Cloud Build — 403, see `cloudbuild.yaml` ~L259). Run **`make seed ENV=dev`** (= `scripts/seed-platform-skills.sh dev`) after the deploy completes. The CI `seed-reminder` job emits a warning when a template changed on push, so this doesn't get forgotten (it has been, repeatedly). Symptom of a missed seed: "shipped feature works in tests but the deployed app shows the old skill data."

## Key Differences from v5

| v5 | v6 |
|---|---|
| Assistants | Skills |
| Sunholo + Flask | ADK + FastAPI |
| Custom SSE streaming | AG-UI protocol |
| Bespoke rendering | A2UI + MCP Apps |
| LangChain | Removed |
| Custom memory (10 files) | ADK MemoryService |
| Custom content limiting | ADK Artifacts + Compaction |
| first_impression → orchestrator → smart_model | ADK agent loop (one pass) |
| Langfuse v2 SDK | OpenTelemetry → Cloud Trace + Cloud Logging + BigQuery (all internal) |
| Custom TTS | Gemini Live (ADK LiveRunner) |

## Copying Code from v5

When copying v5 code, follow this pattern:
1. Read the v5 file from `<your-v5-source>/`
2. Strip Sunholo imports and dependencies
3. Wrap as ADK FunctionTool if it's a tool
4. Place in the correct v6 directory (see design doc for mapping)
5. Write tests

**Key v5 files to copy (see design doc for full list):**
- `backend/tools/` → `backend/tools/` (wrap as ADK FunctionTools)
- `backend/telegram_service.py` → `backend/channels/telegram.py`
- `backend/email_integration.py` → `backend/channels/email.py`
- `backend/a2a_config.py` → `backend/protocols/a2a.py`
- `backend/tool_permissions.py` → `backend/auth/permissions.py`
- `backend/tools/mcp_servers.py` → `backend/tools/mcp/registry.py`

## Project Skills (`.claude/skills/`)

Project-local skills auto-load when their trigger keywords match. Live in `.claude/skills/<name>/SKILL.md` with optional `resources/` and `scripts/` siblings. Adding a new skill: `~/.claude/skills/skill-builder/scripts/create_skill.sh --project <name> "<description with triggers>"` or invoke the `skill-builder` skill directly.

**Aitana-specific operational skills** (load when debugging the v6 platform):

- **`aiplatform-cli`** — Operating manual for the `aiplatform` CLI when debugging from a terminal. Bundles a token-mint script that mints a fresh `AIPLATFORM_ID_TOKEN` for the dedicated `whoami-test@aitanalabs.test` user, plus curl fallbacks for endpoints the CLI doesn't yet wrap (sessions, skills, whoami, documents). Use when the next step is to reproduce a bug against the running backend, probe TTFT, or run a one-shot API call.
- **`aitana-adk-testing`** — ADK session/event/artifact inspection via the HTTP endpoints `get_fast_api_app(web=True, ...)` ships. Use when the question is "where do messages live", "did the loader save the artifact", or anything that bypasses the Firestore mirror.
- **`aitana-frontend-verify`** — Drive a real Chrome via the chrome-devtools MCP to verify frontend behaviour static checks can't see (SSE streams, hydration, auth state, DOM after click).
- **`aitana-v6-deploy`** — dev → test → prod promotion manual, including the three-repo topology, IAM cascade, and pre-promotion audit procedure.
- **`aitana-template-publish`** — refresh the public template at `sunholo-data/ai-protocol-platform`. Load when the user mentions publishing/refreshing the template, GitHub secret-scanner alerts on the template, or any operation that copies content out of this repo. Documents the sanitize pipeline, security gates (Firebase Web API keys are NOT safe in public), and the one-command refresh flow.
- **`aipla-security-checkup`** (AIPLA-specific) — Triage runbook for the dep-security pile (frontend npm + sandbox npm + backend Python). Load whenever the CI gate's `security-audit` job fails, when the Monday weekly rolling issue surfaces a CVE, or when the user says "run the security audit", "triage dependabot", or "is this gate going to pass". Encodes the reachability rubric (direct prod / transitive / dev-only / deprecated) from the 2026-06-05 sweep + the per-ecosystem command tree + the `npm overrides` conflict pattern. Policy of record: `docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md`.
- **`cloud-run-diagnostics`** — diagnose Cloud Run service issues (cold starts, IAM, connectivity, deploy failures).

**Cross-project skills** (used everywhere, not Aitana-specific):

- **`adk-cheatsheet` / `adk-dev-guide` / `adk-eval-guide` / `adk-deploy-guide` / `adk-scaffold`** — ADK API + lifecycle references.
- **`agent-protocols`** — Vendored snapshots of the four-protocol stack the platform speaks: Agent Skills (`SKILL.md` format), AG-UI (streaming transport), A2UI (declarative UI), MCP + MCP Apps (interactive iframes). Load when writing a design doc that touches any of these or when answering *"is this A2UI, MCP App, or AG-UI?"* (they get confused often). References are local files so they survive spec-site outages and are quotable in design docs. Should ship in the upstream template — see [docs/upstream-feedback.md](docs/upstream-feedback.md).
- **`mcp-app-artefact`** (AIPLA-specific) — How to ship a new MCP App artefact (Boldkast sim, future physics sims): the static-artefact path under `infrastructure/mcp-sandbox/artefacts/<name>/v<version>/`, the ADR-013 security gates (200 KB cap, no external fetches, sandboxed iframe + CSP), the decision tree for static-artefact vs dynamic MCP server, the AIPLA-side frontend wiring (shared `SimFrameHeader`, `useSimSnapshotPush`, `frontend/src/_sim-template/` scaffold + `aiplatform sim scaffold <name>` CLI), and the Cloud Build / Cloud Run wiring (`aipla-mcp-sandbox-deploy` trigger, `aipla-v01-sandbox` service). Load whenever the user says "add a sim", "new artefact", "deploy a sandbox iframe", "scaffold a sim", or references Boldkast / LED-Planck / KineBot / jitt-dk / mcp-sandbox.
- **`design-doc-creator`** — scaffolds new design docs in the right v6.X.Y layout, scores against product axioms, registers in SEQUENCE.md.
- **`sprint-planner` / `sprint-executor` / `sprint-evaluator`** — the planning → execution → quality-check loop for non-trivial work.
- **`skill-builder`** (global) — for creating/optimizing skills like the ones above.

**These skills expand as the project grows.** When a recurring debug task or workflow emerges that's worth >10 minutes per session of re-derivation (auth incantations, multi-step CLI sequences, architecture lookups), it's signal to add a new skill or extend an existing one. The `aiplatform-cli` skill in particular is meant to grow new recipes and curl fallbacks as new failure modes appear — invoke `skill-builder` to extend it cleanly.

## ADK Development

### ADK MCP Server (installed globally)
The ADK MCP server provides deep ADK expertise via `search_code` and `read_docs` tools.
Skills available: `/adk-scaffold`, `/adk-cheatsheet`, `/adk-dev-guide`, `/adk-eval-guide`, `/adk-deploy-guide`

### ADK Patterns (from reference scaffold)
- Agent definition: `google.adk.agents.Agent` with `google.adk.models.Gemini`
- App wrapper: `google.adk.apps.App`
- FastAPI integration: `google.adk.cli.fast_api.get_fast_api_app()`
- Testing: `google.adk.runners.Runner` with `InMemorySessionService`
- Evaluation: `adk eval` CLI with evalsets and rubric-based scoring

### ADK Reference Project

## Design Documents

- `docs/design/v5.0.0/migration-to-v6.md` — Full migration plan (v5 → v6 decisions, feature map, architecture)
- `docs/design/v6.0.0/` — v6.0.0 core bring-up sprint (see SEQUENCE.md for build order)
- `docs/design/v6.1.0/` — v6.1.0 channels, CLI, MCP apps
- `docs/design/v6.2.0/` — v6.2.0 DB tooling, v5 migration, agent CLI
- `docs/vendor/` — External documentation (ADK MCP guide, etc.)

## Testing

### Backend
```bash
cd backend
make test-fast         # Fast CI tests
make test              # All tests
make eval              # ADK evaluation
```

### Frontend
```bash
cd frontend
npm run test:run       # Vitest
npm run quality:check  # Full quality check
```

### Test Organization
- `backend/tests/unit/` — Unit tests for models, utils
- `backend/tests/integration/` — Integration tests (require GCP)
- `backend/tests/eval/` — ADK evaluation sets and config
- `frontend/src/**/__tests__/` — Component and hook tests

## Code Style

### Backend (Python)
- See `backend/CLAUDE.md` for Python-specific guidelines
- Use `ruff` for linting and formatting
- Type hints on all function signatures
- Async/await for all I/O operations

### Frontend (TypeScript)
- TypeScript strict mode
- React hooks for state/effects
- Radix UI + Tailwind for components
- Follow v5 patterns (copied from `src/contexts/`, `src/components/`)

## Automation Principle

Any local workflow that requires more than one manual step — setting env vars, running commands across directories, starting multiple processes — **must have a script or `make` target**. Never document a multi-step manual process without automating it.

| Task | Command |
|------|---------|
| Start local dev servers | `make dev` |
| **Seed SKILL.md templates → Firestore (after ANY template change + deploy)** | `make seed ENV=dev` |
| Smoke-test proxy bridge | `make proxy-check` |
| Verify chat-log pipeline e2e (join → turn → BigQuery) | `make verify-chat-logs GROUP=<code> ENV=<env>` |
| Backend tests (fast) | `cd backend && make test-fast` |
| Frontend quality check (inner dev loop, no tests) | `cd frontend && npm run quality:check:fast` |
| **Frontend pre-push CI parity (tests + build)** | `cd frontend && npm run quality:check` |
| **Backend pre-push CI parity (lint + format + tests)** | `cd backend && make lint && make test-fast` |
| Install the `aiplatform` CLI globally | `make cli-install` |
| Verify the `aiplatform` CLI works end-to-end | `make cli-selftest` |
| Scaffold a new sim's frontend wiring | `aiplatform sim scaffold <name>` (uses `frontend/src/_sim-template/`; see `mcp-app-artefact` skill) |
| **Run the CI dep-security gate locally** (before pushing dep changes) | `make security-check` (invokes the same `scripts/security-check.sh` the CI gate runs — see `aipla-security-checkup` skill for triage rubric) |

When adding a new workflow, add it to `scripts/` and the root `Makefile` in the same PR.

> **Pre-push gotcha:** `npm run quality:check:fast` runs lint + typecheck
> + auth-fetch but NOT tests. `make lint` runs ruff check + format-check
> but NOT pytest. If you've touched backend/frontend code and are about
> to push, use the **CI parity** rows above. The faster checks are for
> inner-loop iteration. The LOCAL-MODE-AND-FORK sprint shipped 9 dev
> commits before noticing CI was red because it relied on the fast
> variants.

## Git Policy

- Push with `sunholo-voight-kampff` account (now an `Aitana-Labs` org member)
- GitHub org: `Aitana-Labs` (transferred from `sunholo-data` on 2026-04-14)
- Repo: `Aitana-Labs/platform`
- Never force-push to dev/test/prod
- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`)

## Common Mistakes

### Frontend API Calls
Always use `/api/proxy` to reach the backend — frontend (port 3000) and backend (port 1956) are separate services.

### Wrong Python Environment
Always `cd backend && uv run ...` — never use global `python` or `pip`.

### Copying v5 Code Without Removing Sunholo
Every v5 file has Sunholo imports. Strip them when copying. Replace with direct Firestore/ADK calls.

### Anonymous-Group Auth — the one we keep forgetting
AIPLA has **two** kinds of authenticated user (ADR-001): **teachers** (Firebase
SSO) and **anonymous-group students** (a custom group JWT, `email=""`,
`domain=""`, no `firebase.auth().currentUser`, synthetic `uid`). The inherited
template was built for teachers only, so any identity-touching surface breaks for
students unless explicitly wired. We have shipped this bug **4+ times** — check it
on *every* identity-touching change.

- **Frontend auth helpers (the recurring one).** `fetchWithAuth` sends the
  **group** token (`getIdToken` → anon-group sessionStorage); `fetchWithTeacherAuth`
  sends the **Firebase teacher** token. A student calling a teacher-auth helper
  sends a null token → **401**. A **dual-audience** endpoint (one the backend ACLs
  for *both* roles, e.g. `GET /api/curriculum/{id}/content`) must let the CALLER
  pick — never hardwire one helper for all calls. Student-facing components
  (`components/workspace/*`, `app/lessons/*`, chat) → group token; teacher
  components (`components/teacher/*`, `app/teacher/*`) → Firebase token.
- **Backend.** Guard `User.email` / `User.domain` before using them as Firestore
  keys or gates (empty string → `400 invalid document path` / silent deny). The
  student branch keys off `user.group_id` / `user.group_tags`.
- **Firestore `onSnapshot`.** Gate listeners on `isAnonymousGroupAuthMode()` —
  group JWTs aren't Firebase identities, so client-SDK rules deny them.
- **Streaming agent (AG-UI) on teacher surfaces.** `AGUIProvider` mints the
  stream's `Authorization` token. On a teacher-only chat (`/teacher/analytics`)
  pass `useTeacherAuth` — otherwise it mints the *group* token (or, since
  `useAuth()` is the group context whose `user` is null for a teacher, mints
  **nothing** → stream POST `401: Missing Authorization header`).

Full history + fixes: memory `feedback-anonymous-users-are-corner-case`. New
identity bugs → log them in [docs/upstream-feedback.md](docs/upstream-feedback.md)
(template gap). Smoke: `make smoke-curriculum-content GROUP=<code>`.
