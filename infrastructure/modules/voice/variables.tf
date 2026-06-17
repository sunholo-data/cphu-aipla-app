variable "project_id" {
  type        = string
  description = "GCP project for this environment (aipla-{dev,test,prod}-2026)."
}

variable "env" {
  type        = string
  description = "Environment label: dev | test | prod. Used only for resource labels."
  validation {
    condition     = contains(["dev", "test", "prod"], var.env)
    error_message = "env must be one of: dev, test, prod."
  }
}

variable "region" {
  type        = string
  description = "GCS region for the TTS cache bucket. AIPLA pins europe-north1 (Finland) per ADR-005/007."
  default     = "europe-north1"
}

variable "tts_cache_bucket" {
  type        = string
  description = <<-EOT
    Name of the TTS cache bucket for this env. Default follows the
    convention `aipla-$${env-project}-tts-cache`. Override only if a
    conflicting bucket name already exists.
  EOT
  default     = null
  nullable    = true
}

variable "tts_cache_lifecycle_days" {
  type        = number
  description = <<-EOT
    Days after which a cached TTS object is deleted. 90 is a reasonable
    balance: long enough that re-played tutor turns hit cache for the
    duration of a typical lesson series, short enough that audio for
    deleted skills naturally rolls off without manual cleanup.
  EOT
  default     = 90
}

variable "backend_service_account_email" {
  type        = string
  description = "Runtime backend SA that calls TTS/STT + reads/writes the cache bucket (aipla-v6@<project>.iam.gserviceaccount.com)."
}

locals {
  tts_cache_bucket_resolved = var.tts_cache_bucket != null ? var.tts_cache_bucket : "${var.project_id}-tts-cache"
}
