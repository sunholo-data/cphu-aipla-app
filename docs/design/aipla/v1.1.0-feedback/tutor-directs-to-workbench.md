# The tutor directs the student to the workbench — an affordances block, a referral rule, and a count

**Status:** Design (OPEN) — **1.1.149**
**Priority:** **P1** — the 29 September meeting named the workbench↔tutor coupling as what makes the platform worth using instead of ChatGPT, and the first teacher seminar on prod saw no evidence of it. Un-gated
**Estimated:** ~3–3.5d phased (M0 evidence ~0.25d, M runs the SQL · M1 shared referral matcher ~0.5d · M2 affordances block + per-turn referral nudge ~1d · M3 remove the "no simulator" contradiction and fix the opening pointer ~0.25d · M4 framework `workbench_use` field, unset everywhere ~0.5d · M5 referral probe in the bench + live smoke ~0.75d · M6 release + re-measure ~0.25d)
**Scope:** Backend: a new `adk/workbench_affordances.py`, `adk/agent.py` (one more provider in `compose_instruction_providers`), `adk/proactive_greet.py` (`_first_element`), `db/models/teaching_framework.py` (one optional field), `skills/templates/concept-dialogue/SKILL.md` (two sentences), a new `analytics/workbench_referral.py`, `scripts/bench-tutor-discrimination.py` + `research/tutor-discrimination/scenarios.yaml`. No frontend, no schema change to activities, no new authoring surface
**Dependencies:** [1.1.62 workbench-element-awareness](workbench-element-awareness.md) (**shipped** — the element manifest this extends); [1.1.69 tutor-sees-element-state](tutor-sees-element-state.md) (**shipped** — the per-turn fill-state this reads); [1.1.133 tutor-controls-sims](../v2.1.0-extension/tutor-controls-sims.md) (**shipped M0–M3**, v0.1.79 — `control_sim`, `sim_control` on the framework, the precedent for M4); [1.1.105 tutor-turn-taking-and-closure](tutor-turn-taking-and-closure.md) (open, a sibling observable behaviour); the tutor layer, [tutors-handover-2026-09-10](tutors-handover-2026-09-10.md) (the passthrough guarantee); [BENCH-1/2](tutor-discrimination-benchmark-sprint.md) (**shipped**, the harness M5 extends)
**Created:** 2026-10-05
**Source:** Teacher seminar 2026-10-05, [notes-2026-10-05.md](../../../notes-2026-10-05.md) — M, verbatim: *"Tutor never asked to use the workshop - too dialogue. Perhaps it needs to be more aware of the workbench features. The tutor never asked the student to use the simulations."* ("workshop" = the workbench.) Also the [29 Sept follow-ups](meeting-2026-09-29-followups.md): tight tutor↔activity coupling is what makes the platform better than a student opening ChatGPT.

## Problem Statement

In activities that had a simulation and workbench elements, the tutor held a
conversation and never sent the student to either. 1.1.62 was written in August for
the same complaint (Aswin: *"The chat never asked me to work on those tools"*) and
shipped an element manifest; the complaint has recurred. This document establishes,
from the code, why the shipped fix does not produce the behaviour, and proposes a
fix whose effect is **counted** rather than asserted.

## Findings

Every finding below is **verified against code** on 2026-10-05 unless marked
*hypothesis*. None is verified against the seminar's data: reading prod was not
permitted when this was written, which is what M0 is for.

### F1. Teacher-built activities run a skill that tells the tutor there is no simulator

A from-scratch activity binds to the `concept-dialogue` skill whatever is attached
to it (`frontend/src/app/teacher/activities/new/page.tsx:34,131`; the demo seed
does the same, `backend/onboarding/demo_seed.py:66-69`). That skill's body says:

- `skills/templates/concept-dialogue/SKILL.md:105` — *"There is no simulator on
  screen; the conversation is the whole activity."*
