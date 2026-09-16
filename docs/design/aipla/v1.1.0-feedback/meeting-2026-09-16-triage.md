# 16 September 2026 meeting — repo-side disposition map

**Status:** Triaged 2026-09-16, same day. Source record: [notes-2026-09-16.md](../../../notes-2026-09-16.md).
**Nature:** A short working meeting — one positive check-in, two defects, one report-feature question, and an extended discussion of concept-graph direction spanning three related asks.

## Summary

**Two genuine gaps got new design docs; everything else extends something
already written.** That ratio matches the pattern the 9 September triage set:
most of what gets raised in a working meeting is closer to existing work than
it first looks, and the value is in finding the join, not in writing a new
document for every sentence.

**The concept-graph thread was the substantial part of this meeting.** Three
separate remarks — the map as an anchor against off-topic drift, resurrecting
"automatic" generation, and a class/year-level graph that links activities —
turned out to be one thread with a specific, buildable answer already sitting
in the repo: [1.1.68 longitudinal-concept-evidence](longitudinal-concept-evidence.md)
worked out in August that **class-level** longitudinal tracking needs no
consent change and stays inside ADR-001, unlike individual student tracking.
→ **[1.1.121](class-level-concept-graph-aggregation.md)** turns that finding
into a build.

**A defect and a "does this already exist" question were the other two
threads.** A raw citation marker leaking into a chat is a genuinely new,
uninvestigated bug → **[1.1.122](citation-marker-leak-and-workbench-reference.md)**.
The framework-report ask turned out to name a real gap in a doc that was
almost, but not quite, the answer: [1.1.107 framework-fit-profile](framework-fit-profile.md)
already builds the fidelity measurement ("did the tutor actually behave like
ESRU?") but had deliberately **deferred the real-session, single-framework
case** to a future decision — today's meeting *was* that decision, recorded
as a new milestone (M5) rather than a new document, with
[1.1.65 rubric-results-in-product](rubric-results-in-product.md) as its
consumer.

**One report was re-characterised, not re-theorised.** The still-unexplained
workbench upload failure ([1.1.119](frontend-client-logs.md)) got a sharper
repro today (any file, <100 KB, zero console output) — recorded against the
existing entry, not a new one, because the fix it's waiting on
([frontend-client-logs.md](frontend-client-logs.md)) is already the right
shape for it.

## Disposition map

| # | Item | Type | Disposition |
|---|---|---|---|
| 1 | Ask Aswin to reproduce the image/document upload bug | Process | → repro conditions folded into the existing [1.1.119](frontend-client-logs.md) SEQUENCE.md entry, sharpened with today's detail (any file, <100 KB, zero console output) |
| 2 | General feedback: tutor updates well received | Positive signal, no action | Recorded in notes only |
| 3 | Question about "activity linking" | **Likely resolved by item 9 below** | See item 9 — read together as one topic, not confirmed |
| 4 | Workbench upload spins forever, any file <100 KB, no console log | **Defect, re-characterised** | Existing [1.1.119](frontend-client-logs.md)/SEQUENCE.md entry updated, not a new doc — the "nothing in the console either" detail narrows the search to a client-side stuck-state rather than a network failure |
| 5 | "Tutor approaches" report: an analysis of how faithfully the framework was followed, scoped to the one framework used, no cross-comparison | **Extends two existing OPEN docs, not new** | → **[1.1.107 framework-fit-profile](framework-fit-profile.md) M5** (new milestone, added same day) is the actual fidelity mechanism — a single-lens run against the session's own `framework_id`, no seven-way radar. Its M4 had explicitly deferred exactly this case ("wants JB's view before it is designed"); today's meeting supplied that view. → [1.1.65 rubric-results-in-product](rubric-results-in-product.md) Open Question 5 is M5's consumer — the teacher-facing session-report band. Initially mis-scoped in this triage's first pass as a generic "framework-aware competency band"; corrected once the ask was clarified as fidelity/adherence, a different instrument from MAPS/SAAR competency scoring |
| 6 | Link to share for the sim authoring prompt | Question, answered in-meeting | `https://aipla.ku.dk/sim-authoring-prompt.txt` (raw) / `/project/build-a-simulation` (page). No doc needed |
| 7 | Sim authoring workflow: ChatGPT demo worked for fetching, app quality wasn't good | **Validates an existing decision** | Matches [1.1.104 simulation-import-pipeline](simulation-import-pipeline.md) / **D6** (9 Sept) exactly — a rough first pass is the expected shape of a reviewed pipeline's input, not a problem with the approach. Idea (cite physics references in the prompt) recorded as unscoped, pointed at two candidate homes: the authoring prompt itself, or [1.1.115 verify_sim](../v2.1.0-extension/sim-verify-mcp.md) |
| 8 | On-the-fly sim generation in chat: how to guarantee accuracy when even 95% correct risks trust | **Already answered** | [post-pilot/student-generated-apps-tldraw.md](../post-pilot/student-generated-apps-tldraw.md) §6–9 — the engine/validated-scene split, which makes wrong physics structurally impossible rather than reviewed-for. No new doc; flagged to bring into the next discussion of this topic rather than re-derive |
| 9 | Concept map as anchor against off-topic/too-advanced tutoring | **Already decided, not yet built** | [1.1.90 bounded-tutoring-answer-trees](bounded-tutoring-answer-trees.md), P1, D2 (2026-09-02). No implementation commits exist despite being the most-repeated theme of the 1 September meeting — flagged as a scheduling candidate |
| 10 | "Resurrect the automatic concept graph" / "concept graphs for most classes" | **New — folded into 1.1.121** | No prior "automatic" mechanism found in `concept-map-sprint.md` or `living-concept-map.md` — may be describing a new ask, not a revival. Scoped as 1.1.121 M2, left genuinely open pending clarification |
| 11 | Class/year-level concept graph, groups fill in over time; link classes and activities (start with activities) | **NEW DOC** | → **[1.1.121 class-level-concept-graph-aggregation.md](class-level-concept-graph-aggregation.md)**. Adopts [1.1.68](longitudinal-concept-evidence.md)'s Option 1 (class-level, no consent change); aggregates the shipped [1.1.65 living-concept-map](living-concept-map.md) data by `class_id`; treats "link activities" as the literal starting scope (activity↔activity edges) rather than a separate class-linking mechanism |
| 12 | `[rag-source-1]` raw citation marker shown to a student, `busy-garden-11` | **NEW DOC** | → **[1.1.122 citation-marker-leak-and-workbench-reference.md](citation-marker-leak-and-workbench-reference.md)**. Root cause not established — hypothesised as unprocessed grounding metadata, distinct from the already-fixed verbal-citation bug (1.1.63). Two remediation options recorded, not decided: suppress, or resolve into the existing `DocumentsPanel` |

## The new docs — two

| # | Doc | Priority | Est | Gate |
|---|---|---|---|---|
| **1.1.121** | [class-level-concept-graph-aggregation.md](class-level-concept-graph-aggregation.md) | **P2** | ~4–6d (M2 not confidently scoped) | None — stays inside ADR-001 |
| **1.1.122** | [citation-marker-leak-and-workbench-reference.md](citation-marker-leak-and-workbench-reference.md) | **P1 to investigate** | ~0.5d investigation, then 0.5–2d depending on option chosen | Root cause must be confirmed before either remediation option is built |

**Plus two docs extended, not duplicated:** [1.1.107 framework-fit-profile](framework-fit-profile.md)
gains **M5** (the real-session, single-framework fidelity case its M4 had
deferred); [1.1.65 rubric-results-in-product](rubric-results-in-product.md)
gains Open Question 5, resolved to point at M5 as its mechanism.

**Plus one existing entry sharpened, not duplicated:** the [1.1.119](frontend-client-logs.md)
workbench-upload SEQUENCE.md entry carries today's repro detail.

## Still to verify

Carried from 9 September, unchanged by this meeting — see
[meeting-2026-09-09-triage.md](meeting-2026-09-09-triage.md#still-to-verify)
for the full list. Nothing here resolves the reports-route ACL gap, the
`busy-garden-11` session-mapping check, or the tutor→framework pairing
assignment; all three remain open.

New from today:

1. **Is "activity linking" (item 3) the same topic as item 11's class/year
   concept graph?** Treated as *likely* the same in [1.1.121](class-level-concept-graph-aggregation.md)'s
   Open Question 2, not confirmed.
2. **Does "resurrect the automatic concept graph" name something that used to
   exist?** Not found in `concept-map-sprint.md` or `living-concept-map.md`.
   [1.1.121](class-level-concept-graph-aggregation.md)'s Open Question 1.
3. **What actually leaks `[rag-source-1]` into a response?** Entirely
   unconfirmed — [1.1.122](citation-marker-leak-and-workbench-reference.md)'s
   whole M0 is this question.
