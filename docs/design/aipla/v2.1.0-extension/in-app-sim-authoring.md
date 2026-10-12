# In-app sim authoring — benchmark first, then build, under a monthly quota

**Status**: **PROPOSED** 2026-10-12
**Priority**: **P1 for this sprint.** The benchmark (M0–M2) is the gate: it decides which model and harness the in-app path is built on, and what one build costs, which sets the quota
**Estimated**: **~6–8d** in all. Benchmark M0–M2 ~3d · in-app authoring M3–M5 ~3–4d · quota and meter M6 ~1d. M3 onward is re-sized after the benchmark, since the winning harness decides how much has to be built
**Scope**: Research: a new `research/sim-bench/` harness (`make bench-sims`). Backend: the static gates as one Python module (this is [sim-verify-mcp](sim-verify-mcp.md) M0), an authoring agent, a sim-authoring budget on the existing enforcer. Frontend: a teacher authoring surface with a preview and a cost meter. Infra: a headless-browser verify job (sim-verify-mcp M3, brought forward)
**Source**: M, 2026-10-12, after `otto-engine` was built with the `anatomy` skill in Claude Code: *"we are going to do some evals and benchmarks for this simulation (and perhaps others) - do we have robust harness in place to assess this? I am first going to see if our gemini models can replicate or get something usable … this sprint we are looking at adding in app creation of simulations"*, and *"we will have a cost quota per month and have a way to display that as we go."*
**Related**: [sim-build-cost-log.md](sim-build-cost-log.md) (the first data point: Opus 5.5, 21.6 min, $9.74) · [sim-verify-mcp.md](sim-verify-mcp.md) (the gate port this depends on) · [tutor-controls-sims.md](tutor-controls-sims.md) · `.claude/skills/mcp-app-artefact/` (the gates and the authoring prompt) · `.claude/skills/anatomy/AIPLA.md` · [research/tutor-discrimination/](../../../../research/tutor-discrimination/) (the harness shape to copy) · [public-access-tiers-and-spend-control.md](../v1.1.0-feedback/public-access-tiers-and-spend-control.md) and [cost-dashboard.md](../v1.1.0-feedback/cost-dashboard.md) (the spend machinery the quota reuses)

## The question, and the honest answer

**Do we have a robust harness to assess a generated sim? No, though about half of
one exists.** We can tell whether a sim is *valid*: safe, well-formed, runs, fits
the screen and talks to the tutor. We cannot yet tell, automatically, whether its
**physics is right** or whether it is **any good to teach with**, and there is no
runner that turns a brief into a scored result across models. Physics was the main
criticism of AI-drawn diagrams before svg-illustrator, so for a benchmark the
missing half is the one that matters most.

| Layer | What it answers | Exists? | Where |
|---|---|---|---|
| Static gates | Safe and well-formed: no fetch or CDN, ≤200 KB, light theme, ≥11 px text, bridge stamped | **Yes**, in bash | `audit_artefact.sh` (11 gates), `make sim-build-check` |
| Catalogue | The YAML is valid and the tutorBlock does not leak | **Yes** | `test_artefact_catalogue.py` |
| Runs in a browser | The self-test passes, no page errors, fits at 390/700/1024 px | **Yes** | `verify_sim.mjs` (Playwright, real CSP) |
| Talks to the tutor | Namespaced events, one labelled, under 4096 bytes, a proactive verb | **Yes** | `verify_sim.mjs --drive` |
| Drawing quality (anatomy builds only) | Lines end on something, nothing passes through anything | **Yes, but kit-only** | anatomy `--audit`, `lines.mjs`. Inapplicable to a sim not built on the kit |
| **Physics is right** | The numbers and motion follow the real model | **No** | today a person reads the code (that is how the otto spark timing was checked) |
| **Usable for teaching** | Would a teacher use it; does it show the concept; is the answer hidden | **No** | judgement, and AR sign-off per ADR-013, unrecorded |
| **Runner** | Brief → model → artefact → every check above → one scored row | **No** | |
| **Cost and time per build** | Tokens, USD, wall clock, attempts | **Claude Code only** | `scripts/session_cost.py`. Nothing captures a Gemini run |

Two more facts shape the design:

- **The self-test is self-graded.** A generated sim writes its own `?test=1`
  checks, so a passing self-test proves only that the model agrees with itself.
  It stays in the gates as a crash detector, and is never evidence of correct
  physics.
- **The anatomy kit cannot run in the app.** It needs Node and headless Chrome
  at build time, and the deployed container has Node (the frontend runtime) but
  no browser. So "can Gemini replicate otto-engine" is really two questions: can
  it do it *with the kit and its checks* (an agentic harness), and can it get
  something usable *without* them (one-shot, like the authoring prompt today).
  Measure both.

## Part 1 — the benchmark (M0–M2)

### What a run is

