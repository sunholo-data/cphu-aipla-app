# Class-level concept graph — aggregating across activities and the year, and linking activities together

**Status:** **SHIPPED 2026-09-25** by [CONCEPT-2](concept-map-steering-sprint.md) (M0/M1/M2a), **with M0's union replaced by a distribution** — **1.1.121**

> ⚠️ **Three corrections this doc needed, all found in the code or from M:**
>
> 1. **The union is out.** M, 2026-09-25: *"the class level may disagree with group level mastery, and
>    indeed we want to help link groups that are mastering different trees."* A union destroys exactly
>    that. Class level is a **derived distribution** over the class's groups; the per-(group, concept)
>    record stays the only stored truth. See `db/class_concept_rollup.py`.
> 2. **There is no `class_id` on `concept_progress`.** It is keyed `{group_id}:{activity_id}`. Writes
>    now stamp it from the signed group tag — never derived from the class's *current* codes, because
>    revoking one would erase that group's year from the aggregate. Existing rows are stamped by
>    `scripts/backfill_concept_progress_class_id.py`.
> 3. **Activities do not share node ids.** Template copies do — 55 of the 56 maps on prod came from
>    three templates, so a test built only on those passes against the bug — but two independently
>    authored maps never will. Concepts join on a **normalised label**.
**Priority:** **P2** — high conceptual value, directly requested twice in one meeting; not pilot-blocking, but the earlier the aggregation key is fixed the less any future migration costs
**Estimated:** ~4–6d phased (M0 aggregation store + activity-linking edges ~1.5–2d · M1 class-level graph view (teacher) ~1.5d · M2 co-pilot/proposal-assisted generation across activities ~1–1.5d · M3 eval/calibration ~1d — **not estimated with confidence; M2's scope depends on the open question below**)
**Scope:** Backend — a `class_id`-keyed aggregation over the existing per-activity `conceptMap` + `concept_progress` stores, plus an `edges` layer that links **activities** to each other via shared/prerequisite concepts. Frontend — a class-level graph view (teacher/researcher), and an "activities that connect here" affordance on the activity builder. No change to ADR-001, no consent change, no new identity mechanism.
**Dependencies:** [1.1.65 living-concept-map](living-concept-map.md) (**shipped to dev** — the per-activity `conceptMap` element, `concept_progress` store, `run_checkpoint`/`record_checkpoint`; this doc aggregates its output rather than replacing it); [1.1.68 longitudinal-concept-evidence](longitudinal-concept-evidence.md) (**the decision this doc adopts** — see below); [2.9 knowledge-graph-and-student-matching](../post-pilot/knowledge-graph-and-student-matching.md) (**the parent vision, capability 2** — "a per-group mastery vector across the graph that evolves over the year"; this doc is that capability's **class-level, in-contract slice**, the same relationship 1.1.90 has to the same parent doc for the tutor side); [1.1.90 bounded-tutoring-answer-trees](bounded-tutoring-answer-trees.md) (the sibling consumer — a class with no aggregated map has nothing for the answer tree to bound against, and vice versa the answer tree's per-activity map is this doc's input); ADR-001 (anonymous group IDs — the constraint this doc stays inside, unlike 1.1.68's harder options)
**Created:** 2026-09-16
**Source:** [notes-2026-09-16.md](../../../notes-2026-09-16.md) — *"a class level concept graph, that works across the year and classes, that groups fill in over time as they complete classes and activities"*, *"a way to help link classes and activities together (start with activities)"*, and separately *"look at resurrecting the automatic concept graph or try to have concept graphs for most classes made to help direct"*

## Problem Statement

The concept map exists **per activity** ([1.1.65](living-concept-map.md), shipped): a teacher authors nodes/edges, the tutor checks them off in-session, and a **group's** progress against that one activity's map is tracked in `concept_progress`. Three things are missing that the meeting asked for, in ascending order of how much they change:

1. **No view spans more than one activity.** A class that runs ten activities across a year has ten disconnected maps. Nothing shows a teacher (or a group) how far the class has come as a whole.
2. **No link between activities.** If activity 3's map assumes activity 1's "vectors" node, that dependency exists only in the teacher's head. Nothing in the product expresses *"this activity builds on that one."*
3. **No proactive/automatic generation.** Today, a concept map is authored one activity at a time, on demand, by a teacher who opens the co-pilot and asks for a draft (`propose_concept_map`). Getting "most classes" a map means either lowering that per-activity friction or generating something at a higher level automatically — which of these is meant is not yet settled (see [Open questions](#open-questions)).

## Why this is buildable now, inside the anonymity model

[1.1.68 longitudinal-concept-evidence](longitudinal-concept-evidence.md) already did the hard analysis for a harder version of this question — individual student trajectories — and concluded ADR-001 makes that **unanswerable**: a group's session code expires, so two sessions by the same student months apart are not linkable *by construction*, and that is the guarantee working as designed, not a gap.

But that same doc's table draws the line one level up:

| Question | Answerable today? |
|---|---|
| Does this group's concept map get richer within one activity? | Yes (shipped) |
| **Does this class's aggregate change over the year?** | **Yes, at class level** |
| Does this student's concept network change over the year? | No — forbidden by ADR-001 |

**This doc builds exactly the "yes" row.** `class_id` is a persistent teacher-owned entity that outlives any one group's session code — it is already stamped on every chat turn ([TUTOR-5](tutors-handover-2026-09-10.md)) and already the join key [1.1.90](bounded-tutoring-answer-trees.md) and the researcher chat-log lens use. Aggregating `concept_progress` by `class_id` across the activities that class has run needs **no linkage token, no consent change, and no new identity** — it is a read-side rollup over data the platform is already collecting for every group that runs a mapped activity. That is also why this reads as "the answer" to the meeting's ask rather than a scaled-up version of it: the meeting asked for **class**-level, group-filled-in-over-time tracking, which is precisely the granularity ADR-001 already permits.

## Design

### M0 — the aggregation store and activity-linking edges

Two additive pieces, neither of which touches the shipped per-activity map:

**Class-level rollup.** A read (not a new write path) over `concept_progress` grouped by `class_id`, unioning node states across every activity that class has run whose `conceptMap` shares node ids (or is explicitly linked — see below) with another activity's map. Where two activities' maps use the *same* concept (e.g. both cite "Newton's second law"), a class's progress on that concept is the union of what any of its groups demonstrated, in any activity, at any point in the year. This is the mechanism, and it is genuinely simple: no new store, a `class_id` index on the existing one.

**Activity-linking edges — start with activities, per the meeting's own framing.** A new, small `ActivityLink` structure (`from_activity_id`, `to_activity_id`, `via_concept_ids: list[str]`, `kind: "prerequisite" | "related"`), authored by a teacher (or proposed by the co-pilot from shared concept-map node labels — cheap: two activities that both use a node called "vectors" are a candidate link with no NLP required) and stored alongside `ActivityConfig`. This is deliberately **activity → activity**, not class → class, matching *"start with activities"* literally: a class-level graph is downstream of activities being linked, not a separate authoring surface.

### M1 — the class-level graph view

A teacher/researcher-facing graph (reusing `ConceptMapGraph.tsx`'s rendering, not a new visual language) showing: every concept node the class's activities have ever mapped, coloured by aggregate demonstrated/checkpointed/unseen state, with activity-linking edges drawn between the activities that share or build on a concept. This is the "groups fill in over time" view — as more groups complete more mapped activities, more of the class's aggregate graph lights up.

### M2 — proactive/automatic generation (scope depends on the open question below)

Two different things could be meant by "automatic," and they have very different costs:

- **(a) Lower the per-activity friction.** The co-pilot's `propose_concept_map` already exists ([backend/adk/authoring_tools.py](../../../../backend/adk/authoring_tools.py)) — a teacher must ask for it today. Making this the *default offer* when an activity is created (propose, never auto-apply — Axiom 2) is a small UI change, not new machinery.
- **(b) Generate/complete maps across many existing classes in one pass**, e.g. from the curriculum corpus or DRA tags, so "most classes" have a map without a teacher visiting each one. This is a batch job over `propose_concept_map`'s existing logic, still propose-not-act per activity, but raises a real question: who reviews 30 auto-drafted maps, and does an unreviewed draft ever reach a student (it must not — the co-pilot's propose/apply split already prevents this, but a batch process makes "nobody reviewed it" much easier to happen by neglect than a single interactive proposal does).

**Recommendation:** ship (a) first — cheap, reuses shipped machinery, and directly addresses "most classes made to help direct" without the batch-review question. Scope (b) only after confirming with the meeting's asker which was meant.

## Open questions

1. **Is "resurrecting the automatic concept graph" describing a capability that existed before, or a new ask?** No prior "automatic" generation mechanism is documented in [concept-map-sprint.md](concept-map-sprint.md) or [living-concept-map.md](living-concept-map.md) — the only generation path found is the on-demand co-pilot tool. If something did exist and was removed, its removal isn't recorded here either; worth a direct question before scoping M2.
2. **Does "link classes and activities together" mean anything beyond the activity-linking edges in M0?** The meeting phrase explicitly said "start with activities," read here as scoping the *first* build to activity↔activity links (M0) with class-level view as the aggregate consequence (M1), not a separate class↔class linking mechanism. Confirm before M1 locks the view's shape.
3. **Does this doc supersede or sit beside [2.9's capability 2](../post-pilot/knowledge-graph-and-student-matching.md)?** That doc's capability 2 ("mastery monitoring... over the year") is framed as **group**-level and Year-2/gated. This doc reframes the same ask as **class**-level and buildable now, inside the current engagement. If the strategic answer is "build the full group-level version instead," this doc is the wrong shape — flag that before M0 starts.
