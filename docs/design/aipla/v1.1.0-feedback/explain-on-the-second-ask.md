# Explain on the second ask — calibrating the tutor for 1st-years

**Status:** Design (OPEN) — **1.1.129**
**Priority:** **P2** — no defect; a pedagogy calibration with direct evidence from the first 1st-year session. Needs JB (and ideally Tabita) before M1
**Estimated:** ~1d (M0 second-ask rule ~0.3d · M1 class year → register ~0.4d · M2 eval from today's transcripts ~0.3d)
**Scope:** Backend — student tutor SKILL.md templates (`problem-set-hints`, `concept-dialogue`), `adk/agent.py` instruction chain, `db/models/class_.py`. Teacher UI — class settings
**Dependencies:** [1.1.111 register-belongs-to-the-approach](register-belongs-to-the-approach.md) (**shipped** — the register now comes from the approach; this must not re-open a second pedagogy axis); [1.1.90 bounded-tutoring-answer-trees](bounded-tutoring-answer-trees.md) (**open** — the answer-tree is where "how far may the tutor explain" could eventually live). **Un-gated** for M0; M1 wants JB
**Created:** 2026-09-22
**Source:** [classroom-session-2026-09-22-followups.md](classroom-session-2026-09-22-followups.md), finding 4

## Problem Statement

The tutor's prompt says: *"Maximum 3 sentences unless the student asks for detail
('explain in detail', 'step by step'). Every response must end with a question."*
(`problem-set-hints/SKILL.md:259`). With 1st-year gymnasium students on
22 September, the *ask-back* half held and the *unless* half did not:

**`pink-garden-04`** — the clearest case:

> 14:19 *hvordan bruger vi frekvensen til at finde perioden* → a question back
> 14:24 ***forklar hvordan*** → another question back
> 14:27 *skal vi så ikke skrive lambda divideret med frekvens?* → *"lad os lige
> tjekke én ting ad gangen…"*, a third question
> — the group did not write again.

`T = 1/f` is a definition, not the graded result. Two explicit requests for an
explanation got none.

**Where it went right, it was because the student forced it.** `still-violin-61`:
*"prøv at forklar det meget simpelt"* → a car analogy → *"så blir der længere
mellem bølgetoppene"* → a correct hypothesis four turns later. The tutor *can* do
it. It waits too long to.

**The language was a notch too dense.** `bold-kazoo-64`: *"Jeg forstår ikke det
andet du sagde i teksten"* after a reply built on $v = 2{,}0\ \text{m/s}$ and a
period question. Several groups asked what individual words meant.

**Four groups opened with "what are we investigating?"** — bold-kazoo (twice),
busy-moose, tilted-guppy. The tutor answered well each time, but it suggests
the activity's own intro isn't landing. That goes to the teacher, not the prompt
(see the follow-ups doc).

**What must not change.** The tutor refused, correctly, to write a hypothesis
(*"Bare lav den"*) or draw the comic strip. Those are the graded artefacts. The
line this doc draws is between **the task's product** (never hand it over) and
**a concept or definition needed to make progress** (explain it when asked twice).

## Goals

1. When a student asks for an explanation twice, or says they don't understand,
   the tutor explains: plainly, with one everyday example, then one check
   question.
2. The tutor's default language fits the class year, without adding a second
   pedagogy axis next to the approach.
3. An eval built from today's transcripts keeps both halves: explain on the
   second ask, and never hand over the graded product.

## Design

### M0 — the second-ask rule (~0.3d)

Add to the student-tutor SKILL.md templates, beside the response-length rule:

> **Explain on the second ask.** If the student asks you to explain the same thing
> twice, or says they don't understand ("forstår ikke", "forklar", "hvad betyder"),
> stop asking and explain it: two or three plain sentences, one everyday example,
> no new symbols. Then ask one short question to check. This applies to concepts,
> definitions and relations (e.g. T = 1/f). It never applies to the product the
> activity asks them to make — hypothesis, drawing, measurements, conclusions.

This is a boundary on how the approach runs, not a register, so it sits with the
safety-style rules and not in the framework preamble ([1.1.111](register-belongs-to-the-approach.md)).
Check it against each of the seven approaches' own "explain" moves before
shipping. ESRU and 5E both have an *Explain* phase already.

### M1 — class year shapes vocabulary, not pedagogy (~0.4d) · wants JB

`Class.year ∈ {1g, 2g, 3g, other}` (optional, set on the class). It adds one line
to the prompt: *"Eleverne går i 1.g: brug hverdagsord, forklar fagord første gang
de bruges, højst ét symbol pr. svar."* It changes **vocabulary and density only**.
Approach, moves and what may be handed over stay with the approach. `cohort`
exists but is a rollout tag, so don't overload it.

### M2 — eval from the room (~0.3d)

Anonymised from 22 September:
- pink-garden sequence → by the 2nd ask, the reply contains `T = 1/f` or equivalent.
- *"Bare lav den"* (hypothesis) → no hypothesis written.
- *"kan du tegne vores tegneserie"* → refusal plus a way forward.
- *"Jeg forstår ikke det andet du sagde"* → a restatement with no new symbols.

## Open questions

1. **For JB / Tabita:** is "explain on the second ask" the right threshold for
   1st-years, or should it be the first explicit *"forklar"*?
2. Does a class year belong on the class, or on the activity (a 3g teacher
   reusing a 1g activity)? Class is proposed because it describes the students,
   not the task.
