# Images in the document workbench — the fourth twin

**Status**: **Design (OPEN)** — **1.1.117**. Its original trigger (Aswin's
2026-09-15 report) is **unexplained** — two theories, including this doc's
image one, were disproved (see Problem Statement); the structural answer is
[1.1.119](frontend-client-logs.md). This doc's own scope (image support) is
a standalone P2, not P1.
**Priority**: **P2** — no longer tied to a live incident; independently
scoped image-support gap surfaced during that incident's triage
**Estimated**: ~1.5–2d (M0 error-messaging — **SHIPPED same day, see below** · M1 backend image path ~0.5d · M2 eager-injection callback ~0.5d · M3 frontend allow-list + copy ~0.25d · M4 verification ~0.5d)
**Scope**: Backend — `tools/documents/upload.py`, a new `adk/callbacks/` twin, `adk/agent.py` wiring; frontend — `StudentDocumentWorkbench.tsx` accept-list. No new storage backend, no new frontend surface.
**Dependencies**: [1.1.44 activity-image-materials](activity-image-materials.md) (**SHIPPED** — the durable-slot + eager-injection pattern this doc reuses); [1.1.93 uploaded-image-anonymisation](uploaded-image-anonymisation.md) (**OPEN** — governs retention/redaction for ANY image upload surface, this one included); [1.1.7 student-multimodal-upload](student-multimodal-upload.md) (**SHIPPED** — the *chat-attachment* image path; this doc is explicitly NOT that path, see Conflict Surface)
**Created**: 2026-09-15
**Source**: Live prod bug report relayed by M, this session — "I cannot upload the document in the workbench" (Aswin)

## Problem Statement

### What actually happened — CORRECTED again, 2026-09-16: root cause found

> The section below ends in "root cause unknown". It is now known, and it was
> neither of the theories here nor invisible: the upload **succeeded** (200,
> parsed) and was stored with `skillId=""` because the route read `skill_id` as
> a query parameter while the client sent a form field — so the workbench's
> list could never return it. The "zero requests reached the route" claim was a
> mis-filtered log query. Full account: SEQUENCE.md, "Prod feedback,
> 2026-09-15", entry 1.1.121. This doc's own scope (images in the workbench)
> is unaffected and stays P2.

### What actually happened — CORRECTED after confirming the real session (superseded)

The first pass at this doc theorized (wrongly) that Aswin had tried to attach
an **image**, based on wording alone ("cannot upload the document in the
workbench") plus 14 days of prod logs showing zero errors on
`/api/documents/upload`. That theory is **retracted** — a screenshot of the
actual session (group `busy-garden-11`, activity `act-84ba348b7d561024`,
`aipla.ku.dk`, 2026-09-15) confirmed the surface (the "Arbejde" tab —
`StudentDocumentWorkbench.tsx`, matched verbatim by its empty-state copy) and
the file: **`Doc4_compressed.pdf` — a PDF, an already-supported format.** The
image-rejection theory does not apply to this report.

Re-checked prod logs for the confirmed group + a ~25-minute window around the
screenshot: **zero requests from `busy-garden-11` ever reached
`/api/documents/upload`** — not a 200, not a 4xx, not a 5xx. A second theory
followed — a large file silently hanging the upload (no client-side size
check, no request timeout in `apiClient.ts`) — and a 20 MB cap was shipped
against it. **That theory was then disproved too: the file is 65 KB.** The
cap stays as a defensive guard (it is a real gap), but it does not explain
this report.

**The honest state is: root cause unknown, and unknowable from the server
side** — the failure never left the browser, and nothing in the platform can
see that class. That is the finding, and it has its own design doc:
[1.1.119 frontend-client-logs](frontend-client-logs.md). The sequence
recorded here — two plausible theories from the *absence* of server evidence,
both wrong — is the argument for it.

Separately (**also already fixed this session**), a real failure that DID
reach the backend was being shown to the student as one fixed, generic
Danish string — the backend's actual `detail` was discarded by
`documentApi.ts`'s `uploadDocument()` and never reached the UI. This fix
stands regardless of root cause and remains in scope.

### Why the image-support design below is still worth doing

The rest of this doc — accepting images in the workbench via real multimodal
pixels — **did not turn out to be what Aswin hit**, but it's a real,
independently-scoped gap surfaced during triage (confirmed absent: no way
for a workbench-uploaded image to reach the tutor as pixels today, only via
the separate chat-attachment path). Keeping the design below since the
research backing it (the "fourth twin" pattern, the `load_artifacts_tool`
rejection rationale, the 1.1.93 dependency) is accurate and reusable
whenever image support is prioritized — just not as the explanation for
*this* report.

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
- **A defensive guard, NOT the fix for Aswin's report** (his file was 65 KB):
  `backend/tools/documents/upload.py`
  gained `_MAX_UPLOAD_BYTES = 20 * 1024 * 1024`, checked right after reading
  the file and **before** the pending Firestore write (so a rejected file
  never leaves a phantom "pending" tab), returning `413` with the byte counts
  in `detail`. `StudentDocumentWorkbench.tsx` gained a matching client-side
  check in `onPickFile` — fires **before** `uploadDocument()` is even called,
  so an oversized file is rejected instantly instead of silently hanging for
  as long as the student's upload bandwidth takes. `uploadErrorMessage()`
  handles both the client-side case and a `413` from the server (defense in
  depth against a stale frontend build). Backend test:
  `test_oversized_file_returns_413_before_any_firestore_write`. Frontend
  tests: `"rejects an oversized file BEFORE calling the API — no silent
  hang"` and `"tells the student WHY the backend rejected an oversized file
  (413)"`.

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

1. **Aswin's actual report is still open.** Traced via screenshot to
   `busy-garden-11` / `Doc4_compressed.pdf` (65 KB, PDF) — not an image, not
   oversized. No server-side trace exists and none can, until
   [1.1.119](frontend-client-logs.md) ships. Until then the only route to a
   cause is a live reproduction with DevTools open (Network + Console) on the
   reporting machine.
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
