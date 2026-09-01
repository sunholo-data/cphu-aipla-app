# Sprint: WORKBENCH-DEBOUNCE-PH2 — commit-on-submit gating for workbench state

**Sprint ID:** `WORKBENCH-DEBOUNCE-PH2`
**Design doc:** [workbench-state-debounce.md](workbench-state-debounce.md) — Phase 2 section
**Branch:** `feature/workbench-commit-on-submit` (executor scratch space; FF-merge direct to `dev`, no PR per AIPLA workflow)
**Base commit:** `788a555` (dev HEAD as of 2026-05-26)
**Estimate:** ~0.55 day
**Created:** 2026-05-26

## Sprint goal

Hold artefact slider changes locally and only flush to the host when the student **commits** — pressing Afspil (Play) or sending a chat message. Phase 1 (already shipped) debounces drag-bursts but still emits every settled value. Phase 2 closes that leak so pre-commit exploration stays local. AR's 2026-05-26 feedback in the design doc is the source.

## Scope locks

**In scope:**
- Artefact: replace `emitParamChangeDebounced` with a `pendingChanges` map (no host emit on slider settle)
- Artefact: `#play` button click → flush pendingChanges as a single state-change with `triggeredBy: "play"`
- Artefact: handle inbound `ui/notifications/chat-flush` JSON-RPC notification → flush as `triggeredBy: "chat-submit"`
- Host: `BoldkastSimFrame` exposes a `sendChatFlush()` method via ref; `chat/[...path]/page.tsx` `handleSend` fires it before `sendMessage`
- Update [.claude/skills/mcp-app-artefact/SKILL.md](../../../../.claude/skills/mcp-app-artefact/SKILL.md) with the commit-on-submit convention so LED Planck + KineBot inherit
- Tests: artefact-level (vanilla unit covering the new emit-on-commit semantics) + host-level (BoldkastSimFrame test verifying the ref + chat wiring)

