# Proactive sim-reactive tutor — react to workbench events without waiting for student chat

**Status:** Planned (P1)
**Last Updated:** 2026-06-03
**Priority:** P1 — teacher request from 3 June check-in. The Phase A auto-greet shipped, but tutors still wait for chat messages between sim runs even when a student is actively experimenting in the workbench
**Estimated:** ~1d
**Scope:** Fullstack — backend session-event loop + new endpoint + skill-config fields + frontend workbench-event wiring
**Dependencies:** [proactive-tutor.md](../../v1.0.0-pilot/proactive-tutor.md) Phase A (shipped); workbench-event stream from MCPAPP-SPEC + [workbench-state-debounce.md](../../v1.0.0-pilot/implemented/workbench-state-debounce.md) (shipped)
**Source brief:** [`june-03-feedback-sprint-brief.md` §2](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md)

## Relationship to existing proactive-tutor doc

**Decided 2026-06-03 — Path A confirmed.** [proactive-tutor.md](../../v1.0.0-pilot/proactive-tutor.md)'s original Phase B (idle-heartbeat — no activity for ~3 min → check in) is **retired** and replaced by this doc. The 3 June teacher check-in established sim-event-reactive as the higher-value trigger: idle-heartbeat overlapped with `proactive_greet` already covering the "blank session" failure mode and carried anti-Socratic interrupt risk. This doc is now the canonical Phase B.

The original idle-heartbeat design remains in [proactive-tutor.md](../../v1.0.0-pilot/proactive-tutor.md) as historical reference (marked retired in its status header); do not implement it.

## Problem

A student opens Boldkast, drags the angle slider, presses **Afspil** (Play), and watches the simulation run. They haven't typed anything in chat. The tutor is silent because the agent loop only runs on student message input. The student is *engaged* (they ran a sim) but the tutor doesn't acknowledge or guide.

The brief's example: student runs Boldkast with angle=45°; tutor doesn't react. Pedagogically, the moment after a meaningful action is exactly when a Socratic prompt has highest value ("what did you notice about the time of flight?").

## Goals

**Primary:** When a meaningful workbench event fires and the student hasn't sent a chat message in N seconds, fire a single short tutor turn observing what happened and asking one question.

**Success metrics:**
- Token cost bounded: max 2 proactive turns per session; default cap stays even if `proactive_max_per_session` config raised
- No anti-Socratic interrupt: 90-second cooldown between proactive turns; cap of 2 per session
- Pedagogical signal: pilot teachers report the tutor's sim-reactive turns are *grounded in what the student just did* (not generic)

**Non-goals:**
- Reacting to every slider tick (the brief is explicit: meaningful events only, not every drag — [workbench-state-debounce.md](../../v1.0.0-pilot/implemented/workbench-state-debounce.md) Phase 2 commit-on-submit gating already restricts what reaches the backend)
- Cross-session "I noticed last time you tried 30°" memory — out of scope, year-2 memory work
- Replacing the chat input — the proactive turn appears in the chat stream as a normal agent turn

## What counts as a "meaningful event"

Per the brief: **sim run, step change, measurement commit**. Translated to MCPAPP-SPEC workbench-event types currently emitted:

| Event type | Meaningful? | Notes |
|---|---|---|
| `mcp_app_context` slider drag (debounced) | ❌ | Pre-Phase-2 the stream is too noisy; even with debounce, dragging is exploration, not commitment |
| `mcp_app_context` commit-on-submit (Play button) | ✅ | The Phase-2-gated post-submit emit — this is the canonical "ran the sim" signal |
| `mcp_app_context` step / next / advance | ✅ | LED Planck stepping through a procedure |
| `mcp_app_context` measurement / record | ✅ | LED Planck recording a data point |
| `mcp_app_context` reset | ❌ | Reset is "undo" not progress; tutor reacting would feel intrusive |

Each artefact tags its emitted events with a `kind` field already (per MCPAPP-SPEC); this doc adds a server-side allowlist of which `kind` values count as `meaningful_for_proactive`. The allowlist starts hardcoded; if it needs to be per-skill, lift to skill config.

## Design

