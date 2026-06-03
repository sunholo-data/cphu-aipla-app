# Refactor Phase A auto-greet onto Path B (AG-UI protocol parity)

**Status:** Planned (~0.5d follow-up to sprint PROACTIVE-SIM-REACTIVE)
**Last Updated:** 2026-06-03
**Priority:** P2 — protocol consistency / maintenance win. Not blocking the pilot
**Estimated:** ~0.5d (~4h)
**Scope:** Backend `/greet` endpoint becomes a gate-decision; frontend `useProactiveGreet` becomes a thin trigger that uses the same Path B rails as 1.1.2's sim-reactive
**Dependencies:** [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) (1.1.2 shipped); the existing Path B infrastructure (`fetchProactiveEventCheck` pattern, `useSkillAgent.sendMessage`, sentinel suppression in `toSkillMessage`)
**Source:** Filed as M10 of sprint PROACTIVE-SIM-REACTIVE per the design doc's "open question 4" resolution — Phase A should converge on the same proactive-turn rail Phase B now establishes

## Why this exists

Phase A (auto-greet on join, shipped 2026-05-28) currently bypasses AG-UI:

- Backend `/greet` endpoint synchronously drives the agent server-side, collects the assistant's text by consuming AG-UI events internally, returns the concatenated text in a JSON response body
- Frontend `useProactiveGreet` POSTs to `/greet`, takes the returned text, splices it into `initialMessages` as a synthetic first assistant message

This works but is **inconsistent with the protocol stack**. The proactive turn doesn't ride AG-UI, doesn't get the streaming animation, requires a special FE rendering path (splice-into-initialMessages), and didn't get the OTel span attributes until M7 wired them manually.

Sprint PROACTIVE-SIM-REACTIVE (this batch) establishes the canonical **Path B** pattern:

- Backend `/proactive-event-check` returns a gate decision (no agent invocation)
- Frontend kicks off the AG-UI run with a synthetic sentinel via the existing `/api/chat/{skill_id}` endpoint
- The proactive turn streams back through the established protocol just like any user-driven turn
- Sentinel suppression in `toSkillMessage` keeps the trigger from rendering as a student bubble

After this refactor, there is **one proactive-turn rail**, not two.

## Why not in this sprint

This sprint already touched the entire proactive subsystem (SkillConfig fields, injection helpers, session counters, gate endpoint, OTel telemetry, FE wiring, sentinel filter). Refactoring Phase A into the same rail simultaneously would:

- Double the surface area exposed to regression in a single landing
- Risk breaking the demo path that's been stable for ~6 days at sprint start
- Bundle protocol-consistency work with feature work in the same diff (review-unfriendly)

Land Phase B first, exercise it for a few pilot sessions, **then** refactor Phase A onto the same rails. The refactor itself is small once the Path B infrastructure is proven stable.

## What changes

### Backend

| File | Change |
|---|---|
| [backend/protocols/proactive_routes.py](../../../../backend/protocols/proactive_routes.py) | `POST /api/sessions/{id}/greet` becomes a **gate-decision endpoint** mirroring `/proactive-event-check`'s shape. Returns `{shouldFire: bool, reason?: str, trigger?: "[session_start]", sessionId?: str}`. Drops the agent-invocation code path (`process_skill_request` call, assistant-text concatenation, the synchronous response body) |
| [backend/protocols/proactive_routes.py](../../../../backend/protocols/proactive_routes.py) | The `increment_proactive_turn_count` call moves OUT of `/greet`. The new home is wherever the AG-UI run completes — same place sim-reactive should also increment. Cleanest: a small post-run hook detecting either sentinel and incrementing. Trade-off: no longer have the "text was actually produced" gate, since the increment happens before the AG-UI stream completes; mitigation: deduct on RUN_ERROR / RUN_FAILED. Alternative: leave Phase A's increment in `/greet` and revisit if it diverges from sim-reactive's behaviour |
| [backend/protocols/proactive_routes.py](../../../../backend/protocols/proactive_routes.py) | `PROACTIVE_GREET_TRIGGER` constant stays — it's now the value of the `trigger` field in the gate response |
| [backend/tests/api_tests/test_proactive_routes.py](../../../../backend/tests/api_tests/test_proactive_routes.py) | Rewrite existing tests to assert the new shape. Keep all the gate logic tests (idempotency on turn_count > 0, skill opt-out, missing opening template, 404 on missing skill, increment behaviour) |

