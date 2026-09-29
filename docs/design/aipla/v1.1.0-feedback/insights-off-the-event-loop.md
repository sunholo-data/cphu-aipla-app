# A researcher's dashboard froze a student's tutor for a minute — insights off the event loop

**Status:** **M0 + guard SHIPPED (prod v0.1.63, 2026-09-22)** — M2 (visible stall), **M3 (report route, found 2026-09-29)**, M4 (alert) open — **1.1.131**
**Priority:** **P0** — any researcher or teacher opening a cold insights view during a lesson stalls **every** student stream on that instance, and the class sees a dead tutor with no error
**Estimated:** ~0.5d (M0 thread-offload every blocking route ~0.25d · M1 guard ~0.15d · M2 client stall message ~0.1d)
**Scope:** Backend — `protocols/insights_routes.py`, `insights/cache.py`, any other `async def` route doing blocking I/O; a CI guard script. Frontend — `hooks/useSkillAgent.ts` watchdog
**Dependencies:** [1.1.51 researcher-analytics-rollout](researcher-analytics-rollout.md) (**shipped** — the `scope=all` query that stalled); [1.1.109 researcher-chat-log-lens](researcher-chat-log-lens.md) (**shipped** — same BigQuery-backed shape, audit it too). Related: the **silent-failure family** upstream (`resilient_llm.py`, `stream_invariants.py` — CLAUDE.md *Upstream tracking*), candidate for workstream F. **Un-gated**
**Created:** 2026-09-22
**Source:** [classroom-session-2026-09-22-followups.md](classroom-session-2026-09-22-followups.md), finding 6

## Problem Statement

On 22 September at 14:48:11 local, group `bold-kazoo-64` sent a message.
Gemini returned its first chunk **0.67 s** later. The student received the rest
**59 s** after that, by which time their Safari fetch had failed
(`client_error … message=Load failed`, 14:49:22) and they had re-sent the same
message — which a different instance answered in 1.0 s.

### Mechanism (verified from logs + code)

| UTC | Instance `…7fd9ca62` |
|---|---|
| 12:48:13.27 | first tutor chunk for `bold-kazoo-64` ("Det…") |
| 12:48:13.34 | a researcher opens `GET /api/insights/compare?since=7d&scope=all` |
| 12:48:19.8 → 12:49:12.7 | **the instance logs nothing at all**; the other instance serves normally |
| 12:49:12.72 | `insights_query route=compare` → 200, **59.39 s** |
| 12:49:12.725–.733 | every buffered tutor chunk flushes in one burst; `Final response` |

The same researcher's `/environment`, `/teacher/bootstrap`, `/classes`,
`/classes/…/live` requests all took 35–48 s and completed in the same instant.
**The whole event loop was blocked.**

- `insights_routes.py:162-190` — `async def compare(…)` calls
  `CACHE.get_or_compute(key, _compute)`.
- `insights/cache.py:95` — `value = compute()` runs **inline**:
  `aggregates.teacher_compare(…, scope="all")`, synchronous BigQuery, on the
  asyncio loop.
- `Dockerfile:41` — `uvicorn … --workers 1`. One blocked coroutine freezes every
  SSE stream on the instance.

`summary` (`insights_routes.py:122-158`) has the same shape; the file has 8
`async def` routes and each needs checking. It is not a quota/retry artefact —
`quota_retry.py`'s worst case is ~2.25 s backoff and a ~20.5 s first-token
deadline, and neither fired.

**Why the student saw no error.** The `useSkillAgent` watchdog
(`useSkillAgent.ts:526-535`) fires only if `RUN_STARTED` never arrives; it had.
A stream that starts and then stalls is indistinguishable from a slow one.

**This is the "a checker/route answers slowly and everything else pays" shape
the pilot follow-ups warned about:** a researcher-facing feature degrading the
student-facing one, silently, in the room.

## Goals

1. No request handler blocks the event loop — a slow researcher query costs the
   researcher, not the class.
2. A guard stops the next one.
3. A stalled stream tells the student something within ~15 s.

## Design

### M0 — offload (~0.25d)

`get_or_compute` gains an async twin that runs `compute` via
`await asyncio.to_thread(compute)` (or `run_in_threadpool`); every insights route
uses it. Alternatively declare the routes plain `def` so FastAPI threadpools them —
but that is easy to undo by accident, so prefer the explicit offload.
Audit the other BigQuery / Firestore-heavy routes in the same pass:
`research_*`, `chat_log_*` (1.1.109), `rubric_*`.

Test: an insights route whose `compute` sleeps 2 s does not delay a concurrent
`GET /health` by more than ~100 ms.

### M1 — guard (~0.15d)

