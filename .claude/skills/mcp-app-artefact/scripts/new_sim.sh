#!/usr/bin/env bash
# new_sim.sh — scaffold BOTH halves of a sim.
#
# A sim is two files and neither works alone: the artefact is unreachable
# without a catalogue entry, and the catalogue entry 404s without the artefact.
# Scaffolding them separately is how one gets forgotten, so this does both.
#
#   infrastructure/mcp-sandbox/artefacts/<id>/v1/index.html   (from _template)
#   backend/artefacts/<id>.yaml                               (stub, TODOs marked)
#
# Usage:
#   new_sim.sh <id> "<Display title>" [--description "..."] [--level B --level C]
#
# <id> must be kebab-case: it is the directory name, the catalogue id, the
# `serverId` on the iframe-context wire, and the prefix on every event kind.
# Those four have to agree, which is why the script derives them all from one
# argument rather than letting you type it four times.

set -euo pipefail

# Resolve the repo root from THIS script's location, not the working directory,
# so the skill works from anywhere — and fails with a named error rather than
# half-running when it is invoked outside a checkout (e.g. a hosted sandbox).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../../.." && pwd)"

for required in \
    "$REPO_ROOT/scripts/new-artefact.sh" \
    "$REPO_ROOT/infrastructure/mcp-sandbox/artefacts/_template/v1/index.html" \
    "$REPO_ROOT/backend/artefacts"
do
    if [ ! -e "$required" ]; then
        echo "Error: this script needs the AIPLA repo." >&2
        echo "       Expected to find: $required" >&2
        echo "       Resolved repo root: $REPO_ROOT" >&2
        exit 2
    fi
done

usage() {
    cat <<'USAGE'
Usage: new_sim.sh <id> "<Display title>" [options]

  <id>              kebab-case, e.g. pendul, kettle-efficiency
  <Display title>   what a teacher and a student see, e.g. "Pendul — svingningstid"

Options:
  --description "…"   one teacher-facing sentence for the picker card
  --level A|B|C       stx level; repeat for several (default: B and C)
  --language da|en    the sim's default language (default: da)

Creates:
  infrastructure/mcp-sandbox/artefacts/<id>/v1/index.html
  backend/artefacts/<id>.yaml
USAGE
}

if [ "$#" -lt 2 ]; then usage; exit 1; fi

ID="$1"; shift
TITLE="$1"; shift

DESCRIPTION=""
LANGUAGE="da"
LEVELS=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --description) DESCRIPTION="${2:-}"; shift 2 ;;
        --level)       LEVELS+=("${2:-}");   shift 2 ;;
        --language)    LANGUAGE="${2:-}";    shift 2 ;;
        -h|--help)     usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
done

[ "${#LEVELS[@]}" -gt 0 ] || LEVELS=(B C)

# The model validates this with the same pattern (ArtefactMeta.id). Catching it
# here beats a pydantic error after you have written the sim.
if ! printf '%s' "$ID" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$'; then
    echo "Error: '<id>' must be kebab-case (lower-case letters, digits, single hyphens)." >&2
    echo "       Got: $ID" >&2
    exit 1
fi

ARTEFACT_DIR="$REPO_ROOT/infrastructure/mcp-sandbox/artefacts/$ID"
CATALOGUE="$REPO_ROOT/backend/artefacts/$ID.yaml"

if [ -e "$ARTEFACT_DIR" ]; then
    echo "Error: $ARTEFACT_DIR already exists. Pick another id, or edit it in place." >&2
    exit 1
fi
if [ -e "$CATALOGUE" ]; then
    echo "Error: $CATALOGUE already exists." >&2
    exit 1
fi

# --- 1. the artefact --------------------------------------------------------
( cd "$REPO_ROOT" && ./scripts/new-artefact.sh "$ID" "$TITLE" ) >/dev/null

# --- 2. the catalogue entry -------------------------------------------------
{
    printf 'id: %s\n' "$ID"
    printf 'version: v1\n'
    printf 'displayName: "%s"\n' "$TITLE"
    if [ -n "$DESCRIPTION" ]; then
        printf 'description: "%s"\n' "$DESCRIPTION"
    else
        printf 'description: "TODO — one teacher-facing sentence: what does the student DO?"\n'
    fi
    printf 'topics:\n'
    printf '  - TODO\n'
    printf 'levels:\n'
    for lvl in "${LEVELS[@]}"; do printf '  - %s\n' "$lvl"; done
    printf '# The sim'"'"'s default and fallback language. It should still carry both in one\n'
    printf '# `strings` object and take its initial language from the host bridge.\n'
    printf 'language: %s\n' "$LANGUAGE"
    printf '# minViewportPx: 720   # set ONLY if verify_sim.mjs shows it does not fit 390px.\n'
    printf '#                      # Unset means "works everywhere" and must be true.\n'
    printf 'eventVocabulary:\n'
    printf '  - open\n'
    printf '  - run          # a verb from the proactive vocabulary, or no tutor turn fires\n'
    printf '  - reading\n'
    printf '  - reset\n'
    printf '  - state-change\n'
    printf 'tutorBlock: |\n'
    printf '  TODO. Server-side only — never serialised to the browser. Three parts:\n'
    printf '\n'
    printf '  1. What the sim is and what the student can control.\n'
    printf '  2. What each event means, so the tutor knows what a `reading` is worth\n'
    printf '     asking about.\n'
    printf '  3. REFERENCE, FOR CHECKING ONLY — NEVER STATE THESE VALUES: the constants\n'
    printf '     the tutor needs to mark an answer that the student must not be handed.\n'
    printf '\n'
    printf '  Write it in English describing what the TUTOR does; the language the tutor\n'
    printf '  speaks comes from activity.language, not from here.\n'
    printf '# `live` puts it in the teacher'"'"'s picker. `beta` deploys but stays invisible.\n'
    printf 'status: live\n'
} > "$CATALOGUE"

cat <<EOF

Scaffolded '$ID':

  $ARTEFACT_DIR/v1/index.html
  $CATALOGUE

Next:
  1. Write the sim.       resources/artefact-anatomy.md + resources/visual-standard.md
  2. Fill the TODOs.      resources/catalogue-entry.md
  3. Verify.
       .claude/skills/mcp-app-artefact/scripts/audit_artefact.sh \\
           infrastructure/mcp-sandbox/artefacts/$ID/v1
       make sim-build-check
       node .claude/skills/mcp-app-artefact/scripts/verify_sim.mjs $ID --drive
  4. Commit BOTH files together — the HTML rides the sandbox build, the YAML
     rides the backend build, and a sim needs both to appear.

Do NOT write a React frame, a snapshot hook, a chat-page branch or a SKILL.md
for this sim. GenericArtefactFrame mounts it from the catalogue entry alone.
EOF