### Frontend

| File | Change |
|---|---|
| [frontend/src/lib/proactiveGreet.ts](../../../../frontend/src/lib/proactiveGreet.ts) | `fetchProactiveGreet` now returns `{shouldFire: bool, trigger?: str}` instead of `{text: str | null}`. Caller's contract changes |
| [frontend/src/lib/proactiveGreet.ts](../../../../frontend/src/lib/proactiveGreet.ts) | `useProactiveGreet` becomes a thin trigger: on `shouldFire=true`, call `sendMessage(trigger)` (or whatever the chat page's adapter is). The splice-into-`initialMessages` machinery comes out. Frontend renders the proactive turn via the existing AG-UI message stream like any other tutor turn |
| [frontend/src/app/chat/\[...path\]/page.tsx](../../../../frontend/src/app/chat/[...path]/page.tsx) | `useProactiveGreet` invocation simplifies. The `proactiveGreetMessage` state + `initialMessages` injection disappear |

### Sentinel suppression

Already covers `[session_start]` via the M8 wiring (`isProactiveSentinel`), so no change here. The sentinel filter was forward-compat'd in M8 precisely to make this refactor's frontend work trivial.

### OTel telemetry

Already covers `[session_start]` via M7's `tag_proactive_span_from_callback_context` callback. After the refactor, the existing OTel attribute tagging just works for greet through the same code path as sim-reactive — the M7 inline tag in `/greet` becomes dead code and can be removed.

## Acceptance

- [ ] `/greet` endpoint returns the new gate-decision shape; no agent invocation in the response handler
- [ ] Frontend renders the proactive greet through the AG-UI message stream (visible in the chat scroll like any other turn, gets the streaming animation)
- [ ] The `[session_start]` sentinel does NOT render as a student bubble
- [ ] OTel span on the greet's AG-UI run carries `tutor.proactive_kind=greet` (via the existing M7 callback)
- [ ] Backend tests rewritten for the new shape; backend `make lint && make test-fast` green
- [ ] Frontend `npm run quality:check` green
- [ ] Manual: open a fresh chat in LOCAL_MODE with `problem-set-hints`; tutor greets within ~1.5s (the greet text streams in like any other tutor turn, no longer pops in pre-formed); no regression in Boldkast Phase B sim-reactive flow

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Streaming greet feels slower than the current "pre-formed text appears" UX | Medium | Latency parity: the agent run is the same; total time-to-first-token should match. The visual is different (streaming vs. flash). If pilot teachers prefer the flash, keep `/greet` returning text via the JSON body as a backup |
| Race between `useProactiveGreet`'s trigger and the chat page's own input | Low | Same as Phase B's race: the AG-UI agent serialises per-thread; the greet trigger and any student input get queued correctly |
| `increment_proactive_turn_count` moves out of `/greet` and the cap accounting drifts | Medium | Single post-run increment hook for both kinds, written once and tested once. Alternative: defer this and keep `/greet` doing its own increment until the post-run hook lands |
| The splice-into-`initialMessages` had a UX benefit I haven't accounted for | Low | Manual smoke before the merge; A/B against current if time permits |

## Out of scope

- Refactoring idle-heartbeat — already retired per Path A decision 2026-06-03 (`proactive-tutor.md` Phase B section)
- Changes to the per-skill `## Opening` content blocks (already correct; their content is appended to the system prompt via `inject_opening_guidance` either way)
- Refactoring `inject_opening_guidance` — the injection mechanism doesn't change with the endpoint refactor; both endpoints still need the injection to happen at agent build

## Related

- [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) — Phase B (Path B) design doc; this refactor follows its pattern
- [proactive-sim-reactive-tutor-sprint.md](proactive-sim-reactive-tutor-sprint.md) — the sprint that established Path B
- [proactive-tutor.md](../v1.0.0-pilot/proactive-tutor.md) — Phase A original design doc (Phase B section retired)
- ADR-005 (chat log storage) — both kinds of proactive turn write to BigQuery identically once they ride the AG-UI rail
- M7 (`backend/adk/proactive_telemetry.py`) — already supports both sentinel forms; will continue to work unchanged after the refactor