**Out of scope:**
- Pause / Nulstil committing (lean: no — those are exploration verbs, not commitment verbs — confirmed in JB/AR open questions, defaulting to "no commit" until they push back)
- Configurable per-artefact commit semantics (Phase 1 stays the convention; Phase 2 layers on top)
- Server-side gating (still client-side trust model — artefact decides when to commit)
- LED Planck / KineBot artefacts themselves (they don't exist yet; skill convention update is the carrier)

## Workflow

Per feedback-aipla-git-workflow — `feedback_aipla_git_workflow.md` (agent-memory note, not a project file): commits land direct on `dev`. Branch is for atomic milestone tracking; final merge is FF, no PR. `test`/`prod` gates still PR-based.

## Milestones

### M1 — Artefact pendingChanges map (~0.1d)

**File:** `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` (lines ~730-739, 775, 783, 793)

Replace the `__paramTimers` setTimeout-based debounce with a simple `pendingChanges` object that the existing slider handlers write into. **No host emit on slider settle.**

Keep the existing `emit("boldkast.play")` / `emit("boldkast.pause")` / `emit("boldkast.reset")` / `emit("boldkast.show_value")` — those are commitment-class signals already; the new pendingChanges flush rides alongside.

**Acceptance:** drag v0 from 10 to 25 m/s → no `boldkast.state-change` or `boldkast.param.change` host message appears (verifiable via test exporter + manual via DevTools network/messages).

### M2 — `#play` flushes pendingChanges (~0.05d)

**File:** same artefact HTML, `document.getElementById("play").addEventListener` block (lines ~810-817).

When the student clicks Afspil:
1. If `pendingChanges` has entries: emit one `boldkast.state-change` with `triggeredBy: "play"`, `changed: <array of param keys>`, `state: <snapshot of current v0/theta/g>`. Then clear pendingChanges.
2. Then proceed with the existing `playing = true` + `emit("boldkast.play")` flow.

**Acceptance:** drag v0 to 30, theta to 60, then click Afspil → exactly one `boldkast.state-change` (with the both params + final state) precedes the `boldkast.play` event on the wire.

### M3 — Artefact handles inbound `chat-flush` notification (~0.1d)

**File:** same artefact HTML — the existing `__handlers` / message listener block.

Wire up a handler for incoming `ui/notifications/chat-flush` JSON-RPC notification. On receipt:
1. If pendingChanges has entries: emit one `boldkast.state-change` with `triggeredBy: "chat-submit"`, same shape as M2.
2. Clear pendingChanges.

The host fires this *before* sending the user message so the tutor sees current state when answering.

**Acceptance:** unit test (mocked postMessage) sends a `chat-flush` notification → artefact emits state-change → clear verified by sending a second flush with no pending → zero emits.

### M4 — Host wires chat-submit → artefact flush (~0.15d)

**Files:**
- `frontend/src/components/workspace/BoldkastSimFrame.tsx` — extend the ref shape to expose `sendChatFlush()` that calls `staticFrameRef.current?.sendNotification("ui/notifications/chat-flush", {})`
- `frontend/src/app/chat/[...path]/page.tsx` — add a `boldkastFrameRef` (or extend the workspace ref pattern) and call `.sendChatFlush()` at the top of `handleSend()` before `sendMessage(text, ...)`
- Don't block on the flush — fire-and-forget with a ~50ms grace before the `sendMessage` call (open question #3 default per design doc)

**Acceptance:** typing in the chat input + clicking Send → BoldkastSimFrame.sendChatFlush is called exactly once before sendMessage; if no Boldkast frame is mounted, sendMessage proceeds unaffected.

### M5 — Update mcp-app-artefact skill convention (~0.05d)

**File:** `.claude/skills/mcp-app-artefact/SKILL.md`

Add a "Phase 2: commit-on-submit" section to the existing debounce convention. Describes the pendingChanges + flush-on-commit pattern so LED Planck (1.C) and KineBot (1.D) authors implement it from the start.

**Acceptance:** skill includes the pattern + a code snippet + names the two commit signals (Afspil-class click and chat-flush notification).

### M6 — Tests + quality gates + commit (~0.1d)

**Tests:**
- `BoldkastSimFrame.test.tsx` — add cases verifying `sendChatFlush` ref method exists + dispatches the right JSON-RPC notification
- Artefact-level: small vanilla JS test (or a vitest test using JSDOM that imports the artefact HTML and exercises the message handler) verifying the M2 + M3 flush semantics. If the existing test setup doesn't lend itself to artefact-level JS testing, skip and rely on M5 acceptance gate + manual smoke

**Quality gates:**
- `cd frontend && npm run quality:check:fast` — clean
- `cd frontend && npm run test:run` — green (including new tests)
- No emoji
- `cd backend && make test-fast` — no regression (this sprint doesn't touch backend, but full check is the gate)

**Direct-to-dev merge** per AIPLA workflow — rebase branch, FF-merge, push to origin/dev. NO PR.

## Risks

| Risk | Mitigation |
|---|---|
| chat-flush race condition leaves intermediate pendingChanges in the next tutor turn | Fire-and-forget with 50ms timeout; sendMessage proceeds unaffected. The artefact's flush is synchronous in the iframe so the window is tiny |
| BoldkastSimFrame.sendChatFlush errors when no frame is mounted | Optional chaining on the ref + null-check; missing frame = no-op |
| Existing tests assume a host message per slider settle | Tests will need updating to assert ZERO host messages on slider drag; sweep BoldkastSimFrame.test.tsx + StaticArtefactFrame.test.tsx for affected cases |
| Pause / Nulstil semantics ambiguous | Open question #2 — default: no commit (matches design doc). Easy to flip later if JB/AR push back |

## Success criteria

- [ ] Drag slider continuously, never press Play, never send chat → zero host messages from the artefact
- [ ] Drag slider → press Play → exactly one `state-change` (triggeredBy: "play") then `boldkast.play`
- [ ] Drag slider → type in chat → click Send → exactly one `state-change` (triggeredBy: "chat-submit") before the user message lands
- [ ] All existing frontend tests still pass
- [ ] No emoji introduced
- [ ] Skill convention update mentions both commit signals
- [ ] Direct-to-dev FF merge done; pushed to origin/dev

## Out of scope (do NOT start)

- Configurable per-artefact debounce delays
- Server-side gating
- LED Planck or KineBot artefact code (those are future sprints; this sprint provides the convention they'll follow)
- Pause / Nulstil commit semantics (open question for JB/AR — defaulting to "no commit")
