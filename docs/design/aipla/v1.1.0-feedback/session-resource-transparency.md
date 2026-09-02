# What this session cost — resource use in units a physics class can read

**Status**: **Design (OPEN)** — **1.1.94**
**Priority**: **P2** — small, and unusually well-aligned with the subject being taught
**Estimated**: ~1.5–2d (M0 per-session accounting ~0.5d · M1 energy conversion ~0.5d · M2 student surface ~0.75d)
**Scope**: Backend — per-session resource aggregation over the shipped token/cost telemetry, plus an energy conversion with a cited factor; frontend — a student-facing and a teacher-facing readout
**Dependencies**: [1.1.9 cost-dashboard](cost-dashboard.md) (**SHIPPED despite a "Planned" header** — `/teacher/insights/cost`; this reuses its data, in different units and for a different audience); the OTel/BigQuery telemetry (**SHIPPED**); [1.1.5 researcher-role](researcher-role.md)
**Created**: 2026-09-02
**Source**: [notes-2026-09-01.md](../../../notes-2026-09-01.md) — *"how many resources have we used this session… for awareness to students and teachers — meaningful energy units. joules, watts, kWh"*

## Problem Statement

> **The dumb model was noticed, we needed a smarter one.**
>
> **How many resources have we used this session?**
>
> For awareness to students and teachers — **meaningful energy units. Joules,
> watts, kWh.**

Two audiences, two gaps.

**Teachers** have a cost dashboard, and it ships (`/teacher/insights/cost`) —
though its design doc still says "Planned", which is its own small lesson. It
reports **USD**, aggregated **per class over a period**. Neither the unit nor the
grain answers *"what did this session use?"*.

**Students have nothing at all**, and they are the interesting audience. The
transcript gives the purpose the dictated notes lost — it is framed as **AI
literacy**, not as cost control, which changes the design: the goal is that a
student understands what running a model consumes, so the number is a *teaching
object*, not a budget warning. This is also a **physics course**. Joules, watts and kilowatt-hours are not a sustainability
garnish here — they are **the unit of the subject being taught**. A tutor that can
tell a student the conversation they just had used *X* kJ is doing something no
generic chat product has any reason to do, and it converts an invisible externality
into a worked example in the exact vocabulary of the syllabus.

That is also why the honesty bar is high: **a physics class is the worst possible
audience for a number you cannot derive.**

## Design

### M0 — Per-session accounting

Aggregate what is already logged — prompt and completion tokens, model tier, tool
calls, TTS synthesis — into a per-session record. All of this exists in the
telemetry; the gap is grain and rollup, not instrumentation.

Recording the **model tier** also answers the meeting's other remark: *"the dumb
model was noticed"* becomes checkable — which surface used the fast tier, how
often, and whether that choice was right.

### M1 — Energy conversion, with the factor exposed

Tokens → energy needs a published factor (Wh per 1k tokens by model class). The
number is an **estimate**, and the design's central commitment is to say so
everywhere it appears:

- the factor and its **source and date** are config, not a constant buried in code
- every displayed figure carries its basis — *"≈, based on <source>"*
- **no false precision.** "≈ 12 kJ" and never "11.83 kJ"
- when the factor is unknown for a model, show **nothing** rather than a guess —
  the sixth instance of this project's signature bug would be a confidently wrong
  number in a physics lesson

⚠️ **The factor does not exist in the repo and must be chosen.** Published
estimates vary by more than an order of magnitude, and providers do not publish
per-query figures. Options: a cited public estimate, a KU-supplied figure, or
declining to convert and reporting tokens and time only. **This is a real
decision, not a lookup.**

### M2 — The surfaces

**Student** (the new one): a small, non-nagging readout at session end — *"this
conversation used about X kJ — roughly a Y-watt bulb for Z minutes."* Framed as
information, never as a scold, and never as a reason not to ask a question.

**Teacher**: per-session and per-class energy alongside the existing USD, on the
shipped dashboard.

**Researcher**: per-arm energy in 1.1.92's matrix — a smarter tutor that scores no
better but costs three times the energy is a finding.

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Per-session resource record incl. model tier | ~0.5d | None |
| M1 | Energy conversion, factor in config, honest rounding | ~0.5d | **Factor source** |
| M2 | Student readout + teacher/researcher surfaces | ~0.75d | Copy review — student-facing |

## Testing

- A session with a known token count converts to the expected figure for a pinned factor
- An unknown model shows tokens only, **never an invented conversion**
- The student readout renders on a ~700px viewport (Axiom 11)
- Changing the factor in config changes displayed values with no code change
- The readout is absent for a session with no turns, rather than showing zero

## Open questions

1. **Which factor, and whose?** The whole doc rests on it. A KU-supplied figure
   would be the most defensible and is worth asking for.
2. **Does showing cost suppress asking?** A student who stops asking questions to
   save energy is a **pedagogical regression**, and the point of the feature is
   awareness, not thrift. Worth asking teachers before shipping M2's student half.
3. **Per group or per student?** Per group — ADR-001, and there is no per-student
   attribution to build on.
4. Should this include **sim compute and TTS**, or model inference only? Including
   them is more honest and harder to source factors for.
