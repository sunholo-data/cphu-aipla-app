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

**The email comes from a `firebaseapp.com` address and Danish school filters
often bin it.** Tell them to check spam *before* concluding it did not arrive.

---

## When a teacher is stuck

The page itself names all three of us, so a stuck teacher always has somewhere to
go. Every error message also carries a raw code in brackets like
`(auth/invalid-credential)` — **get that in a screenshot**, it turns a long
diagnosis into a short one.

### The most likely cause, by far: wrong address

Access is granted to **one exact email address**. There is no fuzzy matching — no
dot-folding, no plus-addresses. If a teacher signs in with a different address
than the one on the register, they get in but see the **recorded demo tutor**
instead of a live one, and no error at all.

Three teachers are known to have used a personal address before, and are granted
on their **school** address:

| Granted on | Has previously used |
|---|---|
| `lu@o365.favrskov-gym.dk` (Peter Lundøer) | `peterlundoeer@gmail.com` |
| `op@o365.favrskov-gym.dk` (Sara Øvad Nicolaisen) | `sara.oevad@gmail.com` |
| `mn@sctknud-gym.dk` (Morten Bjørnskov Nielsen) | `morten.bjoernskov.nielsen@gmail.com` |

**Worth asking these three in advance which address they will use.** If they use
the personal one, they need a second grant on it — one command, but only M can
run it, so catching it before Friday matters.

### Symptom → cause

| What the teacher sees | What it means |
|---|---|
| Signs in fine, but the tutor is a recording and there are no join codes | They are a **visitor** — either signed in with an address that is not on the register, or they need to reload (the permission lands on the next page load) |
| "That email and password did not work" | Either a genuinely wrong password, or their login was never created. Use "Forgot your password?"; if no email arrives after checking spam, it is the second one |
| Reset email never arrives | Check spam first, then check the address is spelled right. The confirmation deliberately does **not** say whether the account exists, so "no email" is not proof it is missing |
| "Email sign-in is not available on this site" | Wrong environment — check the URL is `aipla.ku.dk` |
| "Could not reach the sign-in service" | Network, not us |

### What cannot be fixed in the room

Creating a login for a teacher who has none, and granting access to a new
address. Both need M. Collect the details and carry on — a teacher can still
explore the whole app as a visitor with the recorded tutor, so nobody is stranded
with nothing to do.

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

- [ ] `v0.1.23` promoted to prod (carries the password login and the reset flow)
- [ ] Logins pre-created on prod for all 11 teachers
- [ ] Peter, Sara Ø. and Morten B. asked which address they will use
- [ ] One teacher has actually completed the email + reset path end to end —
      a real inbox is the only test of whether Firebase mail gets through
- [ ] JB and Aswin have skimmed the symptom table above

## Runbooks

- [runbooks/access-requests.md](runbooks/access-requests.md) — the register, granting, `invite-password`
- [deployed-urls.md](deployed-urls.md) — what is live where
