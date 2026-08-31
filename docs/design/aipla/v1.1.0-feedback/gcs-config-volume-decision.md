# Should AIPLA mount a GCS config volume at all?

**Status**: **DECIDED 2026-08-31 (M): Option A.** Volume removed from all three environments; `backend/cloudbuild.yaml` deleted. Terraform `_CONFIG_BUCKET` tidy-up is the only item left
**Priority**: **P1** — the thing being decided took prod down for ~8 hours on 2026-08-28/29
**Estimated**: Option A ~0.25d — **done**. Option B, if ever wanted, ~1d
**Scope**: Infra — [`cloudbuild.yaml`](../../../../cloudbuild.yaml), [`backend/Dockerfile`](../../../../backend/Dockerfile), [`infrastructure/env/cloudbuild.tf`](../../../../infrastructure/env/cloudbuild.tf), and `backend/cloudbuild.yaml` (deleted)
**Dependencies**: none
**Created**: 2026-08-31
**Source**: the 2026-08-31 prod activity review; incident **GCSFUSE-STARTUP** in [docs/ops/deployed-urls.md](../../../ops/deployed-urls.md)

## The question

The Cloud Run service mounts `gs://<project>-config` read-only at `/gcs_config`.
That mount failed for ~8 hours and prod could not start a single instance. The
narrow fix is to remove it. The question worth answering first is the general
one: **should this platform be using a GCS config volume at all?** If the answer
is yes, the mount should be repaired and given a job. If no, it should go.

## What is actually there today

Established by reading the tree on 2026-08-31, not from memory:

| Fact | Evidence |
|---|---|
| The volume is declared at service level, mounted only into the `sidecar` (backend) container | `cloudbuild.yaml` deploy step, `--add-volume` + `--add-volume-mount` |
| The path is advertised to the app as `_CONFIG_FOLDER=/gcs_config` | `backend/Dockerfile:25` |
| **Nothing reads `_CONFIG_FOLDER` or `/gcs_config`** — not in `backend/`, `frontend/src/`, or `cli/` | repo-wide grep returns the Dockerfile line and the two cloudbuild lines, nothing else |
| It arrived with the fork's **initial commit**, `160c9fe` (2026-05-19) | `git log -S 'gcs_config' -- cloudbuild.yaml` |
| All three config buckets are **empty** | `gcloud storage ls gs://aipla-{dev,test,prod}-2026-config` → 0 objects |

`_CONFIG_FOLDER` is Sunholo v5's `ConfigManager` convention. Per the top of the
root `CLAUDE.md`, v6's first principle is "Pure ADK + FastAPI — no Sunholo". The
mount is the config half of a dependency the rebuild removed. It has been
carrying a startup dependency for three months in exchange for nothing.

## Why the mount cannot be made "safe" and kept

A Cloud Run Cloud Storage volume is a **hard startup dependency with no opt-out**.
The volume config accepts `bucketName`, `mountOptions` and `readOnly` — there is
no optional/tolerate-failure setting ([Cloud Run volume-mount docs](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts)).
If the mount fails, the container never starts. We have the local proof:

```
terminated: Application failed to run: volume (type: gcs, name: gcs_config): mount operation failed
Default STARTUP TCP probe failed 1 time consecutively for container "main" on port 8080.
The instance was not started.
```

33 consecutive occurrences, 2026-08-28 20:00 → 08-29 03:54 UTC. Note the second
line: the mount is on the **sidecar**, but the failure takes down the whole
instance, so the **frontend** goes with it. A student sees a dead site because of
a bucket nobody reads.

This matters for the decision because it kills the "keep it, it's harmless"
position. The mount is not free, and no amount of populating the bucket makes it
free. An empty bucket mounts fine — emptiness was never the fault.

## The decisive fact: a runtime config plane already exists

The instinct behind "give the volume a real job" is sound — there **is** config
that should reach prod without a deploy. But that plane is already built, and it
is Firestore:

- `admin/platform_seed.py` globs `backend/skills/templates/*/SKILL.md` and writes
  each body to the Firestore `skills` collection.
