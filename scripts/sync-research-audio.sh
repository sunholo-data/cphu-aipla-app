#!/usr/bin/env bash
#
# sync-research-audio.sh — pull lesson recordings from the research-audio GCS
# bucket to a local gitignored folder so they can be played back, and stitch
# each group's 50-second WAV fragments into one continuous file.
#
# Idempotent: `gsutil rsync` only downloads new/changed objects, so re-running
# after more sessions just appends the new recordings. Re-stitches affected
# groups each run.
#
# Usage:
#   scripts/sync-research-audio.sh [ENV] [--no-stitch]
#     ENV   dev | test | prod   (default: dev)
#
# Output (all under demo-captures/, which is gitignored):
#   demo-captures/research-audio/<env>/<classId>/<groupId>/<uuid>.wav   raw mirror
#   demo-captures/research-audio/<env>/_stitched/<classId>__<groupId>.wav  per-group, chronological
#
set -euo pipefail

ENV="${1:-dev}"
STITCH=1
[[ "${2:-}" == "--no-stitch" ]] && STITCH=0

case "$ENV" in
  dev)  PROJECT="aipla-dev-2026"  ;;
  test) PROJECT="aipla-test-2026" ;;
  prod) PROJECT="aipla-prod-2026" ;;
  *) echo "unknown ENV: $ENV (want dev|test|prod)" >&2; exit 2 ;;
esac

BUCKET="gs://${PROJECT}-research-audio"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/demo-captures/research-audio/$ENV"
mkdir -p "$DEST"

echo "[sync] $BUCKET -> $DEST"
gsutil -m rsync -r "$BUCKET" "$DEST"

if [[ "$STITCH" -eq 0 ]]; then
  echo "[stitch] skipped (--no-stitch)"
  exit 0
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[stitch] ffmpeg not found — skipping stitch (raw files are downloaded)" >&2
  exit 0
fi

STITCH_DIR="$DEST/_stitched"
mkdir -p "$STITCH_DIR"
echo "[stitch] building per-group continuous files in chronological (upload) order"

# Order objects by GCS creation time (chronological playback ≈ how the session
# unfolded). rsync doesn't preserve creation time locally, so we read the order
# from the bucket and map basenames back to the local mirror.
gsutil ls -l -r "$BUCKET/**" 2>/dev/null | grep '\.wav$' | \
  awk '{print $2"\t"$3}' | sort | \
while IFS=$'\t' read -r _ts url; do
  # url: gs://bucket/<classId>/<groupId>/<uuid>.wav
  rel="${url#"$BUCKET"/}"
  cls="${rel%%/*}"; rest="${rel#*/}"; grp="${rest%%/*}"
  echo "$DEST/$rel" >> "$STITCH_DIR/.list.${cls}__${grp}.txt.raw"
done

shopt -s nullglob
for raw in "$STITCH_DIR"/.list.*.txt.raw; do
  key="$(basename "$raw")"; key="${key#.list.}"; key="${key%.txt.raw}"
  list="$STITCH_DIR/.list.${key}.txt"
  : > "$list"
  count=0
  while IFS= read -r f; do
    if [[ -f "$f" ]]; then
      # escape single quotes for ffmpeg concat list
      printf "file '%s'\n" "${f//\'/\'\\\'\'}" >> "$list"
      count=$((count+1))
    fi
  done < "$raw"
  rm -f "$raw"
  if [[ "$count" -lt 1 ]]; then rm -f "$list"; continue; fi
  out="$STITCH_DIR/${key}.wav"
  ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$list" \
         -ar 16000 -ac 1 -c:a pcm_s16le "$out" 2>/dev/null || {
    echo "[stitch] ffmpeg failed for $key" >&2; rm -f "$list"; continue; }
  rm -f "$list"
  dur="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$out" 2>/dev/null || echo '?')"
  printf "[stitch] %-40s %3d segs  %6.1f min  -> %s\n" "$key" "$count" \
    "$(awk "BEGIN{print ${dur:-0}/60}")" "${out#"$REPO_ROOT"/}"
done

echo "[done] play a group with: open '$STITCH_DIR/<classId>__<groupId>.wav'"