- `:16-22` (description) — *"NO simulator, chat-only … the base engine for
  teacher-authored no-workbench concept activities"*.
- `:130` — *"Maximum 3 sentences … Every response must end with a question."*
- `:109-126` — six hard rules, every one of them about dialogue moves.

The activity's workbench content is substituted into `{teacher_focus}` at `:200`,
i.e. **inside the same body that has already denied it exists**. It is also the
only tutor template with that placeholder: `kinebot-kinematics-tutor`,
`led-planck-tutor` and `problem-set-hints` carry no `{teacher_focus}` at all, so
they never receive the manifest or a sim's `tutorBlock` (verified by grep). For
teacher-built activities this is moot, since they all run `concept-dialogue`.

### F2. The manifest's instruction is permissive and sits in the weakest position

`adk/element_manifest.py:53-57`: *"Refer to them by name and invite the student to
use them **when the conversation reaches them** — do not wait to be asked."* There
is no trigger the model can recognise ("when the conversation reaches them" is
satisfied by never reaching them), and nothing measurable.

Position: `agent.py` follows a documented *later instruction wins* convention
(`teacher_focus.py:410-426`). The composed prompt is, in order: SKILL.md body with
`{teacher_focus}` (language directive, sim `tutorBlock`, manifest, solution, concept
map, goal — `teacher_focus.py:321-383`) → curriculum grounding → sources honesty →
ILO precedence → progress → concept steering → maths notation → praise → identity
(`agent.py:855-920`) → **teaching framework preamble appended last**
(`tutor_framework.py:93`, wrapped at `agent.py:828`) → opening/reactive guidance →
per-turn iframe context and element fill-state (`agent.py:948-975`). The manifest
is therefore early, and the strongest-positioned instruction is the framework's
— which says nothing about the workbench (F4).

### F3. The simulation is not in the manifest, and nothing says to send the student to it

`describe_elements` iterates `ELEMENT_REGISTRY` only (`element_manifest.py:223`;
registry at `db/models/activity_config.py:504-529`). A sim is `ActivityConfig.artefact_id`
(`activity_config.py:573`), not a registry element, so **a sim-only activity gets no
manifest header at all** — no "invite the student" sentence of any kind.

What the tutor does get for a sim is the catalogue's `tutorBlock`
(`teacher_focus.py:325-329`). These are descriptive and reactive by design:
`artefacts/boldkast.yaml:24-28` says what the sim is and what to do *when an event
arrives*; `artefacts/sol-jord-maane.yaml:42` says explicitly *"Your dialogic approach
comes from your own tutor instructions; this block … says nothing about how to run
the dialogue."* That is the correct division of labour — and the tutor's own
instructions (F1, F4) then say nothing either. Each layer defers to another, and no
layer owns *"point the student at the sim"*.

The opening turn has the same gap. `proactive_greet._first_element`
(`proactive_greet.py:123-138`) walks the registry in order, so **the checklist wins
whenever there is one** (*"the checklist, starting with …"*), and a sim is never
considered. The opening template then says *"pointing at the first thing to do"*
(`:78`), which for a sim activity points at a checklist label or at nothing.

### F4. The teaching frameworks are conversation-only