- `skills/skill_config.py` reads it back through a **60-second TTL** in-memory
  cache with write-through invalidation (`_CACHE_TTL = 60`).
- `make seed ENV=prod` pushes an edit live in under a minute, no deploy, and the
  Cloud Build seed job runs it automatically on every deploy of both pipelines.

Firestore is already on every request path, so it adds no new failure mode. A GCS
config volume would be a **second config plane** offering nothing the first lacks,
and costing the one thing that took prod down. That is the whole case.

### The one genuine gap, and why it is not a GCS problem

The `skills/preambles/` family — `math_notation.md`, `image_input.md`,
`interaction_style/{warm,socratic,rigorous,concise}.md` — is the one config that
is **not** in the plane. Each is read from disk at agent-build time and
`lru_cache`d for the process lifetime, so it reaches prod by deploy only. That is
exactly the trap `f846acc` documented last week: someone would run `make seed`,
watch it succeed, and find the tutor still writing `0,2*tid`.

This is a real gap. It is not an argument for GCS — Firestore serves it strictly
better (already there, already cached with a TTL, already seeded by CI). See
Option B.

## Options

| | Option | Config planes | Prod startup dependency | Preambles hot-editable |
|---|---|---|---|---|
| **A** | **Remove the volume. Leave preambles deploy-coupled.** | 1 (Firestore) | none | no |
| B | Remove the volume; move preambles into the Firestore seed plane | 1 (Firestore) | none | yes, ~60s |
| C | Keep the volume; put the preambles in it | 2 | gcsfuse, unavoidable | yes |
| D | Keep the volume for something only GCS can do | 2 | gcsfuse, unavoidable | n/a |

**D fails on inspection.** The candidates for "only GCS can do this" are large or
binary objects, and each already has a home: student uploads →
`<project>-documents`, voice recordings → `<project>-research-audio`, ADK
artifacts → `<project>-artifacts`, curriculum retrieval → Vertex RAG Engine. GCS
is used well here; it is the *config* bucket specifically that is vestigial.
Nothing in the app wants POSIX file semantics over a config blob.

**C is B with a worse substrate.** It buys the same capability as B and pays the
startup dependency for it.

## Recommendation: A, and not B yet

**Remove the volume, the mount, and `_CONFIG_FOLDER`.** Keep the buckets (they
are Terraform-managed, cost nothing empty, and destroying them is a bigger action
than the problem warrants).

**Do not move the preambles to Firestore reflexively.** Deploy-coupling is a
defensible property for this particular content, not merely an accident:

- The preambles are **house style applied unconditionally to every skill and
  therefore every student on every turn** — `math_notation.py` argues this at
  length as the reason it is not opt-in. Content with that blast radius wants
  code review, git history and a revertable commit more than it wants a 60-second
  edit loop.
- The cost of deploy-coupling is bounded and small: house style has changed once
  in three months, and the deploy is automated.
- The August pain was a **documentation** bug ("takes effect on the next seed"),
  and `f846acc` fixed it at the point of use.

Revisit B if a concrete need appears — a teacher-facing house-style control, or a
second incident where a preamble typo has to be pulled in minutes rather than the
~15 a deploy takes. Cheap to build then; the loader already degrades to `""` on a
missing file, so a Firestore-first-then-baked read is an additive change.

## The systemic finding

The audit step asks whether this is one-off or a pattern. It is a pattern:
**inherited template config that was never audited against what the fork actually
runs.** A second instance was found while checking this one:

