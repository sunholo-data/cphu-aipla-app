# `chat-logs` terraform module

BigQuery preconditions for the chat-log pipeline — the durable, group-ID-keyed
store that teacher monitoring + analysis depends on.

- **Design doc:** [chat-log-pipeline.md](../../../docs/design/aipla/v1.0.0-pilot/chat-log-pipeline.md) (SEQUENCE 1.2)
- **Also covers:** the BigQuery slice of [aipla-cloud-bootstrap.md §F](../../../docs/design/aipla/v1.0.0-pilot/aipla-cloud-bootstrap.md) (SEQUENCE 1.1)
- **ADRs:** 001 (group anonymity / no PII), 005 (chat log storage / consent-driven retention), 008 (observability, in-project)

## What it creates

| Resource | Purpose |
|---|---|
| `google_bigquery_dataset.chat_logs` | Region-pinned dataset (`europe-north1`); dataset-level partition expiration = retention |
| `google_logging_project_sink.chat_logs` | Routes the backend's `aipla_chat_turn` + `aipla_workbench_event` structured log entries to the dataset; partitioned tables; dedicated writer identity |
| `google_bigquery_dataset_iam_member.sink_writer` | Sink writer SA → `dataEditor` on the dataset (without this, logs never land) |
| `google_bigquery_dataset_iam_member.backend_reader` | `aipla-v6@` → `dataViewer` (report route + rubric read) |
| `google_project_iam_member.backend_job_user` | `aipla-v6@` → `jobUser` (run query jobs); toggle off if 1.1 grants it centrally |
| `google_bigquery_table.{chat_turns,workbench_events}` | Flattened views over the sink's raw `jsonPayload` tables — **opt-in via `create_views`** (see two-phase apply) |

The flat schema the views expose is the one documented in chat-log-pipeline.md
(`group_id, session_id, skill_id, turn_index, role, content, model, token_in,
token_out, latency_ms, teacher_focus, ts` for turns).

## Two-phase apply (important)

The sink auto-creates the raw base tables (`aipla_chat_turn`,
`aipla_workbench_event`) on the **first matching log write** — they do not
exist at first apply. A view over a missing table fails. So:

1. **First apply** — `create_views = false` (default). Creates the dataset,
   sink, and IAM. Logs start flowing once the backend emitter (1.2 code) is
   deployed.
2. **After data is flowing** — set `create_views = true` and re-apply to add
   the flattened `chat_turns` / `workbench_events` views.

Verify the raw tables exist before flipping the flag:

```bash
bq --project_id=aipla-dev-2026 ls chat_logs
# expect: aipla_chat_turn, aipla_workbench_event
```

## Per-env usage

The module is fully env-parameterized — instantiate once per environment.
`partition_expiration_days` is the retention knob; calibrate test/prod to the
consent form (DPIA, SEQUENCE 1.13).

```hcl
# envs/dev/main.tf
module "chat_logs" {
  source                        = "../../modules/chat-logs"
  project_id                    = "aipla-dev-2026"
  env                           = "dev"
  backend_service_account_email = "aipla-v6@aipla-dev-2026.iam.gserviceaccount.com"
  partition_expiration_days     = 30        # dev keeps less
  # create_views                = true      # flip on the 2nd apply
}

# envs/test/main.tf
module "chat_logs" {
  source                        = "../../modules/chat-logs"
  project_id                    = "aipla-test-2026"
  env                           = "test"
  backend_service_account_email = "aipla-v6@aipla-test-2026.iam.gserviceaccount.com"
  partition_expiration_days     = 180
}

# envs/prod/main.tf
module "chat_logs" {
  source                        = "../../modules/chat-logs"
  project_id                    = "aipla-prod-2026"
  env                           = "prod"
  backend_service_account_email = "aipla-v6@aipla-prod-2026.iam.gserviceaccount.com"
  partition_expiration_days     = 365       # set per consent form before pilot
}
```

## Prerequisites (must exist before apply)

These are owned by the 1.1 bootstrap (and recorded in
[`bootstrap-aipla-dev.NOTES.md`](../../../scripts/bootstrap-aipla-dev.NOTES.md)):

- `bigquery.googleapis.com` + `logging.googleapis.com` APIs enabled.
- The `aipla-v6@<project>` service account exists.
- Terraform runs as a principal with `roles/bigquery.admin` +
  `roles/logging.admin` (or the bootstrap deploy SA) on the target project.

## Backend contract (1.2 code, separate sprint)

The emitter must write Cloud Logging structured entries under these log ids
so the default `log_filter` and view source tables match:

- `aipla_chat_turn` — `jsonPayload = {group_id, session_id, skill_id, turn_index, role, content, model, token_in, token_out, latency_ms, teacher_focus}`
- `aipla_workbench_event` — `jsonPayload = {group_id, session_id, skill_id, server, tool, field, value}`

If you change the log ids, override `log_filter`, `turn_table`, `event_table`.

## Outputs

`dataset_id`, `dataset_self_link`, `sink_name`, `sink_writer_identity`.
