# One upload, the system routes — clearing up the confusing file uploads

**Status**: **SHIPPED dev 2026-09-16** — **1.1.122**. Supersedes [1.1.117 student-image-in-document-workbench](student-image-in-document-workbench.md), whose M1–M3 this doc carries out under a different framing (see "What changed from 1.1.117").
**Priority**: **P1** — a student on prod converted a photo of a hand-drawn equation into a PDF because the only labelled upload button refused pictures, and the PDF then went through *text OCR* — the one reader 1.1.48 explicitly rejected for handwriting. The button that would have worked was an unlabelled English paperclip.
**Estimated**: ~1.5d (M0 labels ~0.1d · M1 backend image branch ~0.3d · M2 loader/injector branch ~0.4d · M3 frontend ~0.3d · M4 tests ~0.4d). Actual: one session.
**Scope**: Backend — `tools/documents/upload.py`, `tools/documents/context.py`, `adk/callbacks/document.py`; frontend — `StudentDocumentWorkbench.tsx`, `ImageComposer.tsx`, `documentApi.ts`, `imageResize.ts`, `activityElements.ts`. No new surface, no new storage, no new callback pair.
**Dependencies**: [1.1.44 activity-image-materials](activity-image-materials.md) (SHIPPED — the image-Part injection idiom); [1.1.7 student-multimodal-upload](student-multimodal-upload.md) (SHIPPED — the chat path, untouched); [1.1.93 uploaded-image-anonymisation](uploaded-image-anonymisation.md) (OPEN — governs retention for every student-image surface; see Privacy).
**Created**: 2026-09-16
**Source**: M, after the 1.1.121 root-cause session — *"It's confusing which route to use … we need a clear UI as perhaps he should have just uploaded via the chat? and it wasn't clear."*

## Problem Statement

A student who wants the tutor to look at their work has, today, three places
to put a file — and which one works depends on the **file type**, which the
student is asked to know in advance:

| Surface | What the student sees | Takes | The tutor gets |
|---|---|---|---|
| Workbench "Arbejde" tab | a labelled Danish button **"Upload fil"** and *"Upload din opgave, så kan tutoren give dig feedback"* | PDF / Office only — **rejects images** | OCR'd text (Gemini "extract all text as Markdown") |
| Chat composer | two **unlabelled icons** 📎 📷 with *English* tooltips ("Attach image") | images only | the actual pixels, on that one message |
| Solution element | *"Tegn din løsning på tavlen — eller upload et billede"* — only when the teacher placed it | whiteboard + images | the actual pixels, on a submit turn |

Aswin (`busy-garden-11`, 2026-09-15) did the rational thing. The one button
that *says* "upload your work so the tutor can give feedback" refused his
photo of a drawn equation, so he converted it to the format the button would
take. That PDF then went through `_run_pdf_ai_parse` → `extract_pdf_text`,
whose prompt is *"Extract ALL text from this document as clean Markdown"*.
Handwritten physics through a text extractor is exactly the lossy path
1.1.48 rejected when it moved photos of work onto the multimodal turn — and
then, on top of that, the file never appeared at all (1.1.121, the
`skillId` bug). Two failures, and the first one was the UI's.

