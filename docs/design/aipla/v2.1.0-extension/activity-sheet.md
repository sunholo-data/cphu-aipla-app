# A one-page activity sheet per group: print it, or open it in the app

**Status**: **M0–M4 IMPLEMENTED 2026-11-27** (on `dev`, not yet released) — **1.1.165**
**Priority**: **P2**. Teachers asked for it, and it is cheap because every part already exists
**Estimated**: **~1.5d** (M0 evidence ~0.1d · M1 sheet builder + Word conversion ~0.5d · M2 teacher routes and page ~0.5d · M3 student copy ~0.25d · M4 tests ~0.15d)
**Scope**: Backend: new `handouts/activity_sheet.py` (pure builder, Word template, conversion), new `protocols/activity_sheet_routes.py` (teacher + student routes), `ailang-parse` 0.5.4 → 0.14.0. Frontend: `lib/activitySheetApi.ts`, a page at `app/teacher/classes/[id]/sheet/[activityId]`, an action on the class page's activity rows, a `Sheet` button in the student chat header, `components/activity-sheet/ActivitySheetView.tsx`, copy in `messages/{da,en}/`. No new collection, nothing stored
**Dependencies**: [ALS-1](../v1.1.0-feedback/activity-library-migration-notes.md) activity store (**shipped**: `Activity` → `_activity_to_config`) · AILANG Parse (`DOCPARSE_API_KEY`, already on every env for uploads)
**Source**: teacher feedback, 2026-11-27: *"generate 1-pager activity sheets that the teacher can print out and give to the students … output it as word … we have a digital copy as well available in the app, easy to view and download."*

## Problem

Groups work in AIPLA on a shared screen. Teachers want something on the table
as well: what the activity is, the steps, and how to get in. Today a teacher
copies a join link per group from the class page and writes the task on the
board or in their own document.

## Findings (M0)

1. **Everything the sheet needs is already in the student's projection.**
   `GET /api/activity-configs/active/{id}` returns the title, opening, starter
   prompts, checklist steps, workbench elements, the sim's public view and the
   materials' names. The sheet is built from the same `ActivityConfig`, through
   the same `_activity_to_config` bridge, and reads only fields students
   already see. `teachingGoal`, `tutorNotes`, a check question's
   `expectedAnswer`/`explanation` and a calculator's formula are **never**
   read by the builder; a test plants each one and asserts it is absent.
2. **AILANG Parse already generates Word.** `POST /api/v1/convert` (SDK
   `convert_file(md, target="docx", reference_doc=…)`) since SDK 0.6; we were
   on 0.5.4, which only parses. Nothing has to be added to the API. Verified
   on the dev key: Danish text, tables, headings and lists come through.
