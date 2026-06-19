# Cost dashboard — voice (STT/TTS) cost integration

**Status:** SHIPPED 2026-06-19 — follow-up to [cost-dashboard.md](cost-dashboard.md) (1.1.9)
**Last Updated:** 2026-06-19
**Estimated:** ~0.5d
**Scope:** Backend telemetry sink + BQ routing + query fold; frontend a single line

## Problem

The shipped cost dashboard (1.1.9) sums **only LLM token cost** from
`aipla_chat_turn`. It silently omits the cost of the **voice** features:

- **STT** (speech-to-text) — voice-in (`/api/voice/stt/transcribe`) **and**
  lesson-recording transcription (`recording_routes`), both billed per second
  of audio.
- **TTS** (read-aloud, `/api/voice/tts/synthesize`) — billed per character.

These are already *estimated* (`backend/voice/cost.py`: `stt_cost_usd` /
`tts_cost_usd`) and emitted as the OTel span attribute
`voice.cost_estimate_usd`. But:

- The `chat_logs` BQ dataset has only `aipla_chat_turn` + `aipla_workbench_event`
  — **no table for voice cost**. The span attribute lands in Cloud Trace only.
- `cost_queries.py` never reads it.

So `voice/cost.py`'s own claim — *"The 1.1.9 cost-dashboard reads from
BigQuery via the voice.cost_estimate_usd span attribute"* — was design intent
that the 1.1.9 implementation never wired in. This doc closes that gap.

**Why it matters:** lesson-recording transcription is long-form audio; at DK's
scaling cohort the STT spend can be material and is currently invisible to the
teachers/researchers the dashboard serves.

## Non-goals

- **Exact billing.** These stay *estimates* (per `voice/cost.py`); actual GCP
  invoices trump them. The dashboard is a directional "how much did voice cost
  us" signal, same standing as the token-based LLM estimate.
- **Per-student** attribution (ADR-001 anonymity) — cost bins to `group_id`.
- Reworking how `voice/cost.py` prices — its rates are the source of truth here.

## Design

### Telemetry: a new structured log → BQ table

Mirror `emit_chat_turn`. New `emit_voice_cost` in
[`observability/chat_log.py`](../../../../backend/observability/chat_log.py),
`LOG_ID_VOICE_COST = "aipla_voice_cost"`:

```python
emit_voice_cost(
    group_id: str,           # for class attribution (resolved via group_codes)
    kind: str,               # "stt" | "tts"
    provider: str,           # e.g. "gemini", "gcp_chirp3hd"
    units: int,              # duration_ms (stt) or chars (tts) — provenance
    cost_usd: float,         # from voice/cost.py
    skill_id: str | None,    # optional — by-activity breakdown
    session_id: str | None,  # optional
)
```

Never raises (telemetry must not break a turn), no-op in LOCAL_MODE — identical
contract to `emit_chat_turn`. Emitted only when `group_id` is present (anonymous
student group); teacher/LOCAL_MODE callers are skipped (ADR-001, like chat-turn
emission).

**Call sites:**
- `voice_routes.synthesize` (TTS) — after `tts_cost_usd(...)`.
- `voice_routes.transcribe` (STT voice-in) — after `stt_cost_usd(...)`.
- `recording_routes._transcribe_segment_in_background` (lesson STT) — pass
  `group_id` + `duration_ms` into the background task so it can emit.

### Routing: extend the sink filter

The Cloud Logging→BQ sink filter is a `logName` regex:
`logName=~"/logs/aipla_(chat_turn|workbench_event)$"`. A new `aipla_voice_cost`
log won't route until added. Update **all three** sources of truth so they stay
in sync (the gotcha from the chat-logs module README):
- `infrastructure/modules/chat-logs/variables.tf` (`log_filter` default)
- `scripts/bootstrap-aipla-dev.sh` (the gcloud-provisioned dev sink)
- the **live dev sink** via `gcloud logging sinks update` (so it takes effect
  before the next bootstrap run)

