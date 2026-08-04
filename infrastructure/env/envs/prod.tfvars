project_id = "aipla-prod-2026"
env        = "prod"
# Pre-declared per the test lesson: the 2nd-gen Cloud Build GitHub connection
# will be console-OAuth-created in aipla-prod-2026 with THIS name during the prod
# cut (G1), then `terraform import`ed. Name it github-aipla to match test.
cb_connection             = "github-aipla"
partition_expiration_days = 365
teacher_mock              = false
frontend_url              = "https://aipla-v01-frontend-6vwz657g3a-lz.a.run.app"             # sandbox ALLOWED_HOST_ORIGINS
mcp_sandbox_url           = "https://aipla-v01-sandbox-6vwz657g3a-lz.a.run.app/sandbox.html" # predicted (per-project hash)
# UCPH-granted custom domain (2026-08-03). Set BEFORE UCPH IT creates the DNS
# records — the apply reserves the static IPs that go IN the request, and the
# managed cert waits in PROVISIONING until the name resolves. See loadbalancer.tf.
custom_domain          = "aipla.ku.dk"
sandbox_custom_domain  = "aipla-sandbox.ku.dk"
admin_operator_members = ["user:m@sunholo.com"]
# PILOT PHASE (2026-07-28): email sign-in enabled on prod so a seed-teacher can
# author + the team can evaluate teacher flows before UCPH SSO is wired. The
# SSO-only posture (ADR-001) is the handover target — revisit then.
email_signin_enabled = true

# 2026-08-03 hardening. The Compute Engine default SA ships with roles/EDITOR
# and AIPLA never uses it (Cloud Run runs as aipla-v6@; every trigger sets
# service_account explicitly). DISABLE is reversible; escalate to DELETE after
# the pilot if nothing has missed it.
default_service_accounts_action = "DISABLE"
# Strips the auto-granted roles/editor from <number>-compute@developer. Verified
# 2026-08-03: that SA is the ONLY editor holder here, so the authoritative empty
# binding removes exactly it.
remove_default_editor = true
# Daily Parquet export of the raw chat-log tables to GCS. On before the pilot
# starts collecting (2026-08-14) rather than after.
enable_chat_logs_backup = true
# SEQUENCE 1.1.60: authoritative owner list. Removes m@sunholo.com (the everyday
# shell + the identity agentic tooling runs as) and KEEPS break-glass. Without a
# parent org, project-level owner is the only escape hatch, so the break-glass
# entry is load-bearing, not decorative.
project_owners = ["user:mark.edmondson@ind.ku.dk"]
