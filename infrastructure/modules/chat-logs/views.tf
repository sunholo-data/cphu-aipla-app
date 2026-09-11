# Flattened views over the sink's raw jsonPayload tables.
#
# The Cloud Logging → BigQuery sink writes the full LogEntry shape, so the
# raw tables expose chat fields under a nested `jsonPayload` RECORD. These
# views present the clean, flat schema that chat-log-pipeline.md documents
# and that summarize_session_bq + the 2.5 rubric query against.
#
# IMPORTANT: keep create_views = false on the FIRST apply. The base tables
# (var.turn_table / var.event_table) are created by the sink on the first
# matching log write — a view over a not-yet-existing table fails to apply.
# After data is flowing, set create_views = true and re-apply.

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
        jsonPayload.group_id                   AS group_id,
        jsonPayload.session_id                 AS session_id,
        jsonPayload.skill_id                   AS skill_id,
        CAST(jsonPayload.turn_index AS INT64)  AS turn_index,
        jsonPayload.role                       AS role,
        jsonPayload.content                    AS content,
        jsonPayload.model                      AS model,
        CAST(jsonPayload.token_in AS INT64)    AS token_in,
        CAST(jsonPayload.token_out AS INT64)   AS token_out,
        CAST(jsonPayload.latency_ms AS INT64)  AS latency_ms,
        jsonPayload.teacher_focus              AS teacher_focus,
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
        jsonPayload.tutor_id                   AS tutor_id,
        jsonPayload.framework_id               AS framework_id,
        jsonPayload.persona_id                 AS persona_id,
        jsonPayload.class_id                   AS class_id,
        jsonPayload.activity_id                AS activity_id,
        jsonPayload.interaction_style          AS interaction_style,
        jsonPayload.teaching_source            AS teaching_source,
        -- Which build produced this turn. `revision` is Cloud Run's K_REVISION
        -- and is the A/B ARM KEY: traffic tags route to revisions, so when two
        -- versions serve side by side this is what separates the arms. Without
        -- it an experiment is unanalysable after the fact — and unrecoverable,
        -- since you cannot backfill which build answered a past turn.
        jsonPayload.revision                   AS revision,
        jsonPayload.app_version                AS app_version
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
        jsonPayload.group_id     AS group_id,
        jsonPayload.session_id   AS session_id,
        jsonPayload.skill_id     AS skill_id,
        jsonPayload.server       AS server,
        jsonPayload.tool         AS tool,
        jsonPayload.field        AS field,
        jsonPayload.value        AS value,
        -- A/B arm key — see the chat_turns view for why this matters.
        jsonPayload.revision     AS revision,
        jsonPayload.app_version  AS app_version
      FROM `${var.project_id}.${var.dataset_id}.${var.event_table}`
    SQL
  }
}
