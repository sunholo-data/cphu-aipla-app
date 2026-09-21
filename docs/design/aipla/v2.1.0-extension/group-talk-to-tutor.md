# Group talk reaches the tutor — the second half of the Accountable Talk decision

**Status**: **PROPOSED** 2026-09-21 — the gate half shipped the same day (`setting: group_talk`, picker + 409); this doc is the half that makes the gate *sufficient* rather than merely necessary
**Priority**: **P2** — nothing is broken without it; Accountable Talk simply cannot be *used* as a research arm until the tutor can hear the group. Decide with AR/JB whether that arm is wanted in 2026/27 before spending the days
**Estimated**: **~2d for M0–M2** (transcript window into the tutor context ~1d · consent/data-use posture + researcher-visible provenance ~0.5d · tests through the real agent path ~0.5d). M3 (turn-taking cues: *who* said what) is not sized — the recorder is one shared microphone and does not diarise
**Scope**: Backend — one context builder beside `adk/iframe_context.py`, reading `recordings` segments for the caller's group; one flag on the class. No new recording, no new storage, no frontend beyond a sentence in the transcript panel. **Gated** on JB's data-use nod (§ Consent)
**Source**: AR/JB's review of the Accountable Talk framework, relayed by M 2026-09-21: *"When we use accountable talk, the setting of the dialogue is the dynamic between teacher and students. Teacher needs to use multiple statements from the students and build the dialogue from that. Therefore, we can only use this TP when the voice recording is active."*
**Related**: [`backend/frameworks/accountable-talk.yaml`](../../../../backend/frameworks/accountable-talk.yaml) (the decision is recorded in its header) · [tutors/accountable-talk.md](../tutors/accountable-talk.md) (generated) · [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) (REC-TRANSCRIPT — the recorder and the consent posture this reuses) · [tutors-handover-2026-09-10.md](../v1.1.0-feedback/tutors-handover-2026-09-10.md) (the passthrough guarantee this must keep) · [plan-2026-09-to-2027-04.md](plan-2026-09-to-2027-04.md) (workstream B, rubric-scored logs — a group-talk arm would be scored there)

## What the feedback settles, and what it leaves open

The Accountable Talk YAML carried, since 2026-09-10, an open question for
AR/JB: whether accountability to the learning community is measurable at all
in a one-to-one tutor, or whether the framework should only ever be assigned
to group activities. The answer is the second, and stronger: the approach is
**built from** several students' statements — the teacher repeats, contrasts
and extends what different students said — so it requires the group's talk to
exist, and in AIPLA the only place it exists is the class's lesson recording.

That settles the **gate**, which shipped 2026-09-21:

- `TeachingFramework.setting: "one_to_one" | "group_talk"` — a property of the
  approach, declared once. Accountable Talk declares `group_talk`.
- `PUT /api/tutors/class/{id}` refuses a group-talk tutor for a class whose
  `recording_enabled` is off, with **409** and a message that names the fix.
  The picker greys the tutor out with the same sentence, and shows the 409
  verbatim if the state changed underneath it.
- The generated design and public pages carry the constraint.

It leaves open the thing the gate cannot supply. Lesson recording
(REC-TRANSCRIPT, 1.H) produces a **research record**: 30-second segments,
transcribed, stored under the group id, readable by the group's students, the
owning teacher and researchers. **Nothing hands it to the tutor.** So a class
that records its lesson and picks Accountable Talk today gets a tutor that is
*allowed* to run the approach and still has nothing to build on — the
one-to-one rephrasings in the YAML, spoken over a group it cannot hear.

The gate keeps the approach off classes where it is guaranteed meaningless.
This doc is what would make it meaningful.

## Design

### M0 — the group's recent talk in the tutor's context

Beside `adk/iframe_context.py` (which injects `mcp_app_context.*` — what the
student did in the sim — into every agent prompt), add `adk/group_talk_context.py`:

- On each turn, **if and only if** the resolved teaching's framework has
  `setting == "group_talk"` **and** the class has `recording_enabled`, read the
  caller's group transcript (`_transcript_for_group`, the same query
  `GET /api/voice/recording/me/transcript` runs) and inject the **last N minutes**
  (default 5, bounded by a token budget) under a heading the framework's
  instruction refers to: *"What the group has said recently (transcribed from
  the lesson recording; speakers are not identified)."*
- Everything else: nothing. A one-to-one framework, or a class not recording,
  injects no block and the prompt is byte-identical to today — the
  **passthrough guarantee** in the tutors handover holds by construction, the
  same way `load_framework(None)` does.
- The framework instruction for Accountable Talk gains one paragraph telling
  the tutor that the block *is* the community its moves address: revoice from
  it, ask the student to connect to something *a classmate* said, send
  disagreement at a claim in it. The YAML's `avoid` line *"referring to
  classmates … when the student is working alone"* becomes conditional on the
  block being present, which the instruction builder can express because it
  knows whether it injected one.

### M1 — consent and data use (the gate on M0)

The transcript is already collected under the paper-consent regime JB signed
off on 2026-06-11, and already read by the student's own tutor *surface* (the
transcript panel in the workbench). What is **new** is the transcript reaching
a cloud model as prompt context in real time. That is a change of *use*, not of
collection, and it needs JB's explicit nod before M0 ships — two questions:

1. Is real-time use by the tutor within the consent the forms describe?
2. Does a consent-declined session (content-suppressed at recording time today)
   need anything further? Expected answer: no — a suppressed segment has no
   text, so it injects nothing — but say so in the doc, not in the code.

Also recorded here so it is not rediscovered: the transcript goes to the
**same** model, region and retention as the student's own typed turns. No new
processor, no new residency question. The chat-log row gains a boolean
`group_talk_injected` so a rubric run on a group-talk arm can tell which turns
actually had the community in front of them.

### M2 — tests through the real path

- `test_group_talk_reaches_the_tutor.py`, shaped like
  `test_class_tutor_reaches_the_student.py`: seed a class with recording on, a
  group, three transcript segments, an Accountable Talk tutor; run a turn
  through the real agent factory; assert the prompt carries the segments. Then
  the two negatives — recording off, and a one-to-one framework — assert the
  prompt is **byte-identical** to a run with no recording at all. The
  passthrough guarantee is a test, not a promise.
- A test that a consent-suppressed segment injects nothing.

### M3 — not sized: who said what

The recorder is one shared microphone; segments carry no speaker. Accountable
Talk's community moves lean on attribution — *"can you repeat what **she**
said?"* — which the tutor can only approximate (*"someone in your group said
…"*). Diarisation is a different feature with its own consent question
(voiceprints). Record it as the known limit of M0, and let AR/JB say whether
the approximation is acceptable for an arm before anyone sizes it.

## What this does NOT change

- The recorder, its storage, retention and deletion path — untouched.
- The tutor for every other framework — byte-identical prompt.
- The research record — the transcript is read, never written to, by the tutor.

## Decision needed

Two, both AR/JB's: (1) is a group-talk arm wanted in the 2026/27 plan at all
(if not, the gate is the whole answer and this doc closes); (2) if so, the
consent question in M1. M can then schedule M0–M2 inside workstream B.
