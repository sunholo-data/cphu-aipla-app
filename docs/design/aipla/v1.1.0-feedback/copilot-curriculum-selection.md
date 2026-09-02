# How the authoring co-pilot knows what's in the curriculum library

**Status:** ⚠️ **Phase 1 SHIPPED** (`feat(curriculum): catalogue summary field for co-pilot + teacher doc selection (1.1.52 Phase 1)`); Phase 2 open. Originally: DESIGN. **Phase 1** (a per-doc summary field) is build-ready; **Phase 2**
(corpus-wide semantic search + peek/read) is **sequenced for later** — build Phase 1
first, reach for Phase 2 only when the library outgrows it.
**Last Updated:** 2026-06-30.
**Priority:** P2 — improves the just-shipped `attach_material` co-pilot tool
(curriculum reference docs); not pilot-blocking. Phase 1 is a cheap, high-leverage
quality fix; Phase 2 is a larger content-aware upgrade.
**Estimated:** Phase 1 ~0.5d. Phase 2 ~2–3d (sequenced).
**Scope:** Phase 1 — backend only (a `summary` field on `CurriculumDoc`, generated
at ingest, surfaced in `attach_material`'s available list + the teacher's
`MaterialsSection` browse) + a CLI backfill. Phase 2 — a new corpus-wide curriculum
search/peek tool (crosses a deliberate scoping boundary; teacher-scoped).
**Dependencies:** [curriculum-library.md](curriculum-library.md) (1.1.25 —
`CurriculumDoc`, the RAG corpus, `MaterialsSection`, the `aiplatform curriculum`
CLI) · the just-shipped `attach_material` co-pilot tool (commit `0634629`) ·
ADR-010 (RAG).
**Source:** 2026-06-30 — M, during the `attach_material` verify: *"how does the
co-pilot know what is in each curriculum library — does it need a good description
or be able to peek and read it?"*

## Problem

The `attach_material` tool lets the co-pilot propose attaching a curriculum
reference document to a lesson, but it picks by **metadata only**: each available
doc is `{docId, title, level, topic, origin}` (the `_curriculum_choice` shape in
[authoring_tools.py](../../../../backend/adk/authoring_tools.py)). The co-pilot
never sees the document's *content*.

Two facts make that thin:
- On [`CurriculumDoc`](../../../../backend/db/models/curriculum.py), **`level` and
  `topic` are optional** (the model treats a missing level as "unfiled"), and there
  is **no description/summary field at all**.
- So **selection quality == title/topic metadata quality**. Good case: title
  `"Energibevarelse og arbejde (B)"` + topic `"energi"` → a clean match. Bad case:
  title `"Scan_2023-04-12.pdf"`, no topic → the co-pilot is guessing from a
  filename.

The question is whether the co-pilot needs a **better description** or the ability
to **peek/read** the content. Answer: both help, in that order.

## Why metadata → summary → search, in that order

Two principles set the order:

1. **The human is in the loop.** The co-pilot *proposes*; the teacher Applies. So it
   doesn't need search-grade precision — it needs enough signal to make a sensible
   suggestion the teacher can sanity-check. A good summary clears that bar; the
   teacher catches a bad match. This is why a cheap summary beats an expensive
   search *for this use*.
2. **There's a deliberate boundary to respect.** Curriculum content is RAG-ingested,
   but retrieval is **scoped to an activity's *cited* docs** —
   [curriculum_retrieval.py](../../../../backend/adk/curriculum_retrieval.py)'s
   `build_curriculum_retrieval_tool` builds a `VertexAiRagRetrieval` over specific
   `rag_file_ids`, and the module comment states *"the open corpus is never
   reachable"*. A corpus-wide co-pilot search **crosses that boundary** (likely a
   copyright / cross-teacher-privacy decision), so it's not just a tool — it's a
   design change. Phase 1 avoids it entirely.

## Phase 1 — a per-doc summary (build first, ~0.5d)

Give each document a short content abstract the co-pilot (and the teacher) can read
without opening it.

- **Model.** Add `summary: str = ""` to `CurriculumDoc` (1–2 sentences: what the doc
  covers, what level/topic it suits). Optional/back-compatible.
- **Generate at ingest.** The ingest path already parses the document to text
  (AILANG Parse → RAG). Add one cheap-tier AI call over that text to produce the
  summary, stored on the doc. One-time cost per doc; da/en to match the corpus.
- **Surface it where the choice is made.** Add `summary` to `_curriculum_choice` so
  `attach_material`'s `available` list carries it — the co-pilot matches on a real
  abstract, not a filename.
- **Free win for the teacher.** Surface the same summary in the builder's
  `MaterialsSection` browse, so the teacher's *manual* doc-picking improves too.
- **Backfill.** Existing docs have no summary. Either lazily (regenerate on next
  re-ingest) or a one-off pass. See CLI below.

**CLI surface** (per the automation principle / design-doc-creator §5b-bis):
`aiplatform curriculum summarize [<docId> | --all] [--force]` — (re)generate
summaries, including the backfill. Sits under the existing `aiplatform curriculum`
group ([curriculum-library.md](curriculum-library.md) M5).

**Why this is enough for now:** it fixes the blind-filename failure mode, helps both
the co-pilot and the teacher, costs one AI call per doc, and doesn't touch the
open-corpus boundary.

## Phase 2 — semantic search + peek/read (sequenced for later, ~2–3d)

When the library grows large enough that titles + summaries stop discriminating, the
co-pilot needs **content-aware discovery**.

- **A corpus-wide curriculum search tool.** The co-pilot describes the lesson topic;
  the tool semantic-searches the curriculum corpus and returns **ranked chunks +
  their `docId`s**; the co-pilot proposes the best, citing the matched snippet. The
  content is already RAG-ingested, so this reuses the corpus — but it requires a
  **new, corpus-wide query path**, not the cited-doc-scoped retrieval that ships
  today.
- **It crosses the "open corpus not reachable" boundary** — so scope it
  deliberately: **teacher-scoped** (the teacher's own docs + the shared cleared
  corpus), never cross-teacher. Return snippets, not whole docs (token cost). This
  needs a clearance/privacy check (likely **JB/M**) on what the co-pilot may surface.
- **A peek/read tool** (a bounded slice of `get_curriculum_content`) for when the
  co-pilot wants to quote or verify a passage before proposing.

Phase 2 earns its keep at scale; until then, Phase 1's summaries are the better
trade.

## Acceptance (Phase 1)

- `CurriculumDoc` carries a `summary`; it's generated at ingest and backfillable via
  the CLI.
- `attach_material`'s `available` entries include the summary; on a poorly-titled
  doc the co-pilot's proposal visibly improves (test: a doc with an opaque title but
  a clear summary is matched to the right topic).
- `MaterialsSection` shows the summary in the teacher's browse.
- The open-corpus retrieval boundary is **untouched** (Phase 1 changes no retrieval).

## Open questions

- Summary model + prompt (cheap tier; da/en; length cap).
- Backfill: lazy-on-reingest vs a one-off CLI pass (default: CLI `--all`).
- Phase 2 boundary: does a teacher-scoped corpus search (own + shared cleared docs)
  still need a JB/clearance sign-off, or only a cross-teacher one would? Resolve
  before Phase 2 build.
