# Security monitoring pipeline — CI gate + scheduled audit + triage skill

**Status:** Planned (P1)
**Last Updated:** 2026-06-05
**Priority:** P1 — UCPH IT review + parent/teacher scrutiny in the pilot make a defensible dependency-security posture a pilot-readiness requirement. Closing the 20-alert pile on 2026-06-05 (commits `084920b` + `1257c08`) revealed the gap.
**Estimated:** ~0.5d for the CI gate + cron, ~0.5d for the triage skill
**Scope:** Continuous-integration gate that fails PRs on new high/critical CVEs across all three dep surfaces (frontend npm, sandbox npm, backend Python), plus a weekly cron that opens / updates an issue with the alert summary, plus an `aipla-security-checkup` skill that documents the human triage runbook. Wires into the existing [`ci.yml`](../../../../.github/workflows/ci.yml) rather than running as a separate workflow so the gate is part of the standard merge-block, not a side-channel.
**Dependencies:** None — purely additive on existing CI. Existing dependabot alerts on the repo continue to be the source of truth; this design adds an enforced gate + a process around them.
**Cross-link:** [aipla-security-checkup skill](../../../../.claude/skills/aipla-security-checkup/SKILL.md) (to be created per this doc); follows up on `084920b` + `1257c08` triage commits.

## Why this matters now

AIPLA runs in a UCPH research context. Three concrete pressures land on the dependency posture:

1. **Pilot teachers and (anonymised) students start using the deployed surfaces on 2026-08-14.** Anything that ships in the dep tree at that point becomes part of the privacy-and-security story UCPH IT will review. The handover audience after 2026-09-15 includes P2, AR, DS, ZL, and UCPH IT — none of whom have the context of M's session-level triage decisions. Audit history needs to be self-evident in the repo.
2. **The 20-alert pile that surfaced on the 2026-06-05 push** (4 critical, 14 medium, 2 low) had been accumulating for weeks without anyone noticing — dependabot alerts are only visible when someone opens the GitHub security tab. Push-time warnings are the only proactive surface, and they don't actually fail anything. The pile sat unread because there was no forcing function.
3. **AIPLA's dep graph is unusually shaped for a Strand-A AI app.** Frontend pulls Firebase, MCP SDK, ag-ui, recharts, KaTeX, react-markdown. Backend pulls Google ADK, three LLM vendor SDKs, AILANG-Parse, asyncpg. Sandbox is small (Express + esbuild + supertest) but it's the *one Cloud Run service that serves untrusted iframes*, so its dep posture matters disproportionately. Three surfaces × frequent updates = continuous attack-surface drift unless monitored.

The CI gate prevents net-new vulnerabilities from landing on `dev`. The weekly cron catches retroactive disclosures (a CVE published against a version already in the lockfile). The skill turns "20 alerts in the security tab" into a clean triage walk for whoever inherits it.

## Design

The pipeline has three layers, deliberately separated so each fails-closed for a different class of risk:

```
PR opens / pushes to dev
        │
        ▼
  [Layer 1 — CI gate]  fails on new HIGH/CRITICAL in dep tree
        │
        ├─ frontend:  npm audit --omit=dev --audit-level=high
        ├─ sandbox:   npm audit --omit=dev --audit-level=high
        └─ backend:   pip-audit -r <(uv export --frozen --no-dev)
        │
        ▼
  Merge to dev (CI green)
        │
        │  ... time passes; new CVEs get disclosed ...
        │
        ▼
  [Layer 2 — Weekly cron]  every Monday 09:00 UTC
        │
        ├─ Runs the same three audits (incl. dev deps this time)
        ├─ Opens/updates the rolling tracking issue
        │     "Security audit — week of YYYY-MM-DD"
        └─ Tags @sunholo-voight-kampff for triage
        │
        ▼
  [Layer 3 — Triage skill]  invoked by human (M / P2 / UCPH IT)
        │
        ├─ Pulls dependabot alerts via gh api
        ├─ Groups by ecosystem + reachability classification
        ├─ Recommends npm overrides vs direct bumps vs defers
        └─ Cross-links to this design doc as the policy reference
```

### Layer 1 — CI gate (the blocker)

A new job in [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) — same triggers as the existing backend/frontend/local-mode-safety jobs (PR to dev/test/prod, push to dev).

Job spec:

