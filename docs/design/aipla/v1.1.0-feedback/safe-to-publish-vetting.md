# Safe to publish — what a teacher needs before sharing an activity with strangers

**Status**: **Design (OPEN)** — **1.1.95**
**Priority**: **P2** — the bottleneck on the content strategy, and it is confidence rather than capability
**Estimated**: ~2d (M0 pre-publish check ~1d · M1 provenance/quality surfacing ~0.5d · M2 unpublish + feedback ~0.5d)
**Scope**: Frontend-heavy — a pre-publish review step on the shipped publish flow; backend — a checkable activity-quality rubric reusing the structure rubric that already exists
**Dependencies**: **ALS-SHARE** (**SHIPPED** — duplicate/branch, publish, shared catalogue, adopt, provenance/history, status lifecycle + visibility setter); `adk/authoring_framework.py` (**SHIPPED** — the *structure rubric*, already "the checkable skeleton a well-formed activity must satisfy"); [1.1.19 teacher-activity-authoring](teacher-activity-authoring.md)
**Created**: 2026-09-02
**Source**: [notes-2026-09-01.md](../../../notes-2026-09-01.md) — *"we could flood with examples but need a better way to make teachers safe to publish"*

## Problem Statement

> **jitt.dk** is made by Morten and is good for examples. We could **flood with
> examples** but need a better way to **make teachers safe to publish**.
>
> Provide more examples for the **C-level physics**.

**Publishing already works. Publishing confidently does not.**

ALS-SHARE shipped the whole mechanism in June — duplicate and branch an activity,
publish it to a shared catalogue, adopt a colleague's, with provenance and history
and a status lifecycle. Nothing in the machinery is missing.

What is missing is the thing a teacher needs in order to *press the button*: some
assurance that what they are about to put in front of colleagues is not
embarrassing, not half-finished, and not accidentally carrying something it
should not.

**This is the bottleneck on the whole content strategy.** The plan is for JB and
Aswin to lead activity generation and to seed C-level examples — the level with
the most students. That plan scales through teachers publishing to each other. If
publishing feels risky, the catalogue stays empty regardless of how good the
builder is, and "flood with examples" never happens.

### The three distinct fears, which want three different answers

Conflating them is why "a review process" is the wrong instinct:

1. **"Is it any good?"** — quality. Answerable mechanically, in part.
2. **"Does it leak something?"** — a class name, a pupil's name in a note, an
   uploaded worksheet with a school header. Answerable mechanically, in part, and
   the highest-stakes of the three.
3. **"Will I be judged?"** — social. **Not** answerable mechanically, and the one
   most likely to actually stop someone.

## Design

### M0 — A pre-publish check, not an approval queue

A checklist run against the activity when the teacher hits Publish, showing what
is missing before it goes out. **Advisory, not blocking** — a gate needs a
gatekeeper, and there is nobody to be one.

Two sources, both already built:

- **Structure** — `adk/authoring_framework.py` already holds *"the checkable
  skeleton a well-formed activity must satisfy"* as data, built for the M2 eval to
  score a draft. It has never been shown to a teacher. This is the same rubric
  pointed at the publish moment.
- **Leakage** — mechanical scans: class names, group codes, personal names in
  prompts and notes, materials still attached. Attached materials are the sharpest
  case: a shared activity carrying a school-headed worksheet is precisely the
  accident that makes someone never publish again.

### M1 — Say what it is, not just that it exists

Reduce fear 3 by making the catalogue entry carry context the author does not have
to defend in person:

- **level** (C / B / A — C-weighted per the November cohort), topic, duration
- provenance, which ALS-SHARE already tracks
- **"used by N classes"** once there is data — the strongest possible signal, and
  free
- an explicit **draft / ready-to-try / used-in-class** status, so a teacher can
  publish something *without* claiming it is finished. **This is probably the
  single highest-leverage element in the doc**: most of the fear is of implying a
  polish nobody asked for.

### M2 — Reversibility, which is what actually makes people brave

- **Unpublish** — one click, immediate. Nothing makes publishing feel safer than
  knowing it is undoable
- Private feedback to the author from an adopter, rather than public rating.
  Ratings on colleagues' teaching material would make fear 3 *worse*

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Pre-publish check: structure rubric + leakage scan, advisory | ~1d | None |
| M1 | Catalogue metadata: level, topic, status, usage count | ~0.5d | None |
| M2 | Unpublish + private feedback | ~0.5d | None |

Entirely un-gated. Every dependency ships.

## Testing

- An activity with a personal name in a note is flagged; a clean one is not
- The check is **advisory** — publishing anyway is possible and does not warn twice
- Unpublish removes it from the catalogue and leaves adopters' copies intact (ALS-SHARE provenance)
- A `draft`-status entry is visibly distinct in the catalogue
- No path lets a leakage scan failure silently pass as "clean" — unavailable ≠ clean

## Open questions

1. **Advisory or blocking for leakage?** Quality is clearly advisory. A pupil's
   name arguably is not. Leaning advisory-with-a-hard-warning, since a block needs
   a false-positive story and there is nobody to appeal to.
2. **Does the catalogue need moderation at all**, or is a named author with
   provenance enough within one university programme? Probably enough now, and not
   if it ever opens wider — which the India channel and a spin-off both imply.
3. **Does jitt.dk content come in as examples**, and if so under what licence and
   with whose permission? Morten's, and worth asking early rather than late.
4. **Does an adopted activity's answer tree** ([1.1.90](bounded-tutoring-answer-trees.md))
   travel with it, and can the adopter edit it? Trees encode pedagogy the adopter
   may disagree with.
