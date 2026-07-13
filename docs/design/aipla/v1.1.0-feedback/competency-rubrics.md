# Competency rubrics — a rubric experimentation platform (MAPS + SAAR as seed lenses), four-format quizzes, misconception index

**Status:** **Proposed — extends the R1 input, does not re-litigate it.** The offline judge
prototype + misconception index are **un-gated**; anything surfaced in the teacher UI in rubric
vocabulary stays **R1-gated** (same split discipline as [1.1.31](teacher-analytics-framework.md)).
**2026-07-13 reframe (M's steer):** the compute layer is no longer a fixed MAPS/SAAR pair — it
becomes a **rubric experimentation platform**: free-form user-authored rubrics, prompt versioning,
retroactive re-scoring over past sessions **by group code**, doc/image reference, and
promote-to-live provenance. MAPS and SAAR become the first two *seed* rubrics, not the schema.
See the "What changed (2026-07-13)" section below.
**Last Updated:** 2026-07-13
**Priority:** P1 (the competency layer is AR's answer to "what do teachers evaluate with?");
quiz template is a TAA M2 input; misconception index is un-gated enrichment of 2.5 Lens B.
**Estimated:** M0 platform primitives (registry + versioning + run store + group-code addressing
+ doc/image loader + MAPS as first seed judge) ~3–4d · M0.5 versioning/provenance/backfill ~1–1.5d ·
M1 anchor packs ~2–3 ped-days (AR/JB) · M2 SAAR agent-design activity ~2d · M3 four-format template
into TAA +1d · M4 misconception index ~2d.
**Scope:** Backend analytics (`backend/analytics/session_rubric.py` — new: registry + runner +
versioned prompt store + `rubric_runs` provenance) + activity templates + judge prompts.
Researchers address everything by **group code** (never internal session ids). No student-surface
change; no new *student* instrumentation (the run store is new researcher-facing metadata).
**Dependencies:** [2.5 session-analytics-rubric](../post-pilot/session-analytics-rubric.md) (the
lens stack this extends); 1.2 chat-log-pipeline (shipped — the BQ turn stream);
[student-multimodal-upload](student-multimodal-upload.md) + SUBMIT-1 (shipped — the photo/whiteboard
artifacts the judge scores); [teacher-activity-authoring](teacher-activity-authoring.md) (M2 quiz
milestone consumes the four-format template); [1.K DRA maps](../v1.0.0-pilot/dra-activity-framework.md)
(sibling vocabulary); **R1** for teacher-facing vocabulary only.
**Source brief:** AR's 29-June competencies email, audited in the scoping site —
[`notes/2026-07-10-aswin-competency-sources-audit.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-07-10-aswin-competency-sources-audit.md).
Primary sources archived (CC-BY PDFs + extractions) in scoping-site
`sources/aswin-competencies-2026-06-29/`.

> **What changed since 2.5 was written.** 2.5 compares frameworks for *labelling conversations*
> (engagement + concept coverage). AR's sources supply something 2.5 doesn't have: **published,
> validated rubrics for scoring student work** — the thing a teacher actually evaluates with.
> That's a third lens family, orthogonal to the R1 choice: it composes with **either** the
> ICAP+FCI or the CPS+DRA stack (it consumes artifacts, not turn labels). The
> [`live_framework.py`](../../../../backend/analytics/live_framework.py) swap-path pattern
> already anticipates exactly this kind of config-shaped extension — but note these lenses are
> **post-hoc only** (2.5 cadence), never live-cadenced: cost, and the evidence-integrity rule
> below make a rolling competency score meaningless.

## What changed (2026-07-13) — from fixed lenses to a rubric experimentation platform

The sections below (evidence-integrity rule, MAPS/SAAR rubrics, four-format quiz, misconception
index) are the **pedagogical payload** and are unchanged. What changes is the **container**: M
asked that the scoring layer be an experimentation platform, not a hardcoded MAPS+SAAR pair. Six
requirements, each mapped to an already-shipped mechanism so we build glue, not plumbing:

1. **Free-form rubrics, not just MAPS/SAAR.** A rubric is a *named prompt + metadata*, authored and
   stored, not a Python `Lens` subclass. The registry accepts arbitrary rubrics; MAPS, SAAR, ICAP
   and FCI-misconceptions become **seed entries**. New framework → new `rubric_defs` doc, no code
   change.
2. **Rubrics reference the session's docs + images.** The judge loads the same uploaded material
   the tutor saw, via the existing offline artifact recipe: Firestore `parsed_documents`
   (`build_document_context(doc_id, mode="blocks")`) + the durable `activity_images` slot
   (`load_activity_image(...)`), joined to the session by `chat_sessions/{id}.documentIds`. No new
   store.
3. **Retroactive re-scoring over past sessions.** Every session a group ever produced is enumerable
   from BigQuery `chat_logs.aipla_chat_turn` (the `find_latest_session_id_for_group_bq` query minus
   its `LIMIT 1`); `summarize_session_bq(session_id)` reconstructs each transcript. A backfill runs
   any rubric version over that history.
4. **Prompt versioning + experiment → promote → live.** Rubrics are versioned. Draft versions run
   as experiments over history; a good version is **promoted** (marked live); every score records
   the exact `rubric_id@version` that produced it, so a researcher can always answer "which prompt
   generated this live score?" and keep iterating new versions in parallel.
5. **Metadata for later analysis.** Each run writes a `rubric_runs` provenance record (rubric id +
   version, session, group code, activity, model, scores, evidence partition, cost/latency,
   free-form `meta`), mirrored to BigQuery via the existing Cloud-Logging→BQ sink pattern so runs
   are queryable next to the turns they scored.
6. **Group-code addressing throughout.** Researchers pass `crisp-pebble-21`; the runner resolves
   code → session ids internally. Internal UUIDs never surface in the CLI, the API, or results.

**Reconciling "live" with the evidence-integrity rule.** These lenses stay **post-hoc**, at the 2.5
cadence — "promote to live" means *"this rubric version is the one applied to real student
sessions"* (as opposed to experimental scratch runs over test data), **not** a rolling live score.
The cost + evidence-integrity reasons the 2.5 note gives still forbid a live-cadenced competency
number.

## The five sources, one line each

| Source | What it gives us | License |
|---|---|---|
| Docktor et al. 2016 (MAPS) | 5-category problem-solving rubric, 0–5 + two NA codes, complete in the paper | CC-BY — embeddable in prompts/products with attribution |
| Kohl & Finkelstein 2005 + supplemental | Four-format isomorphic item design with mapped distractors; 28-rendering seed bank | CC-BY (confirm 2005-volume status before verbatim item reuse) |
| Etkina et al. 2006 (SAAR) | 0–3 scientific-abilities rubrics; scored *transcripts* in the original validation | Open access; quote-with-citation fine, wholesale republish needs a check |
| PLIC (PhysPort) | Lab critical-thinking pre/post, HS-listed | Runs via Cornell's own Qualtrics pipeline — **not embeddable** |
| PhysPort listings | CLASS/EBAPS shortlisted for pre/post attitudes | Verified-educator gated; **items never ship in-app** |

## Design

### The evidence-integrity rule (applies to every lens below)

MAPS' authors are explicit: prompts that decompose a problem for the student "impede the
assessment of problem-solving skills by generating NA scores, especially in Logical Progression."
**An AI tutor is a scaffolding machine — it systematically destroys the evidence a competency
rubric needs.** So the judge never scores the guided conversation as if it were the student's
work. Scorable artifacts, in order of evidence quality:

1. **SUBMIT-1 uploads** — photographed handwritten solutions + whiteboard sketches (already in
   session events; the premium artifact, equivalent to the written solutions MAPS was validated on).
2. **Student-initiated turns** — the student's own predictions/explanations *before* a tutor hint
   on that step. The judge partitions the transcript: student-initiated vs tutor-prompted; only
   the former carries competency evidence. (Encouragingly, MAPS' own validation found dialogue
   *adds* evidence — it converts NA(solver) into real scores and exposes hidden bad reasoning —
   so transcripts are a better artifact than paper, *if* partitioned honestly.)
3. Tutor-prompted turns — context only, never scored as competence.

### Lens C — MAPS problem-solving judge (extends 2.5's Lens A/B stack)

- **Rubric:** the five categories verbatim (Useful Description, Physics Approach, Specific
  Application of Physics, Mathematical Procedures, Logical Progression), 0–5 + NA(problem) +
  NA(solver), plus the consistency rule (an early error used consistently is not re-penalized).
  CC-BY: the full Table I text goes straight into the judge prompt with attribution.
- **Calibration is the whole game.** Human raters only reached research-grade agreement
  (κ 0.94) after agreeing problem-specific criteria on anchor solutions; minimally-trained raters
  scored κ ≈ 0.32 with Mathematical Procedures and Logical Progression *not significant*. The
  LLM analog: a **per-activity anchor pack** — ~5 scored example solutions with rationales
  (including NA(solver) cases), authored by AR/JB, stored with the activity config, injected as
  few-shot context. No anchor pack → the lens reports "uncalibrated" and withholds scores.
- **Judge discipline:** the rubric scores *process*, not answers ("expert problem solvers…
  generate an incorrect answer a significant fraction of the time") — the prompt must resist
  correct-answer bias. Output is the category profile, teacher-facing in the paper's own
  instructional pattern: *"strong Physics Approach, weak Specific Application → target applying
  principles to specific situations, not re-teaching concepts."* Per-group only (ADR-001).

### Lens D — SAAR inquiry judge (labs + the design-your-own-agent activity)

- **Rubric:** Etkina's 0–3 scale (missing / inadequate / needs improvement / adequate), scoped
  initially to the **testing-experiment** rubric (Appendix A items 1–8). The original validation
  scored written lab transcripts line-by-line against these rows — literally this workflow.
  Tables X/XI of the paper are complete graded student transcripts: paste-ready few-shot
  calibration (Student B — the confirmation-bias design scoring 1 — is the canonical negative).
- **The agent-design activity (AR's suggestion #3) maps 1:1:** the student's agent config/prompt
  is the *hypothesis + procedure*; running it against test cases is the *experiment*; the key
  criterion is designing test cases that could **refute** the agent, not confirm it. New activity
  template: state what your agent should do → design refutation tests → run → judge from results
  → identify assumptions.
- **Three experiment types** (observational / testing / application) become lab-activity
  templates for the hybrid-lab strand.
- **Deferred, logged as a sim requirement:** the uncertainty subabilities (identify/evaluate/
  minimize experimental uncertainty) are unscoreable against noiseless sims — they need noise
  injection + enforced equipment lists. Even in physical labs students didn't gain here without
  dedicated exercises; not v1.

### Four-format quiz template (input to TAA M2)

Kohl's design, adopted as the authoring pattern: one concept, canonical wrong answers written
*first*, then stem + options rendered in all four formats (verbal / mathematical / graphical /
pictorial) with **distractors mapped 1:1 across formats**. The authoring co-pilot generates the
three missing formats from a teacher's single item (figure regeneration included — AR's
artefact-generation pattern). Three findings become rules:

- **Assign formats, don't offer choice** — students choose badly (90% → 13% swings by topic);
  balanced performance under random assignment is itself the instructional outcome to aim for.
- **Mastery needs ≥2 formats** — single-format success is a documented false positive; the
  mastery model (and the living-concept-map checkoffs) should require two.
- **The distractor is the diagnostic** — which mapped distractor, in which format, feeds
  straight into Lens B's misconception signal. No new pipeline: quiz responses already land in
  session events.

The Kohl supplemental's mechanics families (energy, springs, pendulum) are the seed bank —
stx-B / CBSE Class 11 aligned; Bohr/spectroscopy/wave-optics families cover CBSE Class 12.

### Misconception index (un-gated enrichment of 2.5 Lens B)

AR's Drive corpus (~320 papers, organized Fysik A/B/C → topic; archived in the scoping site) is
a literature-grounded source for the per-skill `misconceptions.yaml` files 2.5 already specifies.
Extraction pass: per curriculum topic → documented misconception → linguistic signature →
canonical distractor → source citation. This materially widens Lens B beyond FCI's
Newtonian-mechanics ceiling — the corpus covers optics, thermal, EM circuits, waves (the
LED-Planck quantum gap remains open; QMCS et al. still the candidates). The corpus itself is
private (shadow-library copies present); the derived index is original curation and shippable.

### Research instruments — explicitly out of the app

PLIC runs through Cornell's Qualtrics pipeline around lab activities; CLASS (top pick: gold-star,
HS-listed, 8–10 min, works in English for the DK/CBSE cohort) and possibly EBAPS as pre/post
around tutor use — official channels or a locked-down survey. **No PhysPort-gated instrument
items in the repo, the app bundle, or prompts.** No Danish translations exist; contributing one
is a JB/AR decision, not an app task.

### Where it lives in the architecture

**Compute — `backend/analytics/session_rubric.py` (new).** A rubric *registry* + *runner*:

- `run_rubric(target, rubric_id, version=None, *, live=False)` — `target` is a **group code** or a
  session id. Resolution: group code → session ids via BigQuery (`find_latest_session_id_for_group_bq`,
  or its `LIMIT`-less form for backfill); each session → transcript via `summarize_session_bq`.
  Doc/image evidence loaded via the offline artifact recipe (requirement 2 above). One judged call
  per rubric per session, cached (the `reports/narrative.py` on-demand-and-cached pattern). Writes
  one `rubric_runs` record per (session, rubric, version).
- Seed rubrics registered at boot: ICAP (Lens A), FCI/misconceptions (Lens B), MAPS (Lens C),
  SAAR (Lens D). These are *data*, not classes — inserted into `rubric_defs` if absent.

**Data model (new Firestore collections + a BQ mirror):**

| Store | Key | Holds |
|---|---|---|
| `rubric_defs/{rubric_id}` | rubric id | name, description, free-form `family` tag, `current_live_version`, `latest_version`, `meta` |
| `rubric_defs/{id}/versions/{n}` | version int | the judge **prompt** (free-form — this is the framework), optional output schema, anchor-pack ref, judge `model`, evidence-partition config, `status` = draft \| live \| retired, author, notes |
| `rubric_runs/{run_id}` | run id | `rubric_id`, `rubric_version`, `session_id`, `group_id` (code), `activity_id`, `model`, `scores` (free-form JSON profile), `evidence_partition` (audit), `is_live`, cost/latency, `created_at`, `meta` — **this is the provenance record** |

The `rubric_runs` record is mirrored to BigQuery `chat_logs` via a new `aipla_rubric_run` log id
(the same Cloud-Logging→BQ sink that already feeds `aipla_chat_turn`), so run metadata is queryable
next to the turns it scored. Anchor packs continue to ride the existing activity-config storage.

**Experiment → promote → live lifecycle.** Draft versions score over history (backfill) into
`rubric_runs` with `is_live=false`; a curator promotes a version (`current_live_version` ← n,
version `status` ← live); real student-session scoring reads `current_live_version` and stamps
`is_live=true` + the exact version onto every run. New versions keep iterating in parallel without
disturbing the promoted one. (Post-hoc throughout — see the reconciliation note above.)

**Inputs:** all native — SUBMIT-1 images and turns are already in ADK session events / the BQ
stream (1.2); docs/images via `parsed_documents` + the durable `activity_images` slot. No new
*student* transport, store, or callback (the 1.1.7 lesson) — the new stores are researcher-facing.

**Storage/read:** rubric results in `rubric_runs` (and alongside `ChatSessionIndex` for the report
join) → the 2.5 report panels; the live dashboard (1.1.31) does **not** consume these lenses.

**Standards check (Axiom 6):** the platform is *config over code* — adopting published instruments
(MAPS, SAAR, Kohl) as seed data rather than a bespoke taxonomy. Custom surface is the rubric-def /
run schema + anchor-pack YAML — thin metadata over cited sources.

### CLI surface

Judge iteration shouldn't need a deployed session, and researchers only ever type **group codes**:

- `aitana rubric score <group-code|session-id> --rubric <id>[@<version>]` — runs the judge against
  captured session data (group code → its latest session; a specific session id also accepted),
  prints the score profile + the evidence partition, writes a `rubric_runs` record. `--rubric`
  defaults to the live version.
- `aitana rubric backfill <group-code> --rubric <id>[@<version>]` — retroactive re-score across
  **every** past session for the group (the `LIMIT`-less enumeration); the experimentation workhorse.
- `aitana rubric list` / `aitana rubric versions <id>` — inspect registered rubrics and versions.
- `aitana rubric promote <id>@<version>` — mark a version live (sets `current_live_version`).
- `aitana rubric anchors validate <activity-id>` — lints an anchor pack (≥5 anchors, NA(solver)
  example present).

Position under the existing `aitana` tree ([local-dev-cli.md](../../v6.1.0/local-dev-cli.md)).
Free-form rubric authoring (create/edit a `rubric_defs` version) is CLI + file first
(`aitana rubric new <id>` scaffolds a prompt file); a teacher/researcher UI is out of M0 scope.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Post-hoc only; nothing blocks a live surface on a judge call. |
| 2 | EARNED TRUST | +1 | Scores are grounded in cited, published rubrics with per-activity human-authored anchors; "uncalibrated → no score" beats a confident fabrication; teacher UI marks AI-scored + links evidence. |
| 3 | SKILLS, NOT FEATURES | +1 | Lenses are config-shaped (registry + anchor packs), reusable across every activity; the agent-design activity is a new activity *type*, not a bolt-on. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Deterministic partition first; one judged call per lens per session, cached; Flash-class models suffice for ICAP, judge lenses can use a stronger model where reasoning is needed. |
| 5 | GRACEFUL DEGRADATION | +1 | No anchor pack → lens abstains; judge failure → 2.5's other panels render; quiz template degrades to single-format items. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Adopts published standards (MAPS/SAAR/Kohl) instead of a bespoke taxonomy; artifacts ride AG-UI/ADK native transport. |
| 7 | API FIRST | +1 | Rides the 2.5 score endpoint contract; CLI reads the same path. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Per-lens cost/latency in the cost spans; judge-vs-anchor agreement is itself a tracked metric (drift detection). |
| 9 | SECURE BY CONSTRUCTION | 0 | Group-level only (ADR-001); no new data class; PhysPort item-security honored by exclusion. Neutral. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | All scoring server-side; client renders profiles. |
| 11 | USABLE BY DESIGN | +1 | Teacher sees plain-language category profiles with the paper's own "what to do next" framing, never raw rubric jargon; abstain states designed. |
| | **Net Score** | **+10** | Threshold ≥ +4. No −1 scores. |

## Milestone phasing

| MS | Deliverable | Est | Gate |
|---|---|---|---|
| **M0** | **Rubric platform primitives, offline.** `session_rubric.py` registry + runner; `rubric_defs`/`versions`/`rubric_runs` stores; **group-code addressing** (code → sessions via BQ); doc/image evidence loader; **MAPS as the first seed judge** with evidence partition; run against captured pilot-test sessions (eval-style, no UI). Includes the `score` + `backfill` + `list`/`promote` CLI. | ~3–4d | none (offline) |
| **M0.5** | **Prompt versioning + provenance + retroactive backfill.** Version lifecycle (draft/live/retired), promote, `is_live` stamping; `rubric_runs` → BigQuery mirror (`aipla_rubric_run`); backfill a rubric across a group's full history and query the runs in BQ. | ~1–1.5d | none (offline) |
| **M1** | **Anchor packs** for 2–3 live activities (Boldkast, KineBot, one TAA-authored). Judge-vs-anchor agreement reported. | ~2–3 ped-days | AR/JB authoring |
| **M2** | **SAAR agent-design activity** — template + SAAR seed rubric (testing-experiment rows, Tables X/XI few-shot). | ~2d | none (new activity type; teacher opt-in) |
| **M3** | **Four-format quiz template in TAA M2** — co-pilot format generation + mapped-distractor authoring + ≥2-format mastery rule. | +1d on TAA M2 | TAA M2 (JB/AR teaching framework) |
| **M4** | **Misconception index pipeline** — extraction pass over the corpus → per-skill `misconceptions.yaml` provisioning. | ~2d | none (corpus archived) |
| **M5** | **Teacher-facing surfacing** of Lens C/D profiles in the 2.5 report panels (and only there). | ~1d | **R1** + 2.5 R5/R6 |

## Acceptance

- [ ] (M0) A researcher runs `aitana rubric score crisp-pebble-21 --rubric maps` — a **group code**,
  never an internal id — and gets a score profile; the runner resolved the code → session(s) via BQ.
- [ ] (M0) A new framework can be added as a `rubric_defs` entry (prompt + metadata) and scored with
  **no code change**; the runner is not hardcoded to MAPS/SAAR.
- [ ] (M0) The judge can reference a session's uploaded documents/images (the same material the tutor saw).
- [ ] (M0.5) A rubric has ≥2 versions; every `rubric_runs` record stamps the exact `rubric_id@version`
  and `is_live`; promoting a version changes which one live scoring uses without disturbing drafts.
- [ ] (M0.5) `aitana rubric backfill <group-code>` re-scores every past session for the group; the runs
  are queryable in BigQuery `chat_logs.aipla_rubric_run` for later analysis.
- [ ] (M0) The MAPS judge scores a captured session's SUBMIT-1 artifact + partitioned turns into
  the five-category profile with NA codes; tutor-prompted turns demonstrably excluded from
  evidence; without an anchor pack the lens abstains.
- [ ] (M1) On anchored activities, judge-vs-anchor agreement is reported per category; Math
  Procedures + Logical Progression (the known-weak categories) get extra anchors before any
  teacher exposure.
- [ ] (M2) A student can run the agent-design activity end-to-end; the SAAR judge distinguishes
  a refutation-oriented test design (3) from a confirmation-oriented one (1).
- [ ] (M3) A teacher authors one quiz item; the co-pilot proposes the other three formats with
  mapped distractors; mastery requires ≥2 formats; distractor choice lands in the misconception
  signal.
- [ ] (M4) ≥3 skills have literature-grounded `misconceptions.yaml` entries citing the corpus.
- [ ] No PhysPort-gated instrument items anywhere in the repo or bundle; MAPS/SAAR text carries
  attribution; nothing from the private corpus is republished.
- [ ] No teacher-facing rubric vocabulary ships before R1 (M5 is the only R1-gated milestone).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Judge scores treated as ground truth by teachers | Medium | Abstain-without-anchors; agreement metric surfaced; "AI-scored — verify in log" affordance (same discipline as 2.5). |
| Anchor authoring stalls on AR/JB bandwidth (like the TAA teaching-framework gate) | Medium | M0 ships offline against test sessions; anchor packs are per-activity incremental, not a big-bang. |
| Evidence partition mislabels tutor-prompted work as student-initiated | Medium | Deterministic-first partition (turn adjacency to tutor hints), judged only at the margins; partition shown in the CLI output for audit. |
| The layer re-opens the R1 debate instead of feeding it | Low | The doc's framing is explicit: composes with either stack; JB/AR still own the pick. |
| License slip (Kohl 2005 verbatim items; SAAR wholesale republication) | Low | Confirm the 2005-volume CC status before verbatim reuse; design-pattern reuse is unrestricted; attribution baked into prompts. |

## Related documents

- [2.5 session-analytics-rubric](../post-pilot/session-analytics-rubric.md) — the lens stack +
  R1 comparison this extends (Lens A/B → + C/D)
- [teacher-analytics-framework.md](teacher-analytics-framework.md) (1.1.31) — the live surface;
  explicitly does **not** consume these lenses
- [`backend/analytics/live_framework.py`](../../../../backend/analytics/live_framework.py) — the
  swappable-framework pattern (live layer stays v0 until R1)
- [student-multimodal-upload.md](student-multimodal-upload.md) / SUBMIT-1 — the artifact source
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — M2 quiz milestone (M3 here)
- [living-concept-map.md](living-concept-map.md) — consumer of the ≥2-format mastery rule
- [1.K dra-activity-framework.md](../v1.0.0-pilot/dra-activity-framework.md) — sibling vocabulary
  (representation coverage; Kohl's four formats are the item-level counterpart)
- Scoping-site audit: [`notes/2026-07-10-aswin-competency-sources-audit.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-07-10-aswin-competency-sources-audit.md)

## Sources

- Docktor et al. (2016). *Assessing student written problem solutions: A problem-solving rubric
  with application to introductory physics.* PRPER 12, 010130. DOI: 10.1103/PhysRevPhysEducRes.12.010130 (CC-BY)
- Kohl & Finkelstein (2005). *Student representational competence and self-assessment when
  solving physics problems.* PRST-PER 1, 010104 + supplemental. DOI: 10.1103/PhysRevSTPER.1.010104
- Etkina et al. (2006). *Scientific abilities and their assessment.* PRST-PER 2, 020103.
  DOI: 10.1103/PhysRevSTPER.2.020103
- PLIC — physport.org/assessments/assessment.cfm?A=PLIC (Cornell PER Lab)
- PhysPort assessment listings (reasoning: Focus=135,138; attitudes: Focus=140)
- All archived with extractions in scoping-site `sources/aswin-competencies-2026-06-29/`
