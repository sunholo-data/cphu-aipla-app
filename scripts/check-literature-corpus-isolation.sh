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
# The design is that a STUDENT session cannot reach it. Two things hold that up,
# and this guard checks both:
#
#   1. db/literature_corpus.py exposes no tool builder, so there is nothing an
#      agent can simply be handed.
#   2. Any code on the agent path that reads the corpus enforces the researcher
#      gate itself.
#
# ⚠️ This checked (1) plus a blunt "nothing under backend/adk may import it"
# rule until 2026-09-11, when the tutor co-pilot (1.1.91 M2) arrived: its
# propose-tools live in backend/adk because that is where TOOL_REGISTRY reaches
# them, they are researcher-gated server-side, and they are mounted from a
# role:researcher skill. The path rule called that a violation. The invariant
# was never about WHERE the code lives, so the check now asserts the thing that
# matters instead — which is also stricter, because it would catch an
# ungated reader the path rule happened to miss.
#
# The failure it prevents is quiet: an import added in good faith, a tutor that
# starts quoting Dysthe at a 16-year-old, and copyrighted text leaving the
# tenancy through a chat window.
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

# Every agent-path file that reads the literature corpus.
readers=()
for path in "${AGENT_PATHS[@]}"; do
  [[ -e "$path" ]] || continue
  while IFS= read -r f; do
    readers+=("$f")
  done < <(grep -rl --include='*.py' "$MODULE" "$path" 2>/dev/null || true)
done

# A reader is permitted ONLY if it enforces the researcher gate itself.
#
# The path rule this replaced was a proxy, and the proxy went wrong the first
# time it met a legitimate case: the tutor co-pilot's propose-tools live in
# backend/adk because that is where TOOL_REGISTRY can reach them, and they are
# researcher-gated server-side and mounted from a role:researcher skill. The
# invariant that actually matters is not WHERE the code lives — it is that a
# student can never reach the copyrighted text. So assert that.
for f in "${readers[@]}"; do
  if grep -qE '_caller_is_researcher|assert_researcher|role:researcher' "$f"; then
    echo "  allowed: $f (reads the corpus, enforces the researcher gate)"
  else
    echo "REACHABLE FROM A STUDENT TURN:"
    echo "  $f reads $MODULE and does NOT enforce a researcher gate."
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

echo "OK: the literature corpus is read only where the researcher gate is enforced."
