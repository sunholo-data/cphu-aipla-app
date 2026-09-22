# Classroom session follow-ups — 2026-09-22 (1st-year, "Den svingende streng")

**Status:** Triaged 2026-09-22, same day, from prod logs. No code changed.
**Source:** [notes-2026-09-21.md](../../../notes-2026-09-21.md) (*"Testing tomorrow, 2026-09-22: a 1st-year class, to support Tabita's gameboard activity"*); prod `chat_logs.chat_turns`, `workbench_events`, Cloud Run logs for `aipla-v01-frontend`.
**Nature:** The first 1st-year gymnasium class on prod, running a teacher-authored gameboard activity. It was the first *student* session since the 21 September v0.1.60 → v0.1.62 promotions.

## Summary

**It worked.** 9 groups joined between 13:33 and 14:49 on v0.1.62. 6 of them
talked to the tutor (45 student messages). Median reply was 1.4 s, p95 3.1 s. No
group-join failures and no visible errors. The tutor kept its pedagogy under a
lot of teenage pressure. It refused to write the hypothesis (*"Bare lav den"*)
or draw the comic, and it answered flirting, commands, Hebrew and Chinese
briefly before steering back. It gave real physics feedback on uploaded
sketches and recognised the non-physics uploads (a foot, a group selfie) for
what they were. `still-violin-61` went from a wrong guess to a correct
hypothesis in five exchanges.

**Underneath, eight things are worth fixing.** Only one of them was an outage,
and even that one did not look like an error: a researcher's dashboard froze a
group's tutor for a minute, silently. The rest are trust defects a student can
see. The tutor forgot its name, repeated its greeting, showed raw citation
labels, invented a teacher's notes, and let checklist ticks drift.

**Progress was slow, as expected for a first lesson.** No group ticked past step 2
of 5 (roles → comic → measurements → film → clean-up). No measurements reached
the table. Most tutor time went on the hypothesis and the comic. Two groups never
typed. One (`shy-mouse-65`) opted out after being refused a drawn comic: *"Så tror
jeg vi springer over at bruge dig"*.

## Disposition map

