# Images in the document workbench — the fourth twin

**Status**: **Design (OPEN)** — **1.1.117**
**Priority**: **P1** — triggered by a live prod report (Aswin, 2026-09-15): "I cannot upload the document in the workbench"
**Estimated**: ~1.5–2d (M0 error-messaging — **SHIPPED same day, see below** · M1 backend image path ~0.5d · M2 eager-injection callback ~0.5d · M3 frontend allow-list + copy ~0.25d · M4 verification ~0.5d)
**Scope**: Backend — `tools/documents/upload.py`, a new `adk/callbacks/` twin, `adk/agent.py` wiring; frontend — `StudentDocumentWorkbench.tsx` accept-list. No new storage backend, no new frontend surface.
**Dependencies**: [1.1.44 activity-image-materials](activity-image-materials.md) (**SHIPPED** — the durable-slot + eager-injection pattern this doc reuses); [1.1.93 uploaded-image-anonymisation](uploaded-image-anonymisation.md) (**OPEN** — governs retention/redaction for ANY image upload surface, this one included); [1.1.7 student-multimodal-upload](student-multimodal-upload.md) (**SHIPPED** — the *chat-attachment* image path; this doc is explicitly NOT that path, see Conflict Surface)
**Created**: 2026-09-15
**Source**: Live prod bug report relayed by M, this session — "I cannot upload the document in the workbench" (Aswin)

## Problem Statement

### What actually happened (verified this session, not assumed)

A report came in as "cannot upload the document in the workbench." Before designing
anything, the bug itself was root-caused:

1. **14 days of `aipla-prod-2026` Cloud Logging on `aipla-v01-frontend`** show
   **zero** 4xx/5xx on `POST /api/documents/upload`, and zero log lines
   mentioning "aswin." Every request that reached the backend in that window
   succeeded.
2. `StudentDocumentWorkbench.tsx`'s file `<input>` sets
   `accept=".pdf,.txt,.md,.docx,.csv,.xlsx,.pptx"` — no image types. Most
   desktop file pickers grey out/hide non-matching files; the backend gate
   (`_ALLOWED_EXTENSIONS` in `upload.py`) also 400s images by name, but that
   code path never fires if the OS picker never let the file through.
