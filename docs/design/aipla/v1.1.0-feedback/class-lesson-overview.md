# The lesson, for the whole class first — concepts and teaching approach aggregated, groups second

**Status:** Design (OPEN) — **1.1.139**
**Priority:** **P1** — the teacher's first question after a lesson is *"what did the class get?"*, and today the only answer is to read one report per group. JB, 2026-09-29: *"reports for each group is too much to the teachers — in the insights have the concepts discussed in aggregate"*. Needs only teachers and existing sessions, so it is **un-gated**
**Estimated:** ~6–6.5d phased (M0 structured concepts per session ~1d · M1 class roll-up ~1–1.5d · M2 the overview UI ~2d · M3 the wizard ~1–1.5d · M4 calibration on JB's session ~0.5d)
**Scope:** Backend: `reports/narrative.py`, `reports/session_summary.py` (cache doc), `analytics/framework_fidelity.py` (read side only), `db/concept_progress.py` (`docs_for_class`), `protocols/insights_routes.py`, `config/models.yaml`. Frontend: `app/teacher/insights/` (new **Lessons** entry), `components/teacher/ClassConceptGraph.tsx`, `components/teacher/TeachingApproachSection.tsx`, `app/teacher/classes/[id]/page.tsx`, `app/teacher/reports/groups/[groupId]/page.tsx`
**Dependencies:** [1.1.121 class-level-concept-graph-aggregation](class-level-concept-graph-aggregation.md) (**shipped** — the concept distribution this generalises); [1.1.134 concept-map-steering](concept-map-steering-sprint.md) (**shipped** — `mark_concept` evidence, the tutor ticks, not the student); [1.1.107 framework-fit-profile](framework-fit-profile.md) M0+M5 (**shipped** — the per-session fidelity read this rolls up); [1.1.36](live-group-drilldown.md) (the per-group report, which becomes the drill-in). Related: [1.1.92](session-benchmark-tutor-activity.md) (the *researcher's* tutor × activity matrix; this is the *teacher's* one-lesson read), [1.1.99](live-class-work-wall.md) (the **live** view; this is **after** the lesson), [1.1.136](review-work-beside-the-transcript.md) (per-group, researcher). **Un-gated**. D1 answered 2026-09-30 (top-tier model for batch analysis)
**Created:** 2026-09-30
**Source:** [notes-2026-09-29.md](../../../notes-2026-09-29.md) (JB's experienced-teacher session) and M, 2026-09-30: *"we are looking for a class level aggregation of this — and I think we need to re-do the UI to make the concepts easier to surface, and perhaps a wizard to encourage its use in the right order"*

## How the group reports work today (verified 2026-09-30)

**One report per group-session, generated on demand, one small model for everything.**

| Part of the group report | Produced by | Model | Shape |
|---|---|---|---|
| Stats (duration, messages, sim runs) and transcript | `reports/session_summary.summarize_session_bq`, from BigQuery `aipla_chat_turn` + `aipla_workbench_event` | none | data |
| **AI summary**: narrative, *Concepts & topics discussed*, sim parameters, checklist, *Next time* | `reports/narrative.py` `_call_gemini`, cached on the summary, 5-min regenerate debounce | **`default_model()` = `gemini-3.5-flash-lite`** (`config/models.yaml` `platform_default`) | **free-text Markdown**. Concepts are 4–8 prose bullets |
| **Teaching approach** (`TeachingApproachSection`) | `analytics/framework_fidelity.score_fidelity` (1.1.107 M0+M5): a judge blind to the tutor, criteria generated from the framework's own YAML, dialogue units as evidence, stored in the RUBRIC-2 run store as `fidelity:<framework_id>` | **also `default_model()`, flash-lite** | teacher: **prose** (what it looked like, where it drifted). researcher: bands + per-construct scores. **Abstains** when the session's tutor has no framework, or when there is too little dialogue |
| Class concept graph (**not** in the report) | `ClassConceptGraph` (1.1.121) over `concept_progress.docs_for_class` | none, from tutor `mark_concept` / checkpoint evidence | distribution across groups. **Only for activities with a concept-map element**, and **only on the class page, at the bottom** (`classes/[id]/page.tsx:818`) |

**Insights** (`/teacher/insights`) has KPIs, compare, trend, cost and
conversations. It has **no concepts and no teaching approach**.

### What that means for "aggregate it"

1. **The report's concepts cannot be aggregated.** They are prose bullets,
   worded differently per group by a model told to write for a human. Eight
   groups that all discussed "amplitude" produce eight phrasings. There is
   nothing to count.
2. **There are two concept sources that never meet.** The concept map's
   evidence is structured and tutor-marked, but it exists only when the activity
   has a concept-map element. The narrative's bullets exist for every session
   and are unstructured. A teacher sees one on the class page and the other in
   each report, and they need not agree.
3. **The teaching-approach read is per group, and nothing rolls it up.** To
   answer *"did the tutor do ESRU in this lesson?"* a teacher opens every report.
4. **Both judgements come from the smallest model, and the fidelity judge is the
   same model as the tutor it judges.** That bears directly on JB's *"not convinced
   the tutor is based on the teaching approach"*: a flash-lite tutor judged by
   flash-lite is weak evidence either way. These are **offline, once-per-session**
   calls, not per-turn, so the cost argument that put the tutor on flash-lite does
   not apply to them. See *Decision D1*.
5. **The order is upside down.** The teacher lands on groups and has to assemble
   the class. The class view should come first and the groups should be the
   drill-in. The concept graph, the one class-level artefact that exists, is the
   last thing on the class page.

## Design

### M0 — Concepts as data, per session (~1d)

The narrative call gains a **structured** second output (Gemini
`response_schema`, the same call, no extra request):

```json
{"concepts": [
  {"key": "amplitude", "label": "Amplitude", "nodeId": "n3" | null,
   "status": "discussed" | "struggled" | "demonstrated",
   "evidenceTurnIds": ["t12", "t15"]}
]}
```

- **Closed vocabulary when there is one.** If the activity has a concept map,
  the prompt lists its nodes and the model must map to `nodeId` or return
  `null`. If the activity has no concept map, the model returns free labels, and
  `key` is a normalised slug. M1 merges near-duplicates at class level, never
  per session.
- `demonstrated` is only written when there is tutor `mark_concept` /
  checkpoint evidence for that node. The narrative model may say *discussed* or
  *struggled*; it may not award *demonstrated* on its own. The source of truth for
  "got it" stays the tutor's evidence record (1.1.134), consistent with *"the AI
  tutor ticks it off"*.
- Stored on the existing summary cache doc (`concepts`, `conceptsModel`,
  `conceptsVersion`). **No new store.** The Markdown narrative is unchanged.
- **Backfill** for past sessions is a script that re-runs only this call for a
  class, so JB's session can be the test set (M4).

### M1 — The class roll-up (~1–1.5d)

`GET /api/insights/classes/{class_id}/lessons` lists lessons, where a lesson is
an **(activity, date)** pair derived from sessions, most recent first.
`GET /api/insights/classes/{class_id}/lessons/{activity_id}?date=` returns:

- **Concepts:** per concept, the number of groups that `discussed` /
  `struggled` / `demonstrated` it, and **which** groups. This is merged with
  `concept_progress` when the activity has a concept map, so the 1.1.121 graph and
  this list are one number, not two. Sorted with the most-struggled first.
- **Teaching approach:** a roll-up of the per-session fidelity results
  **for the approach the lesson ran**. Coverage comes first and is honest:
  *"assessed in 6 of 9 groups; 3 too short to judge"*.
  - Teacher view: **prose** from one small summarising call over the per-group prose,
    covering what the approach looked like across the class and where it drifted,
    with no numbers (1.1.65 R1: fit is not quality, and not a grade of the teacher).
  - Researcher view: the per-construct band distribution across groups.
  - If the lesson's tutor has **no framework**, it says so and suggests picking one,
    which is itself an answer to *"is it based on the teaching approach?"*.
- **Next time, for the class:** a single short synthesis of the groups' *Next
  time* lines.
- **Groups:** one line each (status, top concept, a flag if an outlier on
  struggle or approach drift), linking to the existing group report.
- All BigQuery and Firestore reads go through `asyncio.to_thread` /
  `CACHE.aget_or_compute` (**1.1.131**, a dashboard must not freeze a class).
  Summaries missing for some groups are generated lazily with a concurrency cap,
  or shown as *"not summarised yet"*. **Never** a fan-out of nine model calls
  on page load.

### M2 — The overview UI: concepts first, findable (~2d)

A new **Lessons** entry as the **first** tab of Insights, and a
**"Latest lesson"** card at the **top** of the class page that replaces the
concept graph's position at the bottom. One page per lesson, in reading order:

1. **Concepts**: a concept × groups strip (rows = concepts, cells = groups,
   colour = discussed / struggled / demonstrated), plus a **search box and chips**
   to filter to one concept. Clicking a concept shows which groups, and for each
   group the tutor's evidence summary (no verbatim student quotes on teacher
   surfaces, the narrative's existing rule). This replaces "scroll to the bottom of
   the class page" as the way to find a concept, and it answers *"make the UI
   of finding concepts easier"*.
2. **How the tutor taught**: the M1 approach roll-up, with coverage.
3. **What next**: the class *Next time*.
4. **Groups**: compact rows, outliers first, drill-in to the existing report.

The per-group report gains a breadcrumb back to its lesson, so a teacher never
lands in a group without the class around it. Teacher copy in a `copy` object
(1.1.108 M4).

### M3 — A wizard for the right order (~1–1.5d)

JB's worry is that teachers use the pieces in the wrong order, or not at all.
Two short guided flows, both skippable and remembered per teacher:

**After a lesson** (offered on the class page when a lesson has ≥2 group
sessions and has not been reviewed):
1. *What did the class cover?* Concepts, most-discussed.
2. *Where did they struggle?* The same strip, filtered to `struggled`.
3. *How did the tutor teach?* The approach roll-up.
4. *Which groups to look at?* The outliers, each a link to a group report.
5. *Next lesson.* The class *Next time*, with **"Add to next activity"**, which
   carries it into the authoring co-pilot as a starting brief.

**Before a lesson** (in activity authoring, when the activity has **no concept
map**): *"The lesson overview is only as good as its list of concepts. Add 4–8
concepts?"* The co-pilot proposes them from the teaching goal, and the teacher
accepts or edits. **This is the cheapest way to raise the quality of every
aggregate above**, because it turns M0's free labels into a closed vocabulary.
It also sits naturally with [1.1.124](../v2.1.0-extension/teacher-onboarding-scaffold.md)'s
getting-started checklist, as one more step.

### M4 — Calibrate on JB's session (~0.5d)

Backfill M0 for JB's experienced-teacher session. JB reads the lesson overview
and three group reports. The questions: do the aggregated concepts match what he
saw in the room? Does the approach roll-up match his *"not convinced"*? Record the
answers here. **If the roll-up says the approach was followed and JB says it was
not, that is a finding about the judge (D1) before it is a finding about the
tutor.**

## Decisions

- **D1 — Which model writes reports and judges approach fit? ANSWERED, M 2026-09-30: upgrade the model for batch work like this.**
  Recommendation, now the plan: a separate `analysis_model` key in `models.yaml`, defaulting to
  a **top-tier** model, used by the narrative, M0, M1's summarising call and the
  fidelity judge. The tutor stays on `platform_default`. These run once per
  session, after the fact, so the cost is small next to per-turn tutoring. Check it
  against the [1.1.106 cloud-cost envelope](cloud-cost-envelope.md) before
  switching. It also makes the judge a different model from the tutor, which the
  fidelity read needs in order to mean anything. This dovetails with JB's "top tier"
  ask and gives 1.1.92 a model arm to compare.
- **D2 — Is a "lesson" (activity, date) right, or should it be a teacher-named
  session?** (M + JB). Start with (activity, date). Add naming only if a class
  runs one activity across several days.
- **D3 — Does the teacher see any number for the approach?** Recommendation: no,
  per 1.1.65 R1, only prose plus coverage. Researchers see bands.

## Out of scope

- Per-student anything. Groups are the finest grain (ADR-001).
- The live view (1.1.99) and the researcher per-group timeline (1.1.136).
- Changing how the tutor marks concepts (1.1.134 stands).

## Acceptance

- A teacher opens Insights → Lessons → the latest lesson and sees, without
  opening any group, which concepts the class discussed and struggled with, and
  how the tutor taught, with coverage stated.
- Searching a concept filters the strip, and a click shows which groups.
- The concept counts for an activity with a concept map equal the 1.1.121 graph
  (one source, not two).
- The page loads with no synchronous BigQuery on the loop and no per-group model
  fan-out on load.
- JB's M4 read is recorded here.