3. **It cannot express a page break in Markdown** (`\newpage`, raw HTML and
   raw OpenXML are all printed literally). A **reference template** solves it,
   and gives the sheet its look: `convert` carries the template's styles, page
   setup, header, footer and the header's image into the generated file
   (verified live 2026-11-27: the seal, header and footer all arrive, and
   `table_style` binds the generated table to the template's style). The
   template is built in code (`handouts/sheet_template.py`), not committed as
   a binary, so every part of the look is diffable and tested:
   - **A4**, 2 cm sides (the default is US Letter);
   - a **header on every page**: the KU seal (`handouts/assets/ku-seal.png`,
     160 px from the app's own `aipla-logo.png`), "AIPLA" in KU red with the
     university under it, the sheet's name on the right, above a red rule;
   - **Heading 1** is the title, 22 pt KU red, with `pageBreakBefore`, so one
     file holds one page per group;
   - **Heading 2** is a small-caps red section label over a hairline;
   - **`AiplaInfo`**, the table style of the group box (group, join link,
     names): a light KU-red tint, hairline rows, labels in red;
   - a one-line grey **footer**.
   The header names the sheet in the **activity's** language. The in-app view
   and the browser print (`printSheets`) mirror the same design, so the three
   versions read as one document.
4. **The SDK upgrade is safe for uploads.** Production parses only with
   `output_format="blocks"`; 352 document tests pass on 0.14.0. A live check found
   that `markdown` output now arrives in `text` with `markdown` empty, on 0.5.4
   and 0.14.0 alike. No production path asks for Markdown, but the wrapper now
   falls back to `text`.

## Design

### What is on the sheet

One A4 page per group, in the activity's language (`activity.language`):

| Section | From | Shown when |
|---|---|---|
| Title | `title` | always |
| Group box: group, join link, names (blank) | the class's live codes | per group; one blank sheet when there are none |
| *What you'll do* | `studentOpening` (teacher-written only) | non-empty |
| *Steps*, one ☐ line each | `checklist[].label` | any |
| *In the workspace* | sim `displayName`, table titles + columns (units), writing titles + prompts, notes (shortened to 600 chars), calculator title, solution / document prompts, concept-map title, materials the student may open | any |
| *Ask the tutor* | `starterPrompts` | any |
| "Work in AIPLA: {origin}" | the page's origin | only on a blank sheet (with a code, the box has the link) |

The *Names* line is blank on purpose. Names against codes live only in the
teacher's browser (1.1.137, ADR-001), and the sheet is built on the server, so it
cannot carry them. The group writes its names by hand.

Teacher text is escaped on the way in. A line starting with `#` would otherwise
become a heading, which in the template starts a new page, and a `|` would break
a table.

### Join codes do not leave AIPLA

A join code is a credential. The Markdown sent to AILANG Parse carries a
placeholder per group (`AIPLAGROUP01X`, …). The real codes are written into
`word/document.xml` locally after conversion, and the conversion **fails closed**
if any placeholder survives or a code is missing. The external service sees the
activity text, which is teacher-authored and already shared with every student,
and nothing that lets anyone join.

### Two formats, one builder

- `format=md` → JSON `{title, language, sheets: [{code, markdown}]}`. The app
  renders this with `react-markdown`, and **Print** uses the browser
  (`break-before: page` per sheet). This path never calls AILANG Parse, so
  printing still works if Parse is down.
- `format=docx` → the Word file (`aktivitetsark-<slug>.docx` /
  `activity-sheet-<slug>.docx`), editable by the teacher before printing. If
  Parse fails this returns **503**, and the page says *Word is unavailable
  right now; Print still works*.

### Routes

| Route | Who | Groups |
|---|---|---|
| `GET /api/classes/{class_id}/activities/{activity_id}/sheet?format=&origin=&code=` | class owner or researcher; the activity must be in the class (any owner: a teacher may print a shared-library activity assigned to their class) | the class's **live** codes (`active_group_codes`); `code=` narrows to one |
| `GET /api/activity-configs/active/{activity_id}/sheet?format=&origin=` | a student group | its own code only |

`origin` is the page's own origin (the app runs on several hostnames), and it
must match `^https?://host(:port)?$` or the link is left out and only the code
is printed. Conversion runs in `asyncio.to_thread`, so it does not block the
event loop.

### Where it shows

- **Teacher:** a *Sheet* action on each activity row of the class page opens
  `/teacher/classes/{id}/sheet/{activityId}`. It shows every group's page,
  with **Download Word** as the primary action and **Print** beside it.
- **Student:** a *Sheet* button in the chat header, next to the language switch,
  opens the group's own page in a dialog with **Download Word**.

## Milestones

- **M0** evidence (above).
- **M1** `handouts/activity_sheet.py`: `build_sheets()` (pure), `to_docx()` with placeholder substitution; `handouts/sheet_template.py`: the Word template; SDK bump.
- **M2** teacher route + page + class-page action.
- **M3** student route + header button + dialog.
- **M4** tests: builder (sections, escaping, teacher-only fields absent, languages), docx (placeholders replaced, fail-closed, A4 + page break in the template), routes (auth: non-owner 404, activity not in class 409, student sees own code only, Parse down → 503, md works without Parse).

## Not now

- **QR code per group.** It is better than a typed link for a phone, but AILANG
  Parse's Markdown path takes no images. The way in is to add an image part to
  the docx locally, the same way the codes are substituted. Worth doing if
  teachers ask.
- **Fill-in worksheet** (tables with writing space). The work happens in the
  app, and the sheet is the guide to it.
- **PDF download.** Print → *Save as PDF* covers it, and Parse does not
  generate PDF.
