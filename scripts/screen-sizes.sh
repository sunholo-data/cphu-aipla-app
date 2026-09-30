#!/usr/bin/env bash
# screen-sizes.sh — what screen sizes are people using? (1.1.96 M0 screen-size slice, 2026-09-30)
#
# Reads the `aipla_client_env` beacons (one per page session, plus one per
# resize that crosses a width bucket) from Cloud Logging and prints a bucketed
# distribution of viewport widths x surface, plus DPR and pointer type.
# READ-ONLY: `gcloud logging read`, nothing else.
#
# Usage:
#   scripts/screen-sizes.sh [--dry-run] <dev|test|prod> [DAYS]
#   make screen-sizes ENV=prod [DAYS=30] [DRY_RUN=1]
#
# A row is a page session, not a person: a teacher who reloads ten times counts
# ten times. Read the shares, not the absolute counts.
#
# Buckets are kept in lockstep with VIEWPORT_BUCKETS in
# backend/observability/client_error.py and frontend/src/lib/clientEnvBeacon.ts.

set -euo pipefail

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
}

DRY_RUN=0
ARGS=()
for a in "$@"; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
    -n|--dry-run) DRY_RUN=1 ;;
    *) ARGS+=("$a") ;;
  esac
done

ENV_NAME="${ARGS[0]:-}"
DAYS="${ARGS[1]:-30}"
case "$ENV_NAME" in
  dev|test|prod) ;;
  *) echo "error: ENV must be dev, test or prod (got '${ENV_NAME}')" >&2; usage >&2; exit 2 ;;
esac
if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "$DAYS" -lt 1 ]; then
  echo "error: DAYS must be a positive integer (got '${DAYS}')" >&2
  exit 2
fi

PROJECT="aipla-${ENV_NAME}-2026"
FILTER='logName:"aipla_client_env"'
GCLOUD_SDK_BIN="/Users/voightkampff/dev/google-cloud-sdk/bin"
if ! command -v gcloud >/dev/null 2>&1 && [ -x "${GCLOUD_SDK_BIN}/gcloud" ]; then
  export PATH="${GCLOUD_SDK_BIN}:${PATH}"
fi

CMD=(gcloud logging read "$FILTER" "--project=${PROJECT}" "--freshness=${DAYS}d"
     --limit=50000 --format=json)

echo "screen-sizes: ${PROJECT}, last ${DAYS} day(s)"
if [ "$DRY_RUN" = "1" ]; then
  printf 'dry run — would run:\n  '
  printf '%q ' "${CMD[@]}"
  echo
  exit 0
fi

command -v gcloud >/dev/null 2>&1 || { echo "error: gcloud not found on PATH or at ${GCLOUD_SDK_BIN}" >&2; exit 1; }
echo "account: $(gcloud config get-value account 2>/dev/null || echo '?')"

TMP="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$TMP" "$ERR"' EXIT

# A read failure must NEVER look like "no data" — that is the reassuring answer a
# broken read produces (CLAUDE.md: "A checker answers when it could not read its
# subject"). So stderr is kept, and a non-zero exit is reported as CANNOT READ.
if ! "${CMD[@]}" >"$TMP" 2>"$ERR"; then
  echo "(CANNOT READ) gcloud logging read failed on ${PROJECT}:" >&2
  cat "$ERR" >&2
  exit 1
fi

python3 - "$TMP" <<'PY'
import json
import sys
from collections import Counter

BUCKETS = [(0, "<768"), (768, "768-1279"), (1280, "1280-1439"), (1440, "1440-1919"), (1920, ">=1920")]
SURFACES = ["student", "teacher", "public", "unknown"]

def bucket(w):
    if not isinstance(w, (int, float)):
        return None
    label = BUCKETS[0][1]
    for lower, name in BUCKETS:
        if w >= lower:
            label = name
    return label

with open(sys.argv[1]) as fh:
    rows = [e.get("jsonPayload") or {} for e in json.load(fh)]
rows = [r for r in rows if r.get("kind") == "env"]
if not rows:
    print("\nno env beacons in this window (read succeeded; the beacon may not be deployed here yet).")
    sys.exit(0)

grid = Counter()
per_surface = Counter()
for r in rows:
    s = r.get("surface") if r.get("surface") in SURFACES else "unknown"
    b = r.get("viewport_bucket") or bucket(r.get("viewport_w")) or "?"
    grid[(b, s)] += 1
    per_surface[s] += 1

surfaces = [s for s in SURFACES if per_surface[s]]
labels = [name for _, name in BUCKETS] + (["?"] if any(k[0] == "?" for k in grid) else [])
total = len(rows)

print(f"\n{total} page sessions\n")
print("viewport width".ljust(16) + "".join(s.rjust(16) for s in surfaces) + "all".rjust(14))
for b in labels:
    cells = []
    for s in surfaces:
        n = grid[(b, s)]
        pct = 100 * n / per_surface[s] if per_surface[s] else 0
        cells.append(f"{n:>6} ({pct:4.0f}%)".rjust(16))
    n_all = sum(grid[(b, s)] for s in surfaces)
    print(b.ljust(16) + "".join(cells) + f"{n_all:>6} ({100 * n_all / total:4.0f}%)".rjust(14))

def dist(title, key, fmt=str):
    c = Counter(fmt(r.get(key)) for r in rows)
    print(f"\n{title}")
    for k, n in c.most_common(8):
        print(f"  {k:<14}{n:>6} ({100 * n / total:3.0f}%)")

dist("device pixel ratio", "dpr", lambda v: "?" if v is None else f"{v:g}")
dist("pointer", "pointer", lambda v: v or "?")
tops = Counter((r.get("viewport_w"), r.get("viewport_h")) for r in rows if r.get("viewport_w"))
print("\nmost common viewports (w x h)")
for (w, h), n in tops.most_common(8):
    print(f"  {w}x{h}".ljust(16) + f"{n:>6} ({100 * n / total:3.0f}%)")
PY
