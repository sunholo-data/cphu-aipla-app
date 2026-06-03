# Sprint: PROACTIVE-SIM-REACTIVE — 1.1.2 sim-event-reactive tutor

**Sprint ID:** `PROACTIVE-SIM-REACTIVE`
**Design doc:** [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md)
**Architecture (decided 2026-06-03):** **Path B** — FE-initiated AG-UI run via synthetic sentinel. Backend owns the gate decision; frontend kicks off the actual agent run via the existing `/api/chat/{skill_id}` AG-UI endpoint so the proactive turn rides the established protocol stack (same SSE stream, same streaming animation, same telemetry path, same Firestore mirror) as every normal turn. Phase A's `PROACTIVE_GREET_TRIGGER = "[session_start]"` establishes the synthetic-sentinel pattern this reuses.
**Branch:** work on `dev` directly per [feedback-no-prs-commit-to-dev](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_prs_commit_to_dev.md). Commit per milestone locally; `git push origin dev` at sprint end after M10 quality gates pass.
**Estimate:** ~1d wall clock (~7-8h actual work)
**Created:** 2026-06-03

## Sprint goal

Wire the **canonical Phase B** of the proactive-tutor work — when a meaningful workbench event commits (Boldkast Play, LED Planck step advance, KineBot measurement commit) and the student has been silent for the configured threshold, the tutor proactively comments on what just happened. One agent turn per trigger, 90s cooldown, max 2 proactive turns per session (auto-greet counts).

**Per the design doc's Path A resolution**, this supersedes the original idle-heartbeat Phase B (retired 2026-06-03). After this sprint lands, the only proactive-tutor surface is auto-greet (Phase A, shipped) + sim-reactive (this sprint).

## Architecture (Path B in detail)

```
Student clicks Play on Boldkast (or any meaningful workbench commit)
        │
        ▼
MCPAppToolCallRouter posts to /api/sessions/{id}/iframe-context (existing — no change)
        │
        ▼ then, in the same effect:
MCPAppToolCallRouter posts to /api/sessions/{id}/proactive-event-check (NEW endpoint)
  body: { skillId, eventKind: "sim_run", eventPayload: {...} }
        │
        ▼
Backend gate decision (server-authoritative, no agent invocation here):
  1. Skill has `proactive_event_reactive=true` ?              → else 200 {shouldFire: false, reason: "skill opted out"}
  2. eventKind in MEANINGFUL_ALLOWLIST (hardcoded) ?           → else 200 {shouldFire: false, reason: "event kind not meaningful"}
  3. now - last_student_message_ts > proactive_heartbeat_seconds ? → else {shouldFire: false, reason: "student recently active"}
  4. now - last_proactive_turn_ts > 90s (session-wide cooldown) ?  → else {shouldFire: false, reason: "cooldown active"}
  5. proactive_turn_count < proactive_max_per_session (default 2, auto-greet counts) ? → else {shouldFire: false, reason: "cap reached"}
  → all pass: 200 {shouldFire: true, trigger: "[event_reactive:sim_run]"}
        │
        ▼ if shouldFire:
Frontend POSTs to /api/chat/{skill_id} (the existing AG-UI endpoint)
  RunAgentInput.messages: [{ role: "user", content: "[event_reactive:sim_run]" }]
        │
        ▼
AG-UI streams the proactive turn back via the existing SSE subscription —
no new transport, no special rendering. The agent's instruction has the
`## Reactive turn` section appended at agent-build time (mirroring Phase A's
inject_opening_guidance), so the agent knows to produce a short observation +
question grounded in the triggering event.