`backend/frameworks/*.yaml` contain no instruction about the workbench or sims; the
one mention is an illustrative line in `cer.yaml:91` (*"what on the data table?"*).
`frameworks/instruction.py:89-160` renders constructs → behaviours verbatim, so the
strongest-positioned block in the prompt is, by construction, a list of dialogue
moves (ESRU's 23 of 42 are ask-moves, per `agent.py` comment at `:808-813`). The
only workbench-related framework field is `sim_control`
(`db/models/teaching_framework.py:211`), set by **no** published framework, and it
governs what the tutor may *change* in the sim, not whether to *send* the student there.

### F5. Sim commands reach the model as a tool declaration, for one sim only

`commands` reach the model only as the `control_sim` function description
(`adk/sim_control_tools.py:97-108`), built only when the sim declares commands and
the tutor's level admits one (`:208-230`). Only `sol-jord-maane` declares commands
(`artefacts/sol-jord-maane.yaml:104`); the other eight sims produce no tool. The
system prompt never mentions the tool. A `control_sim` call is logged to
`workbench_events` with `tool = 'control_sim'` (`sim_control_tools.py:300-345`),
which M0 can count.

### F6. Hypotheses, to be tested by M0 and M5, not asserted

- *H1.* `concept-dialogue` runs `gemini-3.5-flash-lite` with no thinking
  (`SKILL.md:72`) on a prompt that can carry up to 32,000 characters of focus
  (`teacher_focus.py:82`, raised for `sol-jord-maane`). Weak adherence to an early,
  permissive sentence in a long prompt is the expected failure for that tier.
- *H2.* The seminar's students (teachers playing students) asked questions, and a
  tutor answering a question with a question never reaches "the conversation
  reaches the tool".
- *H3.* Referrals did happen, phrased generically ("try changing the angle") without
  naming the sim, and were not noticed. M0's lexical count separates H3 from the rest.

## Goals

**Primary:** in an activity with a simulation or a fillable element, the tutor sends
the student to the workbench by name, early and when they are stuck, without the
dialogue becoming a list of instructions.

**Non-goals:** a new element type; teacher-authored per-element pedagogy (O3); the
tutor operating the workbench for the student; changing any framework's moves.

## Decision

### Options

| | Option | For | Against |
|---|---|---|---|
| A | **Prose only** — fix `concept-dialogue/SKILL.md`, strengthen the manifest header | ~0.5d; removes the contradiction | Still early in the prompt, still unmeasurable; sims still absent from the manifest; 1.1.62 was this option and the complaint recurred |
| B | **An affordances block composed per turn, late in the chain, with a referral rule the platform owns and a framework may tune**, plus A's contradiction fix and a shared referral matcher that drives both the nudge and the eval | Fixes F1–F4; one matcher means the runtime nudge, the bench and the prod SQL count the same thing; passthrough preserved for the tutor layer | Changes the composed prompt of every workbench activity (deliberately — see Passthrough) |
| C | B **plus** a teacher-authored "why this is on the bench" field per element | Best pedagogical signal | New authoring surface; a teacher has to write it; the UX-coherence gate argues against adding fields before the existing ones work |

**Recommendation: B**, with C recorded as O3 and revisited only if M6 shows referrals
that are frequent but pedagogically empty.

### The division of ownership

| Owner | Decides | Where it lives |
|---|---|---|
| **Activity** (teacher) | WHAT is on the bench: elements, their titles and tasks, which sim | `ActivityConfig`, unchanged |
| **Sim catalogue** (AR/author) | WHAT the sim is and what its events mean | `tutorBlock`, `description`, `commands`, unchanged |
| **Platform** | THAT the tutor refers to the bench, and the default WHEN | `adk/workbench_affordances.py` |
| **Framework** (researchers) | HOW EARLY / HOW OFTEN, where the approach has a view | optional `workbench_use`, null by default |

### The affordances block (M2)

A new `InstructionProvider` wrapper, `make_workbench_affordances_wrapper(cfg, framework_policy)`,
added to `compose_instruction_providers` **after** `make_element_state_wrapper`
(`agent.py:971`) so it is the last workbench text the model reads and comes after
the framework preamble. Per turn it composes:

1. **Inventory** — one line per thing on the bench, sim first: the sim's
   `displayName` and catalogue `description` (never its `tutorBlock` again, which is
   already in the prompt), and whether `control_sim` is available; then each element
   by kind and title, reusing the `element_manifest` describers rather than
   re-deriving them. Fill state is **read from** `element_state`'s observation for
   this turn (*untouched* / *in use*), not recomputed.
2. **The referral rule**, with recognisable triggers instead of "when the
   conversation reaches them": refer to a named item (a) in the opening turn,
   (b) when the student is stuck, guesses, or asks for the answer — send them to the
   item that would let them find out, (c) when a claim needs evidence the bench can
   produce, (d) after a sim event, tie the reply to what they just did. Name the item
   as the student sees it. Ask the student to *do* something there and report back;
   a referral is an action, not a mention.
3. **The nudge**, deterministic and conditional: when the last `K = 3` tutor turns
   contain no referral (per the M1 matcher, on `ctx.session.events`) **and** at
   least one item is untouched, one extra sentence names that item. Never on the
   opening turn; at most once per `K` turns, so it cannot become nagging.

The rule text carries the framework policy (M4): `dialogue_first` drops trigger (a)
to "name the bench once" and keeps (b)–(d); `workbench_first` adds "send the student
to the bench before discussing"; null resolves to the platform default `balanced`
(all four triggers). Capped at 1,200 characters, item-wise truncation keeping the rule,
like `element_manifest._fit`. Emits `""` when the activity has no sim and no element.

### The shared referral matcher (M1)

`analytics/workbench_referral.py`: `is_referral(text, vocabulary) -> bool` and
`referral_vocabulary(cfg) -> Vocabulary`. The vocabulary is a generic Danish/English
lexicon (`GENERIC_PATTERN`, the same regex the M0 SQL uses) plus activity-specific
names: element titles, the sim's `displayName` and its first word ("Boldkast",
"Elkedel"). A `control_sim` function call in the turn also counts. One function is
used by the runtime nudge, the bench probe and the session-level report, so the
thing that fires the nudge and the thing that grades it cannot disagree.