New regex: `logName=~"/logs/aipla_(chat_turn|workbench_event|voice_cost)$"`.
The BQ sink auto-creates the `aipla_voice_cost` table on first matching entry
(`use_partitioned_tables`).

### Query: fold voice cost into the breakdown (USD→EUR)

`voice/cost.py` is USD; the rate card is EUR. Add `USD_TO_EUR` (approximate,
documented) to `rate_card.py` and convert. New `voice_spend(group_codes, since,
until)` in `cost_queries.py`:

```sql
SELECT jsonPayload.kind AS kind, jsonPayload.group_id AS group_id,
       SUM(CAST(jsonPayload.cost_usd AS FLOAT64)) AS cost_usd
FROM `…aipla_voice_cost`
WHERE jsonPayload.group_id IN UNNEST(@group_codes)
  AND timestamp BETWEEN @since AND @until
GROUP BY kind, group_id
```

**Schema-tolerant + degrading** exactly like `spend_rows`: the
`aipla_voice_cost` table (and its `jsonPayload.*` columns) won't exist until the
first row lands, so probe via `jsonpayload_columns` and wrap in
`_safe_*` → on any BQ error (incl. table-not-found) return empty, never 500.

`class_spend` / `cohort_spend` / `classes_spend` gain:
- `voice_eur` (total voice cost, EUR)
- `by_voice_kind`: `[{kind: "stt"|"tts", eur}]`
- `total_eur` now = LLM token cost **+** `voice_eur` (one combined figure)

### UI: one line

- `BudgetPanel` (class detail): a **Voice (STT/TTS)** sub-line under the total,
  e.g. `Voice: €0.12 (STT €0.10 · TTS €0.02)`. Absent/zero → omitted.
- Researcher cost page: a "By voice" mini-table alongside by-cohort/by-model.

## Acceptance

- [ ] `emit_voice_cost` lands `aipla_voice_cost` rows for TTS, voice-in STT, and lesson-recording STT (group-attributed; LOCAL_MODE/teacher skipped)
- [ ] Sink filter routes `aipla_voice_cost` → BQ (terraform + bootstrap + live dev sink updated)
- [ ] `class_spend.total_eur` includes voice cost; `voice_eur` + `by_voice_kind` present
- [ ] Voice query is schema-tolerant: missing table/columns → €0, never 500
- [ ] USD→EUR conversion applied + documented
- [ ] BudgetPanel + researcher page show the voice line (omitted when zero)
- [ ] `voice/cost.py` stale docstring corrected to describe the real path
- [ ] `make security-check` n/a; `make lint` + `make test-fast` + `npm run quality:check` green

## Files

| File | Change |
|---|---|
| `backend/observability/chat_log.py` | `emit_voice_cost` + `LOG_ID_VOICE_COST` |
| `backend/protocols/voice_routes.py` | emit on TTS + STT cost sites |
| `backend/protocols/recording_routes.py` | thread group_id+duration into bg task; emit |
| `backend/voice/cost.py` | fix stale docstring |
| `backend/analytics/rate_card.py` | `USD_TO_EUR` constant |
| `backend/analytics/cost_queries.py` | `voice_spend` + fold into class/cohort/classes spend |
| `infrastructure/modules/chat-logs/variables.tf` | `log_filter` default |
| `scripts/bootstrap-aipla-dev.sh` | sink filter |
| `frontend/src/lib/costApi.ts` | `voice_eur` / `by_voice_kind` types |
| `frontend/src/components/teacher/BudgetPanel.tsx` | voice line |
| `frontend/src/app/teacher/insights/cost/page.tsx` | by-voice table |
| tests (backend + frontend) | per layer |

## Out of scope / deferred

- Embedding + Vertex RAG retrieval cost (curriculum grounding) — separate source, not voice; future follow-up.
- Historical backfill — voice cost accrues from the first emitted row onward (same as the model-logging fix).
