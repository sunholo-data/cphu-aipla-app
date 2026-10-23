# The tutor points at the screen: one tool, named targets, a highlight the student can replay

**Status:** **Designed 2026-10-22, not started.** **1.1.156**
**Priority:** **P2.** Teachers asked for it on 2026-10-22. Nothing is broken without it, but it is the cheapest answer to the day's headline (*"everyone's first question is 'What do I do?'"*) that does not add another message to a chat students already called a flood. Un-gated
**Estimated:** ~3d phased (M1 the `point_at` tool ~0.75d · M2 the highlight on workbench elements and the sim frame ~1d · M3 named targets inside a sim, one sim opted in ~0.75d · M4 research visibility + guides ~0.5d)
**Scope:** Backend: a new `adk/point_at_tool.py`, `adk/agent.py` (tool wiring next to `control_sim`), `adk/stream_redaction.py` (allow-list), `adk/workbench_affordances.py` (one line in the inventory), `db/models/artefact.py` (an optional `pointTargets` field), `analytics/workbench_referral.py` (count it). Frontend: `components/workspace/elementRenderers.tsx` and `GenericArtefactFrame.tsx` (target attributes), a new `lib/pointerBus.ts`, a new `components/chat/PointerCard.tsx`, a new `components/workspace/PointerHighlight.tsx`, `MessageBubble.tsx`, the chat page's mobile tab bar, `messages/{da,en}/chat.json`. Sims: the bridge gains `onPoint`, and one sim declares targets (M3). No activity-schema change, no new authoring surface
**Dependencies:** [1.1.133 tutor-controls-sims](tutor-controls-sims.md) (**shipped** in v0.1.79, provides the tool → card → bus → bridge path this copies); [1.1.149 tutor-directs-to-workbench](../v1.1.0-feedback/tutor-directs-to-workbench.md) (**implemented, unreleased at time of writing**, provides the affordances block and the referral matcher); [1.1.147 seminar-chat-surface-fixes](../v1.1.0-feedback/seminar-chat-surface-fixes.md) M3b (**implemented**, provides the chat → workspace request store and the phone tab switch); [1.1.101](../v1.1.0-feedback/SEQUENCE.md) (the deny-by-default stream filter); [shared-mcp-app-bridge](../v1.1.0-feedback/shared-mcp-app-bridge.md) (**shipped**, `onHostNotification`); ADR-013 ([snapshot](../_scoping-snapshot/architecture.qmd)), the sandbox boundary that decides M3's shape
**Related:** the other docs written from the 2026-10-22 notes, in particular the lesson-opening / "What do I do?" design (an opening turn that points at the first element is the obvious first use) and the pacing design (pointing must not become one more notification)
**Created:** 2026-10-22
**Source:** [notes-2026-10-22.md](../../../notes-2026-10-22.md), M's notes from the student session, verbatim: *"The teacher points a finger to explain. Can we have a UI for the AI tutor 'to point a finger' to show it."* The same notes: *"Everyone's first question is 'What do I do?'"*, *"Needs to be more reactive to the student (although [there is already] a flood of notifications)."*

## Problem Statement

A teacher standing at a student's desk explains with a finger: *"this one, here"*.
The tutor can only do that in words. It names a table (`element_manifest.name_element`)
or a sim control (*"Spring til → Perihel"*) and hopes the student finds it on a screen
that, at a laptop's ~700px height, has a chat, a workbench with up to a dozen
elements, and a sim with its own panels. On 2026-10-22 students did not know where
to start. A tutor that can **show** where to look gives them a first step without
the tutor writing another paragraph.

This doc designs the smallest version of that: the tutor names **one target from a
list it is given**, the target lights up, and the student can replay it from a chip
in the chat. Freehand drawing, pointing at a coordinate, and anything that reaches
into a sim's DOM are out of scope (see [Non-goals](#non-goals)).

## Findings

Every finding below was **verified against code** on 2026-10-22. None comes from the
session's data: there is nothing to measure, because the tutor cannot point today.

### F1. The tutor can act on a sim, but only through commands the sim declares, and no command shows anything

