# Pilot session prep — Friday 2026-08-21

**For JB and Aswin, who are running the session. M is away that day.**

Everything below is designed so that no one in the room needs admin rights.
If something here turns out to need M, that is a bug in this document.

---

## The one thing M does beforehand

Every teacher's login is **pre-created** on `aipla.ku.dk` before Friday. That
matters because the self-service "Forgot your password?" flow only works on an
account that already exists — pre-creating is what lets a teacher who cannot use
Google get in without anybody's help.

Status: see the checklist at the bottom. If a teacher is missing from it, that
teacher will not be able to set a password on the day.

---

## Where teachers go

**<https://aipla.ku.dk>** — nothing else. Not a `run.app` address, not a dev or
test link.

Logins and class join codes are **per-environment**: a code or account from dev
or test simply does not exist on `aipla.ku.dk` and produces a "not found" error
that looks exactly like a typo. Every page shows which environment it is on —
if it says anything other than production, it is the wrong link.

---

## Signing in — two doors, in this order

### 1. "Sign in with Google" — try this first

Works for any address that has a Google account, which is not only Gmail. Of the
pilot schools only Tørring is definitely on Google Workspace, but several others
may work anyway — mail routing tells you nothing about whether a Google identity
exists, so the only way to know is to try.

### 2. "Sign in with email" — the fallback

For schools with no Google account. The teacher's login already exists (M
pre-created it) but **has no password they know**, so:

1. Click **Sign in with email**
2. Type their email address — leave the password box **empty**
3. Click **"Forgot your password?"**
4. Firebase emails them a link; they choose their own password
5. Sign in with that password

**Expect the email in the spam folder.** It comes from
`aipla@aipla-prod-2026.firebaseapp.com`, and a real test send on 2026-08-17 landed
in spam on a permissive personal domain — school filters will be stricter. Treat
this as the expected path, not a caveat: tell teachers to look in spam *first*.

> Being fixed the week of 2026-08-24, deliberately not before Friday: sending
> from a verified `aipla.ku.dk` domain needs DNS records from UCPH IT and up to
> 48 hours to verify. See
> [email-deliverability-followup.md](email-deliverability-followup.md).

---

## When a teacher is stuck

The page itself names all three of us, so a stuck teacher always has somewhere to
go. Every error message also carries a raw code in brackets like
`(auth/invalid-credential)` — **get that in a screenshot**, it turns a long
diagnosis into a short one.

### The most likely cause: wrong address

Access is granted to **one exact email address**. There is no fuzzy matching — no
dot-folding, no plus-addresses. If a teacher signs in with an address that is not
on the register, they get in but see the **recorded demo tutor** instead of a live
one, and no error at all.

Three teachers had used a personal Google address with us before while being
granted on their school address. **Both addresses are now granted for all three**,
so either works and there is nothing to chase:

| Teacher | School address | Personal address |
|---|---|---|
| Peter Lundøer | `lu@o365.favrskov-gym.dk` | `peterlundoeer@gmail.com` |
| Sara Øvad Nicolaisen | `op@o365.favrskov-gym.dk` | `sara.oevad@gmail.com` |
| Morten Bjørnskov Nielsen | `mn@sctknud-gym.dk` | `morten.bjoernskov.nielsen@gmail.com` |

For these three, **the Gmail address is the easier path**: a Gmail address always
has a Google identity, so "Sign in with Google" works immediately and no password
is needed at all. Point them at that if the school address gives them trouble.

### Symptom → cause

| What the teacher sees | What it means |
|---|---|
| Signs in fine, but the tutor is a recording and there are no join codes | They are a **visitor** — either signed in with an address that is not on the register, or they need to reload (the permission lands on the next page load) |
| "That email and password did not work" | Either a genuinely wrong password, or their login was never created. Use "Forgot your password?"; if no email arrives after checking spam, it is the second one |
| Reset email never arrives | Check spam first, then check the address is spelled right. The confirmation deliberately does **not** say whether the account exists, so "no email" is not proof it is missing |
| "Email sign-in is not available on this site" | Wrong environment — check the URL is `aipla.ku.dk` |
| "Could not reach the sign-in service" | Network, not us |

