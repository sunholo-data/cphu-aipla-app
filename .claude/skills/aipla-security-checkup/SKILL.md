---
name: aipla-security-checkup
description: >
  Triage runbook for AIPLA's dependency security pile. Use whenever the
  CI gate's `security-audit` job fails on a PR, when the Monday weekly
  rolling issue surfaces a new CVE, or when a developer says "run the
  security audit", "check dependabot", "vulnerability sweep", "triage
  the security pile", or "is this gate going to pass". Encodes the
  reachability rubric (direct prod / transitive / dev-only / deprecated)
  developed during the 2026-06-05 20-alert sweep, plus the per-ecosystem
  commands (npm audit, pip-audit via uvx, dependabot via gh api) and
  the npm-override conflict pattern. The policy of record is
  docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md —
  this skill is the human-facing operationalisation of it.
---

# AIPLA Security Checkup

## When this skill fires

- The CI gate (`security-audit` job in `.github/workflows/ci.yml`) failed on a PR or push
- The Monday rolling tracking issue (`Security audit — week of YYYY-MM-DD`) shows a non-empty audit body
- A new dependabot alert email landed
- A developer ran `make security-check` locally and got a red exit
- Anyone says "the gate's failing" or "what's in the security tab"

Do not invoke this skill for:

- Code-level security review (SQL injection, XSS in our own code) — that's a separate CodeQL / manual-review concern not covered here
- Secrets scanning (gitleaks, truffleHog) — separate tooling
- Backend authn/authz logic review — that's the design-doc + axiom-scoring loop

## The reachability rubric (the key decision)

Every alert falls into one of four classes. The class determines the action.

| Class | Where it lives | Action | Example |
|---|---|---|---|
| **A. Direct prod dep, critical/high** | `dependencies` in `package.json` or `pyproject.toml`, runs in production | Bump immediately; ship in same session | `next 15.5.15` → 15.5.16 (XSS via CSP nonces) |
| **B. Transitive prod dep, critical/high, patch available on same major** | Deep in lockfile, called from prod code paths, fix available without major-version surgery | `npm overrides` / `uv` upper-bound patch; verify nothing breaks | `hono 4.12.12` → 4.12.21 (4 CVEs via `@modelcontextprotocol/sdk`) |
| **C. Transitive prod dep, fix only on major bump that breaks parent** | Same as B but fix is unreachable through current parent constraints | `--ignore-vuln <ID>` with documented justification in `scripts/security-check.sh` header; file follow-up to revisit when parent bumps | `starlette 0.52.1` (BadHost) — fix is 1.0.1, blocked by `fastapi<1.0.0` |
| **D. Dev-only dep** | `devDependencies` or `dependency-groups.dev` | NOT a gate blocker (`--omit=dev` filters these); schedule a tooling-upgrade session | `vitest 1.6.1` → 4.1.0 (UI server RCE, dev-only) |

The gate (`--omit=dev` / `--no-dev`) only catches A/B/C. Class D shows up in the weekly cron's full output but doesn't block merges.

The 2026-06-05 sweep had 20 alerts: 15 fell in A+B, 1 in D (vitest), 4 were stale (sandbox hono).

## The flow

When fired, walk this sequence end-to-end:

### 1. Reproduce the failure locally

```bash
make security-check
```

If this exits 0 but CI is red, the CI runner has different lockfile state than your checkout. `git status` to confirm clean, then `git pull` and re-run.

For per-ecosystem isolation:

```bash
# frontend prod-only audit (same flags as the CI gate)
cd frontend && npm audit --omit=dev --audit-level=high

# sandbox prod-only audit
cd infrastructure/mcp-sandbox && npm audit --omit=dev --audit-level=high

# backend prod-only audit
cd backend && uvx pip-audit \
  --requirement <(uv export --frozen --no-dev --no-emit-project) \
  --strict \
  --ignore-vuln PYSEC-2026-161 \
  --vulnerability-service osv
```

### 2. Get the full picture

Run the broader scan (includes dev deps + mediums) to see what else might land in the next weekly cron:

