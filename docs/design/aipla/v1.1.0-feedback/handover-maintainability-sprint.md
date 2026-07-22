# Sprint Plan: HANDOVER-HARDENING — Maintainability & handover readiness

## Summary

Execute the [handover-maintainability audit](handover-maintainability-audit.md):
resolve the unresolved fork identity, delete/quarantine the dead+dormant surface,
turn the recurring footguns into CI gates, single-source config, and finish the
half-adopted shared helpers — **keeping behaviour identical throughout.** This is
the handover-readiness superset of the [June DRY sprint](simplification-refactor-sprint.md)
(whose quick wins shipped but whose god-file big rocks did not — carried here as
Phase 3).

**Duration:** ~14–18 working days across the phases (P0 ≈ 2–3 days, P1 ≈ 3–4,
P2 ≈ 3–4, P3 ≈ 6–8 post-pilot, P4 ≈ 5+ across the handover window)
**Scope:** Fullstack + repo/docs/infra · **Risk:** Low for P0–P2, item-gated for P3–P4
**Dependencies:** the June 145-test characterization net (in place); no new deps for P0
**Design doc:** [handover-maintainability-audit.md](handover-maintainability-audit.md)

> **Refactor, not features.** Success = behaviour unchanged, repo legible to a
> non-M human + AI agents. Net LOC is negative (we delete/quarantine dead surface).
> Every milestone ends green on the CI-parity gates. P0 is freeze-safe and lands
> before the 2026-08-14 pilot; P3/P4 are post-pilot.

## Current status analysis

- **Branch/tree:** working on `dev`; only `backend/pyproject.toml` + `uv.lock`
  carry unrelated in-flight edits — leave those untouched.
- **Safety net:** the June characterization suites (`teacherApi`, `useActivityBuilder`,
  `chat-page-characterization`, `test_dual_auth_rejection`, `test_app_assembly`,
  plus the gold-standard `group_id_auth` / `useSkillAgent` suites) are green and gate
  the P3 cuts. Verify "done" against git + code, never the sprint JSON (it drifts).
- **Corrections applied during audit** (trust-but-verify): `useArtefactReportEvent`
  is **not** dead (the `_sim-template/` scaffold imports it — keep); the Email
  channel is **not** provably dead (`backend/cloudbuild.yaml` wires `MAILGUN_*`);
  the two cloudbuild files disagree on channel secrets.

## Milestones

Two independent tracks (repo/docs vs code) in P0; interleave freely. Ordered by
(handover-leverage ÷ effort ÷ risk).

---

### M1 — Identity resolution *(P0)*
**Scope:** docs/config · **Risk:** Low · **Duration:** ~0.5 day · **Behaviour:** none changed
**Goal:** the first files a newcomer/agent reads describe AIPLA, correctly.

- [ ] P0.1 — rewrite `README.md` as the AIPLA front door (what it is · run-locally · doc-map · agents→CLAUDE.md); re-skin `WORKSHOP.md` + `CONTRIBUTING.md` (repo `sunholo-data/cphu-aipla-app`, sequence `docs/design/aipla/SEQUENCE.md`, commit-to-`dev`/no-PR workflow)
- [ ] P0.2 — fix the dev port to **3456** in `README.md`, `CLAUDE.md` (×3)
- [ ] P0.3 — reconcile the CLAUDE.md skill catalogue with `.claude/skills/` (drop/relabel the 4 phantom refs, add `guide-maintenance`); add a CI check that fails if CLAUDE.md names a non-existent skill

**Acceptance:** zero "Aitana Platform v6" identity claims in root front-door files; documented port == bound port; every catalogued skill exists on disk (CI-checked).

### M2 — Dead-code deletion *(P0, pure subtraction)*
**Scope:** fullstack · **Risk:** Low · **Duration:** ~0.5 day · **Behaviour:** none (all verified zero-ref)
**Goal:** remove code/indexes that provably do nothing, so a reader isn't misled.

