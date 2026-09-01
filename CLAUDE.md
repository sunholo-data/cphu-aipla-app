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

**The scoping site is a separate Quarto repository, `sunholo-data/aipla`**
(published at <https://www.sunholo.com/aipla/>; checked out on this machine at
`~/dev/sunholo-data/aipla`). Its public-safe content has been
audited and migrated into this app. Maintained English project copy now lives
under `frontend/content/project/` and renders at `/project`, including nested
activity case studies. Every Markdown file must include content status, owner,
reviewed date, review deadline, order, and navigation visibility. Run
`cd frontend && npm run check:project-content` after editing it.

Use the legacy source for historical AIPLA design; do not restore it wholesale
or treat its volatile schedules, model rankings, API-key demos, and hosting
claims as current public facts:

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

**How to cite the scoping site from a doc in this repo (P4.2, 2026-09-01).**
Never with a `file://` path. 138 citations used to resolve on one laptop only,
which made every ADR reference a dead link for anyone else — including AD, who
starts ~1 Oct with no in-person overlap with M.

| Citing | Use |
|---|---|
| One of the 10 **rendered pages** (`index`, `about`, `strands`, `examples`, `timeline`, `architecture`, `evaluation`, `self-hosting`, `led-planck`, `kinebot`) | `https://www.sunholo.com/aipla/<page>.html#anchor` |
| A **prototype brief** (`strand-a-pedagogical-bot/prototypes/*.md`, tracked but not rendered) | the pinned snapshot: [`docs/design/aipla/_scoping-snapshot/prototypes/`](docs/design/aipla/_scoping-snapshot/) |
| Anything in `briefs/`, `notes/`, `admin/`, `sources/` | **no link** — name the file as plain text and mark it private |

