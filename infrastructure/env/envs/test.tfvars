project_id = "aipla-test-2026"
env        = "test"
# The 2nd-gen Cloud Build GitHub connection installed in this project (console
# OAuth, G1). Named github-aipla on test (dev's is sunholo-github — per-env, fine).
cb_connection             = "github-aipla"
partition_expiration_days = 365
teacher_mock              = false
preview_feature_flags     = false # test/prod stay off until AR/JB's framework lands
admin_operator_members    = ["user:m@sunholo.com"]
email_signin_enabled      = true # test-teacher@example.dk for curriculum seed + teacher-flow testing
# Both set after their services' first deploy assigns a *.run.app URL
# (chicken-egg — see README): frontend_url → sandbox ALLOWED_HOST_ORIGINS;
# mcp_sandbox_url → NEXT_PUBLIC_MCP_SANDBOX_URL baked into the frontend bundle.
frontend_url    = "https://aipla-v01-frontend-y2bmxayxca-lz.a.run.app"             # sandbox ALLOWED_HOST_ORIGINS
mcp_sandbox_url = "https://aipla-v01-sandbox-y2bmxayxca-lz.a.run.app/sandbox.html" # predicted (Cloud Run shares a per-project URL hash with the frontend)
# UCPH-granted custom domain (2026-08-03). Set BEFORE UCPH IT creates the DNS
# records — the apply reserves the static IPs that go IN the request, and the
# managed cert waits in PROVISIONING until the name resolves. See loadbalancer.tf.
custom_domain         = "aipla-test.ku.dk"
sandbox_custom_domain = "aipla-test-sandbox.ku.dk"

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
