# Follow-up — password-reset email deliverability

**Status:** Deferred to the week of **2026-08-24**. Explicitly NOT before the
first pilot session (Fri 2026-08-21) — domain verification takes up to 48 hours
and depends on UCPH IT, so Friday runs without it.

**Owner:** M. **Raised:** 2026-08-17/18, from a real send.

---

## What happened

Ten of the eleven pilot teachers have an email/password login (the eleventh,
`lb@toerring-gym.dk`, has a Google account). They set their own password via
"Forgot your password?" on `/teacher/sign-in`, which sends a Firebase email.

A real test send to `me@markedmondson.me` on 2026-08-17 **landed in spam**, and
its link was:

```
https://aipla-prod-2026.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=...
```

Two distinct problems, often conflated:

| | Cause | Fixes |
|---|---|---|
| **Deliverability** — it goes to spam | The **sender**: `aipla@aipla-prod-2026.firebaseapp.com`, no SPF/DKIM for our domain | Custom sending domain (this doc) |
| **Trust** — teachers may not click | The **link domain** has no visible relationship to KU. It is shaped like phishing | `/auth/action` handler (shipped) + `callbackUri` switch (blocked) |

`me@markedmondson.me` is a permissive personal domain. The gymnasium domains
(`sctknud-gym.dk`, `vhim-gym.dk`, `nrgym.dk`, `frederiksberggymnasium.dk`,
`o365.favrskov-gym.dk`) will be stricter, and several are Microsoft 365 tenants.

## What is already done

- **`/auth/action`** — a custom Firebase email-action handler, live on prod in
  `v0.1.24`. Verified end to end on dev in a real browser with a real `oobCode`:
  code validated, account named, password set, sign-in with that password
  returned a valid token. Handles `verifyEmail` and `recoverEmail` too, because
  `callbackUri` is one setting covering every action type.
- **`senderLocalPart`** `noreply` → `aipla`, and **`replyTo`** →
  `mark.edmondson@ind.ku.dk`. Both applied via the admin API (these two fields
  are not gated).

## What is blocked, and why

`subject`, `body` and **`callbackUri`** all refuse via the admin API with
`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, and the console gates them behind
**Custom domain for email templates** — i.e. verifying a sending domain.

So the shipped `/auth/action` page **cannot be switched on** until this is done.
That is why the page is live but the links still point at `firebaseapp.com`.

## The DNS records — one is a REPLACE, not an ADD

`aipla.ku.dk` **already has an SPF record**: `v=spf1 -all` ("this domain sends no
mail, reject everything"). A domain may only have ONE SPF record.

**Adding Firebase's SPF alongside it produces a permerror and breaks mail
outright; leaving `-all` in place hard-fails every message Firebase sends.** The
Firebase dialog says "add the following records", which is wrong for this one.

| Action | Host | Type | Value |
|---|---|---|---|
| **REPLACE** `v=spf1 -all` | `aipla.ku.dk` | TXT | `v=spf1 include:_spf.firebasemail.com ~all` |
| ADD | `aipla.ku.dk` | TXT | `firebase=aipla-prod-2026` |
| ADD | `firebase1._domainkey.aipla.ku.dk` | CNAME | `mail-aipla-ku-dk.dkim1._domainkey.firebasemail.com.` |
| ADD | `firebase2._domainkey.aipla.ku.dk` | CNAME | `mail-aipla-ku-dk.dkim2._domainkey.firebasemail.com.` |

Checked 2026-08-18: `aipla.ku.dk` has no MX and no current mail flow, and neither
DKIM CNAME exists. `ku.dk`'s own SPF is separate and must not be touched.

## Steps, in order

1. UCPH IT applies the four records above (the SPF one as a **replacement**).
2. Confirm propagation:
   ```bash
   dig +short TXT aipla.ku.dk                          # expect ONE spf1 record, firebasemail
   dig +short TXT aipla.ku.dk | grep -c spf1           # must be 1, never 2
   dig +short CNAME firebase1._domainkey.aipla.ku.dk
   dig +short CNAME firebase2._domainkey.aipla.ku.dk
   ```
3. Finish "Custom domain for email templates" in the Firebase console
   (`aipla-prod-2026` → Authentication → Templates). Up to 48h to verify.
4. Set **Customise action URL** → `https://aipla.ku.dk/auth/action`. Safe at any
   time once the page is live: already-issued `oobCode`s keep working, because
   Firebase validates the code, not the page hosting it.
5. Paste the bilingual subject/body (below).
6. Re-test: trigger a reset from `aipla.ku.dk/teacher/sign-in` for a real
   address, and confirm it reaches the **inbox**, not spam, with an
   `aipla.ku.dk` link.
7. Repeat 3–5 for `aipla-dev-2026` and `aipla-test-2026` if wanted; dev and test
   are unaffected by this and can stay as they are.

## Template copy to paste at step 5

Subject:

```
AIPLA (Københavns Universitet): vælg din adgangskode / set your password
```

Body (HTML). Assumes the action URL has already been switched at step 4 — if
pasting before that, add a line explaining that the link domain differs from
`aipla.ku.dk`:

```html
<p>Hej,</p>
<p>Du har bedt om at vælge eller nulstille din adgangskode til <strong>AIPLA</strong>
&mdash; AI i fysikundervisning, Institut for Naturfagenes Didaktik, Københavns
Universitet &mdash; for kontoen <strong>%EMAIL%</strong>.</p>
<p>Klik her for at vælge en adgangskode:</p>
<p><a href='%LINK%'>%LINK%</a></p>
<p>Hvis du ikke har bedt om dette, kan du roligt ignorere denne e-mail.</p>
<hr>
<p>Hello,</p>
<p>You asked to set or reset your password for <strong>AIPLA</strong> &mdash; AI in
Physics Learning and Assessment, Department of Science Education, University of
Copenhagen &mdash; for the account <strong>%EMAIL%</strong>.</p>
<p>Use the link above to choose a password, then sign in at
<a href='https://aipla.ku.dk/teacher/sign-in'>aipla.ku.dk</a>.</p>
<p>If you did not ask for this, you can safely ignore this email.</p>
<p>Spørgsmål? / Questions? Reply to this email, or contact Jesper Bruun
(jbruun@ind.ku.dk) or Aswin Rangkuti (aswin.rangkuti@ind.ku.dk).</p>
```

## Until then

Friday runs on the current setup. **"Check your spam folder" is the expected
path, not a caveat** — say it that way to teachers rather than as a footnote.
See [pilot-session-2026-08-21-prep.md](pilot-session-2026-08-21-prep.md).

## Related

- [runbooks/access-requests.md](runbooks/access-requests.md) — the register, `invite-password`
- `frontend/src/app/(site)/auth/action/page.tsx` — the handler this unblocks
