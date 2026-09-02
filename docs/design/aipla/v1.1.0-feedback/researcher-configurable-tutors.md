# Tutors as research instruments — pedagogical frameworks a researcher can configure

**Status**: **Design (OPEN)** — **1.1.91**
**Priority**: **P1** — the mechanism is un-gated, and it opens the human gate `adk/authoring_framework.py` has been carrying since COPILOT-1
**Estimated**: ~3–4d (M0 persona bundle ~1d · M1 researcher override store ~1d · M2 authoring workflow + preview ~1d · M3 framework library ~0.5d)
**Scope**: Backend — a persona bundle resolving to the shipped `interaction_style` primitive, plus a Firestore override store for framework prompts; frontend — a researcher-facing persona editor with preview
**Dependencies**: [1.1.20 interaction-style](tutor-personas.md) (**SHIPPED** — `adk/interaction_style.py`, the primitive this bundles); `adk/authoring_framework.py` (**M0 static SHIPPED**; the M2 researcher override store this builds is named there as not-yet-built); [1.1.47](prompt-transparency-and-config.md) (the transparency/config direction); [1.1.5 researcher-role](researcher-role.md) (**SHIPPED** — the role that gates this)
**Created**: 2026-09-02
**Source**: [notes-2026-09-01.md](../../../notes-2026-09-01.md) — *"ESRU is another tutor… make this configurable for researchers"*, *"have a good workflow for creating tutor personas, with simulations and previews"*

## Problem Statement

> We have prompts for uploaded docs, activity prompt, and a tutor persona — and
> then we have **tutors** (authentic questions, student discipline etc.) —
> Jesper/Aswin to supply these. Then we can **A/B performance of tutors**.
>
> **ESRU** is another tutor (inquiry-based science education) — make this
> **configurable for researchers**.
>
> Have a good workflow for **creating tutor personas, with simulations and
> previews**.

**The pedagogy is currently in git, and the people who own it cannot write git.**

`adk/authoring_framework.py` says so in its own docstring, and it is worth
quoting because it is the clearest statement of the gap anywhere in the repo:

> *What is NOT here yet (later sprints): the researcher Firestore override store
> (1.1.50 M2 …). Until then the framework is the seeded SKILL.md, swappable by
> `make seed`.*
>
> ***Human gate:** the prompt + rubric below are a placeholder.*

So a researcher wanting to try ESRU, or a self-determination-theory framing, or
Dysthe's dialogic model, must ask M to edit a `SKILL.md`, commit it, deploy, and
seed. **That is not a research instrument; it is a feature request queue.** And
it is why an A/B of tutors has never run: the cost of creating the second arm is
a deploy.

### What ships, and what does not

| | State |
|---|---|
| `adk/interaction_style.py` (1.1.20) | **Ships.** Per-activity teaching-voice preamble, injected at agent-instantiation. `socratic` is a passthrough |
| The **persona bundle** (1.1.12) — style + voice + avatar + name | **Does not exist in code.** One comment in `agent.py` says a persona *"resolves down to this"*; nothing implements it. The `tutor-personas.md` header still reads "Planned" and is, for once, accurate |
| `adk/authoring_framework.py` M0 | **Ships**, static, placeholder prompt, human gate open |
| The researcher override store | **Not built** — named as 1.1.50 M2 |
| `revision`-stamped chat logs | **Ships** — the A/B arm key already exists |

## Design

### M0 — The persona bundle

Make real the thing `agent.py` already refers to. A persona is a named bundle:

```
Persona
  name, description
  framework          # esru | sdt | dialogic | socratic | custom
  interaction_style  # resolves to the SHIPPED primitive
  voice, avatar      # optional, existing TTS config
  prompt_override    # optional, from the M1 store
```

It resolves down to `interaction_style`, which stays the primitive. Nothing about
the existing injection seam changes — this is a layer above it, exactly as the
comment in `agent.py` anticipated.

### M1 — The researcher override store

The store `authoring_framework.py` names as missing: framework prompts in
Firestore, editable by a **researcher** (`role:researcher`, shipped in 1.1.5),
versioned, with the seeded `SKILL.md` as the fallback when no override exists.

**This is the item that opens the human gate**, and it is the one with real
leverage: after it, a new pedagogical framing is a form, not a deploy.

Reuses the ACL shape already established: researchers read across classes and now
write framework config; teachers select from what exists; students see none of it.

### M2 — Authoring workflow with preview

*"A good workflow for creating tutor personas, with simulations and previews."*

The preview is the load-bearing half. A researcher editing a prompt must see
what it does **before** it reaches a student:

- a scratch conversation against the draft persona, on a chosen activity
- side-by-side against the current persona, since the research question is nearly
  always comparative
- **no student data** — the preview runs on the researcher's own turns

### M3 — A starter framework library

Ship the frameworks named in the meeting as seeded, editable starting points:
**ESRU**, **SDT**, **dialogic/Dysthe**, plus *authentic questions* and *student
discipline* as described by JB/Aswin.

⚠️ **The content is not ours.** Each needs its framing written or approved by
JB/AR, and the names ESRU/Dysthe are phonetic transcriptions from the notes with
confidence recorded, **not verified citations**. M3 ships the slots; the text is
gated on the people who own the pedagogy. **M0–M2 are not gated on M3** — that
separation is deliberate and is the 1.1.78 lesson.

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Persona bundle resolving to `interaction_style` | ~1d | None |
| M1 | Researcher-editable framework store + versioning | ~1d | None |
| M2 | Persona editor with comparative preview | ~1d | None |
| M3 | Seeded framework library (ESRU, SDT, dialogic, …) | ~0.5d | **Content from JB/AR** |

## Testing

- An activity with no persona behaves byte-identically (passthrough, as `socratic` does today)
- A persona resolves to exactly the `interaction_style` preamble the primitive already injects
- An override in Firestore beats the seeded `SKILL.md`; absent override falls back cleanly
- A **teacher** cannot write framework config; a **researcher** can; a **student** sees neither
- Preview turns are not written to the chat log as student data

## Open questions

1. **Persona per activity, per class, or per skill?** The meeting implies
   per-activity ("preferred activities for which tutor"), which 1.1.92 needs to
   compare arms. Probably activity-level with a class default.
2. **Does a persona override a skill's `SKILL.md` voice, or compose with it?**
   1.1.20 chose *countermand* for non-Socratic styles. Consistency says countermand.
3. **Versioning granularity** — is an edited framework a new version (so old
   sessions stay attributable) or in-place? **1.1.92 needs the former**, or arms
   become unattributable retroactively.
4. Are ESRU / Dysthe the right names for what JB and Aswin mean? See
   [Terms I inferred](../../../notes-2026-09-01.md#terms-i-inferred).
