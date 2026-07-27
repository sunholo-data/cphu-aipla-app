project_id                = "aipla-prod-2026"
env                       = "prod"
deploy_branch             = "prod"
# Pre-declared per the test lesson: the 2nd-gen Cloud Build GitHub connection
# will be console-OAuth-created in aipla-prod-2026 with THIS name during the prod
# cut (G1), then `terraform import`ed. Name it github-aipla to match test.
cb_connection = "github-aipla"
partition_expiration_days = 365
teacher_mock              = false
# Set after the first deploy assigns a *.run.app URL (chicken-egg — see README).
frontend_url           = ""
admin_operator_members = ["user:m@sunholo.com"]