3. Separately (**already fixed this session, see "Already shipped" below**),
   even a REAL failure that did reach the backend was being shown to the
   student as one fixed, generic Danish string — the backend's actual
   `detail` (e.g. which file type is and isn't allowed) was discarded by
   `documentApi.ts`'s `uploadDocument()` and never reached the UI.

**Conclusion: the most likely sequence is a student (or Aswin, testing) tried
to attach a photo of handwritten work to the document workbench, got no
feedback of any kind (silently filtered by the picker), and reported it as
"cannot upload."** This is consistent with the evidence but **not confirmed
against Aswin's literal session** — no group code, timestamp, or device was
available to trace it the way the 2026-09-09 table-visibility defect was
traced against `busy-garden-11`'s logs. If a group code or timestamp becomes
available, confirm against it before treating this design as the full
explanation.

### Why "just allow the extension" isn't the fix

`StudentDocumentWorkbench.tsx` carries a deliberate 1.1.48-era comment:

> Images do NOT belong here: the document route PARSES files to text (AILANG
> Parse), which mangles handwriting/diagrams. Photos of work go through the
> solution element, which sends the actual pixels to the multimodal tutor.

That decision is still correct for *what the document route currently does*
(OCR/caption text extraction). It is wrong as a reason to keep rejecting
images outright, because **the AIPLA platform already has a proven way to
give the tutor real pixels** — `backend/adk/callbacks/activity_images.py`,
in production since 1.1.44 for teacher-authored activity images. The gap
isn't capability, it's that the document-workbench upload path was never
wired to it.

## Goals

- A student who attaches an image to the document workbench gets it treated
  the same way a photo attached in chat is treated: the tutor sees the actual
  pixels, not an OCR guess.
- The image persists as an "active file" the same way a PDF/docx upload does
  today — the tutor keeps seeing it turn after turn without the student
  re-attaching it, matching the existing document-workbench UX contract.
- A rejected upload (wrong type, storage failure) tells the student *why*,
  in their own language, instead of a fixed generic string.
- No new architecture pattern — reuse the loader/injector idiom already
  proven three times over (`document.py`, `activity_images.py`,
  `activity_documents.py` — the codebase's own comment calls the third one
  "the third twin"; this is the fourth).

## Non-goals

- OCR/vision-description of the image into text blocks. This was the
  approach 1.1.48 rejected for handwriting/diagrams and this doc does not
  revisit that call — Gemini sees the pixels directly instead.
- Changing the chat-level image-attachment path (1.1.7, `ImageComposer` /
  `useImageAttachments`) — that already works and is untouched by this doc.
- A general multi-file-type multimodal framework. This is one new branch
  (image) on one existing surface (the document workbench).

## Conflict Surface — why this isn't a small extension-list tweak

Two genuinely different mechanisms already exist for getting an image in
front of the tutor, and this doc has to pick the right one rather than
accidentally build a third:

| | Chat attachment (1.1.7, shipped) | Document workbench (this doc) |
|---|---|---|
| Trigger | Student clicks 📎 in the chat composer, per message | Student uploads into the workbench, once |
| Lifetime | One turn — rides that message's content | Persistent — "active file" reinjected every turn via `document_ids`, same as an uploaded PDF |
| Wire mechanism | AG-UI `ImageInputContent` part on the user message → `ag_ui_adk` auto-converts to `Part(inline_data=…)` | `before_agent_callback` (load) + `before_model_callback` (eager-inject) pair, session-state driven |
| Existing code | `useImageAttachments`, `ImageComposer.tsx`, `buildUserMessageContent` | `document.py` (text twin), needs an image twin |

**Why not just reuse the chat-attachment path for the workbench?** Because
the workbench's whole point (RICH-DOC, 1.1.45 M3b) is a *persistent,
referenceable* file the tutor keeps seeing without the student re-sending it
— a tab, not a one-off message. That requires the eager-injection idiom, not
the per-message multimodal-part idiom.

**Why not just make `build_document_context` / `blocks_to_markdown` handle
an `"image"` block type?** Verified this session: AILANG Parse's image
blocks (`Block` in `ailang_parse/types.py`) carry only `description` /
`transcription` / `mime` / `data_length` — **no pixel data ever comes back
into this app** from that parser. There is nothing to inline even if the
text pipeline grew an image branch. Confirms the OCR-only ceiling 1.1.48
already flagged, from a different angle (the tool doesn't even return
bytes, let alone good OCR).

**Was `load_artifacts_tool` considered as the delivery mechanism instead of
a new eager injector?** Yes, and rejected — see Design Decision below.

## Solution Design

### Design Decision: eager injection, not `load_artifacts_tool`

ADK ships a generic `load_artifacts_tool`, wired by default for every skill
(`agent.py`, `defaults_cfg.get("artifacts", True)`), and the LLM could in
principle call it to fetch any saved artifact — including an image one. This
codebase already tried leaning on exactly that for text documents and
reverted it. The comment in `make_document_injector()`
(`adk/callbacks/document.py`) is explicit about why:

> ADK's standard `load_artifacts_tool` makes the agent decide whether to
> call it — and Gemini sometimes calls it with empty `artifact_names`, in
> which case nothing actually reaches the model and the agent confidently
> says "you haven't provided a document."

Every one of the three existing loader/injector pairs (student text docs,
teacher activity images, teacher activity context docs) exists specifically
to route around that flakiness by force-feeding the artifact into
`llm_request.contents` on every turn, rather than gambling on tool-call
discovery. This doc follows the same rule for the same reason: a silent
"the tutor didn't look" failure on a photo of a student's handwritten work is
exactly as bad as it was for text documents.

### M1 — Backend: accept images, store as an artifact-ready record, skip AILANG Parse

In `backend/tools/documents/upload.py`:

- Add image extensions to `_ALLOWED_EXTENSIONS` (start with `.jpg .jpeg .png
  .webp .heic` — HEIC matters per 1.1.7's own note that Danish iPhones
  default to it) and their content types to `_EXTENSION_CONTENT_TYPES`.
- In `_run_parse` (or a new sibling), branch on image extensions **before**
  AILANG Parse is invoked at all — an image upload never goes through AILANG
  Parse or the AI-OCR fallback. Store it with a `sourceFormat` that marks it
  as an image (e.g. `"image"`), `parseStatus: "image"` (a new terminal
  status, not `"parsed"`/`"failed"` — it was never meant to produce blocks).
- Keep the GCS upload step as-is (same bucket-resolution, same
  `users/{uid}/docs/{folderId}/{filename}` path) — the file-tabs list
  (`GET /api/documents`) and delete flow need a real Firestore record and
  real bytes somewhere regardless of format, same as today.
- `_store_document`'s `blocks: []` for non-`"parsed"` statuses already
  degrades gracefully here; no schema change needed there.

### M2 — Backend: the fourth twin (`adk/callbacks/student_images.py`, working name)

Mirror `activity_images.py`'s loader/injector shape, sourced from the
student's uploaded `parsed_documents` record instead of a teacher's
`MaterialRef` slot:

- **Loader** (`before_agent_callback`): for each id in `state["document_ids"]`
  whose Firestore record has `sourceFormat` in the image set, read the GCS
  bytes and `save_artifact` a `Part(inline_data=Blob(mime_type=…, data=…))`
  — same orphan-recovery idiom as the other three loaders (probe
  `load_artifact`, drop ids whose artifact vanished, re-load).
- **Injector** (`before_model_callback`): on the same per-turn gate as the
  other three (`last.role == "user"`, no mid-turn `function_response`),
  `load_artifact` each loaded image id and `contents.insert(-1, Content(role="user", parts=[image_part, Part.from_text(label)]))`
  — the label naming which file this is, mirroring
  `activity_documents.py`'s reasoning for why the label "is doing real
  work" (a student with two uploaded photos needs the tutor to know which
  is which).
