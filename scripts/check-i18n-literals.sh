#!/usr/bin/env bash
# Fail if a localised surface carries Danish text in code instead of in
# `frontend/messages/`.
#
#   make check-i18n
#
# WHY (1.1.108 content-localisation, rule M4.7): an English activity showed
# Danish buttons for months because the student UI's strings were typed into
# JSX, where no translator can reach them and no locale can switch them. The
# message layer fixes the surfaces it covers; this keeps them fixed — the next
# string added inline is one more to extract by hand.
#
# CRUDE ON PURPOSE. It flags a Danish letter (æ ø å) in code, comments stripped.
# It cannot see Danish words without those letters ("Send", "Luk"), nor English
# typed inline — the Vitest renders under `en` and `da` catch those in the
# components they cover. What it catches is the case that actually happens:
# someone types Danish into a component. Same shape as check-brand-literals.
#
# SCOPE widens per surface as each is extracted (1.1.108 M0 → M2). Only the
# student surfaces are covered today; the teacher surfaces follow at M2.
set -euo pipefail

cd "$(dirname "$0")/../frontend"

# Directories, plus the individual lib/ and hooks/ files whose text reaches a
# student (lib/ as a whole also holds teacher template DATA in Danish, which is
# content, not UI copy — it is M2's to move).
read -r -a I18N_PATHS <<< "${I18N_PATHS:-src/components/workspace src/components/chat src/components/protocols src/components/doc-browser src/components/budget src/components/site src/app/lessons src/app/chat src/app/(site)/group src/hooks/useImageAttachments.ts src/hooks/useSkillAgent.ts src/lib/resolveChartBinding.ts src/lib/personGuardrail.ts src/lib/relativeTime.ts}"

# Files allowed to hold Danish in code. Each needs a reason. Do not add to this
# list to silence the check; move the string into messages/ instead.
#   ReadAloudButton — `/[æøå]/` is a language DETECTOR on tutor text, not copy
#   SymbolStrip     — physics symbol names keyed by glyph: pronunciation-style
#                     vocabulary data (like voice-pronunciation/units.da.ts)
ALLOWED="${I18N_ALLOWED:-src/components/chat/ReadAloudButton.tsx|src/components/chat/SymbolStrip.tsx}"

python3 - "$ALLOWED" "${I18N_PATHS[@]}" <<'PY'
import pathlib, re, sys

allowed = {a for a in sys.argv[1].split("|") if a}
roots = [pathlib.Path(p) for p in sys.argv[2:]]
danish = re.compile(r"[æøåÆØÅ]")
# Block comments, then line comments — but not the `//` inside a URL string.
block = re.compile(r"/\*.*?\*/", re.S)
line = re.compile(r"(^|[^:\"'`])//.*$", re.M)

hits = []
for root in roots:
    if not root.exists():
        continue
    for f in sorted(root.rglob("*")) if root.is_dir() else [root]:
        if f.suffix not in {".ts", ".tsx"} or "__tests__" in f.parts or ".test." in f.name:
            continue
        if str(f) in allowed:
            continue
        src = f.read_text(encoding="utf-8")
        # Blank out comments but keep newlines, so line numbers stay true.
        src = block.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), src)
        src = line.sub(lambda m: m.group(1), src)
        for n, text in enumerate(src.splitlines(), 1):
            if danish.search(text):
                hits.append(f"{f}:{n}: {text.strip()}")

if hits:
    print("FAIL: Danish text in code on a localised surface.")
    print("      Move it to frontend/messages/{da,en}/<area>.json and read it with useT().")
    print("      (1.1.108 rule M4 — language is data, text is content, neither is code.)")
    for h in hits:
        print("      " + h)
    sys.exit(1)
print("OK: no inline Danish on localised surfaces.")
PY