```yaml
  security-audit:
    name: Security audit (deps)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"  # vitest 4 + vite 6 need ≥20.19; jump to 22 LTS

      - name: Frontend — npm audit (production deps, high+critical)
        working-directory: frontend
        run: npm audit --omit=dev --audit-level=high

      - name: Sandbox — npm audit (production deps, high+critical)
        working-directory: infrastructure/mcp-sandbox
        run: npm audit --omit=dev --audit-level=high

      - name: Set up uv
        uses: astral-sh/setup-uv@v3
        with:
          version: "latest"
          enable-cache: true
          cache-dependency-glob: backend/uv.lock

      - name: Backend — pip-audit (production deps)
        working-directory: backend
        run: |
          uv export --frozen --no-dev --no-emit-workspace > /tmp/requirements.txt
          uvx pip-audit --requirement /tmp/requirements.txt --strict --vulnerability-service osv
```

Why these specific knobs:

- **`--omit=dev` (npm) + `--no-dev` (uv export)** — focuses the gate on production-reachable code. The 2026-06-05 triage spent half its time on dev-only vitest CVEs that nobody could actually reach. Dev-time vulns land in the weekly cron, not the merge-block.
- **`--audit-level=high` (npm)** — high + critical block merges; medium and low show up in weekly cron. We considered `medium` (stricter) but the 14 mediums in the 2026-06-05 pile would have been false-positive-heavy at PR time — they were nearly all transitive deps with low real-world reachability. Keep the bar at "this could be a real issue in this codebase" rather than "this is a CVE that exists somewhere in the dep tree."
- **`pip-audit --strict`** — fails on any vulnerable dep found (Python doesn't have npm's tiered audit-level). Parity with the npm gate's behaviour.
- **`--vulnerability-service osv`** — OSV is the canonical Google-maintained vulnerability database used by both pip-audit and Dependabot; consistency across the two surfaces.
- **Node 22** — vitest 4 + vite 6 work on Node ≥ 20.19. CI currently pins `node-version: "20"` which resolves to latest 20.x; that's fine *today* but a future GitHub runner update could break us. Pin to 22 LTS to match what the upgraded test runner expects and stop tracking 20.x drift.

The audit step runs in parallel with the existing `frontend` / `backend` jobs, so PR turnaround doesn't slow down.

### Layer 2 — Weekly cron (the catcher)

