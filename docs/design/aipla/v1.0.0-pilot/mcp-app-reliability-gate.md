# MCP-app reliability gate — automated multi-width fit check

**Status**: Proposed (design for review; not yet executed)
**Priority**: P1 (reliability of student-facing sims — "we are constantly seeking reliability in student sims")
**Estimated**: ~1.5 days
**Branch**: `fix/mcp-app-reliability-gate` off dev; FF-merge at the end
**Pairs with**: [Axiom 11 USABLE BY DESIGN](../../product-axioms.md),
[`.claude/skills/mcp-app-artefact/SKILL.md`](../../../.claude/skills/mcp-app-artefact/SKILL.md) (the manual gate this automates),
ADR-013 (size/security gates), the 2026-05-29 KineBot overflow fix
**Created**: 2026-05-29

## Why

The invariant we want already exists — the `mcp-app-artefact` skill has a
pre-ship gate: *"open the artefact in a 700px-wide container and confirm
there is no horizontal scrollbar and no content clipped."* The problem is
it is **manual and single-width**, so it is unreliable in practice:

- **KineBot passed the 700px check and still overflowed at ~900px.** Its
  control panel (`.sim-right`, a fixed 175px column) holds slider rows
  whose `input[type=range]` had `flex:1` with no `min-width:0`; a range
  input won't shrink below its intrinsic ~130px, so each row needed
  ~230px and spilled past the panel edge. Invisible at 700px (panel
  stacks), visible at widescreen. One-line CSS fix — but nobody re-checks
  the *whole* width range by hand on every ship.

A manual, single-width check is the wrong tool for an invariant we need to
hold on every artefact at every width forever. Automate it.

## Scope decision (2026-05-29)

**Tight and shippable** (the broad envelope is deliberately deferred):

In scope:
- An automated gate that headless-renders each artefact at a set of widths
  (**360 / 700 / 1024 / 1440**) and **fails if `scrollWidth > clientWidth`**
  (horizontal overflow) on `documentElement`.
- Fold the **ADR-013 size cap** (`< 200 KB`) into the same gate.
- A **load smoke**: the artefact renders at each width with **no uncaught
  console errors**.
- A **fluid-by-default authoring contract** codified in the skill +
  `_template` + `scripts/new-artefact.sh`.
- **Backfill**: run the gate against the three existing artefacts
  (`boldkast`, `kinebot`, `led-planck`) and fix any failures.

Explicitly **out of scope** (related, separate follow-ups — do not build here):
- The global `sandbox.html` shell guardrail (`overflow-x:hidden` reset).
- Empty/loading/error-state linting.
- Stripping KineBot's iframe to sim-only.
- Full MCP-Apps `ui/initialize` handshake testing (this gate loads the
  artefact directly to measure layout; handshake testing is a different
  concern).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | No latency-path change |
| 2 | EARNED TRUST | 0 | No factual claims / sources involved |
| 3 | SKILLS, NOT FEATURES | 0 | Build/CI infra, invisible to end users |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | — |
| 5 | GRACEFUL DEGRADATION | 0 | Adjacent (prevents a broken render reaching students) but the axiom is about *runtime* failure modes, not build-time gates — scored honestly as neutral |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses a standard tool (Playwright) and asserts a standard invariant; verifies artefacts stay within the MCP-Apps static-artefact contract rather than adding a custom format |
| 7 | API FIRST | 0 | — |
| 8 | OBSERVABLE BY DEFAULT | 0 | CI pass/fail signal, but not agent tracing |
| 9 | SECURE BY CONSTRUCTION | +1 | Moves the ADR-013 size/security check from "developer remembers to run it" to architecturally enforced in CI — "if it can be misconfigured, it will be" |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | — |
| 11 | USABLE BY DESIGN | +1 | The point: turns the manual, single-width viewport gate into an automated, multi-width, enforced one — usability designed-and-verified upfront, not patched after |
| | **Net Score** | **+3** | Threshold nominal: >= +4 |

