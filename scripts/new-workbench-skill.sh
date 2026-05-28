#!/bin/bash
# AIPLA — scaffold the React HOST side of a workbench skill (the triad
# + shared snapshot hook), in the proven split-by-default shape.
#
# Companion to scripts/new-artefact.sh (which scaffolds the iframe
# HTML). This one scaffolds the part that kept getting hand-built and
# hand-broken: the React host triad (Button + Workbench + Frame) plus
# the use<Name>Snapshot hook. Everything starts pre-split — the iframe
# is sim-only; quiz/graph/pickers/notes live in the workbench — so a
# port can't accidentally re-create the cramped multi-role iframe.
#
# Usage:
#   ./scripts/new-workbench-skill.sh <name> [title]
#
# Examples:
#   ./scripts/new-workbench-skill.sh wave-superposition "Wave superposition"
#
# Creates (with __NAME__/__PASCAL__/__TITLE__ substituted):
#   frontend/src/hooks/use<Pascal>Snapshot.ts
#   frontend/src/components/workspace/<Pascal>Frame.tsx
#   frontend/src/components/workspace/<Pascal>LabButton.tsx
#   frontend/src/components/workspace/<Pascal>Workbench.tsx
# and prints the chat-page wiring snippet to paste.
#
# After scaffolding:
#   1. Scaffold the iframe HTML: ./scripts/new-artefact.sh <name> "<title>"
#      Keep it SIM-ONLY (one simulation; no quiz/graph tabs).
#   2. Fill the TODO markers in the four generated files.
#   3. Paste the printed wiring into frontend/src/app/chat/[...path]/page.tsx.
#   4. Read .claude/skills/mcp-app-artefact/SKILL.md for the full recipe.

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <name> [title]" >&2
    echo "  <name>  : kebab-case identifier (matches the artefact serverId)" >&2
    echo "  [title] : human title shown to the student" >&2
    exit 1
fi

NAME="$1"
TITLE="${2:-$(echo "$NAME" | sed -E 's/-/ /g; s/\b(.)/\u\1/g')}"

if ! echo "$NAME" | grep -qE '^[a-z][a-z0-9-]*[a-z0-9]$'; then
    echo "Error: <name> must be kebab-case. Got: $NAME" >&2
    exit 2
fi

# kebab-case -> PascalCase (wave-superposition -> WaveSuperposition).
# perl (not sed) because BSD/macOS sed has no \U case operator.
PASCAL=$(echo "$NAME" | perl -pe 's/(^|-)(\w)/uc($2)/ge')

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPL_DIR="$REPO_ROOT/scripts/templates/workbench"
HOOKS_DIR="$REPO_ROOT/frontend/src/hooks"
WORK_DIR="$REPO_ROOT/frontend/src/components/workspace"

if [ ! -d "$TMPL_DIR" ]; then
    echo "Error: template dir not found at $TMPL_DIR" >&2
    exit 3
fi

# (template file, output path)
declare -a PAIRS=(
    "useSnapshot.ts.tmpl|$HOOKS_DIR/use${PASCAL}Snapshot.ts"
    "Frame.tsx.tmpl|$WORK_DIR/${PASCAL}Frame.tsx"
    "Button.tsx.tmpl|$WORK_DIR/${PASCAL}LabButton.tsx"
    "Workbench.tsx.tmpl|$WORK_DIR/${PASCAL}Workbench.tsx"
)

# Refuse to clobber.
for pair in "${PAIRS[@]}"; do
    out="${pair#*|}"
    if [ -e "$out" ]; then
        echo "Error: $out already exists. Pick a new <name> or remove it first." >&2
        exit 4
    fi
done

subst() {
    sed -e "s|__PASCAL__|$PASCAL|g" \
        -e "s|__NAME__|$NAME|g" \
        -e "s|__TITLE__|$TITLE|g" \
        "$1"
}

for pair in "${PAIRS[@]}"; do
    tmpl="$TMPL_DIR/${pair%%|*}"
    out="${pair#*|}"
    subst "$tmpl" > "$out"
    echo "✓ Created ${out#"$REPO_ROOT/"}"
done

cat <<WIRING

Next: wire the triad into frontend/src/app/chat/[...path]/page.tsx
(mirrors the KineBot / LED Planck blocks). Paste + adapt:

  // imports
  import { ${PASCAL}Frame, type ${PASCAL}FrameHandle } from "@/components/workspace/${PASCAL}Frame";
  import { ${PASCAL}Workbench } from "@/components/workspace/${PASCAL}Workbench";
  import { use${PASCAL}Snapshot } from "@/hooks/use${PASCAL}Snapshot";

  // in the component body (AFTER sessionId is defined):
  const [show${PASCAL}, setShow${PASCAL}] = useState(false);
  const ${NAME//-/_}FrameRef = useRef<${PASCAL}FrameHandle | null>(null);
  const { snapshot: ${NAME//-/_}Snapshot, reportEvent: report${PASCAL}Event } =
    use${PASCAL}Snapshot(sessionId ?? agentSessionId);

  // widen the showAiplaWorkspace gate to include "${NAME}"

  // in handleSend's chat-flush block:
  ${NAME//-/_}FrameRef.current?.sendChatFlush();

  // the workspace mount:
  {showAiplaWorkspace && skillSlug === "${NAME}" && (
    <WorkspaceShell hideOnMobile={mobileTab !== "workspace"} ratio={workspaceRatio} onRatioChange={setWorkspaceRatio}>
      {show${PASCAL} && SANDBOX_ORIGIN ? (
        <${PASCAL}Frame ref={${NAME//-/_}FrameRef} sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={report${PASCAL}Event} onClose={() => setShow${PASCAL}(false)} />
      ) : (
        <${PASCAL}Workbench snapshot={${NAME//-/_}Snapshot} sandboxOrigin={SANDBOX_ORIGIN}
          onOpenSim={() => setShow${PASCAL}(true)} reportEvent={report${PASCAL}Event}
          simDisabled={!SANDBOX_ORIGIN} sessionId={sessionId ?? agentSessionId} />
      )}
    </WorkspaceShell>
  )}

Then:
  - ./scripts/new-artefact.sh ${NAME} "${TITLE}"   (the SIM-ONLY iframe)
  - fill the TODO markers in the four generated files
  - .claude/skills/mcp-app-artefact/SKILL.md for the full recipe
WIRING
