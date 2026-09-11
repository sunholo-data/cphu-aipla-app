#!/usr/bin/env bash
# The pedagogy-literature corpus must never be reachable from a student turn.
#
# WHY (1.1.110, 2026-09-11)
#
# AIPLA has two RAG corpora and they have opposite audiences:
#
#   curriculum  — classroom materials. REACHABLE from a student session, scoped
#                 per activity by build_curriculum_retrieval_tool. Cited to the
#                 student by name, on purpose.
#   literature  — copyrighted journal papers the teaching frameworks are drafted
#                 from. Read by RESEARCHERS while authoring, so a citation can
#                 show its passage instead of asking to be trusted.
#
# Grounding a tutor in the literature would also destroy the property the
# framework layer exists for: retrieval makes the prompt differ turn to turn, so
# "hold the prompt against the paper and check it" stops being possible.
#
# The design is that a student session CANNOT reach it — there is no tool
# builder in db/literature_corpus.py, so there is nothing for an agent to be
# handed. This guard keeps that true. The failure it prevents is quiet: an
# import added in good faith, a tutor that starts quoting Dysthe at a
# 16-year-old, and copyrighted text leaving the tenancy through a chat window.
#
# Run: make check-literature-isolation
set -euo pipefail

cd "$(dirname "$0")/.."

MODULE="literature_corpus"

# Everything that runs on, or builds, a student/agent turn.
AGENT_PATHS=(
  "backend/adk"
  "backend/protocols/agui.py"
  "backend/protocols/mcp_server.py"
  "backend/protocols/mcp_proxy.py"
  "backend/tools"
  "backend/channels"
  "backend/app.py"
)

fail=0
for path in "${AGENT_PATHS[@]}"; do
  [[ -e "$path" ]] || continue
  if hits=$(grep -rn "$MODULE" "$path" 2>/dev/null); then
    echo "REACHABLE FROM THE AGENT PATH:"
    echo "$hits" | sed 's/^/  /'
    fail=1
  fi
done

# A tool builder in the module itself would make the import test moot: anything
# returning an ADK tool can be handed to an agent by a caller this guard does
# not know about.
if grep -nE "VertexAiRagRetrieval|FunctionTool|BaseTool" backend/db/literature_corpus.py >/dev/null 2>&1; then
  echo "db/literature_corpus.py builds an agent TOOL. It must expose only plain"
  echo "async queries — a tool is a thing that can be handed to a student session."
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  cat <<'MSG'

The literature corpus is for AUTHORING surfaces only (researcher editors, the
tutor co-pilot). If a tutor genuinely needs grounded source material, that is
the CURRICULUM corpus and the activity's cited materials — a different corpus,
with a different audience and no copyright question.
MSG
  exit 1
fi

echo "OK: the literature corpus is not reachable from any student/agent path."