A separate workflow at `.github/workflows/security-weekly.yml` on `schedule: cron: '0 9 * * 1'` (Monday 09:00 UTC = 10:00 CET, before M's typical workday starts).

It runs the same three audits — but this time *includes* dev deps (so vitest-style CVEs are surfaced) — and posts the consolidated summary as a body update to a single rolling issue titled `Security audit — week of YYYY-MM-DD`. Using one updated-in-place issue (rather than opening a new one weekly) avoids notification fatigue: the issue stays open, the body shows the latest scan, and only a substantive change (new CVE / dropped count) triggers a notification ping.

Why a workflow instead of just relying on Dependabot:

- Dependabot already alerts on newly-disclosed vulns — that's how the 2026-06-05 pile was discovered.
- But Dependabot has no scheduled cadence; alerts pile up silently in the security tab until someone opens it.
- This cron gives the human a single weekly inbox-touchpoint: "look at this issue, decide what to do." That's the forcing function the 2026-06-05 pile was missing.

The cron job also runs `gh api repos/$REPO/dependabot/alerts -q '...'` to attach the current dependabot alert count to the issue body, giving one view of both audit-tool output and dependabot's higher-quality CVE classification.

### Layer 3 — Triage skill

A new project-local skill at `.claude/skills/aipla-security-checkup/SKILL.md`. Triggers documented in the frontmatter so it auto-loads when the user says any of:

- *"run the security audit"*, *"check dependabot"*, *"vulnerability sweep"*, *"triage the security pile"*
- After Monday 09:00 UTC when the weekly issue posts, M can `/aipla-security-checkup` to walk the latest scan

The skill encodes:

1. **The reachability rubric** that drove the 2026-06-05 triage:
   - Direct production dep + criticality → patch immediately, separate PR per ecosystem
   - Transitive dep + criticality + patch available → `npm overrides` or `uv` constraint
   - Dev-only dep + any severity → schedule a tooling-upgrade session, don't block dev
   - Transitive + deprecated package + no fix → wait for upstream, document expectation
2. **The commands** for each ecosystem (npm audit, pip-audit, gh api / dependabot, npm ls path tracing)
3. **The override conflict pattern** — npm rejects overrides on direct deps; the skill enumerates which packages must be bumped directly vs which can be overridden
4. **The CI re-verification step** — after applying patches, the skill instructs running the gate's exact commands locally (`npm audit --omit=dev --audit-level=high`) so the user knows the merge will pass *before* pushing
5. **Cross-link to this design doc** as the policy of record (threshold choices, the `--omit=dev` decision, the cadence)

The skill is the human-triage backup. It does NOT run on a schedule itself — the Layer-2 cron does that. The skill is invoked when there's something to actually decide.

### Branch promotion policy

Promotion gates (per CLAUDE.md AIPLA Fork Context) are `dev → test` and `test → prod` PRs. The security gate runs on **all PRs targeting `dev`, `test`, or `prod`** (matching the existing ci.yml triggers). For promotion PRs, this means a `test → prod` PR must re-pass the audit gate at promotion time — catching the case where `test` was green when last touched but a CVE was disclosed in the intervening interval.

This is the right shape for AIPLA: nothing pages anyone when a CVE drops; the next promotion PR catches it and forces the discussion before the patch reaches production.

## Implementation order

| # | Step | Effort | Notes |
|---|---|---|---|
| 1 | Bump CI node from "20" → "22" in `ci.yml` frontend job | trivial | Matches what the vitest 4 / vite 6 upgrade expects; standalone PR or part of step 2 |
| 2 | Add `security-audit` job to `ci.yml` (parallel with existing jobs) | ~0.5h | Three audit steps; verify they pass against current `dev` HEAD before opening the gate |
| 3 | Add `.github/workflows/security-weekly.yml` cron + rolling issue logic | ~1h | Use `gh issue list --search` to find the rolling issue or open one; update body via `gh issue edit` |
| 4 | Add `.claude/skills/aipla-security-checkup/SKILL.md` with rubric + commands | ~1.5h | Reference this doc as the policy source |
| 5 | First weekly cron fires Mon 2026-06-08 09:00 UTC | — | First fire reveals any rough edges; iterate from there |
| 6 | Document the gate in CLAUDE.md Automation Principle table | 0.25h | Adds a row: "Run the security audit locally → `make security-check`" with a small make target wrapping the three audit commands |

Steps 1 + 2 are the hard gate; everything else is the surrounding process. If only one of these ships, ship 1 + 2 — that alone closes the "regressions land silently" risk.

## Axiom alignment

| # | Axiom | Score | Justification |
|---|---|---|---|
| 1 | INSTANT FEEL | 0 | Audit runs in parallel with existing CI jobs; no impact on PR turnaround. |
| 2 | EARNED TRUST | **+1** | Closes the gap exposed on 2026-06-05: alerts that sat in the security tab for weeks because nothing surfaced them. UCPH IT + parent/teacher scrutiny in the pilot benefits from an enforced gate over a "we'll check periodically" posture. |
| 3 | SKILLS, NOT FEATURES | 0 | Adds a project-local skill but the gate itself is CI tooling, not a user-facing skill. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model routing impact. |
| 5 | GRACEFUL DEGRADATION | 0 | The gate fails-closed (blocks merge) which is the point; the weekly cron degrades gracefully (it'd skip a week if GitHub is down without losing data). |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Uses npm-native + pip-native audit tools + OSV (the canonical vulnerability database both pip-audit and Dependabot use). Zero custom security tooling; if AIPLA later switches CI providers, the audit commands stay identical. |
| 7 | API FIRST | 0 | No API surface change. |
| 8 | OBSERVABLE BY DEFAULT | **+1** | The weekly issue is the observability surface — current alert count + severity distribution in one place, updated in place each week. Was previously a silent state inside GitHub's security tab. |
| 9 | SECURE BY CONSTRUCTION | **+1** | Architectural enforcement: PRs *cannot* land with new high/critical CVEs in production deps. Replaces "developer discipline checks the security tab" with a build-time invariant. Hard-fail rule check: this axiom must score +1 for any feature introducing new data-access patterns — this *prevents* new data-access vulnerabilities, so +1 is the right read. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | No client-side impact. |
| 11 | USABLE BY DESIGN | 0 | Internal infrastructure; no student-facing surface. |

**Net score:** +4 — acceptable. No conflicts. Hard-fail rules clear (no -1 anywhere; SECURE BY CONSTRUCTION scores +1 which is required given this introduces a new build-time security boundary).

## Alternatives considered

### A. Dependabot auto-PRs (rejected as sole mechanism)

GitHub Dependabot can open PRs for vulnerable deps automatically. Configured via `.github/dependabot.yml`.

**Why not as the sole mechanism:** Dependabot opens one PR per dep. The 2026-06-05 pile would have generated 8+ PRs that each need to be reviewed, tested, and merged. The CI gate proposed here catches the *aggregate* condition (any PR landing with new high/critical) and the human handles all bumps in one batch. Dependabot auto-PRs are useful as a *complement* — they tell you "this dep can be bumped to fix vuln X" — but they're not a gate.

**Possible follow-up:** enable Dependabot auto-PRs in a separate change once the gate is stable. With the gate in place, an auto-PR that fixes a vuln auto-passes; the developer just merges.

### B. GitHub Advanced Security CodeQL (rejected as primary)

CodeQL adds static-analysis vulnerability detection on top of dep-audit. It's powerful but:

- Requires GitHub Advanced Security on the repo (licensing question for `sunholo-data` org)
- Scans for code-level vulnerabilities (SQL injection, XSS in our own code), not just dependency CVEs
- Runs slowly (10+ min per scan)

This is **worth revisiting post-pilot** as a hardening step but is out of scope for the pilot-readiness window. The current proposal focuses on the immediate gap: dependency CVE drift.

### C. Threshold at "medium" instead of "high+critical" (rejected for now)

Stricter would catch more. But:

- The 2026-06-05 pile had 14 mediums and only 1 was actually exploitable in production reach (the next.js XSS); the others were transitive deps in cold paths.
- A noisier gate generates pressure to bypass it (`-- || true`-style PR comments). The gate has to feel justified each time it blocks.
- The weekly cron catches mediums; they just don't block merges.

**Re-evaluate** after 4–6 weeks of operation: if the cron consistently surfaces mediums that turn out to be real, tighten the PR-gate threshold to medium. If it surfaces mediums that consistently turn out to be noise, keep the current bar.

### D. External monitoring service (rejected)

Snyk, Socket, Mend, etc. all have dependency-monitoring SaaS offerings. They're more capable than the npm/pip-native audit pipeline.

**Why not:** Conflicts with Axiom 9's *trust-boundary-is-the-GCP-project-edge* principle — these tools require sending the full dep graph (sometimes including lockfile metadata) to a third-party service. For an academic-research project under UCPH GDPR posture, the marginal extra coverage isn't worth the egress story we'd have to justify. The OSV-backed pipeline keeps the dep-graph data inside GitHub + npm + the GCP build infra.

## Open questions

1. **Alert thresholds for the `prod` branch specifically.** Currently the gate fires the same way for PRs to `dev`, `test`, and `prod`. Should `prod` have a stricter threshold (any vuln, including medium)? Argument for: prod is what teachers/students hit. Argument against: medium-severity false positives create promotion friction without actually moving the security needle. Default for now: same threshold everywhere; revisit after the first pilot iteration.
2. **Should the weekly issue page someone on net-new critical?** Current proposal is just a rolling issue. A net-new critical CVE between weekly scans + before the next merge PR will sit unnoticed for up to a week. Possible upgrade: cron also POSTs to a Slack webhook (if/when one exists) on net-new critical, escalating beyond the rolling issue. Out of scope for v1 but worth the followup.
3. **Backend pip-audit vs uv's built-in audit (when it ships).** `uv` has historically deferred to pip-audit but is reportedly adding native audit support. When that lands, swap `uvx pip-audit` for native and remove the requirements.txt export step — one less moving part.
4. **Sandbox tests-as-deploy-block.** The sandbox CI doesn't currently exist as a separate job. The audit step proposed here scans `infrastructure/mcp-sandbox/package.json` but doesn't run the sandbox's tests on PRs. Consider adding the sandbox tests + lint to ci.yml in a follow-up — same diff, separate scope.

## References

- 2026-06-05 triage commits: `084920b` (first 15 alerts patched), `1257c08` (final 5 incl. vitest 4 migration)
- [Product Axioms](../../../product-axioms.md) — Axiom 9 SECURE BY CONSTRUCTION drives the gate-not-monitor design
- [CLAUDE.md AIPLA Fork Context](../../../../CLAUDE.md) — branch promotion policy + "any local workflow that takes more than one manual step must have a script or make target"
- [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) — existing CI surface that this extends
- [aipla-security-checkup skill](../../../../.claude/skills/aipla-security-checkup/SKILL.md) — human triage runbook implementing this design's Layer 3
