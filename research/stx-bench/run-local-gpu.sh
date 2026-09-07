#!/usr/bin/env bash
# THE ONE COMMAND. Runs the enabled .local_gpu_panel over the exam corpus on the
# local GPU, N runs per model, then prints the report.
#
#   ./run-local-gpu.sh          # 5 runs per model (matches the July method)
#   ./run-local-gpu.sh 1        # 1 run, for a quick shake-out
#
# Refuses to start unless ./preflight-local.sh passes, so a missing corpus or an
# unpulled model is a clear message rather than a half-finished results file.
set -uo pipefail
cd "$(dirname "$0")"

N="${1:-5}"
CFG=bench-config.json
RAW=runs/stage2local
AGG=runs/stage2/results.jsonl

./preflight-local.sh || { echo; echo "Aborting: pre-flight failed."; exit 1; }
echo

mkdir -p "$RAW" runs/stage2
if [ -s "$AGG" ]; then
  ts=$(date +%Y%m%d-%H%M%S)
  mv "$AGG" "runs/stage2/results.pre-local-$ts.jsonl"
  echo "NOTE: existing $AGG held a previous (probably cloud) run — moved to results.pre-local-$ts.jsonl rather than clobbered."
fi
: > "$AGG"

python3 - "$CFG" <<'PY' > /tmp/.stxlocal_run
import json,sys
c=json.load(open(sys.argv[1]))
for m in c.get("local_gpu_panel",[]):
    if m.get("enabled"): print(m["id"]+"\t"+m.get("label",m["id"]))
PY

# Keep the weights resident. A 45GB reload between calls dominates runtime — but
# OLLAMA_KEEP_ALIVE is read by `ollama serve`, NOT by the client, so exporting it
# here would do nothing against a server we did not start. Pin each panel model
# with an explicit keep_alive request instead, which any client may do.
KEEP="${STX_KEEP_ALIVE:-30m}"
while IFS=$'\t' read -r pid _; do
  [ -z "${pid:-}" ] && continue
  curl -sS -m 30 "${OLLAMA_HOST:-http://localhost:11434}/api/generate" \
    -H 'Content-Type: application/json' \
    --data-binary "$(python3 -c 'import json,sys;print(json.dumps({"model":sys.argv[1],"keep_alive":sys.argv[2]}))' "$pid" "$KEEP")" \
    >/dev/null 2>&1 || true
done < /tmp/.stxlocal_run
echo "keep_alive=$KEEP  runs-per-model=$N"
echo

while IFS=$'\t' read -r id label; do
  [ -z "${id:-}" ] && continue
  for r in $(seq 1 "$N"); do
    out="$RAW/${label}-r${r}.jsonl"
    printf '%s run %s/%s ... ' "$label" "$r" "$N"
    TRIAL_MODEL="$label" ailang run --ai "ollama/$id" \
      --caps IO,FS,AI,Env,Clock --entry main benchmark/runmodel_local.ail 2>/dev/null \
      | grep '^{' > "$out"
    c=$(grep -c '"verdict":"correct"'   "$out" 2>/dev/null)
    i=$(grep -c '"verdict":"incorrect"' "$out" 2>/dev/null)
    a=$(grep -c '"verdict":"ambiguous"' "$out" 2>/dev/null)
    e=$(grep -c '"verdict":"error"'     "$out" 2>/dev/null)
    d=$((c+i+a))
    if [ "$d" -gt 0 ]; then printf 'graded %s/%s correct (ambiguous %s, error %s)\n' "$c" "$d" "$a" "$e"
    else printf 'NO GRADED ITEMS (error %s) — check the model id and the corpus\n' "$e"; fi
    cat "$out" >> "$AGG"
  done
done < /tmp/.stxlocal_run

echo
echo "raw per-run files : $RAW/"
echo "aggregated        : $AGG  ($(wc -l < "$AGG" | tr -d ' ') rows)"
echo
echo "== report =="
ailang run --caps IO,FS --entry main benchmark/matrix.ail 2>/dev/null || {
  echo "matrix.ail did not run; try: ailang run --caps IO,FS --entry main benchmark/score.ail"; }
cat <<'EOF'

REMINDER — these are DETERMINISTIC-ONLY verdicts (no LLM judge; AILANG's
callJsonResult is empty on Ollama, see runmodel_local.ail header). They are a
LOWER BOUND and are not directly comparable to the July cloud column.
EOF
