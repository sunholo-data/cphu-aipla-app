# 15 June teacher check-in — repo-side execution map

**Status:** Triage / index — the execution-repo companion to the scoping-site note
**Last Updated:** 2026-06-15
**Source (product truth):** `notes/2026-06-15-teacher-feedback.md` (private scoping-site file, not published) (processed) + `sources/feedback-2026-06-15.md` (private scoping-site file, not published) (raw; the `## 15th Jan` header is a stale template line — the file is 15 June). Raw scratch copy alongside this doc: `feedback-2026-01-15.md` (relocated from the repo root, 2026-07-22).
**Companion docs:** [`strands.qmd`](https://www.sunholo.com/aipla/strands.html) · [`architecture.qmd`](https://www.sunholo.com/aipla/architecture.html) (ADR-016 researcher tier) · the 9 June batch (this extends it)

> **Why this file exists.** The scoping site holds the pedagogical/product truth; this repo holds
> the *execution* layer (file paths, wire shapes, ADR alignment, acceptance gates). 15 June was
> mostly downstream of the 9 June framing — most items **amend docs already on the roadmap** rather
> than open new ones. This file is the one-screen map of *every* 15-June item → its repo disposition,
> so nothing is silently dropped. The authoritative sequencing lives in
> [SEQUENCE.md](SEQUENCE.md) (rows 1.1.29–1.1.31 + the amendment notes).

## Headline

15 June lands ~10 days before the mid-point review (26 June), with a **demo on 16 June** in between
and the **23 June bidirectional-voice** target still the one hard pre-freeze date. Everything here is
consistent with breadth-over-depth — **no scope explosion**. Two genuinely-new build items
(call-teacher, mobile-perf); the rest is amendments to in-flight docs or status chases on
already-shipped work.

## Disposition map

| 15-June item | Type | Disposition in this repo |
|---|---|---|
| **"Call teacher" button** | New build | **NEW DOC** — [call-teacher.md](call-teacher.md), SEQUENCE **1.1.29**. Student chat control → group-scoped "raised hand" signal → teacher live view. Minimal raised-hand version ships standalone; full surface folds into the live dashboard below. |
| **Mobile performance** (runtime perf on shared phones) | New investigation | **NEW DOC** — [mobile-performance-pass.md](mobile-performance-pass.md), SEQUENCE **1.1.30**. Profile-first; no perf tooling exists today (no bundle-analyzer, no Lighthouse, no web-vitals). Distinct from the mobile-*layout* work already shipped. |
| **Real-time class summary every ~5 min** | New surface, **R1-gated** | **NEW DOC** — [teacher-analytics-framework.md](teacher-analytics-framework.md), SEQUENCE **1.1.31**. The *live, in-lesson* teacher dashboard — distinct from the *post-hoc* [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) (2.5). Hosts the call-teacher raised-hand surface. **Do not instrument the summary content before the R1 framework decision** (due before the 2026-06-29 freeze). |
| **Audio latency** | Amend | **AMEND** [bidirectional-voice-brief.md](bidirectional-voice-brief.md) (1.1.23) — added an explicit p50/p95 **latency budget** as an acceptance criterion; the STT+TTS-vs-`gemini_live` decision is now partly on latency grounds. Mobile is the worst case → coupled to 1.1.30. |
| **Teacher choosing RAG inputs** | Amend (mostly shipped) | **AMEND** [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19) — per-activity RAG source-selection is now a first-class authoring control in the doc. **The scoping itself already ships**: `build_curriculum_retrieval_tool(materials)` scopes `VertexAiRagRetrieval` to only the activity's cited `rag_file_ids` (deny-by-default; student can't reach the open corpus). The 15-June ask is "make the source set visible + editable", not new retrieval plumbing. |
| **Researcher role** (3rd mention) | Already shipped | **DONE** — 1.1.5 `researcher-role` SHIPPED 2026-06-13 (`User.is_researcher`, `assert_can_read_class` bypass, `GET /api/classes?scope=all`). Architecture closes it as **ADR-016** (researcher = permission tier above teacher; no PII consequence under anonymous group IDs). No app task. |
| **"Where is media upload — student + teacher?"** | Status chase | **COVERED.** Student upload = 1.1.7 SHIPPED 2026-06-11 (native AG-UI multimodal). Teacher-side upload = 1.1.25 curriculum-library SHIPPED M1–M5 (`POST /ingest` AILANG Parse → RAG + builder Materials picker). The "less explicitly specced" teacher gap is the curriculum-library path; confirm framing with M, no new doc. |
| **Feedback loop: write → upload → AI checks → repeat** | On roadmap | Extends the units-loop (1.1.21, shipped) + [offline-lab-workbench.md](offline-lab-workbench.md) (1.1.24, AI checks entered data) + [end-of-class-notes-summary.md](end-of-class-notes-summary.md) (1.1.22). No new doc. |
| **Friction needed + simulation** | Design principle | Reinforces the deliberate-friction bet already encoded across the roadmap. No app task. |
| **Trust wedge — "was it from AI?"** | Design principle | Assessment-integrity thread; the formative-not-sanctionary stance in [student-engagement-signals.md](student-engagement-signals.md) (1.1.17) already encodes it. No new app task. |
| **Potential image that is wrong** (hallucinated content) | Design principle | Content-review gate (ADR-013 artefact safety). Reinforces the existing artefact-review posture; no new app task. |
| **"Most teachers use AI via CoPilot through school IT"** | Strategy | To JB — distribution/positioning, not an app change. Captured for the strategy thread. |
| **Scenario-didaktik bot** (teacher uploads plan → feedback) | Spin-off | **NON-AIPLA** [M, 15 June]. Same chassis (upload → feedback), different audience. Track only; no AIPLA build or spec. |
| **Weaker students use AI worse, but active learning lifts some** | Research observation | Evidence for the active-learning / deliberate-friction bet; a pilot research angle, not a sprint item. |
| **Will get UI feedback** (from the 16 June demo) | Process | M processes demo feedback afterwards; nothing needed pre-demo. |
| **Teacher UX is incoherent** (Activities page unclear; sim ≠ activity; prompts in 3 places; dead difficulty knob; no teacher preview) | Structural refinement | **NEW DOC** — [teacher-ux-refinement.md](teacher-ux-refinement.md), SEQUENCE **1.1.32**. Beyond the itemised list — M's structural critique that `teacher×class×persona×activity×sim` accreted too many overlapping levels. Collapse to three nouns (persona/activity/class); marry sim↔activity 1:1; make the 3 prompt levels explicit; kill the dead `difficulty` knob; add "Open as student" preview. Phase A pre-pilot (~3–4d), Phase B (activity reuse across classes) post-pilot. *Removes* degrees of freedom — serves breadth-over-depth. |

## Net effect on the roadmap

- **+2 build rows** (1.1.29 call-teacher, 1.1.30 mobile-perf) — both small, demo-adjacent, no human gate for the minimal slice.
- **+1 R1-gated doc** (1.1.31 live teacher dashboard) — designed now, instrumented only after the R1 framework decision.
- **+1 refinement doc** (1.1.32 teacher-ux-refinement) — the structural coherence pass on the teacher surfaces.
- **2 amendments** to in-flight docs (1.1.19 RAG-source selection, 1.1.23 voice-latency budget).
- **0 new product design** in this repo — the product truth stays in the scoping site; this is execution alignment.

See [SEQUENCE.md → 15 June teacher check-in batch](SEQUENCE.md#15-june-teacher-check-in-batch-added-2026-06-15) for ordering, build status, and gates.
