# Student writing element — a text surface the student owns, exports, and the tutor reads

**Status**: **M0–M4 ALL SHIPPED 2026-08-11** (WRITING-1; `af869d2` M3, `d9de19c` M0, `1a1d876` M1, `e069c98` M2, `cfe4f30` M4) — 1.1.73
**Priority**: **P1** — requested directly by JB for the pilot; the first student-facing artefact that leaves the platform as a file
**Estimated**: ~2.5–3d phased (M0 element + store ~0.75d · M1 the four tutor wirings ~0.75d · M2 export ~0.4d · M3 diagram download ~0.3d · M4 builder + co-pilot + CLI ~0.5d)
**Scope**: Fullstack — `backend/db/models/activity_config.py` + `db/models/activity.py` + `protocols/activity_routes.py` (recipe step 1b, all three stores) + a new `db/writing_progress.py` + `protocols/writing_progress_routes.py` + `adk/element_manifest.py` + `adk/element_state.py` + `adk/authoring_tools.py` · `frontend/src/components/workspace/WorkbenchWriting.tsx` + `elementRenderers.tsx` + `lib/elementTypes.ts` + `lib/exportDocument.ts` + `SolutionWhiteboard.tsx` + the builder editor + `_AuthoringCopilot.tsx`
**Dependencies**: [1.1.38 activity-elements-palette](activity-elements-palette.md) (the registry + the add-element recipe this follows); [1.1.48 student-submission-surfaces](student-submission-surfaces.md) (**the doc that removed the previous text editor — read the reconciliation below before building**); [1.1.62 workbench-element-awareness](workbench-element-awareness.md) (the per-group store idiom + prompt-time presence); [1.1.69 tutor-sees-element-state](tutor-sees-element-state.md) (fill-state readers); [1.1.53 group-shared-session-sync](group-shared-session-sync.md) (why student state is group-keyed, not browser-keyed)
**Created**: 2026-08-11
**Last Updated**: 2026-08-11
**Source**: JB, email 2026-08-11 (quoted in full below), plus M's follow-on: *"perhaps we can also download the diagrams a student makes? currently I think it's only added to chat conversation history."*

---

## Why this exists

JB, 2026-08-11:

> Ok, I had misunderstood what "note" was. Now I know. I actually do need a new
> activity type, if possible:
>
> A text field that the students can edit and then download as txt/rtf/docx/…
>
> Crucially, the tutor should be able to see and comment on what they're writing.
>
> Didn't we have a version of this before? Perhaps it was excluded?

Three separate things are true in that message and each drives part of the design.

### 1. "note" is the wrong name for what it is

The shipped `note` element ([`WorkbenchNote.tsx`](../../../../frontend/src/components/workspace/WorkbenchNote.tsx)) is **teacher-authored reference text**, rendered read-only through `ChatMarkdown`. It has no student input, no state, and its fill-state entry is an explicit exclusion: *"teacher-authored reference text — the student does not fill it in"* ([`element_state.py`](../../../../backend/adk/element_state.py)).

A teacher reading a palette entry called **"Note"** reasonably expects a **notebook** — somewhere the student writes. JB did. That is a naming defect in a teacher-facing palette, not a misunderstanding on JB's part, and it should be fixed in the same change: rename the palette label (not the `kind`, which is wire-stable) to something unambiguous — **"Instruktion / reference"** — and label the new element **"Skrivefelt"**.

### 2. Yes, there was a version before — and it was removed for reasons that do not apply here

This is the direct answer to JB's question, and it matters because re-adding a text editor five weeks after deleting one needs an argument, not an apology.

**1.1.45 M4** shipped a **TipTap rich-text solution editor**. **1.1.48 (SUBMIT-1)** deleted it on 2026-06-25. The removal was correct and is not being reopened. From [student-submission-surfaces.md](student-submission-surfaces.md):

> **The solution editor is a TipTap rich-text editor.** It expects the student to write their solution as **typed text + LaTeX (`fx`) + image-URLs + links**.
> - Students don't type LaTeX. They don't paste image URLs. Physics solutions are **hand-written** — equations, diagrams, units, crossings-out.
> - It scores **USABLE BY DESIGN = −1** for a **student-facing** surface, which is a **hard-fail** per the product axioms.
> - It dragged in `@tiptap/*` (a rich-text + ProseMirror + a hand-rolled markdown serialiser).

Every one of those objections is about **submitting a physics solution**. None of them is about **writing prose**:

| The removed editor (1.1.45 M4) | This element (1.1.73) |
|---|---|
| Job: type your **solution** — equations, LaTeX, working | Job: write **prose** — a lab conclusion, a reflection, an argument, an interview write-up |
| The failure mode: a 16-year-old typing `\frac{1}{2}mv^2` | The failure mode does not exist: a 16-year-old typing Danish sentences is the thing they are best at |
| One-shot: composed, submitted, gone | Persistent: drafted over a lesson, revised, kept |
| Not persisted anywhere durable | Group-keyed Firestore store, survives the tab and the session |
| Not exportable — no file ever left the platform | **Export is the headline** — the student takes the file away |
| `@tiptap/*` + ProseMirror + a hand-rolled markdown serialiser | A `<textarea>`. **Zero new dependencies.** |

So: the previous version would not have satisfied this request even if it had survived, because it had no persistence and no export. What it did have — a typing surface — is one third of the ask. **The equations path is unchanged**: physics working still goes on the whiteboard or a photo (1.1.48). This element is deliberately **not** a maths editor and gets no maths toolbar; the doc says so explicitly under Non-goals so nobody re-adds one.

### 3. The diagrams are already trapped

M's follow-on is a real, separate gap. [`SolutionWhiteboard.tsx:126-143`](../../../../frontend/src/components/workspace/SolutionWhiteboard.tsx#L126-L143): "Tilføj tegning" composites the canvas onto white, produces a PNG `File`, hands it to the staging row — and then `setItems([])` **clears the board**. The image rides a multimodal turn to the tutor and lives in the conversation. The student:

- cannot download the drawing they just made,
- cannot revise it (the board was wiped),
- cannot recover it after a reload — restored history carries no image bytes (`session_restore_routes.py` has no image handling at all).

For a student assembling anything hand-in-able, a drawing that exists only as a chat attachment is not a deliverable. Two of these three are a fifteen-line fix.

**Impact.** Affects every student on every activity with written output, from the 2026-08-14 pilot onward. It is also the first concrete content the deferred **portfolio-download** item ([SEQUENCE timeline anchor](SEQUENCE.md), 2026-08-14 → 09-15 window) would have to bundle — today that item has nothing to download but transcripts.

## Goals

**Primary goal:** a student writes prose in the workspace, the text survives the tab / device / session, the tutor can read and comment on it **without the student having to paste it into chat**, and the student downloads it as a file that opens in Word, Pages, or Google Docs.

**Success metrics:**

- A teacher adds a **"Skrivefelt"** to an activity from the palette like any other element — no developer, and the authoring co-pilot can propose it.
- A student types, closes the tab, reopens on another device with the same group code, and the text is there.
- The tutor, asked *"kan du kommentere på min tekst?"*, answers about **what the student actually wrote** — no copy-paste into the chat box.
- The tutor knows the writing surface **exists** before the student touches it (manifest), and can tell **empty** from **unobserved** (fill-state reader) — the 1.1.62 / 1.1.69 lessons applied at build time instead of six weeks later.
- The student downloads `.txt`, `.md` and `.rtf`; the `.rtf` opens with its headings intact in Word, Pages, and Google Docs.
- A student downloads a drawing from the whiteboard as a PNG.
- **Zero new frontend dependencies** for M0–M3.

**Non-goals (explicit):**

- **A maths / LaTeX editor.** Settled by 1.1.48. Equations go on the whiteboard or a photo. No `fx` button, no KaTeX input, no rich-text toolbar beyond what plain markdown gives for free.
- **A rich-text (WYSIWYG) editor.** No TipTap, no ProseMirror, no contenteditable. The 1.1.48 dep-surface objection stands on its own merits.
- **`.docx` in M2** — see *Export formats* and Human gate 1. `.rtf` covers the same hosts with no dependency; real OOXML needs a ZIP writer and a vetted dep. **Shipped as designed: txt / md / rtf.**
- **A teacher hand-in / collection surface** ("show me every group's text, mark them"). That is a submission-and-collection feature, materially larger, and belongs in its own doc. The teacher **read** path here is the same dual-audience read the checklist store already has.
- **Real-time collaborative editing** between group members on separate devices. Last-write-wins with a visible notice; see Risks.
- **Portfolio download across the school year.** This element produces the content; the year-level bundle stays the deferred item it already is.

## Axiom Alignment