`control_sim(command, args)` (`backend/adk/sim_control_tools.py:238`) is built
per session only when the attached sim declares `commands` and the tutor's
`sim_control` level admits at least one (`:216-233`). Its schema enumerates exactly
the admitted commands. The only sim with commands, `sol-jord-maane`, declares
`jump` (`backend/artefacts/sol-jord-maane.yaml:104`) and similar commands, all of
which **change** state. None highlights a control. So the path from tool to sim
exists end to end, and nothing travels along it that says "look here".

### F2. The tutor names workbench elements only in prose

The manifest (`backend/adk/element_manifest.py:62`, `name_element`) and the
1.1.149 inventory (`backend/adk/workbench_affordances.py:177-239`) give the tutor
each element's kind and title so it can **say** them. The sim line at `:190` already
mentions whether `control_sim` is available, so a pointing tool's availability
belongs in the same place.

### F3. Workspace elements have stable ids in config but no hook in the DOM

Every element model carries an `id` (`backend/db/models/activity_config.py:146`
table, `:180` chart, `:214` calculator, `:231` note, `:260` writing, `:280`
solution, `:297` document, `:409` concept map). The renderer loop
`WorkspaceElements` (`frontend/src/components/workspace/elementRenderers.tsx:163-171`)
wraps each **kind** in a keyed `Fragment`, with no wrapper element and no
attribute. A search of `frontend/src` finds no `data-element*` or
`data-workbench*` attribute anywhere outside tests. **There is nothing on the page
for a highlight to find**, so M2 adds the hook before anything else.

### F4. Both halves of the chat → workspace transport already exist, twice

- `frontend/src/lib/simCommandBus.ts` is a module-level bus between the chat
  column and the sim frame. It **applies each `toolCallId` exactly once** (the
  replay guard, `:12-18`, `:42-44`) and queues up to 5 commands for a sim that is
  not mounted (`:20-21`, `:35`).
- `frontend/src/components/workspace/documentRequest.tsx` is an external store
  for "open this document" from a chat chip. Its handler in the chat page also
  brings the workspace tab forward on a phone
  (`frontend/src/app/chat/[...path]/page.tsx:732-741`).

Pointing is the same shape as both. It needs a third instance, not a new mechanism.

### F5. A client-rendered tool result must be on the allow-list, or the card silently disappears

`_CLIENT_RENDER_TOOLS` (`backend/adk/stream_redaction.py:90-130`) is
deny-by-default: any tool result not listed is replaced with the redaction
sentinel before it reaches the student (`should_redact_tool`, `:152`).
`control_sim` is listed because *"a redacted result is a command that silently
never happens"* (`:114-121`). `point_at` is exactly that case. A highlight
whose result is redacted shows nothing and logs nothing.
`scripts/check-stream-render-allowlist.sh` fails CI when a name the frontend parses
by `tc.name` is missing from the list, so the guard catches it only **if**
`PointerCard` parses by name in `MessageBubble.tsx`, which it must
(`MessageBubble.tsx:345-348` is the `control_sim` precedent).

### F6. On a phone, the workspace is a different tab from the chat

Below `md`, the chat page shows either the chat or the workspace
(`page.tsx:722`, `mobileTab`; tab bar at `:1285`). A highlight on the hidden pane
is invisible, and switching tabs on every tutor reply would pull the student
out of the text they are reading. Focus mode (1.1.140, `workspaceLayout.tsx`) is
the desktop mirror image: chat hidden, workspace full-width. That case is fine,
because the target is on screen.

### F7. The host cannot reach into a sim, by design, but it can send it a named notification

The sim runs in a sandboxed iframe on a separate origin (ADR-013). The host's only
channel is the bridge: `AIPLA_BRIDGE.onHostNotification(method, cb)`
(`infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js:179`), which `control_sim`
uses as `<id>.cmd-<command>`
(`frontend/src/components/workspace/GenericArtefactFrame.tsx:143-174`, including
the hold-until-initialized queue). So **a highlight inside a sim can only be drawn
by the sim**, for a target it has declared. `test_artefact_catalogue.py:200-207`
already cross-checks a sim's declared `commands` against registrations in its HTML,
and M3 copies that check for targets.

### F8. Research logging has a ready precedent

