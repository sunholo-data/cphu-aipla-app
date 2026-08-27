# One place to hand something in — upload consolidation and clipboard paste

**Status**: Planned — **1.1.85**
**Priority**: **P1** — items 8 and 15 from 2026-08-21, and the likely resolution of item 2. Upload is how a student shows the tutor their work; there are currently three doors and the obvious one rejects screenshots
**Estimated**: ~1d for M1+M2 · M3 (one field) ~1–1.5d
**Scope**: Frontend — [`StudentDocumentWorkbench.tsx`](../../../../frontend/src/components/workspace/StudentDocumentWorkbench.tsx), [`ImageComposer.tsx`](../../../../frontend/src/components/chat/ImageComposer.tsx), [`SolutionWhiteboard.tsx`](../../../../frontend/src/components/workspace/SolutionWhiteboard.tsx); backend only if the document store must accept image MIME types
**Dependencies**: [pilot-session-2026-08-21-followups.md](pilot-session-2026-08-21-followups.md) A1+A2 — **shipped in 1.1.79**; without the documents bucket this doc is unbuildable
**Created**: 2026-08-27
**Source**: [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md), items 8, 15, and 2

## Problem Statement

A student who wants the tutor to look at their work has **three separate upload surfaces**, and
which one accepts their file depends on the file:

| Surface | Accepts | Reached from |
|---|---|---|
| `StudentDocumentWorkbench` | `.pdf .docx .pptx .xlsx .odt .odp .ods .epub .html .htm .md .csv .txt` — **no image types** | Documents tab |
| `ImageComposer` | `image/jpeg png webp heic heif` — **images only** | Chat composer |
| `SolutionWhiteboard` | nothing; it *produces* a PNG from a drawing | Drawing area |

Nothing anywhere in the frontend handles a **paste**: there is no `onPaste` or clipboard handler in
any component. A screenshot — the single most natural thing a student has to show — must be saved
to disk first, and then can only go through the chat composer.

The teacher described the consequence precisely:

> In the workspace, a distinction is made between uploading files like PDF, Word, and spreadsheets
> in the feedback area versus image uploads in the drawing area. This division is inconvenient and
> confusing. Could there be a single field for PDF, Word, spreadsheets, and image files? […]
> pasting a screenshot directly from the clipboard without saving it as a file first would be much
> easier. *(item 8)*

And the failure it produced, in a session built around uploading work for feedback:

> First, it initially only allowed selection among 'Custom files', excluding screenshots (image
> files). When changed to 'All files', students found the files, but uploading triggered an error.
> *(item 15)*

**Item 15 is two bugs, and only one is fixed.** The error was defect A of the same session — an
empty-domain Firestore key and a documents bucket that existed in no environment — fixed and
promoted in 1.1.79. The **file picker** half is untouched and is pure `accept`-list: the OS dialog's
"Custom Files" filter is generated from that attribute, so it correctly hid every screenshot.
Switching to "All files" then let students pick an image the surface was never going to accept.

**Item 2 is probably the same story.** A student uploads a screenshot "directly in the tutor chat"
and the tutor answers something unrelated. Chat image attachment has worked since 1.1.7, so the
likeliest explanation is that they were in the documents panel — which rejects images — or hit one
of the 23 upload 500s. This must be **reproduced before it is designed**; if chat image attachment
is genuinely dropping images, that is a different and more serious defect than this doc covers.

## Goals

**Primary Goal:** a student with a screenshot, a PDF or a photo of their handwriting can get it in
front of the tutor by one gesture, without knowing which kind of file it is.

**Success Metrics:**
- A screenshot can be pasted from the clipboard into the workspace with no intermediate file.
- The documents surface accepts and displays an image, and its picker shows images without switching to "All files".
- One field accepts every supported type and routes it correctly by MIME.

**Non-Goals:**
- Changing what the tutor *does* with an image (that is [student-multimodal-upload](student-multimodal-upload.md)).
- Camera capture. Worth wanting, not asked for.
- Removing the drawing area — it authors content rather than accepting it, and item 8 does not ask for that.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | **+1** | Paste removes a save-to-disk-then-browse round trip from the most common student action. |
| 2 | EARNED TRUST | 0 | No change to what the tutor claims. |
| 3 | SKILLS, NOT FEATURES | 0 | No change to the skill abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Routing by MIME is deterministic, not model-mediated. |
| 5 | GRACEFUL DEGRADATION | **+1** | A rejected type currently fails at the OS picker with no explanation; it will state what it accepts. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Uses the existing upload endpoints. |
| 7 | API FIRST | 0 | No new endpoints if the document store already accepts image MIME types — confirm in M1. |
| 8 | OBSERVABLE BY DEFAULT | 0 | No new signals. |
| 9 | SECURE BY CONSTRUCTION | **-1** | Widening an `accept` list widens the attack surface, and the **on-device privacy screen** in `useImageAttachments` currently guards only the chat path. See below. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | No shift. |
| | **Net Score** | **+1** | Below threshold, recorded honestly: this is defect-and-ergonomics work, not capability. |

