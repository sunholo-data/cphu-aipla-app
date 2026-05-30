# chat-log-pipeline — group-ID-keyed chat logs to BigQuery

**Status**: Implemented — SEQUENCE row 1.2
**Priority**: P0 (keystone for teacher monitoring + analysis; everything cohort-scale analytical depends on it. Promoted to committed v1 critical-path on 2026-05-28 — teacher monitoring + analysis must be live *for* the pilot, not built on its aftermath)
**Estimated**: 1.5d (sink + emitter + BQ-backed report read); +0.5d if PII-scrub lands this sprint
**Scope**: Backend (structured chat-turn + workbench-event emitter in the agent callback; BQ-backed `summarize_session`), infra (Log Router sink + partitioned BQ tables — Terraform, shared with 1.1), CLI (`aiplatform logs` group)
**Dependencies**: 1.1 [aipla-cloud-bootstrap](aipla-cloud-bootstrap.md) (creates `google_bigquery_dataset.chat_logs` + the Log Router sink IAM); the existing OTel observability wiring (Axiom #8 — `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` already the default); the `make_session_tracker` after-agent callback in [`backend/adk/callbacks.py`](../../../../backend/adk/callbacks.py)
**ADRs implemented**: ADR-001 (group anonymity — no PII, group-ID keying), ADR-005 (chat log storage — researcher-accessible BigQuery dataset, consent-driven retention), ADR-008 (observability — OTel → Cloud Logging → BigQuery, all in-project)
**Created**: 2026-05-28
**Last Updated**: 2026-05-30

## Problem statement

The Phase-2 teacher report (`backend/reports/session_summary.py`) reads chat turns **live out of ADK session state** — in-memory in dev, Vertex AI Sessions in prod. That was the right shape for the Wed 3 June demo: zero new infra, one session at a time. It does not scale to what the pilot needs:

- **No durable, queryable store.** A session's turns live only as long as the ADK session does. There is no cross-session, cross-group, cross-week table a researcher or the analytics rubric can query. ADR-005 calls for exactly this and it does not exist.
- **`sim_run_count` is a heuristic.** It counts distinct `mcp_app_context.*` keys in final session state ([session_summary.py:77](../../../../backend/reports/session_summary.py#L77)) — "good enough for the demo, replace with a proper event-tap in 1.2." This is that event tap.
- **The analytics rubric (2.5) has nowhere to read from.** [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) is gated on this doc landing first — ICAP/CPS engagement labelling and DRA/FCI concept tracking run over the stored conversation log + workbench-event stream, post-hoc, at cohort scale. No BigQuery sink → no rubric.
- **Research thesis depends on it.** The contract's outcome question ("does AI tutoring improve physics learning in stx?") needs logs aggregable across cohorts, not message counts that vanish with the session.

`summarize_session` already anticipates this: its docstring says *"Post-1.2 a BigQuery-backed implementation will replace `summarize_session` while preserving the `SessionSummary` Pydantic shape so the reports route doesn't change."* This doc is 1.2.

**Current state:**

- OTel is wired and exporting to Cloud Trace + Cloud Logging + BigQuery inside the GCP project (Axiom #8, ADR-008). Full prompt/response capture is on by default. But traces are latency/span-shaped, not a research-grade row-per-turn table keyed by group.
- `make_session_tracker` (after-agent callback) already runs per turn and writes the `ChatSessionIndex` Firestore row — the natural hook for emitting a structured chat-turn record.
- `google_bigquery_dataset.chat_logs` is a **1.1 concern** (the dataset exists in dev; the *sink* lands here) — see [aipla-cloud-bootstrap.md §F](aipla-cloud-bootstrap.md).

**Impact of not shipping:** teacher monitoring during the pilot stays at "34 messages, 8 sim runs," the rubric layer cannot start, and pilot chat data is not durably retained for the research programme — a data-loss risk that compounds every pilot week it is missing.

## Goals

**Primary goal:** Every student↔tutor turn and every workbench event is durably written, keyed only by anonymous group ID, to a partitioned BigQuery dataset inside the GCP project — queryable by researchers via a saved query + thin Looker board, readable by the teacher report route, and ready as the input surface for the 2.5 analytics rubric. The write path is off the chat hot path and degrades to today's behaviour if the sink is unavailable.

**Success metrics:**

- A turn sent in any channel appears as a row in `chat_logs.chat_turns` within ~60s (Cloud Logging → sink ingestion lag), keyed by `group_id`, `session_id`, `skill_id`, `turn_index`, `role`, with `content`, `model`, `token_in`, `token_out`, `latency_ms`, `ts`.
- A workbench interaction (slider settle / commit) appears as a row in `chat_logs.workbench_events` with `{server, tool, field, value}` — replacing the `mcp_app_context.*`-key heuristic.
- `summarize_session` has a BigQuery-backed implementation behind the **same `SessionSummary` shape** — the `/api/reports/groups/{code}` route is unchanged; `sim_run_count` becomes an exact count of `workbench_events` rows.
- Report route reads BQ for ended sessions; falls back to live ADK session state when the BQ row is absent (in-flight session, or sink lag) — no user-facing failure either way.
- Zero PII beyond group ID in either table (verified by a schema-level check + an optional content-scrub pass; see Open Questions).
- Researcher access is a saved BQ query + a read-only Looker board scoped to the `chat_logs` dataset — **no custom UI** (per ADR-005).
- Backend tests: ≥6 pytest cases (emitter shape, no-PII assertion, BQ-backed summarize round-trip, fallback-to-session-state, workbench-event count, retention/partition config).

**Non-goals:**

- The pedagogical rubric itself (ICAP/CPS/DRA/FCI labelling) — that is [2.5](../post-pilot/session-analytics-rubric.md), which *reads* these tables.
- Live (sub-second) in-session monitoring. In-flight continuity stays on ADK session state ([1.F session-persistence](session-persistence.md)); BQ is the durable/queryable/cohort store with sub-minute lag.
- A custom researcher dashboard. Saved query + Looker board only.
- Per-student rows. ADR-001 is per-group anonymous; the grain is `group_id`, never a student identity.
- Backfill of pre-1.2 sessions. The table starts accumulating from deploy; historical demo sessions are not reconstructed.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Writes go through Cloud Logging (fire-and-forget, off the request hot path) — deliberately architected so the sink never adds synchronous latency to a chat turn. Neutral, not negative |
| 2 | EARNED TRUST | +1 | The whole point is provenance: every reported metric and every rubric label traces back to a durably stored, logged turn with model + token attribution. Reports stop being ephemeral reconstructions |
| 3 | SKILLS, NOT FEATURES | 0 | Infrastructure; invisible to end users |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No routing decision here. (It *captures* per-turn model + token counts, which feeds the 1.5 capability-floor eval's routing decisions — but this doc doesn't route) |
| 5 | GRACEFUL DEGRADATION | +1 | Logging-sink decoupling means a BQ ingestion failure cannot break chat. The report route falls back to live session state when a BQ row is absent. Explicit fallback for every failure mode |
| 6 | PROTOCOL OVER CUSTOM | +1 | OpenTelemetry (GenAI semantic conventions for attribute names) + Cloud Logging structured logging + Log Router sink + BigQuery — all open/GCP-native primitives. No custom transport, no bespoke exporter |
| 7 | API FIRST | +1 | The emitter lives in the shared backend callback, so every channel logs identically. Consumption is API (`/api/reports/...`) + CLI (`aiplatform logs ...`) over the same tables; no channel-specific logging logic |
| 8 | OBSERVABLE BY DEFAULT | +1 | This *is* the axiom — structured per-turn capture, token accounting, full content to an internal sink. Extends existing OTel coverage into a research-grade, queryable shape |
| 9 | SECURE BY CONSTRUCTION | +1 | Data never leaves the GCP project edge (BQ in-project, no third-party egress). Group-ID-only keying enforces ADR-001 anonymity architecturally; dataset access is IAM-scoped deny-by-default |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | All capture + query is server-side; the frontend/report renders pre-computed rows. Zero client-side logic |
| 11 | USABLE BY DESIGN | 0 | No student-facing surface. The teacher-facing surface this feeds (report screen, 2.5 panels) carries its own UX design pass |
| | **Net Score** | **+7** | Threshold >= +4 — strong alignment |

**Conflict Justifications:** None. No axiom scores -1. Hard-fail checks pass: EARNED TRUST is +1 (feature involves user-facing data); SECURE BY CONSTRUCTION is +1 (feature introduces a new data-access pattern and keeps it in-project); USABLE BY DESIGN is 0 (no student surface).

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Per-turn telemetry attributes | **OpenTelemetry GenAI semantic conventions** (`gen_ai.*`) | Attribute names (`gen_ai.system`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, prompt/completion content) align to the OTel GenAI semconv where they exist; AIPLA-specific fields (`group_id`, `skill_id`, `turn_index`) extend via additional structured-payload keys, not a competing schema |
| Transport to BigQuery | **Cloud Logging structured logging → Log Router sink** | The agent callback emits a `jsonPayload` log entry under a dedicated log name; a Terraform-managed `google_logging_project_sink` routes it to the `chat_logs` dataset. GCP-native; no custom exporter to maintain |
| Durable store | **BigQuery** (day-partitioned tables) | `chat_logs.chat_turns`, `chat_logs.workbench_events`. Partition + table expiration express retention |
| Researcher access | **Saved BQ query + read-only Looker board** | Per ADR-005 — not a custom UI |
| Anonymity | **ADR-001 group-ID model** | `group_id` is the only identity column; schema has no name/email/uid-of-student field |

**No custom format introduced** where a standard exists. The one judgement call — emitting via Cloud Logging rather than a direct OTel→BQ span exporter — is documented under Design (alternatives considered) and chosen *because* it is the lower-liability, GCP-native path.

## CLI Surface

| Command | Purpose | Notes |
|---|---|---|
| `aiplatform logs tail <group_code>` | Stream the most recent N chat turns for a group from BQ (ops/debug, AR's testing loop) | New `aiplatform logs` group; `--limit`, `--since` flags |
| `aiplatform logs query --skill <id> --since <date>` | Run the canonical parameterised cohort query (turns + workbench events for a skill in a window) and print/CSV the result | Wraps the same saved query researchers use; `--format json\|csv` |
| `aiplatform logs schema` | Print the `chat_logs` dataset location, table schemas, partition + expiration settings | Doubles as a smoke check that the sink + tables exist in the target env |

Estimate: **~0.2 day** (Click subcommands + BQ client calls + tests). Backlink: [local-dev-cli.md](../../../v6.1.0/local-dev-cli.md).

## Design

### Architecture

```
ADK agent loop ──(after-agent callback: make_session_tracker)
   │
   ├─ emit structured log entry  logName="aipla.chat_turn"
   │     jsonPayload = { group_id, session_id, skill_id, turn_index,
   │                     role, content, model, token_in, token_out,
   │                     latency_ms, teacher_focus, ts }
   │
   └─ emit structured log entry  logName="aipla.workbench_event"  (on artefact state writes)
         jsonPayload = { group_id, session_id, skill_id, server, tool, field, value, ts }
   │
   ▼  (fire-and-forget — Cloud Logging client, off the chat hot path)
Cloud Logging
   │
   ▼  google_logging_project_sink  (filter: logName=~"aipla\.(chat_turn|workbench_event)")
   │   [Terraform — lands with 1.1 alongside the dataset]
   ▼
BigQuery dataset `chat_logs`
   ├─ table chat_turns       (PARTITION BY DATE(ts))
   └─ table workbench_events (PARTITION BY DATE(ts))
   │
   ├──► /api/reports/groups/{code}   (summarize_session, BQ-backed)
   ├──► 2.5 analytics rubric          (reads turns + events, post-hoc)
   └──► researcher saved query + read-only Looker board   (ADR-005)
```

### Where the emitter lives

`make_session_tracker` in [`backend/adk/callbacks.py`](../../../../backend/adk/callbacks.py) already fires after every agent turn and writes the `ChatSessionIndex` row — the established per-turn hook. The chat-turn emit goes here; the workbench-event emit goes in the existing artefact-state-write path that today writes `mcp_app_context.*`. A small new module `backend/observability/chat_log.py` holds the structured-log emit helpers (one for turns, one for workbench events), keeping the callback thin.

The emit is fire-and-forget against the Cloud Logging client: a logging failure logs a warning and returns — it never raises into the chat path (Axiom #1, #5).

### BigQuery schema — `chat_logs.chat_turns`

| Column | Type | Notes |
|---|---|---|
| `group_id` | STRING | Anonymous group code (`bold-kazoo-87`). The only identity column |
| `session_id` | STRING | ADK session id |
| `skill_id` | STRING | `boldkast` / `led-planck` / `kinebot` / … — narrows the rubric taxonomy |
| `turn_index` | INT64 | Monotonic per session |
| `role` | STRING | `student` \| `tutor` |
| `content` | STRING | Turn text (full capture — in-project per Axiom #8/#9) |
| `model` | STRING | Model id that produced a tutor turn; null for student turns |
| `token_in` | INT64 | Input tokens (tutor turns) |
| `token_out` | INT64 | Output tokens (tutor turns) |
| `latency_ms` | INT64 | Turn latency (tutor turns) — feeds TTFT monitoring |
| `teacher_focus` | STRING | The active `ActivityConfig.teaching_goal` for the session (teacher-authored, not student PII) |
| `ts` | TIMESTAMP | Turn time. **Partition key** |

`chat_logs.workbench_events`: `group_id`, `session_id`, `skill_id`, `server`, `tool`, `field`, `value` (STRING), `ts` (TIMESTAMP, partition key).

### BQ-backed `summarize_session`

A new `summarize_session_bq(session_id)` queries the two tables and assembles the **identical `SessionSummary` Pydantic model**:

- `conversation` ← `chat_turns` ordered by `turn_index`
- `message_count` ← row count
- `sim_run_count` ← `COUNT(*)` from `workbench_events` (exact — replaces the heuristic)
- `duration_seconds` ← `MAX(ts) − MIN(ts)`

The reports route ([backend/protocols/reports_routes.py](../../../../backend/protocols/reports_routes.py)) calls `summarize_session_bq` first; on empty result (in-flight session or sink lag) it falls back to the existing `summarize_session` reading live session state. The route response shape does not change.

### Alternatives considered

| Option | Why not |
|---|---|
| Custom OTel **span exporter** writing to BQ | More code + ops to own; full prompt/response in span attributes is heavy and trace-shaped, not a clean row-per-turn research table |
| **Direct BQ Storage Write** from the callback | Couples chat latency + reliability to BQ availability — violates Axiom #1 and #5. The whole point is decoupling |
| Reuse the existing **trace → BQ** export | Traces are latency/span-shaped; reconstructing a row-per-turn research table from them is fragile and re-derives what a dedicated structured log gives cleanly |

### Files to create / modify

| File | Change | LOC est |
|---|---|---|
| `backend/observability/chat_log.py` (new) | `emit_chat_turn(...)`, `emit_workbench_event(...)` structured-log helpers; OTel GenAI attribute mapping; never-raise contract | ~120 |
| `backend/adk/callbacks.py` | Call `emit_chat_turn` in `make_session_tracker`; `emit_workbench_event` in the artefact-state-write path | +40 |
| `backend/reports/session_summary.py` | Add `summarize_session_bq`; keep the session-state reader as the fallback | +110 |
| `backend/protocols/reports_routes.py` | Prefer BQ, fall back to session-state | +25 |
| `backend/db/bigquery.py` (new or extend) | Thin BQ query client (parameterised, region-pinned per ADR-007) | ~80 |
| **dev:** [`scripts/bootstrap-aipla-dev.sh`](../../../../scripts/bootstrap-aipla-dev.sh) `ensure_chat_logs()` (gcloud/bq) — **authored 2026-05-29**. **test/prod:** [`infrastructure/modules/chat-logs/`](../../../../infrastructure/modules/chat-logs/) terraform module. Both create: dataset + partitioned log sink + writer/reader IAM (no terraform is set up yet — dev is gcloud) | done (infra) |
| `cli/aiplatform/commands/logs.py` (new) | `tail`, `query`, `schema` subcommands | +110 |
| `backend/tests/api_tests/test_chat_log_pipeline.py` (new) | ≥6 cases (see Testing) | ~220 |
| `cli/tests/test_cli_logs.py` (new) | CLI command tests | ~60 |

## API Changes

**No new HTTP endpoints.** `/api/reports/groups/{code}` keeps its shape — only its data source changes (BQ-first, session-state fallback). The new surface area is the CLI `aiplatform logs` group and the BQ tables themselves (consumed by 2.5 and researchers).

## Migration

- **No backfill.** Tables accumulate from deploy. Pre-1.2 sessions remain readable via the session-state fallback until their ADK sessions expire.
- **Infra provisioning:** **dev = gcloud** via `ensure_chat_logs()` in [`bootstrap-aipla-dev.sh`](../../../../scripts/bootstrap-aipla-dev.sh) (no terraform is set up yet — dev is provisioned the same way as every other resource). **test/prod = terraform** via the [`chat-logs` module](../../../../infrastructure/modules/chat-logs/), consolidated rather than split across 1.1/1.2. Both keep the same dataset id, sink name, filter, partitioned-tables, and writer grant. **Verified 2026-05-29: neither the dataset nor the sink exists in `aipla-dev-2026` yet** (BQ + Logging APIs *are* enabled), so the first run creates fresh — nothing to import.
- **Two-phase apply:** first apply with `create_views = false` (the sink's raw tables only exist after the first log write); once the emitter is deployed and data flows, re-apply with `create_views = true` for the flat `chat_turns` / `workbench_events` views.
- **Rollback:** delete the log sink (writes stop; chat unaffected) and revert the reports route to session-state-only. Tables can be left in place (retention rules handle them) or dropped.
- **Retention:** partition expiration on both tables, default driven by the consent form (see Open Questions). Set as a Terraform variable so test/prod can differ from dev.

## Testing Strategy

**Backend (pytest):**

- `emit_chat_turn` produces the expected `jsonPayload` shape with OTel-aligned attribute names; never raises when the logging client errors (mock raises → helper returns, warning logged).
- **No-PII assertion:** the emitted payload contains no key carrying a student name/email/uid; only `group_id`.
- `summarize_session_bq` round-trips: seed `chat_turns` + `workbench_events` (mocked BQ client) → assert `SessionSummary` matches, `sim_run_count` is the exact event count.
- Reports route fallback: empty BQ result → falls back to live session-state summarizer → same response shape.
- Workbench-event count replaces the `mcp_app_context.*` heuristic (parity test against a known session).
- Retention/partition config asserted in the Terraform plan test (or a schema smoke check via `aiplatform logs schema`).

**CLI (pytest):**

- `aiplatform logs tail/query/schema` against a mocked BQ client return expected rows / schema.

**Manual:**

- Run a real session against deployed dev, then `aiplatform logs tail <code>` → see the turns within ~60s; open the teacher report → identical content, exact sim-run count.

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | Structured-log emitters (turn + workbench event), never-raise | `backend/observability/chat_log.py` | 0.3 d |
| 2 | Wire emitters into the after-agent callback + artefact-state path | `backend/adk/callbacks.py` | 0.15 d |
| 3 | Log Router sink + BQ table schemas (Terraform, with 1.1) | `infrastructure/modules/...` | 0.3 d |
| 4 | BQ query client + `summarize_session_bq` + route fallback | `backend/db/bigquery.py`, `session_summary.py`, `reports_routes.py` | 0.35 d |
| 5 | CLI `logs tail/query/schema` + tests | `cli/aiplatform/commands/logs.py` | 0.2 d |
| 6 | Backend tests (≥6 cases) | `test_chat_log_pipeline.py` | 0.2 d |
| 7 | Manual end-to-end against deployed dev | — | 0.1 d |
| | **Total** | | **~1.6 d** |

## Success Criteria

- [ ] A chat turn lands as a `chat_turns` row keyed by `group_id` within ~60s of being sent.
- [ ] A workbench interaction lands as a `workbench_events` row.
- [ ] `summarize_session_bq` returns the same `SessionSummary` shape; `sim_run_count` is exact.
- [ ] Reports route reads BQ for ended sessions, falls back to session state in-flight — no failures.
- [ ] No PII column exists; only `group_id` identifies the source.
- [ ] Data stays inside the GCP project (no third-party egress).
- [ ] `aiplatform logs tail/query/schema` work against deployed dev.
- [ ] Retention (partition expiration) is a Terraform variable, set per env.
- [ ] Backend `make lint` + `make test-fast` green.

## Out of Scope (deferred)

- The 2.5 analytics rubric (ICAP/CPS engagement + DRA/FCI concept tracking) — separate doc, reads these tables.
- A custom researcher dashboard (saved query + Looker board only, per ADR-005).
- Per-student grain (ADR-001 — per-group only).
- A content-scrub/redaction pass beyond the schema-level no-PII guarantee — tracked as an Open Question pending JB/DPIA input.

## Open Questions

1. **Free-text PII scrub.** Group IDs carry no PII, and `teacher_focus` is teacher-authored — but a student *could* type their name into a turn. Do we run a light regex scrub (email/phone) before write, a heavier pass, or rely on the consent form + retention window? Decision sits with JB (consent) + the DPIA scaffold (1.13). Default for this sprint: schema-level no-PII guarantee, scrub as a fast-follow if JB requires it.
2. **Retention window.** What partition-expiration default does the consent form imply for dev vs test/prod? Set as a Terraform variable so the answer is one-line-changeable.
3. **Sink lag tolerance for live monitoring.** Sub-minute ingestion lag is fine for between-session monitoring and the rubric. If a teacher wants truly live in-session view, that stays on the session-state path — confirm no pilot requirement forces sub-second BQ freshness.

## Related Documents

- [SEQUENCE.md](SEQUENCE.md) row 1.2 (this is its design doc); parent [../SEQUENCE.md](../SEQUENCE.md)
- [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) (1.1) — creates the `chat_logs` dataset + sink IAM this builds on
- [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) (2.5) — the analysis layer that reads these tables; gated on this doc
- [dra-activity-framework.md](dra-activity-framework.md) (1.K) — DRA maps are the machine-readable input the rubric's DRA lens consumes
- [teacher-ui.md](teacher-ui.md) (1.G) — the report surface whose data source this becomes
- [session-persistence.md](session-persistence.md) (1.F) — live session state stays the in-flight source; BQ is the durable store
- [`backend/reports/session_summary.py`](../../../../backend/reports/session_summary.py) — the aggregator that gains a BQ-backed implementation
- ADR-001 (group anonymity), ADR-005 (chat log storage), ADR-008 (observability) — in the scoping site
- Product axioms #8 (OBSERVABLE BY DEFAULT) + #9 (SECURE BY CONSTRUCTION) — the internal/external privacy boundary this pipeline lives inside

---

## Implementation Report

**Completed**: 2026-05-30
**Actual Effort**: ~1.3d as planned for M1–M4 + ~0.5d for the verification follow-up (group-code fix, `?source=bq`, `aiplatform logs verify`, `make verify-chat-logs`) + ~0.2d for the turn-capture fix. Total ~2d incl. live verification.
**Commit range**: `2db9ea6` (M1 emitters) → `4b1ed9b` (M2 wire emit sites) → `05cde20` (M3 BQ read path) → `b798f6c` (M4 CLI logs) → `0eefcc0` (group-code fix + `?source=bq` + `verify` command) → `47345c1` (verify defaults) → `5e3f562` (cursor → invocation_id) on `dev`.

### What Was Built
- M1–M3 shipped as designed (emitters, wire-up, BQ read path with `summarize_session_bq` + session-state fallback).
- **M4 deviation** (documented at commit time): dropped the CLI-executed `logs query --skill --since` in favour of `logs schema` *printing* the canonical cohort BQ query for copy-paste. Per ADR-005 researchers query BigQuery directly (saved query + Looker, not a custom UI); a CLI query executor would have needed an arbitrary-query backend endpoint (security surface) or a BQ client in the CLI. Added `logs session` as a bonus. `make verify-chat-logs` came later as the one-command e2e smoke.
- **Verification follow-up** (separate doc, also in `implemented/`): group-code fix + `?source=bq` mode + `aiplatform logs verify` were specced and shipped after live verification surfaced a real bug.
- **Turn-capture reliability fix** (`5e3f562`): replaced `_STATE_CHATLOG_CURSOR` with an `invocation_id` filter. ADK's `EventsCompactionConfig` was silently invalidating the forward cursor.

### Files Changed
- New: `backend/observability/chat_log.py`, `backend/db/bigquery.py`, `backend/tests/unit/test_chat_log_emit.py`, `backend/tests/api_tests/test_chat_log_pipeline.py`, `cli/aiplatform/commands/logs.py`, `cli/tests/test_cli_logs.py`, `infrastructure/modules/chat-logs/` (terraform), `scripts/bootstrap-aipla-dev.sh` ensure_chat_logs.
- Modified: `backend/adk/callbacks.py` (emit + invocation_id fix), `backend/adk/agent.py` (wire `user.group_id`), `backend/protocols/{iframe_context,reports}_routes.py`, `backend/reports/session_summary.py` (BQ-backed summary + `?source=bq` + hyphen-cleaning fix to `find_latest_session_for_group`), `backend/pyproject.toml`/`uv.lock` (add `google-cloud-bigquery`), `cli/aiplatform/{cli,http}.py` (register `logs` + AIPLA dev URL), root `Makefile` (`verify-chat-logs`), `CLAUDE.md` (Automation table).

### Lessons Learned
- **Easy verification is a correctness tool, not just a smoke.** Building `aiplatform logs verify` + `make verify-chat-logs` (one command, no creds) directly surfaced two real defects (the `_synthesize_uid` hyphen-strip mismatch and the cursor-vs-compaction bug). Neither was caught by the unit tests because the failures depended on production-only behaviour (real uid format, real event compaction). Pattern for future pipelines: ship the e2e command alongside the feature, run it before claiming done.
- **Forward index cursors are fragile against event-store compaction.** ADK's `EventsCompactionConfig` summarises old events into a compacted event — any code that indexes into `session.events` by position (or stores a forward "where I left off" cursor) silently breaks once compaction runs. Use stable identifiers (here `invocation_id`) instead.
- **The session-state fallback honestly returns the cleaned group code** (`boldkazoo87` not `bold-kazoo-87`), because the synthetic uid is lossy and no real code is stored on the index row. Only the BigQuery path (which stores `user.group_id` from the JWT claim) round-trips the display code. Documented in the route's docstring + the two `_group_code_from_owner_uid` tests that now assert the cleaned form.
- **Sink lag is a real characteristic of Cloud Logging → BigQuery sinks** (~2–4 min observed). Verify polls up to 240s by default; bump to 300s+ when needed. For lower-latency smokes, assert the Cloud Logging entry (near-instant) and treat BQ as a slower confirmation — possible future refinement.
- **`User.group_id` is the source of truth for the anonymous display code**, not the uid. Any pipeline that needs the real group code at the emit/read site should thread it from the JWT claim, never derive from `owner_uid`.