**The routing is by file type, and the student is the one doing the
routing.** That is the defect. Not "images are missing from the workbench"
(1.1.117's framing) — the workbench, the chat and the solution element each
work; the *choice between them* is the thing nobody could make.

### The rule

**A student never chooses a route by file type, or by what the tutor will do
with the file.** They put the file where it belongs by *intent*, and the
system routes it by type:

- **Workbench = "this is my work — keep it, look at it, critique it."** A
  file becomes a tab. It persists. The tutor sees it every turn. *Any* type a
  student would plausibly hand over: a PDF, a Word file, a photo, a drawing.
- **Chat 📎 = "look at this while we talk."** A message with a picture on it.
  One turn. Unchanged, but *labelled*, in the page's language.
- **Solution element = a task the teacher placed** ("draw or photograph your
  solution here"). Not a third route from the student's point of view — it
  reuses the same picker and labels, so it looks like the same thing.

Everything below follows from that rule.

## Goals

1. The workbench "Upload fil" accepts images. An image becomes a tab like
   any other file, renders in the viewer, and reaches the tutor as **pixels**
   — the same Part shape the teacher's activity images (1.1.44) already use —
   not as OCR text.
2. The chat attach buttons carry labels a Danish 16-year-old can find
   (Danish by default, English when the activity is English — the 1.1.108
   rule: language is data, the copy lives in one object).
3. No new mechanism. Route by type *inside* the existing document pipeline:
   one upload route, one loader/injector pair, one list, one viewer. Every
   branch is a type check, not a new file.
4. The rejection message that steered students to the chat
   ("Er det et billede … vedhæft det direkte i chatten") disappears, because
   nothing a student would reasonably upload is rejected any more.

## Non-goals

- OCR or captioning of images into text blocks — rejected by 1.1.48, not
  revisited. Gemini sees the pixels.
- Changing the chat-attachment mechanics (1.1.7). Labels only.
- Merging the chat attach and the workbench upload into one control. They
  are different *intents* (a message vs. a kept file), and students already
  understand that distinction from every messaging app. What was wrong was
  that the *type* decided, not the intent.
- Async parsing of large PDFs (the 300 s time bomb from 1.1.121) — its own
  follow-up.

## What changed from 1.1.117

1.1.117 designed "images in the document workbench" as a **fourth
loader/injector twin** (`adk/callbacks/student_images.py`) beside
`document.py`, `activity_images.py` and `activity_documents.py`. That would
have been a fourth file whose only difference from `document.py` is the mime
type of the artifact and the Part it emits. The rule above says the type
should be a branch, not a surface — so the implementation **extends
`document.py`**: the loader stores an image record's bytes as an image
artifact instead of a JSON-blocks artifact, and the injector emits an image
Part instead of a text Part, keyed on the artifact's own mime type. Same
state key (`app:docs_loaded`), same orphan recovery, same per-turn gate,
same `document_ids` list from the frontend. A student with a PDF tab and a
photo tab is one list, one pass.

Everything else in 1.1.117 — the `load_artifacts_tool` rejection, the
"no pixels ever come back from AILANG Parse" finding, the 1.1.93 dependency,
the coexistence argument — stands and is not repeated here.

## Solution Design

### M0 — Labels on the chat attach buttons

`ImageComposer.ImageUploadButtons` gains a `lang` prop and a `copy` object:

```
da: { attach: "Vedhæft billede", photo: "Tag et billede", full: "Højst {n} billeder ad gangen" }
en: { attach: "Attach image",     photo: "Take photo",     full: "Up to {n} images at a time" }
```

`aria-label` + `title` come from it; the chat page passes the same language
it already passes the symbol strip. The solution element inherits the labels
through the shared component. Nothing else on the chat path changes.

### M1 — Backend: the upload route accepts images and skips the parser

`tools/documents/upload.py`:

- `_IMAGE_EXTENSIONS = {.jpg .jpeg .png .webp .heic .heif}` join
  `_ALLOWED_EXTENSIONS`, with content types. HEIC/HEIF because Danish iPhones
  default to it (1.1.7's note); Gemini accepts them natively.
- An image is size-gated at **5 MB** (`IMAGE_MAX_BYTES`, the same ceiling
  `activity_image_routes.py` applies to teacher images) — in practice the
  frontend downscales to ≤ 2048 px JPEG first, so a phone photo arrives at a
  few hundred KB.
- An image never enters `_run_parse`. It is stored `parseStatus: "parsed"`
  (= *ready for the tutor*; the list filters on this), `blocks: []`,
  `mediaKind: "image"`, `sourceFormat: "png"` etc. The GCS write is the
  same path as every other upload (`users/{uid}/docs/{folder}/{name}`), so
  the viewer's `/raw` route and the delete flow work unchanged.

### M2 — Backend: the loader/injector branch by type

`tools/documents/context.py` gains two small helpers, `is_image_document(raw)`
and `read_document_bytes(raw)` (the latter is the `gs://` reader that
`routes.py`'s `/raw` endpoint already had; it moves so both callers share
one). Then in `adk/callbacks/document.py`:

- **Loader**: for each new id, read the record once. Image → `Part(inline_data=Blob(mime, bytes))`
  saved as `doc:{id}.image`; text → the existing `doc:{id}.json`. The
  orphan probe checks both names. A text record with no blocks is still
  the existing "no parsed content" error; an image record never hits that
  branch.
- **Injector**: for each loaded id, load whichever artifact exists. If its
  `mime_type` starts with `image/`, insert a label Content (*"[Attached
  image: {filename} — uploaded by the student]"*) followed by a Content
  carrying the Part itself — the `activity_images.py` shape; otherwise the
  existing text insertion. `_request_has_image_part` in `agent.py` already
  scans `llm_request.contents`, so the grounding-tool strip (the
  Gemini image+grounding 400) picks these up with no change.

### M3 — Frontend: one picker, downscale on device, honest icons

`StudentDocumentWorkbench.tsx`:

- `ACCEPT` adds the image types. The button reads **"Upload fil eller
  billede"**; the empty state reads *"Upload din opgave eller et billede af
  dit arbejde, så kan tutoren give dig feedback."*
- Before `uploadDocument`, an image goes through `resizeImageFile`
  (1.1.7's on-device downscale, ≤ 2048 px) and back into a `File`
  (`encodedImageToFile`, new in `imageResize.ts`). HEIC passes through raw,
  as it does on the chat path.
- Tabs show an `Image` icon for image files. `DocumentViewer` already
  renders `image/*` via `ZoomableImage`; no change.
- The 400 message drops its "attach it in the chat instead" pointer.
- `activityElements.ts`: the teacher-facing label `Dokumentupload` becomes
  **`Filupload`** — the element takes files, and a teacher choosing between
  it and `Din løsning` should read *file* vs *solution*, not *document* vs
  *solution*.

### M4 — Tests (the ones that would have caught each half)

- `test_upload.py`: an image upload never calls `_run_parse`, stores
  `mediaKind="image"` + `parseStatus="parsed"`, and 413s over 5 MB.
- `test_upload_reaches_the_workbench_list.py`: an uploaded PNG is listed
  for its activity — the 1.1.121 join test, run for the new branch.
- `test_document_loader.py` / `test_document_injector.py`: an image record
  becomes an image artifact and reaches `llm_request.contents` as an image
  Part with a label; a JSON artifact still becomes text; both in one
  `document_ids` list.
- `StudentDocumentWorkbench.test.tsx`: the picker accepts images; a picked
  PNG is downscaled and uploaded; a picked PDF is not touched.
- `ImageComposer.test.tsx`: labels in Danish by default, English on `lang="en"`.

## Privacy — same posture as the solution element, not a new one

[1.1.93](uploaded-image-anonymisation.md) is still open. This surface stores
student images in the **same per-client documents bucket and Firestore
collection as every other student upload**, under the group's synthetic uid —
not a third place images can live. When 1.1.93 lands a retention or
redaction rule for student images, it applies here by the `mediaKind:
"image"` field, in one query. Until then the interim posture is the one the
solution element already has: the image is the student's own upload, visible
to the group and their teacher, deletable by the student from the tab.

## Files

- `backend/tools/documents/upload.py` — image extensions, 5 MB gate, skip parse.
- `backend/tools/documents/context.py` — `is_image_document`, `read_document_bytes`.
- `backend/tools/documents/routes.py` — `/raw` delegates to the shared reader.
- `backend/adk/callbacks/document.py` — loader + injector branch by mime.
- `frontend/src/components/chat/ImageComposer.tsx` — `copy` + `lang`.
- `frontend/src/app/chat/[...path]/page.tsx` — passes `lang`.
- `frontend/src/components/workspace/StudentDocumentWorkbench.tsx` — accept, copy, downscale, icons.
- `frontend/src/lib/imageResize.ts` — `encodedImageToFile`.
- `frontend/src/lib/activityElements.ts` — label.
- Tests as listed under M4.

## Open questions

1. **Thumbnails in tabs.** An `Image` icon + filename is enough to tell a
   photo from a PDF; a thumbnail would be nicer. Polish, not blocking.
2. **Should the chat 📎 offer documents too?** By the rule above, no: a
   document is *kept work*, and the workbench is where kept work lives. If
   usage shows students dropping PDFs on the chat, that is the signal to
   revisit — with the same "route by type" answer, not a new surface.
3. **1.1.93 retention** — decided there, applied here by `mediaKind`.