One **cell** = one brief × one model × one harness × one sample. Each cell writes
a row to `raw.jsonl`. `report.md` aggregates rows over at least 3 samples per
cell, because one generation of a sim says almost nothing about the next.

**Harnesses** (the arms that matter, since the harness may matter as much as the
model):

| Arm | What the model gets | Feedback loop |
|---|---|---|
| **H1 one-shot** | The published authoring prompt (`/sim-authoring-prompt.txt`) and the brief | None. Its own self-check only. This is what a teacher gets today in another chat |
| **H2 gated loop** | H1, plus a `verify_sim` tool running the static gates and the browser drive, returning failures and fixes | Up to N tool calls. This is the in-app candidate |
| **H3 kit loop** | H2, plus the anatomy kit and its audits | As H2. Requires Node + Chrome; the closest to how otto-engine was made |

**Models**: the Gemini models in the curated registry (`config/models`) first, as
M wants. Opus 5.5 is the reference, with the existing hand-built run as its H3
data point. Sonnet 5.5 is a cheap second reference. One budget per cell (max
tool calls and max output tokens) so arms are compared at equal effort.

### The brief set

Start with sims we already have, because each one comes with a reference
implementation and a tutorBlock holding the right numbers. Hand the model only
the brief, never the reference:

| Brief | Difficulty | Physics oracle |
|---|---|---|
| `wave-speed` | Easy | v = f·λ, and T = 1/f |
| `kettle-efficiency` | Easy | Energy balance, P·t vs m·c·ΔT |
| `phase-change` | Medium | Plateau at the transition temperature, slope from c, plateau length from L |
| `boldkast` | Medium | Projectile range and height, no drag |
| `otto-engine` | Hard | `infrastructure/mcp-sandbox/figures/otto-engine/model.mjs` |

Each brief is a YAML file in `research/sim-bench/briefs/` with the brief text
(what a teacher would write), its **state contract** (below), its invariants, and
the terms the sim must not display (the answer, e.g. η for otto).

### The physics probe (the missing layer)

We cannot read an arbitrary generated program and judge its physics. We can make
it *tell us its state* and check that against a reference. The sims already have
the channel for this: every sim emits its state to the tutor over the bridge, and
`verify_sim.mjs --drive` already captures those payloads.

1. **The brief fixes a state contract**: the fields the sim must put in its
   snapshot, with units. For otto these are `theta` (crank angle), `stroke`, `p`
   (bar), `V` (cm³), `T` (K) and `r`. The brief asks for them, as a teacher's
   brief would ask for readouts. A sim that does not emit them fails the contract
   layer, and that is a real failure: the tutor could not see the state either.
2. **The probe drives the sim** through the brief's controls (start, step, a
   slider) and samples the snapshot at many points.
3. **It checks invariants against the oracle**, with tolerances, not exact
   values. Examples for otto:
   - pV^γ is constant during compression and during power (within 2 %).
   - The pressure jump happens at the top of the compression stroke (V at its
     minimum), and not elsewhere.
   - The intake valve is open only in the intake stroke and the exhaust valve
     only in the exhaust stroke.
   - At a given r, the peak pressure and temperature match the oracle within
     5 %. Varying r moves η along 1 − r^(1−γ).
   - None of the hidden terms are on screen.
4. **Visual moments, with a model as a second check.** Screenshots at
   contract-defined moments (otto: end of compression) are scored by a vision
   model against a short rubric (*piston at the top? both valves shut? spark at
   the plug?*). A model judge is unreliable, so it never decides alone: it is
   calibrated against M's and AR's ratings on a sample, and its agreement rate is
   reported beside its scores, as BENCH-1 does.

### Score levels

Every row records the highest level reached, so a model that produces nothing
usable is distinguished from one that is nearly right:

| Level | Meaning |
|---|---|
| L0 | Produced two parseable files |
| L1 | Passes the static gates |
| L2 | Runs: no page errors, fits 390 and 700 px, its own self-test passes |
| L3 | Contract: emits the state fields, a labelled event, a proactive verb |
| L4 | Physics probe passes |
| L5 | Visual rubric passes, and the hidden terms stay hidden |
| (human) | M or AR rates a sample 1–5 for *would I teach with this* |

Each row also records tokens (in, cached, out), USD at list price, wall clock,
tool calls and repair attempts. **USD per L4 sim** is the headline number: it is
what sets the quota in Part 3.

### Harness shape

Copy BENCH-1 (`research/tutor-discrimination/`), which is already reviewed and
works:

- `make bench-sims ARGS=--dry-run` prints the plan, the call count and a rough
  cost, and makes **no** model calls. `--go` is required for a real run, and a
  real run needs M's go-ahead because it costs money.
- `--report-only RUN_DIR` re-scores an old run without calling a model, so a
  fixed probe can be re-applied to old generations.
- Every generated artefact is kept in the run directory, so a human can open any
  cell. Runs are committed (artefacts too: they are small) and the report links
  each cell.
