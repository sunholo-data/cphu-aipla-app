output "dataset_id" {
  description = "The chat_logs BigQuery dataset id."
  value       = google_bigquery_dataset.chat_logs.dataset_id
}

output "dataset_self_link" {
  description = "Self link of the chat_logs dataset."
  value       = google_bigquery_dataset.chat_logs.self_link
}

output "sink_name" {
  description = "The Log Router sink name."
  value       = google_logging_project_sink.chat_logs.name
}

output "sink_writer_identity" {
  description = "Sink writer SA (granted dataEditor on the dataset). Surfaced for audit / cross-checking IAM."
  value       = google_logging_project_sink.chat_logs.writer_identity
}
