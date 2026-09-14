# Host-side code for a sim

**There is one sim render path, and adding a second is the thing this file
exists to prevent.**

USR-1 (2026-06-25, commit `7c13d789`) deleted every bespoke sim frame —
`BoldkastSimFrame`, `LedPlanckLabFrame`, `KineBotFrame`, their buttons,
workbenches, per-sim snapshot hooks and tests: about 4,700 lines. The chat page
says so where the decision lives:

> `// The slug-driven bespoke sim frames (Boldkast/LED-Planck/KineBot) are gone.`
> — `frontend/src/app/chat/[...path]/page.tsx`

Every workspace surface now renders through one `StudentWorkspace` mount, which
is also what the teacher's activity preview uses, **so the two cannot drift**.
That shared-preview property is the reason to protect the single path: a second
render path means a teacher previewing an activity sees something a student does
not.

So: if a sim seems to need host-side code, the answer is almost always one of

1. **Put it in the activity.** Checklists, tables, calculators, notes and
   writing surfaces are already teacher-configurable elements that sit beside
   the sim and report to the tutor. That is where a quiz or a data table
   belongs. See the `workbench-element-builder` skill.
2. **Put it in the tutor.** Instructions, formulas, hints and progress commentary
   are the tutor's job, fed by `tutorBlock` and the sim's own event stream.
3. **Make it generic.** If the capability is real and not sim-specific, add it to
   `GenericArtefactFrame` so every sim gets it. Two current examples of things
   that were made generic rather than per-sim: the trust-card label (the sim
   supplies `label`; the frame renders any of them) and the chat flush
   (`onRegisterFlush`, which replaced the old per-sim `sendChatFlush()` ref).

## What already exists — reuse, never re-roll

| Building block | Where | Does |
|---|---|---|
| `GenericArtefactFrame` | `frontend/src/components/workspace/GenericArtefactFrame.tsx` | mounts any catalogued artefact; snapshot push, trust card, noise filter, flush registration |
| `StudentWorkspace` | `frontend/src/components/workspace/StudentWorkspace.tsx` | the single mount; applies `SimFrameHeader` and the launch/close state |
| `StaticArtefactFrame` | `frontend/src/components/workspace/StaticArtefactFrame.tsx` | the iframe, the sandbox proxy at `/sandbox.html`, the `ui/initialize` handshake, origin auth. Its handle exposes `sendNotification` |
| `SimFrameHeader` | `frontend/src/components/workspace/SimFrameHeader.tsx` | close + fullscreen. Needs the wrapper element via a callback ref → state (a plain ref is still null on first render) |
| `useSimSnapshotPush<T>(sessionId, serverId, toolName?, proactiveOpts?)` | `frontend/src/hooks/useSimSnapshotPush.ts` | the iframe-context POST plus the proactive-event check. Returns `(snap, latestKind, label?)`. `serverId` **must** be the artefact id |
| `useArtefactReportEvent` | `frontend/src/hooks/useArtefactReportEvent.ts` | denylist-shaped event routing — declare what to drop, everything else flows through |
| `useHumanToolEvents` | `frontend/src/hooks/useHumanToolEvents.ts` | the trust card: pending → confirmed → failed |

**Never hand-roll an iframe plus `window.addEventListener("message", …)`.**
`StaticArtefactFrame` authenticates by origin and speaks the MCP Apps lifecycle;
going around it re-implements the auth gate and leaves the spec.

**Never build an allow-list of event kinds.** `useArtefactReportEvent` is a
denylist for exactly this reason: every allow-list version silently dropped a
kind the author forgot to add, and that failure has no error and no log line.

## The one capability the generic path lacks

**Host → artefact pushes.** An artefact can listen:

```js
AIPLA_BRIDGE.onHostNotification("<id>.set-topic", (p) => { topic = p.topic; render(); });
```

and `StaticArtefactFrame`'s handle can `sendNotification(...)` — but
`GenericArtefactFrame` does not expose it upward, so nothing outside can drive a
sim today. If you need it, add it **generically** (a ref or callback prop on the
generic frame, named by convention `<id>.set-<noun>` for state and
`<id>.cmd-<verb>` for an action), not as a new bespoke frame.

Whatever you push in, **do not echo it back** as telemetry — the host already
knows the value. A value *derived* from it may come back as normal telemetry.

## ⚠️ Two stale scaffolds

Both generate the architecture USR-1 deleted. Do not use them for a new sim, and
be aware they still exist and look authoritative:

- `frontend/src/_sim-template/` — its README still links to the three deleted
  hook/frame pairs.
- `aiplatform sim scaffold <name>` (`cli/aiplatform/commands/sim.py`) — writes a
  per-sim hook and Frame.

They should be retired or rewritten against the generic path. Until then, this
warning is the guard.
