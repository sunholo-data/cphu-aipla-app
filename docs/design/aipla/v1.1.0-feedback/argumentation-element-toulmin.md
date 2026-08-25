# Argumentation element — Toulmin structure in the workbench

**Status**: Planned
**Priority**: P1
**Estimated**: ~3–4d (an element, not a platform change)
**Scope**: Fullstack — a workbench element + tutor wiring + authoring
**Dependencies**: [1.1.38 activity-elements-palette](activity-elements-palette.md) (the element registry + add-element recipe), [1.1.79](pilot-session-2026-08-21-followups.md) (the element↔backend parity gate this must pass)
**Created**: 2026-08-25
**Last Updated**: 2026-08-25

## Problem Statement

From M's 17 August notes, the most developed single idea in either notes file
and the only one with a named academic frame:

> *"simulations run on workbench where you construct arguments stephen toulmin approach to argumentation*
> *— claim*
> *— data*
> *— warrant - theory part*
> *— qualifiers*
> *— rebuttals*
> *make it into a puzzle*
> *concept map connection*
> *crtiical thinking in experiments paper"*

Nothing in `docs/design/aipla/` covers argumentation — I grepped every milestone
folder. The workbench today has table, chart, calculator, checklist, note,
solution, writing and (planned) question-set. All of them capture *what a
student did*. None captures *why they think it is true*, which is the thing
physics assessment actually cares about and the thing the tutor is best placed
to interrogate.

**Why it fits AIPLA specifically.** Toulmin's structure is a set of named,
separately-assessable slots — and a tutor that can see which slot is empty can
ask a much better question than one looking at a paragraph. "You have a claim
and data but no warrant" is a teachable moment the platform can detect
structurally. That is the same insight behind the checklist's empty-element
guard in [1.1.69](tutor-sees-element-state.md): structure the student's work so
the tutor can reason about its shape, not just its text.

## Design sketch

Deliberately a sketch. AR and JB own the pedagogy here; this records the
technical shape so the conversation has something concrete to react to.

### The element

An `argument` element with five named slots — **claim, data, warrant,
qualifier, rebuttal** — as a first-party workspace element, alongside
table/writing/calculator. Data and warrant are the load-bearing pair; qualifier
and rebuttal should probably be optional per activity, since a teacher may want
them only for older students.

Two authoring knobs worth having from the start: which slots are required, and
whether the student writes free text into each or assembles from provided
fragments (see "puzzle" below).

### "Make it into a puzzle"

M's note asks for a puzzle mode, and it is the more interesting half. Rather
than five empty boxes, the student is given a shuffled set of statements and
sorts them into the right Toulmin roles — which is a genuinely different
cognitive task (recognising a warrant vs producing one) and much easier to
assess automatically.

Both modes share one schema; the mode is a property of the activity. This
mirrors [1.1.78](question-set-element.md)'s decision to *derive* quiz-vs-survey
from the content rather than add a teacher toggle, and the same argument
applies: fewer modes to explain, one store, one set of tutor wirings.

### Tutor wiring

Per [1.1.79](pilot-session-2026-08-21-followups.md) and the palette recipe, a
new element is registered on **three** surfaces and all three are load-bearing:

1. `useSimSnapshotPush(sessionId, "argument")` — state to the tutor.
2. `"argument"` in `_WORKSPACE_ELEMENT_SERVERS` — or every push 403s silently. The parity test added in 1.1.79 will now fail CI until this is done, which is the intended behaviour.
3. A human-tool-use trust card — the student sees their argument reached the tutor.

The tutor-side value is the structural signal: an argument with a claim and no
warrant, or a rebuttal that does not engage the claim, is a specific prompt
rather than a generic "tell me more".

### "concept map connection"

The note links this to the concept map. The obvious join is that a **warrant is
a theory claim** — it is the slot where a student invokes a physical principle —
so a warrant naming a concept the map already tracks could mark that concept as
*applied*, not merely *mentioned*. That is a stronger progress signal than the
current concept marks. Worth exploring; not required for a first version.

### Assessment

Fits the existing rubric machinery ([1.1.57](competency-rubrics.md)) more
naturally than most elements, because the slots are already the criteria. A
rubric per slot is close to how argumentation is marked in practice.

## Open Questions

1. **Danish terminology.** *Claim/data/warrant/qualifier/rebuttal* have
   established Danish equivalents in didactics literature and the labels must
   use them. AR or JB to supply — this is not a translation task for us.
2. **Which slots for which age group?** Full five-part Toulmin is demanding for
   gymnasium level. Required-slots-per-activity is the proposed lever, but the
   defaults are a pedagogical call.
3. **Puzzle mode first or free-text first?** Puzzle is easier to assess and
   easier to seed; free text is closer to real physics writing. The 17 Aug note
   asks for the puzzle, which suggests it is the priority.
4. **Relationship to the writing element.** Both capture prose. If a teacher
   wants "write your conclusion", is that `writing` or a single-slot `argument`?
   Overlapping elements confuse the authoring surface.
5. **"crtiical thinking in experiments paper"** — M references a paper. Getting
   the citation would ground the slot definitions in whatever framework it uses,
   which may differ from Toulmin's original in the details that matter.

## Related Documents

- [activity-elements-palette.md](activity-elements-palette.md) — the registry and the three-surface recipe this must follow
- [question-set-element.md](question-set-element.md) — the derive-the-mode precedent
- [competency-rubrics.md](competency-rubrics.md) — per-slot assessment
- [tutor-sees-element-state.md](tutor-sees-element-state.md) — the structural-signal wiring
- [concept-map-sprint.md](concept-map-sprint.md) — the warrant↔concept link
- `docs/notes-2026-08-17.md` — the source ask
