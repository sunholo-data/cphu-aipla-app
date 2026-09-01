# Concept-graph student models + cross-group matching

**Status:** **Design / vision (NOT committed)** — Year-2 / post-pilot. Execution-layer design; the *pedagogical & research* framing lives in the scoping site's **Strand C** (don't re-derive it here).
**Last Updated:** 2026-06-30
**Origin:** Excitement at the **29 June** research session ([../v1.1.0-feedback/june-29-feedback.md](../v1.1.0-feedback/june-29-feedback.md)) — "the AI helps build a network graph of required topics, helps build it, monitors what students learn, and we record it over time" + "match students by what their group-IDs look like — who'd most benefit from meeting in person." Extends the **23 June** C3 thread ("standard map of knowledge; AI generates the learning map / a student model").
**Strand:** **C** (research instrumentation + student models). This doc is the *execution sketch*; the model choice, validity, and research questions are Strand C in [`strands.qmd`](https://www.sunholo.com/aipla/strands.html) + [`evaluation.qmd`](https://www.sunholo.com/aipla/evaluation.html).
**Gated on:** pilot data flowing (chat-log pipeline + DRA tagging producing longitudinal signal); JB/AR Strand-C scoping of the knowledge model; the analytics rubric ([session-analytics-rubric.md](session-analytics-rubric.md), 2.5) + DRA framework ([1.K dra-activity-framework](../v1.0.0-pilot/dra-activity-framework.md)). **Not before the pilot.**

> **Why this doc exists.** The 29-June idea is genuinely three capabilities riding one substrate (a per-group **student model**). Capturing the architecture now keeps the v1 pilot choices (what we log, how the DRA tags map to concepts, the group-ID keying) from painting Year-2 into a corner — the same "design now so we don't foreclose it" rationale as the live-dashboard R1 gate. **It is a vision + architecture sketch, not a build spec**; nothing here is committed, and the breadth-over-depth steer says we do NOT build this during the contract unless the pilot demands it. The research *why* (which knowledge model, does matching help, social-network evolution) is **Strand C** and stays in the scoping site.

## The three capabilities (one substrate)

All three sit on a single **per-group concept-mastery model** keyed by anonymous **group-ID** (ADR-001 — no PII, group-level only):

1. **AI-assisted concept graph (build).** A directed **prerequisite/dependency graph** of the physics concepts a lesson requires (nodes = concepts/topics; edges = "needs-before"). The AI *proposes* nodes + edges from material the platform already holds — the **curriculum corpus** ([curriculum-library.md](../v1.1.0-feedback/curriculum-library.md), 1.1.25), the **DRA maps** per skill (1.K), and the *læreplan kernestof* — and a teacher/researcher curates it. Per stx level (A/B/C), per subject (→ [SEQUENCE 2.6 multi-subject](../SEQUENCE.md)). This is the "standard map of knowledge" / "learning map the student should reach."
2. **Mastery monitoring (over time).** For each group, map demonstrated competence onto the graph nodes — from the **chat-log pipeline** (BigQuery turns, the durable group-ID-keyed source), the **DRA/rubric tagging** (2.5), and the **exit ticket** (1.1.8) self-reports. The result is a per-group **mastery vector across the graph that evolves over the year** — the longitudinal record the researchers want.
3. **Cross-group matching (who should meet).** Over the per-group mastery/interest profiles, recommend which **groups** would most benefit from meeting in person — complementary gaps ("group A has what group B is stuck on"), shared frontier, or the social-network signal ("students link groups together"). **Group-level recommendation, never individual targeting** — respects the anonymity model.

## Near-term entry point: the teacher's pre-lesson concept-map element (M, 2026-06-30)

> **Full execution spec:** [../v1.1.0-feedback/living-concept-map.md](../v1.1.0-feedback/living-concept-map.md) — the buildable "living concept map" (author + in-session check-off), phased M0–M3 with the eval plan. This section is the summary; the spec carries paths/wire/acceptance.

Capability 1 (**build the graph**) has a **buildable-now** surface that does *not* wait for pilot data or
Strand-C scoping: a **teacher-authored concept-map element** in the activity builder, worked on *before*
the lesson — the teacher adds the topics and maps their prerequisites. This decouples the BUILD piece (an
authoring affordance) from capabilities 2–3 (monitoring + matching), which need the longitudinal pilot signal.

**It's just another activity element.** It slots into the existing element system
([activity-elements-palette](../v1.1.0-feedback/activity-elements-palette.md) + the `workbench-element-builder`
skill) alongside table / calculator / checklist / note — a new `conceptMap` field on `ActivityConfig`.
Authored in the builder, stored in the activity config, and **proposable by the activity-authoring co-pilot**
(the AI-assist: it suggests nodes+edges from the activity's cited curriculum + the skill's DRA map; the
teacher edits/approves — propose-not-act, Axiom 2). No new infrastructure — "another element" is exactly the
breadth-over-depth-friendly shape.

**List vs graph → one element, two modes.** A **graph fits the domain** — prerequisites form a DAG
(branching + converging: *vectors* and *trigonometry* both feed *projectile motion*), which a flat list
can't express without flattening that structure away. But a list is a cheaper v0 and lower authoring burden.
So: **one element, two views over the same `{nodes, edges}` data** — a **list mode** (ordered concepts,
fast, the simple default / on-ramp) and a **graph mode** (drag nodes, draw prerequisite edges) for the
richer picture. The list is the on-ramp; the graph is where it pays off.

**Wire shape (sketch):**
```
conceptMap: {
  nodes: [{ id, label, level?, dra? }],          // a topic/concept (optionally tagged to a DRA / stx level)
  edges: [{ from, to, kind: "prerequisite" }],   // "needs-before"
}
```
Wired with the dual-surface + trust-card + co-pilot-proposability discipline (the `workbench-element-builder`
recipe), so it stays coherent with the rest of the palette.

**Why building it now is cheap leverage.** The teacher gets the *map* per activity — useful on its own as a
planning + student-orientation aid. And because it's stored as structured `{nodes, edges}`, it is the **same
data capability 2 maps mastery evidence onto.** So shipping the authoring element now *also* lays the
foundation for the Year-2 monitoring — without committing to it. It does NOT do monitoring or matching.

### Then: the tutor checks the graph off as work is done (in-session) — M, 2026-06-30

Once an activity *has* a concept graph, the tutor can **assess the student's work against it in real time and
mark nodes off** — turning the static map into a **live formative-assessment instrument** for that activity.
As the conversation/work proceeds, an evaluation step classifies each node **demonstrated / partial / not-yet**,
with the **evidence** (which turn showed it). A **progress view** lights up the graph for the student
(orientation — "you've got *vectors*; *projectile motion* is next") and the teacher (live coverage).

This is the **per-session, single-activity form of capability 2** — but it needs **no pilot data and no batch
pipeline**: it runs inside one tutor session against the authored graph. The Year-2 piece is *recording these
per-session check-offs over time across groups* (capability 2 proper) + matching (capability 3). So the
**near-term arc is author (1) → check-off (2)**; aggregation + matching stay Year-2.

**Design notes:**
- **Where the assessment runs.** Either a tutor **tool** the model calls when it judges a concept demonstrated
  (explicit + visible — pairs with the human-tool-use **trust card**, "✓ marked *vectors* understood"), or a
  lightweight **post-turn LLM-judge** pass mapping the turn → nodes (less intrusive, better coverage). Likely
  both: the tool for the visible check, a reconciling pass so nothing is missed.
- **Earned trust (Axiom 2).** A check-off must be **inspectable** — the student/teacher can see *why* a node
  was marked (the evidence turn) — and the **teacher can override**. It's a teacher instrument the AI assists;
  never a silent grade.
- **Formative, not sanctionary.** Honours the 29-June guardrail (observe, don't punitively assess) and the
  assessment-integrity stance — a learning map, not a scoreboard.
- **Reliability.** LLM-as-judge against concept nodes has the same trust problem as the DRA tagging (2.5) —
  premature or missed check-offs. The graph + the teacher override make it correctable; calibration is an
  **eval task** (reuse the capability-floor eval harness). Don't ship the check-off as authoritative before
  it's calibrated.
- **Reuse.** A cousin of the **checklist element** — but here the "checklist" is the graph nodes and the *AI*
  drives the checking with the human in the loop.

The near-term arc is now a coherent feature — **a "living concept map"**: the teacher authors the prerequisite
graph (1), and the tutor checks it off as the student works (2) — a structured, AI-assisted, formative
progress instrument scoped to ONE activity, no pilot dependency. The longitudinal aggregation (2-proper) and
cross-group matching (3) remain Year-2.

**Scope question (M to weigh):** the near-term arc — the concept-map **element** (author + co-pilot-propose)
**plus the in-session check-off** — is a **self-contained, pre-pilot build** (no longitudinal pipeline,
no cross-group anything). It has grown from "an element" to "a small formative-assessment instrument," so
weigh it as a feature, not a widget. Pull it forward (and at what depth — list-only author + manual check, vs
graph + AI check-off), or keep it parked here? Counterweight: the activity-element palette is already rich,
and the UX-coherence gate (`project_ux_coherence_gate.md` — agent-memory note, on M's machine)
says nothing new earns its place until the current surfaces are coherent and a teacher would actually reach
for it.

## Architecture (execution — reuses existing infra)

```
curriculum corpus (1.1.25) ─┐
DRA maps per skill (1.K) ────┼─► [AI graph-builder tool]──► CONCEPT GRAPH  (nodes/edges, per level+subject)
læreplan kernestof ──────────┘        (ADK agent/tool;          store: Firestore graph, or the deferred
                                       teacher/researcher curates)      Strand-C graph DB — SEQUENCE 1.3)
                                                                              │
chat-log pipeline (1.2, BigQuery) ─┐                                          ▼
DRA/rubric tagging (2.5) ──────────┼─► [mastery-mapping job]──► PER-GROUP MASTERY VECTOR over the graph,
exit tickets (1.1.8) ──────────────┘    (tag → concept node)        time-series (the longitudinal record)
                                                                              │
                                                                              ▼
                                                          [matching recommender]──► "groups that would
                                                          (complementary-gap / shared-frontier /         benefit from meeting"
                                                           social-network) — researcher + teacher view   (group-level, opt-in)
```

- **Graph store.** Start as a Firestore node/edge collection (small, curated). The **Strand-C graph DB** deferred at [SEQUENCE 1.3](../SEQUENCE.md) is the scale path if the graph + traversal grow — *that row exists for exactly this*.
- **Graph builder.** An ADK tool/agent (sibling of the activity-authoring co-pilot) that proposes `{concept, prerequisites[]}` from the corpus + DRA maps; the teacher/researcher edits. Never auto-published — human-curated (Axiom: earned trust).
- **Mastery mapping.** A batch job over the BigQuery turn stream + DRA tags → per-group, per-concept evidence, appended as a time-series (so we get *evolution*, not just a snapshot). Reuses the 2.5 rubric's tagging; the new piece is **concept-node attribution** (tag → graph node).
- **Matching.** A recommender over the per-group mastery vectors. v0 = deterministic (complementary-gap / shared-frontier cosine); the social-network angle (students bridging groups) is a later input. Output is a ranked list of *group pairings* for the teacher, with the *why*.
- **Surfaces.** Researcher-first (cross-class, the [researcher tier](../v1.1.0-feedback/researcher-analytics-rollout.md) / ADR-016) — the graph + mastery evolution + matching suggestions. A teacher-facing slice (their class's graph coverage + matching within their groups) folds onto the [live dashboard](../v1.1.0-feedback/teacher-analytics-framework.md) (1.1.31) only if it earns its place.

## Research vs execution split (keep them apart)

| Lives in **Strand C / scoping site** (the *why*) | Lives **here** (the *how*) |
|---|---|
| Which knowledge model (resources framework / concept inventory); is the graph valid? | Graph data model, storage, the AI builder tool |
| Research questions: do social networks evolve? does matching improve learning? | Mastery-mapping pipeline (tag → node → time-series) |
| The C3 student-model theory; embodied-cognition framing | The matching recommender + the researcher/teacher surfaces |
| KPIs vs exploratory (29-June: "no university KPIs — exploratory") | Privacy/ACL keying (group-ID only), opt-in gates |

## Axiom alignment (sketch — score properly at build time)

| Axiom | Note |
|---|---|
| 1 PHYSICS-FIRST | The graph IS the physics structure (kernestof prerequisites) — high alignment. |
| 2 EARNED TRUST | AI *proposes*, human curates the graph + the matches; never auto-acts. |
| 8 PRIVACY | Group-ID only (ADR-001); matching is group-level, opt-in; no individual profiling. |
| 11 USABLE | Researcher-first; the teacher slice must be legible ("these two groups should pair because…"), not a black box. |

## Risks / open questions

- **Ethics of tracking + matching (the big one).** Longitudinal mastery tracking + "who should meet" edges toward profiling. Must stay **group-level, opt-in, formative-not-sanctionary**, and honour the 29-June guardrail — *we observe, we don't assess students or teachers* ([june-29 disposition](../v1.1.0-feedback/june-29-feedback.md)). Pairs with the 23-June video-surveillance-ethics posture → researcher-only, GDPR/DPIA review.
- **Graph validity.** An AI-proposed prerequisite graph can be confidently wrong. Human curation is mandatory; the graph is a *teacher tool*, not ground truth.
- **Does matching actually help?** That's a **Strand C research question** (the causal-inference problem from 29-June — CCM, side-effects), not an engineering assumption. Build the instrument; let the research judge it.
- **Concept-node attribution.** Mapping a DRA tag / chat turn to a specific graph node is the hard ML/eval bit — depends on the 2.5 rubric being trustworthy first.
- **Subject generality.** The graph is per-subject; ties to [2.6 multi-subject schema](../SEQUENCE.md).

## Acceptance (when this becomes buildable, not now)

- [ ] Strand-C scoping has chosen the knowledge model + the research questions (JB/AR) — gating.
- [ ] The 2.5 analytics rubric + DRA tagging are live and producing trustworthy per-concept signal from real pilot data.
- [ ] DPIA / consent posture for longitudinal student modelling + cross-group matching signed off (JB).
- [ ] A teacher can read the graph + a match suggestion and understand *why* (legibility).
- [ ] Everything keyed by group-ID; no path constructs an individual profile.

## Related

- [session-analytics-rubric.md](session-analytics-rubric.md) (2.5) — the per-concept tagging this consumes.
- [../v1.0.0-pilot/dra-activity-framework.md](../v1.0.0-pilot/dra-activity-framework.md) (1.K) — machine-readable DRA maps (graph-builder input).
- [../v1.1.0-feedback/teacher-analytics-framework.md](../v1.1.0-feedback/teacher-analytics-framework.md) (1.1.31) — the live dashboard a teacher slice could fold onto.
- [../v1.1.0-feedback/researcher-analytics-rollout.md](../v1.1.0-feedback/researcher-analytics-rollout.md) — the researcher cross-class tier (ADR-016) this is primarily for.
- [../v1.1.0-feedback/exit-ticket.md](../v1.1.0-feedback/exit-ticket.md) (1.1.8) — self-report signal into the mastery vector.
- [../v1.1.0-feedback/curriculum-library.md](../v1.1.0-feedback/curriculum-library.md) (1.1.25) — corpus the graph-builder reads.
- [SEQUENCE 1.3](../SEQUENCE.md) — the deferred Strand-C graph DB (the scale path).
- Scoping site **Strand C** ([`strands.qmd`](https://www.sunholo.com/aipla/strands.html)) — the pedagogical/research source of truth (C3 student models, the resources framework, the social-network research design).
