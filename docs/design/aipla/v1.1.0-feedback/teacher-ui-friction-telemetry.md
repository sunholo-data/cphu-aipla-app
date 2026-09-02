# The UI is hard and we cannot see where — friction telemetry for teacher surfaces

**Status**: **Design (OPEN)** — **1.1.96**
**Priority**: **P1** — a usability problem reported by the people who have *already adopted* the tool, and we have no instrumentation to locate it. Un-gated by any legal blocker, which makes it one of the few P1s that can run during the compliance wait
**Estimated**: ~2–3d (M0 friction events ~1d · M1 the funnel view ~0.75d · M2 first fixes ~1d, sized after the data)
**Scope**: Frontend — a small, privacy-preserving interaction-event emitter on teacher surfaces; backend — an events sink alongside the shipped chat-log pipeline; a researcher/M-facing funnel view
**Dependencies**: `useDocInteractionReporting.ts` (**SHIPPED** — the nearest existing pattern); the chat-log/BigQuery pipeline (**SHIPPED** — the sink shape to copy); [1.1.9 cost-dashboard](cost-dashboard.md) (**SHIPPED** — where an ops-facing view already lives)
**Created**: 2026-09-02
**Source**: [meeting transcript](../../../09-01_Weekly_Meeting_AI_Education_Platform_Data_Compliance_and_Teacher_Feedback-Summary.md) — *"Teachers find the UI difficult, which could be considered a bug. Usage analytics are needed to identify friction points."* Missed by the dictated notes; flagged in the transcript's own AI-suggestions as having no owner

## Problem Statement

> **Teachers find the UI difficult, which could be considered a bug.**

That sentence is doing a lot of work and it deserves to be taken literally.

**Who is saying it matters.** This is not a stranger bouncing off a landing page.
These are teachers who have adopted the builder, published activities, run a
pilot session with 22 groups, and returned with a 28-item feedback list that was
*mostly ergonomics*. The 21-August triage already recorded the shift: they had
stopped asking whether they could build activities and started complaining about
how it *feels* to build them. This is the same signal, said plainly.

**And we cannot act on it**, because every piece of evidence about the UI is
anecdotal. There is no instrumentation on any teacher surface. We know from the
pilot how many turns students took and what they cost; we know **nothing** about
where a teacher stalled, retried, abandoned, or quietly gave up. So the standing
response to "the UI is hard" is to guess, ship a guess, and ask again in a month.

**This item was also the meeting's own blind spot** — the transcript's
AI-suggestions section flags that the UI was called difficult and *"no action was
assigned to investigate or redesign it."* Assigning it is most of the fix.

### Why this is unusually well-timed

Both legal gates (Google agreement, Prøvebanken) block work involving
**students**. This item involves **only teachers**, who are already using the
system under whatever basis the pilot ran on. It is one of the few P1s that is
not waiting on JB, and it produces the evidence the *next* round of UI work needs.

## Design

### M0 — Friction events, deliberately small

Not analytics-for-its-own-sake. A short, closed list of events that answer
specific questions, emitted from teacher surfaces only:

| Event | The question it answers |
|---|---|
| `surface_open` / `surface_abandon` (+ dwell) | Where do teachers arrive and leave without completing? |
| `action_retry` — same action ≥2× within a window | What are they fighting? |
| `validation_error_shown` | What does the system refuse, and how often? |
| `copilot_proposal_{applied,edited,dismissed}` | Is the co-pilot helping or being ignored? |
| `save_{success,failure}` | The 21-August autosave complaint, but measured |
| `help_opened` / `guide_opened` | What do they look up, i.e. what is not self-evident? |

**Privacy posture, non-negotiable.** Teacher identity is pseudonymous (the
existing uid), **no keystrokes, no field contents, no student data**, and the
event list is a closed enum — never free text. Teachers must be **told this is
on**: they are professionals being measured at work, and the trust-card principle
this project applies to students applies at least as much to them. It also has to
survive the same governance conversation everything else does, so it should be
designed to be defensible on day one rather than retrofitted.

### M1 — The funnel view

The specific questions worth answering first, from the pilot and 21-August
feedback:

- **Create a class → mint a code → build an activity → publish.** Where does that
  fall off? This is the path every new teacher walks.
- **Time-to-first-activity** for a newly granted teacher. The single best
  onboarding number, and we do not have it.
- **Co-pilot Apply rate.** Teachers were given a propose→Apply partner precisely
  so nothing happens without their click. If the dismiss rate is high, the
  proposals are wrong; if Apply is near-total, they may be rubber-stamping.
- **Retry hotspots**, ranked. The direct answer to "which bit is hard".

### M2 — Fix what it finds

Deliberately unsized until M1 has data. **Sizing this now would be the same guess
the instrumentation exists to replace.**

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Friction-event emitter + sink, teacher surfaces only | ~1d | Tell teachers |
| M1 | Funnel + retry-hotspot view | ~0.75d | None |
| M2 | Act on findings | ~1d placeholder | **M1 data** |

## Testing

- No event carries free text, field contents, or student data — asserted structurally over the enum
- Events are absent on **student** surfaces (a lint or test, not a convention)
- A teacher who has opted out emits nothing
- The sink degrades silently: an events failure never breaks a teacher action
- Dwell time is not recorded for a backgrounded tab (a teacher who left the tab open is not "stuck")

## Open questions

1. **Opt-in or opt-out?** Opt-in is more defensible and will under-sample the
   frustrated teacher — who is exactly the one to hear from. Leaning
   opt-out-with-clear-notice, but this is a JB conversation.
2. **Does this need to wait for the data agreement?** It is teacher, not student,
   data — but it is still personal data of an identifiable professional. **Ask
   rather than assume**; the assumption is the failure mode this project keeps
   hitting.
3. **Is "the UI is difficult" one problem or many?** Possibly the builder, the
   materials picker and the class page are three unrelated complaints wearing one
   sentence. M1 should be able to tell them apart.
4. Does the existing `useDocInteractionReporting` generalise, or is it
   document-specific enough that a second mechanism is honest?
