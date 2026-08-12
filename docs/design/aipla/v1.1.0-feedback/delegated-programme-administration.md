# Delegated programme administration — who else can admit a teacher

**Status:** Proposed (2026-08-12)
**Priority:** **P1** — the bus-factor half is arguably P0; the pilot starts 2026-08-14 and one person can currently admit a teacher
**Estimated:** ~2d — M1 read-only view ~0.5d · M2 the claim + bounded writes ~1.5d
**Scope:** Fullstack — a new `/api/programme/*` router, a `programmeAdmin` custom claim, a `/teacher/programme` surface, CLI
**Dependencies:** [1.1.75 public-access-tiers-and-spend-control](public-access-tiers-and-spend-control.md) (SHIPPED — the register this administers); [1.1.5 researcher-role](researcher-role.md) (SHIPPED — the claim pattern, and the role this deliberately does *not* extend); RUBRIC-1 M3 `_LensConfigPanel` (SHIPPED — the precedent for a claim-gated config-write surface inside the teacher app)
**Source:** M, 2026-08-12 — *"so can a researcher role easily upgrade a teacher?"*

---

## Problem

The answer to the question was no, and the reason turned out to matter more than
the question.

### One person can admit a teacher

Verified end to end on 2026-08-12:

| Link | Value |
|---|---|
| `/api/admin/access/grant` requires | a Google-signed ID token whose email is in `ADMIN_SEED_ALLOWED_SAS` |
| `ADMIN_SEED_ALLOWED_SAS` (dev and prod) | `aipla-v6@<project>.iam.gserviceaccount.com` — one service account |
| Who holds `serviceAccountTokenCreator` on it (prod) | `user:m@sunholo.com`, and the SA itself |

So **M is the only human who can grant spend authority, on all three
environments**. The teacher pilot starts 2026-08-14. A bus factor of one on the
gate that decides whether a class can teach is not a posture to carry into it,
and it is not a posture to hand over in September either.

### Researchers cannot even see the queue

`role:researcher` grants cross-class *read* of teaching data. It appears nowhere
in the admin gate — correctly — but the consequence is that JB and AR, who are
the people most likely to know that a given teacher should be admitted, cannot
see who has asked, cannot see who is already on the register, and have no route
to act except messaging M.

### Why the obvious fix is the wrong one

Adding JB and AR to `admin_operator_members` is one line per env and no code. It
also hands them the whole of `/api/admin/*` — including `prune-platform-skills`
and `reset-skill-access`, which are destructive to the skill catalogue. Granting
catalogue-destruction in order to grant teacher-invitation is a bad trade, and
the kind of over-grant that gets inherited at handover and never revisited.

**Impact:** blocks nobody today, because M is available. It blocks everything on
the day M is not.

---

## Goals

**Primary goal:** more than one person can admit a teacher, without anyone
gaining a capability they do not need.

**Success metrics:**

- At least two named people can admit a teacher to the pilot on prod.
- A delegated admin can grant **only** `pilot`, **only** up to a bounded cap, and
  **cannot** raise that bound, grant their own role, or reach any other admin
  endpoint.
- Researchers can see the register and the request queue without being able to
  change either.
- Every register write records who made it and by which route, so an SA-issued
  grant is distinguishable from a delegated one.

**Non-goals:**

- **Extending `role:researcher` to cover this.** See below — it is the central
  design decision, not an omission.
- Replacing the SA path. It stays as the unbounded escape hatch and the only way
  to mint the new claim.
- A general RBAC system. Two capabilities, one bound. If a third appears, revisit.
- Self-service escalation of any kind.

---

## Framework-native capability check (5b-ter)

- **The claim mechanism already exists** — `role:researcher` is minted by an
  SA-allowlisted admin endpoint and read off the decoded token
  (`auth/firebase_auth.py`). This adds a claim key; it invents no auth machinery.
- **The claim-gated write surface already exists** — `_LensConfigPanel`
  (RUBRIC-1 M3) is a researcher-only *config-write* panel inside the teacher app,
  whose API "404s everyone else". That is the pattern, including the 404 choice:
  a surface nobody else should know about should not announce itself with a 403.
- **The register API already exists** (1.1.75). This adds a second, narrower door
  to it rather than a second implementation.
- No open protocol covers delegated administration of a private access register.
  Scored 0 rather than −1 in the axioms: there is no standard being ignored.

---

## Design

### The capability split — why not just widen `researcher`

`role:researcher` currently means *"may read teaching data across every class
for research purposes"*. The proposal is to add a capability meaning *"may
commit money on the programme's behalf"*.

These are different questions about a person, and they have different answer
sets. A research collaborator analysing transcripts is not automatically someone
who should be able to raise a spend cap; a departmental coordinator who admits
teachers has no reason to read student transcripts. Today the same three people
happen to want both, which is exactly the situation in which conflating them
feels harmless and later turns out not to be.

So: **a separate claim key, not a new value of `role`.**

```
role:        "researcher"     # unchanged — cross-class READ
programmeAdmin: true          # NEW — bounded register WRITE
```