### Passthrough

The tutor-layer guarantee (handover rule 1) holds unchanged: `workbench_use` is null
on every framework, and a null framework contributes nothing; the platform default
applies identically with or without a tutor. **An activity with no sim and no
element composes byte-identically** (the block returns `""`), asserted by test.
An activity *with* workbench content gets a different prompt — that is the change
being made, on the same footing as the unconditional praise and notation blocks,
and it is called out in the release notes (O1).

## Milestones

### M0 — evidence (M runs; ~0.25d)

Read-only, against `aipla-prod-2026.chat_logs`. Assistant rows have `role = 'tutor'`
(not `'assistant'`; `analytics/research_logs.py:72-76`, and a `role = 'assistant'` filter returns zero rows silently). Student rows are `'student'`. Teachers at the seminar may have used "Try as student"
(`preview-` groups); those are reported separately rather than dropped. Paste the
four result tables into this doc under *M0 results*.

```sql
-- Shared: the generic referral lexicon (mirror of workbench_referral.GENERIC_PATTERN).
DECLARE ref_re STRING DEFAULT r'(?i)\b(arbejdsbord\w*|workbench|simulering\w*|simulation\w*|simmen|tabel\w*|table|graf\w*|chart|diagram\w*|lommeregner\w*|beregner\w*|calculator|tjekliste\w*|checklist\w*|skriveflade\w*|begrebskort\w*|concept map|mission\w*|boldkast|kinebot|planck|interferens|faseovergang\w*|elkedel\w*|bølgefart|sekantbænk\w*|sol, jord)\b';

-- Q1 seminar day, per activity: how often do tutor turns refer to the bench?
WITH t AS (
  SELECT *, CASE WHEN STARTS_WITH(group_id, 'preview-') THEN 'teacher-trial'
                 WHEN STARTS_WITH(group_id, 'teacher:') OR STARTS_WITH(group_id, 'preview:') THEN 'excluded'
                 ELSE 'student-group' END AS who
  FROM `aipla-prod-2026.chat_logs.chat_turns`
  WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05'),
tut AS (
  SELECT *, REGEXP_CONTAINS(content, ref_re) AS ref,
         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY turn_index, ts) AS k
  FROM t WHERE role = 'tutor' AND who != 'excluded'),
per_session AS (
  SELECT session_id, ANY_VALUE(activity_id) activity_id, ANY_VALUE(who) who,
         ANY_VALUE(framework_id) framework_id, ANY_VALUE(app_version) app_version,
         COUNT(*) tutor_turns, COUNTIF(ref) ref_turns, MIN(IF(ref, k, NULL)) first_ref_k
  FROM tut GROUP BY session_id)
SELECT activity_id, who, framework_id, app_version,
       COUNT(*) sessions, SUM(tutor_turns) tutor_turns, SUM(ref_turns) ref_turns,
       ROUND(SAFE_DIVIDE(SUM(ref_turns), SUM(tutor_turns)), 3) ref_share,
       COUNTIF(ref_turns > 0) sessions_with_ref,
       APPROX_QUANTILES(first_ref_k, 2)[OFFSET(1)] median_first_ref_turn
FROM per_session GROUP BY 1, 2, 3, 4 ORDER BY sessions DESC;

-- Q2 baseline: the same, per ISO week, 2026-09-07 .. 2026-10-04 (student groups only).
SELECT EXTRACT(ISOWEEK FROM ts) wk, activity_id,
       COUNT(DISTINCT session_id) sessions, COUNTIF(role = 'tutor') tutor_turns,
       COUNTIF(role = 'tutor' AND REGEXP_CONTAINS(content, ref_re)) ref_turns,
       COUNT(DISTINCT IF(role = 'tutor' AND REGEXP_CONTAINS(content, ref_re), session_id, NULL)) sessions_with_ref
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') BETWEEN '2026-09-07' AND '2026-10-04'
  AND NOT (STARTS_WITH(group_id, 'teacher:') OR STARTS_WITH(group_id, 'preview'))
GROUP BY 1, 2 HAVING sessions >= 3 ORDER BY wk, sessions DESC;

-- Q3 did students use the bench anyway, and did control_sim ever fire? (seminar day)
SELECT w.activity_id, COUNT(DISTINCT w.session_id) sessions_with_events,
       COUNTIF(w.tool = 'control_sim') tutor_sim_commands,
       COUNT(*) events, STRING_AGG(DISTINCT w.server LIMIT 10) servers
FROM `aipla-prod-2026.chat_logs.workbench_events` w
WHERE DATE(w.ts, 'Europe/Copenhagen') = '2026-10-05'
GROUP BY 1 ORDER BY events DESC;

-- Q4 qualitative: 40 tutor turns from the busiest workbench activity (fill in from Q3).
SELECT session_id, turn_index, REGEXP_CONTAINS(content, ref_re) ref, SUBSTR(content, 1, 400) content
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05' AND role = 'tutor' AND activity_id = '<from Q3>'
ORDER BY session_id, turn_index LIMIT 40;
```