```bash
cd frontend && npm audit                              # all severities, all deps
cd infrastructure/mcp-sandbox && npm audit
cd backend && uvx pip-audit --requirement <(uv export --frozen --no-dev --no-emit-project) --vulnerability-service osv
```

And the dependabot view (often has better severity classification than the audit tools):

```bash
gh api repos/sunholo-data/cphu-aipla-app/dependabot/alerts --paginate \
  -q '[.[] | select(.state == "open") | {severity: .security_advisory.severity, package: .dependency.package.name, ecosystem: .dependency.package.ecosystem, manifest: .dependency.manifest_path, fixed: .security_vulnerability.first_patched_version.identifier, summary: .security_advisory.summary}] | sort_by(.severity, .package)'
```

### 3. Classify each finding using the rubric above

For each new CVE, trace where it lives:

```bash
# npm: who pulls this transitively?
cd frontend && npm ls <package>
# Returns the dep-tree path back to the top-level dep.

# Python: who pulls this transitively?
cd backend && uv tree --package <package>
# Same idea — shows constraint sources.

# If the offending package is a direct dep in package.json / pyproject.toml,
# it's class A. If it's only reached via a parent, it's B or C.
```

### 4. Apply the right fix

#### Class A — direct prod dep

Bump it directly. Run tests + build to verify nothing broke.

```bash
# frontend
cd frontend && npm install next@<patched-version>

# backend
cd backend && uv add '<package>>=<patched-version>'
```

#### Class B — transitive prod dep, patchable

Use `overrides` (npm) or `uv lock --upgrade-package` (Python).

**npm overrides — the conflict pattern.** If the package is *also* a direct dep (in `dependencies` or `devDependencies`), npm rejects the override with `EOVERRIDE`. In that case, bump the direct dep instead.

```bash
# Open frontend/package.json — add to "overrides":
{
  "overrides": {
    "<package>": "^<patched-version>"
  }
}

# Then:
cd frontend && npm install
npm ls <package>      # verify the override took effect
```

For Python:

```bash
cd backend && uv lock --upgrade-package <package>
# If the package isn't in pyproject.toml (pure transitive), you may need:
cd backend && uv add '<package>>=<patched-version>'
# This makes it a direct dep — annotate in pyproject.toml why ("pin for CVE-XXXX-YYYY").
```

#### Class C — fix unreachable; `--ignore-vuln` with justification

Add the CVE ID to the `--ignore-vuln` list in `scripts/security-check.sh`'s pip-audit invocation. **Document the rationale in the script header's "Ignored vulnerabilities" block** so the next person (or future you) can see *why* and *when to revisit*.

```bash
# Example: starlette 1.0.1 fix blocked by fastapi<1.0.0
# Add to scripts/security-check.sh:
#   --ignore-vuln PYSEC-2026-XXX
# And in the header comment:
#   PYSEC-2026-XXX (package issue) — fix is at <version>, blocked by
#   <constraint>. Reachability: <low/high>. Revisit when <condition>.
```

For npm, there's no `--ignore-vuln` equivalent on `npm audit`. The pattern is: add an override that pins the package at the closest-to-patched version available, OR raise the audit threshold for that specific ecosystem (avoid this — it weakens the gate).

#### Class D — dev-only dep

Don't block the merge. File a follow-up to upgrade the dev tool when convenient. The weekly cron will keep nagging in the rolling issue.

### 5. Re-verify the gate

```bash
make security-check
# Expect exit 0. The CI gate will now pass.
```

If you applied Python upgrades that affected `pyproject.toml` or `uv.lock`, also re-run the backend tests:

```bash
cd backend && uv run pytest tests/ -m "not slow and not integration" -q
```

If npm overrides — re-run frontend tests:

```bash
cd frontend && npm test -- --run
```

### 6. Commit + push

Per AIPLA git workflow ([feedback_aipla_git_workflow](../../../memory/feedback_aipla_git_workflow.md)): commit straight to `dev`. Don't open a PR for dev work.

Convention for security-patch commits:

