# Rich document workbench — a Documents tab, a real viewer, and the solution editor

**Status:** **IN PROGRESS — sprint RICH-DOC (M0–M4), 2026-06-24.** Full build approved (M). Layout Q1 resolved: activity-driven primary surface + tabs when >1. The student workbench gains a **rich document surface**: parsed documents render properly (markdown / tables / SVG / **math**, not a `<pre>` dump), teacher-shared materials and the student's own uploads live in a **Documents tab** with a real multi-page **viewer** (PDF page-nav / zoom / fullscreen / download), and — the companion mockup — a **rich-text solution editor** the student writes in and the tutor gives feedback on. (**P1** — completes the open [1.1.33](documents-workbench-surface.md) M3 and builds on [1.1.44](activity-image-materials.md) images.)
**Last Updated:** 2026-06-24
**Priority:** **P1.** Two teacher mockups (2026-06-23, JB) define the target: a *"Datadokument feedback"* activity where the student uploads their report and the tutor critiques the active file, and a *"Boldkast"* activity where the student writes their solution in a formatted editor with formulas. Today the workbench renders documents as raw text and has no writing surface — the mockups are richer than what exists.
**Estimated:** ~6–9d phased (M0 rich-render ~0.75d is the immediate win; the PDF viewer and the rich-text editor are greenfield and the bulk).
**Scope:** Frontend-heavy (rendering, a tabbed workbench shell, a PDF viewer, a rich-text editor) + backend seams (serve a document's parsed blocks + original bytes to the student surface, ACL-gated; wire the student's "active file" into the tutor's `document_ids`).
**Dependencies:** [1.1.33 documents-workbench-surface](documents-workbench-surface.md) (the Documents surface this completes — M3 rich rendering was its open item); [1.1.44 activity-image-materials](activity-image-materials.md) (images already render + the dual-audience GET-bytes pattern this reuses); [1.1.38 activity-elements-palette](activity-elements-palette.md) (the solution editor is a new **element**); [1.1.7 student-multimodal-upload](student-multimodal-upload.md) (the student upload path); the document pipeline (`backend/tools/documents/*`, `parsed_documents`, `make_document_loader`). **Mockups:** [workbench-JB-1.jpg](../mockups/workbench-JB-1.jpg) (document-feedback), [workbench-JB-2.jpg](../mockups/workbench-JB-2.jpg) (solution editor).
**Source:** 2026-06-23 (M + JB mockups): *"teacher documents that they allow the student to see [should] be a feature in the workbench, richer than currently … students get rich images and documents parsed"* + *"a tab within [the workbench] that covers documents."*

> **Read this with the mockups.** Both share one shell — **Activity header · Chat (feedback) left · Workbench right · progress footer** — and differ only in the workbench's primary surface: **JB-1** a *document viewer* over the student's uploaded files ("din fil"), **JB-2** a *rich-text solution editor* ("din løsning"). This doc treats the workbench right-pane as a **set of surfaces** (sim · elements · documents · solution-editor) selected by activity, with **Documents** also available as a **tab** alongside the tools — and makes the document rendering genuinely rich.

## Why this exists — the crux

The workbench ([`StudentWorkspace`](../../../../frontend/src/components/workspace/StudentWorkspace.tsx)) is a vertical stack — sim launcher, then the [1.1.38] element tools, then the [`DocumentsPanel`](../../../../frontend/src/components/workspace/DocumentsPanel.tsx). The documents part is the weak link:

- **Parsed documents render as raw text.** Opening a shared doc shows a `<pre>` dump of the extracted markdown ([DocumentsPanel.tsx](../../../../frontend/src/components/workspace/DocumentsPanel.tsx)) — no headings, no tables, no formulas, no figures. Yet the parse pipeline already produces a **rich block schema** (heading/paragraph/table/list/image/section — [`context.py`](../../../../backend/tools/documents/context.py)) and the chat already renders all of that **plus KaTeX math** via [`ChatMarkdown`](../../../../frontend/src/components/chat/ChatMarkdown.tsx). The richness exists; the document viewer just doesn't use it.
- **There's no real document viewer.** A PDF is a download link + page-count badge ([`PDFCard`](../../../../frontend/src/components/chat/media/PDFCard.tsx)). JB-1 wants to *read the PDF in place* — pages, zoom, fullscreen — with the tutor critiquing the active file.
- **There's no writing surface.** JB-2's student writes a structured solution (formatting + formulas) and the tutor responds. Today a non-sim activity is chat + the bounded elements (checklist/table/chart/calculator/note); none is a free-form rich-text answer.

So three gaps, in increasing cost: (1) **render documents richly** (reuse `ChatMarkdown` — nearly free), (2) **a document viewer + a Documents tab** (PDF viewer is greenfield), (3) **a rich-text solution editor** (greenfield editor). This doc designs all three and phases them so the cheap, high-value rendering lands first.

## What already exists (so we build, not reinvent)

| Capability | State | Where |
|---|---|---|
| Parsed **block schema** (heading/table/list/image/section) | ✅ rich | [`tools/documents/context.py`](../../../../backend/tools/documents/context.py) |
| **Original bytes** of an upload (the real PDF) | ✅ in GCS | `users/{uid}/docs/...` ([`upload.py`](../../../../backend/tools/documents/upload.py)) |
| Rich render: markdown · tables · SVG · **KaTeX math** · code | ✅ | [`ChatMarkdown`](../../../../frontend/src/components/chat/ChatMarkdown.tsx) (`katex`, `remark-math`, `rehype-katex` already in `package.json`) |
| Image render (zoom) | ✅ | `ZoomableImage` (used by [1.1.44] + uploads gallery) |
| Dual-audience **GET bytes** (teacher/student ACL) | ✅ | [1.1.44 `/api/activity-images/{a}/{m}`](activity-image-materials.md) — the pattern to copy |
| **Tabs** primitive | ✅ installed, unused | `@radix-ui/react-tabs` in `package.json` |
| **Multi-page PDF viewer** (pages/zoom/fullscreen) | ❌ greenfield | add `pdfjs-dist` / `react-pdf` |
| **Rich-text editor** (B/I/U, lists, link, image, math, undo) | ❌ greenfield | add TipTap (recommended) |

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Rich render is client-side off already-fetched content (no new latency). The PDF viewer + editor add bundle weight → **code-split** them (lazy-load only when a doc/editor activity opens) so the chat path is unaffected. Neutral. |
| 2 | EARNED TRUST | +1 | A student reads the *actual* document (figures, tables, formulas) instead of a lossy text dump; feedback the tutor gives about "the figure on p.6" is something the student can now see. |
| 3 | SKILLS, NOT FEATURES | +1 | Documents and a writing surface become **composable workbench resources/elements** (same model as sims (1.1.41), cited docs (1.1.25), images (1.1.44), the element palette (1.1.38)) — not bespoke one-offs. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | The tutor's view of the "active file" rides the existing `document_ids` loader (the model already gets the parsed content); rendering is a pure client concern. Math display reuses the model-agnostic KaTeX path. |
| 5 | GRACEFUL DEGRADATION | +1 | Unknown/again content → the viewer falls back: PDF→download card (today's `PDFCard`), rich-render→plain text, editor→a plain textarea. A doc with no stored content keeps the honest "not available to read here yet" note. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses `ChatMarkdown` (the shipped renderer), the block schema, the 1.1.44 GET-bytes ACL pattern, Radix Tabs, and `document_ids`/AG-UI for the active file. New deps (pdfjs, TipTap) are standard, scoped, and lazy-loaded. |
| 7 | API FIRST | +1 | Two clean reads — a document's **rich content** (blocks/markdown) and its **original bytes** — ACL-gated for teacher + student, consumed by the viewer and a future CLI. The solution editor saves via the activity/session API. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Which documents a student opened + the active file are observable (the active file is already a session `document_id`); the solution editor's saves are session state. |
| 9 | SECURE BY CONSTRUCTION | +1 | Document content/bytes are **ACL-gated** (teacher owner or student-on-bound-activity-if-visible — the 1.1.44 rule). Student uploads keep the 1.1.7 person-guardrail + the consent posture. Rich render sanitises (DOMPurify for SVG, KaTeX trust=false). The editor stores sanitised HTML/JSON, never executes it. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Honest: this pushes **real UI weight to the client** (a PDF viewer + a rich-text editor). Mitigated by lazy-loading + keeping parse/ACL/active-file logic server-side, but it's not a thin-client win. Neutral, declared. |
| 11 | USABLE BY DESIGN | +1 | The headline: students read documents as documents and write structured answers — exactly the teacher mockups. Designed empty/loading/error states; the Documents tab keeps the workbench legible instead of an ever-growing stack. |
| | **Net Score** | **+8** | Threshold ≥ +4. Two honest neutrals (bundle weight, thin-client) declared; no −1s. |

## Design

### 1. Rich document rendering (M0 — the immediate win)

Replace the `<pre>` body of the [`DocumentsPanel`](../../../../frontend/src/components/workspace/DocumentsPanel.tsx) inline viewer with **`ChatMarkdown`**, fed the document's parsed **markdown** (`build_document_context(doc_id, mode="markdown")`, already what `fetchCurriculumContent` returns). Instantly: headings, lists, **tables**, **SVG figures**, and **KaTeX formulas** render — and the same component the tutor's feedback uses, so a doc and the chat about it look consistent. This alone **completes 1.1.33 M3** and delivers "documents parsed [richly]" + the formula display the mockups show. Images already render (1.1.44). Graceful fallback to plain text if `ChatMarkdown` throws.

### 2. The Documents tab (M1 — workbench shell)

Wrap the workbench right-pane surfaces in **Radix Tabs** (already installed): **Arbejde** (the [1.1.38] element tools) and **Dokumenter** (the rich `DocumentsPanel`). A sim, when present, stays the takeover surface (1.1.41) and is the default/!tabbed view until closed. The Documents tab aggregates, richly:
- **teacher-shared materials** (1.1.25/1.1.44 — `studentVisible`), rendered (docs) or shown (images);
- **the student's own uploads** this session (the `images` gallery today → generalised to docs + images);
- honest empty/loading/error states.

The tab badge shows a count so "you have documents" is discoverable without dominating the stack (the 1.1.26 legibility concern).

### 3. The document viewer (M2 — JB-1's "din fil")

A real viewer surface, lazy-loaded (`pdfjs-dist`/`react-pdf`, code-split):
- **PDF** → multi-page canvas with **page nav (‹ 1/8 ›), zoom (− 100% +), fullscreen, download** — exactly the JB-1 control bar. Bytes come from a new ACL-gated **GET original-bytes** endpoint (the 1.1.44 dual-audience pattern, generalised to documents).
- **image** → `ZoomableImage` (already).
- **everything else** (docx/txt/md/parsed) → the M0 rich render.
- **File tabs** across the top (`Rapport_udkast.pdf ×`, `Noter_marts.pdf ×`, `+ Upload fil`) when multiple files are attached, with one **active file**.
- Non-PDF / no-bytes → graceful fallback to the rich render or the download card.

### 4. Student upload + the active file (M3 — JB-1 wiring)

The "Upload fil" affordance in the Documents tab lets the student attach **their own** document (JB-1's "din fil"), reusing the [1.1.7] upload + `parsed_documents` pipeline (PDF→Gemini-OCR→blocks). The **active file** is the one the tutor "works with": its `doc_id` is pushed into the session's **`document_ids`** (the existing [`make_document_loader`](../../../../backend/adk/callbacks/document.py) path), so the tutor's feedback is grounded in the active file — switching the active tab switches what the bot critiques ("Skift fil ovenfor for at få feedback på en anden fil"). This is the **document-feedback activity** shape: chat-feedback + your-files-viewer.

### 5. The rich-text solution editor (M4 — JB-2's "din løsning")

A new **element** (extends the [1.1.38] registry: `solution`/`free-response`), lazy-loaded **TipTap** with the JB-2 toolbar — **bold/italic/underline, bullet/numbered lists, link, image, `fx` math, undo/redo** — and a word count. Math via a KaTeX node (renders inline like `h = v₀t·sin(θ) − ½gt²`). The student's answer saves to session state (autosave "Gem kladde" + explicit "Gem løsning"), and is surfaced to the tutor as text/markdown content (so feedback can highlight values + formulas, as the mockup's bot does). Sanitised on store; never executed. **This is the largest, most independent piece — a candidate to split to its own row if the viewer work fills the window.**

## API changes

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/documents/{docId}/content` (or reuse curriculum content) | GET | A document's **rich content** (markdown + blocks) for in-workbench rendering | dual-audience (teacher / student-on-bound-activity) |
| `/api/documents/{docId}/raw` | GET | The document's **original bytes** (PDF) for the viewer — streamed, ACL-gated (the 1.1.44 dual-audience rule) | dual-audience |
| activity/session save | POST/PATCH | the solution editor's content (sanitised) as session/activity state | student |

(Exact route homes TBD in the sprint — likely generalise the 1.1.44 GET-bytes handler + the 1.1.33 content read rather than net-new controllers.)

## Migration

- **Additive.** M0 is a pure render swap (no data change). The Documents tab reorganises existing panels (no API change). The viewer + editor are new surfaces behind activity/element config; activities without them are unchanged.
- **New deps** (`pdfjs-dist`/`react-pdf`, `@tiptap/*`) are **lazy-loaded/code-split** so they don't bloat the chat bundle — relevant to the [1.1.30] mobile-perf pass (coordinate the budget).
- **Rollback:** feature-flag the tab + viewer + editor; off → the current vertical stack + `<pre>` viewer (or keep M0's render, which is strictly better and safe).

## Security

- **Document content + bytes are ACL-gated** exactly as 1.1.44: teacher owner, or a student only when the doc is cited on their bound activity and marked `studentVisible`. The raw-bytes endpoint streams with `private` cache and no listing.
- **Rich render sanitises:** SVG via DOMPurify (existing `SVGBlock`), KaTeX with `trust:false` (no `\href`/script), markdown links gated. The editor stores sanitised content and renders it through the same sanitised path.
- **Student uploads** keep the [1.1.7] on-device person-guardrail + the consent posture; teacher-shared docs keep the [1.1.44] retention (as long as needed).

## Milestone phasing

| MS | Deliverable | Est | Gate | Notes |
|---|---|---|---|---|
| **M0** | **Rich parsed-doc rendering** — `DocumentsPanel` viewer renders `ChatMarkdown` (markdown/tables/SVG/**math**) instead of `<pre>`; graceful text fallback. **Completes 1.1.33 M3.** | ~0.75d | — | Immediate win; reuses shipped renderer. |
| **M1** | **Documents tab** — Radix Tabs shell (Arbejde / Dokumenter) around the workbench; the Documents tab aggregates teacher materials + student uploads, richly, with a count badge + designed states. | ~1–1.5d | — | Frontend-only; sim takeover unchanged. |
| **M2** | **Document viewer** — lazy `pdfjs` multi-page viewer (page-nav/zoom/fullscreen/download per JB-1) + file tabs; image→zoom, other→rich render. New ACL-gated **GET raw bytes**. | ~2–3d | bundle/mobile-perf (1.1.30) | Greenfield PDF dep, code-split. |
| **M3** | **Student upload + active file** — "Upload fil" in the Documents tab → `parsed_documents`; the active file's `doc_id` → session `document_ids` so the tutor critiques it (JB-1 document-feedback activity). | ~1.5–2d | JB on the activity type | Reuses 1.1.7 + the doc loader. |
| **M4** | **Rich-text solution editor** — lazy TipTap element (B/I/U, lists, link, image, **fx math**, undo) + autosave/save; surfaced to the tutor (JB-2). **Split to its own row if needed.** | ~2.5–3.5d | JB/AR on the element + AR on feedback prompt | Greenfield editor dep; largest piece. |

**Core "rich document output" (the ask) = M0–M2.** M3 (student-uploads-their-file feedback) and M4 (solution editor) are the larger JB-mockup builds — designed here, sequenced after, and M4 may become **1.1.46** to keep rows shippable.

## Testing strategy

- **M0 (vitest):** `DocumentsPanel` renders markdown headings/tables/a KaTeX formula/an SVG from a fixture (not a `<pre>`); falls back to text on a render throw.
- **M1:** the tab shell shows Arbejde/Dokumenter, the count badge reflects materials+uploads, empty/loading/error states render; sim takeover still hides the tabs.
- **M2:** the viewer renders a fixture PDF's page count + nav/zoom controls; non-PDF routes to rich render; the raw-bytes GET is ACL-tested (teacher 200, student-visible 200, student-not-visible 403, unauth 401 — mirroring the 1.1.44 suite); lazy-load doesn't block first paint.
- **M3:** uploading attaches a `parsed_document`; setting it active pushes its `doc_id` into `document_ids` (assert the loader sees it); switching tabs switches the active file.
- **M4:** editor saves/restores content; math + formatting round-trip; sanitisation strips scripts; the saved solution reaches the tutor context.
- **E2E (LOCAL_MODE):** a teacher shares a PDF + a worksheet with a graph; a student opens the Documents tab, reads the rendered worksheet (table + formula) and pages through the PDF; (M3) uploads their own draft and the tutor critiques the active file; (M4) writes a solution with a formula and gets feedback.

## Human gates (tee up now)

1. **JB/AR — activity types.** Confirm the two mockup activity shapes are wanted as first-class types: *document-feedback* (M3) and *solution-writing* (M4), and which lands for the pilot.
2. **JB/AR — solution-editor feedback prompt** (gates M4): the tutor reading a free-text solution + highlighting values/formulas needs a reviewed prompt (reuse the verbosity/Socratic eval).
3. **Dep sign-off** (gates M2/M4): `pdfjs-dist`/`react-pdf` and `@tiptap/*` — run them through the [security gate](implemented/security-monitoring-pipeline.md) (`aipla-security-checkup`) before adding; both are standard but it's the policy.

## Open questions

- **Q1 — tabs vs activity-driven primary surface. RESOLVED (M, 2026-06-24): (b) activity-driven + tabs when >1.** The activity chooses the primary surface (sim takeover / document viewer / solution editor); tabs (Arbejde / Dokumenter / …) appear only when more than one surface coexists. Matches the mockups (each shows one focused surface), least clutter.
- **Q2 — PDF dep:** `react-pdf` (higher-level, simpler) vs raw `pdfjs-dist` (control, lighter). Recommendation: `react-pdf` unless bundle size (1.1.30) says otherwise.
- **Q3 — editor dep:** TipTap (recommended — scoped, TS, math/image extensions) vs Lexical (Meta, heavier). Recommendation: TipTap.
- **Q4 — solution storage shape:** store the editor content as sanitised HTML, or as markdown/JSON? Markdown round-trips to the tutor cleanly and reuses `ChatMarkdown` to render; recommendation: **markdown (+ KaTeX)**, editor serialises to it.
- **Q5 — does M4 belong here or as 1.1.46?** It's the largest, most independent piece (a greenfield editor + a new element + a feedback prompt). Likely **split to 1.1.46** once M0–M3 are sized against the window.

## Related documents

- [documents-workbench-surface.md](documents-workbench-surface.md) — 1.1.33; this **completes its open M3** (rich rendering) and grows the surface into a viewer + tab
- [activity-image-materials.md](activity-image-materials.md) — 1.1.44; images already render + the dual-audience GET-bytes ACL pattern reused for documents
- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38; the solution editor is a new element in the registry
- [student-multimodal-upload.md](student-multimodal-upload.md) — 1.1.7; the upload path M3 reuses (+ the "upload a PNG broken" note, 23 June — a separate bug: [imageResize.ts](../../../../frontend/src/lib/imageResize.ts) re-encodes PNG→JPEG, flattening transparency)
- [teacher-sim-resources.md](teacher-sim-resources.md) — 1.1.41; the "resource attached to an activity" + workspace-takeover model
- mockups: [workbench-JB-1.jpg](../mockups/workbench-JB-1.jpg) (document-feedback), [workbench-JB-2.jpg](../mockups/workbench-JB-2.jpg) (solution editor)
- ADR-013 (artefact safety) + ADR-015 (unified multi-surface UI) — scoping-site `architecture.qmd`