A separate key rather than `role: "programme-admin"` because `role` is
single-valued: making them alternatives would force JB to choose between reading
research data and admitting a teacher. `accessTier` (1.1.75) already established
that independent capabilities get independent keys.

### Two doors to one register

The existing SA-gated door is not loosened. A second, narrower door is added
beside it:

```
/api/admin/access/*        SA allowlist        unbounded    M, Cloud Build, ops
    grant any tier, any cap, revoke, mint the programmeAdmin claim

/api/programme/access/*    Firebase teacher    BOUNDED      delegated admins
    grant `pilot` up to PROGRAMME_ADMIN_MAX_CAP_USD; revoke; read
                           + researcher                     read only
```

`/api/programme/*` is a new router with its own guard. It never calls
`_assert_caller_is_service_account`, and the SA router never checks the claim —
so neither can be widened by accident while editing the other.

### What a programme admin may do, exactly

| Action | Programme admin | Researcher | SA (M) |
|---|---|---|---|
| Read the register | yes | yes | yes |
| Read the request queue | yes | yes | yes |
| Grant `pilot`, cap ≤ bound | **yes** | no | yes |
| Grant cap > bound | **no** (403) | no | yes |
| Grant tier `visitor` (a downgrade) | yes | no | yes |
| Revoke | **yes** | no | yes |
| Mint/remove `programmeAdmin` | **no** (403) | no | yes |
| Anything else under `/api/admin/*` | **no** (404) | no | yes |

**Revoke is delegated; raising a cap is not.** The asymmetry is deliberate:
revoking reduces spend and an accidental revoke is one command to undo, whereas
an over-generous cap is money already gone by the time anyone notices.

**No privilege propagation.** A programme admin cannot mint the claim they hold.
That is the classic escalation and the one hard "no" in the table; only the SA
path mints it.

### The bounds

```python
# env, per environment, so prod can be tighter than dev
PROGRAMME_ADMIN_MAX_CAP_USD = 50.0     # default; the ceiling on a delegated grant
PROGRAMME_ADMIN_EMAIL_DOMAINS = "ku.dk"  # optional; delegated grants restricted to these
```

The domain bound is the one worth arguing for. Delegated authority bounded only
in *amount* still lets a delegate admit anyone on the internet; bounded in
amount **and audience** it can only admit people from the institution the
programme is actually for. Empty means unrestricted, and M's SA path is
unrestricted regardless — so this constrains delegation, not the programme.

### Audit — telling the two doors apart

`teacher_access` already records `grantedBy`. Add one field so the route is
visible, not just the person:

```
grantedBy:    "jbruun@ind.ku.dk"
grantedVia:   "programme-admin" | "service-account"   # NEW
```

Without it, a delegated grant and an SA grant are indistinguishable after the
fact, and "how did this account get access?" becomes unanswerable — which is the
question anyone reviewing a spend surprise asks first.

### The surface — `/teacher/programme`

A new section in the teacher app, rendered only for a researcher or a programme
admin. Not under `/teacher/research/*`: a programme admin is not necessarily a
researcher, and filing an administrative surface under "research" would make the
naming lie about who it is for.

```
/teacher/programme
  ├── Register        who may spend, their cap, expiry, who granted it and how
  └── Requests        the queue from POST /api/teacher/access-request
```

**Read-only and write are the same surface at different privilege levels** — a
researcher sees exactly what a programme admin sees, minus the buttons. That is
deliberate: two surfaces would drift, and the read-only view's whole value is
that the person looking at it can tell you what they see.

Modelled on the existing researcher precedent (`_LensConfigPanel`), including
its API-shape choice: **`/api/programme/*` 404s for a caller with neither
claim**, rather than 403. A surface that should be invisible should not announce
its existence.

Grant is a form, not a free-for-all: email, cap (capped at the bound by the
input itself, and re-checked server-side), expiry defaulted to the contract
boundary, and a required note. The note is required because "why is this person
on the register" is the thing nobody remembers in six weeks.

### Flow

```
JB opens /teacher/programme
        │  claim: role:researcher            -> Register + Requests, read-only
        │  claim: programmeAdmin:true        -> the same, plus Grant / Revoke
        ▼
   Grant anna@ku.dk, cap $25, expires 2026-09-15, note "Cohort A"
        │
        ▼
   POST /api/programme/access/grant   (Firebase teacher token)
        ├── assert_programme_admin           -> 404 if neither claim
        ├── cap <= PROGRAMME_ADMIN_MAX_CAP_USD?   -> 403 with the bound named
        ├── domain in PROGRAMME_ADMIN_EMAIL_DOMAINS? -> 403
        └── grant_access(..., granted_by=JB, granted_via="programme-admin")
                │
                ▼
        same register, same claim sync, same cache invalidation as the SA path
```