Read Q1 against Q3: activities that appear in Q3 are the ones with a bench. The
regex over-counts physics uses of "graf"/"tabel" and under-counts generic phrasing
(H3); Q4 is the check on both. **Decision gate:** if Q1 shows a referral share in
workbench activities already above ~0.3 with first referral by turn 3, the problem is
phrasing (H3) and M2's nudge is reduced to the naming rule; otherwise proceed as written.

### M1 — referral matcher (~0.5d)

`analytics/workbench_referral.py` as above, with `GENERIC_PATTERN` as the single
source; a test asserts the M0 SQL's lexicon (kept in `research/workbench-referral/m0.sql`)
equals it.

### M2 — affordances block + nudge (~1d)

`adk/workbench_affordances.py` and the wrapper in `agent.py`. Log
`workbench_affordances: activity=… items=… policy=… nudged=…` at INFO per turn, so
"was the tutor told, and was it nudged" is answerable from logs (Axiom 8).

### M3 — remove the contradiction, fix the opening pointer (~0.25d)

- `concept-dialogue/SKILL.md`: replace `:105` with *"Some activities put a workbench
  beside this chat — a simulation, a data table, a checklist. When your instructions
  describe one, it is part of the activity, and sending the student to it is part of
  your job."*; reword the description (`:16-22`) to drop "NO simulator, chat-only".
  Keep `:130` (three sentences, end with a question): a referral fits inside it.
