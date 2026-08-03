.PHONY: tf-plan tf-apply tf-local check-iam-posture dev dev-local dev-recompile dev-status dev-stop proxy-check logs cloud-logs cloud-errors cloud-build verify-chat-logs smoke-session-persistence smoke-chat-resume smoke-curriculum-content smoke-teacher-cli help cli-install cli-reinstall cli-uninstall cli-doctor cli-selftest-mock cli-selftest-live cli-selftest seed seed-job seed-demo-codes force-seed-demo reset-group-state provision-curriculum-rag provision-agent-engine copy-docparse-secret seed-curriculum backfill-curriculum-content seed-curriculum-folders check-auth-config migrate-clear-persona-voice-override docs-linkcheck check-skills sim-build sim-build-check guides guides-publish guide-screens seed-guide-corpus guide-staleness

# Seed SKILL.md templates -> Firestore. Since P1.3 the Cloud Build deploy runs
# this automatically via the `aipla-seed-skills` Cloud Run job (see
# `make seed-job` / cloudbuild.yaml), so a normal deploy no longer needs a
# manual seed. This HTTP-based target remains for seeding WITHOUT a deploy
# (e.g. a template tweak you want live before the next build) — it mints an ID
# token and calls the admin endpoint.
#   make seed              # dev (default)
#   make seed ENV=test
seed:
	@scripts/seed-platform-skills.sh $(ENV)

# P1.3 — seed via the Cloud Run JOB (runs as the aipla-v6@ runtime SA; writes
# Firestore directly, no ID-token mint). This is the SAME path Cloud Build runs
# post-deploy; use it to (re)create the job or seed a deployed env from a
# laptop. Derives the backend image from the live service when --image is unset.
#   make seed-job ENV=dev          # create/update the job + run it now
#   make seed-job ENV=dev EXECUTE=0  # create/update only, don't run
seed-job:
	@scripts/deploy-seed-job.sh $(ENV) $(if $(filter 0,$(EXECUTE)),,--execute)

# (Re)assert the demo student join code(s) (default aipla-demo-1, ~300d TTL)
# against a deployed env. Like `seed`, this is a MANUAL post-deploy step (the
# admin mint-demo-group call 403s inside Cloud Build). Run it after a deploy or
# whenever a demo code has lapsed (TTL) / been wiped (clean-slate GROUPS=1),
# else verify-chat-logs / smoke-* (GROUP=aipla-demo-1) break.
#   make seed-demo-codes ENV=dev
#   CODES="aipla-demo-1 aipla-demo-2" make seed-demo-codes ENV=dev
seed-demo-codes:
	@scripts/seed-demo-codes.sh $(ENV)

# Force-seed the CURRENT demo activities into every existing teacher's "Demo
# class" (the onboarding seed no-ops for teachers who already own a class, so
# growing the demo set never reaches them). Idempotent by title. Dry-run unless
# APPLY=1; touches only each teacher's Demo class. Run after the demo set grows.
#   make force-seed-demo ENV=dev            # dry-run (preview)
#   make force-seed-demo ENV=dev APPLY=1    # write
#   make force-seed-demo ENV=dev APPLY=1 OWNER=<uid>   # one teacher
force-seed-demo:
	@cd backend && GOOGLE_CLOUD_PROJECT=aipla-$(ENV)-2026 uv run python -m scripts.force_seed_demo \
		$(if $(filter 1,$(APPLY)),--apply,) $(if $(OWNER),--owner $(OWNER),)

# Clean-slate the anonymous-group session state for an env: wipe the
# group_sessions pointers (always) and chat_sessions mirror (SESSIONS=1),
# optionally the anon_groups codes (GROUPS=1 — invalidates all codes).
# Use when stale group→session pointers orphan history (see the script header).
#   make reset-group-state ENV=dev                 # pointers only
#   make reset-group-state ENV=dev SESSIONS=1      # + chat_sessions metadata
#   make reset-group-state ENV=dev SESSIONS=1 GROUPS=1   # full nuke incl. codes
reset-group-state:
	@scripts/reset-group-state.sh $(ENV) $(if $(filter 1,$(SESSIONS)),--sessions) $(if $(filter 1,$(GROUPS)),--groups)

