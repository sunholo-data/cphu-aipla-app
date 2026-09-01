# Sprint brief: 3 June teacher check-in — v1.1 priorities

**Status:** Ready for sprint planning  
**Source:** 3 June 2026 teacher check-in feedback (processed in `notes/2026-06-03-checkin-feedback.md`)  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Companion public docs:** `strands.qmd` (scope), `architecture.qmd` ADR-001 (researcher role + consent)

This brief covers the confirmed v1.1 items in priority order. Each item is self-contained enough to be a separate sprint. Items are ordered by impact × effort; do them in this sequence unless there is a blocking dependency.

---

## 1. Tutor verbosity fix (IMMEDIATE — system prompt only)

**What:** Teachers found tutor responses too long. Students skim instead of engaging.

**Fix:** Add explicit length constraint to every activity's base system prompt:
- Maximum 3 sentences per response unless the student explicitly asks for a longer explanation.
- Every tutor message must end with a question.
- No multi-paragraph explanations unprompted.

**Where:** `backend/skills/templates/*/SKILL.md` — add to the shared preamble or to each skill's system prompt individually. Apply to Boldkast, LED Planck, KineBot at minimum.

**Acceptance:** A test session produces tutor responses that are ≤3 sentences for the first 5 turns of a typical session. AR to sign off on the prompt after update.

**Effort:** ~2h. No new infrastructure.

---

## 2. Proactive sim-reactive tutor — Phase B (PROMOTE to next sprint)

**What:** Teachers explicitly asked for the tutor to react to workbench slider changes without waiting for a student message. Currently the tutor only responds when the student sends a chat message.

**Design:** Sprint 1.I Phase B (idle heartbeat / sim-event-reactive message) is already designed. The trigger: when a significant workbench event fires (e.g., sim run, LED polarity change, step advance) and the student has not sent a chat message in the last N seconds, the tutor proactively comments on what just happened.

**Behaviour constraints:**
- Only trigger on meaningful events (sim run, step change, measurement commit) — not every slider drag.
- Cooldown: minimum 90 seconds between proactive messages.
- Cap: maximum 2 proactive messages per session (avoid the tutor taking over the conversation — teachers also flagged this concern).
- Message style: short observation + question. Never a lecture.
- Config: `proactive_heartbeat_seconds` and `proactive_max_per_session` fields in skill config, so AR can tune per activity.

**Acceptance:** Student runs Boldkast sim with angle=45°; within 10s of the run completing (and with no student message), the tutor sends a short message referencing the result. Does not trigger again for 90s. After 2 proactive messages the tutor stops sending unprompted.

**Effort:** ~1d. Touches: session event loop, skill config schema, Boldkast/LED Planck/KineBot configs.

---

## 3. Student in-session consent prompt for chat logging

**What:** Students in the check-in said they didn't want their conversations logged. Keep anonymous group auth (no change to ADR-001); add an opt-in prompt shown once at session start.

**UI:** On the group chat page, before the first tutor message is shown:

```
┌────────────────────────────────────────────────┐
│  This session may be recorded for educational  │
│  research at the University of Copenhagen.     │
│                                                │
│  [Yes, I consent]   [No thanks]                │
│                                                │
│  Your group code stays the same either way.   │
│  You can still use the full platform.          │
└────────────────────────────────────────────────┘
```

**Backend:**
- Store `consent_given: bool` on the session Firestore doc.
- If `false`: chat turns are NOT written to BigQuery (workbench state events may still be written — UCPH legal/JB to confirm whether non-conversational events need consent).
- Teacher session report shows `⚠ No research consent` badge on sessions where consent was declined.
- Researcher dashboard shows coverage percentage across sessions.

**Gating:** This sprint is **blocked on JB sign-off** on the consent wording. Do not ship without it. Same institutional approval gate as the audio capture brief (`audio-capture.md`). The prompt text above is a placeholder — JB must review.

**Effort:** ~0.5d frontend + ~0.5d backend. Simple but must not ship without JB approval.

---

## 4. Log summary as primary display in session report

**What:** Teachers want narrative summaries, not raw chat transcripts. This is also the privacy strategy for eventual audio inclusion — a summary has a much lower privacy profile than verbatim student speech.

**Current state:** Session report generates an AI summary and also shows the full conversation log.

**Change:**
- Summary is the primary content: displayed prominently at the top, full text visible.
- Full conversation log is collapsed by default: `[View full transcript ▸]` toggle.
- Download: full transcript available as CSV download (for researcher use), but not the default view.
- The summary should cover: what the group explored, which sim parameters they tried, which concepts came up in conversation, where they got stuck, which checklist steps they completed.

**Summary prompt improvement:** Update the session-summary generation prompt to explicitly produce:
1. A 3–5 sentence narrative of what happened.
2. A bullet list: key concepts discussed, sim parameters explored, checklist progress.
3. One sentence on what the group most needs next time.

**Effort:** ~0.5d frontend (collapse + toggle) + ~1h prompt update.

---

## 5. Researcher role — new permission tier

**What:** Researchers (JB, AR, M) need cross-class, cross-teacher access to all sessions and raw BigQuery. This is not a teacher with elevated permissions — it is a separate role that bypasses the class-level tag namespace.

**Current permission model (sprint 1.A):**
- Anonymous group → `AccessControl.type: tagged` with class tag namespace
- Teacher → Firebase auth + `is_teacher` flag + sees only their own classes

**New tier:**
- Researcher → Firebase auth + `role:researcher` custom claim
- Bypasses class tag filtering entirely
- Can query BigQuery directly via `aiplatform logs` CLI with no class filter
- Can view all teacher session reports across the deployment
- Can access the researcher analytics dashboard (when built)

