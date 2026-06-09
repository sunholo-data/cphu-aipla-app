# Student image / document upload — multimodal chat input

**Status:** Planned (P1, largest in this batch); **supersedes the originally-planned 1.10** `multimodal-ingestion-via-ailang-parse.md`
**Last Updated:** 2026-06-09 (added the 9 June no-person guardrail + units loop)
**Priority:** P1 — **most-requested student-facing feature** in the 3 June check-in; reinforced + refined 9 June
**Estimated:** ~2d (base) + **~1d (no-person guardrail) + ~2h (units-loop prompt)** from the 9 June additions
**Scope:** Fullstack — frontend upload button + thumbnail; backend multimodal message handling + Gemini Vertex call with image; **a person/face guardrail hook in the upload path**; skill prompts for handling image input + the units loop
**Dependencies:** ADR-008 (Gemini multimodal via AILANG Parse — ready); **JB confirm on image-retention posture** (brief states images sent to Gemini but not retained in BQ; needs explicit JB sign-off); **M (GDPR) confirm on the guardrail detection approach** (Gemini vision pre-check vs on-device — different data postures)
**Source brief:** [`june-03-feedback-sprint-brief.md` §7](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md) + [`june-09-feedback-sprint-brief.md` §1](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md) (guardrail + units loop)

## Relationship to existing planned doc

The parent [SEQUENCE.md](../SEQUENCE.md) row **1.10** was a planned doc titled `multimodal-ingestion-via-ailang-parse.md` for *teacher + student uploads via AILANG Parse* (13 deterministic formats + 2 AI formats). The brief reframes the priority: the **student-facing upload UX** is the urgent piece, not the broader ingestion pipeline.

This doc supersedes 1.10's *student* slice. Teacher document ingestion (curriculum PDFs, problem sets) remains a separate concern and can be implemented later as a smaller follow-up using the same backend plumbing this doc lands. Update the parent SEQUENCE.md to mark 1.10 as superseded by this row.

## Problem

Students cannot send images or documents to the tutor. The brief lists three concrete use cases from teacher conversations:

1. **Handwritten / pencil diagrams and concept sketches** — student draws a free-body diagram on paper, snaps a photo, asks for feedback
2. **Photos of experimental setups** — circuit on a breadboard, optical bench setup
3. **Draft answers or notes** — student types/writes a paragraph, wants targeted feedback

Without this, every visual content interaction has to go through a teacher in the room — defeats the self-directed pilot model.

## Design

### Student-facing UI

Chat input bar gains a paperclip / upload button:

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│  (chat scroll)                                         │
│                                                        │
├────────────────────────────────────────────────────────┤
│  [ thumbnail ]  ← inline preview before send         │
│  ┌──────────────────────────────────────────┬────────┐│
│  │ Type a message…                          │  [📎] ││
│  └──────────────────────────────────────────┴────────┘│
└────────────────────────────────────────────────────────┘
```

**Behaviour:**
- Click paperclip → native file picker, accepts `image/jpeg, image/png, image/heic, application/pdf`
- On select → image / first-page-of-PDF rendered as small thumbnail above the input
- Thumbnail has a `×` to remove before sending
- Multiple uploads queue as multiple thumbnails (max 4 per turn — pragmatic limit; revisit)
- Sending with attachments + no typed text → uses a default prompt: *"Vil du kigge på det her?"* (DA) / *"Can you look at this?"* (EN per skill language)
- Sending with attachments + text → text is the prompt, images are attached context
- Mobile camera capture: `<input type="file" capture="environment">` — opens the phone camera directly, important for the "snap a paper diagram" use case
- HEIC support is critical (Danish iPhone defaults); ensure browser-side decode-to-display works (use the file as-is for upload; the model accepts HEIC)

### Backend wire shape

Existing chat-turn endpoint extends to accept attachments. Two viable approaches:

**Option A (recommended): multipart on the existing endpoint.** Extend `POST /api/sessions/{id}/turn` to accept `multipart/form-data`: `text` field + `attachments[]` field. Backend uploads each attachment to a short-lived Cloud Storage bucket (or holds in memory if small), then passes URIs to the Gemini multimodal call.

**Option B: separate `/attachments` endpoint that returns URIs.** Frontend uploads first, gets back IDs, then sends a normal text-only turn referencing the IDs. More moving parts but easier to retry / resume.

Go with **Option A** for v1.1 — one round trip, simpler client, easier to reason about consent + retention (the attachment lives only as long as the request). If Option B's properties are wanted later (e.g. very large PDFs, async OCR), refactor then.

### Gemini multimodal call

Per ADR-008: Vertex AI (EU region), Gemini's multimodal endpoint. The agent loop's existing turn-construction code learns to pass `Content(role="user", parts=[Part.from_text(...), Part.from_image(...)])` instead of text-only `Part`s.

The Part types depend on attachment kind:
- JPG / PNG / HEIC → `Part.from_image(image_bytes, mime_type=...)`
- PDF → either `Part.from_data(pdf_bytes, mime_type="application/pdf")` (Gemini supports it directly) **or** route through AILANG Parse first to extract text + images, then pass those. **Recommend: direct PDF Part for v1.1** (simpler; Gemini handles it). AILANG Parse for PDFs becomes the optimization later if costs/latency justify.

### Tutor behaviour for uploads

Per the brief — each skill's SKILL.md gets a `## Image input` section the prompt template injects when the turn has attachments:

```markdown
## Image input

When the student sends an image, your turn should:
  • Briefly describe what you see (1 sentence) so the student knows you understood
  • Ground the next question in the activity's DRAs (Disciplinary-Relevant Aspects)
  • Look for common errors specific to this activity:
    - Boldkast: angle/velocity diagram inconsistencies
    - LED Planck: LED wired backwards, circuit open, missing voltmeter contact
    - KineBot: free-body diagram with missing forces, wrong direction
  • Ask one focused question (per the verbosity rule — ≤3 sentences total)

For text drafts / notes:
  • Compare against the activity's topic
  • Identify gaps without giving the answer
  • Ask the student about a specific gap, not "what do you think?"
```

The skill author for each artefact-coupled skill (Boldkast, LED Planck, KineBot) writes the activity-specific patterns. M wires the platform plumbing; AR writes the per-skill content.

### Guardrail — uploads are for no-person-in-frame material (9 June)

The 9 June session sharpened the privacy posture: the concern is **only when a person is in the frame**. Physics diagrams, graphs, and notes are low-risk — keeping uploads to no-person-in-frame material keeps the feature's consent profile low (and is what makes the [end-of-class notes summary](end-of-class-notes-summary.md) viable on a shared phone).

Two parts:

1. **Pre-upload notice** on the upload control (per skill language): *"Fotografér dit arbejde — diagrammer, grafer, noter. Hav ikke personer med på billedet."* / "Photograph your work — diagrams, graphs, notes. Don't include people in the picture."
2. **Guardrail check** in the upload path: run a **lightweight person/face detection** on each image before the send. If a person is detected, **block the send** and prompt a retake: *"Det ser ud til, at der er en person på billedet — fotografér kun dit arbejde."* / "Looks like there's a person in this photo — please reframe to just your work."

**Detection approach — M (GDPR) decides** (the two options have different data postures):

| Approach | Where bytes go | Posture | Latency |
|---|---|---|---|
| **On-device** (browser face-detection, e.g. `FaceDetector`/a small WASM model) | Never leaves the device for the *check* | Strongest — no pre-check egress; bytes only leave if the check passes and the student sends | Local, ~instant; browser-support variance |
| **Gemini vision pre-check** | Image → Vertex (EU) for a yes/no person check, then the real call | Simpler, consistent; but the image reaches the model even when it will be blocked | One extra round-trip |

**Recommendation: on-device check first**, falling back to a Gemini vision pre-check where the browser lacks face-detection — but **M signs off** before build, because "block before any egress" vs "block after a model sees it" is a real GDPR distinction. The guardrail runs **before** the multimodal turn; a blocked image is never sent and never reaches BigQuery metadata.

### Units loop — demand the missing rigor (9 June)

When a student uploads a graph/figure, the tutor **asks for the missing rigor rather than accepting it** — the canonical case is *"What are the units?"* → student re-uploads corrected. This is a prompt-level behaviour added to the `## Image input` block:

```markdown
  • If a graph/figure is missing axis labels, units, or scale, ask for THAT
    first ("Hvad er enhederne på y-aksen?") before any other feedback —
    one question, then stop. Re-uploading with the correction is the goal.
```

The same units-loop behaviour applies on **typed** entry in the [offline-lab workbench](offline-lab-workbench.md) (`MeasurementField.unit`) — one shared rigor-demand, two entry surfaces.

### Consent + privacy posture