# Provision the curriculum RAG corpus for an env (1.1.25 M2/M5): enables the
# Vertex AI API, grants IAM, creates/finds the RagManagedDb corpus, stores the
# resource name in Secret Manager, and wires it into the backend Cloud Run env.
# Idempotent. dev is script-provisioned; test/prod use the terraform module.
#   make provision-curriculum-rag ENV=dev
provision-curriculum-rag:
	@scripts/provision-curriculum-rag.sh $(ENV)

# Fill AGENT_ENGINE_ID: create the Vertex Agent Engine (europe-west1) + write the
# secret value. Terraform makes the secret shell; this is the per-env post-apply
# step (part of cutting a new env — see the prod-cut runbook).
#   make provision-agent-engine ENV=test
provision-agent-engine:
	@scripts/provision-agent-engine.sh $(ENV)

# Fill DOCPARSE_API_KEY on a fresh env by copying the value from one that has it.
#   make copy-docparse-secret FROM=dev TO=test
copy-docparse-secret:
	@scripts/copy-docparse-secret.sh $(FROM) $(TO)

# Seed the SHARED corpus with the cleared Danish stx physics material (1.1.25,
# A/B/C læreplan + vejledning). Reads the docparse-parsed markdown from the
# scoping site (NOT in this repo). Prereqs: corpus provisioned
# (provision-curriculum-rag) + aiplatform CLI authed as a teacher. Run ONCE per
# env (each ingest mints a fresh doc id).
#   make seed-curriculum ENV=dev                 # all levels
#   make seed-curriculum ENV=dev LEVELS="A"      # one level
seed-curriculum:
	@CURRICULUM_LEVELS="$(LEVELS)" scripts/seed-curriculum.sh $(ENV)

# Backfill curriculum_content for SHARED docs seeded before 1.1.33 M3 (so the
# læreplan/vejledning are readable in the viewer, not just retrievable). New
# ingests store content automatically — this only fixes the historical gap.
# Idempotent (skips docs that already have content). Add ARGS="--dry-run" first.
#   make backfill-curriculum-content ENV=dev ARGS="--dry-run"
#   make backfill-curriculum-content ENV=dev
backfill-curriculum-content:
	@scripts/backfill-curriculum-content.sh $(ENV) $(ARGS)

# 1.1.60 migration: seed the nine Danish stx physics areas as SHARED curriculum
# folders and relocate docs still carrying a physics area in `subject` (subject
# is now the BROAD class — Fysik/Matematik/... — and the areas are folders).
# Idempotent. Docs with no subject are left for the classifier, not guessed.
#   make seed-curriculum-folders ENV=dev ARGS="--dry-run"
#   make seed-curriculum-folders ENV=dev
seed-curriculum-folders:
	@scripts/seed-curriculum-folders.sh $(ENV) $(ARGS)

# Assert an env's Firebase auth config can actually sign a teacher in
# (authorized domains + the google.com provider). Catches the 2026-08-03 class
# of bug: a console-era setting present on dev and missing on the
# Terraform-cut envs, invisible to every deploy and smoke.
#   make check-auth-config            # all three envs
#   make check-auth-config ENV=prod
check-auth-config:
	@scripts/check-auth-config.sh $(if $(ENV),$(ENV),)

# Clear stale per-class voice overrides on classes that already name a persona,
# so the persona's voice takes effect (fixes "switched persona, avatar changed
# but the spoken voice stayed the old override"). Idempotent. Dry-run first.
#   make migrate-clear-persona-voice-override ENV=dev ARGS="--dry-run"
#   make migrate-clear-persona-voice-override ENV=dev
migrate-clear-persona-voice-override:
	@scripts/migrate-clear-persona-voice-override.sh $(ENV) $(ARGS)