| # | Finding | Evidence | Disposition |
|---|---|---|---|
| 1 | **Tutor doesn't know its own name.** Students saw "Sofie"; the tutor said *"Jeg hedder faktisk ikke Sofie"*, then accepted "Lambda" | `shy-mouse-65` 14:30; activity had no tutor (`teaching_source=fields`) → UI default Sofie | **NEW → [1.1.126 tutor-knows-its-own-name](tutor-knows-its-own-name.md)**. The persona name never reaches the prompt, **for any tutor** |
| 2 | **Greeting repeated mid-conversation** | `bold-kazoo-64` turn 105; `shy-mouse-65` first reply | **NEW → [1.1.127 opening-guidance-only-on-the-opening-turn](opening-guidance-only-on-the-opening-turn.md)**. The "you are speaking first" block is in *every* turn's prompt, and compaction removed the earlier greeting that had been masking it. Closes the investigation owed on the 9 Sept **item 11** |
| 3 | **`[rag-source-N]` shown to students** (and read aloud by TTS) | 34 of 260 tutor turns today (13%) | **EXTENDS → [1.1.122](citation-marker-leak-and-workbench-reference.md)**. Root cause established (Vertex's chunk label, copied by flash-lite; onset lines up with the model switch). Option (a) un-blocked |
| 4 | **Too many questions, too late an explanation** for 1st-years | `pink-garden-04` asked *"forklar hvordan"* twice and got questions, then stopped | **NEW → [1.1.129 explain-on-the-second-ask](explain-on-the-second-ask.md)**. P2, wants JB |
| 5 | **Checklist ticks drift and flip; the tutor ticked a half-done step** | `fuzzy-bison-57` `['step-1']→[]→['step-2']→[]`; `tilted-guppy-64` "uploadet og revideret" ticked on upload | **NEW → [1.1.128 checklist-one-truth-per-group](checklist-one-truth-per-group.md)**. Stale per-device state, lost updates, tap-to-untick, two checklists in one prompt |
| 6 | **60 s stall on one group's reply** | `bold-kazoo-64` 14:48 → 14:49, student re-sent | **NEW → [1.1.131 insights-off-the-event-loop](insights-off-the-event-loop.md), P0.** A researcher's `insights/compare?scope=all` ran blocking BigQuery on the only worker's event loop |
| 7 | **~10,000 `/api/voice/config` requests** in the class hour | Cloud Run request log, 300–640/min | **NEW → [1.1.130 voice-config-once-per-page](voice-config-once-per-page.md)**. One fetch per message bubble, again on every window focus |
| 8 | **Maths activity: the tutor invented the teacher's notes** | `merry-grove-47` (no material attached at all), `cloudy-marten-72` ("side 1…") | **NEW → [1.1.132 tutor-never-claims-notes-it-cannot-see](tutor-never-claims-notes-it-cannot-see.md)**. Also covers the pasted-join-link bug from the same session |

**Not new docs:**

- **Gemini 5xx isn't retried.** `quota_retry` matches 429 only, so one turn
  failed outright on a `500 INTERNAL` (12:20:55Z). → the upstream
  `resilient_llm.py` port decision, workstream F of the
  [extension plan](../v2.1.0-extension/plan-2026-09-to-2027-04.md). Noted in 1.1.131.
- **"What are we investigating?" opened four groups' chats.** This goes to the
  teacher: the activity intro isn't landing. It could also be an argument for
  1.1.127 M4 (an authored opening that states the task).
- **Missing favicon / apple-touch-icon** 404 on every student device. Noted in 1.1.130.

## The new docs

| # | Doc | Priority | Est | Gate |
|---|---|---|---|---|
| **1.1.131** | [insights-off-the-event-loop](insights-off-the-event-loop.md) | **P0** | ~0.5d | none |
| **1.1.126** | [tutor-knows-its-own-name](tutor-knows-its-own-name.md) | P1 | ~0.5–0.75d | none (breaks 1.1.112 rule 1 on purpose — recorded) |
| **1.1.127** | [opening-guidance-only-on-the-opening-turn](opening-guidance-only-on-the-opening-turn.md) | P1 | ~1–1.5d | none; M4 wants JB |
| **1.1.128** | [checklist-one-truth-per-group](checklist-one-truth-per-group.md) | P1 (M0–M2) / P2 (M3) | ~1.5–2d | M3 wants JB |
| **1.1.132** | [tutor-never-claims-notes-it-cannot-see](tutor-never-claims-notes-it-cannot-see.md) | P1 | ~1–1.25d | none |
| **1.1.129** | [explain-on-the-second-ask](explain-on-the-second-ask.md) | P2 | ~1d | M1 wants JB |
| **1.1.130** | [voice-config-once-per-page](voice-config-once-per-page.md) | P2 | ~0.25d | none |

**Plus one doc extended:** [1.1.122](citation-marker-leak-and-workbench-reference.md) gains its M0 findings and an un-blocked option (a) (~0.5d).

### Suggested order before Jesper's session with experienced teachers (~2026-09-28)

~2.5d fits in the week at 2.5 days/week only if nothing else moves, so this is the cut:

1. **1.1.131 M0** (~0.25d). A dashboard must not be able to freeze a class.
2. **1.1.122 option (a)** (~0.5d). The most frequent visible defect.
3. **1.1.127 M0** (~0.3d). One-line conditional, and it removes the greeting repeat.
4. **1.1.126 M0–M1** (~0.4d). The name in the prompt.
5. **1.1.132 M0** (~0.25d). An honest "I can't see the notes" block. Experienced
   teachers are exactly the audience who will attach, or forget to attach, notes.

The rest (1.1.128, 1.1.129, 1.1.130, the M2+ milestones) goes in the first October
weeks with AD. 1.1.128 M0 is a good pairing task: small, testable, and it touches
both frontend and backend.

## Questions for JB (and Tabita)

1. **Checklist:** should the tutor tick steps at all with 1st-years, suggest ticks
   for students to confirm, or leave ticking entirely to the students? (1.1.128 M3)
2. **Explaining:** explain on the second *"forklar"*, or on the first? (1.1.129)
3. **Opening:** do teachers want to write the tutor's first message verbatim, as a
   field of its own, rather than inside the teaching goal? (1.1.127 M4)
4. **`merry-grove-47`:** a student or a teacher testing? The register reads
   university-level. (1.1.132)
5. **Tutor choice:** today's activity had no tutor picked. Should a teacher be
   nudged to choose one? (1.1.126 Q1, ties to [1.1.124](../v2.1.0-extension/teacher-onboarding-scaffold.md))

## Still to verify

- Where the authored greeting is stored: `teachingGoal`, or a note/material?
  (1.1.127 Q1). Read `activity_configs/{teacher}:{class}:act-1f2e8d4e6cdedb9c`.
- Did the compaction summarizer's 500 at 14:44:22 lose history or retry cleanly?
  (1.1.127 Q2)
- `grounding_metadata` numbering vs `[rag-source-N]`, from one stored event.
  (1.1.122 option b)
