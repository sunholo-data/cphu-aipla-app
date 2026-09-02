# Anonymising uploaded images — the one place student PII actually enters

**Status**: **Design (OPEN)** — **1.1.93**
**Priority**: **P1** — the only *engineering* item in the data-protection cluster, and the one that undercuts ADR-001's central claim if left alone
**Estimated**: ~2–3d (M0 audit + retention ~0.5d · M1 detection ~1d · M2 redaction/gate ~1d · M3 backfill ~0.5d)
**Scope**: Backend — the image upload path (`tools/documents/`, `adk/callbacks/activity_images.py`), GCS lifecycle, and a detection/redaction step; frontend — student-facing notice at the point of capture
**Dependencies**: [1.1.7 student-multimodal-upload](student-multimodal-upload.md) (**SHIPPED** — the path this hardens); [1.1.44 activity-image-materials](activity-image-materials.md) (**SHIPPED** — the durable-slot pattern); [1.1.80 group-erasure-cascade](group-erasure-cascade.md) (deletion must cover images)
**Created**: 2026-09-02
**Source**: [notes-2026-09-01.md](../../../notes-2026-09-01.md) — *"anonymisation of the uploaded images?"*

## Problem Statement

AIPLA's central privacy claim is ADR-001: **the group, not the student, is the
unit**. No student names, no student accounts, `email=""`, synthetic uids. That
claim is what makes an anonymous-group pilot defensible, and it holds everywhere
in the system — **except through the camera.**

A student photographing their work can, entirely incidentally, capture:

- a **face** — their own or a classmate's, across the desk
- a **name written on the worksheet**, which is exactly what schools ask pupils to do
- a school ID card, a laptop screen, a phone lock screen, a classroom noticeboard
- handwriting, which is itself biometric-adjacent in some readings

None of this is hypothetical: photographing handwritten work is the *designed*
use of the feature (1.1.7, and the image-based solution element from SUBMIT-1).

**So the one surface that can carry identifying data is the one surface built to
be pointed at the physical world.** The anonymity is architectural everywhere
else and merely *hoped for* here.

### Why this is urgent rather than tidy

It sits underneath four other open items: the Google data agreement, the missing
DPIA, sharing a real session with a researcher, and publication of pilot data.
Every one of those is easier to answer if images are demonstrably handled, and
each is harder while *"we don't know what's in them"* is the honest answer.

**It also applies retroactively.** Images from the 2026-08-21 pilot are already
in GCS. Whatever policy lands must say what happens to those, not only to future
uploads.

## Design

Four layers, cheapest and most certain first. **M0 alone materially improves the
position** and does not depend on any detection model being good.

### M0 — Know what we hold, and stop holding it forever

- Inventory: how many images, in which buckets, from which sessions, how old
- **Retention**: a GCS lifecycle rule on the image prefixes. Images are evidence
  for a lesson, not an archive — a bounded lifetime is the single strongest
  mitigation available and it needs no model
- Confirm [1.1.80 group-erasure-cascade](group-erasure-cascade.md) actually
  deletes images when a group is deleted, rather than only Firestore rows
- Publish the retention period on the privacy page, as the chat-log retention already is

### M1 — Detection

Flag likely-identifying content at upload: faces, and text regions that look like
names. Two candidate routes, to be chosen on measurement not preference:

| Route | For | Against |
|---|---|---|
| Cloud Vision face/text detection | Purpose-built, fast, cheap, no prompt risk | Another Google service in scope — which is *itself* an input to the data-agreement question |
| The multimodal model already in the path | Already in scope, no new processor | Non-deterministic, and asking a tutor model to police privacy is a poor separation of duties |

**Detection is not a gate on its own.** It has false negatives, and a design that
silently trusts it repeats this project's signature bug: *the reassuring answer is
the one a broken read produces.* Whatever it returns, treat *"no detection"* as
"unknown", never as "clean".

### M2 — What happens on detection

Three options, and the choice is **JB's**, not engineering's:

1. **Blur/redact** the region before storage. Strongest, and mangles exactly the
   handwriting the tutor needs to read.
2. **Warn the student at capture** — *"we can see a face / a name; retake or
   crop?"* Keeps the pedagogy intact, puts the human in the loop, and is honest
   about uncertainty. **Recommended.**
3. **Refuse** the upload. Safest and most likely to break a lesson.

Whatever is chosen, the existing **"shared with the AI" trust card** is the right
place to say what was detected — the transparency mechanism already ships.

### M3 — Backfill

Apply the decision to the images already held. Cannot be designed until M2 is
decided.

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Inventory, retention lifecycle, erasure check, privacy-page copy | ~0.5d | **None — do this regardless** |
| M1 | Detection at upload, measured for false-negative rate | ~1d | Route choice |
| M2 | Response: warn / redact / refuse, plus trust-card surfacing | ~1d | **JB — policy** |
| M3 | Backfill over existing pilot images | ~0.5d | M2 |

## Testing

- An image with a clearly rendered name triggers the M2 response
- A clean worksheet photo passes untouched — **false positives break the feature**
- Deleting a group removes its images from GCS, verified against the bucket, not the row
- Retention lifecycle actually expires an object (verify against GCS, not the config)
- "Detector unavailable" is distinguishable from "detector found nothing"

## Open questions

1. **What counts as identifying here?** A first name on a worksheet in a class of
   30 anonymous groups may not be. **JB / KU DPO.**
2. **Does detection introduce a new processor** for the data agreement — i.e. does
   the fix touch the blocker it is meant to help with?
3. **Is a warning enough**, given the student is a minor and the classmate whose
   face is in frame did not consent and is not the uploader?
4. **What about the August images?** They exist now, under whatever basis covered
   that session — which is [D1](meeting-2026-09-01-triage.md), still unknown.
