# Custom domains — one global external Application Load Balancer per env,
# fronting BOTH the frontend and the MCP-App sandbox Cloud Run services.
#
# WHY AN ALB AND NOT A CLOUD RUN DOMAIN MAPPING (2026-08-03):
# ku.dk is UCPH's domain, not ours. A Cloud Run domain mapping needs Google
# Search Console ownership verification, which for a subdomain means a TXT
# record at the name itself — and a CNAME cannot coexist with a TXT at the same
# name (RFC 1034 "CNAME and other data"). So the mapping route is: UCPH adds
# TXT, we verify, UCPH deletes TXT and adds the CNAME, and Search Console may
# re-check later and silently un-verify us. The alternative is verifying
# `ku.dk` itself, i.e. getting UCPH's root-domain owners into a Search Console
# property for a 4-month pilot.
#
# A Google-managed certificate on an ALB validates by the name simply
# RESOLVING to the load balancer's IP. No verification, no TXT, no Search
# Console. UCPH IT gets one boring request: A/AAAA records. It is also what
# Google recommends over domain mappings for production, and it leaves room for
# Cloud Armor (e.g. IP-restricting test to UCPH networks).
#
# ONE LB, TWO HOSTNAMES. The frontend and the sandbox share an IP and are split
# by Host header. ADR-013 requires the sandbox on a SEPARATE ORIGIN, and an
# origin is scheme+host+port — a distinct hostname satisfies it regardless of
# which IP answers. Sharing the LB halves the forwarding-rule spend and keeps
# one cert-provisioning story per env.
#
# TWO CERTS, NOT ONE TWO-DOMAIN CERT. A managed certificate stays PROVISIONING
# until EVERY domain on it validates, so a single cert covering both names would
# let a missing sandbox DNS record hold the FRONTEND hostage. Separate certs on
# the same HTTPS proxy (which accepts up to 15) fail independently.
#
# ORDER OF OPERATIONS. Apply this FIRST, with the domains set. The IPs are
# static and anycast, so they exist before DNS does — that is the whole point:
# the addresses go in the request to UCPH IT. Each managed certificate sits in
# PROVISIONING until its name resolves here, then issues by itself (typically
# 15-60 minutes, occasionally up to 24h). Nothing to re-run after DNS lands.
#
# Everything is gated on the domain vars, so dev (which has no ku.dk name)
# plans and applies unchanged.

locals {
  lb_enabled         = var.custom_domain != "" ? 1 : 0
  sandbox_lb_enabled = var.sandbox_custom_domain != "" ? 1 : 0

  # Origin form of the frontend's custom domain — what the sandbox pins as an
  # allowed embedder and what the browser sends as `Origin`. Empty when unset so
  # compact() drops it, same pattern as var.frontend_url.
  custom_domain_url = var.custom_domain != "" ? "https://${var.custom_domain}" : ""

  # Certificate names are immutable in-place: changing `managed.domains` forces
  # replacement, and a target proxy cannot be left certificate-less mid-swap.
  # Encoding the domain in the name + create_before_destroy means a domain
  # change provisions the new cert, re-points the proxy, then drops the old one.
  cert_name         = "aipla-v01-${replace(var.custom_domain, ".", "-")}"
  sandbox_cert_name = "aipla-v01-${replace(var.sandbox_custom_domain, ".", "-")}"
}

# ---- Addresses --------------------------------------------------------------
# Reserved (static) global anycast addresses. These are the values that go in
# the DNS request — they do not change for the life of the resource. BOTH
# hostnames in an env point at the same pair.

resource "google_compute_global_address" "frontend_v4" {
  count = local.lb_enabled

  project    = var.project_id
  name       = "aipla-v01-frontend-v4"
  ip_version = "IPV4"

  depends_on = [google_project_service.apis]
}

resource "google_compute_global_address" "frontend_v6" {
  count = local.lb_enabled

  project    = var.project_id
  name       = "aipla-v01-frontend-v6"
  ip_version = "IPV6"

  depends_on = [google_project_service.apis]
}

# ---- Backends: serverless NEGs -> Cloud Run ---------------------------------
# The NEGs reference their services BY NAME. Those services are deployed by
# Cloud Build, not Terraform, so there is no resource dependency to express —
# a NEG tolerates its service being redeployed underneath it (each deploy
# replaces revisions, not the service).

resource "google_compute_region_network_endpoint_group" "frontend" {
  count = local.lb_enabled

  project               = var.project_id
  name                  = "aipla-v01-frontend-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = "aipla-v01-frontend"
  }

  depends_on = [google_project_service.apis]
}

resource "google_compute_backend_service" "frontend" {
  count = local.lb_enabled

  project = var.project_id
  name    = "aipla-v01-frontend-backend"

  # EXTERNAL_MANAGED = the global external ALB (Envoy-based). Must match the
  # scheme on the forwarding rules or the apply fails with a scheme mismatch.
  load_balancing_scheme = "EXTERNAL_MANAGED"

  # Long enough for an AG-UI SSE stream to run without the LB cutting it off
  # mid-answer. The default (30s) would truncate any tutor turn that thinks or
  # calls tools for longer than that — silently, as a dropped stream.
  timeout_sec = 3600

  backend {
    group = google_compute_region_network_endpoint_group.frontend[0].id
  }

  # Request logging at full rate: traffic is a pilot's worth (tens of users),
  # and having the real per-request record is worth more than the log spend
  # when a teacher reports "it didn't load".
  log_config {
    enable      = true
    sample_rate = 1.0
  }

  # Serverless NEG backends take no health checks — Cloud Run's own readiness
  # is the health signal. Deliberately absent, not forgotten.

  # Cloud Armor would attach here (security_policy = ...) if test is ever
  # restricted to UCPH IP ranges. Not wired for the pilot.
}

