# 1.1.111 — Retiring the standalone teaching style

**Status:** SHIPPED (dev) 2026-09-11 · **Owner:** M · **Reviewed:** 2026-09-11
**Decided by:** M, 2026-09-11: *"retire the standalone styles."*
**Parent:** [researcher-configurable-tutors.md](researcher-configurable-tutors.md) (1.1.91) — this closes its **M6 clash gatekeeper** by removing the clash instead of policing it.

## The problem, measured

AIPLA had **two independent pedagogy axes**:

- **teaching approach** (ESRU, 5E, CER, …) — set on a tutor by a researcher
- **interaction style** (`socratic`, `concise`, `rigorous`, `warm`) — set on a
  *persona* or an *activity*, by someone who could not see the approach

Nothing connected them, and they disagreed. Every one of the seven approaches is
built substantially from moves that ask or elicit:

| Approach | ask/elicit moves |
|---|---|
| accountable-talk | 25 / 35 |
| toulmin | 25 / 37 |
| esru | 23 / 42 |
| 5e | 16 / 39 |
| poe | 14 / 29 |
| cer | 12 / 36 |
| authentic-dialogue | 9 / 20 |

Against which `concise` says *"Do not end with a follow-up question. Give the
student one concrete thing to do, then stop."* and `warm` says *"Offer a gentle
hint before asking anything"* — which does not soften an elicit-first approach,
it **inverts** it.

**Three of the ten live assignments on prod carried a real contradiction**
(2026-09-11):

| tutor | style | approach | |
|---|---|---|---|
| mikkel | `concise` | esru (23/42 ask-moves) | **worst case** |
| frida | `warm` | accountable-talk (25/35) | inverted order |
| sofie | `warm` | poe (14/29) | inverted order |
| astrid, henrik | `rigorous` | 5e, authentic-dialogue | mild |
| jonas + the four skill-bound | `socratic` | — | none; `socratic` injects nothing |

## Why the existing mitigation wasn't enough

`agent.py` already nested the framework call *outside* the style call, so on the
"later instruction wins" convention pedagogy won at runtime. That was the right
call and it was **not a fix**: the assembled prompt still carried both
instructions and left the model to referee them. A contradiction resolved by
ordering is still a contradiction in the text.

## The change

**The register is now a property of the approach** — `TeachingFramework.register`
(`concise` | `rigorous` | `warm` | `None`), rendered by
`build_framework_instruction` **after** the moves.

Last position is the strong one, which is correct *only* because the register is
no longer a separate choice: whoever set it was looking at the moves it has to
live with, in the same preview, in the same editor.

- `inject_interaction_style_preamble` is **out of the agent chain**. The style
  preamble files are unchanged and now serve the register — the texts were never
  the problem, their independence was.
- `None` is the default and the common case, and it is what makes this safe: an
  approach that says nothing about voice cannot contradict its own moves. It is
  also exactly what `socratic` did — inject nothing.
- `RegisterPicker` **warns on the known-bad combinations** at the moment of
  choosing, naming the contradiction rather than leaving it to be discovered in
  a transcript.
- The tutor card stops reading `"<tone> · <approach>"`. Naming a tone separately
  advertised a choice a teacher cannot make and implied it might disagree with
  the approach beside it — which in production it did.

## A column whose meaning changed

`chat_turns.interaction_style` now records **the approach's register**, not the
retired axis. Logging the old value would have put an inert field where evidence
goes, and the researcher lens ([1.1.109](researcher-chat-log-lens.md)) shows this
column.

⚠️ **Rows are not backfilled and the column was not renamed.** A row before
2026-09-11 records a separately-chosen style; a row after records a property of
the approach. Same reason TUTOR-5 gives throughout: a wrong label that looks like
evidence is worse than a null. Anyone comparing across that date must split on it.

## What transparency survives

1.1.32's standalone *"how teaching styles are enforced"* disclosure is gone with
the axis it explained. **The need it served is not**: a teacher must still be able
to see what the tutor is actually told. That now hangs off the approach, where
the register is part of the same generated text as the moves — which is strictly
better, because it shows the combination rather than one half of it.

## Open for a human

- **The three clashing assignments are still live.** Retiring the axis stops them
  contradicting from now on, because the style no longer reaches the prompt at
  all — but mikkel, frida and sofie now run with **no** register, where their
  persona previously gave them one. If any of those tutors should *keep* a voice,
  a researcher has to set it on the approach, and the picker will warn if it is
  one of the three that clashed.
- **Should a register be allowed at all on an elicit-heavy approach?** The picker
  warns and permits. Refusing is a pedagogical call, not mine.

## Files

| Path | What |
|---|---|
| `backend/db/models/teaching_framework.py` | `register` on the approach |
| `backend/frameworks/instruction.py` | renders it after the moves |
| `backend/adk/agent.py` | the standalone injection, removed |
| `backend/adk/tutor_resolution.py` | the chat log records the approach's register |
| `frontend/src/components/teacher/research/RegisterPicker.tsx` | the choice, with the clash warning |
