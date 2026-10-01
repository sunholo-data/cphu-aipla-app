# Retry, then escalate — a failed or struggling turn gets a second chance on a stronger model

**Status:** **M0–M2 SHIPPED 2026-10-01** (classifier, retry 429/5xx/stall, fail-over to the smart tier) · M3 (escalate hard turns) and M4 (cost + telemetry) OPEN — **1.1.142**
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

## What shipped — 2026-10-01 (M0–M2)

**Ported down, not merged**, from `sunholo-data/platform-source` `upstream/dev` @
`c928fca6` (= `main` @ `b322f55d` + #14, the silent-stall class this fork
authored and ported up on 2026-09-22). `model_errors.py` is verbatim below an
AIPLA provenance paragraph; `resilient_llm.py` is adapted.

- **M0 — `backend/adk/model_errors.py`** + `tests/unit/test_model_errors.py`
  (upstream's table kept, LiteLLM rows included — inert here, correct when a
  local tier arrives; AIPLA rows added for the real ADK `_ResourceExhaustedError`,
  the 22 Sep `500 INTERNAL`, Vertex `retryDelay` JSON, and stalls).
- **M1+M2 — `backend/adk/resilient_llm.py`.** Retries 429, 5xx and first-token
  stalls with capped full-jitter backoff (retry-after honoured, capped at 10 s);
  falls over down the chain **only before visible output**; after visible output
  raises `ModelTurnError` (no second answer). AIPLA adaptations, each reasoned in
  the module docstring: a **wall-clock budget of 25 s** on a patchable clock
  (upstream bounds by retry counts only); the first-token deadline (10 s, one
  stall retry on the primary, the fallback gets what is left); cooldown keyed by
  **model**, not provider (every model here is "gemini"); dropped
  `schema_conformance` (an Express-Mode-only 400 — AIPLA is Vertex-only), the
  cross-provider tool-history sanitizer and `FAULT_INJECT_MODEL` (LiteLLM-only).
- **The chain is data:** `tutor_chain: [gemini-3-5-flash-lite, gemini-3-8-flash]`
  in `config/models.yaml`, validated (registered, google, no repeats, head =
  `platform_default`) and read by `config.models.tutor_chain()`.
- **The seam:** `adk/agent.py` `resolve_model()` now returns
  `ResilientLlm(chain=[Gemini(...), …])` for every `gemini-*` id — the whole
  chain when the id is the chain head (the platform default), a chain of one
  (retry, no fail-over) for a skill pinning any other model. Non-Gemini
  providers are untouched. Members are bare `Gemini` (no `retry_options`).
- **`adk/quota_retry.py` is deleted**, with its test file; its 429 retry and
  first-token deadline both live in the wrapper now, so attempts cannot
  multiply. `_QuotaTolerantGemini` is gone (only tests imported it).
- **The chat-log stamp names the model that answered.** The `model` column was
  the skill's *configured* model (`adk/callbacks/session.py`). A failed-over
  response now carries `custom_metadata["served_model"]`, ADK persists it onto
  the session event, and the row (and `record_llm_cost`) use it — so a
  failed-over turn prices at the smart-tier rate. An ADK Runner test proves the
  stamp survives to the event.
- **`skills/skill_processor.py`** translates a `ModelTurnError`: a `ClientError`
  cause keeps its existing translation (429 → `QUOTA_EXHAUSTED`), anything else
  a Danish student message with the classifier's code.
- Reliability events `MODEL_RETRY` / `MODEL_FALLBACK` ride the existing
  LatencyTracker queue as AG-UI CUSTOM events (the compaction notices' path).
  The frontend ignores them today.

**Known gaps (follow-ups):**

- **M3 escalation and M4 telemetry are not built.** M4's "share of turns on the
  smart tier" can now be read from the `model` column; the split by
  fail-over vs escalation vs opt-in needs M3 first.
- **The skill_processor branch may rarely fire.** ag_ui_adk catches runner
  exceptions itself and emits `BACKGROUND_EXECUTION_ERROR` with `str(exc)` —
  pre-existing for `ClientError` too. A student who exhausts the budget may see
  `model turn failed on …` rather than the Danish line. Worth a translate pass
  on ag_ui_adk's RUN_ERROR in `adk/agui.py`.
- **No frontend notice** for `MODEL_FALLBACK` (the optional "using a stronger
  model" line on the 1.1.131 M2 stall indicator).
- **Cooldown is per instance**, as upstream.

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
