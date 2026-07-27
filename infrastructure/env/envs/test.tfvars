project_id                = "aipla-test-2026"
env                       = "test"
deploy_branch             = "test"
# The 2nd-gen Cloud Build GitHub connection installed in this project (console
# OAuth, G1). Named github-aipla on test (dev's is sunholo-github — per-env, fine).
cb_connection = "github-aipla"
partition_expiration_days = 365
teacher_mock              = false
preview_feature_flags     = false # test/prod stay off until AR/JB's framework lands
admin_operator_members    = ["user:m@sunholo.com"]
# Both set after their services' first deploy assigns a *.run.app URL
# (chicken-egg — see README): frontend_url → sandbox ALLOWED_HOST_ORIGINS;
# mcp_sandbox_url → NEXT_PUBLIC_MCP_SANDBOX_URL baked into the frontend bundle.
frontend_url    = ""
mcp_sandbox_url = ""
