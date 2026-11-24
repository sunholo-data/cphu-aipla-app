# A sim gets its state back when it opens again

**Status**: **M1 SHIPPED to prod in v0.1.113 on 2026-11-24** (the 23 November fix, ahead of a lesson on 25 November; verified in a real browser on test with the old code — text lost, 2 iframe reloads — and on dev, test and prod with the new — text kept, 0 reloads); M2–M5 PROPOSED — **1.1.160**
**Priority**: **P1** for M1–M3. Students lose typed work on a surface in use now, and the restore half is a dropped consumer, not a missing feature
**Estimated**: **~2.5d** (M0 evidence **done 2026-11-24** · M1 keep the sim mounted while closed ~0.5d · M2 host keeps the last state ~0.25d · M3 the restore reaches the sim through the bridge ~0.5d · M4 new tab, other device, next lesson ~0.25d · M5 opt-in in the template, the authoring prompt, a gate and teacher-sim republish ~0.75d). **M1 alone fixes what happened on 23 November**
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

The host can only give back what the sim put in `state`. Among the built-in
sims, only `sekant-intro` has text inputs (14). Its `simState()` already carries
the functions typed into each graph window (`all_windows[].functions`) and the
inserted lines. It does not carry a half-typed field that was never committed,
and it should not: restore is about work, not keystrokes.

### F4. `sessionStorage` inside the sim is not enough on its own

The authoring prompt bans `localStorage` (the sandbox origin is shared by every
student on a school computer) and allows `sessionStorage` *"if state must
survive a reload"*. That covers close and reopen in the same tab. It does not
cover a new tab, a groupmate's device, or the next lesson, and only one sim
(`sol-jord-maane`) uses it.

### F5. The prod logs: it was a teacher sim, and the server had the text (M0, 2026-11-24)

Class `f2b1419f2e54`, 23 November, 13:53–14:51 local time:

- The sim was **`bohr-spektrum`, teacher-built**, used by all 5 student groups
  (404 state pushes). It has a free-text *prediction* field, and the typed text
  **is** in every pushed state (`state.overview.prediction`).
- In **3 of the 5 groups** (and one teacher preview), the prediction went from
  filled (33–178 characters) to empty. At every one of those moments the next
  push came after a ~5 min gap with `tab` back on `overview` and
  `power_toggles` back at 0, from `orbits`/`jumps` and 1–9. **That is a fresh
  load**, the close-and-reopen this doc is about, not a student deleting text.
- So the server held the lost text in `mcp_app_context` the whole time.

Query, for re-running against another lesson:

```sql
WITH e AS (
  SELECT group_id, ts,
         JSON_VALUE(value, '$.state.overview.prediction') AS pred,
         JSON_VALUE(value, '$.state.tab') AS tab
  FROM chat_logs.workbench_events
  WHERE DATE(ts) = '2026-11-23' AND class_id = 'f2b1419f2e54' AND server = 'bohr-spektrum'),
s AS (SELECT *, LAG(pred) OVER w AS prev, LAG(tab) OVER w AS prev_tab
      FROM e WINDOW w AS (PARTITION BY group_id ORDER BY ts))
SELECT group_id, ts, prev_tab, tab, LENGTH(prev) AS lost_chars
FROM s WHERE LENGTH(prev) > 0 AND IFNULL(LENGTH(pred), 0) = 0
```

### F6. Teacher sims have their bridge stamped at publish

`sim_authoring/publish.py:100` stamps the guest bridge into the HTML **when the
teacher publishes**, and `teacher_sim_versions/{id}__v{n}` freezes it. A
bridge-side restore (M3–M5) therefore reaches `bohr-spektrum` only after it is
republished, **and** its author adds an `initialState()` read. That is two
actions by a teacher, for a sim that failed in a classroom yesterday.

## Decision

**Two layers. First keep the sim alive while it is closed, which fixes every
sim today. Then have the host give back the last state on a fresh load, which
sims opt in to through the existing `initialState()`.**

*(Revised 2026-11-24 after F5/F6. The first version chose restore alone and
listed keeping the sim mounted as a rejected option. The logs show the failure
was a same-tab close and reopen in a teacher sim that can't opt in without
being republished, which is exactly the case keeping it mounted covers with no
author action.)*

| Option | Covers | Against |
|---|---|---|
| **Keep the iframe mounted, hidden, while closed** (M1) | Same tab, **every sim including teacher sims**, no sim changes. Covers all of F5 | The sim keeps running while hidden: animation CPU, and pushes or proactive checks from an invisible sim. Handled in M1. Same tab only. Does not fix F1 |
| Each sim uses `sessionStorage` | Same tab | Per-sim work, and every imported teacher sim has to remember. Same tab only |
| **Host restore through `initialState()`** (M2–M5) | New tab, other devices and the next lesson (through `/restore`) | Each sim opts in by reading `initialState()` in its own init, and teacher sims must be republished (F6). That is the same work ChatGPT already asks for |

Restore happens **once, at initialisation**. The host never overwrites a
running sim, so a groupmate's push can't clobber what a student is typing.
Across devices in a group, the last push wins. That is the same rule the tutor
already sees.