**Implementation:**
- Add `role:researcher` custom claim to Firebase Auth (set manually by admin for JB, AR, M).
- Update `/api/classes/*` and session report endpoints: if `role:researcher` claim present, skip class ownership check.
- Update `aiplatform logs` CLI: if caller has researcher claim, allow `--all-classes` flag.
- Teacher UI: researchers see a "Research view" toggle that shows all classes from all teachers.

**Effort:** ~1d. Touches: Firebase Auth claim, backend endpoint guards, CLI, teacher UI (read-only research view).

---

## 6. Group code persistence — school year TTL

**What:** Group codes currently expire after 30 days. Teachers and students want codes to persist for a full school year so students can return to the same session and build a portfolio over time.

**Change:**
- Extend default group code TTL from 30 days to 300 days (~10 months, a Danish school year).
- Teacher can still manually expire/revoke a code from the class detail screen.
- Expired sessions are archived (not deleted): chat log and workbench events stay in BigQuery; Firestore session doc is marked `archived: true`.

**Connection to portfolio:** With school-year persistence, students can download a session summary at the end of the year. The portfolio download (a separate small sprint) depends on this TTL extension being in place first.

**Effort:** ~2h config change + test. Very low risk.

---

## 7. Student image / document upload

**What:** The most-requested student-facing feature in the 3 June check-in. Students want to upload:
- Handwritten / pencil diagrams and concept sketches
- Photos of experimental setups (e.g., circuit diagram, optical bench)
- Draft answers or notes for feedback

**Architecture:** ADR-008 (Gemini multimodal via AILANG Parse) already covers this. The upload UI is the missing piece.

**Student-facing UI:**
- Add a paperclip / upload button in the chat input bar.
- Supported: image (JPG, PNG, HEIC from phone camera), PDF.
- On upload: image shown as a thumbnail inline in the chat; sent to the tutor with the student's next message (or a default "please look at this" prompt if no message).
- The tutor's multimodal call uses Gemini with the image attached.

**Tutor behaviour for uploads:**
- Photo of handwritten diagram: tutor describes what it sees, then asks a question grounded in the activity's DRAs ("I can see you've drawn a free-body diagram — is the net force in the right direction?").
- Photo of experimental setup: tutor checks for common errors (e.g., LED wired backwards in the LED Planck activity; circuit open in the LED Planck activity).
- Draft answer / notes: tutor compares to the activity's topic and asks about any gaps ("You've described the angle correctly — what can you say about the *time of flight*?").

**Privacy:** Images are sent to Gemini (Google Vertex AI, EU region) as part of the model call. No images stored permanently beyond the session; they are not retained in BigQuery. This is consistent with ADR-008. Confirm with JB.

**Effort:** ~2d. Touches: frontend (upload button + thumbnail display), backend (multimodal message handling), skill prompts (instruction to handle image input).

---

## 8. End-of-session exit ticket

**What:** A structured prompt shown when a student's session ends (or when the teacher closes the session). Captures self-assessment and research data.

**UI:** Shown as a modal on the student-facing chat page when session ends:

```
┌────────────────────────────────────────────────┐
│  Session complete!                             │
│                                                │
│  How confident do you feel about              │
│  [activity topic] now?                         │
│  😕  😐  🙂  😄                               │
│                                                │
│  What was most confusing?                      │
│  ┌──────────────────────────────────────────┐  │
│  │ (optional, free text)                    │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  [Submit]   [Skip]                             │
└────────────────────────────────────────────────┘
```

**Additional research questions** (JB/AR to provide before sprint): JB/AR may want to add 1–2 more questions (e.g., "Did you feel the AI helped you think, or did it think for you?"). The UI can accommodate up to 4 items. **Sprint is blocked on JB/AR providing the question set.**

**Backend:**
- Store exit ticket responses in Firestore session doc and emit to BigQuery.
- Teacher session report shows the emoji rating and any free-text response.
- Researcher BigQuery: `exit_ticket_rating`, `exit_ticket_text`, `exit_ticket_skipped` fields.

**Effort:** ~1d frontend + backend. Blocked on JB/AR question set.

---

## 9. Cost dashboard (teacher + researcher view)

**What:** Teachers and researchers need to see spend per session, class, and month. Priority given DK's Indian beta cohort scaling to ~100s of students.

**Data:** Already in BigQuery via OTel (model token counts per turn). Cost = tokens × model rate card.

**Teacher view:** Add a "Budget" section to the teacher class detail screen:
- This month's spend for the class (€)
- Breakdown: per activity, per group
- Projected monthly spend at current usage rate

**Researcher view:** Cross-class spend totals; per-model breakdown; DK cohort vs Danish cohort comparison.

**Effort:** ~1d. Mostly a BigQuery query + display; no new instrumentation needed.

---

## Not in this brief (future sprints)

- **Bidirectional voice** (student speaks → STT → tutor responds): Browser Web Speech API for STT. Significant UX change; needs a research angle designed in. Separate sprint.
- **Teacher activity creation from scratch**: The Parameters tab scope needs to expand beyond "bounded knobs" to cover topic + workbench type + AI-assisted prompt + uploaded materials + no-sim option. Separate design doc needed — this is a significant feature.
- **Activity branching / marketplace**: Fork an existing activity; share with colleagues; keyword search. Depends on having enough activities to be useful (10+). Separate sprint.
- **Oral exam prep skill**: AI plays Danish physics examiner. Needs DRA map per topic + voice mode. Separate skill brief.
- **Student note-taking skill**: AI compares student notes to curriculum DRAs. Separate skill brief.
- **Portfolio download**: Student downloads a year's worth of session summaries. Depends on #6 (school-year TTL) being in place.
