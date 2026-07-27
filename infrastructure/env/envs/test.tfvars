project_id                = "aipla-test-2026"
env                       = "test"
deploy_branch             = "test"
partition_expiration_days = 365
teacher_mock              = false
preview_feature_flags     = false # test/prod stay off until AR/JB's framework lands
# Both set after their services' first deploy assigns a *.run.app URL
# (chicken-egg — see README): frontend_url → sandbox ALLOWED_HOST_ORIGINS;
# mcp_sandbox_url → NEXT_PUBLIC_MCP_SANDBOX_URL baked into the frontend bundle.
frontend_url    = ""
mcp_sandbox_url = ""
