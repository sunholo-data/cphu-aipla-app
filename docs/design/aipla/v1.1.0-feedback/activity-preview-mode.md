# Activity preview mode — live in-builder workspace preview

**Status:** **M0 SHIPPED 2026-06-22** (frontend); M1–M2 planned (P1, v1.1 — small; reuses the shipped element renderers)
**Last Updated:** 2026-06-22
**Priority:** **P1** — closes the authoring feedback loop opened by the [element palette](activity-elements-palette.md) (1.1.38). A teacher now authors a checklist + data table + chart + calculator + note, but to **see how it looks and works** they must save → mint a group code → open another browser → join as a student. This is the fast, in-builder "what will the student see?" preview.
**Estimated:** ~1–1.5d (frontend-only; the student renderers + the table→chart reactivity already ship)
**Scope:** **Frontend** — a preview pane in [`/teacher/activities/new`](../../../../frontend/src/app/teacher/activities/new/page.tsx) + [`/teacher/activities/[id]`](../../../../frontend/src/app/teacher/activities/[id]/page.tsx) that mounts the shipped [`WorkspaceElements`](../../../../frontend/src/components/workspace/elementRenderers.tsx) from the builder's current (unsaved) state. A small `builderToElementDefs()` converter (editor-value shapes → element-def shapes). No backend.
**Source:** 2026-06-22 — M: *"a preview mode … where a teacher can quickly see how it looks and works."* Follows the [activity-elements-palette](activity-elements-palette.md) (1.1.38 M0–M4 shipped) + the starter [templates](activity-elements-palette.md) (`activityTemplates.ts`).

> **Read with [lesson-author-surface.md](lesson-author-surface.md) (1.1.27) — they are the two halves of "see before you publish."** 1.1.27 owns the **resolved-prompt preview** (what the *tutor* will say — system-prompt provenance) and the **trial chat session** (a real teacher-as-student run with the model). **This doc owns the third, missing half: the live preview of the *workspace elements*** — the table / chart / calculator / note / checklist a teacher just authored, rendered exactly as a student sees them, **instantly and interactively, with no save and no session.** Together: workspace (1.1.40) + tutor (1.1.27) = the whole activity, previewable before any student joins.

## Why this exists

The [element palette](activity-elements-palette.md) (1.1.38) gave teachers five authorable workspace elements. But authoring is currently **blind**: the builder shows *editor forms* (define columns, write a formula, type Markdown), never the *student rendering*. To check "does my data table have the right columns? does the chart plot sensibly? does my formula compute? does the note render?" a teacher must publish and join as a student — a multi-minute, multi-tab loop that discourages iteration.

The fix is cheap because **the student renderers already exist and are pure**: [`WorkspaceElements`](../../../../frontend/src/components/workspace/elementRenderers.tsx) + the per-kind renderers (`WorkbenchTable`, `WorkbenchChart`, `WorkbenchCalculator`, `WorkbenchNote`, `ProgressChecklist`) render from plain element-def props and manage their own local state. So the preview is *"mount `WorkspaceElements` from the builder's live state"* — no new render code, and the elements are **already interactive** (tick the checklist, fill the table → the chart plots via the shipped `aipla:table-change` event, use the calculator → it computes via `safeFormula`). The teacher sees how it **looks** *and* **works**, locally, with zero round-trips.

## Goals

**Primary goal:** As a teacher authors an activity, a preview pane renders the workspace **exactly as a student sees it**, updating live on every edit — and the elements are **interactive** so the teacher can feel the tools (fill a row, watch the chart plot, compute a formula) without saving or starting a session.

**Success metrics:**
- A teacher can author a table + chart, see the chart plot from sample values they type into the preview, and correct the columns — **without saving or joining as a student** (the whole loop stays in the builder).
- Picking a [template](activity-elements-palette.md) shows its assembled workspace in the preview **instantly**, so "start from a template → see it → tweak" is one screen.
- Zero new backend surface; the preview reads only the builder's in-memory state and reuses the shipped renderers.

