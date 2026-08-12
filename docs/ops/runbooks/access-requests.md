# Runbook — access requests and the spend register

**Who may spend money on AIPLA, how people ask, and how you answer.**

Design: [1.1.75 public-access-tiers-and-spend-control](../../design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md)

> **Every command here needs `CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo`.** The default
> gcloud config points at the *template's* project and every AIPLA call returns
> `PERMISSION_DENIED`. Same first line as [deploy.md](deploy.md), same reason.

---

## The shape of it

```
visitor  (default, no action needed)   explore everything · recorded-demo tutor
   │                                   · NO live model · NO student join codes
   │  a human grants
   ▼
pilot                                  live tutor under a monthly cap
                                       · real student join codes
```

Nobody is `pilot` until someone grants it. An **empty register means every
account on that environment is a visitor** — including established teachers.
Check [deployed-urls.md](../deployed-urls.md) for the current per-env state.

---

## 1. Where a request lands

A signed-in visitor submits the form at `/teacher-access`
(e.g. <https://aipla.ku.dk/teacher-access>).

`POST /api/teacher/access-request` → Firestore **`access_requests/{uid}`** in
that environment's project, `status: "pending"`.

Keyed by uid, so re-submitting updates rather than piling up. There is no email
notification — **the queue does not tell you it has something in it.** Check it
after any round of publicity, or when someone says they asked.

> The endpoint returns the same response whether or not the caller is already on
> the register. That is deliberate: anything else makes it an oracle for who has
> been invited.

---

## 2. Mint an admin token

Every command below hits `/api/admin/*`, which is gated on an allowlisted
**service account** — not on your Google account. You impersonate the runtime SA:

```bash
export ENV=prod                                  # dev | test | prod
export URL=$(CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo gcloud run services describe \
  aipla-v01-frontend --project=aipla-$ENV-2026 --region=europe-north1 \
  --format='value(status.url)')

export AIPLATFORM_ID_TOKEN=$(CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo \
  gcloud auth print-identity-token \
  --impersonate-service-account=aipla-v6@aipla-$ENV-2026.iam.gserviceaccount.com \
  --audiences="$URL" --include-email)
```

**`--include-email` is not optional** — without it the SA token carries no email
claim and the admin gate 403s with nothing useful in the message.

Only members of `admin_operator_members` (see `infrastructure/env/envs/*.tfvars`)
can impersonate that SA. As of 2026-08-12 that is `m@sunholo.com` alone — see
[1.1.76](../../design/aipla/v1.1.0-feedback/delegated-programme-administration.md)
for the plan to widen it safely.

---

## 3. Review the queue

```bash
aiplatform --env $ENV users list-requests              # pending (default)
aiplatform --env $ENV users list-requests --status all
aiplatform --env $ENV users list-requests --json
```

Each entry prints the exact `grant-access` command to run for it.

---

## 4. Decide

**Before granting anyone, look at what they actually did.** The audit script is
read-only and reports class count, class names, whether they ever signed in
again, and whether a student ever joined their code:

```bash
cd backend
GOOGLE_CLOUD_PROJECT=aipla-$ENV-2026 uv run python -m scripts.access_audit --format markdown
```

One auto-seeded "Demo class" and a single sign-in is somebody who clicked
through onboarding once. Five classes named after real cohorts is a teacher.

---

## 5. Grant

```bash
aiplatform --env $ENV users grant-access anna@ku.dk \
  --cap 25 \
  --expires 2026-09-15T00:00:00Z \
  --note "Pilot cohort A, Niels Bohr Institute"
```

- **`--expires`**: default to the contract boundary (2026-09-15) so forgetting to
  clean up means access *lapses* rather than *persists*.
- **`--cap`**: monthly USD. Omit for the register default; `0` is uncapped.
- **`--note`**: not optional in spirit. "Why is this person on the register" is
  the thing nobody remembers in six weeks.
- Idempotent, and doubles as un-revoke.
- Granting **closes the matching request automatically**.

The email must match what Google returns, exactly (case and whitespace aside).
There is no plus-address or dot folding — inventing equivalences would create a
way in under an address nobody invited, so a typo fails visibly instead.

**Takes effect on their next app load** (`/api/teacher/bootstrap` reconciles the
claim and forces a token refresh). Tell them to reload.

## Revoke

```bash
aiplatform --env $ENV users revoke-access anna@ku.dk
```

Immediate — also kills outstanding sessions, so it does not wait on a token
refresh. The row is kept, not deleted: it is the audit trail.

## Review the register

```bash
aiplatform --env $ENV users list-access
aiplatform --env $ENV users list-access --include-revoked
```

---

## Bulk: after a deploy to a fresh environment

Shipping ACCESS-1 to an environment makes **every existing teacher a visitor**.
Grandfather them in the *same change window* as the deploy, not after:

```bash
cd backend
GOOGLE_CLOUD_PROJECT=aipla-$ENV-2026 uv run python -m scripts.grandfather_access          # dry run
GOOGLE_CLOUD_PROJECT=aipla-$ENV-2026 uv run python -m scripts.grandfather_access --apply
```

Uncapped by default — newly capping people already teaching could cut a lesson
off mid-session. Set real caps per teacher afterwards, once you have watched
usage.

---

## When it does not work

| Symptom | Cause |
|---|---|
| `Error: ... 403` on any admin call | Token minted without `--include-email`, or you are not in `admin_operator_members` |
| `404` with a page of HTML in it | The base URL is missing `/api/proxy`. The backend is a sidecar behind the frontend service, not a service of its own |
| `'prod' URL is a placeholder and gcloud could not resolve...` | gcloud is on the wrong configuration. `CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo` |
| `no such command 'list-requests'` | **A stale CLI install.** `make cli-install` — it bakes in `--no-cache`, which is exactly why this failure mode exists |
| Teacher still sees the recorded demo after a grant | They have not reloaded. The claim lands on the next `/api/teacher/bootstrap` |

---

## Related

- [deploy.md](deploy.md) — how code reaches each environment
- [../deployed-urls.md](../deployed-urls.md) — what is live, and the current register state per env
- [../access-register-signoff-2026-08-12.md](../access-register-signoff-2026-08-12.md) — the roster and its sign-off