Per the brief: "Images are sent to Gemini (Google Vertex AI, EU region) as part of the model call. No images stored permanently beyond the session; they are not retained in BigQuery."

**Concretely:**
- Image uploaded → backend receives via multipart → passes to Gemini via Vertex → model response streams back
- Image bytes: not written to BigQuery, not written to Cloud Storage as a permanent artefact, not logged
- Image metadata only (`{has_attachment: true, attachment_count: 2, attachment_mime_types: [...], approximate_size_bytes: N}`) appended to the chat-turn row for analytics signal (so we can answer "how many sessions used images?")
- Gemini's own data-handling policy applies (Vertex AI EU + no model training on enterprise data)
- Subject to [student-consent-prompt.md](student-consent-prompt.md) — if research consent declined, the metadata about attachments is also suppressed from BigQuery (consistent with the chat-turn consent gating)

**JB sign-off needed on:**
- "Image bytes are not retained anywhere beyond the model call" — confirm UCPH is comfortable with this
- "Image metadata (count, mime, size) IS retained for analytics signal even on declined consent" — alternative: suppress all metadata for declined sessions. JB picks.
- Vertex AI EU region as data-residency boundary — already settled per ADR-007 but confirm extends to multimodal payloads

### Per-skill flag

```yaml
# In SKILL.md frontmatter
multimodal_input: true   # default false; opt-in per skill
```

Some skills (assessment, quick-hint flow) may explicitly want text-only; the flag lets the upload button conditionally render.

## Acceptance