# Verify relative links across the docs tree (default: docs/). Catches the
# link-rot that doc relocations introduce when inbound/outbound paths aren't
# updated. ARGS overrides the scan root, e.g. `make docs-linkcheck ARGS=docs/design/aipla`.
docs-linkcheck:
	@python3 scripts/check-doc-links.py $(ARGS)

# Launch backend (port 1956) + frontend (port 3000) for local development.
# Logs stream to stdout; Ctrl-C stops both.
dev:
	@chmod +x scripts/dev.sh
	@scripts/dev.sh

# Render the user guides (docs/guides/*.qmd) to PDF (+ HTML/DOCX) in
# docs/guides/_output/. Requires quarto + a LaTeX engine (xelatex).
guides:
	@chmod +x scripts/render-guides.sh
	@scripts/render-guides.sh

# Render + publish the guides (HTML + PDF) into frontend/public/guides/ so the
# app serves them for the /guides page and the in-app links.
guides-publish:
	@chmod +x scripts/publish-guides.sh
	@scripts/publish-guides.sh

# Capture real teacher-guide screenshots with Playwright: logs into the deployed
# dev frontend as the test teacher (co-pilot + concept-map features on) and
# writes docs/guides/assets/. Then re-run `make guides` to embed them.
guide-screens:
	@chmod +x scripts/capture-guide-screens.sh
	@scripts/capture-guide-screens.sh

# Seed the how-to guides into the platform itself: ingest the guide PDFs into the
# shared curriculum corpus (subject "AIPLA guides") + an onboarding class with
# teacher + student tutors grounded in them. Dogfoods the product. See the
# scripts/seed-guide-corpus.mjs header (not idempotent).
seed-guide-corpus:
	@chmod +x scripts/seed-guide-corpus.sh
	@scripts/seed-guide-corpus.sh

# Flag guides that may be out of date: compares each guide against the UI
# surfaces it documents (docs/guides/guide-surfaces.json). Heuristic — a prompt
# to look. Add --strict (via scripts/) to fail CI on drift.
guide-staleness:
	@chmod +x scripts/check-guide-staleness.sh
	@scripts/check-guide-staleness.sh

# AIPLA — launch backend + frontend + MCP sandbox in LOCAL_MODE.
# Pre-seeds group code LOCAL and the problem-set-hints skill. Auto-installs
# sandbox node_modules on first run. Ctrl-C stops everything.
# Model auth: GEMINI_API_KEY in backend/.env (Express Mode, no GCP) OR
# `gcloud auth application-default login` (Vertex AI).
dev-local:
	@chmod +x scripts/dev-local.sh
	@scripts/dev-local.sh

# Probe the local dev stack: backend health, frontend proxy, sandbox,
# AND the LOCAL group join. Exits 0 if everything is healthy.
dev-status:
	@chmod +x scripts/dev-status.sh
	@scripts/dev-status.sh

# Soft restart of just the frontend (Next.js): kills listener, clears
# .next, restarts. Backend + sandbox + open browser tabs stay alive.
# Use when chat/page wedges with "Cannot find module './NNN.js'" or
# "/_app" webpack-runtime errors — the recurring stale-.next failure
# mode. dev-local auto-clears .next on cold start; this is the in-
# session equivalent.
dev-recompile:
	@chmod +x scripts/dev-recompile.sh
	@scripts/dev-recompile.sh

# Stop anything listening on the dev ports (1956 / 3456 / 3457). Use when
# dev-local.sh died ungracefully and you need a clean restart.
dev-stop:
	@chmod +x scripts/dev-stop.sh
	@scripts/dev-stop.sh

