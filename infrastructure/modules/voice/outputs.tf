output "tts_cache_bucket_name" {
  description = "Name of the TTS cache bucket created for this env."
  value       = google_storage_bucket.tts_cache.name
}

output "tts_cache_bucket_url" {
  description = "gs:// URL for the TTS cache bucket. Backend reads this via env var VOICE_TTS_CACHE_BUCKET."
  value       = google_storage_bucket.tts_cache.url
}

output "texttospeech_api_enabled" {
  description = "Surfaced for audit. True once Cloud TTS is enabled on the project."
  value       = google_project_service.texttospeech.service
}

output "speech_api_enabled" {
  description = "Surfaced for audit. True once Cloud STT is enabled on the project."
  value       = google_project_service.speech.service
}