- [ ] Paperclip icon visible in chat input on skills with `multimodal_input: true`
- [ ] Native file picker accepts JPG / PNG / HEIC / PDF
- [ ] Mobile (`capture="environment"`) opens the camera directly on phone-class browsers
- [ ] Selected file renders as a thumbnail above the chat input with a `×` remove button
- [ ] Send with no text + 1 image → tutor receives the image with default "look at this" prompt
- [ ] Send with text + 1 image → tutor receives both
- [ ] Send with 2-4 images → all are attached on the same turn
- [ ] >4 images: UI rejects with clear inline error
- [ ] Tutor reply demonstrates the model **saw** the image (describes content correctly in real session)
- [ ] LED Planck skill: photo of a backwards-wired LED → tutor points out the polarity issue (validate against AR's `## Image input` content)
- [ ] No image bytes appear in BigQuery `chat_turns` or any other table
- [ ] Attachment metadata (`{has_attachment, count, mime_types}`) appears in `chat_turns` for consented sessions only
- [ ] Declined-consent session: attachment metadata absent from `chat_turns`
- [ ] HEIC from iPhone displays correctly as thumbnail (browser handles or we fall back gracefully)
- [ ] Pre-upload notice ("don't include people in the picture") visible on the upload control
- [ ] **Guardrail: uploading a photo containing a person is blocked with a retake prompt** — and (on-device path) the blocked image's bytes never leave the device / never reach BigQuery metadata
- [ ] **Units loop: uploading a hand-drawn graph with no axis units triggers a tutor question about units before any other feedback**
- [ ] Vertex AI call uses the EU region per ADR-007
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green
- [ ] Vitest covers: file-pick → thumbnail render → send-with-image FormData shape
- [ ] Pytest covers: multipart turn endpoint accepts attachments; Gemini call composes multimodal Content; turn record has metadata but no bytes

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| HEIC unsupported in some browsers | Medium | Browser handles render — if not, upload the bytes anyway and let Gemini decode; document fallback |
| Large images (>5MB) slow latency or hit Vertex payload limit | Medium | Client-side resize to longest-edge 2048px before upload (preserves diagram legibility, big size reduction) |
| Student uploads inappropriate / off-topic content | Medium | Tutor skill prompt instructs to redirect; if needed, add a content-policy preflight call (deferred unless an incident occurs) |
| Hidden cost — multimodal calls are pricier than text | Medium | Add per-image attribute to the OTel cost span; surfaces in [cost-dashboard.md](cost-dashboard.md). Budget enforcer (1.12) already gates total per-class spend |
| PDF too large for Gemini direct-pass | Medium | Cap at 10MB / 50 pages; if exceeded, route through AILANG Parse for text-only extraction as fallback (a small follow-up if observed in pilot) |
| Image retention claim breaks (some logging captures bytes) | Medium | One code-path discipline: bytes go from multipart → Gemini Part → discarded. Pytest asserts no bytes anywhere downstream of the turn handler |
| Privacy bypass: a teacher views a session and the image is gone, breaks workflow | Low | This is the intent (privacy posture). If teachers report it, revisit — but the default-don't-retain is the right starting bias for image content |

## Open questions

1. **PDF: direct-pass to Gemini or route through AILANG Parse?** Recommend direct-pass for v1.1; AILANG Parse becomes optimization layer.
2. **Image bytes for the chat history view** — student reloads, do they see their previously-sent images? Brief implies no (not retained). Recommend: show "[image sent — no longer available]" placeholder on rejoin. JB to confirm.
3. **Attachment metadata on declined-consent sessions** — leak or not? Default: suppress (consistent with chat-turn posture). JB confirms.
4. **Multi-image: is 4 the right cap?** Pragmatic guess; revisit if pilot students hit the limit.
5. **Audio attachments (voice memo)** — out of scope; covered by [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md)'s separate flow.
6. **Server-side resize / format normalization** — defer until needed; client-side resize handles the dominant case.

## Files

| File | Purpose | LOC est. |
|---|---|---|
| `frontend/src/components/chat/AttachmentButton.tsx` | New paperclip + file picker + thumbnail state | ~120 |
| `frontend/src/components/chat/AttachmentThumbnail.tsx` | New thumbnail with remove button | ~50 |
| `frontend/src/components/chat/ChatInput.tsx` | Compose attachments into FormData; submit multipart | +60 |
| `frontend/src/components/chat/__tests__/AttachmentButton.test.tsx` | New | ~100 |
| `frontend/src/lib/imageResize.ts` | Client-side resize utility (canvas → 2048px longest edge) | ~50 |
| `frontend/src/lib/personGuardrail.ts` (new) | On-device person/face pre-check (9 June); blocks send + retake prompt | ~60 |
| `backend/adk/multimodal.py` (guardrail fallback) | Optional Gemini-vision person pre-check when on-device unavailable (M-gated) | +30 |
| `backend/protocols/session_routes.py` | Extend `POST /api/sessions/{id}/turn` to multipart | +100 |
| `backend/adk/multimodal.py` (new) | Build Vertex `Content` with `Part.from_image` / `Part.from_data` for PDFs | ~80 |
| `backend/db/models/skill.py` | Add `multimodal_input: bool` field | +5 |
| `backend/skills/skill_processor.py` | Parse the flag | +5 |
| `backend/observability/chat_log_sink.py` | Append attachment metadata to chat-turn rows; respect consent | +30 |
| Skill SKILL.md (Boldkast, LED Planck, KineBot) | `## Image input` section per skill | per-skill |
| `backend/tests/api_tests/test_multimodal_turn.py` | New: multipart accepted; Gemini Content composed correctly; bytes not retained anywhere | ~200 |

## Migration

- New `multimodal_input` field defaults to false; existing skills unaffected
- Skill authors opt in by setting the flag and writing the `## Image input` block
- Rollback: revert commits; flip skills' frontmatter back to false; the paperclip disappears

## Out of scope

- Voice / audio attachments (separate [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md))
- Server-side OCR pre-pass before Gemini (Gemini handles it)
- Image annotation by the tutor (drawing arrows on the student's photo and sending back) — significant UX surface, year-2
- Sharing student images with the teacher in the session report (privacy posture is don't-retain; sharing would require explicit per-image opt-in)
- Editable history (student can re-send / re-edit an attachment) — defer

## Related

- ADR-008 (Gemini multimodal via AILANG Parse) — the architectural decision this implements
- ADR-007 (Vertex AI EU region) — data residency boundary
- [student-consent-prompt.md](student-consent-prompt.md) — gates attachment-metadata writes
- [cost-dashboard.md](cost-dashboard.md) — multimodal turns are pricier; the dashboard should surface this
- [end-of-class-notes-summary.md](end-of-class-notes-summary.md) — builds directly on this upload path + guardrail (no-laptop notes close-out)
- [offline-lab-workbench.md](offline-lab-workbench.md) — shares the units-loop behaviour on typed entry
- Parent [SEQUENCE.md](../SEQUENCE.md) row 1.10 — supersedes for student slice; mark as superseded
- Teacher document ingestion (curriculum, problem sets) — now [curriculum-library.md](curriculum-library.md), reusing this doc's AILANG Parse plumbing (different retention posture: curriculum is retained + indexed)
