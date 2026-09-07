#!/usr/bin/env bash
# Run the current-gen open VL models on the 33-item TEXT panel (runmodel.ail),
# to test whether one VL model can cover BOTH text and figures per self-host tier.
set -u; cd "$(dirname "$0")"; N="${1:-5}"
one() { local api="$1" label="$2"
  for r in $(seq 1 "$N"); do
    TRIAL_MODEL="$label" ailang run --ai "$api" --caps IO,FS,AI,Env,Clock \
      --entry main benchmark/runmodel.ail 2>/dev/null \
      | grep '^{' > "runs/stage2vltext/${label}-r${r}.jsonl"
    local c i; c=$(grep -c '"verdict":"correct"' "runs/stage2vltext/${label}-r${r}.jsonl")
    i=$(grep -c '"verdict":"incorrect"' "runs/stage2vltext/${label}-r${r}.jsonl")
    echo "${label} run ${r}: ${c}/$((c+i)) solved"
  done
}
one qwen/qwen3-vl-235b-a22b-instruct qwen3-vl-235b
one qwen/qwen3-vl-32b-instruct       qwen3-vl-32b
one qwen/qwen3-vl-8b-instruct        qwen3-vl-8b
echo "DONE vltext"
