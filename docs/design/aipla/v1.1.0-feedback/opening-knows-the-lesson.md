# The opening greeting knows what the lesson is about

**Status:** **SHIPPED** (2026-08-10, sprint PILOT-1) — was Design (OPEN), P1. Written 2026-08-10 from Aswin's 2026-08-10 feedback.
**Priority:** **P1** — smallest fix in the batch and the highest first-impression-per-hour. It is the *first thing* every student sees, and it currently announces that the tutor has no idea what today is about.
**Estimated:** ~0.4d (M1 pass the activity context in ~0.25d · M2 eval + no-activity fallback ~0.15d)
**Scope:** Backend only — [`adk/proactive_greet.py`](../../../../backend/adk/proactive_greet.py) `inject_opening_guidance` takes the resolved `ActivityConfig`; the opening template gains the lesson's topic. No frontend, no schema.
**Dependencies:** [1.1.62 workbench-element-awareness](workbench-element-awareness.md) (**SHIPPED** — `resolve_active_config` is already called at agent build, so the data is in scope at the call site); 1.I-PhA proactive greet (**SHIPPED** — the mechanism)
**Source:** Aswin, 2026-08-10 — *"Jonas, the AI teacher, always starts the conversation with this even though the lesson is about wave: 'Hej! Velkommen til fysikchatten. Hvilket emne eller fysikbegreb har du lyst til, at vi skal undersøge sammen i dag?' After students start to chat, then he tells students that the lesson is about wave."*
**Created:** 2026-08-10 (M)
**Last Updated:** 2026-08-10 (M)

## Problem Statement

**The greeting is composed without the activity.**

```python
def inject_opening_guidance(
    instructions: str,
    *,
    proactive_greet: bool,
    opening_template: str | None,
) -> str:
```

That is the whole signature. It appends a static, skill-authored `## Opening`
block — no `ActivityConfig`, no teaching goal, no element manifest. So the
opening turn is generated from a template that cannot mention the lesson,
producing a tutor that asks the student *"what would you like to explore
today?"* for an activity whose topic the teacher set explicitly.

The tutor **does** know, one turn later: `{teacher_focus}` carries the teaching
goal, the element manifest and (since 1.1.62) the ILOs. The information is
present and simply arrives after the greeting has already been said.

### Why it reads worse than it is

The synthetic greeting turn is fired by `POST /api/sessions/{id}/greet` before
the student has typed anything, so the opening is the **only** turn generated
with no conversational context. Every subsequent turn is well-informed. The
result is a tutor that appears to forget the lesson and then remember it — the
same *shape* of complaint as [1.1.70](progress-conversation-lifetime.md), from a
different cause, which is probably why Aswin reported them together.

It also wastes the strongest moment the tutor has. *"Hi — today we're looking at
standing waves on a string. Have you set the apparatus up yet?"* orients a
student in one line. *"What shall we explore?"* invites them to pick something
the teacher did not author, which the tutor will then have to walk back.

## Goals

**Primary:** The first turn names the lesson and points at the first thing to do.

**Success metrics:**

