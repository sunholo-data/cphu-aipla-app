# Flattened views over the sink's raw jsonPayload tables.
#
# The Cloud Logging → BigQuery sink writes the full LogEntry shape, so the
# raw tables expose chat fields under a nested `jsonPayload` RECORD. These
# views present the clean, flat schema that chat-log-pipeline.md documents
# and that summarize_session_bq + the 2.5 rubric query against.
#
# IMPORTANT: the base tables (var.turn_table / var.event_table) are created by
# the sink on the first matching log write, so create_views must stay false
# until data is flowing. Enabled in env/modules.tf since 2026-09-11.
#
# ⚠️ EVERY FIELD IS READ WITH JSON_VALUE, NOT AS A STRUCT MEMBER, and that is
# load-bearing rather than a style choice.
#
# The sink infers the jsonPayload STRUCT from the fields it has actually SEEN
# with a non-null value. A field the emitter always sends as null never appears
# in the schema at all, and `SELECT jsonPayload.latency_ms` over a table that
# has never carried one fails the whole view with
#
#     Error 400: Field name latency_ms does not exist in STRUCT<...>
#
# which is exactly how the first attempt to enable these views failed
# (2026-09-11). `latency_ms` and `teacher_focus` are accepted by emit_chat_turn
# and never passed by its only caller; `tutor_id` / `framework_id` /
# `persona_id` are null until a class has a tutor assigned. So a struct-member
# view is only creatable once every column it names has been populated at least
# once — a chicken-and-egg that makes it un-deployable on a fresh environment
# and breaks retroactively whenever a column is added.
#
# JSON_VALUE reads the raw JSON and returns NULL for an absent path, so the view
# is independent of which fields happen to exist yet. Numbers come back as
# strings and go through SAFE_CAST(... AS FLOAT64) AS INT64 — the raw JSON holds
# integers but the inferred struct types them FLOAT, and a direct INT64 cast of
# "0.0" would fail.
#
# The cost is a per-row JSON parse. For a research dataset queried by humans
# that is the right trade against a view that cannot be created.

resource "google_bigquery_table" "chat_turns" {
  count               = var.create_views ? 1 : 0
  project             = var.project_id
  dataset_id          = google_bigquery_dataset.chat_logs.dataset_id
  table_id            = "chat_turns"
  deletion_protection = false

  description = "Flattened view of chat turns (see chat-log-pipeline.md schema). Source: ${var.turn_table} (sink-created)."

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        timestamp                              AS ts,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.group_id") AS group_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.session_id") AS session_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.skill_id") AS skill_id,
        SAFE_CAST(SAFE_CAST(JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.turn_index") AS FLOAT64) AS INT64) AS turn_index,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.role") AS role,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.content") AS content,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.model") AS model,
        SAFE_CAST(SAFE_CAST(JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.token_in") AS FLOAT64) AS INT64) AS token_in,
        SAFE_CAST(SAFE_CAST(JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.token_out") AS FLOAT64) AS INT64) AS token_out,
        SAFE_CAST(SAFE_CAST(JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.latency_ms") AS FLOAT64) AS INT64) AS latency_ms,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.teacher_focus") AS teacher_focus,
        -- What this conversation was taught WITH (TUTOR-5, 2026-09-11). The
        -- pipeline's first four months recorded skill_id and nothing about the
        -- pedagogy, so "every chat taught with ESRU" was not an answerable
        -- question. These are stamped at emit time in
        -- adk/tutor_resolution.resolve_teaching_context, from the SAME
        -- resolution the tutor's prompt is built from.
        --
        -- ⚠️ NULL on every row written before 2026-09-11, and deliberately not
        -- backfilled. A class's tutor changes over time, so joining
        -- group -> class -> tutor -> framework after the fact files old turns
        -- under arms they never ran under. Treat NULL as "not recorded", never
        -- as "no framework" — `teaching_source` is how you tell the difference
        -- going forward: 'tutor' means a Tutor object decided, 'fields' means
        -- the pre-tutor activity/class fields did.
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.tutor_id") AS tutor_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.framework_id") AS framework_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.persona_id") AS persona_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.class_id") AS class_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.activity_id") AS activity_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.interaction_style") AS interaction_style,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.teaching_source") AS teaching_source,
        -- Which build produced this turn. `revision` is Cloud Run's K_REVISION
        -- and is the A/B ARM KEY: traffic tags route to revisions, so when two
        -- versions serve side by side this is what separates the arms. Without
        -- it an experiment is unanalysable after the fact — and unrecoverable,
        -- since you cannot backfill which build answered a past turn.
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.revision") AS revision,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.app_version") AS app_version
      FROM `${var.project_id}.${var.dataset_id}.${var.turn_table}`
    SQL
  }
}

resource "google_bigquery_table" "workbench_events" {
  count               = var.create_views ? 1 : 0
  project             = var.project_id
  dataset_id          = google_bigquery_dataset.chat_logs.dataset_id
  table_id            = "workbench_events"
  deletion_protection = false

  description = "Flattened view of workbench events (see chat-log-pipeline.md schema). Source: ${var.event_table} (sink-created)."

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        timestamp                AS ts,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.group_id") AS group_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.session_id") AS session_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.skill_id") AS skill_id,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.server") AS server,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.tool") AS tool,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.field") AS field,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.value") AS value,
        -- A/B arm key — see the chat_turns view for why this matters.
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.revision") AS revision,
        JSON_VALUE(TO_JSON_STRING(jsonPayload), "$.app_version") AS app_version
      FROM `${var.project_id}.${var.dataset_id}.${var.event_table}`
    SQL
  }
}
