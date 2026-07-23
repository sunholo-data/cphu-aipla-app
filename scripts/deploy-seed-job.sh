#!/usr/bin/env bash
# scripts/deploy-seed-job.sh — create/update (and optionally run) the
# post-deploy platform-skill seed as a Cloud Run JOB (P1.3).
#
# Why a job: a code deploy does NOT propagate SKILL.md template changes to
# Firestore for already-registered skills. That reconciliation used to be a
# MANUAL `make seed` step (the repo's #1 operational footgun) because minting
# an ID token to call POST /api/admin/seed-platform-skills from inside Cloud
# Build 403'd (see cloudbuild.yaml history block). A Cloud Run job running AS
# the runtime SA (aipla-v6@) writes Firestore DIRECTLY via ADC — no HTTP, no
# ID-token mint — by invoking `python -m admin.platform_seed` in the backend
# image. That entrypoint calls the same seed() the HTTP handler calls, so the
# automated and manual paths cannot drift, and it exits non-zero on any failed
# template so a bad seed fails the build.
#
# No new IAM: the build already deploys the SERVICE as aipla-v6@ (which needs
# roles/run.admin + iam.serviceAccounts.actAs on that SA), and those exact
# permissions let the same identity create + execute a JOB as aipla-v6@.
#
# `jobs deploy` (not just `jobs execute`) runs every time on purpose: Cloud Run
# resolves the image digest at DEPLOY time, so re-deploying the job re-points
# the stable :<branch> tag at the freshly-built digest. `jobs execute` alone
# would run whatever digest was captured last time (stale).
#
# Usage
#   # Cloud Build (explicit, nothing guessed):
#   scripts/deploy-seed-job.sh --project=PID --region=REG --sa=SA \
#       --image=REPO/svc/backend:BRANCH --execute
#
#   # Laptop against a deployed env (derives image from the live service):
#   scripts/deploy-seed-job.sh dev --execute        # = make seed-job ENV=dev
#   scripts/deploy-seed-job.sh dev                   # create/update only, no run
#
# Exit codes: propagates the job's exit (non-zero if any template failed to
# seed, or 2 if the job was misconfigured with LOCAL_MODE).
set -euo pipefail

JOB_NAME="aipla-seed-skills"
FRONTEND_SERVICE="aipla-v01-frontend"

ENV=""
PROJECT=""
REGION=""
SA=""
IMAGE=""
EXECUTE=0

for arg in "$@"; do
  case "$arg" in
    --project=*) PROJECT="${arg#*=}" ;;
    --region=*)  REGION="${arg#*=}" ;;
    --sa=*)      SA="${arg#*=}" ;;
    --image=*)   IMAGE="${arg#*=}" ;;
    --execute)   EXECUTE=1 ;;
    dev|test|prod) ENV="$arg" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Per-env defaults (laptop convenience); explicit flags always win.
if [ -n "$ENV" ]; then
  PROJECT="${PROJECT:-aipla-${ENV}-2026}"
fi
REGION="${REGION:-europe-north1}"           # ADR-007; matches promote-env.sh + cloud-logs.sh
if [ -z "$PROJECT" ]; then
  echo "must pass --project=... or a positional env (dev|test|prod)" >&2
  exit 2
fi
SA="${SA:-aipla-v6@${PROJECT}.iam.gserviceaccount.com}"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not on PATH" >&2; exit 2; }

# Derive the backend image from the live service when not passed (laptop path),
# so the job seeds using exactly the image that's currently deployed.
if [ -z "$IMAGE" ]; then
  echo "[seed-job] no --image given; deriving from deployed $FRONTEND_SERVICE"
  IMAGE="$(gcloud run services describe "$FRONTEND_SERVICE" \
    --project="$PROJECT" --region="$REGION" \
    --format="value(spec.template.spec.containers[].image)" 2>/dev/null \
    | grep -i '/backend:' | head -1)"
  [ -n "$IMAGE" ] || { echo "[seed-job] could not derive backend image; pass --image=..." >&2; exit 2; }
fi

echo "== deploy-seed-job =="
echo "job:     $JOB_NAME"
echo "project: $PROJECT"
echo "region:  $REGION"
echo "sa:      $SA"
echo "image:   $IMAGE"
echo "execute: $EXECUTE"
echo

# Create-or-update the job. --set-env-vars REPLACES the env, so we pass exactly
# what the in-process seed reads: the project (Firestore) and the AIPLA
# platform-owner namespace (default is the template's 'aitana-platform' —
# seeding under the wrong owner_id creates duplicate rows). LOCAL_MODE is
# deliberately NOT set; the entrypoint refuses to run (exit 2) if it is.
gcloud run jobs deploy "$JOB_NAME" \
  --image="$IMAGE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --service-account="$SA" \
  --command="sh" \
  --args="^@^-c@uv run python -m admin.platform_seed" \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT},PLATFORM_OWNER_UID=aipla-platform,PLATFORM_OWNER_EMAIL=platform@aipla.dev" \
  --max-retries=1 \
  --task-timeout=300 \
  --memory=2Gi \
  --cpu=1 \
  --quiet

if [ "$EXECUTE" = "1" ]; then
  echo
  echo "[seed-job] executing (waiting for completion) …"
  # --wait makes gcloud exit non-zero if the task fails, so a failed seed
  # fails this script (and the Cloud Build step that calls it).
  gcloud run jobs execute "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT" \
    --wait
fi

echo
echo "== deploy-seed-job done =="