# Smoke-test the frontend→backend proxy bridge locally.
# Starts both servers, probes /api/proxy/health, then exits.
proxy-check:
	@chmod +x scripts/try-proxy-local.sh
	@scripts/try-proxy-local.sh

logs:
	@scripts/logs.sh

# Tail Cloud Run logs from the deployed frontend (ui container).
# For backend sidecar: `./scripts/cloud-logs.sh tail backend`.
# For sandbox: `./scripts/cloud-logs.sh tail sandbox`.
cloud-logs:
	@chmod +x scripts/cloud-logs.sh
	@scripts/cloud-logs.sh tail

# Show the last 50 errors across all deployed AIPLA services.
cloud-errors:
	@chmod +x scripts/cloud-logs.sh
	@scripts/cloud-logs.sh errors

# Show recent Cloud Build runs + tail the most recent log.
cloud-build:
	@chmod +x scripts/cloud-logs.sh
	@scripts/cloud-logs.sh build

# End-to-end smoke for the chat-log pipeline (SEQUENCE 1.2): join a group,
# drive a real turn, and confirm it reached BigQuery via the report's
# BQ-only mode (?source=bq). Needs no credentials — the group JWT carries
# the whole flow. Override GROUP / ENV:
#   make verify-chat-logs GROUP=aipla-demo-1 ENV=dev
ENV ?= dev
GROUP ?= aipla-demo-1
verify-chat-logs:
	@uv run --directory cli aiplatform --env $(ENV) logs verify $(GROUP)

# 1.F session-persistence smoke: join → bootstrap → rejoin → restore → reset
# Drives a LOCAL_MODE backend; override URL for deployed:
#   make smoke-session-persistence URL=https://aipla-backend-...
smoke-session-persistence:
	@chmod +x scripts/smoke-v1-session-persistence.sh
	@scripts/smoke-v1-session-persistence.sh

# Chat RESUME / history-readback smoke — the demo-readiness gate for the
# reload-shows-history path. Joins a group, ensures a real tutor turn, then
# reads it back through GET /sessions/{id}/messages TWICE (reload sim) and
# asserts persistence + stable readback. No creds (group JWT). Targets the
# DEPLOYED dev frontend proxy by default; override BASE / GROUP:
#   make smoke-chat-resume GROUP=wooly-kettle-61
smoke-chat-resume:
	@chmod +x scripts/smoke-chat-resume.sh
	@scripts/smoke-chat-resume.sh

# Student curriculum-content auth smoke — guards the dual-audience 401 regression
# (commit 71daf47): a student opening a shared doc in the workbench must send the
# anonymous-GROUP token, not the teacher token. Join → resolve active activity →
# read a cited doc → assert AUTHENTICATED (never 401). No creds (group JWT).
# Targets the deployed dev frontend proxy; override BASE / GROUP:
#   make smoke-curriculum-content GROUP=aipla-demo-1
smoke-curriculum-content:
	@chmod +x scripts/smoke-curriculum-content.sh
	@scripts/smoke-curriculum-content.sh

# 1.G-Ph3 teacher CLI smoke: class new/list/get/lessons/groups/delete round-trip
# Requires make dev with LOCAL_MODE=1, or a deployed backend:
#   make smoke-teacher-cli URL=https://aipla-backend-... AIPLATFORM_ID_TOKEN=<token>
smoke-teacher-cli:
	@chmod +x scripts/smoke-v1-teacher-cli.sh
	@scripts/smoke-v1-teacher-cli.sh