---

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | An admin surface; nothing on a student path. |
| 2 | EARNED TRUST | +1 | `grantedVia` makes "how did this account get access?" answerable. A read-only view means researchers report what they *see*, not what they were told. |
| 3 | SKILLS, NOT FEATURES | 0 | Orthogonal to skills. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involved. |
| 5 | GRACEFUL DEGRADATION | +1 | The SA path remains as the unbounded fallback; if the claim mechanism misbehaves, M can still admit anyone. |
| 6 | PROTOCOL OVER CUSTOM | 0 | No open protocol for this; no standard ignored. |
| 7 | API FIRST | +1 | `/api/programme/*` + CLI first; the panel consumes them. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Every delegated write is attributed by person *and* route. |
| 9 | SECURE BY CONSTRUCTION | +1 | Bounded in amount and audience, no privilege propagation, separate router so neither gate widens by editing the other. Strictly narrower than the alternative (adding people to `admin_operator_members`). |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Bounds enforced server-side; the client's cap input is a convenience, re-checked on the server. |
| | **Net Score** | **+6** | Threshold: ≥ +4 |

---

## Implementation plan

### M1 — read the register (~0.5d)

The half that removes the visibility problem without granting anything.

- [ ] `/api/programme/access/list` + `/api/programme/access/requests`, GET, allowed for `is_researcher` **or** `programmeAdmin`; 404 otherwise (~80 LOC)
- [ ] `/teacher/programme` page + nav entry, visible only with either claim (~150 LOC)
- [ ] Register and Requests tables, read-only (~120 LOC)
- [ ] Tests: a plain teacher gets 404; a researcher gets 200 and sees no buttons

### M2 — bounded write (~1.5d)

- [ ] `programmeAdmin` claim: read in `_user_from_decoded_token`, `User.is_programme_admin` (~30 LOC)
- [ ] `assert_programme_admin` guard (404, not 403) (~30 LOC)
- [ ] `POST /api/programme/access/grant` + `/revoke` with both bounds enforced server-side (~150 LOC)
- [ ] `grantedVia` on the register + surfaced in the listing (~40 LOC)
- [ ] `aiplatform users grant-programme-admin <uid>` / `revoke-…` — SA-gated, the only way to mint it (~80 LOC)
- [ ] Grant/revoke UI on the same panel, shown only to a programme admin (~150 LOC)
- [ ] Tests below

**Sequencing:** M1 is independently useful and independently safe — it grants
read to people who already have far broader read. Ship it first even if M2 slips.

---

## Testing strategy

The tests that matter here are all refusals.

- [ ] A plain teacher: 404 on every `/api/programme/*` route, read and write
- [ ] A researcher: 200 on GET, **404 on every write**
- [ ] A programme admin granting cap ≤ bound → 200
- [ ] A programme admin granting cap > bound → **403, and nothing is written**
- [ ] A programme admin granting outside the allowed domains → 403
- [ ] **A programme admin cannot mint `programmeAdmin`** — the escalation test
- [ ] A programme admin cannot reach `/api/admin/*` (the SA gate is unchanged)
- [ ] `grantedVia` is `"programme-admin"` on the delegated path and
      `"service-account"` on the SA path
- [ ] The bound is read from env per environment, so prod can be tighter than dev
- [ ] Revoking via the delegated path still kills refresh tokens (1.1.75's rule)

---

## Security considerations

- **Privilege propagation is the whole risk.** A delegated admin who can mint
  their own claim is an unbounded admin. One test, one guard, named as such.
- **The bounds are server-side.** A client-side cap input is a convenience;
  re-checked on every write.
- **404 over 403** on `/api/programme/*`, matching `_LensConfigPanel`: an
  administrative surface should not confirm its existence to a caller who may
  not use it.
- **The SA path is untouched.** No change to `ADMIN_SEED_ALLOWED_SAS`, no change
  to `admin_operator_members`. If this design is wrong, the blast radius is a
  bounded delegated grant, not the admin surface.
- **`teacher_access` stays denied to clients** in `firestore.rules` — all reads
  go through the backend, which applies the claim gate.

---

## Open questions

- **Is the domain bound wanted?** It makes delegation strictly safer but would
  block admitting, say, a gymnasium teacher on a school domain (`lb@toerring-gym.dk`
  is already on the dev register). Suggest shipping it configurable and empty on
  dev, `ku.dk` + known school domains on prod.
- **What is the right cap bound?** $50 is a guess. Answerable once `class_spend`
  has a month of pilot data; low and raisable is the safe direction.
- **Should a programme admin be able to grant a longer expiry than the contract
  boundary?** Suggest no — the delegated path caps expiry at `2026-09-15` too,
  so delegation cannot outlive the engagement.
- **Who gets the claim on day one?** JB certainly. AR probably. Worth deciding
  alongside the [access-register sign-off](../../../ops/access-register-signoff-2026-08-12.md).

---

## Related documents

- [1.1.75 public-access-tiers-and-spend-control.md](public-access-tiers-and-spend-control.md) — the register this administers, and where this question was first raised and deferred
- [1.1.5 researcher-role.md](researcher-role.md) — the claim pattern, and the role this deliberately does not extend
- [docs/ops/access-register-signoff-2026-08-12.md](../../../ops/access-register-signoff-2026-08-12.md) — the current roster
