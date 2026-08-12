# Ring 0 of ACCESS-1 — the spend ceiling that needs no application code.
#
# Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md
#
# The application-level controls (access tiers, the budget enforcer) are the
# rings that do the day-to-day work. This file is the ring underneath them: it
# holds even if every one of them has a bug, because no application code can
# exceed a Service Usage quota or un-notice a billing alert.
#
# WHY THIS IS OPT-IN PER ENV (defaults to disabled):
#
#   The billing budget needs `billing.costsManager` on the BILLING ACCOUNT — a
#   scope ABOVE the project, which `aipla-terraform@` does not hold by default.
#   Declaring it unconditionally would red every apply on every env until that
#   grant lands, which is a worse failure than not having the alert yet.
#
# TO TURN ON, per env:
#   1. grant:   roles/billing.costsManager on billingAccounts/<id>
#               to serviceAccount:aipla-terraform@<project>.iam.gserviceaccount.com
#   2. set:     spend_ceiling_enabled = true
#               billing_account_id    = "01A211-266D3F-D96890"   (verified 2026-08-12)
#               monthly_budget_eur    = <number>
#               spend_alert_emails    = ["m@sunholo.com"]
#      in infrastructure/env/envs/<env>.tfvars
#   3. apply:   make tf-apply ENV=<env> GO=1
#
# The Vertex token ceiling — the half that actually STOPS spend rather than
# reporting it — is `make spend-ceiling ENV=<env>`. See below.

locals {
  spend_ceiling_on = var.spend_ceiling_enabled
}

# --- The Vertex token ceiling is NOT here, deliberately -----------------------
#
# `google_service_usage_consumer_quota_override` does not exist in the google or
# google-beta provider at the version this repo pins (6.50.0, versions.tf) —
# verified 2026-08-12 against both provider binaries, not assumed. Rather than
# bump the provider for every resource in this directory to get one, the quota
# half lives in `scripts/spend-ceiling.sh` (`make spend-ceiling ENV=<env>`),
# which applies the override via `gcloud alpha services quota update` and then
# READS IT BACK. Re-home it here if the provider ever grows the resource.
#
# The metric is
#   aiplatform.googleapis.com/global_generate_content_input_tokens_per_minute_per_base_model
# on its `1/d/{project}/{base_model}` limit — the DAILY unit, not the per-minute
# one. A per-minute cap throttles a spike but still permits unbounded spend over
# a day, which is exactly the shape of the risk here (one leaked join code, many
# patient sessions). `global_*` and not the regional metric because the backend
# runs with GOOGLE_CLOUD_LOCATION=global (cloudbuild.yaml).

# --- Billing budget + alerts -------------------------------------------------
#
# An alert does NOT stop spend — the quota above is the thing that stops spend.
# This is how you find out, and it is the only control that sees Anthropic,
# OpenAI, Cloud TTS/STT and Vertex RAG in one number.
resource "google_billing_budget" "monthly" {
  count = local.spend_ceiling_on && var.billing_account_id != "" ? 1 : 0

  billing_account = var.billing_account_id
  display_name    = "AIPLA ${var.env} — monthly ceiling"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "EUR"
      units         = tostring(var.monthly_budget_eur)
    }
  }

  # 50/90/100 of forecast+actual. FORECASTED_SPEND on the 100% rule is the one
  # that gives useful warning — by the time ACTUAL hits 100% the money is spent.
  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = [
      for c in google_monitoring_notification_channel.spend_alert : c.id
    ]
    disable_default_iam_recipients = false
  }
}

resource "google_monitoring_notification_channel" "spend_alert" {
  for_each = local.spend_ceiling_on ? toset(var.spend_alert_emails) : toset([])

  project      = var.project_id
  display_name = "AIPLA spend alert — ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.apis]
}

data "google_project" "this" {
  project_id = var.project_id
}
