# Sprint Plan: MMU-1 — student multimodal upload (1.1.7 + 1.1.21)

## Summary

Students send a **photo or document** to the tutor in chat (the most-requested feature). Paperclip + camera, thumbnail, the 9-June **no-person guardrail** + **units-loop**, Gemini multimodal — **image bytes never persisted**.

**Duration:** ~2–3 days · **Scope:** Fullstack · **Design doc:** [student-multimodal-upload.md](student-multimodal-upload.md)
**Gates:** cleared 2026-06-11 (JB image-retention = the no-person guardrail posture; on-device detection is the private default).

## Routing decision (M, 2026-06-11) — images→AI, docs→docparse

Two distinct paths by MIME type; **don't send docs to Gemini as raw bytes**:

- **`image/*` (photos, the new path):** base64 → Gemini vision `Part` (the image injector below). Non-retained.
- **Documents (`docx/pptx/xlsx/odt/…`, PDFs):** route to the **existing docparse pipeline** — `POST /api/documents/upload` → `ailang_parse` (SDK `ailang-parse==0.5.4`, `tools/documents/ailang_parse.py`) → text blocks → `document_ids` → `make_document_injector` (text). **Already built; reused, not rebuilt.** PDFs (docparse returns `None`) take the pipeline's AI-extraction branch.
- **GATE (your action):** docparse reads `DOCPARSE_API_KEY` from env (`ailang_parse.py:157`); unset → *"AILANG Parse extraction disabled"*. **Generate the key + set it** (env locally, Secret Manager deployed). Not mintable from here.

So this sprint builds the **image** path; the **document** path is the paperclip routing to the existing upload endpoint + your key.

## Architecture reconciliation (key decision)

The design doc assumed `POST /api/sessions/{id}/turn` multipart. **Reality: this app streams via AG-UI** (`useSkillAgent.sendMessage` → `/api/proxy/api/skill/{skillId}/stream`, SSE). So images ride the turn the **same way documents already do**:

- **Wire:** image carried as **base64 in `forwardedProps.attachments`** (mirrors `document_ids`; one round-trip, JSON-native to AG-UI). Client-side resize (longest-edge 2048px) keeps the payload sane.
- **Inject:** a new **`make_image_injector` `before_model_callback`** (mirrors `make_document_injector` in `adk/callbacks/document.py:173-268`) builds `Content(role="user", parts=[Part(inline_data=Blob(bytes, mime))])` right before the model call, then discards it. **No GCS, no Firestore, no artifact — bytes live only for the request** (satisfies non-retention; does NOT reuse `/api/documents/upload`, which persists to GCS).
- **Backend wire slot exists:** `_StreamSkillRequest.attachments` + `process_skill_request(attachments=...)` (skill_processor.py) already thread through — M1 fills in the injection.

## Milestones

### M1 — Backend: image injection (AG-UI-native, non-retaining)
**Scope:** backend · ~1–1.25d
- [ ] Confirm/define the `attachments` wire shape on `_StreamSkillRequest` (`[{mimeType, data(base64), name}]`); stash into session state (transient key) in `process_skill_request`.
- [ ] `make_image_injector()` before_model_callback (new, `adk/callbacks/`) — read attachments from state, build a user `Content` with `Part(inline_data=Blob(base64-decode, mime_type))` per image, inject before the model call, then **clear** (non-retention). Mirror `make_document_injector`.
- [ ] Wire the callback into the agent factory (`adk/agent.py` callbacks list).
- [ ] `multimodal_input: bool` on `SkillConfig` (default False) + frontmatter parser (`platform_seed.py`) + materializer.
- [ ] Attachment **metadata** (count, mime, ~size) → chat-turn log (consent-gated); **assert no bytes persisted anywhere**.
- [ ] Tests (pytest): injector builds correct multimodal Content; bytes cleared post-turn / not persisted; flag parsed; metadata-only logged; PDF Part via `application/pdf`.

**Acceptance:** a turn carrying a base64 image composes a Gemini `Content` with an image `Part`; nothing writes the bytes to GCS/Firestore/artifacts; `make lint` + `make test-fast` green.

### M2 — Frontend: upload UI + guardrail + units-loop
**Scope:** frontend · ~1–1.5d
- [ ] Locate + extend the chat composer (under `src/app/chat/[...path]/` or `src/components/chat/`): **paperclip** button (file picker: `image/jpeg,png,heic,application/pdf`) + **camera** (`capture="environment"`) + **thumbnail** with `×` remove (max 4/turn).
- [ ] **On-device no-person guardrail** (`lib/personGuardrail.ts`): `FaceDetector` when available → block + retake prompt; **graceful degrade** (detection unavailable → show the pre-upload notice, don't over-block). Pre-upload notice copy (DA/EN): "Photograph your work — don't include people."
- [ ] Client-side resize (`lib/imageResize.ts`, canvas → 2048px) → base64; compose into `sendMessage(text, { attachments })` → `forwardedProps`.
- [ ] Gate the paperclip on the skill's `multimodal_input` flag.
- [ ] **Units-loop** + `## Image input` block in the 3 tutor SKILL.md (per-skill, AR content) — prompt-level.
- [ ] Tests (vitest): paperclip renders only when flag on; file→thumbnail→remove; guardrail blocks a detected person (mocked detector); send composes attachments; >4 rejected.

**Acceptance:** paperclip on multimodal skills; pick/capture → thumbnail → send reaches the tutor with the image; person-in-frame blocked with retake; `npm run quality:check` green.

## Out of scope / follow-ups
- Teacher curriculum/materials upload — [curriculum-library.md](curriculum-library.md) (1.1.25, separate, retained+indexed).
- End-of-class notes summary — [end-of-class-notes-summary.md](end-of-class-notes-summary.md) (1.1.22, composes this path).
- Audio "record this class" — [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) (next sprint).
- Image annotation, server-side OCR, editable attachment history — deferred (per doc).

## Success criteria
- [ ] Student sends a photo (camera/file) + a hand-drawn graph; tutor demonstrably "sees" it.
- [ ] Person-in-frame blocked with a retake prompt (on-device); graphs/docs pass.
- [ ] **No image bytes in GCS / Firestore / artifacts** (pytest asserts); metadata-only in the chat-turn log, consent-gated.
- [ ] PDF routes as a Gemini `Part`; HEIC accepted.
- [ ] `multimodal_input` gates the UI; `make lint`+`make test-fast` + `npm run quality:check` green.
