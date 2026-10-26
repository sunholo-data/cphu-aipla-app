# Explain on the second ask — calibrating the tutor for 1st-years

**Status:** **M0 BUILT (per-approach) 2026-10-26; values proposed, need JB/AR** — **1.1.129**. M1/M2 open
**Priority:** **P2** — no defect; a pedagogy calibration with direct evidence from the first 1st-year session. Needs JB (and ideally Tabita) before M1
**Estimated:** ~1d (M0 second-ask rule ~0.3d · M1 class year → register ~0.4d · M2 eval from today's transcripts ~0.3d)
**Scope:** Backend — `db/models/teaching_framework.py` (`explainPolicy`), `frameworks/instruction.py` (renders it), `backend/frameworks/*.yaml` (the values), generated tutor docs. M1: `db/models/class_.py` + teacher class settings. *(The original M0 targeted the SKILL.md templates; superseded 2026-10-26, see below.)*
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
4. *(2026-10-26)* Whether and when to explain is the **approach's** call, not
   the platform's.

## Design

### M0 — an approach-specific explain policy (~0.3d) · BUILT 2026-10-26

**Redesigned 2026-10-26.** The first draft put one platform-wide rule in the
student-tutor SKILL.md templates. M, reviewing it: *"explain on second ask —
isn't that teaching approach specific?"* It is. ESRU's *Use* move is defined
against the tutor explaining the correct idea itself; CER's teacher models and
explains the framework outright. One rule for all seven would be a second
pedagogy axis beside the approach — exactly what
[1.1.111](register-belongs-to-the-approach.md) removed for register. So the
policy is a field **of the approach**, rendered into the approach's own
instruction, and reviewed in the same preview as its moves.

**The field.** `TeachingFramework.explain_policy` (YAML `explainPolicy`),
optional:

| Value | Meaning |
|---|---|
| `hand_back` | Never explain the answer; hand the thinking back (ESRU-like). |
| `second_ask` | Hand it back once; explain when the student asks a second time or says they do not understand. |
| `first_ask` | Explain on request, then check understanding. |

**What the tutor receives.** `frameworks/instruction.py` appends one block
after the moves and before the register — heading *"When the student asks you
to explain"*, the value's prose, and a line common to all three: never hand
over the product the activity asks for (hypothesis, drawing, measurements,
conclusion). The `second_ask` / `first_ask` prose keeps the original shape:
two or three plain sentences, one everyday example, no new symbols, then one
check question. The prose is **language-neutral** — it names the situation
("asks you to explain", "says they do not understand") instead of matching
Danish trigger words, because which language the tutor speaks comes from
config ([1.1.108](content-localisation.md)). Custom approaches (1.1.110) may
carry the field too; it renders after their prose.

**Passthrough.** An absent field renders nothing: the instruction is
byte-identical to before the field existed
(`test_passthrough_absent_policy_is_byte_identical`, per framework, and for a
custom approach). A tutor with no framework — every base tutor — is unchanged.

**The values — proposed, for JB/AR review.** Each chosen from that YAML's own
constructs and `avoid` lists:

| Framework | Value | Why (from its own YAML) |
|---|---|---|
| `esru` | `hand_back` | *Use*: "a tutor that answers by explaining the correct idea itself is IRE/F Feedback, not Use". |
| `poe` | `second_ask` | *Explain*: "ask the student to explain the difference rather than explaining it yourself" — student first, but a needed concept is not withheld forever. |
| `5e` | `second_ask` | Explore precedes explain, and "answering immediately" is in `avoid` under two phases; the phase still ends in an explanation. |
| `cer` | `first_ask` | *Make the framework explicit* / *model and critique*: the teacher explains and models what a claim, evidence and reasoning are — the method on request, never the answer. |
| `cer-components` | `first_ask` | Same as `cer`; its `avoid` ("restating the student's claim in better words") bars handing over the answer, not explaining the method. |
| `toulmin` | `second_ask` | `avoid`: "naming the underlying principle for the student **before asking whether they can**" — ask first, then name it. |
| `accountable-talk` | `second_ask` | Reasoning: "turn a question the student asked back to them **before answering it**". |
| `accountable-talk-moves` | `second_ask` | Same move ("What do YOU think?"), and its `avoid` warns against using it "to avoid answering a question the student actually needs answered". |
| `authentic-dialogue` | `second_ask` | `avoid`: closing a disagreement with the authoritative answer "**as soon as it appears**" — not ever, not at once. |
| `authentic-dialogue-three` | `second_ask` | Same as `authentic-dialogue`. |

The 22 September `pink-garden-04` sequence would now behave differently under
any `second_ask` or `first_ask` approach, and **the same** under ESRU — which
is the point: if JB/AR think ESRU should still explain a definition like
`T = 1/f`, that is a change to `esru.yaml`, not to the platform.

**Built.** `db/models/teaching_framework.py` (the field) ·
`frameworks/instruction.py` (`_explain_block`) · every YAML in
`backend/frameworks/` · `scripts/generate_tutor_docs.py` (an *Explain policy*
line on the design doc) · `tests/unit/test_framework_explain_policy.py`. The
tutor instruction for all ten published frameworks gained the one block
(visible in the regenerated `docs/design/aipla/tutors/*.md`); nothing else in
it changed.

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

Since M0 is per-approach (2026-10-26), the first and last cases are run per
`explainPolicy`: `second_ask` / `first_ask` tutors must explain, a `hand_back`
tutor must not — and every policy must pass the two "never the product" cases.

## Open questions

1. **For JB / AR (and Tabita):** are the per-approach values above right? In
   particular: should ESRU really never explain a *definition*, and should 5E's
   Explain phase be `first_ask`? (Was: is the second ask the right threshold for
   1st-years — now answerable per approach.)
2. Does a class year belong on the class, or on the activity (a 3g teacher
   reusing a 1g activity)? Class is proposed because it describes the students,
   not the task.