`_log_command` (`sim_control_tools.py:301-346`) writes one row per tutor action
via `emit_workbench_event` (`backend/observability/chat_log.py:194`), with the
teaching stamps (`tutorId`, `tutorVersion`, `frameworkId`) and the `toolCallId`.
The 1.1.149 referral matcher already counts a `control_sim` call as a referral
(`backend/analytics/workbench_referral.py:57`, `:147`). A point is a referral and
should count the same way.

## Design

### The tool

```
point_at(target: <enum of this session's targets>, note: str = "")
  → {ok, target, kind, artefactId?, label, note}
```

- **Targets are enumerated in the schema**, the same as `control_sim`'s commands.
  The model can only name a target that exists on this student's screen, and the
  call is re-checked server-side because a schema is a hint, not a guarantee
  (`sim_control_tools.py` module docstring). Target ids:
  - `sim`: the whole sim frame. Available for **every** activity with a sim, with
    no change to the sim.
  - `<kind>:<element id>` for each workspace element (`table:t1`,
    `checklist:main`, …), named in the description with `name_element` so the
    model and the student see the same name.
  - `sim:<target name>` for each target the sim declares in `pointTargets` (M3).
- **`note`** is optional. It is at most 80 characters, in the reply's language, and
  shown in the badge next to the highlight (*"Start her"*). The reply text still
  does the explaining. The note is a label, not a second message.
- **Built per session, only when it applies.** An activity with no sim and no
  workspace element gets no tool. Its tool list and instruction are
  byte-identical to today's (the passthrough guarantee,
  [tutors-handover](../v1.1.0-feedback/tutors-handover-2026-09-10.md)).
- **At most one point per tutor turn.** A teacher points once per sentence, and
  a tutor pointing at three things lights up the bench like a pinball table. This
  also keeps it off the "flood of notifications" the notes warn about. A second
  call returns `ok: false` with a reason, the same as `MAX_CALLS_PER_TURN`
  (`sim_control_tools.py:59`).
- **No framework field in v1.** Pointing changes nothing on screen except where to
  look, so it sits below `sim_control: view`. Whether an approach should be able
  to turn it off is open question O3.
- **Prompt:** one line in the 1.1.149 affordances inventory, next to the
  `control_sim` mention (`workbench_affordances.py:190`): *"You can point at any
  of these with `point_at`, once per reply, when the student does not know where
  to look."* The tool description lists the targets. Nothing else goes in the
  prompt.

**One tool or two?** `point_at` is separate from `control_sim` rather than a
`highlight` command on it, for two reasons. It applies to the workbench, where
`control_sim` does not, and it is available for every sim, including the many
that declare no commands. Merging the two would make `control_sim` exist in
activities where it currently, correctly, does not.

### The highlight (host side, M2)

- **The hook:** `WorkspaceElements` renders a thin wrapper per element carrying
  `data-workbench-target="<kind>:<id>"`. `GenericArtefactFrame` carries
  `data-workbench-target="sim"`. This is the F3 fix, and it is also what M3's
  frame-level fallback and the tests select on.
- **The transport:** `lib/pointerBus.ts`, a copy of `simCommandBus`'s contract:
  apply each `toolCallId` once, live only, and hold briefly for a target that is
  not mounted (a closed sim, the Documents tab). `PointerCard` publishes it and
  `PointerHighlight` subscribes to it.
- **What it looks like:** a 3px outline with an offset around the target, in the
  brand token (`ring-brand`, never a `red-*` literal, which
  `make check-brand-literals` enforces). It also has a small badge at the
  target's top edge showing the tutor's avatar and the `note`, so the highlight
  is never colour-only. The badge collapses to the avatar alone below 360px of
  target width.
- **Getting it on screen:** `scrollIntoView({block: "nearest"})`, so that at ~700px
  the workspace scrolls only as far as needed and the chat column never moves. On
  `md+`, if the target is in a Workbench tab that is not active
  (`WorkbenchTabs.tsx:26`), switch to it. Keyboard focus is **never** moved:
  the student may be typing a reply.
- **Clearing it:** the highlight clears on the first of these: the student
  interacts with the target, the next tutor turn starts, the student presses
  Escape, or **10 seconds** pass. Ten seconds is a guess at how long a pointing
  finger stays (open question O1).
- **Replaying it:** the chat shows a small chip under the reply, *"👉 Tabel
  'Målinger'"*. Tapping it plays the highlight again. The chip also covers the
  case where the student was not looking when the highlight played, and it
  makes the action visible in the transcript the same way `SimCommandCard`
  does for `control_sim`.
