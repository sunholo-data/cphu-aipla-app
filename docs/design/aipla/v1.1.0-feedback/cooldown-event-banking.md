# Cooldown event banking — proactive turns reference accumulated events

**Status:** Roadmap signal (NOT committed for v1.1)
**Priority:** P3 — pedagogical refinement; validate need from pilot session reviews before building
**Estimated:** ~1-3d depending on chosen depth
**Created:** 2026-06-03 (during M8 iteration on PROACTIVE-SIM-REACTIVE)
**Source:** User raised the idea during dev-session iteration after the 30s cooldown landed

## Current behaviour (v1.1, after sprint PROACTIVE-SIM-REACTIVE)

Workbench events during the 30-second proactive cooldown window are silently dropped at the `/proactive-event-check` gate (`shouldFire: false, reason: "cooldown active"`). When cooldown expires, the next eligible event triggers its own reactive turn.

**But the agent isn't blind to what happened during the window.** Every meaningful workbench commit pushes `mcp_app_context.<server>.*` state via `/iframe-context` regardless of the gate decision. So the agent's view of the workbench reflects the **latest cumulative state** when the next reactive turn fires:

- Current `v₀`, `θ`, `g` for Boldkast
- Which markers the student has revealed
- Which checklist items are done
- Whatever the artefact has emitted into structured-content

What the agent **does not** see explicitly:

- A chronological list of "during the last 30s the student also did A, then B, then C"
- The fact that the student pressed Afspil 4 times with different angles before this trigger fired
- The intent to vary parameters (vs. one-shot exploration)

The reactive turn's `[event_reactive:<kind>]` sentinel only names the LATEST event kind. Earlier actions during the cooldown window are visible as **state**, not as **history**.

## What this would add

Buffer the events that arrive during cooldown, then pass them to the next reactive turn as system context so the tutor can say:

> "Du har prøvet 30°, 45°, og 60° de sidste par sekunder. Hvad lagde du mærke til ved rækkevidden?"
> (You tried 30°, 45°, and 60° in the last few seconds. What did you notice about the range?)

vs. the current sentinel-shape which would only let the agent say:

> "Du fik 67m. Hvad sker der ved en stejlere vinkel?"
> (You got 67m. What happens at a steeper angle?)

The second is fine. The first is *richer* — references the iteration pattern, not just the latest data point.

## Three implementation depths

| Option | What it does | Complexity |
|---|---|---|
| **Status quo (v1.1 default)** | Latest event triggers; agent sees latest state only | None — already shipped |
| **Banked-events list** | Backend ring-buffer per session collects event kinds during cooldown; the next reactive turn's prompt includes a "recent events: A, B, C" block | ~1d. Server-side per-session memory + extend the proactive-sentinel injection to read it |
| **End-of-window batched turn** | Cooldown becomes a "collect window" — events accumulate during it, and a single reactive turn fires at end-of-window referencing all of them | ~2-3d. Needs server-side timer + change to the iframe-context-handler model + frontend behaviour change (no per-event trigger, polling or push for the batched turn) |

## When to build this

Decide AFTER pilot session reviews (post 2026-08-14). Triggers worth watching for in pilot:

- AR or JB reviewing session transcripts and noting "the tutor keeps saying *'you ran the sim'* each turn without acknowledging the variation pattern"
- Students reporting "the tutor doesn't notice when I'm experimenting"
- Quantitative signal: log how often a reactive turn fires for the SAME `triggering_event_kind` within a 5-minute window — high count = the agent is missing the iteration pattern

If pilot doesn't surface this, skip — the cumulative-state path already gives the agent most of what it needs to respond meaningfully. Don't pay complexity for unvalidated pedagogical gain.

## Why this lives here

Captured at the moment the design choice was made (2026-06-03) rather than after the pilot, so the rationale isn't lost when someone in the future asks "wait, did we consider banking events?" Yes — and we deliberately deferred it.

## Related

- [proactive-sim-reactive-tutor.md](implemented/proactive-sim-reactive-tutor.md) — the design doc whose architecture this would extend
- [implemented/proactive-sim-reactive-tutor-sprint.md](implemented/proactive-sim-reactive-tutor-sprint.md) — the shipped sprint
- ADR-005 (chat log storage) — the BQ tables that would surface "agent missed iteration" signal during pilot review
- [post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — the 2.5 rubric layer that could quantify whether the agent's reactive turns are richer-vs-shallow over time