- With a teaching goal set, the opening turn names the topic.
- With workbench elements authored, the opening points at the first one
  (composing with 1.1.62's manifest rather than duplicating it).
- With **no** activity resolved, the greeting degrades to exactly today's
  generic wording — no regression for chat-only or unconfigured skills.
- The opening honours the activity language (1.1.63 M2).

**Non-goals:**

- Redesigning the greeting's tone or the `opening_template` mechanism.
- Making the greeting summarise the whole activity. One or two sentences.
- Reading student state — at greet time there is none by definition.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Same single turn; the config is already resolved at agent build. |
| 2 | EARNED TRUST | +1 | A tutor that opens by naming the lesson is visibly prepared. Asking what to explore, then overriding the answer, is the opposite. |
| 3 | SKILLS, NOT FEATURES | +1 | The skill's own opening template gains a substitution; no new concept. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Same greet call, better prompt. |
| 5 | GRACEFUL DEGRADATION | +1 | No config, no goal, or no template → today's behaviour exactly. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses the shipped `{teacher_focus}` composition rather than a second context path. |
| 7 | API FIRST | 0 | No new endpoint. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Existing greet logging. |
| 9 | SECURE BY CONSTRUCTION | 0 | Config already resolved through the student's verified group binding. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Server-side. |
| 11 | USABLE BY DESIGN | +1 | The first sentence a student ever reads. |
| | **Net Score** | **+5** | Threshold: >= +4 |

## Framework-Native Capability Check

- **The data is already in scope.** `create_agent` resolves `_active_cfg` at
  line ~437 and the opening wrapper is applied in the same function. This is a
  parameter-passing fix, not a plumbing one — no new lookup, no extra Firestore
  read.
- **The composition already exists.** `compose_teacher_focus` builds the goal +
  manifest block. The opening should *reference* what the tutor has been given,
  not restate it — restating would duplicate content in the same prompt and
  spend the budget twice.

## Design

`inject_opening_guidance` takes the resolved config and substitutes an
activity-aware block into the opening template:

```
## Opening
Open by naming what today's activity is about and pointing at the first thing
to do. Do NOT ask the student to choose a topic — the teacher has already set
one. Two sentences at most, then one specific question.

Today's activity: {title}
What it is for: {teaching_goal, first ~200 chars}
First thing on the workbench: {first element, if any}
```

Bounded deliberately — the greeting shares the same prompt budget as everything
else, and the tutor already receives the full goal and manifest through
`{teacher_focus}`. This block exists to tell it *what to say first*, not to
re-deliver context it has.

**Language:** composed after the 1.1.63 M2 directive so an English activity
opens in English. Worth an explicit test — the greeting is the one turn with no
student message to infer from, so it is the most likely place for the language
to fall back to Danish by default.

### Degradation

| Case | Behaviour |
|---|---|
| No `ActivityConfig` | today's generic greeting, unchanged |
| Config but empty `teaching_goal` | name the title only |
| `proactive_greet=False` or empty template | no-op, as now |

## Implementation Plan

- **M1** pass `cfg` into `inject_opening_guidance`; compose the block; bound it;
  update the skill templates' `## Opening` sections that assume no context (~0.25d)
- **M2** eval + degradation tests, including the language case (~0.15d)

## Testing Strategy

- **Backend:** greeting block absent with no config; names the title when set;
  bounded; composes after the language directive; `proactive_greet=False` is
  still a no-op.
- **The regression test:** an activity whose goal is about standing waves →
  assert the opening block contains the topic and does **not** contain a
  choose-your-own-topic instruction. That is Aswin's exact case.
- **Eval:** the greet turn for a wave activity opens by naming waves and asks
  something specific, rather than *"what shall we explore?"*.

## Success Criteria

- [ ] The first turn names the lesson topic
- [ ] It does not ask the student to choose a topic when one is authored
- [ ] It points at the first workbench element when there is one
- [ ] An English activity opens in English
- [ ] No activity → today's greeting, byte-identical
- [ ] Greeting block is bounded and does not duplicate `{teacher_focus}`

## Open Questions

1. ~~**Does the seeded `opening_template` need re-authoring per skill?**~~
   **ANSWERED 2026-08-10: yes — and for a second reason the question did not
   anticipate, which the Python change alone would not have fixed.**

   The expected conflict was real: `concept-dialogue` carried Aswin's reported
   sentence nearly verbatim (*"Otherwise ask what concept they would like to
   explore"*), and `kinebot` offered a choice of topic.

   The unanticipated one is worse. **Three of the four templates hardcoded the
   language** — *"Greet them briefly in Danish"*, *"Hils kort på dansk"*. The
   opening block is **appended after** the SKILL.md body that carries the
   [1.1.63 M2](tutor-register-citation-and-language.md) language directive, and
   this codebase's convention is that **later instruction wins** (see
   `inject_interaction_style_preamble`, which appends precisely so it can
   override the SKILL.md rule). So the templates silently beat the teacher's
   English setting, on the one turn with no student message to infer from —
   i.e. the success criterion *"an English activity opens in English"* would
   have failed with the code change alone, and failed invisibly.

   Templates now defer to the directive, and
   `test_no_opening_template_hardcodes_a_language` fails on any future
   *"in Danish"* / *"på dansk"*. **All four changed → `make seed ENV=<env>` per
   environment.**
2. **Should the greeting mention inherited progress?** It overlaps
   [1.1.70 M2](progress-conversation-lifetime.md). Proposed: 1.1.70 owns the
   continuity line; this doc owns the topic. If both fire, the opening says the
   topic and the continuity line handles the rest — worth checking they do not
   read as two greetings.

## Related Documents

- [workbench-element-awareness.md](workbench-element-awareness.md) — 1.1.62, the manifest this references
- [tutor-register-citation-and-language.md](tutor-register-citation-and-language.md) — 1.1.63 M2, the language directive the greeting must honour
- [progress-conversation-lifetime.md](progress-conversation-lifetime.md) — 1.1.70, the overlapping continuity line
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's feedback