**No new data flow.** The state already goes to the server and to the tutor.
Restore sends it back to the same group's own browser.

## Milestones

### M0 — evidence (**done 2026-11-24**, see F5)

### M1 — keep the sim mounted while it is closed (~0.5d) — **IMPLEMENTED 2026-11-24**

What shipped (`StudentWorkspace.tsx`, `workspaceLayout.tsx`):

- After its first open, the sim stays mounted, always at the same position in
  the tree and keyed by sim id. Closing it sets `hidden` and `inert` instead of
  unmounting it. A different sim (another activity) never inherits the frame,
  and a sim is still not loaded until the student first opens it.
- Focus mode follows visibility: `useSimFocusMode(key, active)` applies on
  open and hands the chat back on close, as it did when those were mount and
  unmount.
- The chat flush is registered only while the sim is shown, so a closed sim
  adds no send latency, the same as before.
- Closing from fullscreen exits fullscreen first. Unmounting used to do that
  for free.
- Tests: `StudentWorkspace.test.tsx` *keeps what the student typed in the sim
  across a close and reopen* fails on the old component and passes on the new.
  **In a real browser on a deployed env: `make smoke-sim-reopen ENV=<env>`**
  (`scripts/smoke-sim-reopen.sh`). It printed `survived:false`, 2 iframe loads
  on test before the release and `survived:true`, 0 loads on dev, test and prod
  after. M4 should extend it with a new-tab variant.
  There are also tests for flush registration, for not carrying a frame over
  to a different sim, and for re-applying focus on reopen.

**Deferred from the first draft of M1**, because neither was needed to fix the
reported case:

- A `host-context-changed { visible: false }` notification so animating sims
  can pause while hidden. Today a hidden sim keeps running, which costs the
  same as when it was open.
- Skipping the proactive event check while hidden. A hidden sim gets no
  student input, so it emits nothing in practice, and teacher activities have
  sim-reactive turns off anyway (1.1.154 F4).

### M2 — the host keeps the last state (~0.25d)

- `useSimSnapshotPush` already holds every state it pushes. Keep the last one
  per `(sessionId, artefactId)` in a small module-level cache, mirrored to the
  host page's own `sessionStorage`. That is the app origin, per tab, not the
  shared sandbox origin, so F4's concern does not apply.
- Seed that cache from `restoredWorkbenchState` on re-join. **This closes F1.**

### M3 — the state reaches the sim (~0.5d)

- `GenericArtefactFrame` adds `restoredState` to the `hostContext` it sends at
  `ui/initialize`, when the cache has one for this artefact.
- `aipla-mcp-bridge.js`: `initialState()` returns
  `window.openai.widgetState` if present, else `hostContext().restoredState`,
  else `null`. Then `make sim-build` to inline it into every artefact.
- No new notification method. If the state arrives after the handshake (M4's
  async fetch), the frame holds the mount, as it already holds sim commands.

### M4 — new tab, other device, next lesson (~0.25d)

- If the cache is empty when a sim opens, call the existing
  `POST /api/sessions/{id}/restore` for the current session and take
  `workbenchState["mcp_app_context"][<server>]`. Hold the mount for at most
  ~1 s, then open fresh rather than make the student wait.
- No backend change unless M0 shows the endpoint's access rule refuses a
  same-session call. Check that before building.

### M5 — sims opt in, and the opt-in is checked (~0.75d)

- `sekant-intro`: read `initialState()` at init and rebuild its graph windows
  and inserted lines from it. Bump its version per the `mcp-app-artefact` skill.
- `bohr-spektrum`: ask its author to restore `overview.prediction` and the tab
  from `initialState()` and republish. The sim workshop's assistant can make the
  edit, but the republish is the teacher's (F6). Offer this, don't require it,
  because M1 already covers the classroom case.
- `_template`: the restore stub, so every new sim starts with it.
- Authoring prompt (then `make sim-prompt`): *"Anything the student typed or
  built belongs in `state`. At init, if `AIPLA_BRIDGE.initialState()` returns
  something, rebuild from it."* The same line goes into `pre-ship-checklist.md`.
- A **warning-level** sim gate in `backend/sim_gates/`: a sim with text inputs
  that never calls `initialState()`. It gets a fixture that the gate must flag,
  following the per-gate broken-fixture rule in `test_sim_gates.py`.

## Acceptance criteria

- **M1:** a student types a prediction into `bohr-spektrum`, closes the sim
  and opens it again in the same tab. The prediction is there.
- **M5:** a student types two functions into `sekant-intro`, closes the tab and
  opens the activity again. Both functions are there.
- The same holds in a new tab and on a second device in the same group (M4).
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

- ~~Was it `sekant-intro`, or a teacher's own sim?~~ A teacher's own sim,
  `bohr-spektrum` (F5). A teacher sim carries the bridge copy it was published
  with (F6). Should a bridge upgrade re-stamp published teacher sims, and does
  that belong in [simulation-import-pipeline](../v1.1.0-feedback/simulation-import-pipeline.md)?
- Should a restored sim show a quiet "picked up where you left off" line? A
  student who closed the sim *to start over* then needs the sim's own reset.
