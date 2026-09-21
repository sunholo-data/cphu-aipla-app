# Sprint Plan: RSCH-ONBOARD-1 — who is stuck, what is next, and a class handed over ready (1.1.124 M0–M3)

## Summary

Every granted teacher already gets a demo class, so the stuck state is *"demo
only, N days"* and nothing shows it. This sprint derives a **stage** per teacher
from state we already store, shows it to the researcher (sortable) and to the
teacher (as a checklist whose steps link to the control), and gives a researcher
one action to hand a teacher a class that is ready to share.

**Status:** ✅ **SHIPPED dev 2026-09-21** — all four milestones, ~1d actual. M3's copilot half landed too: `scopePrefix` was the mechanism, no new plumbing.
**Duration:** ~2d (actual ~1d) · **Scope:** Fullstack · **Design doc:** [1.1.124](teacher-onboarding-scaffold.md)
**Builds on:** [RSCH-EDIT-1](researcher-acts-for-teacher-sprint.md) (shipped dev 2026-09-21) — M2 here creates activities *owned by the teacher* the way 1.1.123 M2 does.

## Decisions taken in planning

- **The demo class gets a marker.** `Class.demo: bool` stamped by the seed;
  the stage function accepts `demo or name == DEMO_CLASS_NAME` so the ~30
  existing demo classes are recognised without a backfill.
- **One stage function, two consumers.** `onboarding/stage.py` computes the
  stage from `(register row, owned classes, activity summary)`. The programme
  page gets it per granted teacher from a new researcher-only endpoint; the
  teacher's own checklist gets it from the same function via
  `GET /api/teacher/stage`. Two views, one definition — the drift the
  consolidation doc warns about is avoided by construction.
- **The checklist mounts at the top of `/teacher/classes` (own scope)**, not on
  a new `/teacher` home. `/teacher` is a redirect to Classes today and the
  consolidation doc (1.1.125) will decide what Home becomes; putting the card
  where teachers already land costs nothing to move later.

## Milestones

### M0 — See who is stuck · backend + frontend · ~0.6d
- [ ] `Class.demo` field; `seed_demo_for_teacher` sets it.
- [ ] `onboarding/stage.py`: `compute_stage(...) -> TeacherStage {stage, since, days, nextStep}` with the six stages (invited · demo_only · no_code · no_activity · waiting · live). Pure function, unit-tested per stage.
- [ ] `GET /api/programme/onboarding` (researcher OR programme admin — same audience as the register): every register row + its stage. Reuses `list_all_classes` and `summarize_activity_for_group_codes`.
- [ ] `/teacher/programme`: a **Stage** column, sortable, each cell naming the next step.
- [ ] `/teacher/classes` All scope: a stage chip per class, derived client-side from what the row already has (`demo`, codes, activities, turns).

### M1 — The first-run checklist · fullstack · ~0.6d
- [ ] `GET /api/teacher/stage`: the caller's own stage.
- [ ] `GettingStartedCard` on `/teacher/classes` (own scope): five steps, each done/undone from the stage, each undone step linking to the control (create class → the form; mint code → the class page; add activity → the class page's picker with **Adopt** offered first; share link → copy; first conversation → nothing to click). Hidden once `live`; dismissible after.
- [ ] Copy in a `copy` object (1.1.108 M4).

### M2 — Hand a teacher a ready class · fullstack · ~0.5d
- [ ] `POST /api/classes/for-teacher` (researcher-only): `{ownerUid, name, templateClassId?}` → class owned by the teacher; the template's activities copied with `copy_activity(new_owner_uid=teacher)`, assigned; one code minted **if the teacher can spend** (their tier, not the researcher's); `lastEditedBy` stamped.
- [ ] `/teacher/classes` All scope: **Set up a class for a teacher…** → dialog (teacher from the register rows that have a uid, name, template from the researcher's own classes).
- [ ] Tests: ownership, code-only-if-pilot, template copy provenance, 404 for a plain teacher.

### M3 — Say the same thing everywhere · ~0.25d
- [ ] `t1`/`t2` guides (en + da): one line pointing at the checklist.
- [ ] `aipla-help` copilot: the stage as one line of context so *"how do I start?"* answers with the next step. Only if the copilot's input plumbing accepts context without a new mechanism; otherwise deferred to 1.1.125 M3 where the single copilot entry is built.

## Acceptance

- JB opens Programme and reads, per granted teacher, *invited 12 days ago — not signed in* / *demo only — 9 days* / … / *live*, sorted by stuck-longest.
- A new teacher sees the checklist after the demo seed, and it goes away on its own once students talk.
- JB takes a teacher from *demo only* to *waiting for students* in one dialog.

## Out of scope

Telemetry (1.1.96) · reminders to teachers · demo-class content review (AR).