**Non-goals (explicit):**
- The **tutor / chat** dimension — that's the **trial session** in [1.1.27](lesson-author-surface.md). The preview has no model, no chat, no session; it is the *workspace* half.
- The **resolved system prompt** — also [1.1.27](lesson-author-surface.md).
- **Persisting** preview interactions — the preview is throwaway scratch state (the teacher's pokes are never saved or sent to a tutor).
- A separate **render path** — the preview MUST reuse `WorkspaceElements`; if the preview and the student diverge, the preview is worthless (so: same components, not a lookalike).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Pure client-side render from React state — updates on keystroke, no save / session / network in the loop. The fastest possible authoring feedback. |
| 2 | EARNED TRUST | +1 | The teacher sees **exactly** what students will see before publishing (same components), closing the "ship blind" gap the palette opened. Complements 1.1.27's tutor-side trust. |
| 3 | SKILLS, NOT FEATURES | 0 | A builder affordance over existing renderers, not a new skill. Neutral. |
| 5 | GRACEFUL DEGRADATION | +1 | No session → the table's `iframe-context` tutor-push short-circuits (the shipped component already no-ops on `sessionId=null`); the grid + chart + calculator still work locally. No elements → a designed "nothing to preview yet" state. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses the shipped `WorkspaceElements` + element registry; the only new code is a pure `builderToElementDefs()` shape converter. No new render path, no protocol. |
| 7 | API FIRST | 0 | No API — the preview is the existing renderers over unsaved local state. The save contract is unchanged. Neutral. |
| 9 | SECURE BY CONSTRUCTION | +1 | No new server surface, no new persistence, no cross-user data. Teacher Markdown in the note preview renders through the **same DOMPurify-sanitising `ChatMarkdown`** the student uses — the preview can't introduce an XSS path the student doesn't already have. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | The preview is intentionally client-side (rendering, not business logic) and adds no fat-client *logic* beyond a shape converter. Neutral — render-on-client is correct here. |
| 11 | USABLE BY DESIGN | +1 | The entire point: the tight author→see→tweak loop **is** the UX. Designed empty / with-elements / interactive states up front. |
| | **Net Score** | **+6** | Threshold ≥ +4. No student-facing −1; ≤ 2 axioms at −1. Hard-fail passes. |

## Design

### The preview pane

The builder ([`/teacher/activities/new`](../../../../frontend/src/app/teacher/activities/new/page.tsx)) gains a **preview pane** that mounts the shipped student renderer from the builder's live state:

```
┌─ New activity ───────────────────────┬─ Preview (what students see) ──────┐
│  [ Start from a template ]           │  ┌──────────────────────────────┐  │
│  Name      [ Beregn fart        ]    │  │ Fremgang            0/3      │  │
│  Lesson prompt … (Socratic goal)     │  │  ☐ Identificér de kendte …   │  │
│  Checklist  1. Identificér …         │  │  ☐ Indsæt i formlen          │  │
│  Calculator  s / t  (s, t)           │  │ ─────────────────────────── │  │
│  Note        **Fart:** v = s / t     │  │ Beregner: Fart               │  │
│                                      │  │  Strækning [   ] Tid [   ]   │  │
│  [ Create activity ]                 │  │  s / t =  —                   │  │
│                                      │  │ Note: **Fart:** v = s / t     │  │
│                                      │  └──────────────────────────────┘  │
└──────────────────────────────────────┴────────────────────────────────────┘
```

- **Same components as the student.** The pane renders `<WorkspaceElements skillId="preview" sessionId={null} checklist=… table=… chart=… calculator=… note=… />` — the *identical* render path students get. Not a mock.
- **Live.** It re-renders on every builder edit (React state → render). Type a column label → it appears in the preview header; write a formula → the calculator computes when the teacher types values into the preview.
- **Interactive, sandboxed.** `sessionId={null}` so the table's tutor-`iframe-context` push short-circuits (shipped behaviour) and nothing reaches a tutor or persists. The teacher's pokes are scratch state. The chart still plots from values typed into the preview's own table (the `aipla:table-change` event fires same-document, and `skillId="preview"` scopes the sessionStorage so it can't collide with a real student's).
- **Labelled.** A clear "Preview — what students see" header so it's never mistaken for the live activity.

### The converter — `builderToElementDefs(state)`

The builder holds *editor-value* shapes (`TableEditorValue` with client `key`s, `ChartEditorValue`, `CalculatorEditorValue`, `NoteEditorValue`, checklist `{key,label}[]`). The renderers take *element-def* shapes (`TableElementDef`, `ChartElementDef`, …). A single pure function converts one to the other — **the same drop-empties / positional-id logic the save-payload builders already do** (`buildTablePayload` / `buildCalculatorPayload` / the inline chart + note payloads), factored so the preview and the save path can't diverge:

```ts
// frontend/src/lib/activityPreview.ts
export function builderToElementDefs(state: BuilderElements): ElementRenderProps {
  // reuse the exact normalisation the save builders use, minus persistence
  return {
    checklist: state.checklist.filter(c => c.label.trim()).map((c, i) => ({ id: `step-${i+1}`, label: c.label.trim() })),
    table: buildTablePayload(state.table),       // already exists
    chart: state.chart ? [{ id: "chart-1", ... }] : [],
    calculator: buildCalculatorPayload(state.calculator),  // already exists
    note: state.note?.body.trim() ? [{ id: "note-1", ... }] : [],
  };
}
```

> **Refactor, don't duplicate.** The new/page save handler already builds these payloads. M0 extracts that into `builderToElementDefs()` and the save handler + the preview both call it — so what the teacher previews is byte-identical to what gets saved + rendered to students. (Same discipline as 1.1.27's single `assemble_prompt()`.)

