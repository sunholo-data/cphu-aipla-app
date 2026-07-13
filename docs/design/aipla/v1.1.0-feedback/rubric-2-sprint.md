# Sprint RUBRIC-2 — rubric experimentation platform (the delta on RUBRIC-1)

**Design doc:** [competency-rubrics.md](competency-rubrics.md) (1.1.57, 2026-07-13 reframe)
**Sprint ID:** `RUBRIC-2` · **Created:** 2026-07-13 · **Estimated:** ~4.5d (~1,600 LOC incl. tests)
**Baseline:** RUBRIC-1 (2026-07-11) shipped the fixed-lens core — registry (MAPS+SAAR), evidence
partition, both judges, anchor-pack abstain, provenance-stamped `RubricResult`, the `aiplatform
rubric` CLI, `/api/research/*` endpoints, and the researcher lens-config settings panel. **This
sprint extends that; it does not rebuild it.**

## Goal

Turn the fixed MAPS/SAAR scorer into a research experimentation platform: researchers address
sessions by **group code** (never internal UUIDs), author **arbitrary** rubrics (not just
MAPS/SAAR), have the judge reference the session's uploaded **docs/images**, **version** prompts and
**promote** a version to "live" with per-run provenance, and **re-score** a group's whole history
into a queryable run store.

## Why now