- `proactive_greet._first_element`: a sim, when present, comes first; the checklist
  is named only when nothing else is on the bench.

### M4 — `workbench_use` on the framework (~0.5d)

`TeachingFramework.workbench_use: Literal["dialogue_first", "balanced", "workbench_first"] | None`
(alias `workbenchUse`), resolved like `resolve_sim_control_level`. **Set on no
framework**; that is AR/JB's call per approach (O2). If the doc generator is taught to
render it, run `make tutor-docs`.

### M5 — the count, as an eval (~0.75d)

The BENCH harness runs on `tutor_preview.compose_approach_instruction` — the skill
plus the approach, **with no activity** — so as shipped it cannot see a workbench.
Extend it rather than build a second harness:

- `scenarios.yaml`: an optional `activity:` per scenario (an inline `ActivityConfig`:
  a sim id plus a table and a checklist). Three such scenarios (projectile/Boldkast,
  kettle efficiency, wave interference), each with a planted *stuck* student turn
  (`probe.stuckTurn`, e.g. *"jeg ved det ikke"*).
- For an `activity:` scenario the tutor turn is composed through the real
  `create_agent` path (as `tests/api_tests/test_class_tutor_reaches_the_student.py:264-280`
  does), so the block under test is the block a student gets.
- A new deterministic **referral probe** (no judge call): per transcript, referring
  tutor turns, first referral turn, referral within two tutor turns after the stuck
  turn, and referral share. Reported per approach beside the discrimination matrix.
- `--from-sessions` gains the same probe over real sessions (no model calls), which
  is M6's re-measure.
- `tests/eval/test_workbench_referral_smoke.py`, `@pytest.mark.slow`, same shape as
  `test_activity_task_in_context_smoke.py`: one in-memory sim+table activity, a
  neutral opening and a stuck turn, asserting a named referral.

### M6 — release and re-measure (~0.25d)

Ship; run the probe with `--from-sessions` on the first classroom week after release
and Q1 again; record both here.

## Acceptance criteria

1. **Deterministic, CI:** for an activity with (i) a sim only, (ii) elements only,
   (iii) both, the composed instruction contains the affordances block, after the
   framework preamble and after the element fill-state block; for (iv) neither, the
   instruction is byte-identical to the instruction composed with the wrapper removed.
2. A sim-only activity's block names the sim's `displayName`; `concept-dialogue`'s
   body no longer contains "There is no simulator on screen".
3. The nudge appears after exactly `K` non-referring tutor turns with an untouched
   item, not before, not on the opening turn, and not when every item is in use.
4. **Bench** (3 activity scenarios × 7 approaches + base, flash-lite): first named
   referral by tutor turn 2 in ≥ 80% of transcripts; a referral within two tutor
   turns of the stuck turn in ≥ 70%; referral share of tutor turns ≤ 0.6 (no nagging);
   the discrimination report's own-column rank does not fall versus the last BENCH-2
   run by more than its run-to-run noise.
5. **Prod, M6:** in workbench activities, sessions with ≥ 1 referral rise from the M0
   baseline to ≥ 80%, median first referral at tutor turn ≤ 3.

## Tests

- `tests/unit/test_workbench_referral.py` — lexicon hits and misses in both
  languages; activity names; `control_sim` call counts; SQL lexicon equals
  `GENERIC_PATTERN`.
