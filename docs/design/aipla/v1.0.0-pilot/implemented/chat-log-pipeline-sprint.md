# Sprint: CHAT-LOG-PIPELINE-1.2 — backend emitter + BQ-backed reads

**Sprint ID:** `CHAT-LOG-PIPELINE-1.2`
**Design doc:** [chat-log-pipeline.md](chat-log-pipeline.md) (SEQUENCE 1.2)
**Branch:** direct-to-dev (per feedback-aipla-git-workflow — `feedback_aipla_git_workflow.md` (agent-memory note, not a project file))
**Base commit:** `6a2f102` (dev HEAD)
**Estimate:** ~1.3 days (infra preconditions already live)
**Created:** 2026-05-29
**Status:** proposed (awaiting approval to execute)

## Sprint goal

Make chat data actually flow into the BigQuery store stood up in dev
(`chat_logs` dataset + `aipla-chat-logs` sink, live 2026-05-29). Emit
structured per-turn + per-workbench-event log entries from the backend,
and switch the teacher report route to read from BigQuery with a
session-state fallback — all behind the **unchanged** `SessionSummary`
shape so `/api/reports/*` responses don't change.

Backend-only. No frontend, no protocol changes. The framework pick (R1)
does NOT gate this — the data plane is framework-agnostic.

## Preconditions (already done — do NOT redo)

- ✅ `chat_logs` dataset (europe-north1, 30d partition TTL) + `aipla-chat-logs`
  partitioned sink + writer/reader IAM, live in `aipla-dev-2026` (gcloud,
  `ensure_chat_logs()`). Verified 2026-05-29.
- ✅ `google-cloud-logging>=3.12.0` already a dep; `GOOGLE_CLOUD_LOGGING=1` in prod.

## Scope locks

**In scope:**
- `emit_chat_turn()` + `emit_workbench_event()` structured-log helpers (never-raise).
- Wire emit sites: chat turns in the after-agent callback; workbench events in the iframe-context route.
- `google-cloud-bigquery` dependency + thin query client + `summarize_session_bq`.
- Reports route reads BQ first, falls back to live session state (both endpoints).
- `aiplatform logs tail/query/schema` CLI.
- Tests for all of the above.

**Out of scope:**
- The 2.5 analytics rubric (reads these tables; separate sprint).
- Flattened BQ views (terraform `create_views` / post-first-write; not backend code).
- Frontend report-screen changes (the shape is unchanged).
- Per-student grain (ADR-001 — per-group only).
- Content PII-scrub beyond the schema-level no-PII guarantee (open question, JB/DPIA).

## Milestones

| # | What | Files | LOC (impl+test) |
|---|---|---|---|
| M1 | **Emitters** — `emit_chat_turn()`, `emit_workbench_event()`: Cloud Logging structured entries under log ids `aipla_chat_turn` / `aipla_workbench_event`, OTel-GenAI-aligned attribute names, **never raise** (log+return on client error). Unit tests: payload shape, **no-PII assertion**, never-raise. | `backend/observability/chat_log.py` (new), `backend/tests/unit/test_chat_log_emit.py` (new) | ~120 + ~90 |
| M2 | **Wire emit sites** — chat turns from the after-agent callback (`make_after_agent_response` gains `owner_uid` + `skill_id` closures, or a sibling emit callback wired in `adk/agent.py`); workbench events from `POST /api/sessions/{id}/iframe-context`. Diff-by-turn so re-runs don't double-emit. Tests for both sites. | `backend/adk/callbacks.py`, `backend/adk/agent.py`, `backend/protocols/iframe_context_routes.py`, tests | ~70 + ~70 |
| M3 | **BQ read path** — add `google-cloud-bigquery` dep; `backend/db/bigquery.py` thin parameterised client (region-pinned); `summarize_session_bq()` returning the **same `SessionSummary`** (conversation, message_count, exact `sim_run_count` from workbench events, duration); reports route BQ-first + session-state fallback on **both** `/sessions/{id}` and `/groups/{code}`. Tests: round-trip (mocked BQ), fallback-when-empty, exact sim-run count. | `backend/pyproject.toml`, `backend/db/bigquery.py` (new), `backend/reports/session_summary.py`, `backend/protocols/reports_routes.py`, `backend/tests/api_tests/test_chat_log_pipeline.py` (new) | ~190 + ~120 |
| M4 | **CLI** — `aiplatform logs` group (`tail <group_code>`, `query --skill --since`, `schema`) over `AIPlatformClient`, modelled on `commands/sessions.py`. Tests. | `cli/aiplatform/commands/logs.py` (new), `cli/aiplatform/__init__.py` (register), `cli/tests/test_cli_logs.py` (new) | ~110 + ~60 |
| M5 | **Quality gates + manual e2e** — `make lint` + `make test-fast` green; manual: run a session against deployed dev → `aiplatform logs tail <code>` shows the turn within ~60s → teacher report matches with exact sim-run count. Direct-to-dev commit. | — | ~40 |

