# In-app sim authoring — benchmark first, then build, under a monthly quota

**Status**: **Self-service publishing built (M6, 2026-10-13, local; next release).** Released before it: v0.1.90 on test and prod (the workshop, per-teacher access, sim-verify on all envs), v0.1.91 on test (streamed thinking, cost per sim). A teacher now publishes a checked version to their own classes with a recorded approval, asks for the shared library, and a researcher signs off. Not built: M2 (physics probe), M7 (quota), MCP listing of library sims. Decisions in [Decisions](#decisions)
**Priority**: **P1 for this sprint.** The benchmark (M0–M2) is the gate: it decides which model and harness the in-app path is built on, and what one build costs, which sets the quota
**Estimated**: **~9–10d** in all. Benchmark M0–M2 ~3d · sim-verify service M3 ~1d · in-app authoring M4–M6 ~4–5d · quota and meter M7 ~1d. M4 onward is re-sized after the benchmark, since the winning harness decides how much has to be built
**Scope**: Research: a new `research/sim-bench/` harness (`make bench-sims`). Backend: the static gates as one Python module (this is [sim-verify-mcp](sim-verify-mcp.md) M0), an authoring agent as an ADK skill, a sim-authoring budget on the existing enforcer. Frontend: a teacher authoring surface with a preview and a cost meter. Infra: `aipla-v01-sim-verify`, a separate headless-Chromium Cloud Run service on all three environments (sim-verify-mcp M3, brought forward)
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
- **The anatomy kit cannot run in the app as designed.** The sim-verify service
  (M3) gives the app a real browser, but the kit's build step runs
  model-written code in Node, which needs a code sandbox (a container per build),
  not a page checker. So "can Gemini replicate otto-engine" is really two
  questions: can it do it *with the kit and its checks* (an agentic harness with
  a sandbox), and can it get something usable *without* them (a plain sim, as
  the authoring prompt produces today). Measure both; only the second is built
  in this sprint.

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
| **M0** ✅ 2026-10-12 | Static gates as one Python module, `backend/sim_gates/` (sim-verify-mcp M0), so the runner, the MCP tool and the in-app path share one implementation. `audit_artefact.sh` is now a wrapper | ~0.75d | ✅ `tests/unit/test_sim_gates.py`: every live artefact passes tier A; tiers B–C pass except gaps named per sim (four pre-prompt sims, and sekant-intro's missing reference block); one broken fixture per gate. **Found on the way:** the bash gate 1 (no external fetches) had never checked anything — an invalid lookahead made grep exit 2, which `2>/dev/null` hid. Both Gemini drafts pass every static gate, which is the point: their faults are physics |
| **M1** ✅ 2026-10-13 | `research/sim-bench/` runner (`make bench-sims`): five briefs, harnesses h1/h2/h3, cost capture at the rate card, `--dry-run`/`--go`/`--report-only --rescore`, L0–L3 scoring via `backend/sim_authoring/verify.py`. Gemini only so far (Claude through LiteLLM is a follow-up). `verify_sim.mjs` gained `--json` and a **motion check** (pressing start must move the drawing; part of L2) | ~1.25d | ✅ dry run plans; real cells produce rows, artefacts, screenshots. Results in [Benchmark runs](#benchmark-runs-2026-10-13) |
| **M2** | The physics probe and state contracts for the five briefs; the visual rubric; the first full run; a report with a recommendation | ~1d | **the probe fails the deliberately broken fixtures** (spark at BDC, pV linear, η on screen) and passes the reference sims. A probe that passes everything has not been tested |

H2 in the benchmark calls `verify_sim.mjs` locally until M3's service exists,
then the service, so the benchmark and the app share one checker. H3 (the kit
loop) runs from a laptop in M2 if time allows. It is the arm that tells us
whether a per-build code sandbox (a later decision) would be worth running.

## Part 2 — in-app authoring (M3–M6, re-sized after M2)

The shape the benchmark is expected to point to, to be confirmed by it:

- **M3: the sim-verify service** below: the browser half of the gates, as its
  own Cloud Run service (sim-verify-mcp M3, brought forward from "deferred").
- **M4: an authoring agent.** An ADK skill for teachers (not students),
  `backend/skills/templates/sim-author/SKILL.md`, that takes a brief and runs the
  winning harness: draft → `verify_sim` → repair, up to a fixed attempt cap,
  the same capped loop svg-illustrator uses. Its one checking tool,
  `verify_sim(index_html, yaml, moments)`, runs the M0 gates in-process and
  calls the service for the browser half. The screenshots go back to the model as
  images inside the function response, as svg-illustrator's PNG does, so the
  model sees what it drew. Drafts are saved as ADK artifacts on the session, so
  a build that stops (quota, attempt cap, a closed tab) resumes from the last
  draft. Model: gemini-3.8-flash with thinking unless M2 says otherwise.
- **M5: a preview.** The teacher tries the draft in a sandboxed frame before
  anything is catalogued. This is sim-verify-mcp M4, and it **needs an ADR-013
  decision first**: unreviewed HTML on the artefact origin is a posture change,
  even under the same CSP.
- **M6: the route to the library.** A draft is private to its teacher. Making it
  live for a class goes through review, with the physics sign-off ADR-013
  already asks for and nothing yet records, now recorded on the draft. A
  generated sim never reaches students unreviewed.

| | What | Est. | Gate |
|---|---|---|---|
| **M3** ✅ dev 2026-10-13 | `infrastructure/sim-verify/`: Playwright 1.63 image, `POST /verify`, private (`run.invoker` only for `aipla-v6@`), running as `aipla-sim-verify@` with no project roles. Dev trigger `aipla-sim-verify-deploy` (hand-made, like the other dev triggers). **Test/prod not wired**: needs terraform triggers + the SA there | ~1d | ✅ on dev: authenticated `/ready` 200, unauthenticated 403, `/verify` on a real draft returns the verdict, motion and three screenshots |
| **M4** ✅ 2026-10-13 | `skills/templates/sim-author` (teacher-only, gemini-3.8-flash, per-skill `thinkingBudget` 16384); tools `verify_sim` (stores a version per check, screenshots attached inside the function response, cap 5 per turn, refuses fragments) and `read_reference` (authoring rules, anatomy-lite). Drafts in **Firestore** (`db/sim_drafts.py`: one draft per conversation, one version per check), not ADK artifacts: the teacher page needs to list them across sessions | ~1.5–2d | ✅ unit + route tests; the bench's h2 runs show the loop repairing from checks and screenshots |
| **M5** partial 2026-10-13 | `/teacher/sims`, the Sim workshop: drafts and versions (level, what stopped it, screenshots at rest / after clicking / on a phone, downloads) beside the floating sim-author assistant; DA/EN; behind `NEXT_PUBLIC_SIM_WORKSHOP` ('1' on dev only). **Live preview not built**: it is the first piece of publishing (below) | ~1–2d | ADR-013 decision ✅ recorded; a teacher drives a build to screenshots on dev |
| **M6** ✅ 2026-10-13 (local) | Publishing: `db/teacher_sims.py` (frozen versions, stamped bridge, recorded approval); `sim_authoring/publish.py` (level 3 required, built-in ids refused, bridge stamped, tiers A–C re-run on the exact page, D when the version recorded its hidden terms); `artefacts/loader.py` merges teacher sims (30 s cache, built-ins only if Firestore does not answer) and `can_attach` (class sims: owner or researcher); routes in `protocols/teacher_sim_routes.py`; the workshop's Publish panel, the researcher's Library requests, picker badges. **Served differently from the plan:** not a sandbox `/teacher-sims/` route on a bucket but the backend page route, written into the same sandbox frame with a `connect-src 'none'` meta CSP — no new bucket, no sandbox change, one fewer deploy surface | ~2–3d | ✅ `test_teacher_sim_publishing.py` (one store, real routes, a real sim: owner-only catalogue, attach refused for others, student fetch, refusals, library sign-off, withdraw, the tutor read sites); a browser walkthrough locally (publish → library request → review → builder picker → the student frame runs it). A class sim never reaches the MCP server because the MCP server does not read teacher sims at all yet |

### The sim-verify service (decided 2026-10-12)

**A separate Cloud Run service on dev, test and prod**, `aipla-v01-sim-verify`.
It is not a sidecar. M chose it to keep things simple, and it also isolates
better: a sidecar shares the frontend instance's identity (Firestore access) and
its CPU with live student turns, while a separate service can run as a
service account with **no IAM roles** and scales on its own.

- **What it is:** the official Playwright image (Node + Chromium), `verify_sim.mjs`
  and the static gates, behind a small HTTP endpoint. `POST /verify` with the
  draft HTML returns the per-check verdicts, the captured bridge events (which
  the physics probe reads) and PNG screenshots at the requested moments.
- **Why real Chromium:** most sims draw on a canvas. Obscura, the lightweight
  headless browser we use from Claude Code, was tried on a generated sim
  (2026-10-12). It ran the JavaScript and the self-test correctly, but drew the
  canvas as solid blocks, so it cannot serve the visual check.
- **Access:** private (`--no-allow-unauthenticated`); only the backend's
  service account gets `run.invoker`. Egress denied. The page also runs under
  the sandbox CSP, as in `verify_sim.mjs` today.
- **Deploy:** built on the dev pipeline and carried to test and prod by the tag
  and promote pipelines. ⚠️ That needs a `cloudbuild.promote.yaml` twin, the
  footgun CLAUDE.md lists.
- **Portable:** a plain container behind an HTTP contract, so it runs unchanged
  under Docker Compose or Kubernetes on UCPH hardware. Leaving Google means
  changing where it runs, not the agent.

## Publication and security (decided 2026-10-13)

M, 2026-10-13: teachers iterate with the skill and **verify the sim themselves
before publication**; *"the html we generate in this process can be served to
students. we will put in place security audits to be sure we can trust it"*;
*"go with your recommendations"*.

**ADR-013, amended for teacher sims (option A).** HTML a teacher generated and
approved, which we have not reviewed, may be served to students from the
sandbox origin under its own path (`/teacher-sims/<id>/<version>/`), with the
teacher as reviewer of record **for their own classes only**. The shared library
still needs a physics reviewer's recorded sign-off. (Rejected: B, a second
sandbox origin for teacher sims, stronger isolation for one more service and
domain; C, no teacher publishing.)

**Security baseline** (what makes A acceptable):

1. **No network, ever.** A sim needs none: everything is inline apart from the
   hash-pinned `/vendor/` libraries, and it talks to the tutor by `postMessage`
   to the parent frame, which is not a network call. Static gate (tier A): no
   URLs, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`,
   `eval`, dynamic `import()` — now a real check (the old bash gate 1 never ran).
2. **Runtime lockdown for teacher sims:** served with `connect-src 'none'`
   (built-in sims have `'self'`) and scripts limited to the page plus the
   SRI-pinned vendor files, so code that slipped the static check still cannot
   call anything, our server included.
3. **Every version runs in sim-verify** under that policy before anyone sees it;
   blocked requests and page errors are recorded.
4. **Recorded approval** (who, when, which version) before it reaches a class,
   and a re-audit of everything published whenever the gates change.
5. Known residual: a sim's event labels and state reach the tutor's prompt, so
   a careless sim can mislead the tutor. Teachers can already write tutor
   prompts; this is the same trust, by a new route.

**Publication levels:**

| Level | Who sees it | Stored | Served |
|---|---|---|---|
| Draft | its teacher | `sim_drafts` + versions (Firestore) | screenshots now; live preview under a short-lived draft path (M6) |
| Published to my classes | the teacher's classes, after their recorded approval | a frozen version (bucket) + a catalogue row (Firestore) | sandbox `/teacher-sims/<id>/<version>/` |
| Shared library | all teachers, after a physics reviewer's recorded sign-off | the same | the same |

**Services stay at three:** the main app (frontend + backend sidecar: the skill,
drafts, the catalogue `SimPicker` reads), the sandbox (serves sim HTML; gains the
`/teacher-sims/` route), and sim-verify. There is no separate publisher.

**The public MCP server** (`/api/mcp`, no sign-in) lists sims as MCP Apps for
Claude, ChatGPT, Copilot and Codex. A teacher sim appears there **only at the
shared-library level** (reviewed); class-only sims never do, and a later
"share publicly" switch would be opt-in and recorded, because the listing
carries KU's name. ⚠️ Found 2026-10-13: on deployed envs the server lists only
three hard-coded sims (`protocols/sim_apps.py` `KNOWN_SIMS`: Boldkast, KineBot,
LED Planck), because the artefact files are not in the backend image. The seven
newer catalogue sims, otto-engine included, are not offered to external hosts
at all. Discovery should read the catalogue (`status: live`) instead.

### What M6 found and fixed on the way (2026-10-13)

- **The deployed backend had no bridge and no vendor manifest.** Its image is built
  from `backend/` alone, so on test and prod the bridge-conformance and
  vendor-hash gates had nothing to check against (they reported *skipped*), and a
  publish could not have stamped the bridge. Both now ride along as generated
  copies in `backend/sim_authoring/references/`, drift-checked by
  `make check-sim-prompt`, the authoring prompt's existing CI gate.
- **Two sandbox frames on one page answered each other.** `StaticArtefactFrame`
  checked the sender's origin, which every sandbox frame shares, so one frame's
  proxy-ready made the other re-write its page into a live document. Now it
  answers only its own iframe. Affects any page with two frames (the workshop, the
  activity builder beside its preview).
- **The workshop preview ran without the bridge** (drafts store a placeholder), so
  a sim that calls the bridge at start-up threw. The preview route now stamps it.
- **The builder preview rebuilt the sim entry and dropped `source`**, sending a
  teacher sim to the sandbox's `/artefacts/` route (404). Fixed, and the frame
  also recognises a teacher sim by its `teacher-sims/…` path.

**Residuals, recorded:** the inner frame is same-origin with the sandbox proxy (as
for built-in sims), so a hostile script could call the proxy's own `fetch`; that
reaches only the sandbox origin, a static file server, never our API or the
internet (verified in Chromium: the meta CSP blocks fetch, beacon and WebSocket in
the frame itself). An activity *adopted* from another teacher keeps its
`artefactId` without re-validation, so a class-level sim can travel that way;
withdrawing the sim still removes it everywhere.

## Libraries for the model (2026-10-14)

M asked which vendored libraries would make the model's job easier. Three were
added, each with a guide the assistant reads through `read_reference` (hashes
filled from `vendor.json` at read time; `test_sim_library_guides.py` fails on any
drift) and listed in the authoring prompt for external chats:

| Library | For | Why not hand-written |
|---|---|---|
| `aipla-physics` 0.1.0 (ours, ~9 KB) | fixed-step loop, RK4/Verlet, exact 1D and disc collisions, seeded measurement noise, instrument resolution, Danish number format | the parts where generated physics silently goes wrong; tested against the textbook in `__tests__/aipla-physics.test.ts` |
| uPlot 1.6.32 (~50 KB) | live x-y graphs | axes, ticks and scaling are where generated canvas graphs fail |
| matter.js 0.20.0 (~83 KB) | 2D contact: stacking, friction, ramps, many bodies | hard to hand-write; approximate, so a momentum lab on a line uses the exact helper instead |

sim-verify now installs the vendored npm libraries from the sandbox's own
lockfile (it hand-pinned three.js before), so the checker serves the same
bytes as the sandbox.

**First build with them (local, gemini-3.8-flash):** a two-cart collision lab.
The assistant read `physics-helper` and `plots` and not `collisions` (right:
1D needs the exact helper, not an engine), loaded both libraries, used the
fixed-step loop, uPlot with `time: false` and the Danish format, and reached
level 3 in two versions, 435 s. It wrote its own collision formula, correct
but not the helper's, and its defaults did not collide (both carts at
0,20 m/s) with an empty graph axis to 100 s. Both lessons are now in the
guides ("call `P.collide1d`"; "defaults must show the physics on the first
press"; "give the time axis one run's length").

## Part 3 — a monthly quota, shown as you go (M7)

Authoring is the most expensive thing the app will do per request: one build is
dozens of model calls, against a few for a tutor turn. It gets its own quota,
built on the spend machinery that already exists rather than a new one.

**What exists:** a per-teacher monthly cap (`budget/firestore_enforcer.py`,
micro-USD, sharded counters, warns at 80 %), a programme-wide daily budget in
block mode (`db/programme_budget.py`), and the cost dashboard at
`/teacher/insights/cost`, with BigQuery as the accounting truth.

**What M7 adds:**

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
| **M7** | Authoring purpose on the enforcer; monthly quotas (per teacher, programme); the before/during meter; a stop that keeps the draft; the dashboard line | ~1d | a test with two teachers and one programme quota: each teacher's lesson spend is untouched by authoring, and the programme quota stops both |

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-12 | **The authoring agent is an ADK skill** in the app, not a managed agent platform (Vertex Agent Engine, Anthropic Managed Agents) | No new provider lock-in. ADK already runs the tutors and the capped draw-and-check loop (svg-illustrator), and LiteLLM keeps the model swappable, including local models for UCPH |
| 2026-10-12 | **No general code sandbox in this sprint.** The agent gets fixed tools (check, render, save); the only generated code that runs is the sim page, inside headless Chromium under the sandbox CSP | A sim is browser code, so the browser is the sandbox. A per-build container with a shell (option B: ADK's container/GKE executors, E2B, an open-source coding agent) is the later step, only if H3 shows the kit is worth it |
| 2026-10-12 | **The browser checker is a separate Cloud Run service on dev, test and prod**, not a sidecar | M: keep it simple. It also isolates better (no IAM roles, no shared CPU with student turns) |
| 2026-10-12 | **Real Chromium (Playwright), not Obscura** | Obscura draws canvases as solid blocks; the visual check is the point |
| 2026-10-12 | **First model to benchmark: gemini-3.8-flash with thinking** | The strongest model on the app's `eu` endpoint; there is no current Pro there |
| 2026-10-13 | **ADR-013 amended: teacher-approved sims may be served to students** from the sandbox under their own path, teacher as reviewer of record for their classes (option A) | M: teachers verify before publication; security audits make it trustworthy. See [Publication and security](#publication-and-security-decided-2026-10-13) |
| 2026-10-13 | **Security baseline**: no network (static gate + `connect-src 'none'` at runtime), every version run in sim-verify, recorded approval, re-audit on gate changes | A sim needs no network; locking it out costs nothing |
| 2026-10-13 | **The in-app skill uses a variation of anatomy, not the skill as-is**: the kit's drawing half as a vendored library (`/vendor/anatomy-kit/689dcf9/`, hash-pinned, exception to the npm rule recorded) and an AIPLA guide (`anatomy-lite.md`) served by `read_reference` | The upstream skill assumes Node, Chrome and multi-hour builds; the drawing code and craft rules are what transfer |
| 2026-10-13 | **Public MCP listing only for reviewed (shared-library) sims** | The public server carries KU's name and needs no sign-in |
| 2026-10-13 | **Drafts in Firestore, not ADK artifacts** | The workshop lists a teacher's drafts across conversations; artifacts are per session |

## Benchmark runs (2026-10-13)

`make bench-sims`, gemini-3.8-flash, thinking HIGH, one sample per cell, graded
by `sim_authoring/verify.py` with the motion check. Cost at the app's rate card
(the 3.8-flash rate is marked provisional there).

| Brief | Harness | Level | EUR | Time | Checks used | Drew with the kit |
|---|---|---|---|---|---|---|
| otto-engine | h1 (one call) | 3 | 0.14 | 212 s | — | — |
| otto-engine | h2 (check + screenshots) | 3 | 0.43 | 576 s | 2 | — |
| otto-engine | h3 (h2 + anatomy kit offered) | 3 | 0.42 | 514 s | 2 | **no** |
| wave-speed | h1 | 3 | 0.12 | 178 s | — | — |
| wave-speed | h2 | 3 | 0.81 | 810 s | 6 (cap) | — |
| wave-speed | h3 | 3 | 0.86 | 1090 s | 6 (cap) | **no** |

Plus the 2026-10-12 h2 engine cell: L1 → L3 → L3, EUR 0.57, 610 s; after seeing
its screenshots it drew a coherent crank linkage, where both one-shots had not.

What the runs taught, and what changed because of them:

- **Every cell reached L3, so L3 does not discriminate.** Valid, running,
  animated and wired to the tutor is now the floor, not the bar. What separates
  them is physics and drawing, which is M2's probe and rubric, still unbuilt.
- **Offered the kit, Gemini ignored it** (h3, both briefs): the prompt said
  "you may". The h3 preamble and the skill now make the kit mandatory for the
  apparatus. A re-run is below.
- **Repair loops wasted checks after L3** (wave-speed h2/h3): the model kept
  submitting, several times only a fragment that scored L0. `verify_draft` now
  refuses a page that is not whole without a browser run, and the prompt and
  skill say to stop at L3 unless a screenshot shows the picture disagreeing
  with the physics.
- **Made to use the kit, Gemini draws a real apparatus** (h3 re-run, engine,
  EUR 0.46, 534 s, L1 → L3 → L3: its first draft drew NaN paths, 19 page
  errors, and the verdict fixed them). An isometric engine on a base plate with
  feet: block, cylinder, posts, valve springs, a lit spark plug at point 3, a
  crank disc, the p-V chart beside it; readouts exact (81.3 bar, 2541 K at
  point 3). Short of the hand-built figure (cooling fins came out as a coil
  round the cylinder; the rod is a thin line), but a recognisable machine, not
  a box diagram. **So the anatomy-lite variation earns its place in the skill.**
- **Cost per build: EUR 0.12–0.14 one-shot, 0.4–0.9 with the loop.** Against
  the EUR ~9 (USD 9.74) of the hand-built Opus 5.5 engine. With the waste above
  removed, expect the loop at about EUR 0.4–0.5.

## A teacher-review run of the skill (2026-10-13)

The real `sim-author` skill and agent (`create_agent` from the template),
Gemini 3.8 Flash on Vertex, the local browser check, three turns played as a
reviewing teacher who looks at each version's screenshots before replying:

| Turn | Teacher said | Result |
|---|---|---|
| 1 | Brief: a pendulum on a lab stand, with the kit; derive g, never show it or the formula | v1, v2 at L3 (556 s): an isometric lab stand (base, rod, boss head, arm), string, 10° angle scale, dashed rest line; the motion integrates the full pendulum equation (RK4); hidden terms absent |
| 2 | "The bob looks like a cylinder, make it a ball; add a metre ruler; the apparatus is small, fill the panel" | v3, v4 at L3 (355 s): all three made. **New flaw it introduced:** the ruler stood in the swing plane, so the ball passed through it and covered the 1,0 m mark |
| 3 | "The ruler is in the path of the swing; move it behind the string, zero at the pivot" | v5–v7 at L3 (521 s): ruler moved behind the swing plane, labels moved clear, ball passes in front; fits at 390 px |

So iteration works: each request became a checked new version, and the skill
fixed a flaw it had itself introduced once a teacher named it. It also shows
why the teacher is the reviewer: no check would have caught the ruler in the
swing path (L3 throughout).

Found and fixed by the run and the dev smoke that followed:

- **The 10 s first-token deadline** (tuned to tutors) killed the first dev turn,
  and a 180 s one the second: Gemini does not stream function-call arguments,
  so a draft turn's first chunk is the whole page as `verify_sim`'s argument,
  minutes after the request. Per-skill `firstTokenDeadlineS` (sim-author: 600)
  and a 900 s Cloud Run request timeout. The local run had passed because it
  ran non-streamed, where the deadline never applies — **test the streamed path**.
- **The Next.js proxy cut the stream at 300 s of silence** (undici
  `UND_ERR_BODY_TIMEOUT`), with no error to the client: the turn just ended
  after reading the references. `stream_skill` now sends an SSE `: keepalive`
  comment after 15 s of silence (`protocols/sse_keepalive.py`), which resets
  every idle timer on the path and is ignored by the AG-UI parser. The agent's
  background run died with the stream, so no versions were stored.
- **The hidden-quantity check never ran during a build**: `verify_sim` had no way
  to receive the terms. It now takes `hidden_terms`, and a leak makes `ok`
  false at any level.
- **Language:** the skill replied in Danish to an English brief when no UI
  language tag was present. The workshop always sends one (`TeacherCopilot`
  prefixes `[ui_language=…]`), so it is a harness artefact, but worth watching.

## Access, feedback and cost (2026-10-13)

**Access.** The access register gains per-teacher feature switches
(`features.simWorkshop`); researchers have every feature. A researcher **or**
programme admin flips it per teacher on the programme page (M: researchers turn
it on for the teachers they work with; it commits no money beyond the teacher's
own cap). The menu entry is released to everyone and greyed with a lock for a
teacher without it; its page explains and offers "Ask to have it switched on".
Enforced on the server: the drafts routes answer 403 and every sim-author tool
refuses.

**Workbench.** `/teacher/sims` is a wide app surface like the activity builder:
drafts as chips, "Try it" running the latest version in `StaticArtefactFrame`
(the frame students and the activity creator's preview use, fed by the
owner-only drafts route through its new `loadHtml`), the version panel
(level, what stopped it, screenshots, downloads), and the assistant docked as a
column.

**Feedback.** A first draft is minutes of silence on the wire (Gemini does not
stream function-call arguments). Now: the skill's first output in every turn is
a short plan; Gemini's thought summaries stream as AG-UI REASONING events
(`includeThoughts`, sim-author only) and show under the stage label; stage labels
flush every second while the agent is busy; an elapsed timer. Measured locally:
first reasoning at 2 s, 170 chunks over a turn.

**Cost.** Each sim-author model call adds its tokens (in, out, thinking) and a
price (the spend gate's `estimate_cost`) to the draft; the workshop shows
"≈ $0.42 so far · 312k tokens" per sim.

**Spend gate fix (found here).** `budget/callback` priced only
`candidates_token_count`; Gemini bills thinking as output and reports it as
`thoughts_token_count`, so a thinking skill's monthly cap missed most of its
spend. Fixed for every skill; tutors run with thinking off, so nothing changes
for them.

## Turn speed (2026-10-13)

Measured on the streamed path (`make sim-author-local` + `smoke-sim-author.sh`),
same brief and the same follow-up ("round metal ball, metre ruler behind the
string"):

| How the skill changes a sim | First turn | Follow-up |
|---|---|---|
| Rewrite the whole page every time (dev) | ~10 min | ~5–8 min |
| `read_sim` + `edit_sim`, several small reads | ~9 min | ~3.8 min |
| **Edits with one batched `read_sim`** | **5.7 min** | **92 s** |
| (thinking 4096 instead of 16384) | 7.8 min, first draft failed L0 | 5.8 min |

Every model call re-reads the whole context (guides + draft), so round trips,
not output, dominate an edit. A follow-up is now about a minute and a half, with
live progress ("Applying 1 edit(s) to version 3…", "Checking version 4 in the
browser…"). The first draft stays at several minutes: it writes a whole
simulation. Iterating locally on the streamed path, not by deploying to dev,
is the loop from here (a dev deploy is ~29 min, of which the frontend CI gate
is 24; a larger Cloud Build machine type would cut that).

## First runs (2026-10-12, by hand)

Harness H1 (one call, the published authoring prompt), the `otto-engine` brief,
on **gemini-3.8-flash**, the strongest Gemini on the app's `eu` endpoint.
There is no Pro there; the only Pro on `global` is `gemini-3.1-pro-preview`.
Scored by running the existing gates and reading the code and screenshots, before
the runner existed:

| | No thinking | Thinking HIGH |
|---|---|---|
| Time · tokens (in / out / thinking) | 85 s · 5.6k / 14.6k / 0 | 230 s · 5.6k / 16.1k / 22.4k |
| Static gates, self-test, fit, events | All pass | All pass |
| Numbers vs the reference model (Q, W, peak p and T at r = 9.5) | Exact | Exact |
| Spark timing | **Wrong**: `theta >= 355 \|\| theta <= 5` on a 720° cycle, so it fires at the intake TDC too | Right: only near 360° |
| Drawing agrees with the numbers | Yes (a crude 2D schematic) | **No**: at point 3 (V minimum) the piston is drawn at BDC |
| Level reached | L3 | L3 |

Neither physics fault was caught by any automated check; both were found by a
person. They are the two cases M2's probe and visual rubric must fail, and good
fixtures for it. Thinking fixed the logic, not the picture, which argues for a
loop where the model sees its own screenshot (H2) over a bigger single call.

## Open for a human

- **The quota numbers.** Set after M2 from USD per usable sim. At Opus 5.5's
  $9.74 per hand-built sim, $20 a month buys two; if a Gemini build comes in
  under $1, the same $20 buys twenty. Decide per tier, M with the programme.
- **Is anatomy in scope for the app?** Only if H3 clearly beats H2 on L4–L5 and
  a per-build code sandbox is worth running (option B in Decisions). Otherwise
  the kit stays a developer tool and in-app sims are plain ones.
- **Who signs off the shared library**: AR alone, or a rota? (Class-only
  publishing is the teacher's own call, decided 2026-10-13.)
- **Test/prod rollout of sim-verify**: terraform triggers, the runtime SA and
  the promote twin, when the workshop is ready to leave dev.
- **The authoring surface's audience.** Teachers on the pilot tier only, or
  researchers first? Starting with researchers keeps the first month's spend and
  review load small.
