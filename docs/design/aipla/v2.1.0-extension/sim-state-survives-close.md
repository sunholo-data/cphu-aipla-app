# A sim gets its state back when it opens again

**Status**: **PROPOSED** 2026-11-24 — **1.1.160**
**Priority**: **P1** for M1–M3. Students lose typed work on a surface in use now, and the restore half is a dropped consumer, not a missing feature
**Estimated**: **~2d** (M0 evidence ~0.25d · M1 host keeps and hands back the last state ~0.5d · M2 the restore reaches the sim through the bridge ~0.5d · M3 cross-tab and cross-device restore through the existing endpoint ~0.25d · M4 opt-in in `sekant-intro`, the template, the authoring prompt and a gate ~0.5d)
**Scope**: Frontend: `components/workspace/StudentWorkspace.tsx` (open/close), `GenericArtefactFrame.tsx` (`hostContext`), `hooks/useSimSnapshotPush.ts` (the last state is already in hand), `app/chat/[...path]/page.tsx` (`restoredWorkbenchState`, written and never read). Sandbox: `bridge/aipla-mcp-bridge.js` (`initialState()`), then `make sim-build`. Sims: `sekant-intro`, `_template`. Docs: `.claude/skills/mcp-app-artefact/resources/authoring-prompt.md` (+ `make sim-prompt`), `pre-ship-checklist.md`. Backend: none expected, since `POST /api/sessions/{id}/restore` already returns the state
**Dependencies**: [shared-mcp-app-bridge](../v1.1.0-feedback/shared-mcp-app-bridge.md) (**shipped**, the bridge this extends) · sprint 1.F session resume (**shipped**, the `/restore` endpoint) · [tutor-controls-sims](tutor-controls-sims.md) (**shipped**, the hold-until-initialised pattern M2 reuses)
**Source**: [notes-2026-11-23-session-feedback.md](../../../notes-2026-11-23-session-feedback.md), point 1: *"simulations can have text fields but when we close the simulation and come back the text is gone."*

## Problem

Opening a sim makes it fill the workspace. Closing it **unmounts the iframe**
(`StudentWorkspace.tsx:106-122`, `simOpen` → `false`), and reopening loads
`index.html` from scratch. Anything the student typed is gone.

Every other workbench surface survives this. Element scratch state is kept in
`sessionStorage` (the comment at `StudentWorkspace.tsx:110` says so), and the
table, writing, checklist and concept map have durable group stores. Sims are
the only surface with nothing.

## Findings

### F1. The restore was built at both ends and never connected in the middle

Sprint 1.F (session resume) built a server end and a client end that were
meant to meet:

- **Server.** `POST /api/sessions/{id}/restore` returns `workbenchState`: the
  ADK session state, including every `mcp_app_context.*` key a sim has pushed.
  Its docstring says this is *"which StaticArtefactFrame uses to send
  aipla:restore to the artefact"*.
- **Client.** `app/chat/[...path]/page.tsx:815-837` fetches it on re-join and
  stores it in `restoredWorkbenchState`.
- **The middle.** Nothing reads `restoredWorkbenchState`. No frame sends
  `aipla:restore`, and no sim listens for it (`grep` over the frontend and all
  artefacts finds only the comment).

This is the *resolver ships with one consumer* footgun in CLAUDE.md, in its
two-ended form: each end has tests, and the join between them was never
written. **The plumbing is cheap because most of it exists.**

### F2. The bridge already has a restore hook, and it returns null in AIPLA

`AIPLA_BRIDGE.initialState()` (`bridge/aipla-mcp-bridge.js:189-197`) returns the
host's saved widget state on ChatGPT and Copilot (`window.openai.widgetState`)
and `null` everywhere else. `otto-engine` and `kettle-efficiency` already carry
the comment that points sims at it. Making it return AIPLA's saved state too
means **one opt-in works on every host**, with no second API.

### F3. What the platform holds is what the sim reports

The host can only give back what the sim put in `state`. `sekant-intro` is the
only built-in sim with text inputs (14), and it is the likely sim from the
session (to confirm in M0). Its `simState()` already carries the functions
typed into each graph window (`all_windows[].functions`) and the inserted
lines. It does not carry a half-typed field that was never committed, and it
should not: restore is about work, not keystrokes.

### F4. `sessionStorage` inside the sim is not enough on its own

The authoring prompt bans `localStorage` (the sandbox origin is shared by every
student on a school computer) and allows `sessionStorage` *"if state must
survive a reload"*. That covers close and reopen in the same tab. It does not
cover a new tab, a groupmate's device, or the next lesson, and only one sim
(`sol-jord-maane`) uses it.

## Decision

**The host keeps the sim's last reported state and gives it back when the sim
initialises. Sims opt in through the existing `initialState()`.**