- **Text documents and images can coexist** in the same `document_ids` list
  (a student could have a PDF tab and a photo tab open at once) — the
  existing text loader/injector pair (`document.py`) only touches ids whose
  Firestore record parsed to blocks; this new pair only touches ids whose
  record is image-typed. No conflict, two independent passes over the same
  list.
- Wire both callbacks into `_composed_before_agent` / `_composed_before_model`
  in `agent.py`, alongside the existing three (~line 564–571), same
  composition order question as the other pairs (image injector after text
  injector, matching `activity_images` after `document` today).

### M3 — Frontend: allow the extensions, update the comment, keep the fallback message

In `StudentDocumentWorkbench.tsx`:

- Extend `ACCEPT` to include the new image extensions; update the 1.1.48
  comment to point here instead of asserting images are categorically
  rejected.
- The error-message fix already shipped this session
  (`uploadErrorMessage()`, distinguishing a 400 "unsupported type" response
  from a generic failure) needs no further change — once the accept-list
  is widened, the 400 branch simply fires less often, for genuinely
  unsupported formats (e.g. a `.heic` edge case, a corrupt file) rather than
  every image.
- No new UI is needed for "this is an image, not a parsed document" — the
  existing file-tab (`FileText` icon + filename) is a reasonable rendering
  until/unless product wants a thumbnail; that's a follow-on polish item,
  not a blocker.
