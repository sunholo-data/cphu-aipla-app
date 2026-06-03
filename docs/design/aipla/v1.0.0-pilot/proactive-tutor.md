# Proactive tutor — auto-greet on join + idle-heartbeat check-ins

**Status**: Phase A Implemented (auto-greet on join, shipped per SEQUENCE.md). **Phase B (idle heartbeat) RETIRED 2026-06-03** — superseded by [v1.1.2 proactive-sim-reactive-tutor](../v1.1.0-feedback/proactive-sim-reactive-tutor.md). The 3 June teacher check-in established that sim-event-reactive (react to *meaningful workbench events*) is the higher-value trigger; idle-heartbeat overlaps with Phase A's "blank session" coverage and risks anti-Socratic interrupts. Phase B design retained below for historical reference; do not implement.
**Last Updated**: 2026-06-03
**Priority**: P1 (Phase A); Phase B retired
**Estimated**: Phase A (auto-greet) ~0.5-1d (shipped); ~~Phase B (heartbeat) ~1.5-2d~~
**Scope**: Fullstack — backend agent-loop wiring + frontend timer + skill-template surface
**Dependencies**: Soft dep on [teacher-ui.md](teacher-ui.md) Phase 2 (`{teacher_focus}` injection) — auto-greet should reference the teacher's teaching goal where present
**Created**: 2026-05-25
**Last Updated**: 2026-05-25

## Problem Statement

