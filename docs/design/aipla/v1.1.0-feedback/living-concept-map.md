# Living concept map — teacher-authored prerequisite graph + in-session AI check-off

**Status:** **Design / spec (NOT committed)** — pre-pilot-buildable; **gated on M's UX-coherence-gate call** (is the activity palette coherent enough to add this, and would a teacher reach for it pre-lesson?).
**Priority:** P2 — high conceptual value, real calibration cost. The *concept-map element* (M0–M1) is cheap; the *AI check-off* (M2+) carries LLM-as-judge calibration work — don't ship that depth as a casual probe.
**Estimated:** M0 element ~1.5–2d · M1 co-pilot-propose ~1d · M2 in-session check-off ~2–3d · M3 teacher coverage + eval/calibration ~2–3d (the eval is the long pole).
**Scope:** Fullstack — a `conceptMap` field on `ActivityConfig`; a list/graph authoring element in the activity builder; a co-pilot proposal tool; a tutor check-off tool + per-session node-state store; student progress view + teacher coverage; an LLM-judge eval set.
**Dependencies:** [activity-elements-palette.md](activity-elements-palette.md) (the element system this slots into); the `workbench-element-builder` skill (dual-surface + trust-card + co-pilot-proposability recipe); [activity-authoring-assistant](activity-authoring-assistant.md) (the co-pilot that proposes the map); [curriculum-library.md](curriculum-library.md) (1.1.25 — propose-from-corpus input); [1.K dra-activity-framework](../v1.0.0-pilot/dra-activity-framework.md) (DRA maps — propose input + node tagging); [chat-log-pipeline](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 — where check-offs land for the teacher view + the Year-2 bridge); [capability-floor eval](../SEQUENCE.md) (1.5 — the check-off calibration harness).
**Parent vision:** [../post-pilot/knowledge-graph-and-student-matching.md](../post-pilot/knowledge-graph-and-student-matching.md) ([SEQUENCE 2.9](SEQUENCE.md)) — this spec is its **near-term slice** (capability 1 + the per-session form of capability 2). Longitudinal aggregation + cross-group matching stay Year-2 there.
**Source:** M, 2026-06-30 — "add an activity component the teacher works with before the lesson to add+map the components … a graph type fits better" → "once an activity has a concept graph, can the AI check work off against it?"

## Problem

A physics activity covers a structured set of concepts with **prerequisite relationships** (vectors *and*
trigonometry both feed projectile motion). Today that structure is nowhere: the teacher can't author it, the
student has no map of where they are, and the tutor's read of "have they got it?" is implicit and unstructured.
Two gaps:

1. **No authored map.** The teacher has no pre-lesson surface to lay out the topics + their dependencies.
2. **No structured progress.** The tutor assesses understanding turn-by-turn but nothing maps that onto the
   concept structure, so neither student nor teacher sees coverage.

This spec fills both with one **"living concept map"**: the teacher authors the graph (1); the tutor checks
it off as the student works (2).

## Design

### Data model — `conceptMap` on the activity

```python
# db/models/activity_config.py
class ConceptNode(BaseModel):
    id: str                              # stable slug, minted on add
    label: str                           # "Projektilbevægelse"
    level: StxLevel | None = None        # optional A/B/C
    dra: str | None = None               # optional DRA tag (links to 1.K)

class ConceptEdge(BaseModel):
    from_: str = Field(alias="from")     # prerequisite node id
    to: str                              # dependent node id
    kind: Literal["prerequisite"] = "prerequisite"

class ConceptMap(BaseModel):
    nodes: list[ConceptNode] = []
    edges: list[ConceptEdge] = []
# ActivityConfig gains: concept_map: ConceptMap | None
```

A **list is a projection of this same data** (nodes in topological/teacher order, edges implied or shown as
indents). One element, two modes — never two data shapes.

### M0 — the authoring element (list + graph)

In the activity builder, a new `conceptMap` element (wired via the `workbench-element-builder` recipe):

- **List mode (default / on-ramp):** add concepts, reorder, optionally mark "depends on" inline. Fast, low
  burden — for the teacher who just wants the topics.
- **Graph mode:** drag nodes, draw prerequisite edges (a small DAG editor; cycle-guarded). For the richer
  picture. Both modes read/write the same `{nodes, edges}`; switching is lossless.
- Saved in the activity config (full-overwrite payload discipline — see the activity-config overwrite memory).

**No AI in M0** — a teacher can author the whole thing by hand. That alone is the smallest shippable probe.

### M1 — co-pilot proposes the map

The activity-authoring co-pilot gains a `propose_concept_map` tool: from the activity's **cited curriculum**
(1.1.25) + the skill's **DRA map** (1.K) + the teaching goal, it proposes `{nodes, edges}`. The teacher
**edits/approves** — propose-not-act (Axiom 2); never auto-published. Surfaces as a co-pilot proposal card
(the existing authoring-copilot pattern).

### M2 — in-session check-off (the live instrument)

The tutor assesses the student's work against the graph and marks nodes off **within the session**.

- **Context.** The activity's `conceptMap` is injected into the tutor's context (a `before_model` injection
  twinned with the curriculum/teacher-focus injectors), so the model knows the node set.
- **Check-off mechanism — both, layered:**
  - a **tutor tool** `mark_concept(node_id, status, evidence_summary)` the model calls when it judges a
    concept `demonstrated` / `partial` (visible, deliberate — emits a **human-tool-use trust card**:
    "✓ marked *vectors* understood — because you decomposed the 30° launch");
  - a **post-turn reconciling LLM-judge** pass (lightweight) that maps the latest turn → nodes, to catch what
    the model didn't explicitly mark (coverage). The tool is the legible primary; the pass is the safety net.