FE suppresses the [event_reactive:*] sentinel from rendering as a user message
(same pattern Phase A uses for PROACTIVE_GREET_TRIGGER).
```

**Why this is the right shape (recap from the architectural-decision discussion):**

- **Protocol fit** — proactive turn travels AG-UI, identical to user-driven turns. No new transport, no message-injection API needed on the FE.
- **Auth + gate stay server-side** — FE can't bypass cooldown or cap by skipping the check; the AG-UI POST without the gate decision still works mechanically but won't produce the right reactive prompt without the `## Reactive turn` injection (which only fires when proactive flow is in play).
- **Telemetry parity** — the proactive turn shows up in chat_turns BQ exactly as any other turn; OTel span on the AG-UI run tags `tutor.proactive_kind="event_reactive"` so the analytics-chat skill can already filter for proactive turns.
- **Phase A is now a candidate for the same refactor** — see [M10 follow-up](#m10---commit-push-and-file-phase-a-refactor-follow-up) below.

## Scope locks

### In scope

- New endpoint `POST /api/sessions/{id}/proactive-event-check` returning the gate decision (no agent invocation)
- Three new `SkillConfig` fields: `proactive_event_reactive: bool` (default false), `proactive_heartbeat_seconds: int` (default 10), `proactive_max_per_session: int` (default 2)
- Per-skill SKILL.md frontmatter for the new fields + a `## Reactive turn` content section (Boldkast / `problem-set-hints`, `led-planck-tutor`, `kinebot-kinematics-tutor`)
- Backend agent-build-time injection helper `inject_reactive_guidance()` mirroring `inject_opening_guidance()` from Phase A
- Session-state tracking for `last_proactive_turn_ts` + `proactive_turn_count` (verify Phase A already persists one or both; extend if needed)
- Frontend: hook from `MCPAppToolCallRouter` (and any other commit-on-submit producer) to call the new endpoint after the existing `iframe-context` POST; on `shouldFire: true`, programmatically trigger an AG-UI run with the trigger sentinel
- FE sentinel suppression: extend the existing `PROACTIVE_GREET_TRIGGER` filter to also suppress `[event_reactive:*]` user-role messages from rendering
- OTel attributes on the proactive AG-UI run: `tutor.proactive_kind="event_reactive"`, `tutor.triggering_event_kind=<kind>`, `tutor.idle_seconds=<int>`
- Hardcoded `MEANINGFUL_EVENT_KINDS` server-side allowlist (per design-doc recommendation): `{"sim_run", "step_advance", "measurement_commit"}` — slider drag, reset, debounced state syncs are excluded

### Out of scope (deferred / explicit non-goals)

- Per-skill override of `MEANINGFUL_EVENT_KINDS` allowlist (hardcoded for v1.1; promote to per-skill config only if a skill needs different rules)
- Phase A refactor to Path B — captured as a M10 follow-up doc, not done in this sprint
- Workbench-state-aware nudges based on accumulated workbench state (e.g. *"I see you've tried 30° three times"*) — separate design, year-2
- Server-side idle detection / heartbeat fallback — Path A's idle-heartbeat Phase B was retired; not reviving it here
- Per-cohort or per-class proactive caps
- Recovery-rate metric instrumentation (% of proactive turns followed by student response) — file as a follow-up if pilot teachers want it
- A2A discovery for proactive turns
- New endpoint shape divergent from `/greet` — keep parity for future maintenance

## Workflow

Per the no-PR memory: work on `dev` directly. Commit per-milestone locally as you go (each commit independently passes lint + relevant tests for fast bisect-ability later); `git push origin dev` only after M10 final-gate pass.

No worktrees / sub-agents this sprint — sequential single-track is the right fit for fullstack work where each milestone informs the next. (Last sprint's parallel sub-agent shape was the right call for two file-disjoint quick wins; this one isn't.)

## Milestones

### M1 — Confirm CopilotKit / ag_ui_adk FE trigger API exists (~30 min, BLOCKING)

**The Path B fallback gate.** Before any backend work, confirm the frontend can programmatically trigger an AG-UI run with a custom message payload (not driven by user typing). Likely options:

- CopilotKit's `useCopilotChat()` hook may expose `appendMessage` / `sendMessage`
- Or the AG-UI subscription used in [frontend/src/app/chat/\[...path\]/page.tsx](../../../../frontend/src/app/chat/[...path]/page.tsx) may expose a programmatic POST helper
- Worst case: raw `fetch` to `/api/proxy/api/chat/{skill_id}` with a `RunAgentInput` body works but bypasses CopilotKit's state — likely breaks the AG-UI thread state on the FE

**Recon steps:**
1. Read [frontend/src/app/chat/\[...path\]/page.tsx](../../../../frontend/src/app/chat/[...path]/page.tsx) around the AG-UI subscription
2. Read [frontend/src/hooks/useProactiveGreet.ts](../../../../frontend/src/hooks/useProactiveGreet.ts) (or wherever Phase A lives) to see how it integrates with the chat state
3. Grep `node_modules/@copilotkit` (or wherever CopilotKit is installed) for `appendMessage|sendMessage|runAgent`
4. If found → proceed with M2. If not found → escalate: write a Path A fallback variant (REST + FE injection) and update this sprint plan. Don't improvise an undocumented FE side-channel.

**Acceptance:**
- [ ] FE recon completed; one of: (a) "API exists, here's the call site we'll use", or (b) "API does not exist; falling back to Path A"
- [ ] If (b): pause sprint and update plan before continuing

### M2 — Backend: SkillConfig fields + frontmatter parsing + platform_seed wiring (~1h)

**Files (modify):**
- `backend/db/models/__init__.py` — extend `SkillConfig` with `proactive_event_reactive: bool = Field(default=False, alias="proactiveEventReactive")`, `proactive_heartbeat_seconds: int = Field(default=10, alias="proactiveHeartbeatSeconds")`, `proactive_max_per_session: int = Field(default=2, alias="proactiveMaxPerSession")`
- `backend/skills/skill_processor.py` — parse the three new fields in `_parse_template` (the production seed-pipeline entry point per QUICK-WINS-V11 M2's finding)
- `backend/admin/platform_seed.py` — handle the three new fields in the same shape as existing `proactiveGreet` / `openingTemplate` (lines 151, 184, 226 area — see existing pattern)
- `backend/skills/routes.py` line 91 area — add the three fields to the public-facing skill DTO if applicable

**Files (new):**
- `backend/tests/unit/skills/test_proactive_event_reactive_config.py` — assert the three new fields parse correctly from a SKILL.md frontmatter fixture; defaults are correct; YAML→Pydantic alias resolution works

**Acceptance:**
- [ ] SkillConfig accepts the three new fields with documented defaults
- [ ] Parsing a SKILL.md with `proactiveEventReactive: true` resolves to `SkillConfig.proactive_event_reactive == True`
- [ ] platform_seed includes the three fields in the seed payload (verify by re-running an existing seed test if one covers proactiveGreet — extend it)
- [ ] No regression in existing SkillConfig tests
- [ ] `cd backend && make lint && make test-fast` green
- [ ] Commit: `feat(skills): SkillConfig fields for proactive event-reactive turns (M2 sprint PROACTIVE-SIM-REACTIVE)`

### M3 — Backend: `inject_reactive_guidance` helper (~45 min)

Mirror Phase A's `inject_opening_guidance` shape so future maintenance is uniform.

**Files (new):**
- `backend/adk/proactive_reactive.py` — exports `inject_reactive_guidance(instruction: str, *, proactive_event_reactive: bool, reactive_template: str | None) -> str`. Behaviour: no-op when flag false or template empty; otherwise appends a `## REACTIVE GUIDANCE` block (parallel to Phase A's `## OPENING GUIDANCE`) telling the model the next turn is a sim-reactive proactive turn triggered by an event, and the response should be a short observation + question grounded in the event payload.

**Files (modify):**
- `backend/adk/agent.py` — extend the agent-build chain that calls `inject_opening_guidance` to also call `inject_reactive_guidance` (both compose into the system prompt). Position: after opening guidance (so the model sees opening expectations first if both are on).

**Files (new):**
- `backend/tests/unit/test_proactive_reactive.py` — mirror `test_proactive_greet.py` shape exactly. Cases: flag-false-is-noop; flag-true-empty-template-is-noop; flag-true-template-present-appends; appending preserves base instruction prefix.

**Acceptance:**
- [ ] Helper exists with the documented contract
- [ ] Agent factory calls both Phase A and Phase B injectors
- [ ] 4+ pytest cases mirroring `test_proactive_greet.py`
- [ ] `make lint && make test-fast` green
- [ ] Commit: `feat(adk): inject_reactive_guidance helper for proactive event-reactive turns (M3 sprint PROACTIVE-SIM-REACTIVE)`

### M4 — Backend: session-state tracking for `last_proactive_turn_ts` + `proactive_turn_count` (~30 min)

**Recon first:** check whether Phase A already persists either of these on the session. If `proactiveGreet` increments any counter, we may already have what we need. Otherwise, extend.

**Files (modify, likely):**
- `backend/db/models/chat_session.py` (or `chat_sessions.py`) — add `last_proactive_turn_ts: float | None = None`, `proactive_turn_count: int = 0`
- `backend/protocols/proactive_routes.py` — at the end of a successful `/greet`, increment `proactive_turn_count` and set `last_proactive_turn_ts = now` (so auto-greet counts toward the cap per the design-doc-confirmed rule)
- Wherever the AG-UI run for `[event_reactive:*]` completes — same increment (M8's wiring will create the hook; this milestone defines the field + the Phase A side increment)

**Acceptance:**
- [ ] Fields persist on the session doc
- [ ] Greet endpoint increments counter + timestamp after a non-skipped greet
- [ ] Pytest covers the increment (add one case to `test_proactive_routes.py`)
- [ ] No regression in existing proactive-routes tests
- [ ] Commit: `feat(sessions): track proactive turn count + last timestamp on session (M4 sprint PROACTIVE-SIM-REACTIVE)`

### M5 — Backend: `POST /proactive-event-check` endpoint (~1.5h)

The gate-decision endpoint. No agent invocation; pure decision based on persisted state + skill config + the inbound event.

**Files (modify):**
- `backend/protocols/proactive_routes.py` — add the second endpoint. Mirror `/greet`'s shape (request body Pydantic model, response DTO with optional `skipped`+`reason` or `shouldFire`+`trigger`, auth via existing `get_current_user`).
  - Request body: `ProactiveEventCheckRequest { skillId: str, eventKind: str, eventPayload: dict | None = None }`
  - Response: `ProactiveEventCheckResponse { shouldFire: bool, reason: str | None = None, trigger: str | None = None, sessionId: str | None = None }`
  - Gates in order: skill exists / flag on / event kind in allowlist / idle threshold / cooldown / cap
  - On `shouldFire: true`: return `trigger="[event_reactive:{eventKind}]"` (the sentinel the FE will POST to `/api/chat/{skill_id}`)

**Files (modify):**
- `backend/protocols/proactive_routes.py` top of file — add `MEANINGFUL_EVENT_KINDS: frozenset[str] = frozenset({"sim_run", "step_advance", "measurement_commit"})` with a comment pointing at the design doc for the rationale

**Files (new):**
- `backend/tests/api_tests/test_proactive_event_check.py` — 10+ cases: skill missing (404); skill opted out (200, reason); event kind not in allowlist (200, reason); student message within threshold (200, reason); cooldown active (200, reason); cap reached (200, reason); happy path (200, shouldFire=true, correct trigger sentinel); auth missing (401); session not found (404); event payload accepted and ignored (forward-compat — payload may carry data future versions use)

**Acceptance:**
- [ ] Endpoint mounted at `POST /api/sessions/{id}/proactive-event-check`
- [ ] All 10+ pytest cases green
- [ ] Endpoint never invokes the agent — purely a gate decision (verify by patching the agent module and asserting it's not called)
- [ ] `make lint && make test-fast` green
- [ ] Commit: `feat(protocols): proactive-event-check gate endpoint (M5 sprint PROACTIVE-SIM-REACTIVE)`

### M6 — Backend: per-skill SKILL.md `## Reactive turn` content sections (~30 min)

**Files (modify):**
- `backend/skills/templates/problem-set-hints/SKILL.md` — frontmatter: `proactiveEventReactive: true`, `proactiveHeartbeatSeconds: 10`, `proactiveMaxPerSession: 2`. Body: append a `## REACTIVE TURN` content section (English; this skill is the v0.1 Boldkast tutor). Content per the design doc's example block: short observation + question grounded in the event payload; no lecturing; no yes/no questions.
- `backend/skills/templates/led-planck-tutor/SKILL.md` — same flag + Danish-stx-tone reactive content (use the Boldkast example as a template; rewrite in Danish).
- `backend/skills/templates/kinebot-kinematics-tutor/SKILL.md` — same flag + English NCERT-tone reactive content.

**Acceptance:**
- [ ] All three SKILL.md files carry the three new frontmatter fields
- [ ] All three have a `## REACTIVE TURN` section placed naturally (per QUICK-WINS-V11 M1's finding that these files have skill-specific section structures — pick the right insertion point per file)
- [ ] No emoji
- [ ] No other text in the three files modified
- [ ] Re-run M2's parsing tests (or add an end-to-end SKILL.md→SkillConfig assertion) to confirm parsing the actual templates works
- [ ] Commit: `feat(skills): per-skill REACTIVE TURN sections + frontmatter flags (M6 sprint PROACTIVE-SIM-REACTIVE)`

### M7 — Backend: OTel attributes on proactive AG-UI runs (~30 min)

**Files (modify):**
- `backend/observability/telemetry.py` (or wherever OTel span attributes are set on agent runs — verify location; Phase A's `tutor.proactive_kind="greet"` attribute lives somewhere already) — extend the attribute-setting code to recognise `[event_reactive:*]` sentinels and set `tutor.proactive_kind="event_reactive"` + `tutor.triggering_event_kind=<kind extracted from sentinel>` + `tutor.idle_seconds=<int from session-state read>`

**Acceptance:**
- [ ] OTel span on a `/api/chat/{skill_id}` POST whose first user message is `[event_reactive:sim_run]` carries the three new attributes
- [ ] Pytest covers attribute presence (extend whichever test file already covers `tutor.proactive_kind="greet"`)
- [ ] No regression in Phase A's greet OTel attributes
- [ ] Commit: `feat(observability): OTel attributes for proactive event-reactive turns (M7 sprint PROACTIVE-SIM-REACTIVE)`

### M8 — Frontend: hook from MCPAppToolCallRouter + AG-UI trigger (~1.5h)

**Files (modify):**
- `frontend/src/components/protocols/MCPAppToolCallRouter.tsx` (line 432 area, the existing `iframe-context` POST) — after a successful iframe-context POST whose payload includes a meaningful `kind`, fire `POST /api/proxy/api/sessions/{id}/proactive-event-check` with `{ skillId, eventKind, eventPayload }`. On `shouldFire: true` response, use the API discovered in M1 to trigger an AG-UI run with `RunAgentInput.messages = [{ role: "user", content: result.trigger }]`.
- `frontend/src/components/workspace/ProgressChecklist.tsx` line 83 — same hook for checklist commits (a `step_advance` event is meaningful too)
- Frontend chat message renderer (verify path — likely `frontend/src/components/chat/MessageBubble.tsx` or `ChatMessageList.tsx`) — extend the existing `PROACTIVE_GREET_TRIGGER` suppression filter to also suppress messages where `content` matches `^\[event_reactive:[a-z_]+\]$`. Single regex / startsWith check. Don't duplicate the suppression logic; refactor the existing filter into a helper if needed.

**Files (new):**
- `frontend/src/hooks/useProactiveEventCheck.ts` — small hook wrapping the fetch + trigger. Returns a function `(eventKind: string, eventPayload?: unknown) => Promise<void>` that does the gate-check call and conditionally fires the AG-UI run.

**Acceptance:**
- [ ] Pressing Play on Boldkast in LOCAL_MODE → backend logs show one `/iframe-context` POST + one `/proactive-event-check` POST + (if eligible) one `/api/chat/problem-set-hints` POST with the `[event_reactive:sim_run]` user message
- [ ] The user-message sentinel does NOT render as a chat bubble
- [ ] The tutor's proactive turn DOES render in the chat scroll like any normal turn
- [ ] Cooldown enforced: second Play within 90s does not trigger a second proactive turn
- [ ] Cap enforced: after 2 proactive turns (counting auto-greet), further Plays don't trigger
- [ ] No regression in chat UX for non-reactive sessions
- [ ] Commit: `feat(frontend): wire MCPAppToolCallRouter to proactive-event-check + AG-UI trigger (M8 sprint PROACTIVE-SIM-REACTIVE)`

### M9 — Frontend: vitest for the trigger flow + sentinel suppression (~30 min)

**Files (new):**
- `frontend/src/hooks/__tests__/useProactiveEventCheck.test.ts` — mock fetch; assert correct POST shape to `/proactive-event-check`; on `shouldFire:false` no follow-up call; on `shouldFire:true` triggers AG-UI with the correct sentinel
- Extend whichever existing test covers `PROACTIVE_GREET_TRIGGER` suppression — add cases for `[event_reactive:sim_run]`, `[event_reactive:step_advance]`, `[event_reactive:measurement_commit]` all suppressed

**Acceptance:**
- [ ] Hook test green (5+ cases)
- [ ] Sentinel suppression test green
- [ ] `npm run quality:check` (full, not fast — per `feedback_pre_push_ci_parity`) green
- [ ] Commit: `test(frontend): proactive-event-check hook + sentinel suppression (M9 sprint PROACTIVE-SIM-REACTIVE)`

### M10 — Commit, push, and file Phase A refactor follow-up (~30 min)

**Final quality gates (mandatory before push, per `feedback_pre_push_ci_parity`):**

```bash
cd backend && make lint && make test-fast
cd frontend && npm run quality:check
```

Both must be green. `make test-fast` excludes slow-marked tests; if any new tests need slow-mark (LLM-dependent), mark them.

**Push:**

```bash
git push origin dev
```

No PR per `feedback_no_prs_commit_to_dev`.

**Phase A refactor follow-up — file as a small design-doc stub:**

Create `docs/design/aipla/v1.1.0-feedback/proactive-greet-refactor-to-path-b.md` (~30 lines) with this shape:

- **Status**: Planned (~0.5d follow-up)
- **Why**: Phase A (auto-greet) currently bypasses AG-UI and uses a sync REST endpoint that returns the assistant text in the response body, with the FE splicing it into `initialMessages`. This works but is inconsistent with the protocol stack — the proactive turn doesn't ride AG-UI, doesn't get the streaming animation, requires special FE rendering. Phase B (this sprint) establishes the Path-B pattern (FE triggers AG-UI with a synthetic sentinel). Phase A should converge on the same pattern so there's one proactive-turn rail, not two.
- **What changes**: `/greet` becomes a gate-decision endpoint (`shouldFire: bool, trigger: "[session_start]"`); FE-side `useProactiveGreet` becomes a thin wrapper that triggers an AG-UI run with the sentinel; the splice-into-`initialMessages` code path comes out
- **Why not now**: This sprint already touches the proactive subsystem; refactoring Phase A too in the same sprint doubles the surface area + risks regressing the demo path that's been stable since 2026-05-28. Land Phase B first, exercise it for a few pilot sessions, then refactor Phase A onto the same rails.
- **Acceptance**: `/greet`'s old shape removed; FE's `useProactiveGreet` calls the same trigger mechanism M8 wires for event-reactive; no regression in greet behaviour; one less code path

**Update SEQUENCE.md sprint-status section** to record this sprint as shipped.

**Acceptance:**
- [ ] Backend `make lint && make test-fast` green
- [ ] Frontend `npm run quality:check` green
- [ ] `git push origin dev` succeeds
- [ ] Follow-up doc `proactive-greet-refactor-to-path-b.md` committed (same push)
- [ ] v1.1 SEQUENCE.md sprint-status section updated with `PROACTIVE-SIM-REACTIVE shipped` row + Phase A refactor follow-up listed
- [ ] Commit: `docs(v1.1): file Phase A refactor follow-up + mark PROACTIVE-SIM-REACTIVE shipped (M10 sprint PROACTIVE-SIM-REACTIVE)`

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| M1 fails — CopilotKit / ag_ui_adk has no programmatic-trigger API | Low-medium | Path A fallback (extend `/greet` shape; FE inject mid-session) — adds ~2h, doesn't kill the sprint. Sprint pauses for plan revision before continuing |
| FE sentinel suppression misses an edge case → student sees `[event_reactive:sim_run]` as their own message in the chat | Medium | M9's vitest explicitly covers all three sentinel forms; manual smoke in M8's acceptance gate |
| Cooldown / cap state lost across server restarts (in-memory only) | Medium | Tracking lives in Firestore session doc (M4) — survives restarts. Verify with a test that re-instantiates the session service mid-test |
| Proactive turn fires during AG-UI's existing stream of a user-driven turn → two streams interleave on the FE | Low | CopilotKit's per-thread serialisation should prevent this; if observed, debounce the proactive trigger to wait for any in-flight stream to complete before firing |
| Meaningful-event allowlist misclassified (e.g. forgot a kind that should trigger) | Medium | Hardcoded list is easy to extend; AR can flag missing kinds during pilot review |
| `## REACTIVE TURN` content produces lectures despite the system prompt | Medium | Inherits the v1.1.1 verbosity constraint (≤3 sentences); content section explicitly forbids lectures; if observed, tighten the per-skill block |
| Auto-greet + immediate event-reactive collision (greet at t=0, sim run at t=2s → two tutor turns back-to-back) | Medium | M4 makes auto-greet increment the same counter, so the cap of 2 means "1 reactive after the greet". Plus the idle threshold gates the reactive on "no student message in 10s" — auto-greet doesn't count as a student message, but the threshold from the GREET still applies |
| LOCAL_MODE event flow diverges from prod (e.g. iframe-context POST doesn't carry `kind` in LOCAL_MODE) | Low-medium | M8 acceptance gate is LOCAL_MODE-driven; surfaces this early |

## Quality gates (recap)

Per [feedback-pre-push-ci-parity](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_pre_push_ci_parity.md):

```bash
# After each backend-touching milestone:
cd backend && make lint && make test-fast

# After each frontend-touching milestone:
cd frontend && npm run quality:check    # full, not fast — tests + build included

# Before push (M10):
cd backend && make lint && make test-fast
cd frontend && npm run quality:check
```

**Do not push without both green.** `make test-fast` alone or `npm run quality:check:fast` alone has burned dev for 9 commits in the past.

## Success criteria

- [ ] Boldkast LOCAL_MODE session: press Play → backend logs `/proactive-event-check` POST + (if first eligible event) one AG-UI run with `[event_reactive:sim_run]` user content; the AG-UI run streams a short tutor turn back; chat scroll shows one new tutor bubble; the sentinel does NOT show as a user bubble
- [ ] Second Play within 90s → `/proactive-event-check` returns `shouldFire:false, reason:"cooldown active"`; no AG-UI run; no new tutor bubble
- [ ] After 2 proactive turns (greet + 1 reactive, OR 2 reactives) → further Plays return `shouldFire:false, reason:"cap reached"`
- [ ] Pure-text chat (student typing without sim activity) unchanged — no new tutor bubbles inserted
- [ ] All three skills have working reactive turns
- [ ] OTel span attributes visible in trace logs for proactive turns
- [ ] Backend test count: increases by ~25-30 net new tests (M2: 4, M3: 4, M4: 1, M5: 10+, M7: 1-2, all green)
- [ ] Frontend test count: +5-8 net new tests (M9)
- [ ] `git push origin dev` lands cleanly
- [ ] Phase A refactor follow-up doc committed

## Out of scope (do NOT start in this sprint)

- Phase A `/greet` refactor (filed as M10 follow-up doc — separate ~0.5d sprint)
- Per-skill allowlist of meaningful event kinds (hardcoded for v1.1)
- Workbench-state-aware nudges
- Recovery-rate metric instrumentation
- Notification when proactive cap is approaching
- Server-side idle detection / heartbeat — Phase B's original shape, retired
- Cross-skill or cross-session memory for proactive turns
- A2A discovery for proactive turn types
- Mobile-specific tuning (idle thresholds differ on mobile)

## Related

- [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) — design doc for this sprint
- [proactive-tutor.md](../v1.0.0-pilot/proactive-tutor.md) — Phase A design doc (Phase B retired per Path A confirmation)
- [implemented/quick-wins-v1.1-sprint.md](implemented/quick-wins-v1.1-sprint.md) — last sprint shipped, established the v1.1 build cadence + commit pattern
- [SEQUENCE.md](SEQUENCE.md) — v1.1 sequence; this sprint covers row 1.1.2
- `backend/protocols/proactive_routes.py` — Phase A endpoint (this sprint extends with a sibling endpoint)
- `backend/adk/proactive_greet.py` — Phase A injection helper (this sprint mirrors with `proactive_reactive.py`)
- `backend/protocols/iframe_context_routes.py` — the workbench-event POST handler the FE calls before the new gate check
- [feedback-no-prs-commit-to-dev](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_prs_commit_to_dev.md) — workflow rule applied to this sprint
- [feedback-search-protocols-first](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md) — the principle that drove the Path A → Path B redesign
- [feedback-self-testable-loops](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_self_testable_loops.md) — every milestone has self-runnable tests; M8's manual LOCAL_MODE check is the final human-eye, not the only check