A researcher ran `rubric score crisp-pebble-21` and got "session not found" — `crisp-pebble-21` is
a group **join code**, but `score_session()` / the CLI take a raw ADK session UUID. That bug (M0) is
the thin end; the reframe (M's 2026-07-13 steer) is the rest.

## Milestones

### R2·M0 — group-code addressing (backend + CLI, ~150 LOC)

- `reports/session_summary.py`: `find_all_session_ids_for_group_bq(group_code) -> list[str]`
  (the existing `find_latest_session_id_for_group_bq` query, `LIMIT 1` dropped, ordered newest-first).
- `analytics/session_rubric.py`: `resolve_target(target) -> list[str]` — if `target` matches the
  group-code shape (`<adj>-<noun>-<NN>`, validated against `auth/group_id_wordlist`), resolve to
  session ids via the new BQ helper; else treat as a session id. `score_target(target, lens_id)`
  scores the **latest** session for a code (backfill in M4 scores all).
- `POST /api/research/rubric-score` accepts `{groupCode}` OR `{sessionId}`.
- CLI `aiplatform rubric score <group-code|session-id> --lens ...` (arg renamed `target`).

**Accept:** `aiplatform rubric score crisp-pebble-21 --lens maps` resolves the code → its latest
session and scores it (or a clean "no sessions for group" message); a raw session id still works.
Tests: group-code detection; resolver returns latest; unknown code → empty, not a crash.

### R2·M1 — free-form rubrics (backend + CLI, ~350 LOC)

- **`rubric_defs/{rubric_id}`** Firestore collection: `{rubric_id, label, family, prompt, output_keys,
  score_scale, model, current_live_version, latest_version, created_by, created_at, meta}`.
- `get_lens_config` / `list_lens_configs` union the **code** `LENS_REGISTRY` (seed lenses maps/saar)
  with `rubric_defs` (a Firestore rubric with the same id overrides nothing; a new id is additive).
  Unknown id now means "look in `rubric_defs`", not `KeyError`.
- **Generic judge path**: `build_generic_prompt(partition, pack, config)` assembles preamble
  (`config.prompt`) + attribution/meta + anchors + student-initiated evidence + a strict-JSON
  contract over `config.output_keys`. `score_session_summary` routes maps→`build_maps_prompt`,
  saar→`build_saar_prompt`, everything else→`build_generic_prompt` (no more abstain-on-unknown).
- CLI: `--lens` → `--rubric <id>` (free string, `Choice` dropped, default `maps`); add
  `rubric list`, `rubric versions <id>`, `rubric new <id>` (scaffolds a prompt file + creates the
  `rubric_defs` doc at version 1).
- API: `GET/PUT /api/research/rubrics` (list/create/update a `rubric_defs` entry, researcher-gated).

**Accept:** a researcher creates `rubric new my-lens`, edits the prompt, and
`rubric score <code> --rubric my-lens` scores with **no code change**; maps/saar unchanged.
Tests: union registry; generic prompt assembly + output-key contract; new rubric round-trips.

### R2·M2 — doc/image evidence (backend, ~250 LOC)

- `analytics/rubric_evidence.py`: `load_session_evidence(session_id, owner_uid, activity_id)` —
  docs via `tools/documents/context.build_document_context(doc_id, mode="blocks")` for each id in
  `chat_sessions/{id}.documentIds`; images via `adk/activity_images.load_activity_image(...)` for
  the activity's image `MaterialRef`s. Returns text blocks + image `Part`s.
- `SessionSummary` already carries `activity_id`/`owner_uid`; thread evidence into
  `score_session_summary` → the judge call sends multimodal `contents` (prompt text + doc blocks +
  image Parts) when evidence exists. Judge call seam updated to accept `list[Part]`.
- Evidence inclusion recorded in the result (`evidence_refs`) for audit + provenance.

**Accept:** scoring a session that had an uploaded worked-solution image sends that image to the
judge; the result lists the evidence it saw. Tests: evidence loader (mocked artifact svc);
multimodal contents assembled; graceful skip when a session has no docs/images.

### R2·M3 — versioning + run store + BQ mirror (backend + infra, ~450 LOC)

- **`rubric_runs/{run_id}`** Firestore collection: `{run_id, rubric_id, rubric_version, session_id,
  group_id, activity_id, model, profile, abstained, abstain_reason, partition_summary, evidence_refs,
  is_live, cost, latency_ms, created_at, meta}`. `score_session_summary` writes one per scored session.
- **Version lifecycle** on `rubric_defs`: prompt edits create `rubric_defs/{id}/versions/{n}`
  (`status: draft`); `promote(id, n)` sets `current_live_version = n` + version `status: live`.
  A run stamps `rubric_version = the version used` and `is_live = (version == current_live_version)`.
- **BQ mirror**: new `LOG_ID_RUBRIC_RUN = "aipla_rubric_run"` in `observability/chat_log.py` +
  `emit_rubric_run(...)`; table `aipla_rubric_run` added to the `chat-logs` terraform module
  (`infrastructure/modules/chat-logs/`), sink filter extended. Runs queryable next to turns.
- CLI: `rubric promote <id>@<version>`; `rubric runs <group-code>` (lists recent runs from Firestore).

**Accept:** two versions of a rubric exist; scoring stamps the exact version + `is_live`; `promote`
flips which one live scoring uses without touching drafts; a run lands in Firestore and (mocked) BQ
emit fires. Record the new BQ table + sink change in the side-effects notes file.

### R2·M4 — retroactive backfill (backend + CLI, ~200 LOC)

- `backfill_group(group_code, rubric_id, version=None) -> list[RubricResult]` — enumerate all
  sessions via `find_all_session_ids_for_group_bq`, score each (M0 resolver, M2 evidence), write each
  to `rubric_runs` (M3). Concurrency-bounded; per-session errors logged and skipped, never abort the batch.
- CLI: `aiplatform rubric backfill <group-code> --rubric <id>[@<version>]` — prints a per-session
  summary + a "N scored / M abstained / K errors" tail; `--dry-run` counts sessions without scoring.

**Accept:** `rubric backfill <code> --rubric maps` scores every past session for the group into
`rubric_runs`; the runs are queryable (Firestore now, BQ once the sink lands). Tests: enumerator
returns all; batch tolerates a bad session; dry-run counts without a judge call.

## Sequencing

R2·M0 → M1 → M2 → M3 → M4 (each builds on the prior). One commit per milestone straight to `dev`
(no PRs — AIPLA workflow), rebase before push.

## Quality gates

Per milestone: `cd backend && make lint && make test-fast`; CLI-touching milestones (M0, M1, M4)
also `make cli-selftest`. No teacher/student surface changes → no frontend gate this sprint (the
RUBRIC-1 researcher panel is untouched; a rubric-picker UI is a follow-on).

## Out of scope

Anchor-pack authoring (AR/JB pedagogy-days), four-format quiz, misconception index, any
teacher-facing rubric vocabulary (R1-gated), a rubric-authoring **UI** (CLI + settings-JSON first).

## Side effects to record (for the Terraform recipe)

- New Firestore collections: `rubric_defs`, `rubric_defs/{id}/versions`, `rubric_runs`.
- New BQ table `aipla_rubric_run` in dataset `chat_logs` + a Cloud Logging sink filter extension
  (`infrastructure/modules/chat-logs/`). Log all of this in the GCP side-effects notes.