`scripts/check-local-path-links.sh` (`make check-local-path-links`) fails the
build on any reintroduced ``` (local path — not in this repo)`, so this cannot
silently regress.

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
| Default branch | `dev` (template's `main` deploys to dev env) | **`dev` is the only branch.** It is the default, the working branch, and the only one that deploys. `main` does not exist (renamed to `dev` on 2026-05-19). `test` / `prod` branches **were deleted on 2026-07-30** — they had sat at the May-2026 bootstrap commit since the fork and were never the promotion mechanism, which made them actively misleading. Promotion is tag-based; see "Environment promotion" below. |
| Skills | Aitana skill set | Physics-specific (v1: `problem-set-helper-config`, `concept-dialogue-config`, `manage-class`, student problem-set hints, student conceptual exploration) — see `strands.qmd` |
| Auth | Firebase Auth (student + teacher) | **Anonymous group IDs for students** (ADR-001), UCPH SSO for teachers |
| Document parsing | Generic | **AILANG Parse** (ADR-004) — 13 deterministic formats, 2 AI |
| Model providers | Gemini / Claude / OpenAI | 4 tiers (ADR-003): cloud API · self-hosted GPU cluster (DeepSeek) · server-local (Qwen / Gemma) · on-device (Apple Intelligence / Gemini Nano) |

### Skills referencing Aitana

The `.claude/skills/` directory still contains Aitana-named skills
(`aitana-frontend-verify`, `aitana-adk-testing`).
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
npm run dev            # Next.js dev (raw: port 3000)
npm run build          # Production build
npm run quality:check:fast  # Lint + typecheck
```

> Use **`make dev`** (from the repo root) for the normal dev loop — it binds the
> frontend to **3456** (via `scripts/dev.sh`, because 3000 is often taken) and
> starts the backend together. Only a raw `npm run dev` uses 3000.

### Server Ports
- Frontend: **http://localhost:3456** (`make dev`; a raw `npm run dev` uses 3000)
- Backend API: http://localhost:1956
- ADK Playground: http://localhost:8501

## Deployment

Same GCP projects as v5, but v6 runs as **new parallel Cloud Run services** so v5 stays untouched during bring-up. DNS cutover is a separate later decision.

- **Project IDs**: `aitana-multivac-dev`, `aitana-multivac-test`, `aitana-multivac-production` (unchanged)
- **v6 Cloud Run services**: `aitana-v6-backend`, `aitana-v6-frontend` (new; live in dev once CI-WIRE lands)
- **v5 Cloud Run services**: `backend-api`, `frontend` (still running, will be decommissioned after DNS cutover)
- **WHO MAY SPEND → [docs/ops/runbooks/access-requests.md](docs/ops/runbooks/access-requests.md)**
  — the access register (visitor/pilot), where `/teacher-access` requests land, and how to
  review and grant them. **An empty register means every account on that env is a visitor**,
  including established teachers — so a fresh deploy needs `scripts/grandfather_access.py`
  in the SAME change window.
- **HOW TO DEPLOY → [docs/ops/runbooks/deploy.md](docs/ops/runbooks/deploy.md)**
  is the runbook for all three environments (dev: push `dev` · test: push a `v*`
  tag · prod: `make promote`). Read it before deploying anything; the summary
  below is orientation, not instructions. It also covers **running two versions
  side by side for A/B research** — tagged Cloud Run revision URLs per class,
  with `revision` stamped on every chat-log row as the arm key.
- **Branch deployment (v6)**: `dev` → dev. `dev` is the only branch in the repo.
- **Environment promotion (AIPLA — TAG-based, not branch-based).** All three
  environments are live, cut from committed Terraform (`infrastructure/env/`):
  dev, test (v0.1.0, 2026-07-27) and prod (v0.1.1, 2026-07-28). Promotion is
  **artifact-based**: a `^v.*$` git tag fires `aipla-test-release`, then
  `make promote VERSION=<tag> FROM=test TO=prod` (`scripts/promote-env.sh`,
  dry-run by default, `GO=1` to submit) copies the built artifact onward. See
  [docs/design/aipla/v1.0.0-pilot/build-once-artifact-promotion.md](docs/design/aipla/v1.0.0-pilot/build-once-artifact-promotion.md).
  There are **no `test` / `prod` branches** — they were deleted on 2026-07-30
  after sitting at the fork's bootstrap commit for two months and causing a
  wrong "test/prod were never deployed" conclusion. **Never infer an
  environment's state from git refs.**
  **[docs/ops/deployed-urls.md](docs/ops/deployed-urls.md) is the source of truth
  for what is live in each environment.**
- **Cloud Build connection**: `github-voight` in `multivac-deploy-aitana/europe-west1` (authorizer `sunholo-voight-kampff`). v5 still uses the older `github` connection.
- **SA for Cloud Run**: `aitana-v6@{project_id}.iam.gserviceaccount.com`
- **CI gate**: `.github/workflows/ci.yml` — lint + test-fast on PR and push to `dev`.
- **Post-deploy smoke**: both `cloudbuild.yaml` pipelines end with a smoke step that curls critical endpoints and fails the build on any non-200. Run the same checks from a laptop with `./scripts/smoke-deployed.sh [dev|test|prod] [all|frontend|backend]`. Live service URLs are recorded in [docs/ops/deployed-urls.md](docs/ops/deployed-urls.md).
- **Auto-seed on deploy (P1.3, since 2026-07-23):** the Cloud Build pipeline now seeds `backend/skills/templates/**/SKILL.md` → Firestore automatically, as its last step, via the **`aipla-seed-skills` Cloud Run job** (`scripts/deploy-seed-job.sh`, invoked from `cloudbuild.yaml`). The job runs **as the runtime SA (`aipla-v6@`)** and writes Firestore directly through ADC — no HTTP, no ID-token mint — so it sidesteps the old Cloud-Build 403 that made this a manual step. It runs `python -m admin.platform_seed`, which **exits non-zero on any failed template, failing the build** (a bad seed can no longer silently ship). No new IAM: the build already deploys the *service* as `aipla-v6@` (needs `run.admin` + `actAs`), which suffices to create + run the job. **First-deploy caveat:** the very first `dev` build after this merges will create the job; if that build's seed step fails, run `make seed-job ENV=dev` locally to diagnose. The `seed-reminder` CI job's warning is now belt-and-braces.
- **Seed WITHOUT a deploy (manual):** to push a template change live before the next build, `make seed ENV=dev` (= `scripts/seed-platform-skills.sh dev`, the HTTP path) still works. Symptom of a stale seed: "shipped feature works in tests but the deployed app shows the old skill data."

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

**AIPLA operational skills** (load when debugging the platform). Every skill named
here exists in `.claude/skills/` — a CI check (`scripts/check-skill-catalogue.sh`)
fails the build if this list ever names one that doesn't:

- **`aitana-adk-testing`** — ADK session/event/artifact inspection via the HTTP endpoints `get_fast_api_app(web=True, ...)` ships. Use when the question is "where do messages live", "did the loader save the artifact", or anything that bypasses the Firestore mirror.
- **`aitana-frontend-verify`** — Drive a real Chrome via the chrome-devtools MCP to verify frontend behaviour static checks can't see (SSE streams, hydration, auth state, DOM after click).
- **`aipla-security-checkup`** (AIPLA-specific) — Triage runbook for the dep-security pile (frontend npm + sandbox npm + backend Python). Load whenever the CI gate's `security-audit` job fails, when the Monday weekly rolling issue surfaces a CVE, or when the user says "run the security audit", "triage dependabot", or "is this gate going to pass". Encodes the reachability rubric (direct prod / transitive / dev-only / deprecated) from the 2026-06-05 sweep + the per-ecosystem command tree + the `npm overrides` conflict pattern. Policy of record: `docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md`.
- **`guide-maintenance`** — keep the user-facing how-to guides (`docs/guides/`) in sync with the product: render, screenshot-capture on deployed dev, publish into the app, seed the in-product corpus + onboarding tutors, staleness check. Load when guides go stale or a documented UI surface changes.

> **Referenced-but-not-present skills.** Earlier drafts of this file named
> `aiplatform-cli`, `aitana-v6-deploy`, `aitana-template-publish`, and
> `cloud-run-diagnostics`. **These are not in `.claude/skills/` — do not try to
> load them.** Their runbooks are being extracted into `docs/ops/runbooks/`
> (audit item P4.3): **dev→test→prod promotion is DONE —
> [docs/ops/runbooks/deploy.md](docs/ops/runbooks/deploy.md) (2026-07-30)**.
> Still unextracted: CLI debugging + token-mint, template publish, Cloud Run
> diagnostics — that knowledge lives in the `aiplatform` CLI README
> (`cli/README.md`) and `cloudbuild*.yaml`.

**Cross-project skills** (used everywhere, not Aitana-specific):

- **`adk-cheatsheet` / `adk-dev-guide` / `adk-eval-guide` / `adk-deploy-guide` / `adk-scaffold`** — ADK API + lifecycle references.
- **`agent-protocols`** — Vendored snapshots of the four-protocol stack the platform speaks: Agent Skills (`SKILL.md` format), AG-UI (streaming transport), A2UI (declarative UI), MCP + MCP Apps (interactive iframes). Load when writing a design doc that touches any of these or when answering *"is this A2UI, MCP App, or AG-UI?"* (they get confused often). References are local files so they survive spec-site outages and are quotable in design docs. Should ship in the upstream template — see [docs/upstream-feedback.md](docs/upstream-feedback.md).
- **`mcp-app-artefact`** (AIPLA-specific) — How to ship a new MCP App artefact (Boldkast sim, future physics sims): the static-artefact path under `infrastructure/mcp-sandbox/artefacts/<name>/v<version>/`, the ADR-013 security gates (200 KB cap, no external fetches, sandboxed iframe + CSP), the decision tree for static-artefact vs dynamic MCP server, the AIPLA-side frontend wiring (shared `SimFrameHeader`, `useSimSnapshotPush`, `frontend/src/_sim-template/` scaffold + `aiplatform sim scaffold <name>` CLI), and the Cloud Build / Cloud Run wiring (`aipla-mcp-sandbox-deploy` trigger, `aipla-v01-sandbox` service). Load whenever the user says "add a sim", "new artefact", "deploy a sandbox iframe", "scaffold a sim", or references Boldkast / LED-Planck / KineBot / jitt-dk / mcp-sandbox.
- **`workbench-element-builder`** (AIPLA-specific) — Wire a new student-facing workbench/activity element (table, calculator, checklist, future ones) so it reaches the tutor on BOTH surfaces: the `useSimSnapshotPush` → iframe-context state push AND the visible `useHumanToolEvents.dispatch` "shared with the AI" trust card. Encodes the decision rule by interaction shape (one-shot → card per action; continuous entry → debounced card; sends a real turn → no card; read-only → no card), copy-paste snippets, test stubs, and an `audit-trust-cards.sh` that flags any element that pushes without carding. Load when adding a workbench element, when "the AI didn't see what the student did", or wiring/debugging the trust card. Exists because the card half kept getting dropped (calculator + table). Recipe of record: `docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md` (steps 4 + 4b).
- **`design-doc-creator`** — scaffolds new design docs in the right v6.X.Y layout, scores against product axioms, registers in SEQUENCE.md.
- **`sprint-planner` / `sprint-executor` / `sprint-evaluator`** — the planning → execution → quality-check loop for non-trivial work.
- **`skill-builder`** (global) — for creating/optimizing skills like the ones above.

**These skills expand as the project grows.** When a recurring debug task or workflow emerges that's worth >10 minutes per session of re-derivation (auth incantations, multi-step CLI sequences, architecture lookups), it's signal to add a new skill or extend an existing one — invoke `skill-builder` to do it cleanly. New skills must be added to the catalogue above (the CI check enforces the reverse: no catalogue entry may name a missing skill).

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
| **Seed SKILL.md templates → Firestore** — *automatic on deploy since P1.3* (Cloud Build runs the `aipla-seed-skills` job) | `make seed-job ENV=dev` (job path, same as CI) · `make seed ENV=dev` (HTTP path, seed without a deploy) |
| **(Re)assert demo student join codes (e.g. `aipla-demo-1`) — manual, like seed; demo codes lapse on TTL/clean-slate** | `make seed-demo-codes ENV=dev` |
| **Seed the in-product how-to guides** (shared corpus + onboarding tutors) — manual, per env, NOT part of any deploy. Idempotent, so re-run to publish updated guides | `make seed-guide-corpus ENV=dev` |
| Smoke-test proxy bridge | `make proxy-check` |
| Verify chat-log pipeline e2e (join → turn → BigQuery) | `make verify-chat-logs GROUP=<code> ENV=<env>` |
| Backend tests (fast) | `cd backend && make test-fast` |
| Frontend quality check (inner dev loop, no tests) | `cd frontend && npm run quality:check:fast` |
| **Frontend pre-push CI parity (tests + build)** | `cd frontend && npm run quality:check` |
| **Backend pre-push CI parity (lint + format + tests)** | `cd backend && make lint && make test-fast` |
| **Verify the IAM posture** — state cannot witness its own correctness | `make check-iam-posture` |
| **Plan the infra layer** (also runs on every push to `dev` touching `infrastructure/env/**`) | `make tf-plan ENV=test\|prod` |
| **Apply the infra layer** — Cloud Build, as `aipla-terraform@`, not your laptop | `make tf-apply ENV=test\|prod GO=1` |
| Install the `aiplatform` CLI globally | `make cli-install` |
| Verify the `aiplatform` CLI works end-to-end | `make cli-selftest` |
| Scaffold a new sim's frontend wiring | `aiplatform sim scaffold <name>` (uses `frontend/src/_sim-template/`; see `mcp-app-artefact` skill) |
| **Run the CI dep-security gate locally** (before pushing dep changes) | `make security-check` (invokes the same `scripts/security-check.sh` the CI gate runs — see `aipla-security-checkup` skill for triage rubric) |
| **Run the trust-card footgun gate locally** (after adding/editing a workspace element) | `make audit-trust-cards` (same `scripts/audit-trust-cards.sh` the CI `local-mode-safety` job runs — see `workbench-element-builder` skill) |
| **Check Cloud Build step scripts before pushing a pipeline edit** | `make check-cloudbuild` (same script the CI `local-mode-safety` job runs) |
| **Run the brand-drift gate locally** (after touching /project or any brand colour) | `make check-brand-literals` (same `scripts/check-brand-literals.sh` the CI `local-mode-safety` job runs) |
| **Check the published guides still link back into the app** | `make check-guide-nav` (`make guides-publish` runs it automatically) |

When adding a new workflow, add it to `scripts/` and the root `Makefile` in the same PR.

> **Pre-push gotcha:** `npm run quality:check:fast` runs lint + typecheck
> + auth-fetch but NOT tests. `make lint` runs ruff check + format-check
> but NOT pytest. If you've touched backend/frontend code and are about
> to push, use the **CI parity** rows above. The faster checks are for
> inner-loop iteration. The LOCAL-MODE-AND-FORK sprint shipped 9 dev
> commits before noticing CI was red because it relied on the fast
> variants.

## Footguns & their guards

The bugs this repo has shipped repeatedly. Each row says whether a machine catches
it (**enforced**) or you must remember (**manual**). The handover goal is to drive
every row to *enforced* — see `docs/design/aipla/v1.1.0-feedback/handover-maintainability-audit.md` (P1).

| Footgun | Symptom | Guard | Status |
|---|---|---|---|
| **Dual-auth wrong token (frontend)** | student calls a teacher-auth helper → 401 | pick `fetchWithAuth` (student/group) vs `fetchWithTeacherAuth` (Firebase) by surface; dual-audience endpoints let the caller pick | **partly enforced** — eslint `no-restricted-imports` (`frontend/.eslintrc.json`) fences teacher (`app/teacher`, `components/teacher`) and student (`app/lessons`, `app/chat`, `components/{workspace,chat,doc-browser,protocols}`) surface dirs against the wrong helper (P1.1 Step 1); the role-typed `api.student.*`/`api.teacher.*` client (Step 2) is the remaining follow-on |
| **Dual-auth teacher gate (backend)** | divergent "is this a teacher?" predicates | one `auth.guards.assert_teacher` (predicate `not user.is_teacher`); students carry a group JWT | **partly enforced** — curriculum + teacher_prefs migrated (2026-07-22); `test_dual_auth_rejection` nets it |
| **Route imports the Firebase-ONLY `get_current_user`** | every anonymous-group student 401s "Invalid token" on that endpoint — unrecoverably, because the token is fine. Diagnostic signature: one endpoint 401s while `/api/auth/group/pulse` 200s for the SAME group, SAME token | import from `auth` (the dispatcher), never `auth.firebase_auth`; `scripts/check-auth-dispatcher.sh` (`make check-auth-dispatcher`) | **enforced** (CI `local-mode-safety`, 2026-08-14) — writing/checklist/concept progress all had it; student writing autosave 401'd on prod for every group, so text lived only in a tab-scoped buffer and died with the tab. **Each route's tests `dependency_overrides` the same wrong symbol the route imports, so they pass in lockstep with the bug** — only a REAL minted group token through the REAL dispatcher witnesses it (`tests/api_tests/test_dual_auth_rejection.py`) |
| **Seed after SKILL.md change** | "works in tests, deployed app shows old skill data" | Cloud Build post-deploy `aipla-seed-skills` job (`scripts/deploy-seed-job.sh`); `make seed`/`make seed-job` for no-deploy seeds | **enforced** — on BOTH pipelines since 2026-08-04, and a failed seed reds the build. `cloudbuild.yaml` had it from P1.3 but `cloudbuild.promote.yaml` never did, and prod is reached only by promote — so prod's skill docs sat frozen at its 2026-07-28 env cut for a week |
| **Trust card dropped** | tutor gets element state but student sees no "shared with AI" card | `scripts/audit-trust-cards.sh` (`make audit-trust-cards`) | **enforced** (CI `local-mode-safety` job, P1.4) |
| **Single-`$` shell var in a Cloud Build step** | build dies at SUBMIT with "key in the template is not a valid built-in substitution" — and only on the pipeline you edited, which for promote means only when you next ship to prod | `scripts/check-cloudbuild-substitutions.py` (`make check-cloudbuild`) | **enforced** (CI `local-mode-safety` job) — a *comment* naming a shell variable broke the first v0.1.9 promote on 2026-08-04; Cloud Build never gets as far as bash, so comments are not comments |
| **Full-overwrite activity POST** | partial payload silently wipes activity data | send the COMPLETE element+sim payload; `useActivityBuilder.elementPayload()` | **partly enforced** — `useActivityBuilder.test.ts` nets the FE; backend twin is P1.5 |
| **CLI installs a stale build** | new `aiplatform` commands missing | `make cli-install` bakes in `--no-cache` | **enforced** |
| **Group code used on the wrong environment** | student enters a valid code, gets 401 "code not found" — the code was minted in a *different* env (Firestore is per-project) | `GET /api/environment` (runtime, never build-time) + `EnvironmentBanner` names dev/test on every page; the class page hands out a full join **link** (`…/group?code=`), not a bare code | **partly enforced** — the label + link are shipped; nothing *stops* a teacher reading a code aloud. Cost a teacher ~2h on 2026-08-04 |
| **CLAUDE.md names a missing skill** | agent told to load a skill that doesn't exist | `scripts/check-skill-catalogue.sh` | **enforced** (CI `local-mode-safety` job) |
| **New public page ships with no footer** | a framing surface has no route to privacy/terms/credits | put the route in `src/app/(site)/` — the group layout renders `SiteFooter` structurally; own-shell surfaces (`/teacher`, `/lessons`) mount it themselves | **enforced** (1.1.74) — `route-chrome-coverage.test.ts` fails by filename on a public page outside the group, and separately asserts `/chat/*` still renders none. Per-page mounting had already been forgotten on `/guides` and `/lessons` |
| **Brand colour hardcoded instead of tokenised** | two brand primaries in one app | use `bg-brand`/`text-brand`/`primary` (KU red `#901A1E`), never a `red-*` literal on a brand surface | **enforced** (1.1.74) — `scripts/check-brand-literals.sh` (`make check-brand-literals`). `--primary` was the inherited Sunholo **orange** while `/project` hardcoded KU red, so the homepage CTA and `/project`'s CTA were different colours under the same KU coat-of-arms. Semantic reds (error, recording) are allowlisted by name + reason. Dark mode carries a **lightened** brand because KU red scores only ~2.2:1 on the dark background — `brand-contrast.test.ts` asserts both modes |
| **Terraform reports success having done nothing** | state says a hardening is applied; the project disagrees; `plan` says "No changes" forever | `scripts/check-iam-posture.sh` (`make check-iam-posture`) compares DEPLOYED IAM against what the posture requires | **manual** — `google_project_default_service_accounts` did exactly this on 2026-08-03 (`service_accounts = {}`, SA left enabled with `roles/editor`) |
| **A checker answers when it could not read its subject** | `make deploy-status` reports "test and prod are level" having read nothing — the *reassuring* answer is the one a broken read produces | never let a read failure fall into the same bucket as a real value; `deploy-status.sh` classifies "Cannot find service" (→ `(not deployed)`) apart from auth/permission (→ `(CANNOT READ)`, no verdict, exit 1), and prints the account it used | **enforced for `deploy-status`** (2026-08-13) — `2>/dev/null` turned PERMISSION_DENIED into an empty image string → `(not deployed)` on all three envs, and two of those compare EQUAL. Under the wrong gcloud account it declared parity it had not checked, in the script written *because* the promote step must not trust an unverified number. Audit any other `2>/dev/null` before trusting its verdict. **Second instance, 2026-08-18:** the spend gate could not tell "this group has no owner" from "Firestore did not answer", so neither could fail closed without the other taking every lesson down on a blip. `auth.spend_authority` now raises on unreadable and refuses only on a real answer |
| **Anything per-env in `cloudbuild.yaml` needs a `cloudbuild.promote.yaml` twin** | a per-env value corrected on the deploy path never reaches prod — prod is reached only by `make promote` | promote re-stamps per-env **env vars** (`APP_VERSION`, `MCP_WIDGET_DOMAIN`, guarded non-empty) **and** passes per-env **build-args** (`_AIPLA_HELP`, `_AUTHORING_COPILOT`, `_CONCEPT_MAP`) — both halves matter, and it runs the seed job | **partly enforced** — the guard covers today's values; a new `--set-env-vars` or `--build-arg` in `cloudbuild.yaml` without a promote twin re-opens it. Bitten three ways: `MCP_WIDGET_DOMAIN` sat on DEV's origin in prod until 2026-08-04; the feature flags were never passed at all, so no tfvar could light up prod; and the seed step was missing entirely |
| **A money gate joins on a denormalised field** | every teacher reads as UNCAPPED and every student's owner reads as "not on the register" — and both silently mean ALLOW. `users list-access` looks perfectly correct; only the `uid` column is null | one join, `db.teacher_access.grant_for_uid`, which falls back from the uid index to the register's email primary key and stamps on the way through; `scripts/backfill_register_uids.py` fills existing rows | **partly enforced** (2026-08-18) — 17 of 18 prod rows had `uid: null` because it was written only on a tier CHANGE, and a teacher granted while already signed in never changes tier, so the rows that got stamped were exactly the ones nobody used. The cap had never bound for anyone: 30 days of logs, zero `budget.block`. Regression tests net both halves; nothing stops a NEW gate re-deriving its own `("uid", "==", …)` query. **Spend was also metered under the CALLER** (a group code) while the cap was resolved through the payer, so a teacher got one full cap per class — only a test with TWO group codes can see that |
| **A startup dependency on something no code reads** | instances fail to start on an infra blip, for a resource the app never touches. Prod was unstartable ~8h on 2026-08-28/29 on `volume (type: gcs, name: gcs_config): mount operation failed` | before adding a volume/mount/secret to a deploy step, grep that something reads it; `_CONFIG_FOLDER=/gcs_config` was inherited from Sunholo v5 at the fork's initial commit and read by nothing for three months, over three EMPTY buckets | **manual** — removing it from the pipelines is only half: `gcloud run deploy` AND `services update` both preserve volumes they are not told to drop, so a live service keeps one long after the YAML forgets it. Prod never had it in `cloudbuild.promote.yaml` at all and carried it anyway, inherited from its env cut |
| **Wrong terraform state for the var-file** | apply compares env A's state to env B's config and destroys everything | `scripts/tf.sh <env> <action>` binds prefix+tfvars from one argument; `terraform_data.env_guard` refuses the plan | **enforced** — cost prod's entire data plane on 2026-08-03 |

Full history + fixes for the dual-auth one: memory `feedback-anonymous-users-are-corner-case`.

## Git Policy

- Push with `sunholo-voight-kampff` account (now an `Aitana-Labs` org member)
- GitHub org: `Aitana-Labs` (transferred from `sunholo-data` on 2026-04-14)
- Repo: `Aitana-Labs/platform`
- Never force-push to dev/test/prod
- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`)

## Common Mistakes

### Frontend API Calls
Always use `/api/proxy` to reach the backend — frontend (port 3456 via `make dev`) and backend (port 1956) are separate services.

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
