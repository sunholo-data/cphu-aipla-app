# Retrospective — the contracted window, 2026-05-19 → 2026-09-01

**Status**: Written 2026-09-01, two weeks before the v2.0.0 milestone and at the start of the extension.
**Audience**: M. Internal and candid — this is the input to
[the extension plan](v2.1.0-extension/plan-2026-09-to-2027-04.md), not a report to the programme.
**Covers**: the fork's initial commit (`160c9fe`, 2026-05-19) to `dfd9688` (2026-09-01).

> **Read this against the right boundary.** When most of the material below was
> written, 2026-09-15 was the end. It is not: the extension runs to **at least
> April 2027 at 2.5 days/week**. So this is a retrospective on a *phase*, and its
> job is to decide what the next phase does — not to close anything out.

## The numbers, and what they actually say

| | |
|---|---|
| Commits on `dev` | **1,143** in 15 weeks |
| Releases tagged | **32** (`v0.1.1` → `v0.1.32`) |
| Environments live | 3, all level at `v0.1.32` |
| Backend tests | 3,289 |
| Frontend tests | ~1,787 |
| AIPLA design docs | 238, of which **56 in `implemented/`** |
| Commit mix | 436 `feat` · 245 `fix` · 250 `docs` · 74 `chore` · 39 `refactor` |

**The monthly distribution is the interesting number**, not the total:

| Month | Commits | What it was |
|---|---|---|
| May | 229 | Fork, bootstrap, Jutland v0.1 — **shipped 6 days early** |
| **June** | **607** | Feature breadth. Co-pilots, sharing, MCP Apps, analytics, rich documents |
| July | 144 | Release readiness — Terraform, promotion, rubrics, curriculum, guides |
| August | 159 | Pilot, then pilot fallout |

June is more than half the project's commits. That was the pre-freeze push plus
the post-freeze build window, and it is where the product got its breadth. **July
is the month that made August survivable** — 144 commits of infrastructure,
promotion and documentation that produced no visible features and without which
there would have been no prod to run a pilot on.

**A caution about all of the above.** Commit counts measure activity, not value,
and this project's most expensive lessons cost *few* commits. The per-teacher
spend cap took one commit to fix and had silently never bound for anyone.

## What went well

**1. Every date was met, and the first one early.**
Jutland v0.1 shipped 2026-05-20, six days ahead of the 05-27 gate. The pilot
started on 08-14 as contracted. Three environments were cut, promoted and
verified before a real teacher touched prod.

**2. The pilot was a real pilot.**
2026-08-21, on prod: **12 teachers, 22 groups, 334 turns, 30-of-30 clean joins.**
No join failures at all is the number to keep — ADR-001's anonymous-group model
was the riskiest early decision and it held under real classroom load.

**3. Breadth-over-depth was the right call and was made deliberately.**
The June bet was to build many surfaces shallowly rather than few deeply. The
pilot vindicated it: the 21-August feedback contains almost no "this doesn't
work" and a great deal of "make this nicer to use". Teachers had stopped asking
whether they could build activities and started complaining about *how it feels*
to build them. That is the complaint you want.

**4. Failures were written down properly.**
Two incident post-mortems, a 28-item feedback triage with dispositions, and a
footgun table in `CLAUDE.md` that names each bug class and whether a machine or
a human catches it. The INFRA-1 writeup explicitly says *"the typo is the least
interesting part"* and goes after the three properties that let it happen. That
discipline is why the same bug classes are now gates.

**5. Footguns became gates, mostly.**
Of 17 named footgun rows: **9 enforced by CI, 6 partly enforced, 2 manual.**
Every one of those gates exists because the bug shipped at least once.

## What went badly

**1. The silent-failure class is this project's signature bug, and it recurred all year.**

Not crashes — things that returned success having done nothing, or did nothing
while looking correct:

| Instance | How long it was wrong | How it was found |
|---|---|---|
| Tutor ignored teacher-uploaded exam papers; discussed a *different* Question 5 | A whole lesson, by design not defect | A teacher noticed |
| Student writing autosave 403'd on prod for every group | Unknown; text died with the tab | Log triage after the pilot |
| Per-teacher spend cap never bound for **anyone** | 30 days, zero `budget.block` events | Deliberate audit |
| `google_project_default_service_accounts` left the SA enabled with `roles/editor` | Until audited | `check-iam-posture` |
| `make deploy-status` reported "test and prod are level" having read nothing | Until noticed | Reading the script |
| Prod's skill docs frozen at its env cut for a week | 7 days | Noticed by inspection |