- `backend/cloudbuild.yaml` deployed a service named **`aitana-v6-backend`**,
  which does not exist in AIPLA, and still wired `ANTHROPIC_API_KEY`,
  `TELEGRAM_BOT_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `MAILGUN_API_KEY` and `MAILGUN_WEBHOOK_SECRET`. The root `cloudbuild.yaml`
  documents these as "all stripped for v0.1"; the backend pipeline never got the
  memo. **Deleted 2026-08-31** on four independent lines of evidence:

  1. **No trigger** in `aipla-{dev,test,prod}-2026` references it. Every trigger
     runs `cloudbuild.yaml`, `cloudbuild.promote.yaml`,
     `infrastructure/mcp-sandbox/cloudbuild.yaml`, or
     `infrastructure/env/cloudbuild.terraform.yaml`.
  2. **No such service exists.** All three projects hold exactly
     `aipla-v01-frontend` and `aipla-v01-sandbox`.
  3. **401 builds over 90 days** across the three projects carry only
     `_SERVICE_NAME=aipla-v01-frontend|aipla-v01-sandbox`. `aitana-v6-backend`
     has never been built in any AIPLA environment.
  4. `scripts/check-cloudbuild-substitutions.py` hardcodes the four real
     pipelines and **already excluded it** — the substitution guard never
     considered it live either.

  One source disagreed: `.claude/state/sprints/sprint_LED-PLANCK-1C.json` claims
  *"Two Cloud Build runs (cloudbuild.yaml + backend/cloudbuild.yaml + sandbox)
  all SUCCESS"*. It is wrong, and wrong in the documented way — sprint-state
  JSONs under-report and mis-report (the 2026-06-28 sweep found ~10 mislabelled),
  so *"is it live?"* is answered against triggers and build history, never against
  a sprint flag. `docs/design/aipla/v1.0.0-pilot/aipla-cloud-bootstrap.md:22`
  had it right all along: *"that file isn't the active deploy config for AIPLA;
  the root `cloudbuild.yaml` is."*

  **Upstream consequence:** the template still maintains this pipeline for its
  standalone-backend topology, so the deletion is deliberate fork divergence and
  will conflict on the next upstream pull. Recorded in
  [docs/upstream-feedback.md](../../../upstream-feedback.md).

Neither was caught because **nothing fails when dead config is merely present** —
it fails months later, on an unrelated infra blip, in the environment with users
on it. Proposed guard, added as a footgun row in `CLAUDE.md`: before adding a
volume, mount, or secret to a deploy step, grep that something reads it.

## Removal is two changes, not one

Recorded because the second half is easy to miss and leaves prod exposed while
looking finished:

1. **The pipelines** — `cloudbuild.yaml`, `backend/cloudbuild.yaml`,
   `backend/Dockerfile`. Keep the `_CONFIG_BUCKET` substitution *declared* in both
   YAMLs until it is also dropped from `deploy_substitutions` in
   `infrastructure/env/cloudbuild.tf`, terraform applied **first** — Cloud Build
   rejects a build whose trigger passes a key the template does not declare.
2. **The running services** — both `gcloud run deploy` and `gcloud run services
   update` **preserve volumes they are not explicitly told to drop**. Editing the
   YAML removes nothing from a live service. Prod is the sharp case: it was never
   in `cloudbuild.promote.yaml` at all and carries the volume anyway, inherited
   from its env cut, so no future promote will ever clear it.

```bash
gcloud run services update aipla-v01-frontend \
  --project <env-project> --region europe-north1 \
  --remove-volume=gcs_config \
  --container=sidecar --remove-volume-mount=/gcs_config
```

## Success criteria

- [x] `cloudbuild.yaml` and `backend/Dockerfile` carry no `gcs_config` / `_CONFIG_FOLDER`
- [x] dev service has no volume; `smoke-deployed.sh dev all` green
- [x] test service has no volume; `smoke-deployed.sh test all` green
- [x] **prod** service has no volume (revision `aipla-v01-frontend-00030-652`); `smoke-deployed.sh prod all` green, including the real-student upload round-trip
- [x] `backend/cloudbuild.yaml` **deleted** — see the evidence below
- [ ] `_CONFIG_BUCKET` dropped from `infrastructure/env/cloudbuild.tf` and `cloudbuild.yaml`, **terraform applied first** (the only remaining item; purely cosmetic, one dead substitution)
- [x] footgun row in `CLAUDE.md`

## Related documents

- [docs/ops/deployed-urls.md](../../../ops/deployed-urls.md) — incidents **GCSFUSE-STARTUP** and **PILOT-UPLOAD-500**
- [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md) — item 17, the preamble whose deploy-coupling raised the config-plane question
- [build-once-artifact-promotion.md](../v1.0.0-pilot/build-once-artifact-promotion.md) — why prod is reached only by promote, and why per-env config needs a promote twin