- Model calls go through Vertex like the rest of the app (`eu` endpoint), so the
  costs measured are the costs the in-app path will pay.

### Milestones

| | What | Est. | Gate |
|---|---|---|---|
| **M0** | Static gates as one Python module (sim-verify-mcp M0), so the runner, the MCP tool and the in-app path share one implementation | ~0.75d | every live artefact passes; one fixture per gate fails only that gate |
| **M1** | `research/sim-bench/` runner: briefs, H1 and H2, Gemini + Claude through one interface, cost capture, `--dry-run`/`--go`/`--report-only`, L0–L3 scoring | ~1.25d | a dry run prints a plan; a one-cell `--go` produces a row and an artefact |
| **M2** | The physics probe and state contracts for the five briefs; the visual rubric; the first full run; a report with a recommendation | ~1d | **the probe fails the deliberately broken fixtures** (spark at BDC, pV linear, η on screen) and passes the reference sims. A probe that passes everything has not been tested |

H3 (the kit loop) runs from a laptop in M2 if time allows. It is the arm that
tells us whether bringing the kit into the app would be worth a browser service.

## Part 2 — in-app authoring (M3–M5, re-sized after M2)

The shape the benchmark is expected to point to, to be confirmed by it:

- **M3: an authoring agent.** An ADK skill for teachers (not students) that takes a
  brief and runs the winning harness: draft → `verify_sim` → repair, up to a
  fixed attempt cap, the same capped loop svg-illustrator uses. The browser half
  of the gates runs as a Cloud Run job (sim-verify-mcp M3, brought forward from
  "deferred").
- **M4: a preview.** The teacher tries the draft in a sandboxed frame before
  anything is catalogued. This is sim-verify-mcp M4, and it **needs an ADR-013
  decision first**: unreviewed HTML on the artefact origin is a posture change,
  even under the same CSP.
- **M5: the route to the library.** A draft is private to its teacher. Making it
  live for a class goes through review, with the physics sign-off ADR-013
  already asks for and nothing yet records, now recorded on the draft. A
  generated sim never reaches students unreviewed.

## Part 3 — a monthly quota, shown as you go (M6)

Authoring is the most expensive thing the app will do per request: one build is
dozens of model calls, against a few for a tutor turn. It gets its own quota,
built on the spend machinery that already exists rather than a new one.

**What exists:** a per-teacher monthly cap (`budget/firestore_enforcer.py`,
micro-USD, sharded counters, warns at 80 %), a programme-wide daily budget in
block mode (`db/programme_budget.py`), and the cost dashboard at
`/teacher/insights/cost`, with BigQuery as the accounting truth.

**What M6 adds:**

1. **A separate authoring budget.** A monthly USD quota for sim authoring, per
   teacher and for the programme as a whole, metered by the same enforcer under
   an authoring purpose. Authoring spend must never eat a teacher's lesson
   budget, and a class mid-lesson must never be stopped because someone was
   building a sim. The programme daily ceiling still applies to both.
2. **A price shown before you start.** Before a build, the surface shows the
   expected cost from the benchmark (e.g. *"a build usually costs about $0.60;
   you have $14.20 of $20 left this month"*). The estimate comes from M2's USD
   per sim for the chosen model.
3. **A meter while it runs.** The surface shows the build's spend so far,
   updated per model call from the enforcer's counters. Those are approximate by
   design (a circuit breaker with ~10 s staleness), so the meter says
   *about* and the dashboard holds the exact figure.
4. **A clean stop at the quota.** Reaching the quota ends the build at the next
   call boundary and **keeps the draft** so it can resume next month or after a
   top-up. A half-built sim is not thrown away.
5. **Reporting.** Authoring spend gets its own line on `/teacher/insights/cost`
   and in the programme admin view, per teacher and per month.

| | What | Est. | Gate |
|---|---|---|---|
| **M6** | Authoring purpose on the enforcer; monthly quotas (per teacher, programme); the before/during meter; a stop that keeps the draft; the dashboard line | ~1d | a test with two teachers and one programme quota: each teacher's lesson spend is untouched by authoring, and the programme quota stops both |

## Open for a human

- **The quota numbers.** Set after M2 from USD per usable sim. At Opus 5.5's
  $9.74 per hand-built sim, $20 a month buys two; if a Gemini build comes in
  under $1, the same $20 buys twenty. Decide per tier, M with the programme.
- **Is anatomy in scope for the app?** Only if H3 clearly beats H2 on L4–L5 and
  the browser service is worth running. Otherwise the kit stays a developer tool
  and in-app sims are plain ones.
- **Who reviews a generated sim** before it is live for a class, and is that
  review recorded on the draft (M5)? ADR-013 says a physics reviewer; today that
  is AR and nothing enforces it.
- **The authoring surface's audience.** Teachers on the pilot tier only, or
  researchers first? Starting with researchers keeps the first month's spend and
  review load small.
