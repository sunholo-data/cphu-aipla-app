# Session analytics — pedagogical rubrics for AIPLA chat logs

**Status:** **Committed v1 — promoted 2026-05-28** (teacher monitoring + analysis raised above original scope; must be live *for* the pilot). The *framework pick* remains the open decision — see R1 below.
**Target:** v1.0.0-pilot (live for the 2026-08-14 pilot). Gated on **1.2 [chat-log-pipeline](../v1.0.0-pilot/chat-log-pipeline.md)** shipping the BigQuery sink first, and on the JB/AR framework pick (R1) being locked **before the 2026-06-29 holiday freeze**.

> **Framework reconciliation (2026-05-28):** the parent [SEQUENCE row 2.5](../SEQUENCE.md) previously named **CPS + DRA** as the "confirmed starter" while this doc's *Recommended initial build* (below) argues for **ICAP + FCI**. Neither is confirmed yet — that contradiction *is* the R1 decision. Two candidate stacks are on the table: **(a) ICAP + FCI** (this doc's eng-lightest recommendation) and **(b) CPS + DRA** (JB's CoLA video-assessment lineage + the [1.K](../v1.0.0-pilot/dra-activity-framework.md) DRA maps). The framework comparison below is the *input* to R1, not its resolution. JB/AR own the pick.
**Audience:** Pedagogical leads (JB, AR) own the framework choice. Engineering owns the implementation once the framework is picked.
**Scope question:** *"AIPLA already captures every chat turn + workbench event. What framework do we apply to those raw logs so the teacher dashboard shows something pedagogically meaningful — not just message counts?"*
**Created:** 2026-05-25
**Last Updated:** 2026-05-25

## Why this exists

The Phase 2 teacher UI already renders session reports with surface metrics (duration, message count, sim runs, conversation log). That's *what happened*. It does not yet tell the teacher *what the student learned* or *where they struggled*. The gap between *raw activity data* and *pedagogically meaningful signal* is exactly where a rubric framework lives.

Three frameworks dominate the physics-education-research (PER) literature and are well-suited to AIPLA's data shape (conversation log + workbench state + checklist progress + sim-run telemetry). This doc summarises each, compares them, and proposes a minimum viable rubric that combines two of them. **The pedagogical decision** — *which rubric(s), which thresholds, which misconceptions matter most* — sits with JB and AR. **The engineering decision** — *how to label turns, where the analysis runs, what gets stored* — sits with the AIPLA team once the framework is picked.

## What AIPLA already captures (the raw input)

Every session yields, per group:

- **Conversation log:** ordered list of `{ timestamp, role: "student" | "tutor", content }` from ADK session events (today in-memory; 1.2 pipelines to BigQuery for research-scale analysis).
- **Workbench state writes:** `mcp_app_context.{server}.{tool}` keys whenever a student manipulates an artefact iframe (slider drag, button click, value change). Already a structured event stream.
- **Sim-run telemetry:** the `sim_run_count` aggregate in `SessionSummary` (counted from distinct `mcp_app_context.*` keys; will become per-event in 1.2).
- **Checklist progress:** which self-assessment steps the student ticked off (today in mock data; v1.1 stores per-session).
- **Topic / teacher-focus context:** the active `ActivityConfig.teaching_goal` for the session — what the teacher told the tutor to emphasise.
- **Skill identity:** Boldkast / LED Planck / KineBot / etc. — narrows the relevant misconception taxonomy.

This is enough raw input for any of the three frameworks below. None require new instrumentation; they require a *labelling layer* (post-hoc analysis of stored data) and a UI surface to display the results.

## Three candidate frameworks

### Framework A — ICAP (Chi & Wylie 2014): engagement quality

**What it is:** A four-mode classification of cognitive engagement, ordered by depth. Each student utterance / action gets one label.

| Mode | Definition | What it looks like in AIPLA data |
|---|---|---|
| **Passive** | Receives without processing | Long pauses; no follow-up after a tutor message; one-word acknowledgements |
| **Active** | Manipulates given info, no novel output | Drags a slider, clicks "launch", picks an answer from a list, asks for repetition |
| **Constructive** | Produces something new — prediction, explanation, hypothesis | Student turn with hedge words ("I think…", "because…"), self-explanation |
| **Interactive** | Builds on the tutor's reasoning, refines, counter-questions | Question that builds on the tutor's previous question; "but what if…" |

**Hypothesis:** higher engagement modes → more durable learning. Strongest predictor in the meta-analysis literature is *constructive* + *interactive* together vs *passive* alone.

**Detection signals from AIPLA data:**
- Activity counts (`mcp_app_context.*` writes per turn) flag Active
- Student turn length + presence of causal language ("because", "since", "I think", "fordi" in Danish) flag Constructive
- Question-after-tutor-question patterns + "but what if" / "men hvad nu hvis" flag Interactive
- Long pauses or short receipts ("ok", "ja") flag Passive

**Output shape:** label per student turn → aggregate to a per-session histogram (e.g. *"22% passive, 41% active, 28% constructive, 9% interactive"*). Display as a stacked bar on the report screen.

**Recent work:** an [ACL 2025 paper specifically applied ICAP to GenAI tutor conversations](https://aclanthology.org/2025.aimecon-wip.6.pdf) using LLM-as-judge labelling; reported usable inter-rater agreement. So the labelling step is plausibly automatable today with a small LLM call per N turns.

**Pros:**
- Domain-agnostic — works for any subject, any artefact
- Cheap to compute — short LLM call or even a heuristic per turn
- Directly maps to existing AIPLA data; no schema change needed
- Output is intuitive for non-researchers: "your students were mostly active but rarely constructive — try asking more 'why' questions"

**Cons:**
- Generic — doesn't tell the teacher *what physics concept* was at stake
- Labelling is noisy on short turns; needs N≥10 turns per session for stable aggregates
- Doesn't catch off-topic / misconception content directly — engagement could be high *and* wrong
- The "Interactive" mode is rare even in good sessions (researchers report ~10-20% typical)

### Framework B — FCI misconceptions taxonomy (Hestenes et al.): concept tracking

**What it is:** The Force Concept Inventory is a multiple-choice test, but its *taxonomy* of named misconceptions is a free gift. Each of ~30 wrong answers maps to a labelled misconception with a linguistic / behavioural signature.

**Sample categories (selected — full list at the PhysPort link in Sources):**

| Misconception | Linguistic signature | Where it shows up in Boldkast |
|---|---|---|
| `velocity-proportional-to-force` | "if I push harder it goes faster" | Predicts higher launch speed → higher angle range |
| `motion-implies-active-force` | "what's pushing it now?" mid-flight | Asks where the force is during free fall |
| `impetus-dissipation` | "it loses its energy" / "loses momentum" | Mistakes air-resistance-free range for damped |
| `position-velocity-undiscriminated` | confuses *where* with *how fast* | Treats x(t) and v(t) graphs as the same |
| `gravitational-mass-dependence` | "heavier falls faster" | Predicts different ranges for different-mass projectiles |
| `vector-composition-nonvectorial` | "the horizontal and vertical parts cancel out" | Misunderstands independence of vx and vy |
| `circular-impetus` | "it has the urge to keep curving" | Comes up more in pendulum/circular, less in Boldkast |

**Detection signals from AIPLA data:**
- Keyword + regex matching on canonical phrases (cheap, high-precision)
- LLM-as-judge on each student turn against the taxonomy (broader recall, costs ~one call per turn or per session)
- Hybrid: regex catches the easy ones, LLM resolves ambiguous cases

**Output shape:** per-session list of detected misconceptions with sample quotes and counts. The session-report screen gains a *"Common misconceptions surfaced"* panel listing each match with a click-to-quote-context affordance.

**Pros:**
- Physics-specific — directly relevant to Boldkast / KineBot / LED Planck cohorts
- Pre-existing taxonomy = no new pedagogical research needed
- High-leverage for teachers: *"4 of 6 groups showed `velocity-proportional-to-force` this week — worth a class-wide discussion next session"*
- Researcher-friendly — feeds straight into longitudinal misconception-tracking studies
- Some misconceptions are catchable by static text patterns (cheap)

**Cons:**
- Built for **Newtonian mechanics**. KineBot fits; LED Planck (quantum / Planck constant) does **not** — needs a separate taxonomy (e.g. quantum-concept inventories, see Sources below). Future skills may need their own taxonomies.
- Naming is technical — teacher UI needs to translate `velocity-proportional-to-force` into plain Danish before display
- Misconceptions are sometimes *productive* mid-conversation (a student articulates a misconception → tutor scaffolds away from it). Surfacing them without context can punish good Socratic sessions
- LLM-as-judge has error modes — may flag false positives that look like the misconception verbatim but are actually the student *quoting* one to be corrected

### Framework C — NGSS Three-Dimensional Learning (3D-LAP): structured competency rubric

**What it is:** The Next Generation Science Standards (US) define every assessable outcome along three axes:

- **Disciplinary Core Idea (DCI):** *which physics concept* (projectile motion, energy conservation, quantum behaviour)
- **Science/Engineering Practice (SEP):** *what scientific behaviour* (predict, model, analyze data, construct explanation, evaluate evidence, communicate)
- **Crosscutting Concept (CCC):** *what overarching pattern* (cause-and-effect, scale, systems-thinking, patterns, energy flow)

A 3D-LAP-scored session would say: *"this group practiced **predicting** (SEP) the **range of a projectile** (DCI) using **cause-and-effect reasoning** (CCC), demonstrating mid-level mastery."*

**Detection signals from AIPLA data:**
- DCI: largely fixed per skill (Boldkast = projectile motion; multiple sub-concepts can be tagged via the teaching-goal + sim-runs)
- SEP: detectable from student utterances + workbench actions ("Did the student make a prediction before launching?" — yes if a prediction-language utterance precedes a sim run)
- CCC: highest LLM lift — requires reasoning about whether the conversation invoked cross-disciplinary thinking

**Output shape:** a 3-axis chart on the report screen (DCIs covered, SEPs practiced, CCCs invoked) plus per-group performance against expected outcomes the teacher set in the activity config. A 2022 [Frontiers paper](https://www.frontiersin.org/articles/10.3389/feduc.2022.983055/full) developed rubrics for AI-enabled scoring of 3D constructed-response assessments — direct precedent.

**Pros:**
- Research-respected — NGSS underpins most US K-12 physics assessment work
- Multi-dimensional output is richer than ICAP's single-axis engagement score
- Maps cleanly to the teaching goal: teacher sets *"I want them to predict and observe range vs angle"* → 3D-LAP scores against that exact target
- Aligns with the institutional reporting layer (next framework)

**Cons:**
- Heavier to wire up — three labels per session, taxonomy per axis, alignment to skill-specific DCIs
- US-centric — Danish stx + NCERT/CBSE curricula don't use NGSS by name, but the underlying competencies map well. UCPH would need to bless the DCI mapping per skill.
- More LLM tokens per analysis pass than ICAP or pure-regex FCI
- Best as v2 work after ICAP + FCI prove the analytics pipeline

### Framework D — PISA 2025 Science Framework (institutional-tier — for completeness)

OECD's PISA 2025 frames scientific literacy as three competencies: *explain phenomena scientifically*, *evaluate scientific enquiry*, *use scientific info for decisions*. Useful for **the UCPH-level "is AIPLA producing learning gains?" conversation** but too coarse for session-by-session teacher feedback. Mentioned here for completeness — Denmark participates in PISA, so the framework lands cleanly in institutional reporting. **Not recommended as the session-level rubric**; recommended as the framing for the eventual longitudinal-impact research report.

## Comparison table

| | **ICAP** (A) | **FCI taxonomy** (B) | **NGSS 3D-LAP** (C) | **PISA 2025** (D) |
|---|---|---|---|---|
| What it measures | How engaged | Which misconceptions | DCI / SEP / CCC trio | Three high-level competencies |
| Discipline | Any | Newtonian mechanics; needs adaptation for quantum | Any | Any |
| Granularity | Per-turn label, per-session histogram | Per-misconception count + quote | Per-axis label per session | Per-cohort, longitudinal |
| Build cost | Low — LLM-as-judge or heuristic | Low (regex-only) → Medium (LLM hybrid) | Medium-High | Low (research framing, not labelling code) |
| Teacher value | "Were they engaged constructively?" | "What did they get wrong?" | "What did they learn how to *do*?" | (Institutional only) |
| Research value | Engagement-learning correlation studies | Longitudinal misconception tracking | Multi-dim learning analytics | OECD-grade comparability |
| AIPLA fit | Highest — generic, cheap, fits data shape | High for Boldkast / KineBot; needs counterpart for LED Planck | Medium — heavier but richer | Low for session-level; high for institutional report |

## Recommended initial build

A two-lens stack — **ICAP + FCI taxonomy** — gives the teacher dashboard both engagement quality and concept tracking with the lightest possible engineering lift.

### Lens A — engagement (ICAP)

- One LLM call per session aggregating *all* student turns at once (cheaper than per-turn)
- Output: `{ passive_pct, active_pct, constructive_pct, interactive_pct, sample_turn_per_mode }`
- Display: stacked bar in the report screen's *"What the group did"* section, with plain-language interpretation ("mostly active — try asking more 'why' questions to lift them into constructive mode")

### Lens B — concept tracking (FCI taxonomy for Newtonian skills)

- Hybrid detector: regex sweep for canonical misconception phrases (cheap, high-precision), LLM-as-judge backstop for ambiguous turns
- Per-skill taxonomy file under `backend/skills/templates/<skill_id>/misconceptions.yaml` — FCI categories for Boldkast / KineBot, a parallel quantum-concept inventory for LED Planck (see Sources for candidates; pedagogical lead picks)
- Output: per-session list of `{ misconception_id, count, sample_quote, plain_da_name, plain_en_name }`
- Display: *"Common misconceptions surfaced"* panel on the report screen, with click-to-quote-context affordance
- Researcher value: aggregable across sessions for longitudinal studies (which misconceptions persist after how many sessions?)

### Where it lives in the architecture

- **Compute layer:** a `backend/analytics/session_rubric.py` module that consumes one `SessionSummary` (already exists from Phase 2) + the session events, produces a typed `SessionRubricResult` Pydantic model. One call per session, post-hoc (not in the hot path).
- **Trigger:** an analytics-side endpoint `POST /api/reports/sessions/{id}/score` that runs the rubric on demand, or a Cloud Scheduler job that scores newly-ended sessions overnight. Either is fine; the on-demand path keeps cost predictable.
- **Storage:** results land alongside `ChatSessionIndex` in Firestore (or BigQuery once 1.2 ships), so the report route reads pre-computed scores without re-running the rubric each visit.
- **Display:** extends the existing `/teacher/reports/groups/[groupId]` screen — adds two panels under "What the group did" without restructuring the page.

### What this does NOT need

- New protocol primitives — A2UI / MCP / AG-UI / MCP Apps all stay as-is
- New skill templates — the analysis is post-hoc on already-stored data
- Real-time changes to the student chat surface — the rubric runs after the session, not during

## Open questions (the JB / AR / M conversation)

1. **Which framework first?** The recommendation above is ICAP + FCI. Is JB happy with that pairing, or does AR think NGSS 3D-LAP is more aligned with the research outcomes UCPH wants to publish?
2. **Per-skill taxonomy ownership.** Who curates the misconceptions file for each skill — JB? AR? Per-school per-skill? Once curated, it's stable; the cost is the initial pedagogical pass.
3. **LED Planck and quantum.** FCI doesn't cover quantum / Planck concepts. Candidate replacements: the Quantum Mechanics Conceptual Survey (QMCS), Quantum Physics Inventory (QPI), or a bespoke AIPLA list authored by JB / AR. Decision required before LED Planck's analytics ship.
4. **Display in the teacher UI.** Add to the existing report screen, or a new "Insights" tab? My instinct is *add to existing screen* (less navigation, the data is intrinsically about that session) — but JB / AR may have a stronger view based on how Danish teachers actually read reports.
5. **Plain-language translation.** Every internal label (`velocity-proportional-to-force`) needs a plain Danish + English version for the teacher UI. Who writes those?
6. **Privacy / per-student vs per-group.** Per ADR-001, AIPLA is per-group anonymous. The rubric labels per-group too. Confirm nothing about the framework choice requires per-student data (ICAP and FCI both work at the conversation-aggregate level).
7. **False-positive handling.** When the LLM flags a misconception that's actually a teaching moment (student articulates it → tutor scaffolds away), do we surface it or hide it? Showing it gives the teacher fidelity; hiding it gives them a cleaner signal. The compromise: surface it with a *"resolved in conversation"* badge based on whether the tutor's next turn addresses the concept.
8. **Comparability across teachers.** If teacher A's class shows 8 surfaced misconceptions and teacher B's shows 3, what does that *mean*? Could mean teacher A's students engaged more deeply (better) or that teacher A's tutor prompt is leakier (worse). Research framing needs to set expectations before this lands in a teacher dashboard.

## Pros (for committing to a rubric layer at all)

- **Closes the gap between raw data and teacher value.** Today's report says *"34 messages, 8 sim runs"*. Tomorrow's says *"mostly active engagement, 4 of 6 groups confused velocity with force, two groups resolved the confusion mid-session."* That's the difference between *AIPLA logs data* and *AIPLA helps teachers teach better*.
- **Closes the research thesis.** The contract's outcome is *"does AI tutoring improve physics learning in stx?"* — without a rubric, you have message counts. With a rubric, you have engagement + concept-coverage signal aggregable across cohorts. PISA-grade reporting becomes plausible.
- **Composes well with the future Strand B (student-as-creator).** A student writing their own simulation gets analysed the same way — the rubric is the platform, the artefacts are the variables.
- **Zero student-side surface change.** Students don't see anything new; the work is entirely on the teacher side.
- **Cheap initial build.** Lens A (ICAP) + Lens B (FCI) together are ~1-2 weeks of work given the existing `SessionSummary` pipeline and the FCI taxonomy being free to use.

## Cons

- **More LLM cost.** A per-session LLM call is small individually but scales with session count. Estimate: ~$0.001-0.01 per session at current Gemini-Flash rates × pilot scale of ~10 teachers × 20 sessions/week = ~$2/week. Acceptable. Year-2 cohort scale changes the equation.
- **False confidence risk.** A teacher who sees *"4 of 6 groups confused velocity with force"* may treat it as ground truth. The detector is fallible. Need clear surface design that signals "AI-flagged — verify in conversation log".
- **Pedagogical-drift risk.** If the rubric output starts shaping how teachers write teaching goals (Goodhart's Law — teach to the metric), the research becomes self-confirming. Mitigation: don't tie any *teacher* compensation / performance review to rubric scores. Strictly a feedback tool.
- **Maintenance burden.** Each new skill needs its taxonomy. KineBot inherits the FCI mapping (kinematics overlap); LED Planck needs new work. Future Strand B / student-authored sims may not have any taxonomy at all.
- **Doesn't catch nuanced pedagogy.** A skilled tutor turn that re-frames a question subtly — neither ICAP nor FCI captures the craft. The rubric is a floor of insight, not a ceiling.

## Decision criteria — when do we commit?

Build this if **all three** are true:

1. **v1.0.0-pilot ships and runs.** Need real session data to validate the labelling before investing engineering time.
2. **1.2 chat-log-pipeline lands.** BigQuery sink is the right place for the analytics; running them off ADK session state directly is OK for the demo path but won't scale to cohort-research analysis.
3. **JB and AR approve a framework.** The pedagogical pick (ICAP + FCI vs. NGSS 3D-LAP vs. hybrid) must be made by people with deep PER expertise. Engineering can prototype any of them in a week, but the *right* one for AIPLA's research thesis isn't an engineering decision.

Skip / defer if **any** of:
- Pilot reveals a different bottleneck (e.g. UCPH wants institutional dashboards more than per-session feedback)
- A simpler signal (e.g. just *teacher reviews + comments on the conversation log directly*) gives teachers what they need — *"chat with the data"* via the analytics-chat skill (Phase 3) may obviate a structured rubric
- Cost of LLM-as-judge per session exceeds the value at pilot scale (re-evaluate after Lens A ships standalone)

## Suggested phasing if we commit

| Step | What | Pedagogical owner | Eng est |
|---|---|---|---|
| **R1** | Pedagogical lead picks the framework(s). One person-day of JB / AR's time | JB / AR | — |
| **R2** | Author the per-skill misconceptions YAML for Boldkast (+ KineBot, optionally) | JB / AR | — |
| **R3** | Implement `backend/analytics/session_rubric.py` with Lens A (ICAP) | Eng | 2 d |
| **R4** | Add Lens B (FCI keyword + LLM hybrid) | Eng | 2 d |
| **R5** | Wire the `POST /api/reports/sessions/{id}/score` endpoint + result storage | Eng | 1 d |
| **R6** | Extend `/teacher/reports/groups/[groupId]` UI with the two new panels | Eng | 1 d |
| **R7** | Plain-language label translation (Danish + English) | JB / AR | — |
| **R8** | Cohort-aggregation view (post-1.2, BigQuery-backed) | Eng | 2 d |
| | **Total eng + ped time** | | **~8 eng-days + ~3-4 ped-days** |

## Out of scope (for this doc; tracked elsewhere)

- The chat-log BigQuery sink itself — [SEQUENCE row 1.2](../SEQUENCE.md) `chat-log-pipeline.md`
- The analytics-chat teacher-facing skill ("chat to the data") — Phase 3 of [teacher-ui.md](../v1.0.0-pilot/teacher-ui.md) step 3.4
- Per-class budget surfacing UI — Phase 1.12
- Cross-cohort longitudinal studies design — Strand C scoping note (in the scoping site)

## Related

- [v1.0.0-pilot/teacher-ui.md](../v1.0.0-pilot/teacher-ui.md) — the report-screen surface this rubric would extend
- [post-pilot/teacher-artefact-parameters.md](teacher-artefact-parameters.md) — parallel post-pilot roadmap signal
- [post-pilot/teacher-artefact-authoring.md](teacher-artefact-authoring.md) — parallel post-pilot roadmap signal
- Top-level [SEQUENCE.md](../SEQUENCE.md) row 1.2 — `chat-log-pipeline.md` (the data layer this builds on)
- Top-level [SEQUENCE.md](../SEQUENCE.md) row 1.5 — `capability-floor-eval-runner.md` (the eval framework — orthogonal but related)
- ADR-001 (group anonymity), ADR-005 (chat log storage), ADR-008 (observability) — in the scoping site

## Sources (academic + research-programme references)

### ICAP framework

- Chi, M. T. H., & Wylie, R. (2014). *The ICAP framework: Linking cognitive engagement to active learning outcomes.* Educational Psychologist, 49(4). [tandfonline.com](https://www.tandfonline.com/doi/abs/10.1080/00461520.2014.965823)
- Chi & Boucher (2023). *Applying the ICAP Framework to Improve Classroom Learning.* UNH Teaching & Learning Resource Hub. [unh.edu PDF](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-05/itow-applying-the-icap-framework-to-improve-classroom-learning-chi-boucher.pdf)
- *Cognitive Engagement in GenAI Tutor Conversations.* ACL Anthology 2025. [aclanthology.org](https://aclanthology.org/2025.aimecon-wip.6.pdf) — recent application of ICAP to LLM-tutor conversations.
- *Putting ICAP to the test.* PMC 2024. [pmc.ncbi.nlm.nih.gov](https://pmc.ncbi.nlm.nih.gov/articles/PMC11250844/)
- *Questioning central assumptions of the ICAP framework.* PMC 2023. [pmc.ncbi.nlm.nih.gov](https://pmc.ncbi.nlm.nih.gov/articles/PMC10652002/) — useful caveats.

### Force Concept Inventory + misconceptions taxonomy

- *Force Concept Inventory — PhysPort.* [physport.org](https://www.physport.org/assessments/FCI) — canonical hub; access to the instrument requires educator verification.
- Hestenes, Wells, Swackhamer (1992). *The Force Concept Inventory.* The Physics Teacher. The original taxonomy.
- *The FCI* — chapter 4 of UMD PERG dissertation by Saul. [physics.umd.edu PDF](https://physics.umd.edu/perg/dissertations/Saul/Chapter4.PDF)
- *Exploration of Students' Misconceptions in Mechanics using the FCI.* sciepub. [pubs.sciepub.com](https://pubs.sciepub.com/education/3/2/2/) — concrete misconception examples.
- *Exploring the Structure of Misconceptions in the FCI with Modified Module Analysis.* arXiv 2019. [arxiv.org PDF](https://arxiv.org/pdf/1905.06176)

### NGSS 3D learning + assessment protocols

- *EQuIP Rubric for Science Lessons & Units.* NextGenScience. [nextgenscience.org PDF](https://www.nextgenscience.org/sites/default/files/EQuIP%20Rubric%20for%20Science%20v3.1_2.pdf)
- *Characterizing College Science Assessments: The Three-Dimensional Learning Assessment Protocol (3D-LAP).* PLOS One. [journals.plos.org](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0162333)
- *Rubric development for AI-enabled scoring of three-dimensional constructed-response assessment aligned to NGSS.* Frontiers in Education, 2022. [frontiersin.org](https://www.frontiersin.org/articles/10.3389/feduc.2022.983055/full) — closest published precedent for what AIPLA could automate.

### PISA 2025 Science Framework

- *PISA 2025 Science Framework.* OECD. [pisa-framework.oecd.org](https://pisa-framework.oecd.org/science-2025/) and [Second Draft PDF](https://pisa-framework.oecd.org/science-2025/assets/docs/PISA_2025_Science_Framework.pdf)

### Quantum-physics concept inventories (for LED Planck — if FCI replacement needed)

- Singh, C. & Marshman, E. *Review of student difficulties in quantum mechanics.* Physical Review Special Topics. (Survey of available QM concept inventories.)
- Wuttiprom et al. *Development and use of a conceptual survey in introductory quantum physics.* Int. J. Sci. Educ. 2009.
- McKagan et al. *Quantum Mechanics Conceptual Survey (QMCS).* PhysPort. [physport.org](https://www.physport.org/assessments/QMCS)

### Recent work on AI-tutor evaluation (context)

- *Creating a customisable Socratic AI physics tutor.* arXiv 2507.05795 / IOPscience 2025. [arxiv.org](https://arxiv.org/abs/2507.05795) — design + evaluation patterns for Gemini-Gems-based Socratic tutors.
- *Analyzing Undergraduate Problem-Solving in Physics Through Interaction With an AI Chatbot.* arXiv 2508.14778. [arxiv.org PDF](https://arxiv.org/pdf/2508.14778)
- *NotebookLM as a Socratic physics tutor.* arXiv 2504.09720. [arxiv.org](https://arxiv.org/html/2504.09720v3)
