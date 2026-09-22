# Raw citation markers leaking into chat — suppress, or resolve into a real workbench reference

**Status:** **Option (a) SHIPPED (dev) 2026-09-22** — root cause established the same day; option (b) open — **1.1.122**
**Priority:** **P1** (upgraded from *to investigate*, 2026-09-22 — 13% of tutor turns in a live class carried the marker) (a raw internal token in a student-facing chat is a trust defect on its face, in the same family as the citation-voice problem 1.1.63 already fixed once); **build priority depends on which of the two options below is chosen**
**Estimated:** Investigation ~0.5d (confirm mechanism against `busy-garden-11` logs and `grounding_metadata` handling). Then either: (a) suppress ~0.5d, or (b) resolve into a workbench reference ~1.5–2d (extends `DocumentsPanel`)
**Scope:** Backend — wherever Vertex AI RAG grounding metadata / citation markers reach the model's output text (`backend/adk/curriculum_retrieval.py`, `backend/adk/agent.py`'s grounding wiring). Frontend, if (b) is chosen — `DocumentsPanel.tsx` gains a way to jump to a cited source.
**Dependencies:** [1.1.63 tutor-register-citation-and-language](tutor-register-citation-and-language.md) (**shipped** — the existing citation-voice contract in [`curriculum_retrieval.py`](../../../../backend/adk/curriculum_retrieval.py), which stops the model *verbally* opening with "According to [source]…" but does not touch raw grounding markup); [`DocumentsPanel.tsx`](../../../../frontend/src/components/workspace/DocumentsPanel.tsx) (**shipped** — the workbench's existing per-activity materials list, the natural target for option (b))
**Created:** 2026-09-16
**Source:** [notes-2026-09-16.md](../../../notes-2026-09-16.md) — *"busy-garden-11 [rag-source-1] is mentioned in the chat but shouldn't show it as its just a reference — or maybe we can actually pull the reference into the workbench"*

## Problem Statement

A tutor reply in `busy-garden-11` showed the literal string `[rag-source-1]` (or similar bracketed marker) to the student. This is a different failure from the one [1.1.63](tutor-register-citation-and-language.md) already fixed: that change stopped the model from *composing* an attribution sentence ("According to mathematicus.dk…") by rewriting the grounding preamble's instructions. A bracket-and-index token like `[rag-source-1]` reads as **unprocessed grounding metadata** — the kind of citation index Vertex AI's built-in RAG retrieval attaches to a grounded response — rather than the model's own phrasing. If so, no amount of prompt-instruction tuning fixes it, because the token isn't something the model was asked to write; it's plumbing that isn't being stripped or resolved before the text reaches the student.

**This has not been confirmed against code yet** — it is a hypothesis from the symptom, not a diagnosis. The investigation step (M0) must read the actual `busy-garden-11` turn and trace whether the marker originates in `grounding_metadata` handling (`backend/adk/agent.py`'s `propagate_grounding_metadata=True` path, `curriculum_retrieval.py`'s `VertexAiRagRetrieval` tool) or is the model echoing something it was shown in a tool result. Do not assume the mechanism and build against the wrong one.

## Two options, not yet decided

**(a) Suppress.** Strip the raw marker before the text reaches the student — a server-side post-process on the composed response, or (if it originates in grounding metadata) configuring retrieval to not attach visible citation markup at all, matching the "name it by TITLE, in your own voice" contract 1.1.63 already established for verbal citation. Cheap, and consistent with existing policy: the model should never emit machine-shaped citation syntax to a 16-year-old.

**(b) Resolve into a real reference, pulled into the workbench.** Rather than discarding the marker, resolve it to the actual source document and surface it — e.g. a small "see source" affordance on the chat message that opens/highlights the relevant material in the existing [`DocumentsPanel`](../../../../frontend/src/components/workspace/DocumentsPanel.tsx), which already lists every `ActivityMaterial` cited for the activity (`origin`, `studentVisible`, `docId`). This turns an artefact of the retrieval pipeline into a feature: a student who wants to check a claim can see exactly where it came from, one click away, which is also what [Axiom 2 (Earned Trust)](../../../../CLAUDE.md) already asks for — *"if the student asks where something came from, say precisely."* Materially more work than (a): needs the marker resolved to a `docId` the workbench already knows about, and a click-through wire from the chat bubble to the panel.

**Recommendation, tentative:** (a) first, unconditionally — a raw token must never reach a student regardless of what else is decided, and it's the cheap, reversible half. Then evaluate (b) as a genuine feature addition once the mechanism is confirmed, since it may be free if the marker already carries a resolvable `docId` (a citation index into the same `materials` list the workbench renders), or considerably more work if it doesn't (e.g. it indexes into Vertex's own internal chunk numbering rather than AIPLA's document ids).

## Open questions

1. **Does the marker resolve to a `docId` the workbench already knows about, or to an opaque Vertex-internal index?** Determines whether (b) is a cheap wire-up or a new resolution layer.
2. **Is this specific to curriculum RAG retrieval, or does the literature corpus / any other grounding path share the same code?** The literature corpus is deliberately isolated from the student-facing agent path ([CLAUDE.md footgun table](../../../../CLAUDE.md), `check-literature-corpus-isolation.sh`) — confirm this defect can't be a symptom of that boundary being crossed, not just a formatting bug.
3. **How often does this actually happen?** One report so far. Before committing to (b)'s cost, worth checking whether other transcripts in `chat_turns` (the BigQuery view, [1.1.109](researcher-chat-log-lens.md)) contain the same bracket pattern, to size this beyond a single anecdote.


## M0 findings — 2026-09-22 (the investigation this doc asked for)

Prompted by the 22 September 1st-year session ([classroom-session-2026-09-22-followups.md](classroom-session-2026-09-22-followups.md), finding 3).

**How often (prod, `chat_turns`, tutor turns):**

| Window | Tutor turns | With `[rag-source-N]` |
|---|---|---|
| 2026-08-24 → 09-14 | 196 | **0** |
| 2026-09-15 | 71 | 15 (21%) |
| 2026-09-16 → 09-21 | 69 | 2 |
| **2026-09-22** | 260 | **34 (13%)**, across 3 activities, 9+ groups |

Every hit is on `gemini-3.5-flash-lite` (51 of its 488 turns). `gemini-3.7-flash`
had 0 in 345 turns but was last used 09-11, so the onset lines up with the model
switch, not with a deploy (hits span v0.1.52 → v0.1.62). Only `[rag-source-1..3]`
appears (`_TOP_K` = 5). No other bracket form (`[1]`, `[source…]`, `[kilde…]`) appears at all.

**Mechanism: it is Vertex's label, and the model copies it.**

- The string occurs nowhere in `backend/`, `frontend/src`, or the installed
  `google-adk` / `google-genai` / `vertexai` packages.
- `curriculum_retrieval.py:133-157` builds `VertexAiRagRetrieval`. For Gemini 2+,
  ADK does **not** register a function tool. It appends
  `types.Tool(retrieval=Retrieval(vertex_rag_store=…))` to the request, so
  retrieval runs **inside** Vertex. Vertex labels the retrieved chunks
  `[rag-source-N]` in the model's context, and flash-lite sometimes copies the
  label into its answer, placed like an academic citation at a sentence end.
- Nothing strips it. `_composed_after_model` (`agent.py:~707`) only runs the
  budget hook, `ChatMarkdown` renders unmatched `[…]` as literal text, and
  `ReadAloudButton.tsx:143` removes only Markdown links, **so the Danish TTS
  voice reads it aloud too.**

**Open Question 2 answered:** curriculum RAG only. The literature corpus is not
involved, so the isolation boundary holds.

**Open Question 1 answered (partly):** `N` is the chunk's rank within that one
call's ≤5 results. It is not a `docId`, and two chunks from one document get two numbers.
The resolvable route is `event.grounding_metadata.grounding_chunks[N-1].retrieved_context`
(RAG file uri/title) → `CurriculumDoc.doc_artifact_id` → the `MaterialRef.doc_id`
`DocumentsPanel` lists. **Unverified:** that the numbering is 1-based chunk order,
and that `grounding_metadata` is present on streamed events. Nothing reads it today.
Check one stored `golden-lake-80` event via the ADK session endpoints before
building (b).

**Open Question 3 answered:** not an anecdote. See the table.

### Decision for M1 (option a) — do it now

1. Server: in `_composed_after_model`, remove `\s*\[rag-source-\d+\]` from
   response text. A marker can be split across stream chunks, so strip on the
   aggregated final event, or hold back a trailing `[` fragment until the next chunk.
2. Frontend backstop: the same regex in `ChatMarkdown` and the ReadAloud
   sanitizer. This cleans the ~50 stored turns when they are replayed.
3. Test: `/\[rag-source-\d+\]/` never appears in student-visible text. Add the
   frequency query above as a monitoring check.
4. A preamble line ("never write bracketed labels like [rag-source-1]") is worth
   adding, but it is **not sufficient alone**, because the existing citation
   contract is already being ignored ~12% of the time.

Option (b) stays open. It becomes cheaper once
[1.1.132](tutor-never-claims-notes-it-cannot-see.md) M1 logs `grounding_metadata`.

## What shipped — option (a), 2026-09-22

- **Backend:** `adk/citation_markers.py`, wired first in `_composed_after_model`.
  It strips streamed chunks through a small stateful filter that holds back a
  trailing `[rag-…` fragment (and trailing spaces) until the next chunk, and it
  strips the final aggregated response whole. The final response is what the
  session store and `chat_turns` keep, so new logs are clean too.
- **Frontend backstop:** `lib/citationMarkers.ts` in `ChatMarkdown` and
  `ReadAloudButton`, so the ~50 turns already stored render and speak clean.
- **Preamble:** one clause added ("never write bracketed labels such as
  [rag-source-1]"). This is belt-and-braces; the strip is the fix.
- **Tests:** `tests/unit/test_citation_markers.py` (real prod strings, markers
  split across chunks, look-alikes left alone) and
  `lib/__tests__/citationMarkers.test.tsx`.
- **Monitor:** re-run the frequency query in *M0 findings* after the next class.
  It should read 0.
- Option (b) is still open.