```
chore(deps): patch <N> dependabot alerts (<ecosystem>)

Closes:
- <CVE-ID> <package> <old-version> → <new-version> via <override|direct-bump>
- ...

Remaining (deferred / waiting):
- <CVE-ID> <reason>

Verification:
- make security-check passes
- frontend: 911 tests pass
- backend: 1761 tests pass
```

## Ecosystem command quick-reference

| Task | Command |
|---|---|
| Run the gate locally | `make security-check` |
| Frontend prod audit only | `cd frontend && npm audit --omit=dev --audit-level=high` |
| Frontend full audit (dev+prod, all severities) | `cd frontend && npm audit` |
| Sandbox prod audit | `cd infrastructure/mcp-sandbox && npm audit --omit=dev --audit-level=high` |
| Backend prod audit | `cd backend && uvx pip-audit --requirement <(uv export --frozen --no-dev --no-emit-project) --strict --ignore-vuln PYSEC-2026-161 --vulnerability-service osv` |
| Backend full audit | `cd backend && uvx pip-audit --requirement <(uv export --frozen --no-dev --no-emit-project) --vulnerability-service osv` |
| Dependabot open alerts (full JSON) | `gh api repos/sunholo-data/cphu-aipla-app/dependabot/alerts --paginate -q '[.[] \| select(.state == "open") \| {severity: .security_advisory.severity, package: .dependency.package.name, ecosystem: .dependency.package.ecosystem, ghsa: .security_advisory.ghsa_id}] \| sort_by(.severity)'` |
| Trace a transitive npm dep | `cd frontend && npm ls <package>` |
| Trace a transitive Python dep | `cd backend && uv tree --package <package>` |
| Force-bump a Python package | `cd backend && uv lock --upgrade-package <package>` |
| Manually trigger the weekly cron | `gh workflow run security-weekly.yml` |
| View the rolling issue | `gh issue list --search 'in:title "Security audit — week of"' --state open` |

## Gotchas

- **`pip-audit` doesn't filter by severity.** It reports every CVE. The gate uses `--strict` (fail on any) with `--ignore-vuln <ID>` for accepted-risk pins. There is no `--severity high` equivalent — by design the Python gate is stricter than the npm one (which has `--audit-level=high`). Living with that asymmetry is correct: Python has fewer transitive layers, so a CVE there is more likely to be reachable.

- **`uv export` emits `-e .` for the workspace package.** Always pass `--no-emit-project` to keep that line out; pip-audit can't hash it.

- **`npm audit --omit=dev` doesn't mean "skip everything in devDependencies".** It excludes packages that are ONLY reached through devDependencies. A package present in both `dependencies` and `devDependencies` still counts. If you see a CVE you thought was dev-only, check `npm ls` for the full path.

- **Dependabot push warnings lag the actual state by minutes-to-hours.** After pushing a patch, GitHub's push warning may still show the old count. Verify by querying the alerts API directly, not by reading the push output.

- **GitHub `--label` flag fails if the label doesn't exist on the repo.** The weekly cron workflow deliberately doesn't pass `--label`. Add labels manually on the first rolling issue if you want them, and the cron will inherit them on edit (not on create).

- **`npm overrides` requires the package to NOT be a direct dep.** If you try to override a direct dep, npm exits with `EOVERRIDE: Override for X conflicts with direct dependency`. Bump the direct dep instead.

## Cross-references

- **Policy of record:** [docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md](../../../docs/design/aipla/v1.1.0-feedback/security-monitoring-pipeline.md) — threshold choices, alternatives considered, axiom alignment
- **CI gate:** [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) `security-audit` job → invokes `scripts/security-check.sh`
- **Local gate:** `make security-check` → invokes the same script
- **Single source of truth:** [scripts/security-check.sh](../../../scripts/security-check.sh) — change behaviour here, both CI and local follow
- **Weekly cron:** [.github/workflows/security-weekly.yml](../../../.github/workflows/security-weekly.yml) — Mon 09:00 UTC, updates rolling issue
- **Past sweeps:** commits `084920b` + `1257c08` (2026-06-05 — 20-alert sweep) — example of the rubric applied in practice
