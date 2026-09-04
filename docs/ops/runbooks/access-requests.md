# Runbook — access requests and the spend register

**Who may spend money on AIPLA, how people ask, and how you answer.**

Design: [1.1.75 public-access-tiers-and-spend-control](../../design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md)

> **Every command here needs a gcloud config whose account is `m@sunholo.com`
> and an explicit `--project=aipla-<env>-2026`.** The default config points at
> the *template's* project, so an AIPLA call without `--project` returns
> `PERMISSION_DENIED`. Same first line as [deploy.md](deploy.md), same reason.
>
> ⚠️ This runbook used to say `CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo`. **There is
> no `sunholo` config on M's laptop** (2026-09-03: the configs are `aitana` and
> `default`, both already on `m@sunholo.com`), so that prefix silently created
> an empty config and made every command here fail for a reason the runbook did
> not explain. Set `--project` explicitly instead.

> **THERE IS NOW AN IN-APP ROUTE — prefer it.** Since 1.1.76 (shipped
> 2026-09-03) a **programme admin** grants, revokes and re-caps from
> **`/teacher/programme`**, with no service-account impersonation at all, and a
> **researcher** sees the same register and queue read-only. Everything below is
> the **unbounded** service-account path: still the only way to grant above the
> delegated ceiling, to set a zero or uncapped grant, or to mint the
> `programmeAdmin` claim itself. See
> [1.1.76](../../design/aipla/v1.1.0-feedback/delegated-programme-administration.md).

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
can impersonate that SA. As of 2026-08-12 that is `m@sunholo.com` alone, and
1.1.76 deliberately did **not** widen it — it added a second, narrower door
beside it rather than more keys to this one.

## 2b. Grant someone the in-app route (do this once per person)

```bash
aiplatform --env $ENV users grant-programme-admin <uid-or-email>
```

Takes either their Firebase UID or their email address — an email is resolved
to a UID via `fb_auth.get_user_by_email` on the way in, so there is no separate
lookup step (Firebase Console or otherwise) before this command. Same for
`grant-researcher` / `grant-admin` and their revoke twins.

Then they use `/teacher/programme` and never touch this runbook again. Bounded:
they may grant `pilot` up to `PROGRAMME_ADMIN_MAX_CAP_USD` (default $50), may
not set a zero or uncapped grant, may not grant past the engagement boundary,
and **cannot mint this claim for anyone including themselves**. Takes effect on
their next token refresh, so tell them to reload.

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
  --expires 2027-09-15T00:00:00Z \
  --note "Pilot cohort A, Niels Bohr Institute"
```

- **`--expires`**: default to the **engagement** boundary so forgetting to clean
  up means access *lapses* rather than *persists*. That boundary is now
  **2027-09-15** (end of the 2026/27 Danish school year), not the original
  2026-09-15 contract date — the extension awarded 2026-08 runs to at least
  April 2027. The prod register was re-stamped on 2026-08-17; `--expires`
  defaults and `grandfather_access.py` followed on 2026-08-27. **If you find a
  row still stamped 2026-09-15, it is a stale contract-boundary default, not a
  deliberate short grant — re-stamp it.**
- **`--cap`**: monthly USD. **Omit for the register default ($25) — there is no
  uncapped default on any path.** `0` means a ZERO cap (spend suspended, grant
  and classes and join codes all intact) — a useful state, and *not* "no limit".
  Removing the limit entirely takes an explicit `--uncapped`, which warns,
  because an uncapped teacher is bounded only by the shared project quota and
  can starve every other teacher on it.
- **`--note`**: not optional in spirit. "Why is this person on the register" is
  the thing nobody remembers in six weeks.
- Idempotent, and doubles as un-revoke.
- Granting **closes the matching request automatically**.

The email must match what Google returns, exactly (case and whitespace aside).
There is no plus-address or dot folding — inventing equivalences would create a
way in under an address nobody invited, so a typo fails visibly instead.

**Takes effect on their next app load** (`/api/teacher/bootstrap` reconciles the
claim and forces a token refresh). Tell them to reload.

## 6. When Google sign-in cannot work for them

Sign-in is **Google**. Some pilot schools run a **Microsoft 365 tenant**
(`lu@o365.favrskov-gym.dk` and `op@o365.favrskov-gym.dk` are the known pair), so
Google can never return their institutional address and the grant sits there
matching nobody.

Email/password sign-in **is** enabled on prod and the form exists at
`/teacher/sign-in`. What does not exist is **self-service signup** — so the
first credential has to be minted for them:

```bash
aiplatform --env $ENV users invite-password lu@o365.favrskov-gym.dk \
  --name "Peter L" \
  --continue-url https://aipla.ku.dk/teacher/sign-in
