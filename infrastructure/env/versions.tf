terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Partial backend: `terraform init -backend-config="bucket=<state-bucket>" \
  #   -backend-config="prefix=aipla-env/<env>"`. State lives in a GCS bucket
  # (one bucket, per-env prefix). See README "State backend".
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
  # Route quota/billing for user-ADC calls to the target project. Required by
  # identitytoolkit (google_identity_platform_config) and Firebase resources,
  # which otherwise 403 with "requires a quota project" under user ADC. Keeps
  # the apply reproducible for any operator without a global ADC quota setting.
  user_project_override = true
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
}