resource "google_compute_region_network_endpoint_group" "sandbox" {
  count = local.sandbox_lb_enabled

  project               = var.project_id
  name                  = "aipla-v01-sandbox-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = "aipla-v01-sandbox"
  }

  lifecycle {
    precondition {
      condition     = var.custom_domain != ""
      error_message = "sandbox_custom_domain requires custom_domain: the sandbox rides the frontend's load balancer (shared IP, Host-header split), so there is no LB to attach to without it."
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_compute_backend_service" "sandbox" {
  count = local.sandbox_lb_enabled

  project               = var.project_id
  name                  = "aipla-v01-sandbox-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  # Static artefact HTML — no streaming, so the 30s default is ample. Left at
  # the default deliberately, in contrast to the frontend above.

  backend {
    group = google_compute_region_network_endpoint_group.sandbox[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

# ---- HTTPS front end --------------------------------------------------------

resource "google_compute_managed_ssl_certificate" "frontend" {
  count = local.lb_enabled

  project = var.project_id
  name    = local.cert_name

  managed {
    domains = [var.custom_domain]
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.apis]
}

resource "google_compute_managed_ssl_certificate" "sandbox" {
  count = local.sandbox_lb_enabled

  project = var.project_id
  name    = local.sandbox_cert_name

  managed {
    domains = [var.sandbox_custom_domain]
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.apis]
}

# Host-header split. `default_service` catches anything that reaches the IP
# with an unrecognised Host (someone browsing the bare address, a stale name)
# and serves the app rather than erroring — the sandbox is never the sensible
# fallback, since on its own it renders only artefact chrome.
resource "google_compute_url_map" "frontend_https" {
  count = local.lb_enabled

  project         = var.project_id
  name            = "aipla-v01-frontend-https"
  default_service = google_compute_backend_service.frontend[0].id

  dynamic "host_rule" {
    for_each = local.sandbox_lb_enabled == 1 ? [1] : []
    content {
      hosts        = [var.custom_domain]
      path_matcher = "frontend"
    }
  }

  dynamic "host_rule" {
    for_each = local.sandbox_lb_enabled == 1 ? [1] : []
    content {
      hosts        = [var.sandbox_custom_domain]
      path_matcher = "sandbox"
    }
  }

  dynamic "path_matcher" {
    for_each = local.sandbox_lb_enabled == 1 ? [1] : []
    content {
      name            = "frontend"
      default_service = google_compute_backend_service.frontend[0].id
    }
  }

  dynamic "path_matcher" {
    for_each = local.sandbox_lb_enabled == 1 ? [1] : []
    content {
      name            = "sandbox"
      default_service = google_compute_backend_service.sandbox[0].id
    }
  }
}

resource "google_compute_target_https_proxy" "frontend" {
  count = local.lb_enabled

  project = var.project_id
  name    = "aipla-v01-frontend-https-proxy"
  url_map = google_compute_url_map.frontend_https[0].id

  ssl_certificates = concat(
    google_compute_managed_ssl_certificate.frontend[*].id,
    google_compute_managed_ssl_certificate.sandbox[*].id,
  )
}

resource "google_compute_global_forwarding_rule" "https_v4" {
  count = local.lb_enabled

  project               = var.project_id
  name                  = "aipla-v01-frontend-https-v4"
  target                = google_compute_target_https_proxy.frontend[0].id
  ip_address            = google_compute_global_address.frontend_v4[0].id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_global_forwarding_rule" "https_v6" {
  count = local.lb_enabled

  project               = var.project_id
  name                  = "aipla-v01-frontend-https-v6"
  target                = google_compute_target_https_proxy.frontend[0].id
  ip_address            = google_compute_global_address.frontend_v6[0].id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# ---- HTTP -> HTTPS redirect -------------------------------------------------
# Without this, http://aipla.ku.dk is a connection refused rather than a
# redirect — which reads as "the site is down" to anyone who types the name
# without a scheme, i.e. most people. Applies to both hostnames.

resource "google_compute_url_map" "frontend_http_redirect" {
  count = local.lb_enabled

  project = var.project_id
  name    = "aipla-v01-frontend-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "frontend_redirect" {
  count = local.lb_enabled

  project = var.project_id
  name    = "aipla-v01-frontend-http-proxy"
  url_map = google_compute_url_map.frontend_http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http_v4" {
  count = local.lb_enabled

  project               = var.project_id
  name                  = "aipla-v01-frontend-http-v4"
  target                = google_compute_target_http_proxy.frontend_redirect[0].id
  ip_address            = google_compute_global_address.frontend_v4[0].id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_global_forwarding_rule" "http_v6" {
  count = local.lb_enabled

  project               = var.project_id
  name                  = "aipla-v01-frontend-http-v6"
  target                = google_compute_target_http_proxy.frontend_redirect[0].id
  ip_address            = google_compute_global_address.frontend_v6[0].id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
