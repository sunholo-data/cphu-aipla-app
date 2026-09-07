#!/usr/bin/env bash
# Pre-flight for a local-GPU benchmark run. Checks every precondition and names
# exactly what is missing. Costs nothing and calls no model.
#
# Exit 0 = `./run-local-gpu.sh` will work. Non-zero = the list below says why not.
set -uo pipefail
cd "$(dirname "$0")"

CFG=bench-config.json
FAIL=0
ok()   { printf '  \033[32mok  \033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mMISS\033[0m %s\n' "$1"; FAIL=1; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$1"; }

echo "== toolchain =="
if command -v ailang >/dev/null 2>&1; then
  ok "$(ailang --version 2>/dev/null | head -1)"
else
  bad "ailang not on PATH (go install, or add ~/go/bin)"
fi

if curl -sS -m 5 "${OLLAMA_HOST:-http://localhost:11434}/api/tags" >/dev/null 2>&1; then
  ok "ollama reachable at ${OLLAMA_HOST:-http://localhost:11434}"
else
  bad "ollama not reachable at ${OLLAMA_HOST:-http://localhost:11434} — start it with \`ollama serve\`"
fi

echo "== harness =="
if ailang check benchmark/runmodel_local.ail >/dev/null 2>&1; then
  ok "runmodel_local.ail type-checks"
else
  bad "runmodel_local.ail does not type-check against this AILANG (API drift — run: ailang check benchmark/runmodel_local.ail)"
fi
if ailang run --caps IO --entry main benchmark/selftest.ail 2>/dev/null | grep -q "RESULT: PASS"; then
  ok "grader self-test 9/9"
else
  bad "grader self-test FAILED — do not trust any score until this passes"
fi

echo "== corpus (Proevebanken — university-controlled, never committed) =="
ITEMS=runs/stage0/items.jsonl
if [ -f "$ITEMS" ]; then
  n=$(grep -c '"runnable":true' "$ITEMS" 2>/dev/null || echo 0)
  q=$(grep -c '"question_text"' "$ITEMS" 2>/dev/null || echo 0)
  ok "$ITEMS present ($(wc -l < "$ITEMS" | tr -d ' ') rows, $n runnable)"
  if [ "$q" -eq 0 ]; then
    bad "no question_text in items.jsonl — the runner would send empty questions. Build it with benchmark/extract_questions.ail + items.ail"
  else
    ok "question_text present on $q rows"
  fi
else
  bad "$ITEMS — THE ONE FILE THE RUNNER NEEDS. Bring it from the machine that built it, or rebuild (see 'rebuilding' below)"
fi
[ -f runs/stage0/recovered.jsonl ] \
  && ok "recovered.jsonl present (human-curated key overrides)" \
  || warn "runs/stage0/recovered.jsonl absent — optional; without it the needs-review items stay excluded"

echo "== local models =="
have=$(curl -sS -m 5 "${OLLAMA_HOST:-http://localhost:11434}/api/tags" 2>/dev/null \
       | python3 -c "import json,sys;print(' '.join(m['name'] for m in json.load(sys.stdin).get('models',[])))" 2>/dev/null)
python3 - "$CFG" <<'PY' > /tmp/.stxlocal_panel 2>/dev/null || true
import json,sys
c=json.load(open(sys.argv[1]))
for m in c.get("local_gpu_panel",[]):
    if m.get("enabled"): print(m["id"])
PY
if [ ! -s /tmp/.stxlocal_panel ]; then
  bad "no enabled entries in bench-config.json .local_gpu_panel"
else
  while read -r id; do
    [ -z "$id" ] && continue
    if echo " $have " | grep -q " $id "; then ok "model pulled: $id"
    else bad "model NOT pulled: $id  ->  ollama pull $id"; fi
  done < /tmp/.stxlocal_panel
fi

echo "== GPU contention =="
# Accuracy survives contention; THROUGHPUT DOES NOT, and a shared 45GB model gets
# evicted and reloaded between calls by clients with different keep_alive values.
# So this warns rather than fails: the scores stay valid, the timings do not.
others=$(ps ax -o pid=,command= 2>/dev/null \
  | grep -iE "opencode|world-ollama-gauge|llama-server|mlx-engine|lm-?studio|vllm" \
  | grep -v grep | grep -v preflight-local || true)
if [ -n "$others" ]; then
  warn "other GPU/model clients are running — scores stay valid, timings do NOT:"
  echo "$others" | sed 's/^/         /' | cut -c1-118
else
  ok "no competing model clients detected"
fi
if ollama ps 2>/dev/null | grep -q "Stopping"; then
  warn "a model is mid-eviction ('Stopping...') — expect 45GB reloads between calls. Quiesce other clients for a timing-sensitive run."
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "PREFLIGHT PASS — ./run-local-gpu.sh is ready."
else
  cat <<'EOF'
PREFLIGHT FAIL — see MISS lines above.

Rebuilding items.jsonl from the raw corpus (only if you brought sources, not items.jsonl):
  export STX_SOURCE_DIR=/path/to/aswin-july     # holds answer-keys/ + stx-exam-catalogue.yaml
  ailang run --caps IO,FS,Env      --entry main benchmark/stage0.ail
  ailang run --caps IO,FS,AI,Env   --entry main benchmark/extract_questions.ail
  ailang run --caps IO,FS,Env      --entry main benchmark/items.ail
EOF
fi
exit "$FAIL"
