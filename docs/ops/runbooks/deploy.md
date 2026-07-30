# Runbook — deploying AIPLA (dev · test · prod)

**How code reaches each environment.** For the one-time *creation* of an
environment see [prod-cut.md](prod-cut.md); this is the routine path.

> **Every `gcloud` command here needs `CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo`.**
> The default config points at the *template's* Aitana project and every AIPLA
> call returns `PERMISSION_DENIED`. This is the single most common time-waster.

## The three routes at a glance

| Env | Trigger | Command | What ships |
|---|---|---|---|
| **dev** | push to `dev` | `git push origin dev` | Rebuild of both containers from the branch tip |
| **test** | `v*` git tag | `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z` | Rebuild of both containers from the tag |
| **prod** | manual | `make promote VERSION=vX.Y.Z FROM=test TO=prod GO=1` | **Copies** test's tested backend digest; rebuilds only the frontend |

`dev` is the only branch in the repo. There is no `test` or `prod` branch —
they were deleted 2026-07-30 after two months of sitting at the fork's bootstrap
commit and causing a wrong "test/prod were never deployed" conclusion. **Never
infer an environment's state from git refs**; [deployed-urls.md](../deployed-urls.md)
is the source of truth for what is live.

---

## dev — push to the branch

```bash
git push origin dev          # fires the `aipla-dev-deploy` trigger
```

Builds and deploys `aipla-v01-frontend` in **`aipla-dev-2026`** (triggers live in
the env project itself; `aipla-deploy` holds only tfstate and has the Cloud Build
API disabled). Takes **~15–20 min**.

```bash
# Watch it (Cloud Build is REGIONAL — a global list returns empty, which is the trap)
CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud builds list \
  --project=aipla-dev-2026 --region=europe-north1 --limit=5 \
  --format="table(status,createTime.date('%H:%M'),substitutions.SHORT_SHA)"

CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo ./scripts/smoke-deployed.sh dev all
```

**A red test blocks every dev deploy.** `cloudbuild.yaml` opens with a CI gate
running backend lint + pytest **and** the full frontend suite. One failing test
means nothing ships — indefinitely — even though `git push` succeeded. If a push
produces no new revision, check the build status *before* concluding anything;
`gh run list --limit 6` mirrors the same checks.

Run CI parity locally first:

```bash
cd backend  && make lint && make test-fast
cd frontend && npm run quality:check      # NOT quality:check:fast — that skips tests
```

---

## test — push a version tag

```bash
git tag -a v0.1.4 -m "what changed" && git push origin v0.1.4
```

Fires **`aipla-test-release`** (frontend+backend) and **`aipla-test-sandbox-release`**
(the MCP-app artefact host), both matching `^v.*$`. Same CI gate as dev.

```bash
CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud builds list \
  --project=aipla-test-2026 --region=europe-north1 --limit=4 \
  --format="table(status,createTime.date('%H:%M'),substitutions.TAG_NAME)"

CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo ./scripts/smoke-deployed.sh test all
```

**The same tag does NOT deploy prod.** `aipla-prod-release` is disabled (see
below). Before 2026-07-30 it was armed and a tag hit test and prod
simultaneously — prod running code test had never been verified on.

---

## prod — promote the tested artifact

Prod is never built from source. It receives the **byte-identical backend image**
test was verified on, pinned by digest:

```bash
git checkout v0.1.4                                        # promote the bytes you tagged
make promote VERSION=v0.1.4 FROM=test TO=prod              # dry-run plan first
make promote VERSION=v0.1.4 FROM=test TO=prod GO=1         # submit
git checkout dev
```

`scripts/promote-env.sh` → `cloudbuild.promote.yaml`, running **in the prod
project**:

1. `copy-backend` — `crane copy` moves test's `backend:vX.Y.Z` to prod by digest,
   then asserts the digest is unchanged in transit.
2. `build-frontend` — the frontend *must* be rebuilt: `NEXT_PUBLIC_*` is
   compile-time inlined, so a test-built UI carries test's config. Rebuilt from
   the same tag with prod's values.
