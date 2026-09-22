# Opening guidance only on the opening turn — the greeting re-emitted mid-conversation

**Status:** **M0 + M1 SHIPPED (dev) 2026-09-22** — M2 (frontend skip races), M3 (model eval), M4 (authored opening) open — **1.1.127**
**Priority:** **P1** — student-visible in 2 of 6 active groups on 2026-09-22; also the likely explanation for the September "greeting regression" (item 11) that [opening-knows-the-lesson](opening-knows-the-lesson.md) was marked SHIPPED against
**Estimated:** ~1–1.5d (M0 greet-turn-only injection ~0.3d · M1 first-turn-without-greet block ~0.2d · M2 frontend races ~0.3d · M3 eval owed since item 11 ~0.3d · M4 authored opening message, optional ~0.5d)
**Scope:** Backend — `adk/agent.py` (~862), `adk/proactive_greet.py`, `adk/teacher_focus.py`, `protocols/proactive_routes.py`. Frontend — `app/chat/[...path]/page.tsx` (~753), `lib/proactiveGreet.ts`, composer gating
**Dependencies:** [1.1.72 opening-knows-the-lesson](opening-knows-the-lesson.md) (**shipped** — the activity facts in the block; its eval and success criteria are still unticked); [meeting-2026-09-09-triage](meeting-2026-09-09-triage.md) item 11 (*"investigate, do not design… the fix ships with an eval"* — this is that investigation). **Un-gated**
**Created:** 2026-09-22
**Source:** [classroom-session-2026-09-22-followups.md](classroom-session-2026-09-22-followups.md), finding 2

## Problem Statement

The teacher authored a Danish opening for "Den svingende streng":
*"Hej med jer - I kan bruge mig til at få hints og til at få feedback på jeres
arbejde med forsøget og spillepladen. Ovre til højre kan I notere…"*.
It was correctly sent as the opening turn in 7 groups. But:

- **`bold-kazoo-64`, turn ~20, 14:47:51** — an ordinary reply about a comic-strip
  caption began with the full greeting, then answered.
- **`shy-mouse-65`** — no `[session_start]` turn was logged. The student's first
  message was a real question; the reply was greeting + answer.

### Mechanism (verified 2026-09-22)

**The opening block is part of the system instruction on every turn.**
`adk/agent.py:~862` calls `inject_opening_guidance(…, cfg=_active_cfg)` inside
the static instruction composition, with no check on the turn. The agent is
rebuilt per request (`skill_processor.py:312`). The block
(`proactive_greet.py:31-52`) reads:

> *The student has just joined this session. They have NOT yet sent a message.
> You are speaking first — your reply will be the first thing they see.*
> …
> *Once you have produced your opening turn, ignore this guidance on subsequent turns.*

The only guard is the last sentence, a request for the model to work out that
it has already greeted — under a block that is flatly false on every later turn,
placed late in a prompt whose convention is "later instruction wins".
`gemini-3.5-flash-lite` (the prod model since ~09-11) honours it most of the
time, not all of it.

**What tipped `bold-kazoo-64` over: compaction.** The model can only "work out
that it has already greeted" if its greeting is still in the history it sees.
In that session `token_in` climbed steadily to **11,029** at turn 99 (14:44:56),
the compaction summarizer ran — and hit a Gemini `500 INTERNAL` at 14:44:22
(`adk/compaction_summarizer.py`, non-stream) — and the very next turn (105,
14:47:51) went in with **6,611** tokens and came back as the greeting.
Compaction replaced the early turns, including the greeting, with a summary;
the only remaining statement about the conversation's state was the opening
block saying *"they have NOT yet sent a message"*. So the two defects compose:
the every-turn block is the cause, and compaction removes the only thing that
was masking it. Any conversation long enough to compact is exposed — the
groups doing the most work are the ones that see it.

The authored greeting is reachable twice per turn: through the block's
`- What it is for: {clip(teaching_goal, 400)}` line (`proactive_greet.py:102-104`)
and in full through `{teacher_focus}` (`teacher_focus.py:342-343`). There is no
dedicated opening-message field on `ActivityConfig`, so greeting text written
into the teaching goal is presumed to be where this one lives.
*To verify:* read the activity's `teachingGoal` on prod
(`activity_configs/{teacher}:{class}:act-1f2e8d4e6cdedb9c`).

**Why `shy-mouse-65` had no greet.** Every path that skips it is silent — no log
row, while the "you are speaking first" block stays in the prompt:

1. The greet fires only when the URL has no `?session=` at mount
   (`page.tsx:753`) — a reload, a shared link or the anon-group resume path skips it.
2. The ALS-1 active-session fetch can write `?session=` after mount, marking the
   in-flight greet superseded (`proactiveGreet.ts:124-127, 163-165`) without aborting it.
