# Sprint Plan: SECURITY-PIPELINE — Security monitoring pipeline (1.1.16)

## Summary

Implement the three-layer security pipeline defined in
[security-monitoring-pipeline.md](security-monitoring-pipeline.md): a CI
gate that fails PRs on new high/critical dep CVEs, a weekly cron that
maintains a rolling tracking issue, and a triage skill that codifies
the reachability rubric used in the 2026-06-05 alert sweep.

**Duration:** 1 day (~6h)
**Scope:** Infra (CI workflows + skill); zero application code
**Dependencies:** None (additive on existing [`ci.yml`](../../../../.github/workflows/ci.yml))
**Risk Level:** Low — pure additions, no application surface affected
**Design Doc:** [security-monitoring-pipeline.md](security-monitoring-pipeline.md)
**Parent SEQUENCE row:** [v1.1.0-feedback/SEQUENCE.md](SEQUENCE.md) row 1.1.16

## Current Status Analysis

### Recent Velocity (last 7 days)

- 167 commits, 336 files changed, 37k insertions
- Heavy infra/refactor week (SIM-ERGONOMICS sprint, voice-provider sprint, dep patches)
- Documented velocity for small infra changes: <0.5d per coherent unit (workbench debounce: 0.5d, SVG placeholder: 1.5h, dep triage: ~2h)
- This sprint is **infra + docs only**; estimating ~6h total, no application code, no test-suite regressions expected

### Existing Implementation

- [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) — three jobs (backend, local-mode-safety, frontend); triggers on PR to dev/test/prod + push to dev. Frontend job pins `node-version: "20"`.
- [`Makefile`](../../../../Makefile) — has `make dev`, `make proxy-check`, `make verify-chat-logs`, `make cli-install`, `make cli-selftest`. No security target.
- `.claude/skills/` — populated with project-local skills (`aiplatform-cli`, `aitana-frontend-verify`, `aitana-adk-testing`, `mcp-app-artefact`, `aitana-v6-deploy`, others). Convention: `SKILL.md` with description-frontmatter + body + optional `resources/` / `scripts/`.
- No existing weekly cron workflows; no rolling tracking issues.
- 0 dependabot alerts expected once the 2026-06-05 patches finish reconciling (`084920b` + `1257c08`).

## Proposed Milestones

### Milestone M1 — CI gate (hard merge-block)

**Scope:** Infra (CI workflow)
**Goal:** Adding a new high/critical CVE to any production dep fails CI on PR + push.
**Estimated:** ~80 LOC (workflow YAML) + 0 LOC (no tests; CI is its own verification)
**Duration:** ~1.5h

**Tasks:**
- [ ] Bump frontend job `node-version: "20"` → `"22"` (matches what vitest 4 / vite 6 / next 15 expect; see `1257c08` commit message)
- [ ] Add `security-audit` job to [`ci.yml`](../../../../.github/workflows/ci.yml), parallel with existing jobs:
  - Step: Frontend npm audit (`npm audit --omit=dev --audit-level=high`)
  - Step: Sandbox npm audit (same flags)
  - Step: Backend pip-audit (`uv export --frozen --no-dev` → `uvx pip-audit --requirement <(...) --strict --vulnerability-service osv`)
- [ ] Verify all three commands pass locally against current `dev` HEAD before committing
- [ ] Manual push-to-test-branch sanity check: confirm the job runs and reports green

**Files to Create/Modify:**
- `.github/workflows/ci.yml` (modify, ~+40 LOC: new job; +1 LOC: node bump)

**Acceptance Criteria:**
- [ ] `npm audit --omit=dev --audit-level=high` exits 0 in both `frontend/` and `infrastructure/mcp-sandbox/`
- [ ] `uvx pip-audit --requirement <(uv export --frozen --no-dev) --strict --vulnerability-service osv` exits 0 in `backend/`
- [ ] CI workflow run on dev HEAD shows the new `security-audit` job green
- [ ] CI workflow run does NOT take materially longer than baseline (target: < 90s for the audit job)
- [ ] (Negative test) Temporarily add a known-vulnerable dep on a throwaway branch → CI fails → revert