**Conflict justification (Axiom 9).** `accept` is a convenience filter, never a security control —
the backend already validates type, and a student could always rename a file. The **real** exposure
is that the no-person guardrail lives in the chat image path only, so an image arriving through a
consolidated field would bypass it. **M3 must not ship until the guardrail sits on the shared path
rather than on one of its callers** — otherwise this doc re-creates the "second registration site"
footgun that produced three of the four defects in the same session.

## Design

### M1 — let the picker show images

**Not a one-line change — checked 2026-08-27, and the frontend is not the offender.**
[`_ALLOWED_EXTENSIONS`](../../../../backend/tools/documents/upload.py#L36) carries the same 13
document extensions and no image types, and the upload route 400s anything else. The frontend
`accept` list is an *honest mirror* of that, and widening it alone would turn a clear OS-picker
filter into a server rejection — a worse failure than today's.

The refusal is also deliberate, not an oversight. `upload.py` says so at the parse step: *"Images
aren't accepted at upload — they go through the solution element as pixels, not the parse route."*
AILANG Parse returns `None` for images by design, so an image has no blocks and nothing for the
document viewer to render.

So M1 is a **routing** change on both sides: an image uploaded to the documents surface is stored
and displayed as an image, and skips the parse path entirely rather than being parsed to nothing.
That is a small feature, not an attribute edit. Re-estimated at ~0.5d, and it must land with M3's
guardrail precondition in view, since it creates a second way for an image to enter the system.

### M2 — paste

A paste handler on the workspace surface reading `event.clipboardData.files`, staging any image
through the same code path a picked file uses. Kept deliberately narrow: paste over the workspace,
not a global document listener that would fight text paste inside the writing element and the table.

### M3 — one field

A single drop/browse target accepting the union of the types, routing by MIME to the document store
or the image path. The drawing area stays as an authoring tool. The guardrail precondition above
gates this milestone.

## Testing Strategy

**Frontend (Vitest)**
- The documents `accept` attribute contains the image types (a literal assertion — this is the bug).
- A pasted `ClipboardEvent` carrying an image file stages it exactly as a picked file does.
- A pasted event carrying only text does **not** stage anything and does not preventDefault.
- M3: each supported extension routes to the expected path, asserted as a table test.
- M3: an image routed through the consolidated field passes the same guardrail the chat path applies.

**Manual, on deployed dev**
- The "Dokumentfeedback" activity from the 21 August session, with a real group token — the
  activity that recorded 23 consecutive failures.

## Migration

None; no stored shape changes. M1 is revertable in isolation. M3 should ship behind the existing
teacher-feature flag idiom so a bad routing decision does not take the documents tab down.

## Success Criteria

- [ ] A screenshot is visible in the documents picker without selecting "All files".
- [ ] Ctrl+V with a screenshot on the clipboard stages it in the workspace.
- [ ] Every supported type uploads successfully as an anonymous-group student on prod.
- [ ] The no-person guardrail runs on every image path, verified by a test that would fail if a caller skipped it.
- [ ] Item 2 is reproduced and either closed by this work or split out as its own defect.

## Open Questions

1. ~~**Does the document store accept image MIME types today?**~~ **ANSWERED 2026-08-27 — no, and
   deliberately.** `_ALLOWED_EXTENSIONS` in `backend/tools/documents/upload.py` lists 13 document
   extensions and no image type; the route 400s the rest. The frontend `accept` list mirrors it
   honestly. M1 is therefore a routing change, not an attribute edit — see Design.
2. **Should a pasted screenshot land in the documents tab or the chat composer?** They mean different
   things — a document is durable and per-group; a chat attachment is per-turn. The teacher's own
   description ("start by uploading a screenshot of the task, chat, then upload their solution")
   suggests the task screenshot is durable context and the solution is a turn. Possibly both, chosen
   at paste time, which risks a modal in the middle of a paste.
3. **Does the whiteboard survive consolidation?** It authors rather than accepts, so it is untouched
   here — but a student who cannot tell the two apart is the confusion item 8 reported.

## Related Documents

- [teacher-feedback-2026-08-21-triage.md](teacher-feedback-2026-08-21-triage.md) — the triage this comes from
- [pilot-session-2026-08-21-followups.md](pilot-session-2026-08-21-followups.md) — defect A, the other half of item 15
- [student-multimodal-upload.md](student-multimodal-upload.md) — what the tutor does with an image, and the no-person guardrail
- [rich-document-workbench.md](rich-document-workbench.md) — the documents surface this modifies
