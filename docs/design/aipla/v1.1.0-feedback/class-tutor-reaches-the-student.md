# The class tutor picker was a no-op, and the class could not be renamed

**Status**: **SHIPPED (dev) 2026-09-14** — 1.1.112
**Priority**: **P0** for the tutor half. The tutor layer is the extension's headline discipline-layer capability and a teacher on prod could not use it at all; 1.1.92's comparison matrix needs arms that a teacher can actually select
**Estimated / actual**: ~0.75d
**Scope**: Backend — three identity read sites routed through the existing 1.1.91 join; one Firestore field name. Frontend — mount a rename control on an endpoint that already existed
**Source**: Aswin (AD-adjacent researcher, pilot teacher account) on prod, 2026-09-14: *"I am looking forward to try out the new tutor persona. As I mentioned, I am not able to change the tutor and It is still set as Sofie. I am still working in Fysik C Energi. Also, is it possible to change the name of the class? I can not find a way to do that"*
**Related**: [researcher-configurable-tutors.md](researcher-configurable-tutors.md) (1.1.91, the layer this repairs) · [tutors-handover-2026-09-10.md](tutors-handover-2026-09-10.md) (its handover, whose rule 1 constrains the fix) · [register-belongs-to-the-approach.md](register-belongs-to-the-approach.md) (1.1.111)

## What was wrong

### The tutor picker changed nothing a student could perceive

A `Tutor` bundles four things: **persona** (name + avatar), **voice**, **tone**
(`interaction_style`) and **pedagogy** (`framework_id`). 1.1.91 shipped
`adk/tutor_resolution.py` to resolve all four in one place, and that module is
correct — `resolve_teaching()` has always honoured `activity tutor > CLASS tutor >
the activity's pre-tutor fields > class persona > default`.

**It had one consumer.** `resolve_teaching()` was called only by
`resolve_teaching_context()`, and that context was read by only two things: the
framework preamble (`adk/tutor_framework.py`) and the chat-log stamp
(`adk/agent.py`). The three axes a student actually perceives never reached it:

| What the student sees | Resolved in | Read |
|---|---|---|
| Name + avatar | `protocols/activity_config_routes.py` | `resolve_persona_chain(cfg.persona, cls.persona)` |
| Voice | `protocols/voice_routes.py` | the same chain |
| Tone | `adk/interaction_style.py` | `cls.persona`'s `interaction_style` |

All three read `class.persona`. `db/classes.py:update_class_tutor()` writes only
`tutorId` — it has never written `persona`. So a teacher who picked a tutor
changed the framework preamble and the log column, and nothing else.

**And for every tutor a teacher can actually pick, it changed nothing at all.**
No base tutor carries a framework, deliberately (handover rule 2, and the
safety property of the catalogue). The seven base tutors are the whole picker for
a teacher — variants are researcher-authored. So picking one moved the only wired
axis from `null` to `null`. A complete no-op, which is exactly what Aswin saw.

The 1.1.91 work was not sloppy about this; it was *specific*. `TutorPicker`'s
docstring promises "picking a card sets the avatar, the voice, the tone and the
pedagogy together", the design doc's TUTOR-3 row claims "one resolution path"
shipped, and `d05500d2` removed the old persona panel on the strength of that
claim — so after 2026-09-10 there was **no reachable control of any kind** for
tutor identity on prod. `InheritedPersona` on the activity form is read-only.

### The class could not be renamed

`PATCH /api/classes/{id}` accepts `{name, description, cohort}` and has since the
permission model landed. `patchClass()` is in `frontend/src/lib/teacherApi.ts`
with a passing test. **Nothing in any UI called it.** The whole stack existed and
the control was never mounted.

## The fix

### One join, three consumers — not three corrected chains

`resolve_active_teaching(activity_id, *, group_tags, cfg)` is now the entry point
every read uses, sharing `_resolve_for_activity` with `resolve_teaching_context`
so the log and the prompt cannot disagree. Each of the three sites puts
`.tutor`'s value at the **head** of its existing chain and leaves its pre-tutor
fallback intact below.