- [ ] P0.6 — delete 5 verified-dead frontend modules + tests: `VoiceStatusPill`, `PersonaHeader`, `ReadOnlyComposer`, `insights/KpiStrip`, `hooks/useMcpAppMessages`; and the orphan route `app/skill/[skillId]/settings/` (no inbound links). **Keep `useArtefactReportEvent`** (sim-scaffold dependency).
- [ ] P0.11 — delete backend orphans: `adk/live_agent.py`, the `Message`/`UserProfile` models in `db/models/__init__.py`, the empty `utils/` package, the 3 empty test-placeholder dirs; move run-once `scripts/migrate_*`/`backfill_*` to `scripts/archive/`
- [ ] P0.5 — delete the 10 dead Firestore indexes (`assistants` ×6, `userPreviews` ×3, `messages` ×1) — zero query refs confirmed

**Acceptance:** `npm run quality:check` + `make lint && make test-fast` green; deleted-module tests removed with their modules; `firebase deploy --only firestore:indexes` clean (or index file valid).

### M3 — Cruft + doc navigability *(P0)*
**Scope:** repo/docs · **Risk:** Low · **Duration:** ~0.5 day · **Behaviour:** none
**Goal:** a tidy tree with a single "which doc is real" answer.

- [x] P0.9 — `git rm -r --cached .dev-logs/` (8 tracked, gitignored); deleted stray root `node_modules/`; added `.pytest_cache/` to `.gitignore`; relocated `feedback-2026-*.md` into `docs/design/aipla/v1.1.0-feedback/` (+ updated the one inbound reference). `.template-fork-target` left as-is (pinning needs a known-good upstream SHA — deferred to M).
- [x] P0.8 — added `docs/design/README.md` doc-map (AIPLA→`aipla/SEQUENCE.md`; product→scoping site; template dirs labelled inherited-history). **Did NOT physically move `v6.0.0/1/2`** — ~30 live code comments backlink to those paths (e.g. `ttft-instrumentation.md`), so a move would 404 them and trip `docs-linkcheck`. The doc-map delivers the navigability win without the link-rot; a physical archive is only worth it if those code backlinks are rewritten first.

**Acceptance:** `git status` clean of scratch artifacts; `docs/design/` has one obvious entry point. ✅

### M4 — CLAUDE.md resolution *(P0, load-bearing — do carefully)*
**Scope:** docs · **Risk:** Med · **Duration:** ~0.5–1 day · **Behaviour:** none (agent-facing doc)
**Goal:** bake AIPLA reality in; promote the footgun/gotcha section; ~40% smaller.

- [ ] Bake AIPLA project IDs / `dev` default / sidecar topology / port 3456 into the prose; delete the template-vs-AIPLA diff scaffolding
- [ ] Promote the anonymous-group-auth + seed footgun sections to the top, **verbatim** (they encode incident history)
- [ ] Move stable reference (protocol stack, v5-copy patterns) to linked `docs/`

**Acceptance:** M review (load-bearing for agents); no gotcha lost; a fresh agent reads identity+footguns before any template body.
**Risk mitigation:** paired with M's review before merge; keep a full diff.

### M5 — Footgun CI gates *(P1)*
**Scope:** fullstack/CI · **Risk:** Low–Med · **Duration:** ~3–4 days · **Net:** `test_dual_auth_rejection`, `useActivityBuilder`
**Goal:** the 4×-shipped bug classes fail a build, not a human's memory.

- [ ] P1.1 — `no-restricted-imports` banning `fetchWith*Auth` outside `src/lib/**`; then a role-typed API client (`api.student.*` / `api.teacher.*`, explicit `as` for dual-audience)
- [ ] P1.2 — collapse the 3 divergent teacher gates onto `auth/guards.py::assert_teacher` (delete curriculum's 11 inline + teacher_prefs' copy; router-level `Depends`); add `assert_student`; extract `mark_researcher_bypass(span)`; one app-level `PermissionError` handler
- [ ] P1.3 — automate post-deploy seed via a Cloud Run job (runs as runtime SA; sidesteps the Cloud Build token-mint 403)
- [ ] P1.4 — wire `scripts/audit-trust-cards.sh` into CI as a blocking check
- [ ] P1.5 — backend regression test: a partial activity-config POST is rejected/merged, never silently truncated
- [ ] P1.6 — one "Footguns & their guards" table (enforced vs manual)
- [ ] P1.7 — "Canonical helpers — use these, don't re-roll" section in backend/frontend CLAUDE.md + a CI grep guard against banned inline re-rolls

**Acceptance:** each footgun has a red-on-violation gate; `test_dual_auth_rejection` stays green; no behaviour change.