# Build-once artifact promotion (tag->test, copy->prod). Wraps
# scripts/promote-env.sh (the single promotion implementation). Defaults to a
# dry-run plan; pass GO=1 to actually submit. Override FROM / TO / VERSION:
#   make promote VERSION=v1.1.40              # dry-run plan (test->prod)
#   make promote VERSION=v1.1.40 GO=1         # submit
#   make promote FROM=dev TO=test VERSION=v1.1.40 GO=1
# See docs/design/aipla/v1.0.0-pilot/build-once-artifact-promotion.md.
FROM ?= test
TO ?= prod
VERSION ?=
GO ?=
promote:
	@chmod +x scripts/promote-env.sh
	@test -n "$(VERSION)" || { echo "VERSION is required (e.g. make promote VERSION=v1.1.40)"; exit 1; }
	@scripts/promote-env.sh --from $(FROM) --to $(TO) --version $(VERSION) $(if $(GO),,--dry-run)

# --- Terraform (infrastructure/env) ---
#
# These drive the Cloud Build triggers, NOT a local terraform binary: the build
# runs as aipla-terraform@ with the enumerated roles, so an apply does not
# depend on whose laptop it was launched from. See
# infrastructure/env/cloudbuild.terraform.yaml.
#
# tf-plan is also runnable ad hoc; the same plan runs automatically on every
# push to dev that touches infrastructure/env/**.

# The ENV guard checks the VALUE, not just presence: `ENV` is a POSIX shell
# variable that make inherits, so it is frequently already set to `dev` in the
# ambient environment. A `test -n "$(ENV)"` guard therefore passes on a bare
# `make tf-apply` and quietly targets dev — the one env the README says must
# never be applied, because doing so adopts live script-provisioned resources.
tf-plan:
	@case "$(ENV)" in test|prod) ;; *) echo "ENV must be test or prod (got '$(ENV)'). dev is plan-only by hand — see infrastructure/env/README.md."; exit 1 ;; esac
	@gcloud builds triggers run aipla-$(ENV)-infra-plan \
		--project=aipla-$(ENV)-2026 --region=europe-north1 --branch=dev

# Applies for real. _CONFIRM=APPLY is the confirmation — the trigger plans and
# stops without it, so this target is the only easy way to mutate infra.
tf-apply:
	@case "$(ENV)" in test|prod) ;; *) echo "ENV must be test or prod (got '$(ENV)'). dev is plan-only by hand — see infrastructure/env/README.md."; exit 1 ;; esac
	@test -n "$(GO)" || { echo "Refusing to apply without GO=1. Run 'make tf-plan ENV=$(ENV)' and read the plan first."; exit 1; }
	@gcloud builds triggers run aipla-$(ENV)-infra-apply \
		--project=aipla-$(ENV)-2026 --region=europe-north1 --branch=dev \
		--substitutions=_CONFIRM=APPLY

# LOCAL terraform — bootstrap and disaster recovery ONLY. Everything routine
# goes through tf-plan/tf-apply above, which run in Cloud Build with no laptop
# credential in the path. Use this when there is no CI to run: a fresh env
# (the triggers are themselves Terraform resources) or an env whose triggers
# have been destroyed.
#
# scripts/tf.sh binds env -> backend prefix -> tfvars from ONE argument, so the
# init and the var-file cannot disagree. That mismatch is what destroyed prod on
# 2026-08-03; never hand-run `terraform init`/`apply` in that directory.
# Assert the IAM posture the repo claims: nobody holds roles/editor, the compute
# default SA is disabled, break-glass owner exists. Exists because a Terraform
# resource reported success having done nothing, and `plan` said "No changes"
# forever afterwards — state cannot be the witness for its own correctness.
check-iam-posture:
	@./scripts/check-iam-posture.sh $(ENVS)

tf-local:
	@test -n "$(ENV)" || { echo "ENV is required, e.g. make tf-local ENV=prod ACTION=plan"; exit 1; }
	@./scripts/tf.sh $(ENV) $(or $(ACTION),plan)

# --- CLI lifecycle ---

# Install the `aiplatform` CLI as a global uv tool. Idempotent: --force
# overwrites any prior install (e.g. the legacy `aitana` / `aitana-cli`
# binary). After this completes, `aiplatform --help` works from anywhere.
cli-install:
	@uv tool install --force --no-cache ./cli  # --no-cache: --force alone reuses a stale build, so new commands are missing
	@echo "Installed: $$(which aiplatform 2>/dev/null || echo '(not on PATH — check ~/.local/bin)')"