**Risks:**
- `uvx` may not be available on the GitHub-hosted Ubuntu runner with the cached uv install → mitigation: the `astral-sh/setup-uv@v3` action provides `uvx`; verify with a `uvx --version` step first if uncertain
- `npm audit` may surface mediums in production deps that the design doc said were transitive-only → mitigation: if `--audit-level=high` still finds mediums, that's actually correct behaviour (npm includes "moderate" sometimes); audit-level is a cutoff for the failure, not for what's listed
- Bumping node 20 → 22 might break the existing frontend tests in CI → mitigation: vitest 4 + vite 6 explicitly target Node 22; commit `1257c08` already verified 911 tests pass on Node 22 locally

### Milestone M2 — `make security-check` + CLAUDE.md row

**Scope:** Infra (Makefile + docs)
**Goal:** A developer can re-verify the gate locally before pushing — closes the gap CLAUDE.md's "Automation Principle" table calls out.
**Estimated:** ~50 LOC (shell script) + ~5 LOC (Makefile target + CLAUDE.md row)
**Duration:** ~45min

**Tasks:**
- [ ] Create `scripts/security-check.sh` — runs the three audit commands sequentially with clear per-ecosystem pass/fail output and a single-line summary
- [ ] Add `security-check:` target to root `Makefile` that invokes the script
- [ ] Add row to [CLAUDE.md](../../../../CLAUDE.md) Automation Principle table
- [ ] Verify `make security-check` runs cleanly on current `dev` HEAD

**Files to Create/Modify:**
- `scripts/security-check.sh` (new, ~50 LOC)
- `Makefile` (modify, +2 LOC: new target)
- `CLAUDE.md` (modify, +1 row: Automation Principle table)

**Acceptance Criteria:**
- [ ] `make security-check` exits 0 against current `dev` HEAD
- [ ] Output is clear: each ecosystem reports pass/fail; trailing summary is one line
- [ ] The script invokes the exact same commands as the CI gate's `security-audit` job (single source of truth for the gate logic)
- [ ] CLAUDE.md table includes the row "Verify dep security against the CI gate locally → `make security-check`"

**Risks:**
- Drift between `make security-check` and the CI job (someone updates one but not the other) → mitigation: M5 caps this off by having the CI job *invoke* `scripts/security-check.sh` rather than duplicate the commands inline (see M5 below)

### Milestone M3 — Weekly cron + rolling tracking issue

**Scope:** Infra (workflow + gh CLI usage)
**Goal:** Mon 09:00 UTC every week, a rolling tracking issue gets updated with the current audit state and dependabot alert summary — the forcing function the 2026-06-05 pile was missing.
**Estimated:** ~120 LOC (workflow + embedded bash)
**Duration:** ~1.5h