Scored against [product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | A `<textarea>` — no iframe, no editor framework, no cold start. Autosave and the tutor push are both debounced and off the typing path; keystrokes never await the network. Export is client-side: no round-trip at all. |
| 2 | EARNED TRUST | +1 | **The student owns the text.** The tutor comments in the chat; it never writes into the document. Sharing is visible (the debounced "delt med vejlederen" card) and the export is the student's own words, verbatim, in a file they hold. |
| 3 | SKILLS, NOT FEATURES | +1 | An additive entry on the 1.1.38 registry, following the documented recipe end-to-end. It also closes the palette's shape gap: every existing element is structured (grid, formula, checklist) or read-only; none accepts free prose. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Typing, autosaving, and exporting cost **zero tokens**. The tutor reads the text only as prompt context, and comments only when asked. The push is truncated to a bounded window so a long essay cannot silently inflate every turn's prompt. |
| 5 | GRACEFUL DEGRADATION | +1 | Store unreachable → the textarea still works, edits buffer in `sessionStorage` and flush on recovery, with a visible "ikke gemt" state (never a silent loss). No `sessionId` yet → typing works, the catch-up `writing.sync` push fires when the id arrives. Export works entirely offline. |
| 6 | PROTOCOL OVER CUSTOM | +1 | No new wire. State reaches the tutor over the shipped `POST /api/sessions/{id}/iframe-context` path (`mcp_app_context.writing.state`); the store is a third instance of the `checklist_progress` / `concept_progress` idiom, not a fourth shape; export uses **RFC-documented formats** (plain text, CommonMark, RTF 1.x) rather than an invented one. |
| 7 | API FIRST | +1 | `GET`/`PUT /api/activities/{id}/writing` mirror `checklist-progress` exactly, including its dual-audience read. `aiplatform activity` gets `writing` parity in the same milestone. |
| 8 | OBSERVABLE BY DEFAULT | +1 | OTel spans on save, on share, and on export (`export.format` as an attribute) → `activity_events`. "Did anyone actually download anything" is a pilot question we should not have to guess at. |
| 9 | SECURE BY CONSTRUCTION | +1 | Text is bounded server-side (20,000 chars) and stored as **plain text**, never HTML. It renders through the shipped `ChatMarkdown` (DOMPurify already in deps) or as `whiteSpace: pre-wrap` — no `dangerouslySetInnerHTML`. Export builds a Blob client-side, so there is **no server-side file-generation surface** to attack. The write is student-only and keys off the verified `group_id` claim — never `email`/`domain`, which are empty for anonymous-group users (ADR-001). |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Element definition, bounds, storage, and the tutor-facing manifest/fill-state synthesis are all backend. The client renders a textarea and serialises a Blob. |
| 11 | USABLE BY DESIGN | +1 | This is the axiom that killed the predecessor, and the one this design is built around: the interaction is *type in a box*, the affordance is a labelled download button, and the empty state is the teacher's prompt. Empty / saving / saved / offline / over-limit states all specified before build. Reflows single-column in the ~700px workspace pane. |
| | **Net Score** | **+11** | Threshold ≥ +4. No axiom at −1. Hard-fail rules pass. |

**Conflict justifications:** none — no axiom scores −1.

The +1 on axiom 11 is load-bearing and worth stating plainly: 1.1.48 recorded that the previous editor *"should not have shipped that way."* The difference is not that we are more careful this time; it is that the **job** changed. Typing prose is the interaction students are most fluent in. If this element ever grows a formula button, it has drifted back into the surface 1.1.48 deleted, and the −1 returns with it.

## Standards compliance

Per Axiom 6, checked before specifying anything:

- **Transport of student state to the tutor** — the existing `POST /api/sessions/{id}/iframe-context` path, landing in `mcp_app_context.writing.state`, which `wrap_with_iframe_context` injects into every agent's prompt. This is the same channel `table` and `calculator` already use. No new protocol, no new endpoint on the session side.
- **Element definition** — an additive Pydantic model on the shipped `ActivityConfig` + one `ELEMENT_REGISTRY` entry. Not a new schema language.
- **Export formats** — all three are documented public formats, not inventions:
  - `.txt` — UTF-8 plain text.
  - `.md` — CommonMark (what the student's markdown already is, and what `ChatMarkdown` renders).
  - `.rtf` — RTF 1.x. A ~40-line serialiser: an ASCII header, `\uN?` escapes for Danish characters, `\par` for paragraphs, `\b`/`\i` for the two inline marks markdown gives us. **No dependency.** Opens with formatting in Word, Pages, Google Docs, LibreOffice.
  - `.docx` — **OOXML, deliberately deferred.** It is a ZIP of several XML parts and needs a ZIP writer; the browser has no zero-dep path that is honest. The dishonest path — emitting HTML with a `.doc` extension — is explicitly rejected: it fabricates a format, opens as a warning dialog in Word and not at all in Pages, and would score −1 on EARNED TRUST for a file the student hands to a teacher. See Human gate 1.
- **Rendering** — `ChatMarkdown` (shipped, DOMPurify-backed) for the read view. No new renderer.

## Framework-native capability check

Per 5b-ter — for each piece of custom plumbing, the evidence that the stack does not already do it:

| Proposed plumbing | Is it already native? | Verdict |
|---|---|---|
| Getting the student's text to the tutor | **AG-UI carries text natively** — `UserMessage.content` is `string \| InputContent[]`. But that is a **chat turn**. JB's ask is that the tutor *"see what they're writing"* continuously, without the student sending each draft as a message. A turn per keystroke-burst is exactly the chat-spam the trust-card debounce exists to avoid. | **Use the shipped `iframe-context` path**, not a new one and not a turn. Native-enough: this is the channel the table already uses for the identical problem. |
| Persisting the text | **ADK session events replay for free** and survive rejoin — genuinely native, and the right answer for images (the 1.1.7 lesson). **But session-scoped is not enough here.** `db/checklist_progress.py` records the precedent verbatim: ticks used to live in `sessionStorage` keyed by skill id, *"so they were per BROWSER … three group members had three private checklists and none of them survived a closed tab."* A draft written across two lessons on two devices has the same shape. | **A Firestore store is required.** But it must be the **third instance of one idiom**, not a third shape — `db/writing_progress.py` mirrors `db/checklist_progress.py` and `db/concept_progress.py` field-for-field. |
| Storing the exported file | **ADK artifacts are GCS-backed and MIME-agnostic** — real, and used by the document pipeline. | **Not needed.** The text is already in the browser; the Blob is built client-side and `URL.createObjectURL` hands it to the user. Storing a server-side copy of a file the student already has would add a data-retention surface for zero benefit. Explicitly not doing it. |
| A download helper | `frontend/src/lib/download.ts` already exists — `triggerDownload` + `downloadCsv` + `downloadJson`, used by the teacher class-export. | **Reuse it.** `lib/exportDocument.ts` adds only the serialisers and calls the shipped `triggerDownload`. |
| Telling the tutor the element exists / is empty | `element_manifest.py` `_DESCRIBERS` and `element_state.py` `_READERS` are the shipped registries, both with tests that fail on a kind that declares neither. | **Reuse both.** A new entry each; no new mechanism. |

## Design

### The element

```python
# backend/db/models/activity_config.py

class WritingElement(BaseModel):
    """A student writing surface (1.1.73, JB 2026-08-11).

    The teacher authors the prompt and the bounds; the STUDENT's text is not
    stored here — it lives in db/writing_progress.py, group-keyed, like every
    other piece of per-group student state.
    """
    id: str
    title: str = ""                                  # "Konklusion", "Refleksion"
    prompt: str = ""                                 # shown above the box; the empty state
    placeholder: str = ""
    min_words: int = Field(default=0, ge=0, le=2000, alias="minWords")   # a target, never a gate
    max_chars: int = Field(default=20000, ge=200, le=20000, alias="maxChars")
```

Registry entry:

```python
"writing": ElementSpec(kind="writing", field="writing", max_items=3, render="workspace"),
```

**`max_items=3`, and the renderer takes an array from day one.** Not a singleton. [1.1.71](multi-table-activities.md) is the second time a positional singleton has had to be un-picked, and its finding applies directly: *"mint stable ids from the existing key, preserving saved ids on load"* — because student data is keyed by element id, and re-minting ids orphans it. A lab report with both a *method* box and a *conclusion* box is an obvious first request. Building for one and widening later is the exact mistake 1.1.71 documents.

`min_words` is a **target displayed to the student** ("mål: 150 ord"), never a submit gate. Blocking a 16-year-old's save on a word count is a −1 on USABLE BY DESIGN for no pedagogical gain.

**Recipe step 1b applies in full** — thread `writing: list[WritingElement]` through **all three** stores (`ActivityConfig`, `Activity`, `ActivityUpsert`) **and both adapters** (`_activity_from_body`, `_activity_to_config`). `test_every_element_field_is_present_on_all_activity_models` catches a missing model field; the adapter mappings are **not** auto-checked, so add the POST→GET round-trip test — this is precisely the gap that produced the 1.1.48 `document` regression.

### Student state — `db/writing_progress.py`

Firestore document at `writing_progress/{group_id}:{activity_id}`. Same shape, same idiom, same group-keying (ADR-001: no individual profiling) as `checklist_progress`:

```json
{
  "groupId": "...", "activityId": "...",
  "docs": {
    "<element_id>": {
      "text": "…",
      "words": 142,
      "revision": 7,
      "updatedAt": "2026-08-11T09:14:22Z"
    }
  },
  "updatedAt": "2026-08-11T09:14:22Z"
}
```

`revision` is a monotonic counter used for the conflict notice, not for merging. Autosave is debounced at **2s idle, and on blur**; a save is a no-op when the text is unchanged. Server bound: 20,000 chars, rejected with 422 (the client caps at the same number and shows a counter from 90%, so the 422 is a backstop, not a UX).

### The four tutor wirings

Per the [`workbench-element-builder`](../../../../.claude/skills/workbench-element-builder/SKILL.md) skill. All four, in the same milestone, because the last two exist precisely because earlier elements shipped without them and a teacher found the gap six weeks later.

**1. The push (data → AI).** `useSimSnapshotPush(sessionId, "writing")`, event `writing.commit` (passive — no unprompted tutor reply), fired on the same debounce as autosave. Snapshot:

```ts
interface WritingSnapshot {
  docs: {
    id: string;
    title: string;
    text: string;        // clipped to WRITING_PUSH_CHAR_CAP (head + tail)
    words: number;
    chars: number;
    truncated: boolean;  // told to the tutor in as many words
  }[];
}
```

> **Amended during build (2026-08-11).** This was specified as a per-element
> snapshot carrying one `elementId`. Reading [`element_state.py`](../../../../backend/adk/element_state.py)
> before writing the reader showed why that is wrong: every table pushes to the
> *same* `mcp_app_context.table.state` key, so only one table's snapshot is ever
> live and `_read_table` has to compensate with "any other authored table
> reports EMPTY" — the defect 1.1.71 exists to fix. `_read_calculator` has no
> such problem because it pushes **every** calculator in one array, matched by
> id. With `max_items = 3` from day one, writing copies the calculator. The
> clip also keeps the **opening plus the tail** rather than the tail alone, so
> the tutor knows what the piece set out to be and not only where it currently
> is.

**The cap is load-bearing** (Axiom 4). This state is injected into **every** agent prompt for the rest of the session, so an uncapped 20,000-char essay is ~5k tokens on every turn. `WRITING_PUSH_CHAR_CAP = 4000`, keeping the **most recent** 4000 chars (what the student is working on now) plus the first paragraph for orientation, with `truncated: true` so the tutor states the limit rather than commenting confidently on half a text. A student who wants feedback on the whole thing gets it through the explicit request path below, which sends the full text as one turn.

Plus the standard catch-up effect: on `sessionId` arrival, push any element with text as `writing.sync` — **silent, no card**.

**2. The trust card (confirmation → student).** Continuous entry, so this is the **debounced** shape — `WorkbenchTable`'s pattern, not the calculator's. One card per writing burst, `WRITING_CARD_DEBOUNCE_MS = 3000` (longer than the table's 1200ms: writing bursts are longer than tabbing through cells). Label, in Danish:

```
Din tekst delt med vejlederen (142 ord)
```

No card on the `writing.sync` catch-up. `make audit-trust-cards` must stay green.

**3. Prompt-time presence.** A real `_describe_writing` in `element_manifest.py` — not the generic fallback. It names the surface and, critically, states the pedagogical rule:

> The student has a writing surface titled "Konklusion". They draft prose there and you receive it as they write. **Comment on it, ask about it, and point at what is missing — never rewrite it for them and never write it into their document; your feedback belongs in this conversation.** They may ask you to look at it explicitly.

That last clause is the Axiom 2 guarantee expressed where it actually binds. A tutor that offers to "fix it up for you" turns a student's work into the model's work, which is the failure mode a Danish gymnasium teacher will be judged on.

**4. Fill state.** A **real reader** in `element_state.py` `_READERS` — unlike `solution` and `document`, which carry documented `NoFillChannel` exclusions because their work arrives as a chat turn. Writing has an observable channel, so emptiness is reportable:

```
Writing surface "Konklusion": EMPTY — the student has written nothing
Writing surface "Konklusion": PARTIAL — 142 words written (target 150)
```

> **Amended during build (2026-08-11).** `ElementFill.is_demonstrably_empty` is
> `total > 0 and filled <= 0`, and `total <= 0` renders `UNKNOWN — nothing
> authored to fill in`. A surface with no `minWords` has no natural
> denominator, so it would have reported UNKNOWN and the 1.1.69 M3 refusal
> would never have fired on the element where "I've written it" is the most
> tempting untrue claim. An untargeted surface therefore carries a **nominal
> total of 1**, and `_line` formats `writing` separately so the prose never
> reads "0 of 1 words".

This directly serves the failure Aswin hit on 2026-08-10 — *"I said 'done' without filling out the data, it did not recognize the data empty"* — for the element where "I've written it" is the most tempting claim to make untested.

### Asking for feedback — a deliberate turn

The push makes the text **available**. A student who wants comment now gets a button under the box:

**"Bed vejlederen om feedback"** → `onProactiveTrigger("Kan du give mig feedback på det jeg har skrevet?")` carrying the **full, untruncated** text for that one turn.

Per the decision rule, this is the *sends a real chat turn* shape: **no trust card** — the turn is the confirmation. It also resolves the interruption question the right way round: the tutor sees the writing continuously but comments when asked, rather than volunteering a critique into a half-finished sentence. (Whether it should ever comment unprompted is Human gate 2.)

### Export

`frontend/src/lib/exportDocument.ts`, on top of the shipped `triggerDownload`:

```ts
export type ExportFormat = "txt" | "md" | "rtf";
export function exportWriting(doc: WritingExport, format: ExportFormat): void;
```

Every export carries a small provenance header, so a file that reaches a teacher's inbox says what it is:

```
Konklusion — Bølger og resonans
Gruppe: sweet-bison-13 · 11. august 2026
────────────────────────────────────────
<the student's text>
```

Filename: `<aktivitet-slug>-<felt-slug>-2026-08-11.rtf`. `slugify` already exists but lives in `app/teacher/classes/[id]/_exportHelpers.ts` — lift it to `lib/download.ts` alongside `triggerDownload` rather than importing a teacher-route module into a student component (the eslint surface fence would be right to object).

The RTF serialiser is the only new logic: an ASCII-safe header (`{\rtf1\ansi\deff0…`), `\uNNN?` escapes for `æ ø å` and anything non-ASCII, `\par` between paragraphs, `\b`/`\i` for markdown's two inline marks, headings as bold. ~40 lines and a table-driven test; nothing about it needs a dependency.

**M2 ships a dropdown** (txt · md · rtf) rather than three buttons — three buttons for a secondary action is clutter in a 700px pane.

### Diagram download

Two changes to [`SolutionWhiteboard.tsx`](../../../../frontend/src/components/workspace/SolutionWhiteboard.tsx), both small:

1. **"Hent tegning"** in the toolbar — the same white-composite path as `add()`, but `triggerDownload(blob, "tegning-2026-08-11.png")` instead of `onAdd`. **~15 lines**, no backend, no state change.
2. **Stop clearing the board on send.** `add()` currently calls `setItems([])`, so a student who sends a drawing loses the ability to revise it. The "Ryd" button already exists for deliberate clearing. Keep the ink; show the staged thumbnail as it does today. (One-line change; flagged as Open Question 3 in case the clear-on-send was deliberate for the multi-page case, though the code comment — *"staged → clear the board for the next page"* — reads as an assumption rather than a requirement.)

**What is explicitly out of scope:** downloading an image from *restored* chat history. Checked: `session_restore_routes.py` has no image handling, so the bytes are not in the restored payload. Making them so is a persistence change (artifact-backed) with its own retention questions, and it belongs with **portfolio-download**, not here. Say so in the UI copy rather than shipping a button that works before reload and fails after.

### CLI surface

`aiplatform activity` gains `writing` parity with `note` — set/list/remove — so an activity with a writing field can be created and inspected without the browser. Mirrors the existing element flags exactly; ~0.15d.

## API changes

Both mirror `checklist_progress_routes.py`, including its dual-audience read and its enumeration-resistant 404.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/activities/{activity_id}/writing` | **Dual-audience** | Student (group JWT) → `{docs: {...}}` for their **own** group, keyed off the verified `group_id` claim, never a query param. Owning teacher → `{groups: {groupId: docs}}`. Anyone else → 404. |
| `PUT` | `/api/activities/{activity_id}/writing` | **Student only** | Body `{elementId, text}`. Teacher preview has no group to record against, and the only way to supply one would be a request field — the parameter this design refuses to have (`checklist_progress_routes.py`, verbatim reasoning). 422 above `max_chars`. |

`POST /api/activities` / `/api/activity-configs` gain the `writing: []` field on the upsert body (`extra="forbid"` — miss this and the builder 422s).

**Frontend auth helper:** `fetchWithAuth` (group token) from the student workspace. The eslint `no-restricted-imports` fence in `frontend/.eslintrc.json` already covers `components/workspace` — a `fetchWithTeacherAuth` here fails lint, which is the guard working.

## Security

- **Bounded** — 20,000 chars server-side, `max_items=3`, 2,000-char prompt bound from the element model. The registry's cap validator applies unchanged.
- **Plain text in, plain text out.** Stored as text, never HTML. Rendered through `ChatMarkdown` (DOMPurify, already a dep) or `pre-wrap`. No `dangerouslySetInnerHTML` anywhere on this path.
- **No server-side file generation.** Export is a client-side Blob; there is no endpoint that takes text and returns a file, so there is no template-injection or resource-exhaustion surface to review.
- **ADR-001 corner, checked explicitly.** The write keys off the verified `group_id` JWT claim. `user.email` and `user.domain` are `""` for anonymous-group students — using either as a Firestore key yields `400 invalid document path`. A `test_dual_auth_rejection`-style test is required, per the four-times-shipped bug in memory `feedback-anonymous-users-are-corner-case`.
- **No Firestore `onSnapshot`** for the live text. Group JWTs are not Firebase identities; client-SDK rules deny them. Poll-free is fine here — the autosave PUT is the write and the GET on mount is the read.
- **Rate limiting.** Autosave is debounced client-side, but the endpoint is bounded server-side too (a hostile client is a real anonymous-group consideration): reject more than N writes/minute per group.

## Migration

Purely additive. No backfill, no data migration, no feature flag needed — activities without a `writing` field render exactly as today (the renderer self-hides on an empty array, like every other element).

The one non-additive edit is the **palette label rename** (`note` → "Instruktion / reference"). Label only; the `kind` string, the Firestore field, and every stored row are untouched.

## Milestone phasing

| M | Scope | Side | Est. | Gate |
|---|---|---|---|---|
| **M0** | `WritingElement` + registry entry + all three stores + both adapters (recipe 1b) + `db/writing_progress.py` + the two routes + round-trip test | BE | ~0.75d | — |
| **M1** | `WorkbenchWriting.tsx` + renderer registration + autosave + **all four tutor wirings** (push, debounced card, `_describe_writing`, fill reader) + "Bed om feedback" | FS | ~0.75d | M0 |
| **M2** | `lib/exportDocument.ts` (txt · md · rtf) + the export control + provenance header | FE | ~0.4d | M1 |
| **M3** | Whiteboard "Hent tegning" + stop clearing on send | FE | ~0.3d | — (independent; ship first if M0 slips) |
| **M4** | Builder editor block + **co-pilot `add_element` coverage** (recipe 5b, both sides) + CLI parity + the palette rename | FS | ~0.5d | M0 |

M3 has no dependency on the rest and is the cheapest visible win in the batch — it can ship on its own the day it is written.

## Testing strategy

**Backend (pytest):**
- Round-trip: POST an activity with a `writing` element → GET → the element survives **both** adapters (the 1.1.48 regression shape).
- `test_every_element_field_is_present_on_all_activity_models` — passes with the new field.
- `test_every_registered_element_kind_is_described` — a real describer, not the generic fallback.
- `test_every_element_kind_declares_a_fill_reader` — a reader, and it reports `EMPTY` for an authored-but-untouched surface and `PARTIAL` with a word count once text arrives.
- Store: upsert, revision increment, 20,000-char rejection, group isolation (group A cannot read group B).
- **Dual-auth:** student reads own group; owning teacher reads all groups; a teacher `PUT` is rejected; a non-owner gets 404.

**Frontend (vitest):**
- Typing → debounced autosave PUT fires once, not per keystroke.
- Typing → **the push fires** (`writing.commit`) **and exactly one trust card** dispatches per burst (fake timers, `WRITING_CARD_DEBOUNCE_MS`).
- The `sessionId`-arrival catch-up pushes `writing.sync` and dispatches **no** card.
- Push snapshot is tail-truncated at the cap with `truncated: true`.
- "Bed om feedback" fires a turn with the **full** text and **no** card.
- Export: txt / md / rtf serialisers, including Danish characters (`æøåÆØÅ`) surviving the RTF `\uN?` escape — table-driven.
- Whiteboard: "Hent tegning" triggers a download and does **not** clear the items; "Tilføj tegning" no longer clears either.
- Co-pilot: `add_element(kind="writing")` parses to a proposal, previews, and Apply lands it on the builder state.
- States: empty / saving / saved / offline-buffered / over-limit all render.

**Gate:** `make audit-trust-cards` green — the new element must not appear as a pushes-without-carding row.

## Human gates (tee up to JB now)

1. **Is `.rtf` enough, or is real `.docx` required?** (Gates M2 scope.) `.rtf` opens with formatting in Word, Pages, Google Docs and LibreOffice, and costs zero dependencies. Real `.docx` means a ZIP writer and a new frontend dep through `make security-check`. JB's *"txt/rtf/docx/…"* reads as *"a file that opens in Word"*, which `.rtf` satisfies — but he is the one who will watch students hand these in, so he should confirm rather than have us assume.
2. **Should the tutor ever comment unprompted while the student writes?** Default proposed: **no** — it sees the text continuously, comments when asked. Unprompted commentary on a half-written sentence is an interruption, and the proactive machinery exists if JB wants it (a `writing.commit` gate at, say, "the student has stopped typing for 60s and passed the word target"). Cheap to add later; expensive to un-ship.
3. **One text per group, or one per student?** Everything student-facing is group-keyed today (ADR-001, no individual profiling). But an essay feels personal in a way a data table does not, and two group members typing into the same box on two phones will overwrite each other. Group-keyed is the default here because a private-per-student store would be the first individual-level student record in the system and needs the ADR-001 conversation, not an engineering decision. **JB should confirm the classroom shape:** is the writing a group product?
4. **Does the teacher need to collect these?** Explicitly out of scope above (the read endpoint exists; a marking surface does not). If JB expects to *receive* them, that is the next doc and should be scoped before the pilot rather than discovered during it.

## Open questions

1. **Should the export bundle the drawings?** A single `.rtf` with the text plus the student's diagrams inline would be the actual "hand-in" artefact — but RTF image embedding is hex-encoded bitmaps and non-trivial, and the in-session-only availability of drawings (see Design) makes the bundle incomplete by construction. Deferred to portfolio-download, where the persistence question gets answered properly.
2. **`WRITING_PUSH_CHAR_CAP = 4000` — right number?** Chosen so a full workspace of elements plus the writing stays well inside a sane prompt budget. Wants a measurement against a real pilot activity rather than a guess; the fill-state line reports word count regardless, so the tutor is never blind, only ever partially sighted.
3. **Was `setItems([])` on "Tilføj tegning" deliberate?** The comment says *"staged → clear the board for the next page"*, which reads as an assumption about multi-page working. If a student really does draw page 2 on a blank board, keeping the ink is mildly wrong for them and clearly right for everyone revising a single diagram. Proposal: keep the ink, since "Ryd" is one click.
4. **Does the writing surface belong in the tab strip or stacked?** Elements stack today (1.1.38 Q1 resolution). A writing box wants vertical room, and stacked-below-a-sim on a phone could bury it. Same question the workbench tabs already answer for documents; follow whatever `WorkbenchTabs` does rather than inventing a third placement rule.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Two group members overwrite each other's text** | Medium (group-shared devices are the shipped premise of 1.1.53) | High — lost student work | Last-write-wins on `revision`, plus a visible *"Teksten blev opdateret på en anden enhed"* notice with the incoming text shown before it replaces theirs. Not a merge; an honest interruption. Real collaborative editing is out of scope and should stay out. |
| **The prompt inflates** — a long text on every turn | Medium | Medium (cost + latency, Axiom 4) | Tail truncation at 4000 chars with `truncated: true`; the full text only ever rides the explicit feedback turn. Watch `tutor.prompt_tokens` on activities with a writing element during the pilot. |
| **The tutor rewrites the student's text** | Medium — it is the most natural thing for a helpful model to offer | High (Axiom 2; and the pedagogical objection a teacher will raise first) | The instruction is explicit in the manifest describer, and the tutor has **no write path** into the document by construction — there is no tool that can. Add an eval case asserting the tutor declines to ghost-write and offers questions instead. |
| **`.rtf` renders badly somewhere that matters** | Low | Medium | Verify by hand in Word (Mac + Windows), Pages, Google Docs, LibreOffice before M2 is called done. `.txt` is the always-works fallback in the same dropdown. |
| **It grows a formula button** | Medium over time — someone will ask | High — this is the drift back into the surface 1.1.48 deleted | The Non-goals section is the record. Equations belong on the whiteboard; a PR adding maths input to this element should be read as a request for a different element. |

## Success criteria

- [ ] A teacher adds a "Skrivefelt" from the palette; the authoring co-pilot can also propose one.
- [ ] A student types, closes the tab, reopens on another device with the same group code — the text is there.
- [ ] The tutor answers *"kan du kommentere på min tekst?"* about the actual text, with no copy-paste.
- [ ] The tutor's manifest names the writing surface **before** the student touches it; the fill-state block distinguishes `EMPTY` from unobserved.
- [ ] The tutor comments and questions; it never writes into the student's document (eval case).
- [ ] `.txt`, `.md` and `.rtf` download; the `.rtf` opens with headings and Danish characters intact in Word, Pages and Google Docs.
- [ ] A student downloads a whiteboard drawing as a PNG, and the board is no longer wiped on send.
- [ ] Exactly one trust card per writing burst; `make audit-trust-cards` green.
- [ ] Zero new frontend dependencies through M3.
- [ ] `aiplatform activity` can set and read a `writing` element.

## Related documents

- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38, the registry and the add-element recipe this follows step by step
- [student-submission-surfaces.md](student-submission-surfaces.md) — 1.1.48, the doc that removed the TipTap editor; the reconciliation above is written against it
- [rich-document-workbench.md](rich-document-workbench.md) — 1.1.45, where the removed M4 editor came from
- [workbench-element-awareness.md](workbench-element-awareness.md) — 1.1.62, prompt-time presence + the per-group store idiom
- [tutor-sees-element-state.md](tutor-sees-element-state.md) — 1.1.69, fill-state readers and the EMPTY-vs-unobserved distinction
- [group-shared-session-sync.md](group-shared-session-sync.md) — 1.1.53, why student state is group-keyed rather than browser-keyed
- [multi-table-activities.md](multi-table-activities.md) — 1.1.71, the singleton-and-id-minting lesson applied here up front
- [activity-authoring-assistant.md](activity-authoring-assistant.md) — 1.1.39, the co-pilot `add_element` coverage required by recipe 5b
- `.claude/skills/workbench-element-builder/SKILL.md` — the operational four-wirings checklist