**The pattern: the reassuring answer is the one a broken read produces.** Four of
the six were found by *auditing*, not by monitoring. Nothing alerted.

**2. Terraform destroyed prod (INFRA-1, 2026-08-03).**
All 77 Terraform-managed resources in `aipla-prod-2026`, from one `apply` that
inherited the previous `init`'s backend. User impact was **none — because the
pilot had not started yet.** Contained by timing, not by design. Then two
*further* resources reported success having done nothing during recovery, which
is the same bug class as above.

**3. Prod was unstartable for ~8 hours (2026-08-28/29)** on a `gcs_config` volume
mount inherited from Sunholo v5 at the fork's initial commit and **read by no
code for three months**, over three empty buckets. Removed 2026-08-31.

**4. CI parity was learned the expensive way.**
The LOCAL-MODE-AND-FORK sprint shipped 9 commits before noticing CI was red,
because it used the fast check variants. That is now a documented pre-push row.

**5. Documentation accumulated a single-machine dependency for four months.**
138 citations resolved on one laptop. Fixed 2026-09-01 (P4.2), but it sat there
through the entire window in which handover was supposedly being prepared
*in parallel* — the fan-out was meant to start week 4.

**6. The handover artefacts were outlined in July and not written.**
Five runbooks, created 2026-07-10 with a target of "complete before 09-15". All
five are still one-page "To cover" outlines. Each says *"fill from the execution
repo"*, and the execution repo has had the material for months.

## What we got wrong about the project itself

Three beliefs held for a while that turned out false. These matter more than the
bugs, because they shaped scope.

**1. "Test and prod branches are the promotion mechanism."**
They had sat at the bootstrap commit since the fork and were never used. They
were actively misleading — they produced a wrong "test/prod were never deployed"
conclusion — and were deleted 2026-07-30. Promotion is tag-based. The general
lesson is now in `CLAUDE.md`: **never infer an environment's state from git refs.**

**2. "Multi-table needs a risky id migration."**
1.1.71 was deferred during pilot week on that basis. On inspection there was no
migration to do — the key it was said to threaten is ephemeral session state.
The deferral cost three weeks and a repeated teacher request. **A deferral
premise is a claim, and it decays.**

**3. "P2, when hired."**
Every doc in this repo still says it. The role has resolved into **AD, starting
~1 Oct**, and student helpers (Sophie coordinating, Aswin teacher-side, Atul
student-side) arrived and appear in no ownership table anywhere.

## The contracted bar, honestly scored

Against the Week-17 definition of done — full evidence in
[handover-package.md](v2.0.0-handover/handover-package.md):

- ✅ Pilot with ≥3 teachers — **met, 4× over** (12)
- ✅ Capability-floor report v1 — published, plus an institutional extract
- ✅ Strand B prototype — three sims live on all three environments
- ✅ Self-host notes IT can estimate from — met at the contracted bar
- ❌ **Strand C scoping note — not written. Due 2026-09-09.**
- ⚠️ Runbooks — five outlined, zero written
- ⚠️ Eval automation — runnable by hand, not automated
- ⚠️ Co-owner demonstrated on each artefact — **no demonstration recorded anywhere**
- ❌ DPIA / consent — **no artefact in either repo.** JB-owned; `timeline.qmd`
  wanted confirmation "by early August at latest" and none is recorded

**The pattern in the misses is uniform: everything unmet is a document, and
everything met is running code.** Fifteen weeks of build pressure crowded out
the writing, and the writing is what the milestone is actually graded on.

## The five lessons worth carrying into the extension

1. **Audit for silence.** The failure mode here is not the exception, it is the
   confident wrong answer. Anything that reports a status needs a path where
   "could not read" is distinguishable from "fine".
2. **A deferral premise decays.** Re-check the reason before honouring a deferral;
   twice now the reason had evaporated.
3. **Documents lose to code under deadline, every time.** If the writing is a
   deliverable, it needs its own protected slot, not the gaps.
4. **The teachers are ahead of the roadmap.** Every one of the three August
   feedback clusters was ergonomics, not capability. Plan for polish, not breadth.
5. **July was the most valuable month and looked like the least productive one.**
   Guard the equivalent slot in the next phase against feature pressure.