**Total:** ~870 LOC (impl+test). ~1.3d wall-clock.

## Acceptance gates

- [ ] A chat turn lands as an `aipla_chat_turn` BQ row keyed by `group_id` within ~60s.
- [ ] A workbench interaction lands as an `aipla_workbench_event` row.
- [ ] Emitters never raise into the chat path (client-error test passes).
- [ ] No PII column beyond `group_id` (schema-level assertion passes).
- [ ] `summarize_session_bq` returns the same `SessionSummary`; `sim_run_count` exact.
- [ ] Reports route reads BQ for ended sessions, falls back to session state in-flight — no 5xx either way; `/api/reports/*` response shape unchanged.
- [ ] `aiplatform logs tail/query/schema` work against deployed dev.
- [ ] `cd backend && make lint && make test-fast` green.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Threading `owner_uid`/`skill_id` into the after-agent emit (the current `make_after_agent_response()` takes no args) | Med | `make_session_tracker` already captures both in closures — mirror that wiring in `adk/agent.py`; add a focused test |
| Double-emitting turns across the bursty agent loop | Med | Track an emitted-turn cursor in session state (mirror `_STATE_TURN_COUNT`); emit only events past the cursor |
| Sink ingestion lag makes the e2e check flaky (<60s but not instant) | Low | e2e polls `aiplatform logs tail` with a short retry; BQ-first/fallback means the report still works pre-ingestion |
| `jsonPayload` numeric fields land as STRING/FLOAT in BQ | Low | `summarize_session_bq` CASTs to INT64 (matches the terraform views); covered by the round-trip test |
| Adding `google-cloud-bigquery` bloats the image / version conflict | Low | Pin a range compatible with `google-cloud-logging`; `uv lock` + `make test-fast` catches conflicts |

## Dependencies

- **1.2 infra** — dataset + sink + IAM (✅ live in dev).
- **`summarize_session`** ([session_summary.py](../../../../backend/reports/session_summary.py)) — the shape `summarize_session_bq` must preserve; stays as the fallback reader.
- **`make_session_tracker`** ([callbacks/session.py](../../../../backend/adk/callbacks/session.py)) — the closure-wiring pattern M2 mirrors. (File moved 2026-06-02 from monolithic `callbacks.py` into a `callbacks/` package; commit `c68a67f`.)
- **iframe-context route** ([iframe_context_routes.py](../../../../backend/protocols/iframe_context_routes.py)) — the workbench-event emit site.

## Out of scope (do NOT start)

- 2.5 analytics rubric · flattened views · ~~frontend changes~~ · per-student data · content PII-scrub.

## Follow-up: teacher UI display of workbench events (2026-06-02)

The sprint shipped the emit pipeline and made `sim_run_count` an exact count, but the teacher-facing report UI only displayed the count — not the underlying events. This was a UI gap, not a capture gap, but it confused enough people (including the assistant that helped close it out) that this note exists.

**Closed by commit `868e3db`:**

- `SessionSummary` now carries a `workbench_events: list[WorkbenchEvent]` field ([session_summary.py](../../../../backend/reports/session_summary.py)).
- `summarize_session_bq` SELECTs the event rows (`timestamp`, `server`, `tool`, `field`, `value`) instead of `COUNT(*)`; `sim_run_count` is derived from `len(events)`.
- The teacher report page (`/teacher/reports/groups/[groupId]`) renders a **Workbench activity** section beneath the conversation log, one row per event (e.g. `[10:15] boldkast · theta · 45`).

**Why it mattered:** the original sprint scope said "out of scope: frontend changes," which was correct at the time (1.2 was a backend-only landing). The follow-up belongs here for traceability: the surface that consumes 1.2's data finally surfaces its full payload.
