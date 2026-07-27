project_id                = "aipla-prod-2026"
env                       = "prod"
deploy_branch             = "prod"
partition_expiration_days = 365
teacher_mock              = false
# Set after the first deploy assigns a *.run.app URL (chicken-egg — see README).
frontend_url           = ""
admin_operator_members = ["user:m@sunholo.com"]