### Layout (Open question Q1)

The builder is `max-w-2xl`. Options, in preference order:
1. **Collapsible preview panel below the form** (default; works at every width, mobile-safe) — a "Preview" section that renders the workspace stack inline.
2. **Side-by-side on wide screens** (`xl:` two columns, stacking below `xl`) — nicer on a laptop, but the builder must widen.
3. **A "Preview" toggle** that swaps the form for the full-width student workspace.

Recommendation: **(1) for M0** (simplest, always works), **(2) as a progressive `xl:` enhancement**. Confirm with M before build.

### Relationship to 1.1.27 (the two-preview story)

| | **1.1.40 (this doc) — element preview** | **1.1.27 — prompt + trial** |
|---|---|---|
| Shows | the **workspace** (table/chart/calc/note/checklist), interactive | the **system prompt** (provenance) + a real **tutor chat** |
| Cost | client-side, instant, no session | a real session (1.1.27 trial) / an endpoint (resolved prompt) |
| Answers | "does my workspace look + work right?" | "what will the AI say?" |

They share the builder surface and are complementary; a teacher uses **1.1.40 to tune the elements** (fast loop) and **1.1.27 to validate the tutor** (deeper loop). The "Try this lesson" trial (1.1.27) remains the way to preview the *tutor*; this is the way to preview the *workspace*. No overlap, no duplication.

## Milestone phasing

| MS | Deliverable | Est | Gate | Lands |
|---|---|---|---|---|
| **M0** ✅ | **Live element preview — SHIPPED 2026-06-22.** [`builderToElementDefs()`](../../../../frontend/src/lib/activityPreview.ts) (the save-payload logic factored out so **preview === save** — the `new/page` save handler now calls it too) + a **collapsible** [`ActivityPreview`](../../../../frontend/src/components/teacher/ActivityPreview.tsx) pane in `/teacher/activities/new` mounting the shipped `WorkspaceElements` (`sessionId=null`, a fixed non-student `skillId`, wrapped in a throwaway `HumanToolEventsProvider` to stay warning-free). Live + interactive + sandboxed. Q1 resolved: **collapsible-below**. 27 tests (converter + pane). | ~1d | — | **shipped** |
| M1 | **Edit-page parity.** Same preview in `/teacher/activities/[id]`. | ~0.25d | edit-page element editing (see 1.1.38 deferred) | — |
| M2 | **Wide-screen side-by-side** (`xl:` two-column) + "Preview as student" full-width toggle. | ~0.25d | none | — |

**If descoped:** M0 alone delivers the ask (see-it-while-you-author). M1/M2 are polish.

## Testing strategy

- **Frontend (vitest):** `builderToElementDefs()` converts each editor shape correctly + drops empties identically to the save path (regression-guard: preview output === save payload for the same state); the preview pane renders the present elements via `WorkspaceElements`; empty state when no elements; the table→chart reactivity works inside the preview (`skillId="preview"` scoping).
- **Manual (LOCAL_MODE):** pick the "Beregning" template → preview shows the calculator + note immediately; type into the preview's calculator → it computes; edit the formula in the builder → the preview updates.

## Open questions

- **Q1 — layout:** collapsible-below (M0) vs side-by-side (`xl:`) vs full-width toggle. Recommendation: below for M0, `xl:` side-by-side as enhancement. (M to confirm.)
- **Q2 — converter ownership:** factor the save-payload builders (`buildTablePayload`, `buildCalculatorPayload`, the inline chart/note builders) into the shared `builderToElementDefs()` so preview and save can't diverge — recommended; the alternative (a parallel converter) risks the preview lying.
- **Q3 — should the preview show the persona avatar / a stub chat bubble?** Recommendation: **no** for 1.1.40 — the chat/persona preview is 1.1.27's trial session; this pane is the workspace only, to keep the boundary clean.

## Related documents

- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38; the elements this previews + `activityTemplates.ts` (the templates the preview makes instantly visible)
- [lesson-author-surface.md](lesson-author-surface.md) — 1.1.27; the **other** preview half (resolved prompt + trial chat session) — this doc is its workspace complement
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19; the builder umbrella
- [teacher-ui-consolidation.md](teacher-ui-consolidation.md) — 1.1.26; the teacher primitives the pane uses
- [`elementRenderers.tsx`](../../../../frontend/src/components/workspace/elementRenderers.tsx) — the shipped `WorkspaceElements` the preview mounts