```
Student commits a workbench event (e.g. Boldkast Play, angle=45°)
        │
        ▼
StaticArtefactFrame ──postMessage──► host hub ──POST /api/sessions/{id}/workbench-event──► backend
                                                                                            │
                                                                                            ▼
                                            backend.session_event_loop:
                                            ├── persist event to `mcp_app_context.boldkast.*` (existing)
                                            ├── stream event into ADK session state (existing)
                                            └── proactive-event check:
                                                  if event.kind in meaningful_for_proactive
                                                  AND now - last_student_message > proactive_heartbeat_seconds
                                                  AND now - last_proactive_turn > 90s (cooldown)
                                                  AND proactive_turn_count < proactive_max_per_session
                                                  AND skill.proactive_event_reactive = true:
                                                    fire single agent turn with context:
                                                      {proactive_kind: "event_reactive",
                                                       triggering_event: {kind, payload, ts}}
        │
        ▼
Agent emits one tutor turn via AG-UI stream (same path as auto-greet)
        │
        ▼
Frontend renders as normal tutor message; chat scroll auto-advances
```

### New skill-config fields

```yaml
# In SKILL.md frontmatter
proactive_event_reactive: true          # default false — opt-in per skill
proactive_heartbeat_seconds: 10          # threshold: student must have been silent for this long
proactive_max_per_session: 2             # hard cap; brief's recommended default
```

(If we go Path B and keep idle-heartbeat separate, these are net-new fields and the original `idle_heartbeat_seconds` stays as-is.)

### Per-skill prompt block

Each skill's SKILL.md gets a new section:

```markdown
## Reactive turn

When asked to send a sim-reactive turn, your turn should:
  • Observe what the student just did (reference the triggering event's payload)
  • Ask one short question that invites prediction, comparison, or explanation
  • Keep it to one or two sentences — they are mid-flow

Examples (Boldkast, after sim run with angle=45°):
  • "Du fik den længste rækkevidde med 45°. Hvad sker der hvis du sænker startfarten?"
  • "Pænt — kan du forudsige hvad der sker hvis du øger vinklen til 60°?"

Do NOT:
  • Lecture about the underlying physics
  • Ask "would you like a hint?" (yes/no questions kill the loop)
  • Repeat your previous question verbatim
```

### Backend changes

| Location | Change |
|---|---|
| [backend/protocols/proactive_routes.py](../../../../backend/protocols/proactive_routes.py) (extend from Phase A) | New code path inside the existing workbench-event handler, OR a new endpoint `POST /api/sessions/{id}/proactive-event-check` invoked by the frontend after a commit-on-submit |
| [backend/adk/proactive.py](../../../../backend/adk/proactive.py) (extend from Phase A) | New `proactive_kind="event_reactive"` flag; pass the triggering event payload into the system prompt context |
| [backend/db/models/skill.py](../../../../backend/db/models/skill.py) | Add the three new `SkillConfig` fields |
| [backend/skills/skill_processor.py](../../../../backend/skills/skill_processor.py) | Parse the three frontmatter fields |
| `backend/tests/api_tests/test_proactive_event_routes.py` | New: trigger event → expect agent turn; cooldown enforced; cap enforced; student-message-within-window → no turn fires |
| `backend/observability/telemetry.py` | OTel span attribute `tutor.proactive_kind="event_reactive"` + `tutor.triggering_event_kind` |

### Frontend changes

Minimal. The existing workbench-event POST already happens on commit-on-submit. The new behaviour is **server-side reactive** — the frontend doesn't need a new timer or new endpoint call. The agent turn appears via the existing AG-UI stream.

The one explicit FE concern: when a proactive turn arrives during/right after a sim run, the chat should auto-scroll so the student doesn't miss it (existing behaviour — verify no regression).

## API changes

**Option A (recommended): no new endpoint.** The proactive-event check runs inside the existing workbench-event handler. Side effect: every workbench POST may now stream back an agent turn via AG-UI.

**Option B: explicit endpoint.** `POST /api/sessions/{id}/proactive-event-check` — frontend opts in to ask the backend to consider firing. More configurable; more wire chatter.

Option A is cleaner because the **server already has the full picture** (last student message ts, last proactive turn ts, cap counter) — there's no information the frontend needs to add. Go with A unless during build we discover a reason to expose the decision to the client.

### SkillConfig wire shape additions (Pydantic)

```python
class SkillConfig(BaseModel):
    # ... existing fields ...
    proactive_event_reactive: bool = Field(default=False, alias="proactiveEventReactive")
    proactive_heartbeat_seconds: int = Field(default=10, alias="proactiveHeartbeatSeconds")
    proactive_max_per_session: int = Field(default=2, alias="proactiveMaxPerSession")
```

