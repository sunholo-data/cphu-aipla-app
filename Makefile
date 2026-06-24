.PHONY: dev dev-local dev-recompile dev-status dev-stop proxy-check logs cloud-logs cloud-errors cloud-build verify-chat-logs smoke-session-persistence smoke-chat-resume smoke-curriculum-content smoke-teacher-cli help cli-install cli-reinstall cli-uninstall cli-doctor cli-selftest-mock cli-selftest-live cli-selftest seed reset-group-state provision-curriculum-rag seed-curriculum backfill-curriculum-content migrate-clear-persona-voice-override docs-linkcheck

# Seed SKILL.md templates -> Firestore after a deploy that changed any template
# (avatar, multimodalInput, persona, tools, accessControl, instructions). A code
# deploy does NOT propagate SKILL.md -> Firestore for already-registered skills,
# and the seed token-mint can't run inside Cloud Build (403) — so this is run
# manually post-deploy. The CI `seed-reminder` job nudges when a template changes.
#   make seed              # dev (default)
#   make seed ENV=test
seed:
	@scripts/seed-platform-skills.sh $(ENV)

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