3. `deploy` — updates the existing service; backend pinned by `@sha256:…`.
4. `smoke` — fails the build on any non-200.

**Verify the promotion actually copied** rather than silently rebuilt — digest
equality is the whole point:

```bash
CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud run services describe aipla-v01-frontend \
  --project=aipla-prod-2026 --region=europe-north1 \
  --format="value(spec.template.spec.containers[].image)"      # prod: backend@sha256:…

CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud artifacts docker images describe \
  europe-north1-docker.pkg.dev/aipla-test-2026/cphu/aipla-v01-frontend/backend:v0.1.4 \
  --format='value(image_summary.digest)'                       # must be the SAME sha256
```

### Why the checkout dance

`gcloud builds submit` uploads the **current working tree** as build source, and
the frontend is rebuilt from it. `promote-env.sh` therefore refuses to run unless
`HEAD` is at the version tag (override with `--yes` only when you know the
difference is deploy-config-only). Promote the bytes you tagged.

### The sandbox is deliberately NOT gated

`aipla-prod-sandbox-release` still fires on `v*`. The sandbox serves static
artefact HTML built deterministically from the tag — there is no tested digest to
preserve and the promote pipeline does not carry it. A bad sandbox deploy
degrades sims, not the tutor. This asymmetry is a decision, not an oversight.

---

## Seeding and migrations

**Skill templates seed themselves.** Every deploy ends with the
`aipla-seed-skills` Cloud Run job, and a failed seed fails the build. No manual
step. To seed *without* a deploy (a `SKILL.md` tweak you want live now):

```bash
CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo make seed ENV=dev
```

**Data migrations are separate and manual** — they write Firestore directly via
ADC, so they are deploy-independent and must be run per environment. Always
dry-run first:

```bash
make seed-curriculum-folders ENV=dev ARGS="--dry-run"   # then without ARGS
make seed-demo-codes ENV=dev                            # demo join codes lapse on TTL
```

> **Prod content gate:** prod carries **cleared curriculum only**. Never promote
> test's corpus (full/uncleared) to prod. Metadata-only migrations are fine —
> they create no documents.

---

## Rollback

Cloud Run keeps revisions; the fastest undo is a traffic shift, not a rebuild:

```bash
CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud run revisions list \
  --project=aipla-prod-2026 --region=europe-north1 --service=aipla-v01-frontend --limit=5

CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud run services update-traffic aipla-v01-frontend \
  --project=aipla-prod-2026 --region=europe-north1 --to-revisions=<previous>=100
```

Re-promoting an older tag also works and is the cleaner audit trail.
`aipla-prod-release` is kept (disabled) as a rebuild fallback — flip `disabled`
in `infrastructure/env/cloudbuild.tf` and re-apply if a promote must be bypassed.

---

## Gotchas that have actually cost time

| Symptom | Cause |
|---|---|
| Every `gcloud` says `PERMISSION_DENIED` | Wrong gcloud config — prefix `CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo` |
| `gcloud builds list` returns nothing | Cloud Build is regional — pass `--region=europe-north1` |
| Push succeeded, no new revision | CI gate failed, or it is still building (~15–20 min) |
| Shipped feature works in tests, deployed app shows old skill data | Seed didn't run — check the `aipla-seed-skills` job |
| Promote 403s from the CLI but the trigger works | `promote-env.sh` must pass `--service-account`; without it `builds submit` falls back to the Compute Engine default SA (fixed 2026-07-30) |
| Log timestamps look 2h stale | gcloud prints UTC; Denmark is UTC+2 |

## Related

- [deployed-urls.md](../deployed-urls.md) — what is live, per env (**source of truth**)
- [prod-cut.md](prod-cut.md) — one-time environment creation
- [build-once-artifact-promotion.md](../../design/aipla/v1.0.0-pilot/build-once-artifact-promotion.md) — why promote copies rather than rebuilds
- [infrastructure/env/README.md](../../../infrastructure/env/README.md) — the Terraform root
