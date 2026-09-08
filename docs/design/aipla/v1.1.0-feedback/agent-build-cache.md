# We rebuild the whole agent on every turn, and we already measure it

**Status**: **Design (OPEN)** — **1.1.102**
**Priority**: **P2** — cheap, un-gated, and the most concrete answer we have to "the product feels slow". Below 1.1.100/1.1.101 because it costs latency, not correctness
**Estimated**: ~1–2d (M0 measure from the mark we already emit ~0.25d · M1 the cache + key ~0.75d · M2 invalidation correctness ~0.5d)
**Scope**: Backend — a TTL+LRU cache in front of `create_agent_with_thinking`, keyed on everything that changes the built agent
**Dependencies**: `observability/timing.py` `STAGE_AGENT_FACTORY_DONE` (**shipped**, TTFT-OPTIMIZATION M1 2026-04-28 — the measurement already exists); `adk/agent.py:867` `create_agent_with_thinking` (**shipped** — the seam); `skills/skill_processor.py` (**shipped** — the per-turn caller)
**Created**: 2026-09-08
**Source**: [upstream-capability-triage](../v2.1.0-extension/upstream-capability-triage.md) — upstream's `adk/agent_cache.py` (v6.14.0), which this fork does not have
**Related**: [mobile-performance-pass](mobile-performance-pass.md) (1.1.x, June) is the **frontend** half of the same complaint and explicitly defers backend work — *"light backend touch only if TTFT is implicated"*. This is that touch, and it can be costed without waiting for that profile

## Problem Statement

**`create_agent_with_thinking` runs on every chat turn and nothing caches it.**

Each call rebuilds the model chain, every tool, every MCP toolset object — a
Firestore read per server — and recursively builds every delegate. In the
three-tier thinking configuration it does that **twice**, because
`create_agent_with_thinking` builds a fast agent and a thinking agent and wraps
them in `_HeuristicRouter` (`adk/agent.py:889`). Two full builds, per turn, for
any skill with a `thinking_model` set.

We are not guessing at the cost. `observability/timing.py` already emits
`STAGE_AGENT_FACTORY_DONE` for exactly this reason, and the comment says why it
was added:

> Added 2026-04-28 (TTFT-OPTIMIZATION M1) to attribute the unexplained 5.7s gap
> between `session_index_done` and `before_agent_done`.

So the instrumentation exists, has been running since April, and the first
milestone here is arithmetic on data we are already collecting rather than a new
measurement exercise.

**Why it matters in this deployment specifically.** A classroom is the worst case
for per-turn cost: twenty-five students on shared phones start within the same
few minutes, and each cold instance pays process import *plus* this build before
anyone sees a token. Teachers have reported the product is slow and the platform's
own stated bar is *first token <1s without tools*. Rebuilding an object graph
that did not change between turn 4 and turn 5 is the least defensible part of
that budget.

**The build is a pure function of its inputs**, which is what makes this
tractable rather than a refactor. Session id, message and document ids all arrive
at *run* time through the Runner and `initial_state` — never at build time. The
same `(skill, user, access)` produces the same agent.

## Approach

### M0 — Put a number on it before building anything (~0.25d)

Read `agent_factory_done` out of the existing structured logs on deployed dev
and test: median and p95, split by cold vs warm instance, and split by whether
the skill has a `thinking_model` (the two-build path).

**This gates the rest.** If the warm cost is small, M1 is not worth 0.75d and
this doc should be closed with the number written into it. Publishing that number
is the deliverable of M0 either way — the repo's own lesson is that a checker
which cannot read its subject must not return a reassuring answer, and
"performance work" with no measurement is the same failure wearing different
clothes.

### M1 — TTL + LRU cache on the build (~0.75d)

Cache the built agent. The key must capture everything that changes it — a
cache that is wrong is far worse than one that is absent, because the failure is
a student getting another configuration's tutor:

- `skill.skill_id` **and** `skill.updated_at` — a teacher edit must invalidate
  immediately; the `updated_at` component is what makes that automatic rather
  than a TTL race
- `activity_id` — ALS-1 M0 selects the activity whose teacher-focus shapes the
  agent, so two activities on one skill are two different agents
- the user's **access context**, not the user — group tags and tier change tool
  availability; keying on identity would cache per student and never hit
- `thinking_model` presence, since it selects a different construction entirely

**Note the AIPLA-specific key component:** upstream keys on `(skill, user,
access)`. Ours must add `activity_id`, and getting that wrong would serve a
student the tutor for the *wrong activity* — silently, and plausibly enough that
it would be reported as "the AI is confused" rather than as a bug.

### M2 — Prove invalidation, not just hit rate (~0.5d)

The tests that matter are the negative ones:

- a teacher edit (bumping `updated_at`) is visible on the **next** turn
- two activities on one skill do not share an entry
- two access contexts do not share an entry
- an entry expires

A hit-rate metric is worth emitting but is not the acceptance criterion; a
100% hit rate is exactly what the broken version produces.

## What this is not

- **Not a cache of model responses.** Only the constructed agent object.
- **Not warm-start / cold-start work.** Instance warming is a separate lever and
  belongs with [mobile-performance-pass](mobile-performance-pass.md)'s findings.
- **Not a change to the thinking-router tiers.** Whether building two agents per
  turn is the right design is a different question; this makes the current design
  cheap rather than relitigating it.

## Acceptance

- The M0 number is written into this doc, whichever way it points.
- A teacher's skill edit takes effect on the next turn — tested, not assumed.
- Two activities on one skill never share a cache entry — tested.
- `agent_factory_done` on a warm instance drops materially, measured the same
  way as the baseline so the two numbers are comparable.
