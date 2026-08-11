#!/usr/bin/env bash
# Fail if a brand surface hardcodes a Tailwind `red-*` utility instead of the
# `brand` / `primary` tokens.
#
#   make check-brand-literals
#
# WHY: the app shipped two brand primaries for months. `--primary` was the
# inherited Sunholo orange while /project hardcoded KU red in 24 `red-*`
# utilities, so the homepage CTA was orange and /project's was KU red, both
# under the same KU coat-of-arms. Literals are what let the two drift.
#
# SCOPE IS DELIBERATELY NARROW. Most `red-*` in the tree is NOT brand — it is
# error/destructive text in the teacher editors, BackendHealthBadge's "down"
# pill, and LessonRecordingPanel's record indicator. Those stay red and are
# none of this script's business. Only the surfaces that render the brand are
# checked, plus the specific dark shades (800/900/950) that read as KU red
# wherever they appear.
set -euo pipefail

cd "$(dirname "$0")/../frontend"

fail=0

# 1. Brand surfaces: no red literals at all — they have tokens.
BRAND_PATHS=(
  "src/components/project"
  "src/app/(site)/project"
  "src/components/site"
)
for path in "${BRAND_PATHS[@]}"; do
  [ -d "$path" ] || continue
  if hits=$(grep -rn --include="*.tsx" -oE "\bred-[0-9]{2,3}" "$path" 2>/dev/null); then
    echo "FAIL: hardcoded red utility on a brand surface ($path)."
    echo "      Use bg-brand / text-brand / border-brand / brand-tint / brand-line."
    echo "$hits" | sed 's/^/      /'
    fail=1
  fi
done

# 2. Anywhere else: the dark shades (800/900/950) read as KU red wherever they
#    appear, so a new one is almost certainly brand drift.
#
#    ALLOWLIST — files where a dark red is genuinely semantic, not brand.
#    Each entry needs a reason. Do not add to this list to silence the check;
#    if the colour means "brand", use the token.
#      BackendHealthBadge   — the "backend is down" status pill
#      LessonRecordingPanel — dark-mode variants of the recording indicator
ALLOWED_SEMANTIC_RED='src/components/BackendHealthBadge.tsx|src/components/chat/LessonRecordingPanel.tsx'

if hits=$(grep -rn --include="*.tsx" -oE "\bred-(800|900|950)\b" src 2>/dev/null \
            | grep -vE "^($ALLOWED_SEMANTIC_RED):"); then
  echo "FAIL: red-800/900/950 are KU-red shades — use the brand token."
  echo "      (If the colour genuinely means error/recording rather than brand,"
  echo "       add the file to ALLOWED_SEMANTIC_RED in this script with a reason.)"
  echo "$hits" | sed 's/^/      /'
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: no hardcoded brand-red literals."
fi
exit "$fail"