## Migration

- No data migration. New fields default to false / standard values.
- Skill authors opt in: Boldkast, LED Planck, KineBot set `proactive_event_reactive: true` and author the `## Reactive turn` section per skill.
- Rollback = revert the commits + flip skills' frontmatter back to false.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tutor takes over the conversation (teacher concern explicit in brief) | Medium | Hard cap (2 / session) + 90s cooldown + per-skill opt-out |
| Triggering event misclassified (e.g. reset counted as meaningful) | Medium | Server-side allowlist of `kind` values; review with AR after first pilot session |
| Proactive turn fires during student composing | Low | Server check `last_student_message` only — composing-state lives in FE; if needed, add `student_typing` heartbeat from FE per [proactive-tutor.md](../../v1.0.0-pilot/proactive-tutor.md) Phase B sketch |
| Tutor turn arrives mid-sim-render and looks like commentary the artefact emitted | Low | Standard chat message styling; arrival ordering is fine because AG-UI is a single stream |
| Token cost climbs | Low | Cap of 2/session × short turn ≈ 300 tokens extra per session |

## Acceptance

- [ ] Skill authors can opt-in via `proactive_event_reactive: true` frontmatter
- [ ] Student runs Boldkast with `angle=45°` + no chat message in last 10s → within ~3s of the run completing, a single tutor turn appears referencing the result
- [ ] Within the next 90s, no further proactive turn fires regardless of additional sim runs
- [ ] After 2 proactive turns in a session, further sim runs do NOT trigger more
- [ ] Slider drags (not committed via Play) do NOT trigger — only commit-on-submit events
- [ ] Student message within 10s of a sim run → no proactive turn (student is engaging conversationally)
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green
- [ ] OTel span attribute `tutor.proactive_kind="event_reactive"` visible in trace; analytics-chat skill can filter to "proactive turns only" via existing rubric tooling
- [ ] AR sign-off on per-skill `## Reactive turn` copy for Boldkast, LED Planck, KineBot

## Open questions

1. **Cooldown granularity** — 90s session-wide vs 90s-per-event-kind? Brief says session-wide; honour that.
2. **`meaningful_for_proactive` allowlist** location — hardcoded in backend vs per-skill SKILL.md vs Pydantic enum? Hardcoded is simplest for v1.1; promote to per-skill config only if a skill needs a different rule.
3. **Greet + reactive on same session-start moment** — if Phase A auto-greet fires at t=0 and the student immediately runs a sim, do we suppress the proactive-reactive turn? **Recommendation: yes** — count auto-greet as a proactive turn for cap purposes (so the cap effectively becomes "1 reactive after the greet"). Otherwise the first 10s of every session is two tutor turns back-to-back.

## Files (estimate)

| File | Purpose | LOC est. |
|---|---|---|
| [backend/protocols/proactive_routes.py](../../../../backend/protocols/proactive_routes.py) | Extend with event-reactive check inside workbench-event handler | +60 |
| [backend/adk/proactive.py](../../../../backend/adk/proactive.py) | New `proactive_kind="event_reactive"` invocation path with triggering-event payload injection | +40 |
| [backend/db/models/skill.py](../../../../backend/db/models/skill.py) | Three new fields | +10 |
| [backend/skills/skill_processor.py](../../../../backend/skills/skill_processor.py) | Parse new fields | +10 |
| Skill SKILL.md files (Boldkast, LED Planck, KineBot) | New `## Reactive turn` section + frontmatter | per-skill |
| `backend/tests/api_tests/test_proactive_event_routes.py` | New test file | ~150 |

**Grand total estimate:** ~1d (matches brief).

## Related

- [proactive-tutor.md](../../v1.0.0-pilot/proactive-tutor.md) — Phase A (shipped); this doc effectively re-scopes the original Phase B
- [workbench-state-debounce.md](../../v1.0.0-pilot/implemented/workbench-state-debounce.md) — Phase 2 commit-on-submit gating is the prerequisite that makes "meaningful event" tractable to detect
- [chat-log-pipeline.md](../../v1.0.0-pilot/implemented/chat-log-pipeline.md) — the OTel pipeline writes both workbench events and chat turns, so analytics can see proactive vs reactive turns side-by-side
- [tutor-verbosity-fix.md](tutor-verbosity-fix.md) — the ≤3 sentences + question rule the reactive turn inherits