# Remove any prior install of this CLI under any historical name.
# Useful when migrating from the pre-2026-04-28 `aitana` binary.
cli-uninstall:
	@-uv tool uninstall aitana-cli 2>/dev/null
	@-uv tool uninstall aitana     2>/dev/null
	@-uv tool uninstall aiplatform 2>/dev/null
	@echo "Removed any previously installed aitana/aiplatform CLI tool."

# Clean reinstall: remove all historical names then install fresh.
cli-reinstall: cli-uninstall cli-install

# Verify the installed CLI matches the source. Catches the symptom that
# led to the 2026-04-28 rename (broken global binary pointing at a stale
# package layout).
cli-doctor:
	@if ! command -v aiplatform >/dev/null 2>&1; then \
	  echo "aiplatform not on PATH. Run: make cli-install"; exit 1; \
	fi
	@aiplatform --version || { echo "aiplatform installed but broken — run: make cli-reinstall"; exit 1; }

# --- CLI self-test ---

# Mock-backend smoke: boots a tiny SSE server on 127.0.0.1:0, runs the
# real `aiplatform skill probe` binary as a subprocess against it, and
# asserts the printed table. No GCP credentials, no network, no live
# backend. The transport-level safety net respx-mocked tests can't be.
cli-selftest-mock:
	@chmod +x scripts/cli-selftest-mock.sh
	@scripts/cli-selftest-mock.sh

# Live-backend smoke. Requires `make dev` running on :1956 + AIPLATFORM_ID_TOKEN
# + AIPLATFORM_SELFTEST_SKILL_ID (or pass the skill id as the first arg).
# Skips cleanly with exit 0 when any prereq is missing — safe for CI.
cli-selftest-live:
	@chmod +x scripts/cli-selftest-live.sh
	@scripts/cli-selftest-live.sh

# Combined self-test: mock smoke (always runs), then live smoke (skipped
# cleanly if backend or auth missing). Single command for "is the CLI
# wired up correctly" — the entry point future agents/teammates use.
cli-selftest:
	@echo "▶ mock smoke …"
	@$(MAKE) --no-print-directory cli-selftest-mock
	@echo
	@echo "▶ live smoke …"
	@$(MAKE) --no-print-directory cli-selftest-live
	@echo
	@echo "✓ aiplatform CLI self-test complete."

# Run the same dep-security audit the CI gate runs (.github/workflows/ci.yml
# security-audit job → scripts/security-check.sh). Use this before pushing
# anything that touches package.json / package-lock.json / pyproject.toml /
# uv.lock to confirm the gate will pass. See:
#   docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md
security-check:
	@scripts/security-check.sh

check-skills: ## Verify CLAUDE.md skill catalogue matches .claude/skills/ (CI-gated)
	@bash scripts/check-skill-catalogue.sh

# Trust-card footgun gate (P1.4). Flags any workspace element that pushes state
# to the tutor (useSimSnapshotPush) without dispatching the visible "shared with
# the AI" card (useHumanToolEvents) — the calculator+table bug. Same script the
# CI local-mode-safety job runs as a blocking check. See the
# workbench-element-builder skill + docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md.
audit-trust-cards: ## Fail if a workspace element pushes to the tutor without a trust card (CI-gated)
	@bash scripts/audit-trust-cards.sh

# Inline the canonical MCP App guest bridge into every artefact index.html from
# the single source of truth (infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js).
# Run after editing the bridge. `sim-build-check` is the CI drift guard.
# See docs/design/aipla/v1.1.0-feedback/shared-mcp-app-bridge.md.
sim-build:
	@node scripts/build-artefact-bridge.mjs