**Tasks:**
- [ ] Create `.github/workflows/security-weekly.yml`:
  - Trigger: `schedule: cron: '0 9 * * 1'` + `workflow_dispatch` (for manual testing)
  - Job: run `scripts/security-check.sh` (re-using M2's script); capture output
  - Step: query dependabot alerts via `gh api repos/$GITHUB_REPOSITORY/dependabot/alerts` and summarize by severity
  - Step: find rolling issue (search by title prefix `Security audit — week of`); if exists, update its body via `gh issue edit`; if not, open a new one via `gh issue create`
- [ ] Add `dependabot-alerts` permission to the workflow (via `permissions:` key)
- [ ] Manual `workflow_dispatch` trigger from `dev` HEAD → verify issue opens/updates with sensible body content

**Files to Create/Modify:**
- `.github/workflows/security-weekly.yml` (new, ~120 LOC)

**Acceptance Criteria:**
- [ ] `gh workflow run security-weekly.yml` triggers a successful run
- [ ] After the run, a single issue exists with title matching `Security audit — week of YYYY-MM-DD`
- [ ] Issue body contains: (a) audit script output summary, (b) dependabot alert counts grouped by severity, (c) a "next steps" link to the design doc
- [ ] Re-running the workflow updates the existing issue rather than opening a duplicate
- [ ] The workflow has minimum-required permissions (`contents: read`, `issues: write`, `security-events: read`)

**Risks:**
- Default `GITHUB_TOKEN` may lack dependabot-alerts read permission → mitigation: set explicit `permissions:` block in the workflow; document any fallback if PAT is needed
- gh CLI issue-search query syntax differences between API and CLI → mitigation: use `gh issue list --search 'in:title "Security audit — week of"'` and pin the format
- Cron timing collision with deploys on Monday mornings → unlikely (the cron only reads + posts; doesn't touch infra), but worth flagging

### Milestone M4 — `aipla-security-checkup` skill (triage runbook)

**Scope:** Infra (project-local skill)
**Goal:** A human (M now, P2 or UCPH IT later) invokes the skill to walk through a fresh alert pile with the reachability rubric the 2026-06-05 triage developed.
**Estimated:** ~250 LOC (SKILL.md prose + ~80 LOC embedded commands/examples)
**Duration:** ~1.5h

**Tasks:**
- [ ] Create `.claude/skills/aipla-security-checkup/SKILL.md` with frontmatter:
  - `description:` short summary + trigger phrases ("security check", "dependabot triage", "vulnerability sweep", "run the security audit", "triage the security pile")
- [ ] Body sections:
  - Source-of-truth pointer to [security-monitoring-pipeline.md](security-monitoring-pipeline.md)
  - **The reachability rubric** (direct prod / transitive / dev-only / deprecated → action class)
  - **Per-ecosystem commands** (npm audit, pip-audit, dependabot alerts via gh api, npm ls path tracing)
  - **Override conflict pattern** (npm rejects overrides on direct deps — enumerate which packages must be bumped directly vs which can be overridden, based on the 2026-06-05 experience)
  - **CI re-verification step** — invoke `make security-check` to confirm the gate will pass before pushing
  - **When to defer vs apply** — major-version migrations like vitest 1→4 vs simple patch overrides
- [ ] Cross-link entry in CLAUDE.md "Project Skills" section (the table that lists `aipla-security-checkup` alongside `aiplatform-cli`, `aitana-frontend-verify`, etc.)
- [ ] Verify the skill auto-loads via Skill tool (test trigger phrase: "/aipla-security-checkup")

**Files to Create/Modify:**
- `.claude/skills/aipla-security-checkup/SKILL.md` (new, ~250 LOC)
- `CLAUDE.md` (modify, +1 row in "Aitana-specific operational skills" listing)

**Acceptance Criteria:**
- [ ] Skill file at `.claude/skills/aipla-security-checkup/SKILL.md` with valid frontmatter
- [ ] Frontmatter `description:` ≤ 200 chars; trigger phrases cover the patterns in the design doc
- [ ] Body covers all four ecosystems (frontend npm, sandbox npm, backend Python, dependabot alerts via gh api)
- [ ] Cross-references the design doc as the policy source
- [ ] CLAUDE.md "Project Skills" section lists the new skill

**Risks:**
- Skill description string format constraints — must match the existing pattern in CLAUDE.md → mitigation: mimic the `aiplatform-cli` description shape

### Milestone M5 — Wire CI gate to `scripts/security-check.sh` (single source of truth)

**Scope:** Infra (CI workflow)
**Goal:** Refactor M1's inline audit steps to invoke `scripts/security-check.sh` from M2, so the gate logic lives in one place. Prevents the drift M2's risk callout flagged.
**Estimated:** ~10 LOC (workflow consolidation)
**Duration:** ~15min

**Tasks:**
- [ ] Refactor M1's `security-audit` job: replace the three inline audit steps with a single step that invokes `scripts/security-check.sh`
- [ ] Add an `uvx pip-audit` install/verify step before the script call to ensure runner has `uvx` available
- [ ] Re-verify CI run still passes
- [ ] Document the single-source-of-truth design in the script header

**Files to Create/Modify:**
- `.github/workflows/ci.yml` (modify, -30 LOC inline steps, +5 LOC script-invocation step)
- `scripts/security-check.sh` (modify, +5 LOC: header docstring noting it's the gate's single source of truth)

**Acceptance Criteria:**
- [ ] CI's `security-audit` job invokes `scripts/security-check.sh`, not inline commands
- [ ] `make security-check` and the CI job produce identical pass/fail outcomes
- [ ] Drift is now structurally impossible: changing the audit logic means changing the script, and both surfaces follow

**Risks:**
- GitHub Actions YAML quoting differences between runner invocation and local invocation → mitigation: keep the script POSIX-portable; test it on macOS (local) + Ubuntu (runner)

## Day-by-Day Breakdown

This is a one-day sprint. Single block of work, three checkpoints.

### Day 1

#### Morning block (~3h) — Critical-path layer 1: the gate

- **M1: CI gate** (~1.5h)
  - Verify the 3 audit commands pass locally on current `dev` HEAD
  - Add the `security-audit` job to `ci.yml`
  - Push to a throwaway branch to confirm the workflow triggers + passes
  - **Checkpoint:** dev push to a feature branch shows green `security-audit` in Actions

- **M2: `make security-check`** (~45min)
  - Author `scripts/security-check.sh`
  - Wire `make security-check` target
  - Update CLAUDE.md Automation Principle table
  - **Checkpoint:** `make security-check` runs green on `dev` HEAD

- **M5: Wire CI to script** (~15min)
  - Refactor M1's job to invoke the script
  - Re-verify CI still passes
  - **Checkpoint:** CI job uses `scripts/security-check.sh`; single source of truth

#### Afternoon block (~3h) — Layers 2 + 3: cron + skill

- **M3: Weekly cron** (~1.5h)
  - Create `security-weekly.yml`
  - Implement the rolling-issue logic with `gh issue list/create/edit`
  - Manual `workflow_dispatch` to verify the issue opens correctly
  - **Checkpoint:** Rolling issue `Security audit — week of 2026-06-09` exists with sensible body

- **M4: Triage skill** (~1.5h)
  - Author `.claude/skills/aipla-security-checkup/SKILL.md`
  - Add to CLAUDE.md project-skills table
  - Test trigger via `Skill` tool invocation
  - **Checkpoint:** Skill loads cleanly; runbook covers all 4 ecosystems

#### Wrap-up (~15min)

- Single commit per milestone (5 commits total) OR one consolidated commit (preferred for an atomic sprint deliverable)
- Push to `dev`
- Verify GitHub Actions shows the new workflows
- Mark sprint complete; move sprint doc to `implemented/`

## Quality Gates

After each milestone:

```bash
make security-check                          # Verify the gate's command surface
gh workflow run ci.yml --ref <branch>        # Verify the workflow runs on a real ref
```

After all milestones:

```bash
# Sanity: full audit run, mimic what the cron will do
scripts/security-check.sh                    # local
gh workflow run security-weekly.yml          # remote
gh issue list --search 'in:title "Security audit"' --state open
```

## Success Metrics

- [ ] CI's `security-audit` job runs on every PR + push, exits green against current `dev`
- [ ] `make security-check` works locally; identical outcome to the CI job
- [ ] Weekly cron schedule is registered; manual trigger produces/updates the rolling issue
- [ ] `aipla-security-checkup` skill is discoverable and runnable
- [ ] CLAUDE.md updated: Automation Principle table + Project Skills listing
- [ ] No regression on existing CI jobs (backend, frontend, local-mode-safety)
- [ ] Zero application code touched

## Dependencies

- None blocking. The sprint is purely additive infra on top of the existing CI surface.
- The dep-patch commits (`084920b` + `1257c08`) need to have reconciled with dependabot so the gate passes on first push — verified manually before opening the gate to avoid landing it on a red baseline.

## Open Questions

None blocking. Two design-doc-level questions surface again here for execution clarity:

1. **Node bump scope** — bumping just the frontend job's node version (M1) leaves the new `security-audit` job free to use the same `node-version: "22"` setup. Backend job is unchanged (Python).
2. **`uvx` availability** — `astral-sh/setup-uv@v3` action installs uv which provides `uvx`. Confirmed by a quick check at script-authoring time; if the action's version pin changes, M1's first run will reveal it.

## Notes

- Sprint is intentionally infra-only — no application code, no test-suite changes, no design decisions left open.
- Critical path is M1 + M2 + M5 (the CI gate + local parity). If only the critical path ships in this sprint, the gate alone closes the "regressions land silently" risk and M3 + M4 can be deferred.
- The design doc's "Implementation order" had 6 steps; this plan consolidates step 1 into M1 (node bump is part of the gate work) and lifts the design's step-1+step-2 separation since they're a single coherent change.
- Sprint follows the existing AIPLA pattern: design doc + sprint doc + (eventually) move both into `implemented/` once shipped.