### What cannot be fixed in the room

Creating a login for a teacher who has none, and granting access to an address
nobody anticipated. Both need M, who is away.

This should not come up: all 11 teachers are on the register with logins
pre-created, and the three likely alternate addresses are granted too. If it does
come up anyway, collect the details and carry on — a teacher can still explore the
whole app as a visitor with the recorded tutor, so nobody is stranded with nothing
to do, and M can fix it on Monday.

> Deliberately **not** solved by giving JB or Aswin admin rights. The only
> mechanism available today (`admin_operator_members`) also hands over
> `prune-platform-skills` and `reset-skill-access`, which can destroy the skill
> catalogue — see
> [1.1.76 delegated-programme-administration](../design/aipla/v1.1.0-feedback/delegated-programme-administration.md).
> The bounded `programmeAdmin` claim in that doc is the real fix and is still
> worth building; pre-creating everything was the cheaper way to make Friday not
> need it.

---

## Teachers on the register

All 11 school teachers, plus the four of us. Everyone is capped at $25/month
except JB and M; access runs to 2027-09-15.

| Teacher | Address on the register | School |
|---|---|---|
| Lone Brun Jakobsen | `lb@toerring-gym.dk` | Tørring |
| Heidi Larsen | `la@frederiksberggymnasium.dk` | Frederiksberg |
| Bjarni Husgaard Niclasen | `bn@nrgym.dk` | Nørre |
| Adnan Silajdzic | `asi@nrgym.dk` | Nørre |
| Morten Brydensholt | `mb@jitt.dk` | Virum |
| Peter Lundøer | `lu@o365.favrskov-gym.dk` | Favrskov |
| Sara Øvad Nicolaisen | `op@o365.favrskov-gym.dk` | Favrskov |
| Sara Mia Christiansen | `sc@vhim-gym.dk` | Vesthimmerlands |
| Frederik Faarvang Nielsen | `fh@vhim-gym.dk` | Vesthimmerlands |
| Morten Bjørnskov Nielsen | `mn@sctknud-gym.dk` | Sct Knuds |
| Anna Rani Marqversen | `ard@sctknud-gym.dk` | Sct Knuds |

Atharva Atul Dange is on `dange98@mit.edu` as a stopgap until his `ind.ku.dk`
account exists.

---

## Checklist before Friday

- [x] All 11 teachers on the prod register, capped, expiring 2027-09-15
- [x] The three alternate Gmail addresses granted too, so either address works
- [x] `v0.1.24` on prod — password login, self-serve reset, no-dead-end errors,
      and the `/auth/action` handler. Verified in the DEPLOYED bundle, not the
      source. The handler is live but NOT yet switched on: pointing Firebase at
      it is gated behind domain verification — see
      [email-deliverability-followup.md](email-deliverability-followup.md)
- [x] Logins pre-created on prod for all 11 teachers. Ten hold a password
      provider; `lb@toerring-gym.dk` already had a Google account and was left
      alone, so Lone signs in with Google
- [x] The support addresses on the sign-in page receive mail — confirmed by M,
      2026-08-17, for `mark.edmondson@ind.ku.dk` and `aswin.rangkuti@ind.ku.dk`
- [ ] **One teacher has completed the email + reset path in a real inbox.**
      The only remaining unknown, and the one most likely to fail quietly: if
      Firebase mail does not reach Danish school domains, all ten password
      logins are unusable. Nothing in CI or a smoke test can see this
- [ ] JB and Aswin have skimmed the symptom table above

> **Not cleared by the above:** `prod.tfvars` records `mark.edmondson@ind.ku.dk`
> as break-glass GCP owner "not exercised". That is about authenticating to
> Google Cloud, which is a different capability from receiving mail — confirming
> the mailbox says nothing about it. Still worth exercising before handover.

## Runbooks

- [runbooks/access-requests.md](runbooks/access-requests.md) — the register, granting, `invite-password`
- [deployed-urls.md](deployed-urls.md) — what is live where
