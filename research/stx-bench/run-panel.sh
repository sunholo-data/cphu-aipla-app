#!/usr/bin/env bash
# Sweep the enabled bench-config panel over runmodel.ail — one `ailang run --ai <id>`
# per model (provider auto-inferred), aggregate stdout into results.jsonl, then report.
#
# Budget, two layers:
#   - runner-side per-model TOKEN cap (BUDGET_TOKENS) -> the spend halt (all providers)
#   - --routing-max-price (OpenRouter only) -> per-token RATE ceiling on provider choice
#
# Prereqs: runs/stage0/items.jsonl must carry `question_text` (from extract_questions.ail
# + the items.ail join). Do NOT spend before question_text is joined + reviewed.
#
# Usage: ./run-panel.sh
set -eo pipefail
cd "$(dirname "$0")"

CFG=bench-config.json
OUT=runs/stage2/results.jsonl
mkdir -p runs/stage2
: > "$OUT"

MAXPRICE=$(python3 -c "import json;print(json.load(open('$CFG'))['budget'].get('openrouter_max_price_per_mtok_usd',2.0))")

python3 -c "
import json
c=json.load(open('$CFG')); b=c['budget']
d=b['per_model_token_cap_default']; ov=b.get('per_model_token_cap_overrides',{})
for m in c['panel']:
    if m.get('enabled'): print(m['id']+'\t'+str(ov.get(m['id'],d)))
" | while IFS=$'\t' read -r id cap; do
  [ -z "$id" ] && continue
  echo ">> $id  (budget ${cap} tok)"
  RT=()
  if [[ "$id" == */* ]]; then
    RT=(--routing-max-price "$MAXPRICE" --allow-routing)   # OpenRouter: rate ceiling
  fi
  TRIAL_MODEL="$id" BUDGET_TOKENS="$cap" \
    ailang run --ai "$id" ${RT[@]+"${RT[@]}"} --caps IO,FS,AI,Env --entry main benchmark/runmodel.ail 2>/dev/null \
    | grep '^{' >> "$OUT" || true
done

echo "=== $(grep -c . "$OUT") result rows -> report ==="
ailang run --caps IO,FS --entry main benchmark/matrix.ail
