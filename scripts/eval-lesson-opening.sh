#!/bin/bash
# Synthetic 1.1.153 checks: real tutor factory, local data, configured model.
set -euo pipefail
cd "$(dirname "$0")/../backend"
export LOCAL_MODE=1
export LOCAL_MODE_PERSIST=0
export AITANA_LOCAL_SESSION=memory
export GOOGLE_CLOUD_PROJECT="${OPENING_EVAL_PROJECT:-aipla-dev-2026}"
export GCP_PROJECT="$GOOGLE_CLOUD_PROJECT"
export GOOGLE_CLOUD_LOCATION=eu
export GOOGLE_GENAI_USE_VERTEXAI=True
uv sync --frozen --dev --extra eval
for variant in default teacher classroom; do
    marker=$(mktemp)
    config=tests/eval/lesson_opening_config.json
    if [ "$variant" = classroom ]; then
        config=tests/eval/lesson_opening_classroom_config.json
    fi
    OPENING_EVAL_VARIANT="$variant" uv run --no-sync adk eval tests/eval/lesson_opening \
        tests/eval/lesson_opening.evalset.json --config_file_path "$config"
    # ADK's CLI currently exits zero even for a failed criterion. Read the
    # freshly-written results so this target really fails on a failed case.
    uv run --no-sync python - "$marker" "$variant" <<'PY'
import json
import sys
from pathlib import Path

marker = Path(sys.argv[1])
results = []
for path in Path("tests/eval/lesson_opening/.adk/eval_history").glob("*.evalset_result.json"):
    if path.stat().st_mtime_ns > marker.stat().st_mtime_ns:
        results.extend(json.loads(path.read_text())["eval_case_results"])
marker.unlink()
if len(results) != 2 or any(case["final_eval_status"] != 1 for case in results):
    print(f"{sys.argv[2]}: expected two passing cases, got {len(results)} results")
    for case in results:
        print(case["eval_id"], case["final_eval_status"], case["overall_eval_metric_results"])
    raise SystemExit(1)
print(f"{sys.argv[2]}: both opening scenarios passed")
PY
done