A live test on 2026-05-25 surfaced a real UX gap: a student joined a session, saw the pinned welcome banner ([`PinnedWelcome.tsx`](../../../../frontend/src/components/chat/PinnedWelcome.tsx) rendering the skill's static `initialMessage`), but didn't know what to do next. They sat looking at the screen. The tutor doesn't speak until the student speaks first; the student waited for the tutor; deadlock.

**Current behaviour:**
- Skill config carries `initialMessage` (e.g. *"Welcome! Ask me anything about projectile motion."*) — shown as a pinned banner above the chat input
- ADK agent only runs when the student sends a turn — there's no agent-initiated first turn
- No idle detection — if a student sits silent for 5 minutes, nothing prompts them

**Impact:**
- **Demo-time confusion** — every observed student needs at least one verbal nudge from a present teacher / researcher to get going
- **Self-directed learning blocked** — when no teacher is in the room (the v1 pilot model), confused students disengage silently
- **Session metrics get distorted** — sessions that should have started never do; analytics see "zero turn" sessions and can't distinguish "student didn't engage" from "student didn't know how to engage"
- **Strand B (student-as-creator) is worse** — students authoring sims will face the same blank-page problem

## Phased delivery

Two distinct affordances; each has its own pedagogical and technical risk profile.

### Phase A — Auto-greet on join (~0.5-1d)

**Goal:** The tutor speaks *first*. As soon as the student joins a session and the agent is ready, fire a single real agent turn — visible in the chat scroll, indistinguishable from any other tutor message — that greets the student and orients them.

**What ships:**
- New skill-template field `proactive_greet: true | false` (default false; opt-in per skill so existing skills aren't surprised)
- Backend: when an agent is instantiated for a *brand-new* session (`turn_count == 0`), fire one agent turn before yielding to the user. The agent's system prompt + `{teacher_focus}` + a new `{first_turn}` marker that the prompt template can use to shape the opening
- Frontend: nothing changes — AG-UI already streams agent turns; an agent-initiated first turn looks like a normal first turn from the UI's perspective
- Skill template guidance: an `## Opening` section in the SKILL.md authored by the skill creator that the tutor uses verbatim or as a seed for the auto-greet

**What's deliberately NOT in Phase A:**
- Heartbeat / idle detection (Phase B)
- Multi-language auto-detection — Phase A uses the skill's configured language
- Personalisation based on prior sessions — Phase A treats every join as fresh (cross-session memory is 1.F session-persistence territory)

**Acceptance gates for Phase A:**
- [ ] Student joins via group code → sees a tutor message within ~1.5s, no input required
- [ ] The greet references the teacher's `{teacher_focus}` if set (so the teacher's intention shows up immediately in tone, without revealing the concept)
- [ ] Greet does *not* fire on session **resume** (turn_count > 0) — that would be jarring
- [ ] Skill author can opt-out per skill (some skills may not want it, e.g. assessment skills)
- [ ] Token cost per session is bounded — one extra agent turn at the start, ~50-150 tokens out

### Phase B — Idle heartbeat check-ins (~1.5-2d)

**Goal:** If a student is idle for **a configurable threshold**, the tutor proactively checks in. Not interrupting deep thinking — calibrated to detect *disengagement* (no chat, no workbench activity for ~3 minutes) rather than *thinking* (chat quiet but workbench active, or chat-input field has text being composed).

**What ships:**
- New skill-template fields:
  - `idle_heartbeat_seconds: int | null` (default null; per-skill — sensible default ~180s if enabled)
  - Optional `idle_heartbeat_prompt: str` — skill-author guidance for what to say
- Frontend: a `useIdleHeartbeat` hook that watches for:
  - Last student message timestamp
  - Last `mcp_app_context.*` workbench event timestamp
  - Chat-input field focus + non-empty composing state
- When `now - max(last_message, last_workbench_event) > idle_heartbeat_seconds` AND input field is empty AND tab is focused, fire a `POST /api/sessions/{id}/heartbeat-nudge` endpoint
- Backend: the endpoint instantiates an agent turn with a `{heartbeat_nudge: true}` system context, generating a single tutor turn that checks in
- Heartbeat cool-down — at most one nudge per N minutes per session (configurable; default ~5 min)
- Maximum nudges per session — cap (e.g. 3) so a disengaged student isn't pestered indefinitely

**What's deliberately NOT in Phase B:**
- Server-side idle detection (frontend owns the timer because only the frontend knows about tab visibility + chat-input focus)
- Heartbeat during a tutor response stream (don't interrupt streaming)
- Personalised "you usually look at X first" — that's Year-2 memory work

**Acceptance gates for Phase B:**
- [ ] Idle for `idle_heartbeat_seconds` with empty composing field and focused tab → tutor turn appears
- [ ] Workbench activity (`mcp_app_context.*` write) resets the idle timer — student doing the sim is not idle
- [ ] Composing in the input field resets the idle timer — student about to send is not idle
- [ ] Backgrounded tab (`document.hidden`) does NOT trigger heartbeat — student stepped away
- [ ] Cool-down respected: two heartbeats within the cool-down window → only one fires
- [ ] Cap respected: 4th nudge does nothing
- [ ] **JB sign-off on the heartbeat copy + default timing.** Anti-Socratic risk lives here — the wrong default is "tutor interrupts every minute, student feels rushed"

## Goals

**Primary Goal:** A student who joins the demo flow on 2026-05-26+ sees the tutor speak first and is unambiguously oriented. After 3 minutes of doing nothing (no chat, no workbench), the tutor checks in.

**Success Metrics (Phase A — auto-greet):**
- 0 sessions sit at `turn_count == 0` for >30s (today: most demo sessions sit there until a teacher prompts the student)
- Time-to-first-tutor-turn < 2s after session join (AG-UI stream warm-up)
- Greet token cost contributes < 200 tokens per session

**Success Metrics (Phase B — heartbeat):**
- Recovery rate: of sessions that go idle, what % resume engagement within 2 turns of a heartbeat? Target > 30% (anything above zero is value; > 50% means the design lands)
- False-positive rate: heartbeat fires when the student is actually thinking. Survey the pilot teachers + observe ≤ 1 in 10 nudges feels intrusive
- No student in the pilot reports the tutor as "too pushy" (qualitative — JB to gather feedback)

**Non-Goals:**
- Cross-session "welcome back" memory (1.F session-persistence territory; Phase A treats every join as fresh)
- Tone-personalisation per student (Year-2 / Strand-B work)
- Multi-language auto-detect (skill's configured language is used)
- Heartbeat-driven hints based on workbench state (e.g. *"I see you set angle to 30°…"*) — that's iframe-context territory ([sprint 1.25](../v0.1.0-jutland/iframe-context-sprint.md)) and probably wants a separate design
- Heartbeat triggered by *server-side* idle detection — frontend owns the timer; server-only timing can't see tab visibility

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Auto-greet means the student feels something is happening within ~1.5s of joining — closer to instant than "wait then type" |
| 2 | EARNED TRUST | 0 | Heartbeats have risk of trust loss if too aggressive — JB sign-off + opt-out per skill mitigates |
| 3 | SKILLS, NOT FEATURES | +1 | `proactive_greet` and `idle_heartbeat_seconds` are per-skill configs, not platform-wide flags — keeps skill autonomy holding |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Auto-greet + heartbeat are single agent turns; same model as the main session |
| 5 | GRACEFUL DEGRADATION | +1 | If the auto-greet API fails, frontend falls back to today's behaviour (static `initialMessage` banner) |
| 6 | PROTOCOL OVER CUSTOM | +1 | Auto-greet uses existing AG-UI stream; heartbeat uses existing session-turn agent loop. No new protocol needed |
| 7 | API FIRST | +1 | The heartbeat endpoint (`POST /api/sessions/{id}/heartbeat-nudge`) is testable + scriptable from CLI |
| 8 | OBSERVABLE BY DEFAULT | +1 | OTel spans tag `tutor.proactive_kind=greet|heartbeat` on every proactive turn; analytics distinguishes proactive from reactive turns |
| 9 | SECURE BY CONSTRUCTION | 0 | Heartbeat endpoint is session-id gated — same auth as the main chat path, no new attack surface |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Frontend owns the idle timer because only the frontend can see tab visibility + composing state. The decision lives on the client because the *signal* lives on the client |
| | **Net Score** | **+6** | Threshold >= +4 OK |

**Conflict Justifications:** Heartbeat tension with EARNED TRUST (+1 axiom): pedagogical "let them think" vs UX "let them know you're there." Mitigation: idle threshold + cooldown + cap; JB sign-off on defaults.

## Design

### Phase A — auto-greet implementation

```
Student joins (group-code path or LOCAL_MODE) ────► /chat/{skillId}/{sessionId}
                                                     │
                                                     ▼
Frontend opens AG-UI SSE                            uSkillAgent hook starts
                                                     │
                                                     ▼
                                            Bootstrap returns turn_count=0
                                                     │
                                            ┌────────┴────────┐
                                            ▼                 ▼
                            turn_count == 0 AND          turn_count > 0
                            skill.proactive_greet=true   (session resume)
                                            │                 │
                                            ▼                 ▼
                            Frontend fires                    Skip greet —
                            POST /api/sessions/{id}/greet     student is mid-session
                                            │
                                            ▼
                            Backend instantiates agent with
                            system prompt containing:
                              • skill.instructions
                              • {teacher_focus} (from ActivityConfig)
                              • {first_turn: true} marker
                              • skill.opening_template (from SKILL.md ## Opening)
                                            │
                                            ▼
                            Agent emits one tutor turn via AG-UI stream
                                            │
                                            ▼
                            Frontend renders as normal tutor message
```

**New skill-template field:**

```yaml
# In SKILL.md frontmatter
proactive_greet: true   # default false
```

**New SKILL.md section:**

```markdown
## Opening

Greet the student in the lesson's language. Anchor your first turn in the
teacher's focus if one is set (look for the TEACHER'S FOCUS block in your
instructions). Ask one open question that invites them to predict, sketch,
or describe — not one that asks "are you ready?".

Examples:
  • "Hej! I see you're starting Boldkast. Before you launch anything,
    what angle do you think gives the longest range?"
  • "Welcome! Looking at the simulator, what's the first thing you notice?"

Keep your first turn to ~2-3 sentences. The conversation is theirs to lead.
```

**New backend endpoint:** `POST /api/sessions/{session_id}/greet`
- Idempotent — second call on a session with `turn_count > 0` is a no-op
- Returns 202 (accepted; agent turn streams asynchronously)
- Auth: same `get_current_user` gate as the rest of the session path
- Telemetry: OTel span tagged `tutor.proactive_kind=greet`

### Phase B — heartbeat implementation

**Frontend `useIdleHeartbeat` hook (skeleton):**

```ts
function useIdleHeartbeat(
  sessionId: string,
  enabledSeconds: number | null,
  onNudge: () => void,
) {
  useEffect(() => {
    if (!enabledSeconds) return;
    let lastActivity = Date.now();
    let nudgesFired = 0;
    let lastNudge = 0;

    const onActivity = () => { lastActivity = Date.now(); };
    document.addEventListener("visibilitychange", onActivity);
    // Listen to: tab focus, chat input keypress, mcp_app_context update events

    const interval = setInterval(() => {
      if (document.hidden) return;
      if (nudgesFired >= 3) return;
      if (Date.now() - lastNudge < 5 * 60 * 1000) return;  // cool-down
      if (Date.now() - lastActivity > enabledSeconds * 1000) {
        nudgesFired += 1;
        lastNudge = Date.now();
        onNudge();
      }
    }, 10_000);

    return () => { /* cleanup */ };
  }, [sessionId, enabledSeconds, onNudge]);
}
```

**New backend endpoint:** `POST /api/sessions/{session_id}/heartbeat-nudge`
- Body: `{ idle_seconds: int, last_workbench_event_at: ISO8601 }`
- Server-side dedup: rejects if last heartbeat < cool-down ago, or if nudge count >= cap
- Agent context includes `{heartbeat_nudge: true, idle_seconds: int}` so the prompt template can shape the nudge
- Returns 202 (accepted; turn streams via AG-UI as normal)
- Telemetry: OTel span tagged `tutor.proactive_kind=heartbeat`, attribute `tutor.idle_seconds`

**Prompt template addition (per skill, in SKILL.md):**

```markdown
## Idle nudge

When asked to send an idle-nudge turn, your turn should:
  • Acknowledge that you've been waiting
  • Re-orient to the current task (reference workbench state if any)
  • Ask one low-pressure question that gives them an obvious next step
  • Keep it to one sentence

Examples (Danish stx tone):
  • "Stadig der? Måske prøv at sætte vinklen til 60° og se hvad der sker."
  • "Tag dig god tid — vil du have et hint om hvor du kunne kigge?"

Do NOT:
  • Repeat your previous question verbatim
  • Apologise for interrupting
  • Push the student toward an answer
```

### Open questions (the JB / AR conversation before Phase B ships)

1. **Default idle threshold.** 180s feels reasonable but it's a guess. Danish stx students working alone may need longer think time than the AIPLA team will instinctively design for. JB should pick the default; per-skill override available.
2. **Heartbeat content per skill or generic?** Skill-author-defined (per SKILL.md `## Idle nudge` section) is more aligned with skills-as-the-primary-abstraction. Generic platform-wide copy is simpler. **Recommendation:** skill-author-defined with a sensible platform fallback for skills that don't define one.
3. **Workbench-aware nudges.** If sim_run_count was rising 30s ago but the student stopped, that's a different *kind* of idle from "student never engaged with the workbench at all". Phase B treats both the same (workbench-event timestamp resets the idle timer). Year-2 could differentiate.
4. **Should the auto-greet replace `initialMessage` entirely?** Today, the static banner persists. With auto-greet, having both feels redundant. **Recommendation:** if `proactive_greet: true`, the banner suppresses; if false, the banner is the only welcome. Skill author picks per skill.
5. **Greet on session resume?** Currently Phase A says no (turn_count > 0 → skip). But a resumed session after a long gap might benefit from a "welcome back" greet. Out of scope here — overlaps with 1.F session-persistence.
6. **Mobile considerations.** Idle detection on mobile is harder (background-app handling). Phase B's `document.hidden` check is the right primitive but mobile lifecycles add edge cases. Defer to a hardening pass post-shipment.
7. **i18n for the platform-fallback nudge copy.** If we have a generic fallback, it needs DA + EN at minimum.

## Files to create / modify

| File | Purpose | LOC est. |
|---|---|---|
| `backend/protocols/proactive_routes.py` | New endpoints: `POST /api/sessions/{id}/greet` + `POST /api/sessions/{id}/heartbeat-nudge` | ~120 |
| `backend/adk/proactive.py` | Single-turn agent invocation helper used by both endpoints; sets the `{first_turn}` / `{heartbeat_nudge}` system markers | ~80 |
| `backend/adk/agent.py` | Extend `compose_instruction_providers` chain to inject the proactive-context markers; +20 LOC |
| `backend/skills/templates/<skill_id>/SKILL.md` | Per-skill `## Opening` + `## Idle nudge` sections; add `proactive_greet:` + `idle_heartbeat_seconds:` to frontmatter | per-skill |
| `backend/skills/skill_processor.py` | Parse new frontmatter fields into the `SkillConfig` model | ~10 |
| `backend/db/models/skill.py` | `SkillConfig` gets `proactive_greet: bool`, `idle_heartbeat_seconds: int | None`, `opening_template: str | None`, `idle_nudge_template: str | None` | ~10 |
| `frontend/src/hooks/useIdleHeartbeat.ts` | New hook (described in Design above) | ~80 |
| `frontend/src/hooks/useSkillAgent.ts` (or wherever the AG-UI hook lives) | Fire `POST /api/sessions/{id}/greet` on bootstrap when `turn_count == 0 && skill.proactive_greet` | +20 |
| `frontend/src/app/chat/[...path]/page.tsx` | Mount `useIdleHeartbeat` when `skill.idle_heartbeat_seconds` is set | +10 |
| `backend/tests/api_tests/test_proactive_routes.py` | Pytest cases for both endpoints + idempotency + cool-down + cap | ~150 |
| `frontend/src/hooks/__tests__/useIdleHeartbeat.test.tsx` | Vitest cases for the idle timer | ~80 |

## API Changes

**New endpoints:**

```
POST /api/sessions/{session_id}/greet
  body: (empty)
  202 Accepted — agent turn streams via existing AG-UI; second call on
  the same session is a no-op (returns 200 with body indicating skipped)

POST /api/sessions/{session_id}/heartbeat-nudge
  body: { idle_seconds: int, last_workbench_event_at: ISO8601 | null }
  202 Accepted — agent turn streams
  429 Too Many Requests — cool-down or cap reached (frontend respects)
```

**SkillConfig wire shape additions** (Pydantic):
```python
class SkillConfig(BaseModel):
    # ... existing fields ...
    proactive_greet: bool = Field(default=False, alias="proactiveGreet")
    idle_heartbeat_seconds: int | None = Field(default=None, alias="idleHeartbeatSeconds")
    opening_template: str | None = Field(default=None, alias="openingTemplate")
    idle_nudge_template: str | None = Field(default=None, alias="idleNudgeTemplate")
```

## Migration

- **No data migration** — new fields default to false / null so existing skills are unaffected
- **Skill template authors opt in** — Boldkast / KineBot / LED Planck authors set `proactive_greet: true` + author the `## Opening` section per skill
- **Rollback** — revert the commits; skills that opted in revert to today's static-banner-only behaviour

## Testing Strategy

**Backend:**
- pytest: `test_proactive_routes.py` — happy path for both endpoints, idempotency (greet won't fire twice), cool-down enforcement on heartbeat, cap enforcement, auth gates
- Unit test for the `inject_proactive_context()` helper that builds the agent's system prompt with `{first_turn}` / `{heartbeat_nudge}` markers

**Frontend:**
- vitest: `useIdleHeartbeat.test.tsx` — idle threshold respected, tab-hidden suppresses, composing-state suppresses, workbench-event resets, cool-down, cap
- Manual: full end-to-end — join LOCAL_MODE group → tutor greets within 2s → sit idle 3 min → heartbeat fires → respond → continue normally

**Pedagogical (JB / AR):**
- Walk-through with 3-5 stx students before pilot ships; check the heartbeat doesn't feel intrusive
- Adjust default `idle_heartbeat_seconds` based on observed think times

## Implementation Plan

### Phase A — auto-greet

| Step | What | Where | Est |
|---|---|---|---|
| A.1 | `SkillConfig` fields + frontmatter parsing | `backend/db/models/skill.py`, `backend/skills/skill_processor.py` | 0.1 d |
| A.2 | `backend/adk/proactive.py` — single-turn invocation helper with `{first_turn}` marker | new | 0.2 d |
| A.3 | `POST /api/sessions/{id}/greet` endpoint + tests | `backend/protocols/proactive_routes.py`, `tests/api_tests/test_proactive_routes.py` | 0.2 d |
| A.4 | Frontend fires `/greet` on bootstrap when `turn_count == 0 && proactive_greet` | `frontend/src/hooks/useSkillAgent.ts` (or wherever bootstrap lives) | 0.1 d |
| A.5 | Author `## Opening` sections for Boldkast (+ LED Planck once 1.C lands, KineBot once 1.D lands) | skill SKILL.md files | 0.2 d |
| A.6 | Manual end-to-end + token-cost verification | — | 0.1 d |
| | **Phase A total** | | **~0.9 d** |

### Phase B — heartbeat

| Step | What | Where | Est |
|---|---|---|---|
| B.1 | `useIdleHeartbeat` hook + vitest | `frontend/src/hooks/useIdleHeartbeat.ts` (+ test) | 0.4 d |
| B.2 | Mount the hook in chat page; wire onNudge → POST endpoint | `frontend/src/app/chat/[...path]/page.tsx` | 0.1 d |
| B.3 | `POST /api/sessions/{id}/heartbeat-nudge` endpoint + cool-down + cap + tests | `backend/protocols/proactive_routes.py` (extend), test file (extend) | 0.4 d |
| B.4 | Agent-prompt injection: `{heartbeat_nudge: true, idle_seconds}` marker | `backend/adk/proactive.py`, `backend/adk/agent.py` | 0.2 d |
| B.5 | Author `## Idle nudge` sections for Boldkast (+ others) | SKILL.md files | 0.1 d |
| B.6 | Manual end-to-end + JB sign-off pass on the default threshold + nudge copy | — | 0.3 d |
| B.7 | OTel span tagging for both proactive kinds + analytics-side filter | `backend/observability/telemetry.py` | 0.1 d |
| | **Phase B total** | | **~1.6 d** |

| **Grand total** | **~2.5 d** |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Heartbeat feels rushed / anti-Socratic | Medium | JB sign-off on default threshold + copy before Phase B ships; cool-down + cap; per-skill opt-out |
| Auto-greet duplicates the `initialMessage` banner awkwardly | Medium | When `proactive_greet: true`, suppress the static banner — single source of welcome |
| Heartbeat fires during legitimate think time | Medium | Frontend listens for chat-input-focus + composing-state; workbench events reset the timer; tab-hidden suppresses |
| Token cost spirals | Low | One extra turn per join (~150 tokens out); heartbeat capped at 3 per session |
| Greet-on-resume jarring | Low (Phase A handles it) | `turn_count > 0` skips greet; resume is silent |
| Agent generates a poor first turn | Medium | `## Opening` section in SKILL.md gives the skill author a deterministic seed; review against pedagogical lead before opt-in |
| Frontend timer drift on backgrounded tabs | Low | Use `Date.now()` snapshots not `setInterval` counts; respect `document.hidden` |

## Success Criteria (Phase A)

- [ ] Student joins → tutor greets within 1.5s without student input
- [ ] Greet references the teacher's `{teacher_focus}` when set
- [ ] No double-greet on session resume
- [ ] `npm run quality:check` + `make test-fast` green
- [ ] Per-skill opt-out works (skill with `proactive_greet: false` behaves as today)

## Success Criteria (Phase B)

- [ ] Idle 3+ min with no composing / no workbench → tutor checks in
- [ ] Workbench activity within 3 min → no heartbeat (student is engaged)
- [ ] Composing in chat input → no heartbeat (student is about to send)
- [ ] Backgrounded tab → no heartbeat
- [ ] Cool-down + cap respected
- [ ] **JB sign-off on default timing + nudge copy** — pedagogical gate
- [ ] Recovery-rate metric instrumented (% of heartbeat-fired sessions that get a student turn within 2 turns)

## Out of Scope (deferred)

- "Welcome back" personalisation across sessions — 1.F session-persistence territory
- Workbench-state-aware nudges (e.g. *"I see you set angle to 30°…"*) — overlaps iframe-context, separate doc
- Server-side idle detection — frontend owns the timer; revisit only if mobile lifecycle breaks the client-side approach
- Student-as-creator (Strand B) onboarding flow — separate doc; this design lays groundwork (per-skill `proactive_greet` field reusable)
- Adaptive timing per-student — Year-2 / memory-service work

## Related Documents

- [pedagogical-context-sprint.md](../v0.1.0-jutland/pedagogical-context-sprint.md) — the *static* welcome banner this layer extends (still ships; the banner is for `proactive_greet: false` skills)
- [teacher-ui.md](teacher-ui.md) Phase 2 — `{teacher_focus}` injection that the greet references
- [session-persistence.md](session-persistence.md) (1.F) — turn_count check + resume semantics
- [post-pilot/session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — ICAP / FCI scoring will benefit from being able to distinguish proactive vs reactive tutor turns (OTel span tags above provide the hook)
- AG-UI streaming protocol (in [docs/vendor/](../../../vendor/) inherited template docs)
- ADR-005 (chat log storage), ADR-008 (observability) — in the scoping site

## Notes from the 2026-05-25 test

The live student test that motivated this doc:
- Student joined the LOCAL_MODE demo group via `/group`
- Landed in the chat with the static welcome banner visible
- Sat silent for ~30 seconds, then asked the room *"what do I do?"*
- The session never started

The proximate fix is Phase A; without that, every demo session needs a person physically present to verbally prompt the student. That's not sustainable at pilot scale (10 teachers × 25 students each).
