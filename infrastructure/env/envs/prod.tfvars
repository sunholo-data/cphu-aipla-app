project_id                = "aipla-prod-2026"
env                       = "prod"
deploy_branch             = "prod"
# Pre-declared per the test lesson: the 2nd-gen Cloud Build GitHub connection
# will be console-OAuth-created in aipla-prod-2026 with THIS name during the prod
# cut (G1), then `terraform import`ed. Name it github-aipla to match test.
cb_connection = "github-aipla"
partition_expiration_days = 365
teacher_mock              = false
frontend_url           = "https://aipla-v01-frontend-6vwz657g3a-lz.a.run.app"        # sandbox ALLOWED_HOST_ORIGINS
mcp_sandbox_url        = "https://aipla-v01-sandbox-6vwz657g3a-lz.a.run.app/sandbox.html" # predicted (per-project hash)
admin_operator_members = ["user:m@sunholo.com"]
# PILOT PHASE (2026-07-28): email sign-in enabled on prod so a seed-teacher can
# author + the team can evaluate teacher flows before UCPH SSO is wired. The
# SSO-only posture (ADR-001) is the handover target — revisit then.
email_signin_enabled = true
