# Sprint plan — 1.1.45 rich-document-workbench

**Design doc:** [rich-document-workbench.md](rich-document-workbench.md)
**Sprint ID:** `RICH-DOC`
**Created:** 2026-06-24
**Estimate:** ~6–9d phased (M0 fast win; M2 + M4 are greenfield deps)
**Scope decision (M, 2026-06-24):** full M0–M4; **layout = activity-driven primary surface + tabs only when >1 surface**.
**Depends on:** [1.1.33 documents-workbench-surface](documents-workbench-surface.md) (completes its M3), [1.1.44 activity-image-materials](activity-image-materials.md) (images + dual-audience GET-bytes pattern, SHIPPED), [1.1.38 elements-palette](activity-elements-palette.md), [1.1.7 student-multimodal-upload](student-multimodal-upload.md).

**TDD throughout** — test first, green, lint after each milestone. CI parity per milestone: `cd backend && make lint && make test-fast` + `cd frontend && npm run quality:check`. Greenfield deps go through `make security-check` (the `aipla-security-checkup` gate) **before** the milestone that needs them; both are **lazy-loaded / code-split** (Axiom 1/10 — keep the chat bundle thin).

## Milestones

### M0 — Rich parsed-doc rendering (frontend, TDD) — *the immediate win; completes 1.1.33 M3*
- **`frontend/src/components/workspace/DocumentsPanel.tsx`** — replace the inline `<pre>{view.content.text}</pre>` viewer body with **`ChatMarkdown`** fed `view.content.text` (already the parsed markdown from `fetchCurriculumContent`). Keep the truncation note. Wrap in an error boundary / try-guard → fall back to `<pre>` text on a render throw (graceful).
- No backend change (content read already returns markdown).
- **Tests** (`DocumentsPanel.test.tsx`): a fixture doc with a heading + table + `$…$` KaTeX formula + an SVG renders as rich nodes (NOT a single `<pre>`); a doc whose render throws falls back to text; the existing "not available" / empty states unchanged.

### M1 — Documents tab + activity-driven workbench shell (frontend, TDD)
- **`frontend/src/components/workspace/StudentWorkspace.tsx`** — introduce a surface model: when **>1** surface is present (elements **and** documents), wrap them in **Radix Tabs** (`@radix-ui/react-tabs`, installed) — **Arbejde** (`WorkspaceElements`) / **Dokumenter** (`DocumentsPanel`); when only one surface exists, render it directly (no tab layer). Sim stays the takeover surface (1.1.41) and pre-empts tabs while open. Documents tab shows a **count badge** (materials + uploads).
- New small `WorkbenchTabs` component (Radix wrapper, styled to the workbench).
- **Tests** (`StudentWorkspace.test.tsx`): elements-only → no tabs; documents-only → no tabs; both → tabs with Arbejde/Dokumenter + badge count; sim open → takeover (no tabs); tab switch shows the right surface.

### M2 — Document viewer + file tabs + GET raw bytes (fullstack, TDD)
- **Security gate first:** `make security-check`; vet + add **`react-pdf`** (wraps `pdfjs-dist`) — lazy-loaded via `next/dynamic` (no SSR), so it's a separate chunk.
- **Backend** — generalise the 1.1.44 dual-audience bytes handler to documents: `GET /api/documents/{docId}/raw` streams the original bytes (from GCS `storagePath`), ACL-gated (teacher owner OR student-on-bound-activity-if-visible). Reuses `resolve_active_config` + the material/`studentVisible` gate.
- **Frontend** — `DocumentViewer` (lazy): **PDF** → `react-pdf` multi-page canvas with page-nav (‹ n/total ›), zoom (− % +), fullscreen, download (JB-1 control bar); **image** → `ZoomableImage`; **other/parsed** → M0 rich render; **fallback** → the existing `PDFCard` download card on viewer error. **File tabs** across the top when multiple files, one **active file**. Bytes fetched via the group/teacher token into an object URL (the 1.1.44 `fetchActivityImageObjectUrl` pattern — generalise to `fetchDocumentObjectUrl`).
- **Tests** — backend: raw-bytes ACL suite (teacher 200, student-visible 200, student-not-visible 403, unauth 401, missing 404 — mirror `test_activity_images.py`). frontend (vitest): viewer renders a fixture PDF's page count + controls (mock `react-pdf`); non-PDF routes to rich render / zoom; file-tab switch sets the active file; lazy import doesn't block first paint.