Three corrected chains was the obvious cheap fix and is the wrong one: a fourth
independent derivation of "which tutor is teaching" is precisely the bug that had
just been paid for. Compare the money-gate footgun, where a second derivation of
the same join silently meant ALLOW.

**Why not just have `update_class_tutor` also stamp `persona`?** It would have
worked today — base tutor ids equal persona ids — for ~30 minutes' work. Rejected:
it breaks for any variant whose `persona_id` differs from its `id`, and it is the
same denormalised-join shape the footgun table already has a row for. Two stored
fields that must agree is the drift, not the fix for it.

### The passthrough guarantee is what makes this small

Handover rule 1: a class or activity with **no** tutor must compose
byte-identically to before any of this existed. That holds by construction —
`resolve_teaching` returns `tutor=None` and the pre-tutor path below decides
exactly as it always did. Each section of the regression file carries a
passthrough test beside its bug test for this reason, and
`resolve_active_teaching` never raises (Axiom 5: a failed read costs the tutor's
clothes, not the lesson).

### A second, quieter bug found on the way

`update_class_tutor` cleared the stale per-class voice override by writing
`voiceSettings: None`. The field is `voice`. `Class` permits extra keys, so the
clear was **inert** and a legacy override went on speaking over every tutor
anyone picked — the exact bug the sibling `update_class_persona` docstring says
that line exists to prevent. Now `voice`, with a test.

### Rename, mounted

`ClassDetailsPanel` (name + description) in the class-settings section of
`/teacher/classes/[id]`, calling the `patchClass` that already existed.

**Renaming in place, not duplicate-and-delete.** Duplicating was considered as
the cheaper shape and is worse on every axis: a new class mints new group codes,
so every join link already handed out dies (the footgun that cost a teacher ~2h
on 2026-08-04); chat logs, rubric runs and concept progress are keyed on
`class_id`, so a duplicate splits one class's evidence across two containers —
the "looks like evidence but isn't" failure this repo refuses everywhere else;
and a correct duplicate has to deep-copy activities, voice, tutor, capabilities
and groups, which is *more* code than mounting a form.

Append-only is the right instinct for things that are **claims** — which is why
tutors use variants-with-lineage and rubrics are versioned. A class name is a
label on a container, not a claim anyone signed off.

Verified safe to change in place: `tagNamespace` is `class:<ownerUid>:<classId>`
and carries no name; group codes bind to `classId`; every consumer of the class
name (`auth/group_id_auth.py`, `auth/group_routes.py`, `tools/class_management.py`)
reads it live rather than holding a copy.

## The guard

`backend/tests/api_tests/test_class_tutor_reaches_the_student.py` — four tests
that fail against the pre-fix tree and five passthrough/join tests that must pass
against both. Verified by stashing the fix and re-running, not by inspection.

⚠️ **Every test seeds a class with `persona: sofie` AND `tutorId: mikkel`**,
because that disagreement is the whole bug. A test that seeds only a tutor passes
against the broken code: the persona chain falls through to the global default,
which *is* Sofie. The two must conflict for the assertion to witness anything.
The voice test likewise asserts through the real `resolve_voice` chain — an
earlier draft asserted on the join, which was never what was broken, and passed
against the bug.

**There is no scripted structural guard, deliberately.** "This join must have
more than one caller" is checkable and worthless — it passes the moment anything
imports it. What needed asserting is behavioural: *does the thing the teacher
picked reach the student?* Only an end-to-end read of each axis says that.

## The generalisable lesson

**A resolver with one consumer has not shipped.** The 1.1.91 sprint built the
right abstraction, tested it thoroughly in isolation (`test_tutor_resolution.py`
is 100+ lines and all of it passes, before and after this fix), and wired it to
the log. Unit tests on a join prove the join; they say nothing about whether
anything reads it. The `source` field even existed to attribute a surprising turn
to the layer that produced it — and would have reported `"tutor"` for a turn
where only one of the tutor's four properties was in play.

This is the same shape as the trust-card footgun ("the push shipped, the card was
dropped") and the promote-twin footgun ("the value was corrected on the path that
does not reach prod"): **a two-ended wiring where one end is invisible from the
end you are looking at.** Worth asking, for any future bundling abstraction: who
reads this, and does that set cover every axis the bundle claims to carry?
