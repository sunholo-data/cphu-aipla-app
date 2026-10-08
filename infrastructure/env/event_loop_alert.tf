# 1.1.131 M4 — the event-loop detector pages someone.
#
# Design: docs/design/aipla/v1.1.0-feedback/insights-off-the-event-loop.md
#
# `db.bigquery.run_query` logs `run_query on the event loop` (with the caller's
# stack) whenever a BigQuery query runs on the asyncio loop's own thread. With
# uvicorn on `--workers 1`, every such call freezes every student's tutor stream
# on that instance for the length of the query. On 22 Sep 2026 that was 59 s in
# the middle of a class.
#
# The detector shipped on 22 Sep and only LOGGED. It then logged 114 times on
# 24 Sep (the group-report route, M3) and nobody read it for five days. A
# detector no one is told about is the silent-failure shape the doc exists to
# close — so this turns the log line into a metric and the metric into a page.
#
# WHY TEXT, NOT SEVERITY: the backend logs through plain `logging` to stderr
# (`fast_api_app.py` basicConfig), so the line lands as `textPayload` with no
# Cloud Logging severity. `severity>=ERROR` found 29 entries in a week in which
# this detector alone logged 114 in one day. Match the text.
#
# WHY `aipla-v01-frontend`: there is no separate backend service. The FastAPI/ADK
# backend runs as a sidecar inside the frontend service (BACKEND_URL=127.0.0.1),
# so its logs carry the frontend's service_name.
#
# ON by default for prod only; any env can opt in with
# `event_loop_alert_enabled = true` in envs/<env>.tfvars. Committed, NOT applied:
# applying is `make tf-apply ENV=prod GO=1`, a deliberate human step.

variable "event_loop_alert_enabled" {
  type        = bool
  description = "Create the `run_query on the event loop` log metric + alert (1.1.131 M4). Null = on for prod only."
  default     = null
}

variable "ops_alert_emails" {
  type        = list(string)
  description = "Who is paged when an ops alert (the event-loop detector) fires. An empty list creates the alert with no channel — it then shows only in the console, which is the silent shape this alert exists to end."
  default     = ["m@sunholo.com"]
}

locals {
  event_loop_alert_on = var.event_loop_alert_enabled == null ? var.env == "prod" : var.event_loop_alert_enabled
}

resource "google_logging_metric" "run_query_on_event_loop" {
  count = local.event_loop_alert_on ? 1 : 0

  project     = var.project_id
  name        = "aipla/run_query_on_event_loop"
  description = "1.1.131 — a synchronous BigQuery query ran on the asyncio event loop, freezing every stream on the instance. Emitted by db.bigquery._warn_if_on_event_loop."

  filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"aipla-v01-frontend\"",
    "textPayload:\"run_query on the event loop\"",
  ])

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_notification_channel" "ops_alert" {
  for_each = local.event_loop_alert_on ? toset(var.ops_alert_emails) : toset([])

  project      = var.project_id
  display_name = "AIPLA ops alert — ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }

  # The runner's monitoring roles must exist before it creates monitoring
  # resources — in a fresh project both land in the same apply.
  depends_on = [google_project_service.apis, google_project_iam_member.terraform]
}

resource "google_monitoring_alert_policy" "run_query_on_event_loop" {
  count = local.event_loop_alert_on ? 1 : 0

  project      = var.project_id
  display_name = "AIPLA ${var.env} — BigQuery on the event loop (student streams frozen)"
  combiner     = "OR"

  conditions {
    display_name = "run_query on the event loop ≥ 1 in 5 min"

    condition_threshold {
      # A log-based metric's type is `logging.googleapis.com/user/<name>`.
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.run_query_on_event_loop[0].name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.ops_alert : c.id]

  alert_strategy {
    # One page per incident, not one per poll: the group-report route that
    # found this is polled every few seconds by the teacher's live view.
    auto_close = "3600s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      A synchronous BigQuery query ran on the asyncio event loop in the backend
      sidecar of `aipla-v01-frontend`. With one uvicorn worker, every student's
      tutor stream on that instance froze for the length of the query.

      **Find the caller:** Logs Explorer, `textPayload:"run_query on the event loop"`
      — the entry carries the caller's stack. Query by text; these lines carry
      no severity.

      **Fix:** wrap the call in `await asyncio.to_thread(...)` (or
      `CACHE.aget_or_compute` for insights) and add the route to
      `backend/tests/api_tests/test_blocking_queries_off_the_loop.py`.

      Design: `docs/design/aipla/v1.1.0-feedback/insights-off-the-event-loop.md` (1.1.131).
    EOT
  }
}
