# Sim authoring benchmark (SIM-BENCH)

Answers M's question from 2026-10-12: *can our Gemini models build a usable sim
from a teacher's brief, and with which harness?* It decides the model and
harness for in-app sim authoring, and what one build costs, which sets the
monthly authoring quota.
Design: [in-app-sim-authoring.md](../../docs/design/aipla/v2.1.0-extension/in-app-sim-authoring.md).

## Run it

```bash
make bench-sims ARGS=--dry-run                                          # plan + rough cost, ZERO model calls
make bench-sims ARGS="--go --briefs otto-engine --harness h1,h2 --samples 3"
make bench-sims ARGS="--report-only ../research/sim-bench/runs/<run>"            # rebuild the report, ZERO calls
make bench-sims ARGS="--report-only ../research/sim-bench/runs/<run> --rescore"  # re-grade the saved files, ZERO calls
```

Without `--go` nothing is called. **A real run costs money: get M's go-ahead.**
It needs ADC with Vertex on `aipla-$(ENV)-2026` (`gcloud auth
application-default login`), Node, and Playwright's Chromium for grading
(`npx playwright install chromium` if `verify_sim.mjs` says so).

## What a cell is

One brief, one model, one harness, one sample. The model gets the published
authoring prompt (`frontend/public/sim-authoring-prompt.txt`) with the brief in
its slot.

| Harness | What the model gets |
|---|---|
| `h1` | One call. What a teacher gets by pasting the prompt into a chat |
| `h2` | The same, plus a `verify_sim` tool: it submits both files, gets the verdict **and screenshots of its page**, repairs, and answers. Capped at `--max-tool-calls` (default 6) |

Every answer is graded by `backend/sim_authoring/verify.py`, the same code the
in-app agent will use: the static gates (`backend/sim_gates/`), then the page
stamped with the bridge and driven in headless Chromium (`verify_sim.mjs`).

| Level | Meaning |
|---|---|
| L0 | Two files parsed |
| L1 | Static gates pass (tiers A–C) |
| L2 | Runs: self-test passes, no page errors, fits 390 and 700 px |
| L3 | Talks to the tutor: a labelled event, a verb that wakes it, every kind namespaced |
| L4 | *(M2)* the physics probe passes |
| L5 | *(M2)* the visual rubric passes |

**L3 is not correct physics.** Both hand-run Gemini drafts of 2026-10-12 reached
L3 with a physics fault each. L4 and L5 are what tell a usable sim from a
plausible one.

## Briefs

`briefs/*.yaml`: the brief a teacher would write, the terms the sim must not
show (`hidden_terms`, checked by tier D), and the live sim it is modelled on
(`reference_sim`), whose catalogue entry holds the reference values. The model
never sees the reference.

## Outputs

`runs/<UTC>/` (gitignored): `report.md`, `raw.jsonl`, and `cells/<cell>/` with
the response, `index.html`, `catalogue.yaml`, `verdict.json`, the screenshots,
and for `h2` one `attempt-N/` per tool call. Commit a report deliberately when
it is worth keeping.

Cost is the app's rate card (`analytics/rate_card.py`), thinking priced as
output and no cache discount: roughly what the app would be charged. ⚠️ The
`gemini-3.8-flash` rate there is marked provisional.
