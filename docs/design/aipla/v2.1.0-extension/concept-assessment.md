# Concept assessment — one graded judgement per concept, built on the concept map

**Status**: **OPEN (design) 2026-10-05** — decisions 1–4 below made by M on 2026-10-05. **Building is un-gated; turning it on in prod is gated on JB** (M7) — **1.1.144**
**Priority**: **P1** — two assessment systems already exist, recording overlapping judgements in different places, and the newer one is live on prod (v0.1.79) with no reader and no consent decision. This design merges them before a third appears
**Estimated**: **~5.5d** (M0 researcher-transcript half of the leak + gate the live tool ~0.5d · M1 scale + store ~1d · M2 the one tool ~1d · M3 migrate `sol-jord-maane` ~0.75d · M4 teacher display + override ~1.25d · M5 researcher view ~0.5d · M6 per-activity scale editing ~0.5d · M7 prod gate ~0.25d of engineering, the rest is JB's). At 2.5 days/week, **~2½ weeks of calendar**
**Scope**: Backend — `db/models/activity_config.py` (`AssessmentScale`, `ConceptMapElement.assessment_scale`), `db/concept_progress.py` (an `assessments` list per node, `derive_level`, fail-closed reads), `protocols/concept_progress_routes.py` (student strip, override level), `adk/checkpoint_tools.py` (`assess_concept`), `adk/stream_redaction.py`, `adk/assessment_tools.py` (wrapper, then removed), `db/models/artefact.py` + `artefacts/sol-jord-maane.yaml`, `reports/session_summary.py`, `analytics/research_logs.py`, `db/class_concept_rollup.py`. Frontend — `FinalWorkPanel`, `ClassConceptGraph`, the concept-map editor. **The student map (`ConceptMapView`) does not change**
**Dependencies**: [living-concept-map](../v1.1.0-feedback/living-concept-map.md) + [CONCEPT-2](../v1.1.0-feedback/concept-map-steering-sprint.md) (**shipped** — the evidence record, the precedence, the teacher override); [1.1.133 tutor-controls-sims](tutor-controls-sims.md) M3 (**shipped** — `record_assessment`, the system this absorbs); [1.1.101](../v1.1.0-feedback/SEQUENCE.md) (the deny-by-default stream filter). **Prod enablement gated on JB** (research consent / data agreements)
**Related**: [plan-2026-09-to-2027-04](plan-2026-09-to-2027-04.md) (*"rubric-scored logs as assessment evidence"* — this delivers the in-session half) · [class-level-concept-graph-aggregation](../v1.1.0-feedback/class-level-concept-graph-aggregation.md) · [longitudinal-concept-evidence](../v1.1.0-feedback/longitudinal-concept-evidence.md) (the ADR-001 identity constraint) · [tutors-handover-2026-09-10](../v1.1.0-feedback/tutors-handover-2026-09-10.md) (the tutor/approach stamp)
**Created**: 2026-10-05
**Source**: an investigation on 2026-10-05 of where AIPLA records judgements about what students understand, and M's decisions on it the same day

## Where we are

There are two systems that judge a group's understanding of a concept. They
were built five months apart for different surfaces, and neither knows about
the other.

| | **Concept-map check-off** (CONCEPT-1/2) | **`record_assessment`** (1.1.133 M3) |
|---|---|---|
| Unit | (group, activity, **node**) | (group, session, **phenomenon**) |
| Applies to | every activity with a concept map | one sim: `sol-jord-maane` (the only catalogue entry with an `assessment:` block, `artefacts/sol-jord-maane.yaml:88`) |
| Judgement | `not_yet \| partial \| demonstrated` + one sentence | level 0–6 + evidence + misconception + mission |
| Writers | `run_checkpoint` / `record_checkpoint` / `mark_concept` (`adk/checkpoint_tools.py:67,124,166`); teacher override `PUT /classes/{id}/concept-override` (`protocols/concept_progress_routes.py:159`) | `record_assessment` (`adk/assessment_tools.py`) |
| Store | Firestore `concept_progress`, append-only records, status **derived** (`db/concept_progress.py:112`, precedence teacher > checkpoint > observed) | BigQuery `aipla_workbench_event`, `tool = "record_assessment"` |
| Student sees | the three-state map (`ConceptMapView`) and a CheckpointCard | nothing — the whole call is dropped (`stream_redaction._STUDENT_HIDDEN_TOOLS`, `adk/stream_redaction.py:135`) |
| Teacher sees | FinalWorkPanel, ClassConceptGraph (`db/class_concept_rollup.py:143`) | **nothing reads it** |
| Researcher | no BigQuery row, no tutor stamp | tutor / version / framework stamped |

`ConceptNode.level` (`db/models/activity_config.py:378`) is the stx A/B/C tag
of the *concept*, not a mastery level of the *group*. Nothing in the
concept-map system carries a graded level or a misconception.

The sim's five phenomena (`doegn, aarstider, faser, formoerkelser, skala`) are
concept-map nodes under another name. Keeping both means a teacher who maps
*seasons* in the activity and attaches the sim gets two unconnected
judgements of the same thing, one of which the teacher can never see.

### A leak, found on the way

`record_assessment` rides the workbench-event table so that no new sink was
needed. Two readers take every row of that table as student work:

- **Teacher session report** (`reports/session_summary.py`, the workbench query
  ~L281): an assessment row showed as a "work" item carrying a raw level, and
  counted towards `simRunCount` (L313). **Already fixed in `235794d4`**
  (2026-10-05, *the tutor's hidden assessment is not the student's work*): a
  `NOT_STUDENT_WORK_TOOLS` filter. M0 adds `assess_concept` to it.
- **Researcher transcript** (`analytics/research_logs.py`, `_timeline_work`
  ~L346): reads the same rows unfiltered. Researchers are *meant* to see
  assessments (decision 2), but as the tutor's judgement in their own lane, not
  interleaved as something the student did.

## Decisions — M, 2026-10-05

1. **One assessment system, on the concept map**, for every activity that has
   one. Extend the check-off; do not generalise the sim block. A sim's
   `assessment:` block becomes a mapping of its phenomena onto concept-map
   nodes; `record_assessment` becomes a thin wrapper over the unified tool for
   one release, then is removed.
2. **Visibility.** The student keeps the encouraging three-state map and never
   sees a level. The teacher sees level, evidence and misconception per group
   per concept, in final work and as a distribution on the class graph.
   Researchers see everything, in BigQuery, stamped with tutor, approach and
   revision so that tutors can be compared.
3. **Scale.** One platform default graded scale, replaceable per activity by
   the teacher or by a sim's mapping. Cross-activity comparison holds only on
   the default scale.
4. **Consent.** Recording a graded judgement of every group on every activity
   needs JB's sign-off (research consent, data agreements). That gates
   **switching it on in prod**, not building it. The flag defaults off in prod.

## Design

### The default scale — 0–4, after SOLO

| Level | Name | Descriptor (what the student's own words show) |
|---|---|---|
| **0** | No evidence | Nothing relevant yet, a guess, "don't know", or an answer beside the point |
| **1** | One piece | One relevant idea, unconnected (*"it's to do with the tilt"*) |
| **2** | Several pieces | Several relevant ideas, not joined into an explanation |
| **3** | Explains | A connected explanation in their own words for the case in front of them. **This is the node's `doneWhen`** |
| **4** | Extends | Uses it beyond the case: a new situation, a quantitative argument, or a critique of the model |

Scale id `aipla-default-0-4-v1`. Why this one:

- **It is concept-agnostic.** Every concept map gets it with no per-node
  authoring. The 56+ maps already on prod have no level descriptors, and a
  scale that needs them would apply to none of them.
- **It is SOLO** (Biggs & Collis), which Danish teachers are likely to know
  already. A teacher can read a level without a key.
- **Level 3 is the teacher's own bar.** `doneWhen` already says what counts as
  having got a concept, so the grade lines up with the definition of done
  instead of competing with it.
- **Five levels, not seven.** The model judges in the middle of a turn, with
  no time to deliberate. Generic descriptors cannot separate seven levels
  reliably, and a scale finer than the judge can resolve adds noise and looks
  precise.
- **The misconception is a separate field, not a level.** The sim author's
  0–6 scale works as a construct map because each level names that topic's
  typical wrong ideas. With no topic content to draw on, mixing *how much* with
  *which wrong idea* would blur both. A group can be at level 2 and hold a
  misconception. The teacher needs to know both.
- **"A guess or don't know is 0"** is taken straight from the `sol-jord-maane`
  author (`assessment_tools.py`, the tool docstring). Absence of evidence is
  not low understanding.

The `sol-jord-maane` 0–6 construct map (Briggs et al. 2006, Wilson 2009)
remains a valid **activity scale** (`sol-jord-maane-0-6-v1`). It is richer for
its topic, and activities seeded from that sim keep it. **Levels on different
scales are not comparable.** A 4 on 0–6 is not a 3 on 0–4, and nothing in this
design rescales one onto the other. The researcher view groups by `scaleId` and
refuses to pool across scales.

### Data model

```python
class ScaleLevel(BaseModel):
    level: int; label: str; descriptor: str = ""

class AssessmentScale(BaseModel):          # activity_config.py
    id: str                                # "aipla-default-0-4-v1"
    levels: list[ScaleLevel]               # contiguous, 2–7 entries
    no_evidence_level: int = 0             # alias noEvidenceLevel

class ConceptMapElement(BaseModel):
    ...
    assessment_scale: AssessmentScale | None = None   # None → platform default
    phenomenon_map: dict[str, str] = {}               # "<sim>:<phenomenon>" → node id (M3)
```

**`concept_progress`: a second list per node, not new fields on the evidence
records.**

```
nodeStates.<node_id>.evidence     [... unchanged ...]        → derive_status (unchanged)
nodeStates.<node_id>.assessments  [{kind: "tutor"|"teacher", level, scaleId,
                                    evidence, misconception, at,
                                    tutorId, tutorVersion, frameworkId, revision}]
```

A separate list rather than `level` on each evidence record, for three reasons:

- **`derive_status` stays byte-for-byte unchanged**, so the student map cannot
  move because of this work.
- **The student strip removes one key** instead of filtering fields inside
  records. Field-level filtering is how a future field slips through.
- **The two have different writers and visibilities.** A check-off is a visible
  CheckpointCard; a grade is a hidden call (below). Pairing them in one record
  would force every check-off to carry a grade or leave a hole in it.

`derive_level(assessments)` mirrors the existing precedence: the latest
`teacher` record wins permanently, otherwise the latest `tutor` record. It
returns `{level, scaleId, misconception, evidence, at, kind}`. If records on
the list carry different scale ids (the teacher changed the scale mid-term),
the current level is only ever taken from records on the activity's
**current** scale. The others stay in history. `_trim` applies to the new list
with the same keep-newest-of-each-kind rule.

**Reads fail closed.** `states_from_stored(stored, *, include_assessment=False)`.
The default drops `assessments`. Only the teacher, class-owner and researcher
paths pass `True`. A new reader that forgets the argument gets the safe view.

### The one tool — `assess_concept`

```python
def assess_concept(node_id: str, level: int, evidence: str,
                   misconception: str = "", tool_context=None) -> dict
```

- **Offered only when** the active activity has a concept map, the caller is an
  anonymous-group student (as for `build_checkpoint_tools`, `agent.py:506`), and
  the `CONCEPT_ASSESSMENT` flag is on.
- **The declaration is narrowed to the activity.** `node_id` is an enum of the
  map's node ids, and `level` has `minimum`/`maximum` from the activity's scale.
  This uses the `_AssessmentTool._get_declaration` pattern already shipped in
  `assessment_tools.py`. The scale's descriptors and each node's `doneWhen` go
  into the tool description, so the model reads the bar in the same place it
  makes the call.
- **Evidence is required** (refused when empty, as `record_assessment` does
  today). `misconception` is optional, a few words, and capped at 300 characters.
- **The group id, class id, activity id and tutor stamp come from the verified
  session**, never from parameters.
- **It never changes status.** The visible check-off remains
  `record_checkpoint` / `mark_concept`, with its card. A hidden call that lit up
  a node on the student's map would change the screen without the card that
  explains why. The tutor guidance (the concept-map ambient block) says to
  assess *alongside* a check-off or a substantive answer, not in place of one.
- **It is hidden from the student, structurally.** `assess_concept` joins
  `_STUDENT_HIDDEN_TOOLS`. Its args carry the level, so redacting the result
  alone is not enough (the reasoning is at `stream_redaction.py:128`). It must
  **not** also be in `_CLIENT_RENDER_TOOLS`. A test asserts the two sets are
  disjoint.
- **It writes twice, from one call**: the Firestore record (what the teacher
  sees) and one `emit_workbench_event` row, `tool = "assess_concept"`,
  `field = <node_id>`, `value = {level, scaleId, evidence, misconception,
  tutorId, tutorVersion, frameworkId, conceptLabel}`, with `revision` stamped
  by the emitter (what the researcher compares). If the BigQuery emit fails it
  is suppressed, as everywhere else. If the Firestore write fails the tool
  returns `ok: false`.

**What the tutor's ambient context gets.** `checkpoint_state_summary`
(`checkpoint_tools.py:229`) keeps showing status. It gains the latest
**misconception**, which the tutor can act on, but **not the number**. A level
in the prompt invites the reply text to repeat it, and nothing structural can
stop that once it is in the prompt. (Open question 2.)

### Student reads — stripped on the server

| Read | Today | After |
|---|---|---|
| `GET /activities/{id}/concept-progress`, student branch (`concept_progress_routes.py:54`) | `get_node_states` → full records | `include_assessment=False`, so the `assessments` key is absent from the payload |
| Same route, teacher/researcher branch (L58) | `states_from_stored` | `include_assessment=True`, plus `currentLevel` per node |
| `record_checkpoint` / `mark_concept` results (client-rendered) | statuses only (`checkpoint_tools.py:163,223`) | unchanged. A test pins that they carry no `assessments` |
| `assess_concept` | — | whole call hidden |
| Try-as-student preview (`preview-` group) | student branch | student branch, so no level. The teacher sees it in their own view, as for any group |

The student UI's `fetchWithAuth` call (`app/chat/[...path]/page.tsx:594`) then
receives nothing it could display, and no frontend change is needed or wanted.
Hiding a level in the UI would be the wrong fix.

### Teacher

- **Final work (`FinalWorkPanel`)**: next to each node's status, the current
  level as `3 · Explains` (number and label, never a bare number), the evidence
  sentence, the misconception if one exists, and the source (AI / you). Earlier
  assessments expand underneath.
- **Class graph (`ClassConceptGraph` via `class_concept_distribution`)**: per
  node, a level distribution across groups (a small bar per level on the
  activity's scale, plus "not assessed"), and the misconceptions listed with
  their counts. When the class's activities mapping one concept use different
  scales, the graph shows one distribution per scale instead of pooling them.
- **Override sets level too.** `ConceptOverride` gains an optional `level`. When
  present, the PUT also appends a `teacher` assessment record on every target
  activity, as it already does for status. Teacher > tutor is permanent, the
  same promise as for status. A level outside a target activity's scale is a
  400 naming that activity.

### Researcher

A query (a view where views exist, inlined on dev as `_work_cte` is) over
`tool IN ("assess_concept", "record_assessment")`. It returns one row per
judgement with `scaleId`, `tutorId`, `frameworkId`, `revision`, `class_id`,
`activity_id`, and node or phenomenon. The research lens gains *level by
tutor/approach* **within one scale and one concept**, with n shown. The
researcher transcript shows assessments as a distinct "tutor judgement" lane.

### Calibration — what this is not

A tutor's in-turn judgement is **one model's read, made mid-conversation, with
no second opinion. It is not validated measurement.** Nobody has yet checked
whether a 3 from one tutor means the same as a 3 from another, or whether
either agrees with a teacher. So:

- The teacher UI labels every AI level as *the AI's read*, the same framing the
  override has used since CONCEPT-1.
- The researcher comparison exists **to test** whether tutors differ. It does
  not report that they do. Until it is checked against human ratings, a
  difference between tutors may be a difference between how they judge, not
  between how well they teach.
- The future offline check is the **post-turn reconciling judge** that
  [living-concept-map](../v1.1.0-feedback/living-concept-map.md) deliberately
  deferred: a separate pass over the transcript that rates the same nodes
  independently. It can run in the same harness as the MAPS/SAAR judges
  (`analytics/session_rubric.py`, `rubric_runs`). Agreement between the in-turn
  level, the offline judge and a teacher sample is the calibration evidence
  this design does not produce. It is out of scope here and named so that
  nobody mistakes M5 for it.

### Migrating `sol-jord-maane`

Concept-map node ids belong to each activity's map, and the sim catalogue is
global, so the YAML cannot name node ids itself. The `assessment:` block
therefore becomes **a declaration of the sim's phenomena and its scale**:

```yaml
assessment:
  scale: {id: sol-jord-maane-0-6-v1, levels: [...]}   # labels from the tutorBlock's CONSTRUCT MAP
  phenomena:
    - {id: doegn, label: "Dag og nat", doneWhen: "..."}
    - ...
```

- **Attaching the sim to an activity with no concept map** offers, through the
  builder or the co-pilot's `propose_concept_map`, to **seed** one from the
  phenomena with the sim's scale. `phenomenon_map` is filled one-to-one.
- **Attaching it to an activity that has a map** asks the teacher to map each
  phenomenon onto an existing node, or to leave it unmapped.
- **`record_assessment`, for one release**, resolves `phenomenon` through
  `phenomenon_map` and calls the same writer as `assess_concept`. If a
  phenomenon has no mapping, it writes the BigQuery row only, as today, and
  logs that it did. After that release it is deleted. `assess_concept` alone
  remains, with the sim's phenomena present as nodes.
- **`mission`** is no longer a model parameter. When the sim's
  `mcp_app_context` state carries `mission.id`, the emitter stamps it on the
  BigQuery row from the server side.
- **Existing `record_assessment` rows are left where they are.** They are on
  `sol-jord-maane-0-6-v1` (stamped retroactively by the researcher query from
  `scale: [0, 6]`) and remain readable there. There is no backfill into
  Firestore. Few rows can exist (the tool reached prod on 2026-10-05), and a
  teacher seeing judgements appear for past sessions would be stranger than
  not seeing them. M0 counts the rows.

### The flag

`CONCEPT_ASSESSMENT` is a backend runtime env var. It is on in dev and test
and **off in prod** until M7. When it is off, `assess_concept` is not offered,
`record_assessment` is not offered (M0, see below), and the override ignores
`level`. Reads still work, so turning the flag off never hides data that
already exists.

⚠️ This is a per-env value. Per the footgun table it needs **both**
`cloudbuild.yaml` and a `cloudbuild.promote.yaml` twin, or it never reaches
prod and M7 does nothing.

## Milestones

| | What | Est. |
|---|---|---|
| **M0** | **Stop the leak, gate what is live.** The `session_summary.py` half is already fixed (`235794d4`); add `assess_concept` to `NOT_STUDENT_WORK_TOOLS`. Give `research_logs._timeline_work` an assessment lane in place of mixing the rows into the work. Put `record_assessment` behind `CONCEPT_ASSESSMENT` (off in prod). Decision 4 applies to it just as much: it has recorded graded judgements on prod since v0.1.79 with no sign-off. Count its existing rows per env | 0.5d |
| **M1** | **Scale + store.** `ScaleLevel`/`AssessmentScale`, the platform default, `ConceptMapElement.assessment_scale`. `assessments` list, `derive_level`, `_trim` on it, `states_from_stored(include_assessment=False)`. Student-branch strip. Tests | 1d |
| **M2** | **`assess_concept`.** Narrowed declaration, flag + concept-map gating, hidden in the stream, Firestore + BigQuery writes with the stamp, the misconception added to the ambient summary, a guidance line in the concept-map block | 1d |
| **M3** | **Migrate `sol-jord-maane`.** New `assessment:` shape in `ArtefactMeta`, `phenomenon_map`, seed-or-map when the sim is attached, `record_assessment` as a wrapper | 0.75d |
| **M4** | **Teacher.** FinalWorkPanel level/evidence/misconception, class-graph distribution per scale, override with `level`. Copy in `copy`/`t()` with DA + EN | 1.25d |
| **M5** | **Researcher.** The assessment query/view, the by-tutor/approach comparison within one scale, the transcript lane | 0.5d |
| **M6** | **Per-activity scale.** The concept-map editor gets *platform default* or *custom* (2–7 levels, label + descriptor), with a warning that a custom scale leaves the activity out of cross-activity comparison. The co-pilot can propose a scale | 0.5d |
| **M7** | **Prod gate.** JB signs off on consent wording and data agreements for graded group-level judgements. Then flip `CONCEPT_ASSESSMENT` in prod and run `make deploy-status` to confirm it arrived. **Not before** | 0.25d + JB |

M0 is independent of everything else and should go first. M1–M2 are the core,
M3–M6 can be done in any order after M2, and M7 waits on JB, not on the code.

## Acceptance criteria

- [ ] **A student-token read never returns a level.** A test seeds a
      `concept_progress` document with both `evidence` and `assessments`, then
      calls `GET …/concept-progress` with a **real minted group token through
      the real dispatcher**, and asserts no `assessments`, `level`, `scaleId` or
      `misconception` key anywhere in the response. The same document read with
      a teacher token returns all of them.
- [ ] **Conflicting fields witness the precedence.** A seed with a newer `tutor`
      level of 4 and an older `teacher` level of 1 derives 1. A seed with
      `demonstrated` status and level 0 returns both unchanged, which proves
      `derive_status` and `derive_level` do not read each other.
- [ ] `derive_status` is unchanged. The existing `test_concept_progress` suite
      passes without edits.
- [ ] `assess_concept` is in `_STUDENT_HIDDEN_TOOLS` and not in
      `_CLIENT_RENDER_TOOLS` (a test asserts the sets are disjoint). A
      student-stream test shows no `TOOL_CALL_*` event for it.
- [ ] The tool is not offered when the activity has no concept map, when the
      caller is a teacher, or when the flag is off. With the flag off,
      `record_assessment` is not offered either.
- [ ] The declaration's `node_id` enum equals the map's node ids, and its level
      bounds equal the activity's scale. An out-of-range level, an unknown node
      or empty evidence returns `ok: false` and writes nothing.
- [ ] One call yields one Firestore record and one BigQuery row carrying
      `tutorId`, `frameworkId`, `revision` and `scaleId`.
- [ ] A teacher override with `level` writes a `teacher` assessment record on
      every target activity. A level outside a target's scale is a 400.
- [ ] The teacher session report counts neither `assess_concept` nor
      `record_assessment` rows as work or as sim runs. The researcher
      transcript shows them in their own lane.
- [ ] The class graph never pools levels across scale ids.
- [ ] `CONCEPT_ASSESSMENT` has a promote twin. Prod reads *off* until M7.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A level reaches the student through the tutor's reply text | M | H | The number is kept out of the ambient prompt (misconception only), and the tool description says never to mention levels. The structural guard covers the tool call, not prose. A text check for a level word in a reply is open question 2 |
| A future reader of `concept_progress` returns `assessments` to a student | M | H | Reads fail closed (`include_assessment=False` default) and the real-token test |
| Teachers read the AI's level as a grade | M | M | Number shown with its label, *the AI's read* framing, override always available. ADR-001: the level belongs to a group, never to a named student |
| Researchers read tutor differences as teaching differences | H | M | The calibration section, n shown, no pooling across scales. The reconciling judge is the follow-up |
| The flag is set in `cloudbuild.yaml` only, so prod never turns on (or never turns off) | M | M | Promote twin in the acceptance criteria. `deploy-status` after M7 |
| The tutor over-assesses (one call per turn) or never assesses | M | L | The guidance ties assessment to substantive answers. M5's per-tutor count shows both quickly |
| JB's answer is no, or "only for consented classes" | M | M | Built behind a flag, so the work is not lost. A per-class opt-in is a small extension of the same gate (open question 4) |

## Open questions

1. **Per-node level descriptors.** The default scale is generic by design.
   Should a teacher be able to add topic-specific descriptors per node (the
   `sol-jord-maane` style)? Probably later. Teachers have to author the
   generic version first before we know whether they want it.
2. **Does the tutor see the number?** This design gives it the misconception
   only. If tutors adapt measurably worse without it, put it back with a
   reply-text check for leaked levels. Test that on dev before deciding.
3. **Should a level ever derive the status?** For example, ≥ 3 lights the node.
   Rejected for now, because a hidden call would move the visible map without
   a card. Revisit if teachers see "level 4, status partial" as a contradiction
   rather than as two different reads.
4. **Consent granularity (JB).** Is the sign-off platform-wide, or per class
   with an opt-in on the class page? The flag is platform-wide. A class-level
   gate would sit beside it.
5. **Scale changes mid-term.** Records on an old scale stay in history and
   stop counting towards the current level. Is that what a teacher expects, or
   should changing the scale be refused once any assessment exists?
6. **Group vs individual.** Many groups are one or two students, so a group
   level is close to an individual one in practice. That is part of what JB is
   being asked, and it ties into the identity problem in
   [longitudinal-concept-evidence](../v1.1.0-feedback/longitudinal-concept-evidence.md).
