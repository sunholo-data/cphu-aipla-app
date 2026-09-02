# The UI is hard and we cannot see where — friction telemetry for teacher surfaces

**Status**: **Design (OPEN)** — **1.1.96**
**Priority**: **P1** — a usability problem reported by the people who have *already adopted* the tool, and we have no instrumentation to locate it. Un-gated by any legal blocker, which makes it one of the few P1s that can run during the compliance wait
**Estimated**: ~2.5–3.5d (M-1 client errors ~0.5d · M0 friction events ~1d · M1 the funnel view ~0.75d · M2 first fixes ~1d, sized after the data)
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

## First finding, before any design: **we have no client error visibility at all**

Checked 2026-09-02. `frontend/package.json` has **no** error-reporting dependency
— no Sentry, no PostHog, nothing — and the only `ErrorBoundary` in the codebase
is `MarkdownErrorBoundary`, scoped to markdown rendering. There is no global
error boundary, no `window.onerror`, no `unhandledrejection` handler.

**So a JavaScript exception in a teacher's browser is invisible to us.** The
backend has OTel → Cloud Trace/Logging/BigQuery and is well instrumented; the
client has nothing.

This matters for the framing of the whole item: **part of "the UI is difficult"
may simply be errors nobody can see.** A teacher whose save silently throws, or
whose panel fails to render, experiences a hard UI and reports it as one. We
would never know. That is the same silent-failure class the retrospective named
as this project's signature bug, on the one surface with no instrumentation.

**Error visibility is cheaper and more certain than product analytics, and it
should go first.**

## Tooling — do we need Sentry, PostHog, or similar?

Three different capabilities usually get bought as one product. They have very
different value and very different cost here.

| Capability | Value for "the UI is hard" | Cost / risk |
|---|---|---|
| **Error tracking** | **High and immediate** — we are blind today | Low |
| **Product analytics** (funnels, retries) | **High** — this is what M0/M1 are | Low if built in-house; medium as a new processor |
| **Session replay** | **Highest signal of the three** — you watch where they struggle | **Highest privacy risk.** See below |

### Recommendation: build errors + events in-house, defer replay deliberately

**1. Error reporting — do it now, in-scope.** A global error boundary plus
`window.onerror` / `unhandledrejection`, POSTing to our own backend, which
already logs to Cloud Logging. **No new vendor, no new DPA, no new processor**,
and it reuses infrastructure already inside whatever the Google agreement covers.
~0.5d. If a fuller error UI is wanted later, **GlitchTip** (Sentry-API-compatible,
genuinely light to self-host) is a better fit than self-hosted Sentry, which
needs Kafka + ClickHouse + Postgres + Redis.

**2. Product analytics — build it, per M0/M1.** The closed event enum into the
existing BigQuery sink answers the actual questions (funnel drop-off,
time-to-first-activity, retry hotspots, co-pilot Apply rate) and costs less than
standing up a platform. **At 12 teachers, self-hosting PostHog is
disproportionate** — it is heavy ops during a capacity-constrained window, in a
project whose incident history is infrastructure.

**3. Session replay — the honest answer is "high value, and not yet".** It is the
single best tool for this problem: you stop guessing and watch. But on **teacher**
surfaces a replay captures class rosters, group join codes, activity content,
uploaded materials, and — on the reports pages — **student session transcripts**.
So a tool bought to study teacher UX would incidentally record student data, on a
platform whose data agreement is [not yet in place](meeting-2026-09-01-triage.md).
Masking exists in every replay tool and is exactly the control that gets
misconfigured.

**If replay is wanted, it should be a deliberate decision after the agreement
lands**, self-hosted (OpenReplay or PostHog) in `europe-north1`, default-mask
everything and opt in per element, with teachers explicitly told. Not a tool
install.

### Why not a hosted vendor at all, for now

Every SaaS option adds a **processor** to a compliance picture that is already
the project's binding constraint — two legal gates open, both targeted Nov–Dec.
Adding a third-party analytics vendor mid-negotiation is a poor trade for
capability we can approximate on infrastructure already in scope.

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
| **M-1** | **Client error reporting** — global boundary + `window.onerror` + `unhandledrejection` → our backend → Cloud Logging | **~0.5d** | **None. Do this first** |
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
5. **Is session replay worth revisiting once the data agreement lands?** It is
   the highest-signal tool for this exact problem and the highest-risk one to
   introduce. Worth a deliberate yes/no rather than drift.
