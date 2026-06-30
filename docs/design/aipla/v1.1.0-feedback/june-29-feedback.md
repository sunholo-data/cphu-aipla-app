# 29 June feedback — repo-side disposition map

**Status:** Triaged — raw capture preserved verbatim below
**Last updated:** 2026-06-29
**Nature:** **Strand C–dominant.** This lands the day the holiday freeze opens (2026-06-29 → 07-05), just after the 26 June mid-point review, and reads like a research/scoping session (JB/AR + researchers): a **theoretical-framework layer** (embodied cognition → resources framework), a **research-design layer** (social networks, baseline/longitudinal, causal inference without RCTs), plus a few execution-relevant threads. The Strand C material belongs in the scoping site's Strand C; this map records each item's destination so nothing is silently dropped.

> **Why this file exists.** The scoping site holds the pedagogical/product truth; this repo holds the *execution* layer. 29 June is even more Strand-C-heavy than 23 June — most of it is *how the research is framed and instrumented* (embodied-cognition theory, social-network analysis, quasi-experimental design, video coding), which is Strand C, not Strand A execution. A handful of items touch the roadmap. This map sorts them; the verbatim notes follow. Authoritative sequencing stays in [SEQUENCE.md](SEQUENCE.md).

## Disposition map

| 29-June item | Type | Disposition |
|---|---|---|
| AI solves problems by a **different method** than the student is meant to use (formulae vs energy); "what does the student need to do vs the AI"; "the AI uses the wrong method — how does it do it in a more beneficial/correct way"; automate the solve + expose the reasons | **Design principle (recorded)** | A **method-fidelity** concern: the tutor can reach the answer by a non-intended route (energy conservation) when the activity wants the intended route (kinematics), which is unhelpful. **Decision (M, 29 June): record as a principle only** — no teaching-framework edit and no new authoring control now. Sits alongside [tutor-personas.md](tutor-personas.md) (1.1.20) + [authoring-teaching-framework.md](authoring-teaching-framework.md) as context; revisit a per-activity "intended solution method" control only if it recurs. |
| "AI is **performative**; the AI needs to **guide** the student, not perform/solve" | Design principle | Reaffirms the guide-not-solve / Socratic stance already encoded in 1.1.1 verbosity + 1.1.20 personas + the teaching framework. No new build — a steer the framework should make explicit. |
| **Danish textbook physics** — add as "the standard Danish way of doing things" | **Curriculum content task** | **Decision (M, 29 June): pursue clearance + ingest into [curriculum-library.md](curriculum-library.md)** (1.1.25) so the tutor grounds in the standard Danish method. **Source (M, 29 June): free-to-use maths + physics textbooks at [mathematicus.dk](https://mathematicus.dk/) — physics at [mathematicus.dk/fysik](https://mathematicus.dk/fysik/)** (M has used these; PDFs attached to his email). "Free-to-use" **de-risks the clearance gate** — this is a *licence-terms check* (does the free-to-use licence permit corpus ingestion + redistribution to students?), not the full copyright clearance the cleared A-level set needed. Residual gate: confirm licence; then AILANG-Parse ingest into the A/B/C taxonomy. Couples to the method-fidelity principle above. |
| "research lags way behind the current edge" | Research observation / strategy | Strand C / positioning. To JB/AR. No app task. |
| **Theoretical framework:** embodied cognition as the grand/unified theory — social side, lived experiences, how we use our surroundings, kinesthetic exercises; **resources framework** as the lower tier of the hierarchy | **Strand C theoretical framework** | SCOPING — the researchers' framing layer. Embodied cognition is the umbrella; the resources framework (Hammer) sits beneath it. → scoping-site Strand C (`strands.qmd`). No app task. |
| Video streams "with overview" (gestures etc.); **"2 by agent, 2 by humans"**; research analysis **by batch** | **Strand C research instrumentation** | SCOPING — continues the 23-June video-capture cluster. "2+2" = an annotation/coding split (2 sessions agent-coded, 2 human-coded). Researcher-only, batch, kinesthetic-gesture capture. → scoping-site Strand C. |
| **Critical-thinking-skill assessment**; "disentangle research and UX"; researchers want things teachers don't | Strand C research design (architecture already supports) | The researcher-vs-teacher split is already architected — ADR-016 researcher tier + [researcher-analytics-rollout.md](researcher-analytics-rollout.md) (cross-class read bypass). The *what* (using the bot to assess critical-thinking skills) is Strand C scoping; the *separation* is already a first-class principle. |
| Researchers across all classes: how do **student social networks** evolve over time; students link groups together; exploratory; **AI classes vs non-AI**; **baseline at start → track evolution**; "no KPIs in a university — more exploratory"; "how do teachers and students **feel** about it" | **Strand C research design** | SCOPING — research questions + study design. Social-network analysis, affective measures, baseline/longitudinal, exploratory-not-KPI. → scoping-site Strand C (`evaluation.qmd` capability-floor is KPI-framed; this is the *exploratory* counterpart). |
| **Exit ticket** — "do students feel they're learning more / it's more accessible"; placeholder text, **Aswin to work on over summer**; questions **before and after, throughout the year**; fatigue risk from many measurements; multiple measurements over the year | **Input parked on 1.1.8 exit-ticket** | **Decision (M, 29 June): park until Aswin delivers** — no roadmap move. [exit-ticket.md](exit-ticket.md) (1.1.8) stays *OPEN, blocked*. Recorded as future design input (not yet actioned): question-set owner is now **Aswin (summer)** rather than JB/AR; the framing adds an **affective** axis ("feel they're learning more / more accessible") and a **longitudinal** axis (repeated before/after across the year, fatigue-aware) on top of today's per-session one-shot. Revisit when Aswin's set arrives. |
| **Causal inference without RCTs:** control class hard (10 teachers / 20 classes); RCT / Harvard-style hard in Danish upper-secondary; Chinese-schools AI study (Atharva, ~27,000 students); **Sugihara 2012 "Detecting Causality in Complex Ecosystems"** (CCM / convergent cross-mapping, fish-cohort example) — "when we use AI do we see a change", web-visitor analogy; **side-effects matter** ("learn more physics, but the side-effect is never to use AI again"); observer effect — "we may be influencing the teachers" | **Strand C research methodology** | SCOPING — quasi-experimental design + a causal-inference method (CCM) + explicit side-effect tracking. Refs to capture for JB/AR: Atharva 27k-student study; **Sugihara et al. 2012, "Detecting Causality in Complex Ecosystems", *Science*** — [doi:10.1126/science.1227079](https://www.science.org/doi/full/10.1126/science.1227079) (the CCM method, fish-cohort example; M, 29 June). → scoping-site Strand C. |
| "What teachers are doing in the system — **not assessing them**" | **Ethics / framing constraint** | Reaffirms: teacher analytics is **not** teacher evaluation. Constrains how [teacher-analytics-framework.md](teacher-analytics-framework.md) (1.1.31) and the session reports are *framed/worded* — observe, don't grade. No new build; a guardrail to keep on every teacher-facing analytics surface. |
| "research where students struggle with these things — **decomposing a vector is difficult**" | Research + content signal | Strand C research, with a concrete hard-spot example. Vector decomposition → a capability-floor / eval signal (`evaluation.qmd`) and a candidate misconception tag for the per-skill taxonomy (R2). → scoping-site Strand C / evaluation. |

## Net effect on the roadmap

**M's dispositions (29 June):**

- **0 new Strand A build rows.** Consistent with breadth-over-depth and the freeze — nothing here demands a new feature this week.
- **1 content task, un-blocked by the source** — **Danish textbook method** into [curriculum-library.md](curriculum-library.md) (1.1.25). Source is the **free-to-use** maths/physics textbooks at [mathematicus.dk](https://mathematicus.dk/fysik/), so the gate is a **licence-terms check**, not full copyright clearance. Next action: confirm the licence permits corpus ingestion + student redistribution, then AILANG-Parse ingest into the A/B/C taxonomy. Noted on the curriculum-library doc + the clearance tracker.
- **Exit-ticket (1.1.8): parked** — no roadmap move. Aswin owns the question set over summer; the affective + longitudinal framing is recorded as future design input on [exit-ticket.md](exit-ticket.md). Revisit when Aswin delivers.
- **Method-fidelity: principle only** — no framework edit, no new authoring control. Recorded for the record; revisit if it recurs.
- **1 guardrail reaffirmed** — teacher analytics is *not* teacher assessment; keep the framing observational across 1.1.31 + the reports.
- **A large Strand C cluster** — theoretical framework (embodied cognition → resources framework), social-network / baseline-longitudinal study design, causal-inference methodology (CCM, side-effects, observer effect), and the video-coding instrumentation that continues the 23-June thread. Belongs in the **scoping site's Strand C**; **flagged here, not yet folded in** — the largest to-process chunk, and the natural agenda for the post-freeze Strand C scoping kickoff (Phase 2.2).

---

## Follow-up thread (29 June, post-meeting) — textbook ingestion + multi-subject direction

Downstream of the Danish-textbook decision, M shared the concrete sources and three roadmap-relevant items surfaced. Captured here so they aren't lost.

| Item | Type | Disposition |
|---|---|---|
| **Free-to-use textbooks ingested into the document library** — M provided 3 PDFs from [mathematicus.dk](https://mathematicus.dk/) (all by **Mike Vandal Auerbach**, **CC BY-NC-SA 4.0**): *Atomer* (physics), *Integralregning* + *Differentialregning* (maths, stx A/B) | **Action taken (prep) + dev write pending** | Parsed to markdown with `docparse` (deterministic, no token cost), staged in `CURRICULUM_SRC_DIR` (scoping-site `sources/curriculum/`, the convention — large binaries stay out of the exec repo), PDF provenance kept under `mathematicus-pdf-source/`. Ingest into the **dev shared corpus** (`aiplatform curriculum ingest … --shared --copyright cleared`) is **gated on approval** (live dev write during the freeze) — exact commands recorded in [curriculum-textbook-ingestion-notes.md](curriculum-textbook-ingestion-notes.md). Licence is **NonCommercial** (fine for UCPH education) + **Attribution** (carried in the `origin` field) + **ShareAlike**. Once ingested they appear as citable **activity materials** in the builder. |
| **Multi-subject schema expansion** — "we discussed computer science and maths may want to use the app … we'll need to expand the schema for subjects" (M) | **New roadmap signal → SEQUENCE 2.6** | `CurriculumDoc` is physics-centric (A/B/C `level`, **no `subject` field**). Maths/CS need a first-class `subject` dimension across the model + ingest endpoint + Materials-picker filter, plus per-subject level taxonomies. **Added as [SEQUENCE row 2.6](SEQUENCE.md)** (Year-2 / post-pilot signal). **Interim:** the maths textbooks above are tagged via `topic` (`matematik – …`) as a stop-gap until the field lands. |
| **"Read an IDE environment in the workbench"** — for computer-science / computational-physics activities (M: "put on the roadmap") | **New roadmap signal → SEQUENCE 2.7** | A new workbench **Type 6 (Code/IDE)** under the existing [1.J workbench-type system](../v1.0.0-pilot/expanded-workbench-types.md): expose a student's editor/file/run state to the tutor (as Types 3–5 do for sensor/video/lab-notebook). **Added as [SEQUENCE row 2.7](SEQUENCE.md)** + noted on 1.J. Pairs with 2.6 (CS as a subject). Needs a `postMessage` contract + trust-card + snapshot-push wiring. Year-2 / post-pilot. |

**Net effect of the follow-up:** **+2 roadmap signals** (2.6 multi-subject schema, 2.7 Code/IDE workbench Type 6) — both Year-2/post-pilot, consistent with breadth-over-depth (they widen the possibility space without committing pilot build). **+1 content action** (3 free-to-use textbooks into the document library), pending the gated dev write. The maths content entering a physics-shaped schema via a `topic` stop-gap is the concrete trigger that turns 2.6 from "nice-to-have" into "needed".

---

## Raw capture (verbatim, 29 June 2026)

ais may solve problems different than students

e.g. formulaes vs energy -
what does the student need to do vs AI

the ai will use wrong method? how does it do it in a more beneficial/correct way

automate the process - solve and make the reasons

pointed out ai is perfomative
ai needs to guide the student

research lags way behind current edge

danish text book physics to add as standard danish way of doing things

## theoretical framework
- grand framework embodied cognition
unified theory
social side
lived experiences
how we use surroundings
knesthetic exercises
will need video streams with overview (gestures etc)
2 by agent 2 by humans
research analysis by batch

lower hierachy
- resource framework

critical thinking skill assessment?
disentangle research and UX - how could they use the AI bot to assess the critical thinking skills they want the student to have
researchers could be interested in things teachers are not
- researchers across all classes hwo do the social netowrks of the students evolve over time
- student links groups together
- exploratory
- how well do the AI classes compared to those who do not
- get a baseline of students at the start and see how they evolve over time
- no KPIs in university - mroe exploratory - but how do the teachers and students feel about it?
- exit ticket - do the students feel they are learning more or more accessible - put in a placeholder text? Aswin to work on during summer
- questions before and after - throughout the year - may be fatigue as we are asking many questions over the year - multiple measurements over the year
 - control class? we have 10 teachers, 20 classes - difficult to control
 - randomised contorl trials difficult to do over long term
 - harvard study difficult to do in danish upper secondary
 - ai study in chienese schools cppr
   - atharva 27.000 students
- 2012 - detecting casuality in complex ecosystems
 - cohorts of fish
 - when we use AI do we see a change
 - visitors on websites
   - what is this with students? motivation? learning?
 - side effects can be important
 - yes they use AI to learn more physics, but side effect is never to use AI again.
- hypermat development - we may be influencing the teachers
- what teachers are doing in the system - not assessing them

research how students where they struggle with these things
- decomposing vector is difficult
