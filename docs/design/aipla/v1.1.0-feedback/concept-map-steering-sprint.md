# Sprint CONCEPT-2 — the map steers the tutor, and chains across the year

**Sprint ID:** `CONCEPT-2` · **Created:** 2026-09-25 · **Design number:** 1.1.134
**Estimated:** ~8.5-10.5 dev-days across eight milestones (~4 weeks at the extension's 2.5 d/wk)
**Design docs this executes:** [1.1.90 bounded-tutoring-answer-trees](bounded-tutoring-answer-trees.md) (M0 only) ·
[1.1.65 living-concept-map](living-concept-map.md) (its unshipped M2 remainder) ·
[1.1.121 class-level-concept-graph-aggregation](class-level-concept-graph-aggregation.md) (M0 + M1 + M2a, **with its union corrected to a distribution**) ·
[2.9 knowledge-graph-and-student-matching](../post-pilot/knowledge-graph-and-student-matching.md) (capability 3's teacher-facing slice, pulled forward)
**Source:** M, 2026-09-25 - *"tutors stray from the lesson plans despite keeping character"*; concept maps
should be **on by default** with an opt-out; the platform should **help the teacher create them**; and maps
should **chain across activities over a year** so a class crosses off long-term concepts.
**Refined:** M, 2026-09-25 - *"the class level may disagree with group level mastery, and indeed we want to
help link groups that are mastering different trees of the class levels. I guess we need some kind of way to
link them or conflict resolve for the teacher?"* - which settles open question 3 below and **rules out the
union** 1.1.121 M0 proposed. See "Class level is a distribution, not a union".

## Why this sprint exists, and what it is NOT

Four design docs already cover most of this ask. This sprint connects them rather than adding a fifth,
and it **corrects one stale premise** that would otherwise cost a day of re-building something shipped.

### What prod actually looks like (measured 2026-09-25, `aipla-prod-2026` Firestore)

| | |
|---|---|
| `activities` | 280 |
| with a non-empty `conceptMap` | **56** |
| **distinct maps among those 56** | **4** |
| `concept_progress` documents, ever | **2** |

The 56 is 26x *Bevægelsesgrafer* + 26x *Kastebevægelse* + 3x *Energibevarelse* - all three are the seeded
`frontend/src/lib/activityTemplates.ts` maps, copied verbatim when a teacher picked the template - plus
exactly **one** teacher-authored map (*Bølge og amplitude*, with check questions, so somebody did use the
co-pilot). Checkpoints have fired twice in the pilot's life: `calm-zebra-49` (3 nodes, 2026-08-21) and
`still-valley-05` (2 nodes).

**Read that carefully before planning adoption work.** The maps in prod are not evidence of teachers
authoring maps; they are evidence of teachers picking templates that happened to carry one. The
authoring surface has been used once. And the check-off path - the thing that would make a map *do*
anything - is close to inert.

### The stale premise, corrected

[1.1.90](bounded-tutoring-answer-trees.md)'s "what already exists" table says the map
*"does not constrain what the tutor may talk about, and the tutor is not told the map exists on an
ordinary turn."* **The second half is no longer true**, and this materially shrinks M0:

| Already shipped and wired | Where |
|---|---|
| Node labels + prerequisite edges + the full checkpoint contract, in the composed instruction | `adk/teacher_focus.py:327-347` (CONCEPT-1 M3, commit `6e100a3b`) |
| **The group's CURRENT node statuses, with labels and dates, refreshed every turn** | `adk/progress_context.py` -> `adk/checkpoint_tools.checkpoint_state_summary`, composed at `adk/agent.py:857` |

`create_agent_with_thinking` is called from `skills.skill_processor.process_skill_request` on **every
request**, so what reads like a build-time block is a per-turn block - `progress_context.py`'s own
docstring records this, having caught the same wrong assumption in 1.1.70's design doc.

So the tutor already has the map and the group's progress against it. What it does **not** have is:

1. **a boundary** - nothing says these concepts are the edges of the lesson, so a model following the
   student's interest wanders and the teacher experiences that as unreliability;
2. **a frontier** - nothing computes "given the DAG and what is demonstrated, here is what to work
   toward next", so the map is a record rather than a plan;
3. **a definition of done per concept** - `check_questions.expected_answer` is the summative probe, but
   nothing states what counts as having got it, which is what a passive mark would need to judge against;
4. **a passive mark** - only the deliberate `run_checkpoint`/`record_checkpoint` path writes progress,
   which is why there are two documents.

M0 is therefore **~0.5d of composition, not ~1d of plumbing**.

### Explicitly out of scope

- **1.1.90 M2-M5 (answer trees, question budget, conditional retrieval).** A separate, larger piece of
  work. M0 is the part that pays for itself against maps that already exist in prod.
- **1.1.121 M2(b) - batch generation across many classes.** Its own doc raises the objection this sprint
  accepts: who reviews 30 auto-drafted maps, and neglect makes "nobody reviewed it" easy. M3 here lowers
  per-activity friction instead.
- **The post-turn reconciling LLM-judge pass** (living-concept-map M2's safety net). M2 here ships the
  *legible primary* - a visible tool call the tutor makes deliberately - and defers the judge pass until
  there is calibration evidence, honouring that doc's "don't ship this depth as a casual probe".
- **Individual student trajectories.** Forbidden by ADR-001; [1.1.68](longitudinal-concept-evidence.md)
  did that analysis and the answer is settled. Everything here is group- and class-level.
- **Cross-CLASS matching and the longitudinal mastery vector.** [2.9](../post-pilot/knowledge-graph-and-student-matching.md)
  capability 2-proper and the researcher-first surface stay Year-2. What M7 pulls forward is only the
  teacher-facing slice 2.9 itself scopes - *"matching within their groups"* - which needs today's data,
  not a year of it.

## Class level is a distribution, not a union

[1.1.121](class-level-concept-graph-aggregation.md) M0 proposes that *"a class's progress on that concept
is the union of what any of its groups demonstrated"*. **This sprint rejects that**, because the union
destroys the exact signal the refinement asks for: if group A demonstrated *vektorer* and group B did not,
the union reports that the class has *vektorer*, and the teacher can no longer see the split - or which
two groups to put together.

So:

- **The per-(group, concept) record stays the only stored truth.** It is what the tutor reads, what the
  student's map lights up from, and what any aggregate is derived from.
- **Class level is a DERIVED distribution** over that class's groups, per concept:
  *3 demonstrated, 2 partial, 2 not yet, 1 never met*. A class "has" a concept only in the sense that some
  proportion of its groups have shown it, and the proportion is the information.
- **Disagreement between levels is therefore not an error to resolve.** It is the shape of the class, and
  it is what makes M7 possible.

### What IS a conflict, then

Genuine conflicts are *within* one (group, concept) - two pieces of evidence that cannot both be the
current read:

| Conflict | Example | Resolution |
|---|---|---|
| **Provenance** | a passive `observed` mark says `demonstrated`; a deliberate `checkpoint` says `partial` | precedence: `teacher` > `checkpoint` > `observed`; the store's docstring already declares the lower two |
| **Staleness** | `demonstrated` in *Kastebevægelse* in September, `not_yet` in *Energibevarelse* in February | never silently overwritten - both are kept, the later one is the current read, and the pair is what a teacher wants to see (it is forgetting, or it is a different context for the same concept) |
| **Authority** | the AI's read disagrees with the teacher's | the teacher wins, permanently, and the tutor is told so |

**This forces one schema decision, and M2 is the last cheap moment to take it.** Today
`record_checkpoint_state` **overwrites** `nodeStates[node_id]` with a single `{status, evidence, updatedAt}`
slot, so the previous read is gone and no conflict is representable. M2 adds a second writer
(`mark_concept`), which is precisely when a lossy slot starts destroying information. The store has **two
documents in it today** - append-only evidence costs nothing now and a migration later.

## Milestones

Ordered so each is independently shippable and the cheapest behavioural win lands first.

### M0 - the map bounds the conversation and names the frontier (~0.5d, backend)

New `backend/adk/concept_steering.py`:

- `build_concept_steering_block(cfg, user) -> str`, composing two things and nothing else:
  - **Boundary.** The concepts above are what this lesson is about. A student's tangent is often the
    teachable moment, so acknowledge it briefly and bring the conversation back - **do not refuse it.**
    ([1.1.90](bounded-tutoring-answer-trees.md) is explicit that the transcript said *"while allowing for
    limited deviation"*; a tutor that suppresses every off-map remark is a worse tutor.)
  - **Frontier.** Computed from the prerequisite DAG plus the group's node states: the node(s) not yet
    `demonstrated` whose prerequisites all are. *"Where this can go next: X."* Falls back to the
    topological roots when nothing is recorded.
- Returns `""` when the activity has no concept map, so the 224 prod activities without one compose
  byte-identically to today.
- Bounded by its own cap, like every other variable-length contributor (`teacher_focus._CONCEPT_MAP_CAP`
  is the precedent).
- Wired in `adk/agent.py` **after** `compose_progress_context` on the file's "later instruction wins"
  convention: the statuses say where the group has got to, the steer says what to do about it.

**Tests.** Unit: block empty without a map; frontier respects prerequisites (a node whose prereq is
`partial` is not the frontier); frontier falls back to roots on an empty store; cap holds on a 30-node
map. Eval (`tests/eval/`): an off-map question is acknowledged and returned from - and the counter-test
that an **on-map** tangent is *not* suppressed, which [1.1.90](bounded-tutoring-answer-trees.md) makes a
first-class requirement rather than a nicety.

### M1 - definition of done per concept (~1d, fullstack)

`ConceptNode` gains `done_when: str` (<=200 chars, alias `doneWhen`) - the teacher's plain-language
completion criterion (*"can explain why the horizontal component is unchanged"*), distinct from
`check_questions`, which are the summative probe. Absent -> falls back to the label, so the 56 maps in
prod are unaffected until edited.

- Emitted in the `teacher_focus` concept block next to each node, and named in the checkpoint contract
  as what a pass is judged against.
- A field per node in `ConceptMapEditor.tsx`; `propose_concept_map` proposes one per node.
- ⚠️ **Axiom-10 note:** `done_when` rides the same tool-result/instruction path as `expected_answer`,
  which is already accepted-with-a-caveat for the formative demo (see concept-map-sprint.md risks). This
  adds no new exposure class but widens the same one - keep it on the pre-pilot strip list.

### M2 - `mark_concept`, the passive check-off + an append-only evidence record (~1.5-2d, fullstack)

The unshipped half of [living-concept-map](living-concept-map.md) M2, which is what "help the tutor mark
off progress" asks for:

- **Schema first** (see "What IS a conflict"): `nodeStates[node_id]` grows from a single overwritten slot
  to `{"status": <derived>, "evidence": [<record>, ...]}` where each record carries
  `{kind, summary, activityId, at}` and `kind ∈ {teacher, checkpoint, observed}`. `status` is a pure
  **reduction** over the records, never written directly and never stored. Capped at the most recent N
  per node, with the newest of each *kind* kept first so the cap can never silently change the derived
  status. **Built as read-migration, not a backfill script** (changed during M2): the old slot becomes
  the first record when a document is read, so there is never a window in which some documents are one
  shape and some the other, and the two historic prod documents keep their evidence rather than being
  rewritten over.
- Tool `mark_concept(node_id, status, evidence_summary)` appending a record with `kind="observed"`. The
  store already anticipates the ranking: `db/concept_progress.py`'s docstring defines `"checkpoint"` as
  **stronger** than `"observed"`.
- **Precedence:** `teacher` > `checkpoint` > `observed` for authority; otherwise the most recent record
  wins, so a re-check can lower a concept a group has gone cold on. The asymmetry that matters: an
  `observed` record may **raise** but never **lower** what a `checkpoint` established — a passive misread
  must not undo a deliberate pass, while a passive read of genuine progress should still move a node on,
  because the alternative is a map that goes stale exactly when the lesson is going well.
- The tool is told the status that **actually stands**, not the one it asked for. A tutor that believes a
  refused mark landed will talk about the concept as settled while the map says otherwise — the same
  class of bug as 1.1.70.
- **Trust card**, per the `workbench-element-builder` recipe - a one-shot deliberate action gets a card
  per action. ⚠️ **The tool name MUST be added to `_CLIENT_RENDER_TOOLS`** or the card silently stops
  rendering; that is a live footgun row in CLAUDE.md with a CI guard
  (`make check-stream-allowlist`), and `mark_checklist_item` was bitten by exactly it.
- The tutor is told a mark is revisable and framed as progress, never a grade - the wording
  `progress_context._CONTRACT` already uses.

### M3 - on by default, with a real off switch, and help creating one (~1d, fullstack)

- **Builder:** for a new activity the concept-map section is present, with a one-click
  *"Foreslå begrebskort"* that asks the page's co-pilot for a draft. **Propose, never auto-apply**
  (Axiom 2) - the teacher accepts the diff, as today. Built as an `ask(text)` channel on the existing
  `CopilotEntryContext` (*"one way to ask for help"*), because the chat that can send a turn sits several
  layers below the builder inside the AG-UI provider; the button is not rendered at all when no work
  co-pilot is mounted, rather than being offered dead.
- **Off switch, two levels:** remove the element on this activity (already possible - an empty list);
  and a `conceptMapDefault` preference in `teacher_prefs`, surfaced in the existing
  `/teacher/settings` Defaults card (`_DefaultsCard.tsx`), which **seeds** the builder and never fights
  it - the rule that card was built on.
- This is [1.1.121 M2(a)](class-level-concept-graph-aggregation.md) plus the element default its doc
  does not cover. Registered there as a new milestone rather than invented here.

### M4 - the year chain: `class_id` provenance + activity links (~1.5-2d, backend)

⚠️ **[1.1.121](class-level-concept-graph-aggregation.md) M0 says "a `class_id` index on the existing
store". There is no `class_id` on `concept_progress`** - it is keyed `{group_id}:{activity_id}` and
carries `groupId`/`activityId` only. Two halves, both needed:

- **Stamp on write.** `record_checkpoint_state` (and `mark_concept`) resolve the class from the
  **verified** group tag (`class:<owner>:<id>`, the same source `resolve_active_config` uses - never a
  model-supplied value) and write `classId`.
- **Backfill.** `scripts/backfill_concept_progress_class_id.py`, idempotent, dry-run by default. It
  resolves each document's group through `anon_groups/{group_id}.classId` — the binding the code was
  minted with. Unstamped documents are **invisible** to the rollup until it runs, deliberately: a rollup
  that quietly filled in what it could not read is the "checker answers when it could not read its
  subject" failure this repo has shipped twice.
- **Join key.** The doc assumes activities "share node ids". Template copies do; two independently
  authored maps will **not** - the same concept gets a different slug in each. So the rollup joins on a
  normalised concept **label**, or on an explicit `ActivityLink.via_concept_ids`, and never assumes id
  equality. This is the correction that keeps M5 from showing a class a graph of duplicated nodes.
- **`ActivityLink`** (`to_activity_id`, `via_concepts`, `kind: "prerequisite"|"related"`) on the
  Activity — `from` is implicit in the document it lives on, so it cannot drift; and `via_concepts`
  carries teacher **labels** rather than node ids, for the same reason the rollup joins on labels.
  Teacher-authored, with a cheap proposal: two activities whose maps carry the same normalised label are
  a candidate link, no NLP required. ⚠️ It gets its **own** `PUT /links` endpoint rather than a field on
  `ActivityUpsert`: that body is a full replace, so a client that saved without rendering links would
  silently clear them — the full-overwrite footgun this repo has already shipped.
- **`get_class_concept_distribution(class_id)`** - per concept, the *distribution* of its groups'
  statuses plus the per-group detail, **not** a union. One read, no new store. The per-group records
  remain the only truth; this function is derivation and stays that way.

### M5 - the class-level graph view (~1.5d, frontend)

A teacher/researcher view reusing `ConceptMapGraph.tsx` - not a second visual language - showing every
concept the class's activities have mapped, with activity-link edges drawn between activities. This is
the *"groups fill in over time"* surface.

Each node shows the **distribution**, not a single colour: how many of the class's groups are
demonstrated / partial / not yet / never met it, with the groups named on selection. A node where the
class disagrees with itself is the interesting node, so the view must not average it away.

### M6 - reconciliation and the teacher's override (~0.75d, fullstack)

The concept block in `teacher_focus.py` already tells the tutor *"This is the AI's read - the teacher can
override it"*. **Nothing implements that.** M6 makes the promise true:

- **Override:** a teacher sets a node's status for **one group** (the atom) with `kind="teacher"`, which
  outranks every AI record in the reduction and is never overwritten by one. A class-wide convenience
  applies the same record to every group; it is a loop, not a second concept.
- **The tutor is told**, in the same block that carries the statuses: a teacher record is not the AI's
  read and is not to be re-tested.
- **Flags, not hunting.** The view surfaces the two genuine conflict classes from the table above -
  provenance disagreement and a status that went backwards across activities - rather than leaving a
  teacher to find them among thirty nodes.

### M7 - complementary groups: who should talk to whom (~0.75-1d, fullstack)

The second half of the refinement, and [2.9](../post-pilot/knowledge-graph-and-student-matching.md)
capability 3's teacher-facing slice: *"group A has what group B is stuck on"*.

- **It reuses M0's frontier function** — literally, not by analogy: the graph rule moved to
  `db.class_concept_rollup.frontier_nodes` and `adk.concept_steering` became its per-activity adapter,
  with M0's 17 tests green against the shared implementation. That is the reason this is under a day. For each group in the
  class: the frontier (what it is ready for) and the demonstrated set (what it has). A pair is
  complementary when one group's demonstrated set covers the other's frontier - strongest when it runs
  both ways on different concepts, which is a genuine exchange rather than tutoring.
- **Teacher-facing only, and framed as complementarity.** ⚠️ Ranked "group A is ahead of group B" is a
  leaderboard, which this must not become and which must never reach students. The surface names the
  *concept the pair would exchange*, not a score.
- ADR-001-safe by construction: group-level throughout, no individual targeting. The teacher already
  knows who is in which group - that is their class, not a re-identification.

## Doc amendments that ship with the sprint (~0.25d) — **all done 2026-09-25**

1. **[1.1.90](bounded-tutoring-answer-trees.md)** - correct the "what already exists" table (the tutor
   IS told the map exists, and does get live statuses); restate the gap as boundary + frontier + stop
   condition; mark M0 as executed by CONCEPT-2 and note the revised estimate.
2. **[1.1.121](class-level-concept-graph-aggregation.md)** - **replace the union with the distribution**
   (the correction M's 2026-09-25 refinement forces); add M3's element-default milestone; record the
   `class_id`-does-not-exist correction and the label-not-id join key; close all three open questions.
3. **[1.1.65](living-concept-map.md)** - mark the M2 remainder as executed, minus the reconciling judge.
4. **[2.9](../post-pilot/knowledge-graph-and-student-matching.md)** - record that capability 3's
   teacher-facing slice is being built now at class scope (it needs today's data, not a year of it), and
   that capability 2-proper and the cross-class/researcher surface remain Year-2.
5. **SEQUENCE.md** - register 1.1.134 and update the CONCEPT-1 row.

## Open questions

All three of [1.1.121](class-level-concept-graph-aggregation.md)'s are now settled - two from the repo,
the third by M on 2026-09-25.

1. *"Is 'resurrecting the automatic concept graph' a prior capability?"* - **No.** There has never been
   an automatic generation path in this repo; the only generation mechanism is the on-demand co-pilot
   tool `propose_concept_map`. It is a new ask, not a regression.
2. *"Does 'link classes and activities' mean more than activity-linking edges?"* - **No**, per the
   meeting's own *"start with activities"*. M4 builds activity->activity; the class view is the
   aggregate consequence, not a second authoring surface.
3. *"Does the class-level slice supersede or sit beside
   [2.9's capability 2](../post-pilot/knowledge-graph-and-student-matching.md)?"* - **Beside, and
   subordinate to it.** M, 2026-09-25: the two levels may disagree, and the disagreement is wanted. So
   the per-group record is the truth and class level is derived from it (M4), the disagreements a teacher
   must act on are surfaced and resolvable (M6), and the disagreements they should *exploit* become
   pairings (M7). 1.1.121's union is superseded.

What remains open, and does **not** block any milestone:

4. ~~**What counts as "never met"?**~~ **Settled at M5**: kept as its own segment and its own words
   ("har ikke mødt begrebet"), never merged into `not_yet`. They are different facts — a gap in coverage
   versus a gap in understanding — and they call for opposite responses from a teacher. The rollup
   reports only what it can see; the class roster that turns "absent" into "never met" is added by the
   route, which is the only layer that holds it.
5. **Does an override apply to the group or the whole class by default?** M6 builds the per-group record
   as the atom with a class-wide convenience on top. If teachers reach for the class-wide form every
   time, the default is wrong and should flip - that is a post-M6 observation, not a pre-M6 decision.
6. **Does a cycle in the aggregated graph need resolving?** Two activities can legitimately disagree
   about which of two concepts comes first, and M4 keeps both edges rather than picking a winner nobody
   chose. The renderer tolerates it. Whether a teacher should be SHOWN that their two maps disagree is a
   question for AD and M, not a bug.

## Risks

- **M0's benefit lands mostly on template copies.** Four distinct maps carry all 56 activities. That is
  fine - they are real lessons that real classes ran - but it means M0 should be judged on transcripts,
  not on coverage counts.
- **Calibration, M2.** A passive mark is the model's read. It stays visible (trust card), revisable, and
  framed as progress. The reconciling judge stays out until there is evidence.
- **Prompt budget.** `_TOTAL_FOCUS_CAP` is 32,000 as of 2026-09-24 and the steering block is small and
  capped, but it is one more contributor to a budget already shared eight ways - the existing
  `test_composed_focus_stays_under_the_skillconfig_instruction_cap` must stay green. **It did not, at
  M2:** the concept block's node lines are capped at `_CONCEPT_MAP_CAP` but its *contract prose* was
  capped by nothing, and a second recording mechanism pushed the maximal composition to 8,416 against an
  8,000 working margin. Resolved by tightening the contract (the detail belongs in the tool docstrings,
  which ADK ships with the call), raising the margin to 8,500 with the reason recorded, and adding
  `test_the_concept_contract_prose_stays_bounded` - the guard that was actually missing.
- **The stream allow-list (M2).** Named above because it is the single most-repeated footgun in this
  area: a client-rendered tool result that is not allow-listed disappears with no error and no log line.
- ⚠️ **M7 becoming a leaderboard.** "Which groups are ahead" is one CSS change away from "which groups
  are behind", and a class can read that off a teacher's screen. The surface names the concept a pair
  would exchange, never a score or an order, and it has no student-facing route. If it cannot be built
  that way it should not be built.
- **M2's schema change has a one-way door in it.** Append-only evidence is cheap at two documents and
  expensive at two thousand. It lands with the second writer or it does not land.
- **Evidence growth.** An append-only record on a concept a class revisits all year needs the per-node
  cap to be real, not aspirational - tested with a synthetic long history.

## Acceptance

- [x] **M0:** a map-carrying activity composes a boundary + frontier block; an activity without a map
      composes byte-identically to before; eval shows an off-map question returned from and an on-map
      tangent NOT suppressed.
- [x] **M1:** `done_when` authored in the builder, proposed by the co-pilot, visible to the tutor, and
      absent-safe on the 56 existing maps.
- [x] **M2:** `mark_concept` writes `observed` evidence, never downgrades a `checkpoint`, renders a
      trust card, and is in `_CLIENT_RENDER_TOOLS` with the CI guard green.
- [x] **M3:** a new activity offers a map by default; one click drafts one; the teacher can turn it off
      per activity and per account.
- [x] **M4:** checkpoints stamp `classId` (existing documents are stamped by an idempotent script, since a QUERY cannot be read-migrated); the rollup joins
      on labels/links, not id equality; `get_class_concept_distribution` returns a per-group
      distribution and **no test anywhere asserts a union**.
- [x] **M5:** a teacher sees one graph for the class spanning every mapped activity it has run, with each
      node showing how its groups are spread rather than one averaged colour.
- [x] **M6:** a teacher override outranks every AI record, survives later AI marks, is stated to the
      tutor, and the two conflict classes are flagged rather than hunted for.
- [x] **M7:** a teacher sees candidate group pairings naming the concept each would exchange, with no
      ranking and no student-facing surface.
