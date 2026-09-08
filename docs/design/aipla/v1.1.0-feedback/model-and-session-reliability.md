# A lost turn is a degraded lesson; a lost session is lost evidence

**Status**: **Design (OPEN)** — **1.1.100**
**Priority**: **P1** — workstream F. Needs only the existing deployment: no students, no classroom, un-gated by both legal blockers
**Estimated**: ~3–4d (M0 error classification ~1d · M1 fallback chain ~1d · M2 session-write resilience ~1d · M3 the loud-failure signal ~0.5d)
**Scope**: Backend — `adk/quota_retry.py` widened into a classifier + chain; a resilience wrapper around `VertexAiSessionService`; a typed `RUN_ERROR` the frontend can render instead of a stream that simply stops
**Dependencies**: `adk/quota_retry.py` (**shipped** — carries the hardest invariant already); `adk/session.py:474` `_LegacyAnonOwnerSessionService` wrapping `VertexAiSessionService` (**shipped** — the seam this extends); `config/models.py` registry (**shipped**, P2 2026-07-22 — the chain has to be registry-sourced or a model swap desynchronises it)
**Created**: 2026-09-08
**Source**: [upstream-capability-triage](../v2.1.0-extension/upstream-capability-triage.md) — upstream's `adk/model_errors.py`, `adk/resilient_llm.py` and `adk/resilient_session.py`, none of which this fork has

## Problem Statement

**Two failures here are silent, and one of them destroys research data.**

### 1. Everything that is not a 429

`adk/quota_retry.py` is good work and it already encodes the subtle part:

> 429 with **nothing yielded yet** → retry with jittered backoff.
> 429 **after any chunk** → re-raise. A truncated answer is bad; a truncated
> answer that then restarts is worse.

That invariant — *retry only while no visible output has reached the consumer* —
is the thing that is genuinely hard to get right, and we have it. What we do not
have is any of the breadth around it. The wrapper is `Gemini`-specific and
429-specific. A 503, a socket timeout, a provider 500, a malformed response:
each ends the student's turn. There is no classification step that says which
failures are worth retrying, which are worth trying a different model for, and
which are simply dead.

**And a dead turn is currently indistinguishable from a rude tutor.** The stream
stops. The student sees a tutor that stopped talking mid-thought. There is no
typed error code on the wire, so the frontend cannot say *"that was us, try
again"* — it has nothing to render.

This matters more in a classroom than in a chat product. Twenty-five students
hit the same project quota in the same five minutes; the failure is correlated
by construction, and it lands during the one lesson the teacher planned around it.

### 2. The session write that fails into a plausible-looking lie

We use Agent Engine as a standalone session store — `VertexAiSessionService`
pointed at a bare reasoning-engine resource (`adk/session.py:474`). That write
path has **no resilience**. A transient Vertex 5xx or 429 drops the events for a
conversation.

Meanwhile the Firestore `chat_sessions` mirror keeps its own count and **keeps
succeeding**. So the failure mode is not an error — it is a row that advertises a
long, healthy conversation with **no readable transcript behind it**. It looks
identical to a good session until somebody opens it.

This is the footgun this repo has now hit in four separate places, written down
in CLAUDE.md as *"a checker answers when it could not read its subject"* — the
reassuring answer is the one a broken read produces. Here it is worse than
reassuring: the mirror actively asserts a turn count that the canonical store
cannot support.

**Why this is P1 and not housekeeping.** The extension's strategic bet is the
discipline layer, and its named content is *"rubric-scored logs as assessment
evidence"*. That entire line of work is a claim about transcripts. A store that
silently drops events is not a reliability nuisance; it is a hole under the
research output. And the loss is unrecoverable — there is no second copy to
reconcile against, only a mirror that will confidently tell you how many turns
you have lost.

## Approach

Three seams, in dependency order. Upstream has shipped equivalents of all three
(`model_errors.py`, `resilient_llm.py`, `resilient_session.py`), so each
milestone is *adapt and test against our shape*, not design from zero — but none
of them can be copied unchanged, for reasons noted per milestone.

### M0 — Classify the failure (~1d)

A single module that answers "what do we do when a model call fails", returning:

- `transient` — retry the same model with capped full-jitter backoff
- `fallbackable` — worth trying the next model in the chain
- `code` — the typed `RUN_ERROR` the frontend renders
- `retry_after` — the provider's own suggestion, capped

**Adaptation:** upstream classifies across providers. We are Gemini-only by
decision (memory: model-provider direction; multi-provider is deferred and
Ollama-shaped for on-prem). So the classifier should be built to the *shape* of
several providers but populated for Vertex Gemini only, with the on-prem tiers
of ADR-003 in mind as the eventual second entry. Do not import a LiteLLM-shaped
abstraction we have no use for.

### M1 — Retry, then fall back (~1d)

Generalise `quota_retry.py` from "429 on one model" to "an ordered chain of
resolved models, primary first", preserving its invariant exactly: move down the
chain **only** while no non-thought content has reached the consumer. After that,
raise a typed error rather than re-running and duplicating visible output.

**Chain must be registry-sourced.** `config/models.py` is already the single
source (`default_model()` / `fast_model()`); a hand-written fallback list would
be the third place a model id lives and would rot the first time one is swapped.

**Open question for M:** what is the second entry? Gemini-only means the chain is
*a model tier*, not a provider — e.g. `default → fast` on overload, accepting a
weaker tutor over a dead one. That is a **teaching** decision, not an
engineering one: is a degraded tutor better than an honest failure, in a physics
lesson? Recommend asking AR before M1 lands, and defaulting to *fail loudly*
until answered.

### M2 — Make the session write resilient, and loud when it is not (~1d)

Wrap the standalone `create_session` / `append_event` path with retry on
classified-transient errors, and — the half that matters more — **make an
exhausted retry loud**. The mirror must not be allowed to record a turn the
canonical store rejected.

Concretely: the mirror's `turnCount` increment should be downstream of a
successful canonical append, not parallel to it. Where that cannot hold, the row
needs a field that says so, so a reader can tell "121 turns" from "121 turns we
can actually show you".

### M3 — Say so on the wire (~0.5d)

Every retry and fallback emits a reliability event; a dead turn ends with a typed
`RUN_ERROR` rather than a stream that stops. The frontend renders a real message.

**This is also the cheapest client-error visibility we will ever get**, and
[1.1.96](teacher-ui-friction-telemetry.md) M-1 names *"we have no client error
visibility at all"* as a half-day that may explain part of "the UI is difficult"
outright. These two should land together or M3 should be folded into 1.1.96.

## What this is not

- **Not multi-provider.** The chain is a tier ladder within Gemini. ADR-003's
  self-hosted and on-device tiers are the eventual second entries and are out of
  scope here.
- **Not a session-store migration.** [firestore-portability-seam](../v2.0.0-handover/firestore-portability-seam.md)
  is the doc for that question. This makes the current store honest.
- **Not a copy of upstream's three modules.** Their tests are worth reading and
  their invariants are worth keeping; their provider abstraction is not ours.

## Acceptance

- A forced 503 mid-turn, before any visible token, retries and completes.
- A forced 503 **after** visible output does *not* retry, and ends with a typed
  `RUN_ERROR` the frontend renders.
- A forced `append_event` failure never produces a mirror row whose `turnCount`
  exceeds what the canonical store can return.
- The chain's model ids come from `config/models.py` and nowhere else — asserted
  by a test, in the spirit of the P2 registry work.
- A test with a *real* failing store, not a mock that returns success — the
  dual-auth lesson (CLAUDE.md) is that a test double which mirrors the bug passes
  in lockstep with it.
