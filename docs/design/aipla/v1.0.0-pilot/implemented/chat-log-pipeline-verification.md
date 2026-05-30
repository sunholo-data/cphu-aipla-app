# chat-log-pipeline-verification — one-command e2e verify + group-code fix

**Status**: Implemented (follow-up to [chat-log-pipeline.md](chat-log-pipeline.md) / SEQUENCE 1.2)
**Priority**: P1 (1.2 is code-complete but not e2e-verified; this makes verification a single command AND fixes a correctness bug that verification surfaced)
**Estimated**: ~0.5d
**Scope**: CLI (`aiplatform logs verify`), backend (group-code consistency fix in the emit + report lookup), tests
**Dependencies**: 1.2 M1–M4 (shipped, commits 2db9ea6 / 4b1ed9b / 05cde20 / b798f6c)
**Created**: 2026-05-29
**Last Updated**: 2026-05-30

## Problem statement

Verifying the chat-log pipeline end-to-end on deployed dev currently needs a
hand-run sequence of curls:

```
POST /api/proxy/api/auth/group/join          {group_id}        → group JWT
POST /api/proxy/api/skill/{skill}/stream      {message,sessionId} → drives a turn (SSE)
# wait ~60s for the Log Router sink to ingest
bq query ... aipla_chat_turn WHERE session_id=...              → confirm the row
GET  /api/proxy/api/reports/groups/{code}                       → confirm the report
```

The `aiplatform` CLI covers the **read** side (`logs tail` / `logs session`
/ `logs schema`, `sessions inspect`) but **not the write side** — there's no
command to join as a student and drive a turn. So there is no one-command
smoke for "did a real turn land in BigQuery and come back through the report".
This violates the [automation principle](../../../../CLAUDE.md) (any
multi-step manual workflow must have a script / command) and made the 1.2 e2e
a manual ritual.

**Verifying surfaced a real bug** (below). That is the point: without an easy,
repeatable verify, the group-code mismatch would have shipped silently — teacher
analytics would have been keyed by the wrong group code for every hyphenated
group.

## The bug verification found — group-code format mismatch

