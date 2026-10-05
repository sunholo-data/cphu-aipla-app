#!/usr/bin/env bash
# One capability-floor SNAPSHOT: text (runmodel.ail) and figures
# (runmodel_vision.ail), N runs per model, the July method. Writes
#   runs/<SNAP>/text/<label>-r<N>.jsonl      runs/<SNAP>/vision/<label>-r<N>.jsonl
# so each snapshot sits beside the previous one rather than replacing it.
#
#   ./run-snapshot.sh                 # 5 runs, every model below, both tasks
#   ./run-snapshot.sh 1               # 1 run, quick shake-out
#   ONLY=gemini-3.8-flash ./run-snapshot.sh 1
#   TASKS=text ./run-snapshot.sh      # text | vision | "text vision"
#   PAR=4 ./run-snapshot.sh           # models run concurrently (default 4)
#
# The panel is the October 2026 one: the two Gemini models the app actually
# serves (3.5 Flash-Lite = platform default, 3.8 Flash = smart tier) plus the
# July anchor 3.5 Flash, and the open-weight families we might host. Each was
# smoke-tested (benchmark/smoke.ail, 2/2) on 2026-10-05 before this was written.
#
# Gemini runs on Vertex's `eu` multi-region endpoint, as the app has since
# 961e39ea: AILANG reads GOOGLE_CLOUD_LOCATION and otherwise falls back to the
# deprecated `global` default (its own warning says so).
#
# The corpus is never committed (runs/ is gitignored); ./preflight-local.sh
# says what is missing.
set -uo pipefail
cd "$(dirname "$0")"

N="${1:-5}"
SNAP="${SNAP:-stage2-2026-10}"
TASKS="${TASKS:-text vision}"
PAR="${PAR:-4}"
ONLY="${ONLY:-}"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-aipla-dev-2026}"
export GOOGLE_CLOUD_LOCATION="${GOOGLE_CLOUD_LOCATION:-eu}"

[ -s runs/stage0/items.jsonl ] || { echo "runs/stage0/items.jsonl missing — run ./preflight-local.sh"; exit 1; }
[ -s runs/stage0/figures.jsonl ] || { echo "runs/stage0/figures.jsonl missing — figures task needs it"; exit 1; }

# label | --ai id | API name (what runmodel_vision.ail passes to step())
PANEL="
gemini-3.5-flash-lite|gemini-3-5-flash-lite|gemini-3.5-flash-lite
gemini-3.8-flash|gemini-3-8-flash|gemini-3.8-flash
gemini-3.5-flash|gemini-3-5-flash|gemini-3.5-flash
qwen3.7-flash|qwen/qwen3.7-flash|qwen/qwen3.7-flash
qwen3.7-plus|qwen/qwen3.7-plus|qwen/qwen3.7-plus
qwen3.8-27b|qwen/qwen3.8-27b|qwen/qwen3.8-27b
qwen3.6-35b-a3b|qwen/qwen3.6-35b-a3b|qwen/qwen3.6-35b-a3b
qwen3.5-9b|qwen/qwen3.5-9b|qwen/qwen3.5-9b
gemma-4-31b|google/gemma-4-31b-it|google/gemma-4-31b-it
gemma-4-26b-a4b|google/gemma-4-26b-a4b-it|google/gemma-4-26b-a4b-it
deepseek-v4.1-flash|deepseek/deepseek-v4.1-flash|deepseek/deepseek-v4.1-flash
glm-5.3-flash|z-ai/glm-5.3-flash|z-ai/glm-5.3-flash
ministral-8b|mistralai/ministral-8b-2512|mistralai/ministral-8b-2512
"

one_model() { # label ai api
  local label="$1" ai="$2" api="$3" rt=() r f ok tot
  [[ "$ai" == */* ]] && rt=(--allow-routing)
  for task in $TASKS; do
    mkdir -p "runs/$SNAP/$task"
    for r in $(seq 1 "$N"); do
      f="runs/$SNAP/$task/${label}-r${r}.jsonl"
      if [ "$task" = text ]; then
        TRIAL_MODEL="$label" ailang run --ai "$ai" "${rt[@]+"${rt[@]}"}" --caps IO,FS,AI,Env,Clock \
          --entry main benchmark/runmodel.ail 2>>"runs/$SNAP/errors.log" | grep '^{' > "$f"
      else
        TRIAL_MODEL="$api" ailang run --ai "$ai" "${rt[@]+"${rt[@]}"}" --caps IO,FS,AI,Env,Clock \
          --entry main benchmark/runmodel_vision.ail 2>>"runs/$SNAP/errors.log" | grep '^{' > "$f"
      fi
      ok=$(grep -c '"verdict":"correct"' "$f"); tot=$(grep -c '"item_id"' "$f")
      echo "$(date +%H:%M) $task $label r$r: $ok/$tot"
    done
  done
}

mkdir -p "runs/$SNAP"
while IFS='|' read -r label ai api; do
  [ -z "$label" ] && continue
  [ -n "$ONLY" ] && [ "$ONLY" != "$label" ] && continue
  while [ "$(jobs -rp | wc -l)" -ge "$PAR" ]; do sleep 5; done
  one_model "$label" "$ai" "$api" &
done <<< "$PANEL"
wait
echo "DONE $SNAP"