### M6 — Config single-source + extensibility *(P2)*
**Scope:** backend/infra/CLI · **Risk:** Low · **Duration:** ~3–4 days
**Goal:** "what do I set?" and "how do I add a sim?" answerable from one place.

- [ ] P2.1 — `config/settings.py` (pydantic-settings) single-sources env; generate `.env.example`/`config doctor` from it
- [ ] P2.2 — add `pricing` to `models.yaml`; delete the 2 hardcoded price tables; route judge/summarise/TTS models through `default_model()`; one region helper
- [ ] P2.3 — right-size the provider-tier docs (cloud-Gemini is the only wired tier); make dead Claude/OpenAI branches fail loudly
- [ ] P2.4 — fold "add a sim" into one `aiplatform sim new <name>`; fix stale `infrastructure/mcp-sandbox/README.md` names
- [ ] P2.5 — single `smoke-deployed.sh` called by both cloudbuilds + CLI
- [ ] P2.6 — `scripts/README.md`; `make smoke` umbrella; self-documenting `make help`; archive one-offs

**Acceptance:** one place enumerates every env var; retiring a model touches 1 file; `make help` lists every target.

### M7–M11 — June big rocks *(P3, post-pilot, each gated on its net)*
Per the [June sprint](simplification-refactor-sprint.md) M5–M9, still safe (nets exist):
- [ ] B1 `auth/ownership.py` load-and-assert guard (gate: activities+voice ownership tests)
- [ ] F1 decompose `ChatShell` (gate: Chrome-MCP before/after)
- [ ] API-client factory collapsing the 58 wrappers (net: `teacherApi.test.ts`)
- [ ] B5 split `fast_api_app.py` + `ROUTERS` list (net: `test_app_assembly`)
- [ ] B4/F4 flatten `create_agent` via `compose_instruction_providers` (gate: `make eval`)
- [ ] F5 split `auth/group_id_auth.py`; F6 split `useSkillAgent`; B7/B8 service layer
- [ ] Route-file consolidation + `ApiModel` base; `tests/api_tests/conftest.py`
- [ ] Frontend state: one `useCurrentSessionId`; folder convention; merge duplicate hook pairs

### M12+ — Infra reproducibility + human docs *(P4, handover window)*
- [ ] P4.1 finish Terraform (increment 2) + one `post-apply-env.sh` + `terraform plan` drift-check in CI
- [ ] P4.2 publish scoping-site public snapshot into `docs/design/aipla/_scoping-snapshot/`; fix `file:///` ADR links
- [ ] P4.3 extract human runbooks to `docs/ops/runbooks/`; rename `aitana-*` skills → `aipla-*`
- [ ] P4.4 move the hardcoded admin email out of `firestore.rules` → custom claim
- [ ] P4.5 index `v1.1.0-feedback`; finish the `implemented/` migration

---

## Items needing M's decision before execution

- **Channels (P0.10):** quarantine vs delete — needs confirmation whether any
  channel carries real traffic; reconcile the two divergent cloudbuild files first.
- **Budget subsystem (P0.11):** make it real (register an enforcer at startup) vs
  remove the 600 no-op LOC. Default if no decision: **leave as-is**, flagged.
- **CLAUDE.md rewrite (M4):** load-bearing for agents — merge behind M review.

## Quality gates (after each milestone)

```bash
cd frontend && npm run quality:check        # CI parity: tests + build (not :fast)
cd backend && make lint && make test-fast
```
After P3 FE god-files: a Chrome-MCP pass (`aitana-frontend-verify`). After P3 B7/B8: `make eval` == baseline.

## Success metrics

- [ ] Newcomer can clone, read README, run one command, reach the app on the right port — no "Aitana".
- [ ] Every catalogued skill exists (CI); every Makefile target in `make help`.
- [ ] The 4 footgun classes each fail a CI gate.
- [ ] `.env.example` + `firestore.indexes.json` describe only what's real.
- [ ] Fresh env = one `terraform apply` + one post-apply command.
- [ ] Zero behaviour change: CI-parity gates green at every milestone; `make eval` == baseline after P3.

## Notes

- Execution order this session: **M1 → M2 → M3** (freeze-safe P0), each a commit on
  a `chore/handover-hardening-p0` branch, left for M to review + ff-merge (no push
  without ask). M4–M12 follow in later sessions / post-pilot.
- Sprint-state JSON will drift — verify against git + code.
