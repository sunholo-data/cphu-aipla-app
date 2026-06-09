# End-of-class notes summary — photograph handwritten notes, get a goal-referenced summary

**Status:** Planned (P1)
**Last Updated:** 2026-06-09
**Priority:** **P1** — 9 June check-in. Reflects the **no-laptop classroom reality**: many stx physics classes run without student laptops, so students take **handwritten** notes during teacher-led activities. The wanted close-out is a photo → AI summary measured against the activity's learning goals.
**Estimated:** ~1d **on top of** [student-multimodal-upload.md](student-multimodal-upload.md) (1.1.7) and [exit-ticket.md](exit-ticket.md) (1.1.8) — it composes their surfaces, it does not re-build them.
**Scope:** Fullstack — reuses the 1.1.7 multimodal upload path; adds a session-end "summarise my notes" entry point in the 1.1.8 exit-ticket / session-end flow + a goal-referenced summary prompt + summary persistence.
**Dependencies:** [student-multimodal-upload.md](student-multimodal-upload.md) (1.1.7 — the upload + Gemini-multimodal path; **must land first**); [exit-ticket.md](exit-ticket.md) (1.1.8 — session-end surface this hangs off); [dra-activity-framework.md](../v1.0.0-pilot/dra-activity-framework.md) (1.K — the activity's machine-readable learning goals / DRA map the summary measures against); image-upload guardrail from [student-multimodal-upload.md](student-multimodal-upload.md) §Guardrail (no-person-in-frame)
**Source brief:** [`june-09-feedback-sprint-brief.md` §2](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md)

## Problem

The pilot's self-directed model assumes a student at a screen. The 9 June session corrected this: **many classes have no laptops**. Students follow a teacher-led activity and take notes **on paper**. Those students still deserve the formative close-out the platform gives screen students — but their work product is a sheet of handwriting, and there is currently no way to bring it into the loop.

The ask: at the end of class, a student photographs their handwritten notes, the AI ingests them, and returns a **summary measured against the activity's learning goals** — what they captured, what they missed, and one thing to revisit. It must work on a **single shared phone** (one device passed around a group), because that is the realistic hardware.

This is **formative, not summative** (the explicit 9 June focus): the output is "what to do next," not a grade.

## Goals

**Primary goal:** From the session-end flow, a student uploads a photo of handwritten notes and receives a short summary that **explicitly references which of the activity's learning goals are and are not evidenced** in the notes, plus one concrete next step.

**Success metrics:**
- At session end, a student can upload a photo of notes and get a summary that names specific learning goals as captured / missing (not a generic "good job").
- Works from a phone camera in one tap (`capture="environment"`), on a shared device, with no laptop.
- The summary is grounded in **this activity's** goal set — two different activities produce differently-targeted summaries from the same notes.
- Formative framing: every summary ends with one revisit step, never a score.

**Non-goals:**
- Grading / marks (summative) — explicitly excluded; formative only.
- Retaining the note image (privacy posture inherits 1.1.7: image bytes go to Gemini, are not stored).
- OCR-perfect transcription — the model reads the notes well enough to map them to goals; a verbatim transcript is not the product.
- Replacing the [session-report summary](session-report-summary-primary.md) (1.1.4) — that summarises the *chat session*; this summarises the *student's notes against goals*. They are complementary (see Relationship).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Single multimodal call at a natural pause (class end); streamed summary, skeleton while the model reads. No new blocking path mid-lesson. |
| 2 | EARNED TRUST | +1 | Summary is **anchored to the activity's teacher/AR-authored learning goals** (DRA map) — it cites which goal each point maps to, rather than free-floating praise. Calibrated "missing" statements, not false confidence. |
| 3 | SKILLS, NOT FEATURES | +1 | No new student concept — it is the same "upload a photo" gesture (1.1.7) at session end. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | One multimodal Gemini call per close-out; deterministic goal list supplied as context, model only does the mapping. No reasoning-model overkill. |
| 5 | GRACEFUL DEGRADATION | +1 | Unreadable photo → "I couldn't read this clearly, try better light / reframe" + retake; no learning goals on the activity → falls back to a plain notes summary; person-in-frame → blocked by the 1.1.7 guardrail before any model call. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses the 1.1.7 multimodal turn path + A2UI summary card + the 1.K DRA map; no new format. |
| 7 | API FIRST | +1 | A session-scoped summary endpoint; CLI + any channel can drive the same close-out. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Summary generation emits an OTel span (goals-covered count, goals-missing count) → BigQuery; a cohort signal of which goals classes consistently miss feeds engagement (1.1.17). |
| 9 | SECURE BY CONSTRUCTION | 0 | New image input at session end. **Neutral by construction:** rides the 1.1.7 no-person guardrail + non-retention posture; consent-gated like every other turn; no new egress (Vertex EU). |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Summary prompt, goal-mapping, and persistence are backend; the client renders an A2UI card. |
| 11 | USABLE BY DESIGN | +1 | Designed for the shared-phone, no-laptop, one-tap reality; empty (no notes uploaded → skip), loading (model reading), error (unreadable → retake) states specified; formative tone designed in. |
| | **Net Score** | **+10** | Threshold: ≥ +4. |

**Conflict Justifications:**
- **#9 (0, not −1):** the only new data surface is the note photo, which inherits 1.1.7's guardrail (block person-in-frame), non-retention (bytes → Gemini → discarded), and consent gating. No new trust relationship or egress; held neutral by reuse, not by discipline.

## Standards compliance

- **Upload + model call:** identical to [student-multimodal-upload.md](student-multimodal-upload.md) — multipart turn → Vertex Gemini multimodal `Part.from_image`. This doc adds **no** new upload mechanism.
- **Goal set:** the activity's `dra_map` / learning-goal field from [dra-activity-framework.md](../v1.0.0-pilot/dra-activity-framework.md) (1.K) and the `checklist` from [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19) supply the machine-readable goals. If 1.K's `dra_map` is not yet populated for an activity, fall back to the activity `checklist` items as the goal list.
- **Render:** A2UI summary card inline in chat (same component family as the session-report and quiz-feedback cards).

## Design

### Flow

```
[session end] ──► exit-ticket modal (1.1.8)
                    │
                    ├─ "Got paper notes? Photograph them for a summary"  [📷]
                    │        │
                    │        ├─ camera (capture="environment") → photo
                    │        ├─ 1.1.7 guardrail: person in frame? → block + retake
                    │        └─ POST /api/sessions/{id}/notes-summary  (multipart: image)
                    │                │
                    │                ├─ load activity goal set (dra_map ?? checklist)
                    │                ├─ Gemini multimodal: [goals] + [note image] → summary
                    │                └─ A2UI summary card:
                    │                     ✓ captured: <goal a>, <goal c>
                    │                     ○ not evidenced: <goal b>
                    │                     → revisit: <one concrete next step>
                    │
                    └─ (student with no paper notes simply skips — optional step)
```

The entry point sits **in** the exit-ticket / session-end surface (1.1.8) as an optional step, not a separate page — it is the natural "before you go" moment.

### Summary prompt (backend, per skill-language)

A dedicated summary instruction (not the tutor's conversational preamble) composed with the activity goals injected:

```
The student has photographed their handwritten notes from this activity.
The activity's learning goals are:
  {goal_list}   # from dra_map, else checklist

Produce a short formative summary (Danish or English per activity language):
  • For each learning goal: is it evidenced in the notes? (captured / partial / not evidenced)
  • Name what you actually see in the notes as the evidence — do not invent.
  • End with exactly ONE concrete thing to revisit next. No grade, no score.
  • ≤ 6 sentences total.
If you cannot read the notes, say so and ask for a clearer photo.
```

The "name what you actually see / do not invent" instruction is the anti-hallucination guard (Axiom 2) — the same discipline as the offline-lab ground-truth checking ([offline-lab-workbench.md](offline-lab-workbench.md)).

### Persistence

- The **summary text** (not the image) is written to the session Firestore doc as `notes_summary` and to BigQuery (`notes_goals_captured`, `notes_goals_missing` counts) for the cohort signal. Consent-gated like every chat turn.
- Image bytes: **not** retained (inherits 1.1.7).
- The teacher session report (1.1.4) shows the notes summary if present (read-only) — a teacher can see "the group's notes covered 2/3 goals."

## API changes

| Endpoint | Change | Auth |
|---|---|---|
| `POST /api/sessions/{id}/notes-summary` | **New** — multipart (one image); returns the A2UI summary card + persists summary text | student (group) session |

Reuses the 1.1.7 multipart handler and guardrail middleware; the only new logic is goal-set loading + the summary prompt.

## CLI surface

| Command | Purpose |
|---|---|
| `aiplatform sessions notes-summary <session-id> --image <path>` | Drive the close-out from CLI for testing against a fixture note image (ops/eval parity) |

Backlink: [local-dev-cli](../../v6.1.0/local-dev-cli.md).

## Migration

- Additive: `notes_summary` field on the session doc (nullable); two BQ columns.
- Feature-flag behind the same `multimodal_input` capability as 1.1.7 (no notes summary where uploads are off).
- Rollback: hide the entry point; field ignored.

## Testing strategy

- **Backend (pytest):** endpoint accepts multipart; goal-set loader prefers `dra_map`, falls back to `checklist`, handles empty (plain summary); prompt composition injects goals; **no image bytes persisted** (assert, same as 1.1.7); consent gating suppresses BQ rows on decline.
- **Frontend (vitest):** exit-ticket renders the optional notes step; camera capture → guardrail → submit FormData shape; summary card renders captured/missing/revisit sections; skip path works.
- **E2E / manual (LOCAL_MODE):** join an activity with a known goal set → end session → upload a fixture note photo that covers 2 of 3 goals → summary names the missing goal and gives one revisit step; upload an unreadable photo → graceful retake prompt; upload a photo with a person → blocked by guardrail.

## Human gates

1. **JB — note-image retention posture** (reuse the 1.1.7 image-retention decision; do not re-decide). Non-retention is the default here.
2. **AR/JB — summary tone** sign-off: confirm the formative framing copy ("revisit", never a score) and that "not evidenced" reads as supportive, not punitive.

## Open questions

- **Q1 — goal source when 1.K `dra_map` is unpopulated:** fall back to `checklist` (recommended) vs require a goal set. Recommend graceful fallback so the feature works before every activity has a DRA map.
- **Q2 — multi-page notes:** allow 2–4 photos (one per page) reusing 1.1.7's multi-image cap, or one photo for v1.1? Recommend reuse the 4-image cap — multi-page is common on paper.
- **Q3 — shared-phone identity:** the summary is session-scoped (group), not per-student; on a shared phone whose notes is it? Treat as the group's notes for the activity (consistent with anonymous-group auth, ADR-001). Flag in the summary copy ("your group's notes").
- **Q4 — teacher visibility:** show the notes summary in the session report (recommended, read-only) vs student-private. Pedagogical — JB/AR.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Handwriting illegible → wrong "missing goal" claims | Medium | "Name what you see / don't invent" prompt; unreadable → ask for retake rather than guess; partial state allowed |
| Reads as a grade despite formative intent | Medium | No score in the output by construction; one revisit step; AR tone sign-off |
| 1.1.7 not yet shipped → this is blocked | High (sequencing) | Explicitly sequenced **after** 1.1.7; do not start until the upload path lands |
| Shared-phone privacy ambiguity | Low | Group-scoped, non-retained; copy says "your group's notes" |

## Success criteria

- [ ] Optional "photograph your notes" step in the session-end / exit-ticket flow.
- [ ] `POST /api/sessions/{id}/notes-summary` reuses the 1.1.7 multipart + guardrail.
- [ ] Summary references this activity's specific learning goals (captured / partial / not evidenced) + one revisit step, no score.
- [ ] Goal set sourced from `dra_map`, falls back to `checklist`, degrades to plain summary if neither.
- [ ] No image bytes persisted anywhere (pytest asserts).
- [ ] Works one-tap from a phone camera; unreadable photo → graceful retake.
- [ ] Summary text + goals-captured/missing counts in BigQuery (consent-gated).
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green.

## Related documents

- [student-multimodal-upload.md](student-multimodal-upload.md) — 1.1.7; the upload path + no-person guardrail this reuses (hard prerequisite)
- [exit-ticket.md](exit-ticket.md) — 1.1.8; the session-end surface this hangs off
- [dra-activity-framework.md](../v1.0.0-pilot/dra-activity-framework.md) — 1.K; supplies the learning-goal set the summary measures against
- [session-report-summary-primary.md](session-report-summary-primary.md) — 1.1.4; the complementary *chat-session* summary (this doc is the *notes-vs-goals* summary)
- [offline-lab-workbench.md](offline-lab-workbench.md) — shares the "AI checks student work against ground truth, doesn't invent" discipline
