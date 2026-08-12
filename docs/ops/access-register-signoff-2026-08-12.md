# Access register — sign-off, 2026-08-12

**Decision needed:** who may spend money on AIPLA, and who holds the researcher role.

**Why now:** `aipla.ku.dk` is live and Google sign-in is unrestricted. ACCESS-1
makes every account a `visitor` (full navigation, recorded demo tutor, no live
model, no student join codes) unless it is on this register. On the deploy that
ships it, **anyone not listed below stops being able to reach a live tutor.**

Evidence behind every row: `uv run python -m scripts.access_audit` (read-only).

---

## 1. Teachers allowed to spend

Proposed: **everyone who currently owns a class, except `taha.ayguen@redcare-pharmacy.com`.**

### prod — `aipla-prod-2026` (3 accounts, all proposed)

| Email | Classes | Evidence |
|---|---|---|
| `jbruun@ind.ku.dk` | 5 | Evaluering og Feedback E2026 · De Empirisk Eksperimentelle Videnskaber · Introduction til Universitetspædagogik. Students have joined. Active 2026-08-11. |
| `test-teacher@example.dk` | 1 | Our seed/smoke account. |
| `me@markedmondson.me` | 1 | M. |

### test — `aipla-test-2026` (2 accounts, both proposed)

`test-teacher@example.dk` · `me@markedmondson.me`

### dev — `aipla-dev-2026` (11 of 12 proposed)

| Email | Classes | Evidence |
|---|---|---|
| `aswin.rangkuti.89@gmail.com` | 6 | Physics B — Mechanics, Newton 2nd Laws. Students joined. Active 2026-08-10. |
| `me@markedmondson.me` | 3 | Fysik 9A, copilot test. Active today. |
| `m@sunholo.com` | 2 | Workshop AI Protocols. Students joined. |
| `morten.bjoernskov.nielsen@gmail.com` | 2 | 2024y Fysik A. Students joined. |
| `test-teacher@example.dk` | 2 | Seed/smoke account. |
| `jbruun@ind.ku.dk` | 1 | Students joined. |
| `test-researcher@example.dk` | 1 | Our researcher test account. |
| `jesper.bruun@gmail.com` | 1 | Demo class only. Plausibly JB's personal address — **confirm with him.** |
| `lb@toerring-gym.dk` | 1 | Demo class only, one sign-in 2026-06-30. Gymnasium domain — possibly a real teacher who never started. |
| `peterlundoeer@gmail.com` | 1 | Demo class only, one sign-in 2026-08-07. |
| `sara.oevad@gmail.com` | 1 | Demo class only, one sign-in 2026-08-07. |

### Excluded

| Email | Why |
|---|---|
| `taha.ayguen@redcare-pharmacy.com` | Signed in **once**, 2026-07-03 09:09, the morning after M's "Workshop AI Protocols" class was created — almost certainly a workshop attendee. Never returned, never edited anything, never uploaded anything. Their auto-minted join code was **never used by anyone** and expired 2026-08-02. Zero spend. |

They lose nothing they were using: as a visitor they can still sign in and
explore, with the recorded demo tutor.

---

## 2. Researcher role

Proposed: **the same four as dev, everywhere.** The claim grants cross-class
read (Research view, cross-class cost views). It does **not** grant spend
authority — those are separate lists, deliberately.

| Email | dev | test | prod |
|---|---|---|---|
| `jbruun@ind.ku.dk` | already set | account absent | **can grant now** |
| `aswin.rangkuti.89@gmail.com` | already set | account absent | account absent |
| `m@sunholo.com` | already set | account absent | account absent |
| `test-researcher@example.dk` | already set | account absent | account absent |

> **prod and test currently have ZERO researcher claims.** The pilot starts
> 2026-08-14 on prod, so without this JB has no cross-class view on the live
> environment.

**A Firebase claim needs an existing account**, so only JB can be granted on prod
today. The other three must sign in to prod/test at least once first — worth
doing before 2026-08-14 rather than discovering it during the pilot.

---

## 3. Terms of the grant

| | |
|---|---|
| Cap | **Uncapped** initially. Newly capping people already teaching could cut a lesson off mid-session. Real caps get set per teacher once usage is observed: `aiplatform users grant-access <email> --cap N`. |
| Expiry | **2026-09-15**, the contract boundary. So the failure mode of forgetting to clean up is *access lapses*, not *access persists*. Extending is one command. |
| Revocation | Immediate — also kills outstanding sessions, so it does not wait on a token refresh. |

---

## 4. Known gap

`aipla-demo-teacher` — the synthetic owner of the shared `aipla-demo-1/2/3`
codes — has **no Firebase account**, so it cannot go on an email-keyed register
at all. Those codes keep working (legacy fail-open) but can never be capped.
Acceptable now; a gap if every path must eventually be metered.

---

## 5. To apply, once signed off

```bash
# per env
aiplatform --env <env> users grant-access <email> --expires 2026-09-15T00:00:00Z
aiplatform --env <env> users grant-researcher <uid>

# verify
aiplatform --env <env> users list-access
```

**Must run in the same change window as the deploy** — between the deploy and
the grants, every teacher above is a visitor.
