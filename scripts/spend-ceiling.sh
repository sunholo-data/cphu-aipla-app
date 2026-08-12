#!/usr/bin/env bash
# Ring 0 of ACCESS-1 — apply AND verify the Vertex daily input-token ceiling.
#
# Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md
#
# This is the control that actually STOPS spend. The billing budget in
# infrastructure/env/spend_ceiling.tf only tells you it happened.
#
# WHY A SCRIPT AND NOT TERRAFORM
#   `google_service_usage_consumer_quota_override` does not exist in the google
#   or google-beta provider at the pinned 6.50.0 (verified 2026-08-12 against
#   both provider binaries). Bumping the provider for every resource in
#   infrastructure/env/ to obtain one resource is a worse trade than a script.
#
# WHY IT READS BACK
#   A quota override whose base_model dimension does not match a real model
#   applies to NOTHING and still exits 0. That is the repo's documented
#   "reports success having done nothing" footgun (CLAUDE.md), which cost the
#   prod data plane on 2026-08-03. So --verify is the default half of the job:
#   this script is not finished until it has read the DEPLOYED value back.
#
# Usage:
#   scripts/spend-ceiling.sh <dev|test|prod>            # verify only (default)
#   scripts/spend-ceiling.sh <dev|test|prod> --apply    # apply, then verify
#   scripts/spend-ceiling.sh <dev|test|prod> --apply --ceiling 25000000
set -euo pipefail

ENV="${1:-}"
shift || true

APPLY=0
# Per base model, per day.
#
# WHAT 50M COSTS, so the number is a decision and not a vibe (rates from
# backend/observability/llm_metrics.py, USD per 1M input tokens):
#   gemini-3.5-flash-lite  $0.30  ->  50M/day =  $15/day
#   gemini-3.6-flash       $1.50  ->  50M/day =  $75/day
# Both models saturated is ~$90/day, ~$2,700/month, INPUT ONLY — this metric
# does not cap output tokens, which bill 8-5x higher per token.
#
# HOW MUCH HEADROOM THAT REALLY IS (corrected 2026-08-12; the first version of
# this comment said "~100x" and was wrong by an order of magnitude):
# one 30-student class at ~20 turns each and ~5-10k input tokens per turn
# (system prompt + history + RAG chunks) is ~3-6M input tokens/day. So 50M is
# roughly 8-15 busy classes on one model — real headroom for the pilot, but NOT
# so much that it could never be reached. Revisit once `class_spend` has a
# month of real data.
#
# It exists to bound abuse and runaway loops, not to shape normal use — if this
# fires during ordinary teaching, raise it rather than leaving lessons broken.
CEILING="${AIPLA_DAILY_TOKEN_CEILING:-50000000}"

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
  *) echo "usage: $0 <dev|test|prod> [--apply] [--ceiling N]" >&2; exit 2 ;;
esac

SERVICE="aiplatform.googleapis.com"
METRIC="aiplatform.googleapis.com/global_generate_content_input_tokens_per_minute_per_base_model"
# The DAILY limit on that metric, not the per-minute one. A per-minute cap
# throttles a spike but still allows unbounded spend across a day, which is the
# actual shape of the risk (one leaked join code, many patient sessions).
UNIT="1/d/{project}/{base_model}"

# The Google base models this app can reach, from backend/config/models.yaml.
# Anthropic/OpenAI are bounded by their own per-key limits and are not on the
# student path. A model added to models.yaml and NOT added here is unlimited —
# the verify step below reports which models are covered so that stays visible.
BASE_MODELS=(
  "gemini-3.5-flash-lite"
  "gemini-3.6-flash"
)

echo "=== AIPLA spend ceiling — ${ENV} (${PROJECT}) ==="
echo "metric:  ${METRIC}"
echo "unit:    ${UNIT}"
echo "ceiling: ${CEILING} input tokens / day / base model"
echo

if [[ "$APPLY" == "1" ]]; then
  for BM in "${BASE_MODELS[@]}"; do
    echo "--- applying override: base_model=${BM} ---"
    # `quota update` is idempotent: re-running with the same value is a no-op
    # that still exits 0, so this is safe to re-run after every model change.
    gcloud alpha services quota update \
      --service="${SERVICE}" \
      --consumer="projects/${PROJECT}" \
      --metric="${METRIC}" \
      --unit="${UNIT}" \
      --dimensions="base_model=${BM}" \
      --value="${CEILING}" \
      --force \
      --project="${PROJECT}" 2>&1 | sed 's/^/    /' || {
        echo "    APPLY FAILED for ${BM}" >&2
        echo "    Most likely cause: the caller lacks roles/serviceusage.serviceUsageAdmin" >&2
        echo "    on ${PROJECT}, or base_model=${BM} is not a real dimension." >&2
        exit 1
      }
  done
  echo
fi

# --- Verify: read the DEPLOYED quota back ------------------------------------
echo "--- verifying deployed overrides ---"
QUOTA_JSON="$(gcloud alpha services quota list \
  --service="${SERVICE}" \
  --consumer="projects/${PROJECT}" \
  --format=json 2>/dev/null)" || {
    echo "FAIL: could not read quotas for ${PROJECT}" >&2
    exit 1
  }

MISSING=0
for BM in "${BASE_MODELS[@]}"; do
  FOUND="$(printf '%s' "$QUOTA_JSON" | python3 -c "
import json, sys
metric = '${METRIC}'
unit   = '${UNIT}'
bm     = '${BM}'
data = json.load(sys.stdin)
for m in data:
    if m.get('metric') != metric:
        continue
    for lim in m.get('consumerQuotaLimits', []):
        if lim.get('unit') != unit:
            continue
        for bucket in lim.get('quotaBuckets', []):
            if (bucket.get('dimensions') or {}).get('base_model') != bm:
                continue
            # effectiveLimit is what the API will actually enforce. A present
            # override with no effectiveLimit is exactly the silent-no-op case.
            eff = bucket.get('effectiveLimit')
            ovr = bucket.get('consumerOverride', {}).get('overrideValue')
            print(f'{eff}|{ovr}')
            sys.exit(0)
print('|')
" 2>/dev/null)" || FOUND="|"

  EFF="${FOUND%%|*}"
  OVR="${FOUND##*|}"

  if [[ -z "$OVR" || "$OVR" == "None" ]]; then
    echo "  MISSING  base_model=${BM} — no consumer override deployed (effectiveLimit=${EFF:-none})"
    MISSING=1
  elif [[ "$OVR" != "$CEILING" ]]; then
    echo "  DRIFT    base_model=${BM} — deployed override=${OVR}, expected ${CEILING}"
    MISSING=1
  else
    echo "  OK       base_model=${BM} — override=${OVR}, effectiveLimit=${EFF}"
  fi
done

echo
if [[ "$MISSING" == "1" ]]; then
  if [[ "$APPLY" == "1" ]]; then
    echo "FAIL: applied, but the read-back does not agree. This is the" >&2
    echo "      'reports success having done nothing' case — do NOT treat the" >&2
    echo "      ceiling as in place." >&2
  else
    echo "FAIL: the ceiling is not in place on ${ENV}." >&2
    echo "      Run: $0 ${ENV} --apply" >&2
  fi
  exit 1
fi

echo "OK: Vertex daily token ceiling verified on ${ENV} for ${#BASE_MODELS[@]} base model(s)."
