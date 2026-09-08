# What the template built that we didn't — triage against our design record

**Status**: **Triage (reference)** — not a deliverable; the input to three new design docs. **1.1.101 shipped and 1.1.102 closed on measurement, both 2026-09-08**
**Created**: 2026-09-08
**Source**: the first reconcile against `sunholo-data/platform-source` (`upstream/main` @ `b322f55d`), made possible by the porting pipe wired the same day — see CLAUDE.md "Upstream tracking"
**Reader**: M now; AD from October, as the map of what we deliberately did not take

## Why this exists

The fork ran four months with **no route back to the template and no route down
from it**. The route up is now open ([platform-source#6](https://github.com/sunholo-data/platform-source/pull/6)).
The route down is deliberately *not* a merge — upstream has 725 files this repo
does not, plus 423 shared files it changed that we never touched, and with no
common ancestor a merge means `--allow-unrelated-histories` across ~1,900 files.

The decision of record is **read upstream for ideas, port down per-file with
review, never merge**. This document is that read, done once, so nobody has to
do it again from scratch — and so that the things we choose *not* to take are
recorded as choices rather than as oversights.

**The uncomfortable finding first.** Two upstream modules cite this fork by name
in their own docstrings: `stream_invariants.py` says *"v6.19.0, AIPLA #39"* and
`schema_conformance.py` says *"downstream fork entry #2"*. Upstream read our
feedback ledger and fixed things **for us**, and we never collected them,
because no mechanism existed to. The ledger's own triage line — *"Fixed
upstream: 41 entries"* — has been sitting there since 2026-07-29 meaning
something we never acted on.

## The match

Legend: ✅ we have it · 🔀 we solved it differently · ❌ gap · ➖ not applicable here

| Upstream capability | Their design doc | AIPLA status | Our nearest doc |
|---|---|---|---|
| **Model error classification** (`model_errors.py` — transient / fallbackable / typed `RUN_ERROR` / `retry_after`) | v6.13.0 cross-provider-model-fallback | ❌ **Gap** | — |
| **Retry + fallback chain** (`resilient_llm.py`) | v6.13.0 | 🔀 **Partly.** `adk/quota_retry.py` has the *hard* half — retry only while no visible output has reached the student — but only for 429, only Gemini, and with no fallback | — |
| **Session-write resilience** (`resilient_session.py`) | — | ❌ **Gap, and it bites us specifically** | [progress-conversation-lifetime](../v1.1.0-feedback/progress-conversation-lifetime.md) (adjacent, not this) |
| **Tool-result confidentiality invariant** (`stream_invariants.py`) | v6.19.0 stream-boundary-invariants | 🔀 **Convergent, ours weaker by default** — STRIP-1 redacts by registry membership, so an unknown tool name is *allowed* | `adk/stream_redaction.py` (STRIP-1, 2026-07-11) |
| **Built-agent cache** (`agent_cache.py`, TTL+LRU) | v6.14.0 | ❌ **Gap.** We rebuild every turn — and we already instrument the cost (`STAGE_AGENT_FACTORY_DONE`) | [mobile-performance-pass](../v1.1.0-feedback/mobile-performance-pass.md) (different layer) |
| **Elicitation-in-chat primitive** (`elicitation.py` — confirm / confirm-with-fields, values read back authoritatively) | v6.8.0 elicitation-in-chat-primitive, v6.12.0 mcp-elicitation-adoption | ❌ **Gap** — and it is plausibly *half of* our largest open item | [1.1.78 question-set-element](../v1.1.0-feedback/question-set-element.md) (OPEN, ~4–5d) |
| **Second-pass compaction** (re-derive an idle session's summary from raw events) | v6.23.0 compaction-off-the-critical-path, conversation-context-fidelity | ❌ Gap | [session-report-summary-primary](../v1.1.0-feedback/session-report-summary-primary.md) |
| **Background agent runs** | v6.24.0 background-agent-runs | ❌ Gap | [session-analytics-rubric](../post-pilot/session-analytics-rubric.md) — the obvious consumer |
| **Notability tiers for activity events** | v6.11.0 workbench-home-and-curated-activity | 🔀 We curate per-surface ad hoc | [workbench-element-awareness](../v1.1.0-feedback/workbench-element-awareness.md) |
| **Gemini schema conformance** (`schema_conformance.py`) | v6.20.0 | ➖ Express-Mode-specific; we are on Vertex | — |
| **Tenant-scoped data access / admin console** | v6.16.0, v6.18.0 | ✅ Shipped ours | [delegated-programme-administration](../v1.1.0-feedback/delegated-programme-administration.md) (PROGADMIN-1) |
| **Multi-audience auth** | v6.19.0 multi-audience-auth | ✅ Ours is further along — it is our most-bitten footgun and now has a CI gate | `scripts/check-auth-dispatcher.sh`, ADR-001 |
| **Build-once artifact promotion** | v6.20.0 | ✅ Shipped ours first; upstream's doc came *from* us | [build-once-artifact-promotion](../v1.0.0-pilot/build-once-artifact-promotion.md) |
| **Production online evaluation** | v6.20.0 | ❌ Gap, but ours has a named owner already | "eval in CI" in [handover-package](../v2.0.0-handover/handover-package.md) |
| A2UI render family (maps, PPA, ENTSO-E, obligations, market prices) | v6.12.0, v6.23.0 | ➖ Energy/legal domain surfaces. Not physics teaching | — |
| Google Workspace MCP, WebMCP interop, Gemini Enterprise adoption | v6.2.0, v6.22.0 | ➖ Out of scope for the engagement | — |

## What to actually do

**Three, and they are all one shape: failures that do not announce themselves.**
That is not a coincidence — it is the retrospective's first lesson and
[workstream F](plan-2026-09-to-2027-04.md) of the extension plan, which
currently budgets ~5 days to write that class of guard *from scratch*. Adapting
is likely cheaper than writing, and it comes with upstream's tests.

| New doc | Why it earns a slot | Est |
|---|---|---|
| [1.1.100 model-and-session-reliability](../v1.1.0-feedback/model-and-session-reliability.md) | A dropped session is not a degraded lesson, it is a **lost transcript** — and transcripts are the assessment evidence the whole discipline-layer strategy rests on | ~3–4d |
| [1.1.101 tool-result-visibility-invariant](../v1.1.0-feedback/tool-result-visibility-invariant.md) | STRIP-1 fails **open** for any tool name it does not recognise, and teacher-authored MCP tools are exactly that | ~1–1.5d |
| ~~[1.1.102 agent-build-cache](../v1.1.0-feedback/agent-build-cache.md)~~ | **CLOSED 2026-09-08 by its own M0 gate.** Warm build is 113–246 ms against a prod median TTFT of 6,121 ms — ~2–4% of a turn. The premise did not transfer: upstream's cost came from MCP toolsets and the two-agent thinking path, and **no AIPLA skill uses either**. Cheaply ruled out a plausible suspect | ~0.25d spent |

All three need **only the existing deployment** — no students, no classroom, no
Google data agreement, no Prøvebanken approval. That is the property that makes
them schedulable *now*, in the wait the extension plan is explicitly about
spending well.

## Two things the first implementation pass turned up

Neither came from upstream; both came from checking upstream's premises against
our own deployment, which is the argument for doing this read properly.

- **Prod TTFT is far off the stated bar.** 358 turns over 30 days: median
  **6,121 ms**, p95 **53,808 ms**, max 177 s, against a platform bar of *first
  token <1s without tools*. The agent factory is 2–4% of that, so the cause is
  elsewhere and is not yet identified. **Probably the same report as
  [1.1.96](../v1.1.0-feedback/teacher-ui-friction-telemetry.md)'s "the UI is
  difficult"** — worth its own doc, scoped to where the six seconds goes.
- **Our per-stage latency marks do not reach the logs.** ✅ **FIXED 2026-09-08.**
  `LatencyTracker.emit_log` passes them as `extra={"json_fields": ...}`, but
  every prod row is a flat `textPayload` carrying only `skill`, `ttft_ms`,
  `total_ms`, `mode`. So `agent_factory_done_ms` is not queryable, and the M0
  number had to be measured locally rather than read from 358 real turns already
  recorded. An instrument that looks like it is recording and is not — the
  repo's own recurring theme, one layer down.
  **`emit_log` now writes a single JSON line to stdout, which Cloud Run parses
  into `jsonPayload`**, so every stage mark is queryable. Kept local to
  `timing.py` deliberately: OTEL owns the root handler and the global logging
  config has its own incident history. **And the test that should have caught
  this asserted `json_fields` on the LogRecord** — the mechanism the code used,
  not the outcome it existed for — so it passed for months while the formatter
  dropped every field. Re-pointed at the emitted line. Same lockstep shape as a
  route test that `dependency_overrides` the wrong auth symbol.
  ⏳ **Data starts accumulating from the next dev deploy; prod needs a promote.**

## What to deliberately leave

- **Elicitation primitive.** Genuinely good, and plausibly retires part of
  1.1.78. But 1.1.78 is correctly parked behind the legal gate, and pulling its
  enabler forward would be building ahead of a gate someone else holds. **Revisit
  when 1.1.78 schedules** — and cite this row rather than re-deriving it.
- **Second-pass compaction and background runs.** Both are strong, both serve
  rubric-scored logs, and both are *discipline-layer* work (workstream D) rather
  than hardening. **Decide in November** with the rest of D, not now.
- **Everything marked ➖.** Recorded so the next reader can see it was assessed.

## The standing habit this replaces

Nothing was collecting upstream's answers to our own reported problems. The
reconcile is now one command — `make upstream-reconcile` — and the pin it
compares against lives in `.template-fork-target`. **Re-run it when the pin
moves, not on a calendar**; the useful signal is "upstream shipped something
since we last looked", and the ledger in
[docs/upstream-feedback.md](../../../upstream-feedback.md) is where the answer belongs.