- **Phones (F6):** below `md` the highlight does **not** auto-play and the tab does
  not switch. The *Work* tab gets a dot and the chip reads *"Vis på
  arbejdsbænken"*. Tapping it switches tab (the 1.1.147 M3b path) and plays the
  highlight there. The student chooses when to leave the text.
- **Reduced motion:** with `prefers-reduced-motion`, the outline appears without a
  pulse and the scroll is instant. This follows the precedent in
  `components/teacher/BuilderLayout.tsx:161`.
- **Screen readers:** a polite `aria-live` region announces *"Tutoren peger på:
  Tabel 'Målinger'"*. The target itself gets no extra role.

### Inside a sim (M3)

- **Declaring targets.** `ArtefactMeta` gains an optional
  `pointTargets: [{name, description, label}]`, a sibling of `commands`.
  `description` is English and is what the model reads. `label` is in the sim's
  own language and is what the student reads, the same split as `ArtefactCommand`'s
  `description` / `effect` (`db/models/artefact.py:46-53`). An empty list means
  the sim declares no targets, and only the frame-level `sim` target applies. That
  is the default, and it is correct for every sim today.
- **Delivering a point.** The host sends `<id>.point` with `{target, note}` over the
  bridge, using the same hold-until-initialized queue as commands
  (`GenericArtefactFrame.tsx:147-174`). The host never names a selector and never
  touches the iframe's DOM (ADR-013). The sim maps the name to its own control.
- **Bridge helper.** `AIPLA_BRIDGE.onPoint(cb)` is a thin wrapper over
  `onHostNotification(<id>.point)`. `AIPLA_BRIDGE.highlightElement(el, note)`
  draws the standard outline and badge **inside** the sim, so the sims look
  alike without each author designing a pointer. A sim may draw its own instead,
  for example by pulsing a slider's thumb.
- **Fallback while a sim is not ready.** If a point targets `sim:<name>`, the host
  rings the frame as well as sending the notification. A sim that is slow to
  initialise, or that ignores the notification, still shows the student roughly
  where to look.
- **Keeping catalogue and sim in agreement.** `test_artefact_catalogue.py` gains a
  check that every declared `pointTargets` name appears in a
  `point` handler in the HTML, following the existing `commands` check at
  `:200-207`. The mcp-app-artefact skill's authoring prompt gets a short section
  on declaring targets (`make sim-prompt` regenerates the public page).
- **First sim to opt in:** **Elkedel**, the kettle sim. It was used on
  2026-10-22, and its controls (power, water amount, start) are exactly the "which
  setting do I change?" problem. `sol-jord-maane` is the alternative, since it
  already has a receiving end (open question O2).

### Logging (M1, surfaced in M4)

- One `emit_workbench_event` row per accepted point, built like `_log_command`:
  `tool="point_at"`, `server` = the artefact id or `"workbench"`,
  `field` = the target id, `label` = the student-facing label, and `value` carrying
  the `note`, the teaching stamps and the `toolCallId`. A teacher preview with no
  group writes nothing, matching `sim_control_tools.py:320-321`.
- `analytics.workbench_referral` counts a `point_at` call as a referral, as it
  does `control_sim`. 1.1.149's measure then includes pointing without a second
  matcher.
- **Did the student follow it?** M4 adds one derived measure to the research
  timeline: a point counts as **followed** if the student's next workbench event
  on the same target arrives within 60 seconds. This is computed from rows that
  already exist, with no client acknowledgement. Without this measure, the
  question *"does pointing help?"* could only be answered by watching recordings.

### Language (1.1.108 rules)