`scripts/check-blocking-in-async.sh` (`make check-blocking-in-async`, CI
`local-mode-safety`): fail on an `async def` route in `backend/protocols/` that
calls a known-blocking module (`google.cloud.bigquery`, `insights.aggregates`,
`CACHE.get_or_compute`) without `to_thread` / `run_in_threadpool`. Add a row to
the CLAUDE.md footgun table.

### M2 — a stall is visible (~0.1d)

Extend the `useSkillAgent` watchdog: after `RUN_STARTED`, no content event for
15 s → a quiet *"Tutoren svarer langsomt — vent lidt"* line (copy object), and at
45 s an explicit retry offer. Today the student decides for themselves, and
re-sending doubles the turn.

## Also from the same log window, not in scope

- **5xx is not retried.** `quota_retry._is_resource_exhausted` matches 429 only;
  a Gemini `500 INTERNAL` mid-stream at 12:20:55Z failed a turn outright
  (session `69ee97ff`). Belongs with the upstream `resilient_llm.py` port
  decision (workstream F), not here.
- **Scaling knob, not the fix:** `--workers 1` and Cloud Run concurrency are
  reasonable once nothing blocks the loop. Raising workers would hide M0, not
  solve it.

## What shipped — 2026-09-22

- **M0.** `CACHE.aget_or_compute` runs a miss in `asyncio.to_thread`. Every
  BigQuery-backed `async` path now offloads: `insights_routes` (summary, compare,
  the four per-class routes, both cost routes), `research_logs_routes` (`_read`),
  `classes_routes.get_class_spend`, `analytics/tools.py` (the four query tools and
  both session listings, shared with the teacher analytics chat agent), and
  `analytics/summarise.py`'s sample fetch.
- **M1, changed from the design:** a **runtime** guard rather than a grep script.
  Every BigQuery call goes through `db.bigquery.run_query`, which now logs
  `run_query on the event loop` with the caller's stack when called on the loop
  thread. It catches indirect callers a static grep would miss. It does not
  cover long synchronous Firestore work, which the footgun row in CLAUDE.md says.
- **Test:** `test_blocking_queries_off_the_loop.py` drives the real routes via
  ASGI beside a `/ping`. On the pre-fix code `/ping` waited 0.91 s behind a
  0.8 s query; on the fix it answers at once.
- **M2 (visible stall in the client) is still open.**

## Verified against prod, and what is still open — 2026-09-29

Source: [class-visit-2026-09-feedback-triage.md](class-visit-2026-09-feedback-triage.md), item 1
(*"the platform crashed, it was easy fix by only refreshing the browser"*).
Prod logs, 21–27 Sep, ~102.6k request rows, read with full permission.

**The 22 Sep crash was this bug.** At 14:44:22 CEST `insights/compare?scope=all`
took 66 s on revision `00058-9pq`, and was called again at 14:45, 14:46 and 14:48.
Every request that reached that instance queued behind it: pulses, signals,
`voice/config` and one `/stream` took 33–65 s, and 79 slow requests landed in
14:44 alone. All four >60 s streams of the week fall in this window. A student
client-error at 14:49:22 from a class IP reads `Load failed` on `/chat`, which is
the "refresh fixes it" pattern. **The same freeze had already happened** on 21 Sep
(15:10, 15:38, 16:39) and on the morning of 22 Sep (10:59, 11:10), with stalls
up to 212 s. The M0 fix reached prod as `00059-njn` at 22 Sep 23:45 CEST (v0.1.63).
Since then `compare?scope=all` still takes ~53 s but no longer blocks anyone else.

⚠️ **Log-query note.** Python `ERROR:` lines carry no Cloud Logging severity, so
`severity>=ERROR` found 29 entries in the week. The loop detector alone logged
114 on 24 Sep. Query by text, not severity.

### M3 — the group report route (~0.5d) · **P1**

`GET /api/reports/groups/{code}` (`reports_routes.get_group_latest_report`)
calls `find_latest_session_id_for_group_bq` synchronously, and
`reports/session_summary.summarize_session_bq` calls `run_query` directly, both
inside an `async def`. The M1 runtime guard caught it: 114 hits on 24 Sep, more
on 28–29 Sep on `00064-zbn`. The teacher's live view polls it every few seconds.
p95 is 1.8 s and the worst is 7.5 s, so these are small class-wide freezes
rather than a 60 s one. Offload both and add the route to
`test_blocking_queries_off_the_loop.py`.

### M4 — the guard pages someone (~0.25d) · **P1**

The runtime guard only logs today, and it was the logs that found M3, five
days late. Add a log-based metric + alert on prod for `run_query on the event
loop` (≥1 in 5 min). A detector no one is told about is the same "silent
failure" shape this doc exists to close.

### Later — separate the researcher load from the student loop (~1–2d)

`--workers 2`, or insights as its own Cloud Run service. **Only after M3 is
done.** It is still true that raising workers now would hide the bug rather than
fix it. Decide in workstream F with AD.
