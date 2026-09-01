# Runbook — who is a platform admin, and how to change it

**Audience:** whoever inherits operational ownership of AIPLA.
**Frequency:** once per environment at handover; then only when the set of admins changes.
**Last updated:** 2026-09-01 (P4.4).

## What "admin" means here

There are **two separate admin gates**, and confusing them is the main way this
goes wrong.

| Gate | Protects | Who passes it | How to change |
|---|---|---|---|
| **`admin: true` custom claim** | Direct **client-SDK Firestore** access to platform-owned collections — read/write on documents `firestore.rules` restricts to `isAdmin()` | A signed-in human | `aiplatform users grant-admin <uid>` (this runbook) |
| **`ADMIN_SEED_ALLOWED_SAS` allowlist** | The **`/api/admin/*` HTTP endpoints** — seeding, pruning, granting claims, the access register | A **service account**, not a person | Terraform (`_ADMIN_SEED_ALLOWED_SAS` substitution in both cloudbuild pipelines) |

They are deliberately not the same key. Holding the `admin` claim does **not**
let you call the endpoint that grants the `admin` claim — that still needs an
impersonated service-account token. Promoting someone is a two-key operation.

## Why this exists

Until 2026-09-01, `firestore.rules` read:

```javascript
function isAdmin() {
  return isIdentified() && request.auth.token.email == 'mark@aitanalabs.com';
}
```

Admin was **one named person, baked into security rules**. Adding a second admin
meant editing and deploying security rules, and the project could never be
handed to anyone without that edit. That is P4.4 in the
[handover maintainability audit](../../design/aipla/v1.1.0-feedback/handover-maintainability-audit.md).

The rules now read the `admin: true` custom claim instead, **with the old email
kept as a transitional fallback** so that deploying the change could not lock
out the only admin who existed at the time.

## Grant admin to someone

Claims are **per Firebase project**, so this must be run **once per environment**
(`dev`, `test`, `prod`) for each person. Granting on dev does nothing on prod.

1. **Find their Firebase UID.** They must have signed in at least once.

   ```bash
   aiplatform --env prod users list-access          # if they are on the register
   ```

   or read it from the Firebase console (Authentication → Users), or from any
   `ownerId` on a resource they created.

2. **Mint an SA token and grant.** The `--include-email` flag is not optional —
   without it the token has no email claim and the admin gate 403s.

   ```bash
   export PATH=/path/to/google-cloud-sdk/bin:$PATH

   BACKEND_URL=$(...)   # see docs/ops/deployed-urls.md
   SEED_SA=aipla-v6@aipla-prod-2026.iam.gserviceaccount.com

   AIPLATFORM_ID_TOKEN=$(gcloud auth print-identity-token \
       --impersonate-service-account="$SEED_SA" \
       --audiences="$BACKEND_URL" --include-email) \
     aiplatform --env prod users grant-admin <uid>
   ```

3. **Have them sign out and back in.** The claim lands in the ID token, and
   Firebase caches the current token for up to an hour. Until they refresh,
   `firestore.rules` still sees the old claim set. Signing out and in forces it.

4. **Verify** by having them perform an admin-only action, not by re-reading the
   grant response. The response says the claim was *written*; only a real
   request through the real rules says it is *in effect*.

Revoking is the same shape: `users revoke-admin <uid>`. It strips only the admin
bit — a researcher who was also an admin stays a researcher.

## Finishing the migration (open, as of 2026-09-01)

The email fallback in `firestore.rules` is **still present**. To close P4.4
properly:

- [ ] `grant-admin` on **dev**
- [ ] `grant-admin` on **test**
- [ ] `grant-admin` on **prod**
- [ ] Confirm admin actions still work on each, *after* a token refresh
- [ ] Delete the `request.auth.token.email == 'mark@aitanalabs.com'` clause from
      `firestore.rules::isAdmin` and deploy the rules
- [ ] Tick this off in
      [handover-package.md](../../design/aipla/v2.0.0-handover/handover-package.md)

**Do the deletion last and only after the claim is verified working on all
three.** The fallback is the thing standing between a mistake here and nobody
being able to administer prod.

## If you have locked yourself out

The `/api/admin/*` endpoints are gated by the **service account**, not by the
`admin` claim, so a lockout is recoverable without touching security rules:
mint the SA token as in step 2 and `grant-admin` yourself. The service-account
allowlist is the real root of trust; the claim is a convenience layered on top.
