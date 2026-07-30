# dev is the imperative REFERENCE env (scripts/bootstrap-aipla-dev.sh). These
# tfvars exist so a `terraform plan` against dev can be diffed for parity —
# NOT to take over dev's management. Do not `apply` against dev unless the
# parity story is deliberately agreed (it would import/adopt live resources).
project_id                = "aipla-dev-2026"
env                       = "dev"
partition_expiration_days = 30
teacher_mock              = true
frontend_url              = "https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app"
admin_operator_members    = ["user:m@sunholo.com"]
email_signin_enabled      = true # dev has the test-teacher@example.dk email account