### M3 — Student upload + active file → tutor (fullstack, TDD)
- **Frontend** — "Upload fil" affordance in the Documents tab → reuse the 1.1.7 upload path → `parsed_documents`; show the uploaded file as a new file tab; selecting it sets the **active file**.
- **Wiring** — the active file's `doc_id` is pushed into the session's **`document_ids`** (the existing `forwardedProps.document_ids` / `make_document_loader` path), so the tutor critiques the active file; switching the active tab switches what the bot works with.
- **Backend** — confirm `document_ids` carries a student-uploaded `doc_id` through the loader (it already does for chat attachments); add a thin "set active document(s) for this session" affordance if needed.
- **Tests** — frontend: upload adds a file tab + sets active; switching active updates the `document_ids` sent on the next turn. backend: a student-uploaded `doc_id` in `document_ids` loads its artifact (extend `test_document_loader` coverage if a gap).

### M4 — Rich-text solution editor element (fullstack, TDD) — *largest; may split to 1.1.46*
- **Security gate first:** `make security-check`; vet + add **`@tiptap/react` + `@tiptap/starter-kit`** (+ link/image/math extensions) — lazy-loaded via `next/dynamic`.
- **Element** — extend the [1.1.38] registry with a `solution` element (`ELEMENT_REGISTRY` + spec + frontend mirror); authorable in the builder (a `SolutionEditorEditor` config is minimal — title + optional prompt).
- **Student surface** — `WorkbenchSolution` (lazy TipTap) with the JB-2 toolbar (B/I/U, bullet/numbered lists, link, image, **`fx` KaTeX math**, undo/redo) + word count; **autosave (Gem kladde)** + explicit **Gem løsning**; serialise to **markdown (+KaTeX)** (doc Q4) so it round-trips to the tutor and re-renders via `ChatMarkdown`.
- **Tutor** — the saved solution is surfaced to the tutor as markdown content (session state / a `document_ids`-like channel) so feedback can highlight values + formulas (JB-2 bot). Sanitised on store; never executed.
- **Tests** — backend: `solution` element validates + persists; the saved solution reaches the tutor context. frontend: editor saves/restores; math + formatting round-trip to markdown; sanitisation strips scripts; word count updates.

## Acceptance (from design)
- A shared worksheet renders **rich** (headings/tables/SVG/**formulas**), not a `<pre>` dump (M0). The student reads it in the **Documents tab** alongside the tools, tabs appearing only when both exist (M1).
- A PDF reads in place — pages, zoom, fullscreen, download — and the tutor critiques the **active file** (M2/M3).
- A student can write a formatted solution with formulas and get feedback on it (M4).
- All bytes/content are **ACL-gated** (teacher owner / student-visible-on-bound-activity — the 1.1.44 rule); raw-bytes endpoint mirrors its 5-case ACL test.
- New deps are **lazy-loaded** (not in the chat first-load bundle) and **passed the security gate**.
- `make lint` + `make test-fast` + `npm run quality:check` green each milestone.

## Deferred / out of scope
- The **"upload a PNG broken"** bug ([imageResize.ts](../../../frontend/src/lib/imageResize.ts) PNG→JPEG flatten) — tracked separately, not this sprint.
- Annotation/markup ON the PDF (highlighting) — viewer is read + page-nav only.
- Collaborative editing; version history on solutions.
- M4 may be **split to 1.1.46** if M0–M3 fill the window (decision point after M3).

## Human gates
- **JB/AR** — confirm the two activity types (document-feedback M3, solution-writing M4) for the pilot; **AR** on the solution-editor feedback prompt (gates M4 ship to a pilot env).
- **Dep sign-off** — `react-pdf`/`pdfjs-dist` (M2) + `@tiptap/*` (M4) through `make security-check` before adding.