```

Prints a Firebase-hosted link. **Send them the link, not a password** — the
account is created with a random secret nobody ever learns, and they choose their
own on Google's page. There is deliberately no way to make this command tell you
a password (`test_password_invite_creates_user_and_never_returns_the_password`).

- **Requires an active grant first.** Minting a credential for an address nobody
  invited is refused with a 404 naming the `grant-access` command to run. A typo
  cannot conjure an account.
- **The links are short-lived.** Mint one when the teacher is actually ready,
  not in advance. Re-running is idempotent and is also the fix for "it expired".
- **On an account that already exists** (including a Google-only one) nothing is
  created; the link then *adds* a password to the identity they already have.
  The output names the existing providers so you can see what you are changing.
- **`--continue-url` must be a Firebase authorized domain.** On prod that is
  `aipla.ku.dk` and the Cloud Run URL; on dev, `localhost` and the dev URL.

> **Before reaching for this, have them try Google sign-in once.** A Google
> account can exist on any address, not just Gmail, and plenty of Danish
> gymnasiums do federate. The `o365.` subdomain is suggestive, not proof.
> **MX records are only suggestive too**: `ind.ku.dk` is a Microsoft tenant and
> `jbruun@ind.ku.dk` signs in with Google perfectly well. Mail routing says
> nothing about which identities exist.

**After the first credential they are self-service.** `/teacher/sign-in` has a
**"Forgot your password?"** link that needs only the email — so it works from the
state a person who forgot their password is actually in. Point a teacher at that
rather than minting a fresh link for them.

It shows the same confirmation whether or not the address has an account, on
purpose: anything else turns the sign-in form into a way to ask who is
registered. So "they got no email" is **not** evidence the account is missing —
check the address they used, and their spam folder.

**Diagnosing "I was granted but still see the demo tutor":** check *which address
they signed in with* before anything else. A grant on an address they don't use
looks identical from the outside to a stale claim needing a reload — and
`list-access` looks perfectly healthy in both cases. Two of these teachers used
personal Gmail addresses on dev while the official school list gives their
institutional ones.

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

Capped at the register default ($25/month each). **Not uncapped** — the concern
that capping people already teaching could cut a lesson off is real, but the
enforcer warns at 80% before it blocks and raising a cap is one command, whereas
a limit nobody set is invisible until the bill arrives. Adjust per teacher once
you have watched usage; `--uncapped` exists if you truly need it, and warns.

---

## When it does not work

| Symptom | Cause |
|---|---|
| `Error: ... 403` on any admin call | Token minted without `--include-email`, or you are not in `admin_operator_members` |
| `404` with a page of HTML in it | The base URL is missing `/api/proxy`. The backend is a sidecar behind the frontend service, not a service of its own |
| `'prod' URL is a placeholder and gcloud could not resolve...` | gcloud is on the wrong configuration. `CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo` |
| `no such command 'list-requests'` | **A stale CLI install.** `make cli-install` — it bakes in `--no-cache`, which is exactly why this failure mode exists |
| Teacher still sees the recorded demo after a grant | They have not reloaded (the claim lands on the next `/api/teacher/bootstrap`) — **or** they signed in with a different address than the one granted. Check the address before assuming the reload |
| `404 ... has no active grant on the access register` from `invite-password` | Working as designed — `grant-access` that email first |
| Teacher's school is Microsoft-only, so Google sign-in cannot return their address | [Section 6](#6-when-google-sign-in-cannot-work-for-them) — `users invite-password` |

---

## Related

- [deploy.md](deploy.md) — how code reaches each environment
- [../deployed-urls.md](../deployed-urls.md) — what is live, and the current register state per env
- [../access-register-signoff-2026-08-12.md](../access-register-signoff-2026-08-12.md) — the roster and its sign-off
