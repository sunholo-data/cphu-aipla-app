#!/usr/bin/env bash
# upload-outcomes.sh — what happened to the photos students picked? (2026-11-09)
#
# Reads the `aipla_client_upload` beacons from Cloud Logging: one row per picked
# file, saying whether the BROWSER staged it, or refused it (person screen, cap,
# not an image, unreadable). The server sees only what arrives; this is the half
# it cannot see. Added after the 3 Nov Bohr workshop. READ-ONLY.
#
# Usage:
#   scripts/upload-outcomes.sh [--dry-run] <dev|test|prod> [DAYS]
#   make upload-outcomes ENV=prod [DAYS=14] [DRY_RUN=1]
#
# A row is a picked file, not a person. Rows exist only from the release that
# shipped the beacon onward; before that, nothing was recorded.
#
# Enums are kept in lockstep with UPLOAD_* in backend/observability/client_error.py.

set -euo pipefail

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
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
DAYS="${ARGS[1]:-14}"
case "$ENV_NAME" in
  dev|test|prod) ;;
  *) echo "error: ENV must be dev, test or prod (got '${ENV_NAME}')" >&2; usage >&2; exit 2 ;;
esac
if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "$DAYS" -lt 1 ]; then
  echo "error: DAYS must be a positive integer (got '${DAYS}')" >&2
  exit 2
fi

PROJECT="aipla-${ENV_NAME}-2026"
FILTER='logName:"aipla_client_upload"'
GCLOUD_SDK_BIN="/Users/voightkampff/dev/google-cloud-sdk/bin"
if ! command -v gcloud >/dev/null 2>&1 && [ -x "${GCLOUD_SDK_BIN}/gcloud" ]; then
  export PATH="${GCLOUD_SDK_BIN}:${PATH}"
fi

CMD=(gcloud logging read "$FILTER" "--project=${PROJECT}" "--freshness=${DAYS}d"
     --limit=50000 --format=json)

echo "upload-outcomes: ${PROJECT}, last ${DAYS} day(s)"
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

rows = [e.get("jsonPayload", {}) for e in json.load(open(sys.argv[1]))]
if not rows:
    print("no upload-outcome rows in this window (the beacon ships from the release after 2026-11-09).")
    sys.exit(0)

def table(title, key):
    c = Counter(key(r) for r in rows)
    print(f"\n{title}")
    for k, n in c.most_common():
        print(f"  {n:6d}  {k}")

print(f"{len(rows)} picked file(s)")
table("outcome x where x pointer", lambda r: f"{r.get('outcome')} / {r.get('where')} / {r.get('pointer')}")
table("person screen (coarse = touch device)", lambda r: f"{r.get('screen')} / {r.get('pointer')}")
table("mime x outcome", lambda r: f"{r.get('mime')} / {r.get('outcome')}")
table("encoding of staged images", lambda r: r.get("encoding") if r.get("outcome") == "staged" else None)
big = [r for r in rows if (r.get("encoded_kb") or 0) > 3000]
print(f"\nstaged images sent over 3 MB after encoding: {len(big)}")
table("by app version", lambda r: r.get("app_version"))
PY