- `DocumentViewer` (the pane that renders the active file) needs to handle
  `sourceFormat: "image"` by rendering an `<img>` from
  `fetchDocumentObjectUrl` instead of assuming a parseable document —
  check this at implementation time; if it currently branches only on
  `.pdf`, add an image branch.

### Already shipped this session (not part of the estimate above)

- `frontend/src/lib/documentApi.ts` — `uploadDocument()` now surfaces the
  backend's actual `detail` on failure instead of a fixed string.
- `frontend/src/components/workspace/StudentDocumentWorkbench.tsx` —
  `uploadErrorMessage()` gives a specific Danish message for a 400
  (unsupported type), including a pointer to the chat's image-attach
  feature as a workaround *today*, before M1–M3 land:
  > "Er det et billede af dit arbejde, kan du i stedet vedhæfte det direkte
  > i chatten."
  This line should be reworded or removed once images are accepted natively
  here — it will otherwise steer students away from a surface that now
  works.
- Test coverage: `StudentDocumentWorkbench.test.tsx` gained a case
  asserting the specific-reason message on a `DocumentApiError(status=400)`.

## Privacy — this doc does not get to skip 1.1.93

[1.1.93 uploaded-image-anonymisation](uploaded-image-anonymisation.md) is
OPEN and already names this exact risk class: a photographed worksheet can
incidentally capture a face, a name, a classroom ID card. That doc's problem
statement calls out "the image-based solution element from SUBMIT-1" as the
surface in scope — this doc adds a second image-upload surface with the
identical risk profile. **This design should not ship M1/M2 as a path that
bypasses whatever retention/redaction gate 1.1.93 lands**; if 1.1.93 is
still undecided when this is implemented, route the new image path through
the same GCS bucket/lifecycle as the solution element's images specifically
so one retention policy change covers both, rather than landing a third
place images can live ungoverned.

## Files to modify

- `backend/tools/documents/upload.py` — extend `_ALLOWED_EXTENSIONS` +
  `_EXTENSION_CONTENT_TYPES`; branch image formats around AILANG Parse.
  ~40 LOC.
- `backend/adk/callbacks/student_images.py` (new) — loader + injector pair,
  modeled on `activity_images.py`. ~150 LOC.
- `backend/adk/agent.py` — wire the new callbacks into the composed
  before_agent/before_model chains. ~10 LOC.
- `backend/tools/documents/context.py` — confirm `build_document_context`
  skips (rather than errors on) image-typed records when called from the
  text loader's path. ~5–10 LOC, possibly no change needed if the existing
  `mode="blocks"` empty-blocks path already degrades correctly.
- `frontend/src/components/workspace/StudentDocumentWorkbench.tsx` — widen
  `ACCEPT`, update the 1.1.48 comment, adjust the now-shipped 400 error
  copy once images are accepted. ~10 LOC.
- `frontend/src/components/workspace/DocumentViewer.tsx` — add an image
  render branch if one doesn't already exist. Size unknown until read at
  implementation time.

## Open questions

1. **Confirm Aswin's actual report** — no group code or timestamp was
   available this session. If M can get one from Aswin, re-trace it the way
   `busy-garden-11` was traced for the 2026-09-09 table defect, to confirm
   this design addresses the report rather than a plausible-but-unconfirmed
   guess.
2. **Composition order** of the new injector relative to the other three —
   recommend after the text-document injector, mirroring
   `activity_images` after `document` today, but confirm no interaction
   with `_strip_grounding_tools()` (the existing image+grounding
   incompatibility workaround in `_composed_before_model`) — it already
   inspects `llm_request.contents` for image parts, so it should pick this
   up for free, but verify rather than assume.
3. **Size/MIME ceiling** — `activity_images.py` may already enforce a cap;
   reuse it rather than inventing a new one for student uploads.
4. **1.1.93 dependency** — if that doc is still undecided at implementation
   time, decide explicitly whether M1/M2 ship gated behind it or ship with
   a documented interim retention posture (matching whatever the solution
   element does today, not a new one).