- `tests/unit/test_workbench_affordances.py` — inventory per kind, sim first; rule
  text per policy; cap and truncation keep the rule; `""` for an empty activity;
  nudge timing (criterion 3) from synthetic `session.events`.
- `tests/api_tests/test_workbench_reaches_the_model.py` — **end-to-end prompt
  composition**: seed a class + activity with a sim and a table (LOCAL_MODE
  Firestore, as `test_class_tutor_reaches_the_student.py` does), build with
  `create_agent`, await `agent.instruction(ctx)`, and assert the block is present,
  names the sim, and appears after the framework preamble (seed a tutor with a
  framework so there is one to be after). Mirror test: no sim, no elements →
  identical. Per the "resolver ships with one consumer" footgun, the test must go
  through the real agent build, not call `compose_workbench_affordances` directly.
- `tests/unit/test_proactive_greet.py` — sim beats checklist in `_first_element`.
- `tests/unit/test_teaching_framework.py` — `workbench_use` defaults null and
  round-trips its alias; every shipped YAML leaves it null.
- The slow smoke in M5.

## Handover to a cloud agent

**Read first:** this repo's `CLAUDE.md` (tutor layer section; footguns "A resolver
ships with one consumer" and "Seed after SKILL.md change"),
[tutors-handover-2026-09-10.md](tutors-handover-2026-09-10.md) rule 1,
[workbench-element-awareness.md](workbench-element-awareness.md), and the files cited
in Findings.

**Files:** `backend/adk/workbench_affordances.py` (new), `backend/analytics/workbench_referral.py`
(new), `backend/adk/agent.py`, `backend/adk/proactive_greet.py`,
`backend/db/models/teaching_framework.py`, `backend/skills/templates/concept-dialogue/SKILL.md`,
`scripts/bench-tutor-discrimination.py`, `research/tutor-discrimination/scenarios.yaml`,
`research/workbench-referral/m0.sql` (new), tests above.

**Commands:** `cd backend && make lint && make test-fast` before every push;
`cd backend && uv run pytest -m slow tests/eval/test_workbench_referral_smoke.py`
(needs ADC; calls a model). The SKILL.md change reaches Firestore through the deploy
seed job; to push it to dev without a deploy, `make seed ENV=dev`. If any
`backend/frameworks/*.yaml` changes, or the doc generator renders `workbench_use`,
run `make tutor-docs` and `make check-tutor-docs`. Bench: `make bench-tutors ARGS=--dry-run`
only — a `--go` run costs money and needs M's go-ahead.

**Do not:** set `workbench_use` (or `sim_control`) on any framework YAML; pair a base
tutor with a framework; put the block inside `{teacher_focus}` (that is the weak
position F2 describes); add a second "is this a referral" heuristic anywhere; read
prod data or run M0 yourself; hand-edit `docs/design/aipla/tutors/*.md` or
`frontend/content/project/tutors/*.md`; add a per-element authoring field (that is O3);
open a PR — commit to `dev` per the repo's git policy.

## Open questions for M

1. **O1 — the prompt change for every workbench activity.** Is shipping the block
   unconditionally (like praise and notation) acceptable mid-research, or should it
   ride a release note to AR/JB first, given that it shifts every live arm's prompt
   at once? It changes all arms equally, so the comparison between arms survives;
   comparison *across* the release date does not.
2. **O2 — which approaches have a view on timing?** POE (predict before running) and
   5E (explore before explain) plausibly want `workbench_first`; ESRU and Accountable
   Talk may want `dialogue_first`. AR/JB to decide; nothing is set until they do.
3. **O3 — per-element purpose.** Defer the teacher-authored "why this is on the bench"
   field until M6, or is it wanted now?
4. **O4 — the other three tutor templates** have no `{teacher_focus}`. Retire them for
   teacher-built activities, or give them the placeholder? Out of scope here.
5. **O5 — K and the thresholds** (`K = 3`, 80%/70%/0.6) are first guesses; confirm or
   adjust after M0.