- **Per-session state.** A node-status map keyed by `(group_id, activity_id, node_id)`:
  `status ∈ {not_yet, partial, demonstrated}`, `evidence` (turn ref + one-line why), `updated_at`. Held in
  ADK session state and **mirrored to Firestore** for the teacher view; the **BigQuery** emit (reusing 1.2)
  is the **Year-2 bridge** (the longitudinal record capability-2-proper aggregates — not built here).

### M3 — surfaces + eval

- **Student progress view.** The same `conceptMap` element rendered read-only with node states — the graph
  **lights up** as nodes are demonstrated ("you've got vectors; projectile motion is next"). **Orientation,
  not a grade.**
- **Teacher coverage.** Per-group node coverage on the live dashboard ([teacher-analytics-framework](teacher-analytics-framework.md),
  1.1.31) and/or the session report — which groups have which nodes. Teacher can **override** any check-off.
- **Eval / calibration (the long pole — gating M2 going authoritative).** The check-off is **LLM-as-judge**;
  it can mark prematurely or miss. Calibrate via the capability-floor harness (1.5): an eval set of
  conversations with **ground-truth concept demonstrations** (AR/teacher-labelled) → measure **per-node
  precision/recall**. **Until calibrated, the check-off is framed as "the AI's read — confirm it," not an
  authoritative state.** Same judge-reliability discipline as the DRA tagging ([2.5](../post-pilot/session-analytics-rubric.md)).

## Axiom alignment (sketch)

| Axiom | Note |
|---|---|
| 1 PHYSICS-FIRST | The map *is* the physics structure (kernestof prerequisites). |
| 2 EARNED TRUST | AI proposes the map + reads the check-off; teacher approves/overrides; every check-off shows its evidence. |
| 8 PRIVACY | Group-ID only (ADR-001); progress is group-level + formative; no individual profiling. |
| 11 USABLE | List mode is the low-burden on-ramp; the lit-up graph is legible orientation, not a black box. |

## Risks

| Risk | Mitigation |
|---|---|
| **LLM-judge check-off is wrong** (premature/missed) → student trusts a wrong state | M3 eval gate; "AI's read, confirm it" framing until calibrated; teacher override; evidence shown |
| Check-off feels like surveillance/grading | Formative-not-sanctionary framing (29-June guardrail); group-level; orientation copy, not scores |
| Graph authoring is too heavy for teachers | List mode default; co-pilot proposes the first draft; graph is optional depth |
| Scope creep — "another element" becomes a big feature | Phased M0→M3; M0 (hand-authored element) ships value alone; stop after any milestone |
| Cyclic/invalid graphs | Cycle-guard in the graph editor; prerequisite edges only |

## Acceptance

- [ ] **M0:** a teacher authors a `conceptMap` (list + graph) on an activity; it persists; renders read-only to the student.
- [ ] **M1:** the co-pilot proposes nodes+edges from the cited curriculum + DRA map; the teacher edits/approves.
- [ ] **M2:** during a tutor session, `mark_concept` marks nodes with evidence; state persists per `(group_id, activity_id)`; a trust card shows each check-off.
- [ ] **M3:** student progress view lights up demonstrated nodes; teacher sees per-group coverage + can override; the check-off eval reports per-node precision/recall and the "confirm it" framing is enforced until a threshold is met.
- [ ] Group-ID keyed throughout; no individual profile constructed.
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green; pytest covers the tool + state; vitest covers the element (author + read-only states).

## Out of scope (→ parent Year-2 doc)

- **Longitudinal aggregation** of check-offs over time / across sessions (capability 2-proper).
- **Cross-group matching** ("which groups should meet") (capability 3).
- A standing knowledge graph beyond a single activity (the Strand-C graph DB, [SEQUENCE 1.3]).

## Files (sketch)

| File | Purpose |
|---|---|
| `backend/db/models/activity_config.py` | `ConceptNode/Edge/Map` + `concept_map` field |
| `backend/adk/callbacks/concept_map.py` (new) | inject the map into tutor context (before_model) |
| `backend/adk/tools/mark_concept.py` (new) | the `mark_concept` tutor tool + per-session state |
| `backend/skills/templates/activity-authoring-assistant/…` | `propose_concept_map` tool |
| `backend/db/concept_progress.py` (new) | Firestore mirror of node states; BQ emit (Year-2 bridge) |
| `frontend/src/components/teacher/ConceptMapEditor.tsx` (new) | list + graph authoring |
| `frontend/src/components/workspace/ConceptMapProgress.tsx` (new) | student read-only lit-up view |
| `backend/tests/…`, `frontend/src/**/__tests__/…` | tool + state + element + the check-off eval set |

## Related

- [../post-pilot/knowledge-graph-and-student-matching.md](../post-pilot/knowledge-graph-and-student-matching.md) — the parent Year-2 vision (capabilities 1–3).
- [activity-elements-palette.md](activity-elements-palette.md) + `workbench-element-builder` skill — the element system.
- [activity-authoring-assistant.md](activity-authoring-assistant.md) — the co-pilot that proposes the map.
- [../post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) (2.5) — the heavier batch DRA tagging; same LLM-judge-reliability discipline.
- [../v1.0.0-pilot/dra-activity-framework.md](../v1.0.0-pilot/dra-activity-framework.md) (1.K) — DRA maps as a propose input + node tag.