- The chip, the aria-live text and the phone tab dot read from
  `messages/{da,en}/chat.json` via `useT()`, with the locale taken from
  `activity.language` (or the student's explicit DA | EN choice).
  `make check-i18n` enforces this.
- Element labels are the teacher's own titles, already in the activity's language.
  Sim target labels come from the catalogue in the sim's language, as `effect`
  does. `note` is the tutor's own text in the reply language. **No language is
  baked into the prompt line.**

## Milestones

Each milestone ships on its own and leaves the platform working.

| | What | Est. | Done when |
|---|---|---|---|
| **M1** | `adk/point_at_tool.py`: an enumerated target schema built from the activity config plus the `sim` frame, re-checked server-side, one call per turn, logged as above. Wired in `adk/agent.py` next to `control_sim`. **Added to `_CLIENT_RENDER_TOOLS` in the same commit.** One line in the affordances inventory. Referral counting | ~0.75d | Unit tests: no targets → no tool (instruction byte-identical); unknown target → `ok: false` naming the allowed ones; second call in a turn refused; result is card-safe (no tutorBlock, no config beyond the label); log row written with teaching stamps, none for a teacher preview |
| **M2** | `data-workbench-target` wrappers; `pointerBus`; `PointerCard` (parsed by `tc.name` so the allow-list guard sees it); `PointerHighlight` with the clear rules, replay, reduced motion, aria-live; phone behaviour; DA + EN strings | ~1d | Vitest: apply-once on re-render; highlight clears on interaction / next turn / Escape / timeout; phone renders the dot and does not switch tabs; `make check-stream-allowlist`, `make check-i18n`, `make check-brand-literals`, `make audit-trust-cards` pass; verified in a real browser at 1280×700 and 390×844 (aitana-frontend-verify) |
| **M3** | `pointTargets` on `ArtefactMeta` (public, like `commands`); `<id>.point` delivery with the hold queue; `onPoint` + `highlightElement` in the bridge; catalogue cross-check; Elkedel declares its 3–5 targets; authoring-prompt section | ~0.75d | `test_artefact_catalogue.py` fails on a declared target with no handler (a broken fixture proves the check, which is the lesson of the `audit_artefact.sh` gate-1 bug); the sim stays under the 200 KB cap; `make smoke-sim ENV=dev ID=elkedel` |
| **M4** | Point events in the researcher timeline, with the *followed* measure; one paragraph in the student-workspace and researcher guides (guide-maintenance); the activity co-pilot's description of the tutor's tools mentions pointing | ~0.5d | A researcher sees a point and whether it was followed in one session's timeline; `make check-guides` passes |

**Release:** M1 and M2 together are the first useful release (workbench elements and
the sim frame). M3 can follow in any later release. Because the stream filter is
deny-by-default, M1 must never ship alone with a frontend that does not yet
render the result. The guard catches the reverse case, but not this one.

## Non-goals

- **Pointing at a coordinate.** Sims and the workspace reflow by viewport, so an
  `(x, y)` from the tutor means nothing on the student's screen. Only names work.
- **Freehand drawing or annotation over the screen.** That is a whiteboard, not a
  finger.
- **The tutor reaching into a sim's DOM, or naming a CSS selector.** ADR-013 rules
  this out, and with good reason. Sim-declared names are the only route in.
- **Pointing at the chat itself** (a previous message, a document chip). 1.1.147
  M3b covers documents.
- **A teacher pointing at a student's screen from the live class view.** It is a
  natural follow-on once `pointerBus` exists, but it needs a teacher → student push
  channel that does not exist today.

## Open questions

- **O1. Auto-play or tap-to-play on a laptop?** The proposal is auto-play on `md+`,
  because a finger is shown, not offered, with tap-to-replay always available and
  tap-only on phones. If students on 10-22 were overwhelmed by things moving
  (*"graphs moving too fast"*), tap-only everywhere is the cautious choice. Also:
  is 10 seconds the right duration for the highlight?
- **O2. Which sim opts in first: Elkedel or `sol-jord-maane`?** Elkedel was the
  sim in use on 10-22 and has the clearest "which control?" problem.
  `sol-jord-maane` already has a receiving end and many controls. M3 costs about
  the same either way.
- **O3. Should a teaching approach be able to turn pointing off?** A
  productive-struggle approach might not want the tutor pointing at the control
  that answers the question. The proposal is no framework field in v1, with the
  decision made by the people who own the pedagogy (Aswin / JB) once there is
  usage to look at. Adding a `pointing: none | allowed` field later is cheap,
  following the pattern of `sim_control`.
- **O4.** Should the opening turn (the lesson-opening design from the same notes)
  always point at the first element, or is that the teacher's choice when
  authoring the activity? That decision belongs in that doc; this doc only makes
  it possible.