**Note on the score (read before rejecting on threshold):** the +4
threshold is calibrated for *product/UX features*; the axiom set scores
pure reliability/CI infrastructure as mostly neutral by construction. The
load-bearing signals here are: **Axiom 11 = +1** (this *is* the usability
gate, made reliable), **zero -1s**, and **no hard-fail rule triggered**.
This mirrors the focused-fix precedent in
[`led-planck-ux-rework.md`](led-planck-ux-rework.md) (+3, "threshold met
for a focused fix"). Recommendation: proceed — re-scoring a CI gate higher
on product axioms would be gaming the metric, not improving the work. This
gap is itself useful signal that the axiom framework under-weights
reliability infra; flagged for the team, not papered over.

## Design

### The invariants the gate asserts (per artefact, per width)
1. **No horizontal overflow:** `documentElement.scrollWidth <= clientWidth`
   at widths 360, 700, 1024, 1440 (px). Height ≥ 480 so layout settles.
2. **Renders cleanly:** no uncaught exceptions / no `console.error` during load.
3. **ADR-013 size:** `index.html` (and any sibling assets) `< 200 KB`.

### The check
A small Playwright script (`scripts/check-artefacts.mjs`) that, for each
`infrastructure/mcp-sandbox/artefacts/<name>/v<ver>/index.html`:
- serves the artefacts directory over a throwaway local static server (the
  artefacts are self-contained per ADR-013, so no external deps),
- loads the artefact at each target width, waits for network-idle,
- evaluates `scrollWidth > clientWidth` and collects console errors,
- and `wc -c`-checks the file size.
Exit non-zero with a per-artefact, per-width report on any failure.

**Tooling tradeoff:** the repo has **no headless browser today** (vitest
runs on jsdom, which reports `scrollWidth` as 0 — it cannot measure
layout). This gate requires **Playwright** as a dev dependency + a browser
install step in CI (`npx playwright install --with-deps chromium`). That
is the real cost of this doc; it is justified because layout overflow is
*only* observable in a real engine, and this class of bug has now hit us
twice (KineBot 2026-05-29; the LED Planck cramping before the split).

### Where it runs (both — decided)
- **Local pre-ship:** `make check-artefacts` (wraps the script). Wired into
  the `mcp-app-artefact` skill's pre-ship checklist, replacing the manual
  "open at 700px" step. Fast feedback before the author pushes.
- **CI / deploy block:** a step in `aipla-mcp-sandbox-deploy`
  (`infrastructure/mcp-sandbox/cloudbuild.yaml`) that runs the gate and
  **fails the build on overflow/oversize**. Today that pipeline only
  smoke-curls `/sandbox.html` for a 200; this adds content correctness.

### Authoring contract (fluid by default)
Codify in the skill + `_template/v1/index.html` + `scripts/new-artefact.sh`
so new artefacts start correct:
- `*{box-sizing:border-box}` and `min-width:0` defaults on flex children.
- `max-width:100%` on panels; no fixed-px widths on layout *columns*
  (fixed widths on a column are fine only with shrinkable content inside).
- Test a *width range*, not a single breakpoint.
- A one-paragraph "Why fluid" note pointing at the KineBot failure.

### CLI surface
The local runner ships as `make check-artefacts` + `scripts/check-artefacts.mjs`
(matches the repo's automation principle). It can later fold into the
planned `aiplatform artefact audit` command (see SEQUENCE row 1.D) so the
dogfooding loop has one entry point; not required for this doc.

## Files
- `scripts/check-artefacts.mjs` — NEW Playwright gate.
- `Makefile` — NEW `check-artefacts` target.
- `frontend/package.json` (or a root tooling manifest) — add Playwright dev dep.
- `infrastructure/mcp-sandbox/cloudbuild.yaml` — NEW gate step before deploy.
- `.claude/skills/mcp-app-artefact/SKILL.md` — replace the manual 700px gate with the automated one; add the fluid-by-default contract.
- `infrastructure/mcp-sandbox/artefacts/_template/v1/index.html` + `scripts/new-artefact.sh` — fluid-by-default scaffold.
- Backfill fixes (if the gate flags them) in `boldkast` / `kinebot` / `led-planck`.

## Testing strategy
- **The gate tests itself:** add a deliberately-overflowing fixture
  artefact (a fixed-width element wider than 360px) under a `__fixtures__`
  path; the gate MUST fail on it. This proves the check actually catches
  overflow (guards against a no-op gate that always passes).
- All three real artefacts pass at all four widths after backfill.
- Size check fails on a >200 KB fixture.

## Acceptance gates
1. `make check-artefacts` runs locally and in `aipla-mcp-sandbox-deploy`.
2. All three existing artefacts pass overflow + size + load at 360/700/1024/1440.
3. The overflow fixture FAILS the gate (proves it works); the oversize fixture FAILS.
4. The `mcp-app-artefact` skill's manual 700px step is replaced by the automated gate; fluid-by-default contract added to the skill + `_template` + scaffold.
5. CI blocks a deploy when an artefact overflows (verified with the fixture on a throwaway branch).

## Risk / rollback
Single feature branch, FF-merge at end. The gate is additive (new script +
CI step + scaffold/skill edits); the only artefact edits are backfill fixes
caught by the gate. Main risk is CI flakiness from the browser install —
mitigate by pinning the Playwright + chromium version and caching the
browser in the build. Rollback = revert (and drop the CI step).

## Open questions (for review)
1. **Where does Playwright live** — root `package.json`, `frontend/`, or a
   dedicated `infrastructure/mcp-sandbox/tooling/`? (Leaning: a small root
   tooling manifest so it's not coupled to the Next.js app.)
2. **Width set** — is 360/700/1024/1440 right, or add 320 (smallest phones)
   and/or a very wide 1920?
3. **CI placement** — block inside `aipla-mcp-sandbox-deploy` (fails the
   deploy) vs the GH Actions `ci.yml` (fails the PR before merge)? Both is
   possible; the deploy-block is the hard guarantee.
