project_id = "aipla-prod-2026"
env        = "prod"
# Pre-declared per the test lesson: the 2nd-gen Cloud Build GitHub connection
# will be console-OAuth-created in aipla-prod-2026 with THIS name during the prod
# cut (G1), then `terraform import`ed. Name it github-aipla to match test.
cb_connection             = "github-aipla"
partition_expiration_days = 365
teacher_mock              = false
# 2026-08-04: ON, matching test. Previously unset (defaulting false), so prod had
# no authoring co-pilot, concept map, or "AIPLA Hjælp" help bot. Note this tfvar
# alone was never sufficient for prod: prod is reached only by the promote
# pipeline, which until today passed no feature-flag build-args at all — see
# cloudbuild.promote.yaml. Both halves are needed.
preview_feature_flags = true
frontend_url          = "https://aipla-v01-frontend-6vwz657g3a-lz.a.run.app" # sandbox ALLOWED_HOST_ORIGINS
# 2026-08-17: moved from the run.app sandbox origin to the ku.dk one, following
# test (which moved 2026-08-17 in f9d9610). Verified before the change:
# aipla-sandbox.ku.dk/sandbox.html serves 200 and is byte-identical to prod's
# run.app sandbox, so the domain mapping points at THIS project's service, and
# test's differs — these are not a shared origin.
#
# ADR-013 holds either way: the sandbox stays a DISTINCT origin from the app
# (aipla-sandbox.ku.dk vs aipla.ku.dk are different hosts, so the iframe is still
# cross-origin and the sandbox+CSP isolation is unchanged). This only makes the
# origin match the app's own domain instead of a run.app address.
#
# NOT a runtime setting: it is baked into the frontend bundle as a build-arg
# (NEXT_PUBLIC_MCP_SANDBOX_URL), so it needs a frontend REBUILD to take effect —
# apply, then re-run the promote for the release tag. A redeploy of the existing
# image silently keeps the old origin.
mcp_sandbox_url = "https://aipla-sandbox.ku.dk/sandbox.html"
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
# HELD BACK (2026-08-04). The authoritative owner list is written, validated and
# ready (iam.tf google_project_iam_binding.owners), but applying it degrades
# m@sunholo.com to viewer + builds.editor -- and that is only safe once someone
# has actually AUTHENTICATED as the break-glass account. mark.edmondson@ind.ku.dk
# sits behind UCPH IT processes and has not been exercised. These projects have
# no parent org, so if break-glass turns out to be unusable after the everyday
# account is degraded, there is no way back.
#
# Uncomment ONLY after a successful:
#   gcloud auth login mark.edmondson@ind.ku.dk
#   gcloud projects get-iam-policy <project> --account=mark.edmondson@ind.ku.dk
# project_owners = ["user:mark.edmondson@ind.ku.dk"]
