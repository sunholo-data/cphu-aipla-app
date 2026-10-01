#!/usr/bin/env bash
# The platform-wide spend ceiling — apply AND verify it.
#
# WHAT THIS IS NOW (2026-10-01)
#   The programme daily budget (db/programme_budget.py) in BLOCK mode: one
#   USD/day number across every class, metered by budget/firestore_enforcer.py.
#   When today's metered spend reaches it, every tutor turn is refused with
#   reason `programme_daily` until UTC midnight.
#
# WHAT IT USED TO BE, AND WHY IT CHANGED
#   Until 2026-10-01 this script set a Vertex consumer-quota override
#   (`global_generate_content_input_tokens_per_minute_per_base_model`, daily
#   unit, 50M tokens/model) — a ceiling the app itself could not lift. That
#   quota exists ONLY for the `global` endpoint. Gemini now runs on Vertex's
#   `eu` multi-region endpoint so inference stays in the EU (KU data-protection
#   review), and `eu` has no daily quota at all, nor any Gemini 3.x entry in the
#   per-minute regional quota. The old override is still deployed but meters
#   nothing; reading it back would report a ceiling that does not bind, which is
#   exactly the "reports success having done nothing" footgun (CLAUDE.md). The
#   old script is in git history (before 2026-10-01).
#
#   What is lost: the app CAN now lift its own ceiling (a programme admin can
#   change the budget in-product, capped by PROGRAMME_MAX_DAILY_BUDGET_USD).
#   The per-teacher monthly caps and the billing-budget alerts are unchanged.
#
# KNOWN GAP
#   The programme meter counts what the ADK agent loop records. Direct
#   `genai.Client` calls (analytics, extraction, compaction) are GATED by
#   budget/spend_guard.py but do not record realised cost, so they are not in
#   the daily total. The student-facing runaway (a leaked join code) is in the
#   agent loop, which is metered.
#
# WHY IT READS BACK
#   A write that silently did nothing must not read as a ceiling in place.
#
# Usage:
#   scripts/spend-ceiling.sh <dev|test|prod>                 # verify only (default)
#   scripts/spend-ceiling.sh <dev|test|prod> --apply         # apply, then verify
#   scripts/spend-ceiling.sh <dev|test|prod> --apply --ceiling 75
set -euo pipefail

ENV="${1:-}"
shift || true

APPLY=0
# USD per UTC day, whole programme. Prod's metered peak over 15–30 Sep 2026 was
# ~$0.02/day, so $50 is ~2,500x real pilot use: it exists to stop a runaway, not
# to shape teaching. For scale, the old Vertex quota allowed ~$90/day of INPUT
# tokens alone. If this ever fires during ordinary teaching, raise it.
CEILING="${AIPLA_DAILY_USD_CEILING:-50}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)   APPLY=1; shift ;;
    --ceiling) CEILING="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$ENV" in
  dev)  PROJECT="aipla-dev-2026" ;;
  test) PROJECT="aipla-test-2026" ;;
  prod) PROJECT="aipla-prod-2026" ;;
  *) echo "usage: $0 <dev|test|prod> [--apply] [--ceiling USD]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== AIPLA spend ceiling — ${ENV} (${PROJECT}) ==="
echo "control:  programme daily budget, action=block"
echo "ceiling:  \$${CEILING} / UTC day, all classes"
echo

GOOGLE_CLOUD_PROJECT="$PROJECT" CEILING="$CEILING" APPLY="$APPLY" \
  uv run --directory "$ROOT/backend" python - <<'PY'
import os
import sys

from db.programme_budget import ACTION_BLOCK, get_programme_budget, set_programme_budget

ceiling = float(os.environ["CEILING"])

if os.environ["APPLY"] == "1":
    set_programme_budget(daily_budget_usd=ceiling, action=ACTION_BLOCK, updated_by="scripts/spend-ceiling.sh")
    print(f"applied: ${ceiling:.2f}/day, block")

# Read back what is DEPLOYED. get_programme_budget() also returns None on a
# read failure — that must fail here, never pass as "no budget, fine".
budget = get_programme_budget()
if budget is None:
    print("FAIL: no programme budget readable — the platform has NO daily ceiling.", file=sys.stderr)
    print("      Run: make spend-ceiling ENV=<env> APPLY=1", file=sys.stderr)
    sys.exit(1)
if not budget.blocks:
    print(f"FAIL: budget is ${budget.daily_budget_usd:.2f}/day but action={budget.action} — it warns, it does not stop spend.", file=sys.stderr)
    sys.exit(1)
if abs(budget.daily_budget_usd - ceiling) > 1e-9:
    print(f"DRIFT: deployed ${budget.daily_budget_usd:.2f}/day, expected ${ceiling:.2f}/day "
          f"(last set by {budget.updated_by or '?'} at {budget.updated_at or '?'}).", file=sys.stderr)
    sys.exit(1)
print(f"OK: ${budget.daily_budget_usd:.2f}/day, block (set by {budget.updated_by or '?'} at {budget.updated_at})")
PY