3. The composer is not disabled during the greet; a student turn that arrives
   first makes the greet hit `TurnLockedError` or `turn_count > 0`
   (`proactive_routes.py:146-160, 229-235`) and skip.
4. A groupmate's turn holding the (group, activity) lock does the same.

## Goals

1. The opening block is in the instruction **only** for the `[session_start]` turn.
2. A first student turn with no prior greet gets a block that is *true* ("this is
   their first message; a short hello if you like, then answer them") —
   never "they have not sent a message".
3. A greet skip is logged with its reason.
4. The eval promised in item 11 exists and runs.

## Design

### M0 — inject on the greet turn only (~0.3d)

Move `inject_opening_guidance` out of the static composition into a per-turn
instruction provider (the `wrap_with_iframe_context` shape), emitting the block
only when `callback_context.user_content` is the `[session_start]` sentinel —
`tag_proactive_span_from_callback_context` already detects it. Simpler
alternative: `create_agent(…, is_greet=True)` passed from `proactive_routes.py`.

Unit test: the composed instruction for a non-sentinel turn does not contain
`OPENING GUIDANCE`.

### M1 — the first turn without a greet (~0.2d)

When the session has no prior model turn and the message is not the sentinel,
emit a short, true block: *"This is the student's first message. Greet in one
short clause if natural, then answer what they asked."* The authored greeting is
not repeated here — it is long and about the workbench, not the question.

### M2 — close the silent skips (~0.3d)

- Disable (or queue) the composer while `greetLoading`.
- Fire the greet only after the ALS-1 active-session fetch resolves; abort a
  superseded POST.
- Log `greet.skipped reason=<turn_locked|already_started|spend|superseded>` server-side.

### M3 — the eval owed since item 11 (~0.3d)

Three cases in the tutor evalset: (a) turn 5+ in a session whose teaching goal
contains a greeting does not start with it; (b) a first student question with no
`[session_start]` is answered and not prefixed with the authored greeting;
(c) the existing lesson-naming greet case. Then tick the success criteria in
[opening-knows-the-lesson](opening-knows-the-lesson.md) or mark them failed.

### M4 — an authored opening message, optional (~0.5d)

Teachers are writing greetings into the *teaching goal* because there is nowhere
else to write them. An explicit `ActivityConfig.opening_message` (verbatim,
teacher-authored) could be emitted by the server as the first assistant event
with no model call — deterministic, no race, no cost — and would keep greeting
text out of `{teacher_focus}` on every turn. Decide with JB whether teachers want
to write the opening verbatim, or want the tutor to compose it from the goal.

## Rejected

**Strip a duplicated prefix in `after_model`.** Treats the symptom; M0 removes
the cause. Keep it only if M0 is delayed past the 28 September session.

## Open questions

1. Is the greeting text really in `teachingGoal`, or in a note element / context
   material? Changes whether M4 needs a migration of existing activities.
2. **Compaction lands after ~20 exchanges in a workbench-heavy session**
   (`bold-kazoo-64`), well short of the 250k-token threshold — the
   `compaction_interval=40` trigger (`adk/session.py:85-89`) fires first. Is
   that intended for tutoring sessions that run a full lesson? Out of scope
   here (M0 makes the greeting safe either way), but worth a look by whoever
   next owns compaction (`adk/compaction_summarizer.py`, upstream sprint
   COMPACTION-WIRE) — and the summarizer's 500 today
   needs to be confirmed as either retried or a clean no-op, not a silent loss.

## What shipped — M0 + M1, 2026-09-22

- `adk/proactive_greet.py`: `wrap_opening_guidance_per_turn`, placed right after
  `wrap_with_iframe_context` in the provider chain. The iframe wrapper must
  receive the base string; this one resolves either a string or a provider.
  - On the `[session_start]` turn the block is kept.
  - On the first student turn with no stored tutor event, it is replaced by a
    short `FIRST MESSAGE` block that is true.
  - Otherwise it is removed.
  - "Has the tutor spoken" reads the **stored** events, so a compacted
    conversation is not mistaken for a new one.
- `inject_opening_guidance` is unchanged; the transform happens after it, so
  its tests and the greet route are untouched.
- **Tests:** `tests/unit/test_opening_guidance_per_turn.py` (the transform
  against the real composed block, all three turn kinds, and the compacted
  `bold-kazoo-64` shape) and a wiring test in `test_create_agent.py` that
  resolves a real agent's instruction. The wiring test fails with the wrapper
  removed.
- **Not done:** M3's model-level eval. The unit tests prove the model is no
  longer *told* it is speaking first; they do not prove how flash-lite behaves.
  Also not done: the M2 frontend races, and M4.