`_synthesize_uid` ([group_id_auth.py:335](../../../../backend/auth/group_id_auth.py#L335))
**strips hyphens** from the group code when building the synthetic uid:

```python
cleaned = group_id.replace("-", "")
return f"anon-{cleaned}-{suffix}"     # "aipla-demo-1" → "anon-aiplademo1-<hex>"
```

Consequences:

1. **Emit keys by the cleaned form.** 1.2's `group_code_from_owner_uid`
   ([chat_log.py](../../../../backend/observability/chat_log.py)) reverses the
   uid → returns `aiplademo1`, not the display code `aipla-demo-1`. So BQ rows
   are keyed by `aiplademo1`.
2. **Report-by-group can't find it (pre-existing).**
   `find_latest_session_for_group(group_code)`
   ([session_summary.py](../../../../backend/reports/session_summary.py))
   builds the prefix `anon-{group_code}-` from the **raw** code →
   `anon-aipla-demo-1-` → never matches the stored `anon-aiplademo1-<hex>`.
   This bug predates 1.2 (it's in the Phase-2 report path) but 1.2's emit
   inherits the same inconsistency.

Net: the pipeline *works* (data lands in BQ) but is keyed by a cleaned code
that doesn't round-trip to what teachers see, and `logs tail aipla-demo-1`
returns "no sessions" even when data exists under `aiplademo1`.

### Fix

The real group code **is** available at the emit site — `User.group_id`
([firebase_auth.py:71](../../../../backend/auth/firebase_auth.py#L71)) is set
for anonymous-group auth and carries the display code (`aipla-demo-1`).

- **(A) Emit the real code.** Thread `user.group_id` into
  `make_after_agent_response` and the iframe-context route; store *that* as the
  BQ `group_id`. Keep `group_code_from_owner_uid` only for the non-anon skip
  check (teacher sessions have empty `group_id` → skip). Result: BQ rows are
  keyed by `aipla-demo-1` (display-faithful, what teacher analytics needs).
- **(B) Fix the lookup.** `find_latest_session_for_group` must clean the code
  the same way `_synthesize_uid` does — `group_code.replace("-", "")` — when
  building the `ownerUid` prefix, so report-by-group matches for hyphenated
  codes. (Pre-existing bug; fix alongside since this doc's verify depends on it.)
- **(C) Tests** for both: a hyphenated code round-trips emit→BQ-key and
  join→report.

## Goals

**Primary goal:** `aiplatform logs verify <group_code>` drives a real turn on
the target env and confirms it came back through the report API — a single
command, green/red exit. Plus: BQ rows are keyed by the display group code.

**Success metrics:**
- `aiplatform logs verify aipla-demo-1 --env dev` → joins, sends a turn, polls
  the report, prints PASS with the turn content + exact sim-run count, exit 0.
- A hyphenated group code round-trips: emit stores `aipla-demo-1` (not
  `aiplademo1`); `logs tail aipla-demo-1` returns the session.
- `make verify-chat-logs ENV=dev GROUP=aipla-demo-1` wraps the command.
- Backend tests: hyphenated-code emit key + `find_latest_session_for_group`
  match; CLI test for `verify` against a mocked backend.

**Non-goals:**
- Driving the turn through the real frontend (CopilotKit) — the simple
  `{message, sessionId}` wire format is enough for a backend smoke.
- Changing `_synthesize_uid` (don't churn the auth/uid format — fix the
  consumers to match it instead; lower blast radius).
- Researcher cohort queries (ADR-005 — BQ direct; `logs schema` prints the SQL).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Dev tooling; not on a user path |
| 2 | EARNED TRUST | +1 | A green/red e2e smoke + correct group keying make the analytics data trustworthy (right code, verified flow) |
| 3 | SKILLS, NOT FEATURES | 0 | Infra/dev tooling |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model decision |
| 5 | GRACEFUL DEGRADATION | +1 | `verify` polls with a cap + clear timeout message; never hangs |
| 6 | PROTOCOL OVER CUSTOM | 0 | Uses existing endpoints (group join, skill stream, reports) |
| 7 | API FIRST | +1 | `verify` is a thin client over existing API endpoints; no business logic in the CLI |
| 8 | OBSERVABLE BY DEFAULT | +1 | The whole point — makes the observability pipeline checkable in one command |
| 9 | SECURE BY CONSTRUCTION | +1 | Fix keys research data by the anonymous display code only; no new data path, no PII |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | `verify` orchestrates existing endpoints; all logic server-side |
| 11 | USABLE BY DESIGN | 0 | No student surface (dev/teacher tooling) |
| | **Net Score** | **+6** | Threshold >= +4 OK |

**Conflict Justifications:** None.

## Design

### CLI: `aiplatform logs verify`

```
aiplatform logs verify <group_code> [--skill problem-set-hints]
    [--message "..."] [--timeout 90] [--env dev]
```

1. `POST /api/auth/group/join {group_id}` → group JWT (+ the bound `skill_ids`).
2. `POST /api/skill/{skill}/stream {message, sessionId=verify-<ts>}` with the
   group JWT; drain the SSE to completion (the turn must finish so the
   after-agent emit fires).
3. Poll `GET /api/reports/groups/{group_code}` every ~5s up to `--timeout`
   until `messageCount > 0` for a session at/after `sessionId` (accounts for
   sink ingestion lag).
4. Print PASS (group, activity, messages, sim_runs, last turn) + exit 0, or
   FAIL with what was/wasn't seen + exit 1.

Reuses only existing endpoints (API-first); no BQ client in the CLI. The
report read works once fix (B) lands.

### Backend group-code fix

| File | Change |
|---|---|
| `backend/adk/callbacks.py` | `make_after_agent_response(owner_uid, skill_id, group_id=None)`; prefer `group_id` (real code) for the emit; fall back to `group_code_from_owner_uid(owner_uid)` |
| `backend/adk/agent.py` | pass `user.group_id` into `make_after_agent_response` |
| `backend/protocols/iframe_context_routes.py` | use `request.state` user `group_id` (or look up) for the emit instead of deriving from `idx.owner_uid` |
| `backend/reports/session_summary.py` | `find_latest_session_for_group`: build the prefix from `group_code.replace("-", "")` to match `_synthesize_uid` |
| tests | hyphenated-code round-trip (emit key + lookup match) |

## Implementation Plan

| Step | What | Est |
|---|---|---|
| 1 | Group-code fix (A)+(B) in callbacks/agent/iframe/session_summary + tests | 0.2d |
| 2 | `aiplatform logs verify` command + CLI test | 0.2d |
| 3 | `make verify-chat-logs` target + run live against dev (the actual 1.2 M5 e2e) | 0.1d |

## Success Criteria

- [ ] Group-code fix: hyphenated code stored/looked-up consistently; tests green.
- [ ] `aiplatform logs verify aipla-demo-1 --env dev` exits 0 with the turn.
- [ ] `logs tail aipla-demo-1` returns the session (report-by-group fixed).
- [ ] `make verify-chat-logs` wraps it; documented in the Automation table.
- [ ] Backend `make lint` + `make test-fast` green.

## Verification results (2026-05-29, deployed dev)

**Pipeline PROVEN end-to-end.** A real turn on `aipla-demo-1` (session
`verify-1780079421`) flowed: agent turn → `emit_chat_turn` → Cloud Logging →
`aipla-chat-logs` sink → BigQuery `aipla_chat_turn` → `?source=bq` report
returned the correct summary — keyed by the **real code `aipla-demo-1`**
(group-code fix confirmed; pre-fix it would have been `aiplademo1`).
`summarize_session_bq`, `find_latest_session_for_group` cleaning, and the
`?source=bq` endpoint all verified against live data.

**Two findings from the live run:**

1. **Cloud Logging → BigQuery sink lag is multi-minute** (observed ~2–4 min to
   first queryability) — *open characteristic, not a bug*. The data always
   lands; it's latency. `verify`'s synchronous BQ poll uses a 240s default
   (may need 300s+). Faster-confirmation option (assert the Cloud Logging
   entry, which is near-instant, then treat BQ as a slower secondary check)
   remains a possible refinement.
2. **Turn-capture reliability gap — ROOT-CAUSED AND FIXED (`5e3f562`,
   2026-05-30).** On a fresh session the *first* agent invocation's content
   did not always emit. Root cause: ADK's `EventsCompactionConfig`
   (`compaction_interval=5` for Claude/GPT-5, 10 for Gemini) summarises old
   events into a compacted event, which shifts indices and silently
   invalidates a forward index cursor (`_STATE_CHATLOG_CURSOR`). Fix:
   replaced the cursor with an **`invocation_id` filter** — each agent run
   tags its events with a unique invocation id; the after-agent callback
   identifies that id (from `CallbackContext`, else `events[-1].invocation_id`)
   and emits only matching events. ADK fires after-agent exactly once per
   invocation, so each turn's events emit exactly once. Robust to compaction
   and any future event-store reshuffling.
   Verified live (fresh session `fix-1780126286`): turn 1 emitted index 0
   (student) + 2 (tutor); turn 2 emitted index 4 + 6 — all four expected
   emissions present, keyed by the real code `aipla-demo-1`. Pre-fix the
   same shape lost turn 1 entirely. `make verify-chat-logs GROUP=aipla-demo-1
   ENV=dev` is now a green one-command smoke.

## Related

- [chat-log-pipeline.md](chat-log-pipeline.md) (1.2) — the pipeline this verifies
- [chat-log-pipeline-sprint.md](chat-log-pipeline-sprint.md) — M5's e2e becomes `make verify-chat-logs`
- `aiplatform-cli` skill — add `logs verify` to its recipe set once shipped
- ADR-001 (anonymous group identity) — the group code is the only key

---

## Implementation Report

**Completed**: 2026-05-30
**Actual Effort**: ~0.5d for the group-code fix + `?source=bq` + `verify` command + `make` target (~as estimated); + ~0.2d to root-cause and fix the turn-capture gap (cursor → invocation_id).
**Commit range**: `0eefcc0` (group-code fix + verify) → `47345c1` (verify defaults: bound-skill, 240s timeout) → `5e3f562` (cursor → invocation_id) on `dev`.

### What Was Built (and verified live)
- **(A) Real-code emit** (`backend/adk/{callbacks,agent}.py`, `protocols/iframe_context_routes.py`): emit `user.group_id` from the JWT claim instead of deriving from the hyphen-stripped uid. BQ rows now keyed by the display code (`aipla-demo-1`).
- **(B) Lookup cleaning** (`backend/reports/session_summary.py`): `find_latest_session_for_group` strips hyphens before building the `ownerUid` prefix, matching `_synthesize_uid`.
- **(C) BQ-only report mode** (`backend/protocols/reports_routes.py`): `GET /api/reports/sessions/{id}?source=bq` returns 404 until the row is in BigQuery (no fallback) — used by `verify` to prove the data reached BQ rather than being masked by the session-state fallback.
- **(D) `aiplatform logs verify <group>`** (`cli/aiplatform/commands/logs.py`): join → drive a turn (defaults to the group's bound skill) → poll `?source=bq` (default 240s for sink lag). Needs no credentials — the group JWT carries the whole flow.
- **(E) `make verify-chat-logs GROUP=… ENV=…`** + Automation table entry in `CLAUDE.md`. Registered as the canonical e2e smoke for the chat-log pipeline.
- **Turn-capture fix** (root cause: ADK event compaction invalidating the forward cursor): replaced `_STATE_CHATLOG_CURSOR` with `invocation_id`-based emit in `_emit_new_turns`. Tests in `backend/tests/unit/test_chat_log_emit.py`.

### Live verification
- `make verify-chat-logs GROUP=aipla-demo-1 ENV=dev` returned **PASS** (session `verify-1780126342`, messages=2, groupCode `aipla-demo-1`, real conversation).
- Direct 2-turn smoke (session `fix-1780126286`) emitted both turn 1 (`turn_index` 0, 2) and turn 2 (4, 6) — all four expected emissions, keyed by `aipla-demo-1`.

### Files Changed
- New: `cli/aiplatform/commands/logs.py` (verify subcommand), Makefile target.
- Modified: `backend/adk/callbacks.py` (emit + invocation_id), `backend/adk/agent.py` (thread `user.group_id`), `backend/protocols/{iframe_context,reports}_routes.py`, `backend/reports/session_summary.py`, `cli/aiplatform/{cli,http}.py`, root `Makefile`, `CLAUDE.md`.

### Lessons Learned
- The act of building a one-command live verify (no creds, copy-pasteable from `make help`) was a forcing function for finding real bugs that unit tests missed. Both the uid hyphen-strip and the compaction-cursor interaction depended on production-only behaviour.
- ADK's `EventsCompactionConfig` is silent-but-load-bearing: any cursor/index into `session.events` must use stable identifiers (`invocation_id`, `event.id`), never positional offsets.
- The session-state fallback's group code is the cleaned form (`boldkazoo87`); only the BigQuery path round-trips the display code. Documented as a deliberate behaviour, not a bug.
- Cloud Logging → BigQuery sink lag is ~2–4 min for first ingestion. Acceptable for the e2e smoke (240s default, sometimes needs 300s); for sub-minute monitoring, the in-flight session-state path is the right source.
