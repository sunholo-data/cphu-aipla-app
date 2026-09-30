# Retry, then escalate — a failed or struggling turn gets a second chance on a stronger model

**Status:** Design (OPEN) — **1.1.142**
**Priority:** **P2** — a failed turn is currently a dead turn (Gemini 5xx is not retried), and "Flash struggles with some harder tasks" has no remedy short of moving every student to a slower model
**Estimated:** ~1.5–2d (M0 port the error classifier ~0.25d · M1 retry transient 5xx ~0.25d · M2 fail-over to the smart tier ~0.5d · M3 escalate on hard turns ~0.5d · M4 cost + telemetry ~0.25d)
**Scope:** Backend: adapt upstream `backend/adk/model_errors.py` + `resilient_llm.py` (from `sunholo-data/platform-source`) into `backend/adk/`; replace/absorb `adk/quota_retry.py`; the model wiring in `adk/agent.py` (one seam); `config/models.yaml` (the chain as data); chat-log stamp. Frontend: none required (optionally a "still thinking — using a stronger model" line on the 1.1.131 M2 stall indicator)
**Dependencies:** [1.1.131](insights-off-the-event-loop.md) (the stall indicator, and its note that a `500 INTERNAL` failed a turn outright); [1.1.106 cloud-cost-envelope](cloud-cost-envelope.md); [BENCH-2](tutor-discrimination-benchmark-sprint.md) (3.8-flash reads better on approach and tone); CLAUDE.md "Upstream tracking" (**port down deliberately per file, never merge**). **Un-gated**
**Created:** 2026-09-30
**Source:** 09-29 meeting, AI suggestion 9: *"A strategy for routing tasks to more advanced AI models when the primary model fails is undefined."* Also *"the current Flash model struggles with some harder tasks"* and the amplitude-drawing turn. Split out of 1.1.140 M5

## Problem Statement

1. **Transient failures kill the turn.** `adk/quota_retry.py` matches 429 only. A Gemini
   `500 INTERNAL` mid-stream failed a turn outright on 22 Sep (1.1.131 notes). The student sees
   the tutor stop, and the 1.1.131 M2 indicator now at least says so.
2. **There is no fail-over.** If flash-lite is degraded, every student turn fails, although
   `gemini-3.8-flash` (the smart tier) is registered and healthy.
3. **Hard turns get the small model.** Image reading (*"they couldn't draw the amplitude —
   need to see the images?"*) and multi-step problems are where flash-lite is weakest.
   Moving everyone to 3.8-flash is ruled out by its first-token latency (p90 ~20 s on the
   real tutor prompt, `models.yaml`).

**Upstream already solved (1) and (2)** in MODEL-RELIABILITY (`platform-source`,
`backend/adk/model_errors.py` + `resilient_llm.py`, read 2026-09-30): an error classifier
(`transient` / `fallbackable` / a typed RUN_ERROR code, retry-after capped at 10 s), and a
`BaseLlm` wrapper that retries with capped full-jitter backoff and moves down an ordered
chain **only while no visible output has reached the student**, then raises a typed error,
because re-running after partial output would duplicate it. Retries live in exactly one
layer. That is the plan's workstream F *"silent-failure family"*, and this doc is where
it becomes concrete.

## Design

### M0 — Port the classifier (~0.25d)

Copy `model_errors.py` with its recorded fixtures and tests. Gemini-only today
(model-provider direction), so keep its Gemini/Vertex classes and drop nothing: the
LiteLLM branches are inert here. Note the port in `docs/upstream-feedback.md`.

### M1 — Retry transient 5xx (~0.25d)

Adapt `ResilientLlm` with a chain of one (flash-lite): 429 **and** 5xx, backoff capped,
total budget < 30 s. **Remove** `quota_retry`'s own retry so attempts do not multiply
(upstream's explicit warning). Test: a scripted 500 then success produces one turn, no
duplicate text.

### M2 — Fail over to the smart tier (~0.5d)

Chain `[flash-lite, gemini-3.8-flash]` as data in `models.yaml` (`tutor_chain:`).
Fail-over happens only before visible output, as upstream does. The chat-log turn already stamps
`model`, so a failed-over turn is visible in BigQuery and prices correctly in the
cost dashboard. Test: primary persistent 5xx → secondary answers; primary fails after
partial output → typed error, no second answer.

### M3 — Escalate hard turns (~0.5d)

A **pre-routing** rule, not a failure path: choose the smart tier up front when
- the turn carries an **image** the tutor must interpret (the student's drawing or
  photo), or
- the activity sets `modelTier: smart` (teacher or researcher opt-in for demanding
  activities).
Accept 3.8-flash's latency for those turns only. The 1.1.131 M2 stall indicator covers
the wait, with copy that says a more careful model is thinking. **No** LLM-judged "is
this hard?" router. That is a second model call on every turn, and its errors would be
invisible.

### M4 — Cost and telemetry (~0.25d)

A line in the insights cost view: share of turns on the smart tier, split by *fail-over* vs
*escalation* vs *opt-in*. A budget alarm if smart-tier share exceeds a threshold
agreed against [1.1.106](cloud-cost-envelope.md) (the 100,000 DKK envelope).

## Out of scope

- Multi-provider fail-over (Anthropic/OpenAI). The provider direction is Gemini-only now
  and local-first later ([1.1.143](local-model-test-plan.md)). The chain is data, so a
  local model can join it later.
- Streaming-level resumption after partial output. Upstream deliberately refuses it,
  and so do we.

## Open questions

1. **(M)** Opt-in `modelTier: smart` per activity: teacher-settable, or researcher-only
   to protect the envelope?
2. **(JB)** Is a ~5–20 s wait acceptable on image turns if the reading is right? The
   amplitude case suggests yes.