sim-build-check:
	@node scripts/build-artefact-bridge.mjs --check
	@node scripts/check-artefact-broadcast.mjs

help:
	@echo "make dev                — start backend (1956) + frontend (3456) — cloud mode (real GCP/Vertex)"
	@echo "make dev-local          — start backend + frontend + MCP sandbox in LOCAL_MODE (pre-seeded group code: local-demo). Auto-clears .next on launch."
	@echo "make dev-recompile      — soft frontend restart (clears .next, leaves backend/sandbox/browser alive). For mid-session HMR wedges."
	@echo "make dev-status         — probe local dev stack — exit 0 if all healthy"
	@echo "make dev-stop           — kill anything on the dev ports (1956 / 3456 / 3457)"
	@echo "make logs               — stream LOCAL backend logs (OTEL noise filtered out)"
	@echo "make cloud-logs         — tail Cloud Run logs from deployed AIPLA frontend"
	@echo "make cloud-errors       — last 50 errors across deployed services"
	@echo "make cloud-build        — recent Cloud Build runs + last build log tail"
	@echo "  scripts/cloud-logs.sh tail backend|sandbox|all — per-target tail"
	@echo "  scripts/cloud-logs.sh session <id>             — filter by group/session id"
	@echo "  scripts/cloud-logs.sh trace <id>               — open Cloud Trace UI"
	@echo "  scripts/cloud-logs.sh save errors|all          — dump to .dev-logs/"
	@echo "make proxy-check        — smoke-test the proxy bridge (CI helper)"
	@echo "make verify-chat-logs            — e2e smoke: join a group, drive a turn, confirm it reached BigQuery (GROUP=… ENV=…)"
	@echo "make smoke-session-persistence   — 1.F smoke: join→bootstrap→rejoin→restore→reset (requires make dev)"
	@echo "make smoke-chat-resume           — DEMO GATE: join→real turn→read history→reload-read (deployed dev; GROUP=…)"
	@echo "make smoke-teacher-cli           — 1.G-Ph3 smoke: class new/list/get/lessons/groups/delete (requires make dev)"
	@echo
	@echo "make cli-install        — install the aiplatform CLI as a global uv tool"
	@echo "make cli-reinstall      — clean reinstall (uninstalls historical aitana names first)"
	@echo "make cli-doctor         — verify the installed aiplatform CLI is wired correctly"
	@echo "make cli-selftest       — run mock + live smokes (live skips cleanly if no backend)"
	@echo "make cli-selftest-mock  — offline end-to-end (real binary, mock SSE backend)"
	@echo "make cli-selftest-live  — diagnostic against running \`make dev\` backend"
	@echo
	@echo "make security-check     — run the CI dep-security gate locally (frontend + sandbox + backend audits)"
	@echo "make audit-trust-cards  — trust-card footgun gate: fail if a workspace element pushes to the tutor without a card (CI-gated)"
	@echo "make seed-job           — P1.3: seed SKILL.md->Firestore via the aipla-seed-skills Cloud Run job (ENV=dev; same path Cloud Build runs post-deploy)"
	@echo "make check-skills       — verify CLAUDE.md skill catalogue matches .claude/skills/ (CI-gated)"
	@echo
	@echo "make sim-build          — inline the canonical MCP App guest bridge into every artefact (edit bridge/aipla-mcp-bridge.js, then run this)"
	@echo "make sim-build-check    — CI drift guard: fail if any artefact's inlined bridge != the canonical source"
	@echo "make guides             — render user guides (docs/guides/*.qmd) to PDF in docs/guides/_output/"
	@echo "make guide-screens      — capture real teacher-guide screenshots via Playwright (logs into deployed dev as the test teacher)"
	@echo "make seed-guide-corpus  — ingest the guide PDFs into the shared corpus + an onboarding class (teacher + student tutors)"
	@echo "make guide-staleness    — flag guides whose documented UI changed after the guide (heuristic staleness check)"