Options considered:

| Option | Covers | Against |
|---|---|---|
| Hide the iframe instead of unmounting it | Same tab, every sim, no sim changes | The sim keeps animating and emitting events while hidden (proactive turns from an invisible sim). Same tab only. Does not fix F1 |
| Each sim uses `sessionStorage` | Same tab | Per-sim work, and every imported teacher sim has to remember. Same tab only |
| **Host restore through `initialState()`** | Same tab, new tab, other devices and the next lesson (through `/restore`) | Each sim opts in by reading `initialState()` in its own init. That is one line plus applying the state, and it is the same work ChatGPT already asks for |

Restore happens **once, at initialisation**. The host never overwrites a
running sim, so a groupmate's push can't clobber what a student is typing.
Across devices in a group, the last push wins. That is the same rule the tutor
already sees.

**No new data flow.** The state already goes to the server and to the tutor.
Restore sends it back to the same group's own browser.

## Milestones

### M0 — evidence (~0.25d, M runs the queries)

Read-only, prod, 2026-11-23 (needs an account that can read `aipla-prod-2026`
logs):

- Which sims sent `iframe_context: write` lines that day (`server=` field), and
  from how many groups. Confirms the sim.
- Whether any `POST /api/sessions/*/restore` ran (a re-join), which would show
  the F1 gap actually cost state that day.
- For `sekant-intro`: did the pushed `state` hold the functions the students
  typed? If so, M1–M2 alone fix the reported case.

### M1 — the host keeps the last state (~0.5d)

- `useSimSnapshotPush` already holds every state it pushes. Keep the last one
  per `(sessionId, artefactId)` in a small module-level cache, mirrored to the
  host page's own `sessionStorage`. That is the app origin, per tab, not the
  shared sandbox origin, so F4's concern does not apply.
- Seed that cache from `restoredWorkbenchState` on re-join. **This closes F1.**

### M2 — the state reaches the sim (~0.5d)

- `GenericArtefactFrame` adds `restoredState` to the `hostContext` it sends at
  `ui/initialize`, when the cache has one for this artefact.
- `aipla-mcp-bridge.js`: `initialState()` returns
  `window.openai.widgetState` if present, else `hostContext().restoredState`,
  else `null`. Then `make sim-build` to inline it into every artefact.
- No new notification method. If the state arrives after the handshake (M3's
  async fetch), the frame holds the mount, as it already holds sim commands.

### M3 — new tab, other device, next lesson (~0.25d)

- If the cache is empty when a sim opens, call the existing
  `POST /api/sessions/{id}/restore` for the current session and take
  `workbenchState["mcp_app_context"][<server>]`. Hold the mount for at most
  ~1 s, then open fresh rather than make the student wait.
- No backend change unless M0 shows the endpoint's access rule refuses a
  same-session call. Check that before building.

### M4 — sims opt in, and the opt-in is checked (~0.5d)

- `sekant-intro`: read `initialState()` at init and rebuild its graph windows
  and inserted lines from it. Bump its version per the `mcp-app-artefact` skill.
- `_template`: the restore stub, so every new sim starts with it.
- Authoring prompt (then `make sim-prompt`): *"Anything the student typed or
  built belongs in `state`. At init, if `AIPLA_BRIDGE.initialState()` returns
  something, rebuild from it."* The same line goes into `pre-ship-checklist.md`.
- A **warning-level** sim gate in `backend/sim_gates/`: a sim with text inputs
  that never calls `initialState()`. It gets a fixture that the gate must flag,
  following the per-gate broken-fixture rule in `test_sim_gates.py`.

## Acceptance criteria

- A student types two functions into `sekant-intro`, closes the sim and opens
  it again. Both functions are there.
- The same holds in a new tab and on a second device in the same group (M3).
- A sim that does not opt in behaves exactly as today.
- `restoredWorkbenchState` has a reader, and a test fails if it loses it.

## Tests

- Frontend: `GenericArtefactFrame` passes `restoredState` in `hostContext`
  when the cache has state, and omits the key when it doesn't.
- Frontend: re-join → `/restore` response → frame `hostContext`, end to end
  through the chat page. This is the join F1 never had.
- Sandbox: `initialState()` returns, in order of preference, `widgetState`,
  then `restoredState`, then `null`.
- Sim gates: the broken fixture fails the new gate.

## Open questions

- Was it `sekant-intro`, or a teacher's own sim? A teacher sim from the
  workshop carries the bridge copy it was built with. Does re-inlining the
  bridge on import (or on publish) belong in [simulation-import-pipeline](../v1.1.0-feedback/simulation-import-pipeline.md)?
- Should a restored sim show a quiet "picked up where you left off" line? A
  student who closed the sim *to start over* then needs the sim's own reset.
