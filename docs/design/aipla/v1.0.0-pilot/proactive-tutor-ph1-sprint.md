# Sprint: TUTOR-GREET-PH-A — proactive tutor Phase A (auto-greet)

**Sprint ID:** `TUTOR-GREET-PH-A`
**Design doc:** [proactive-tutor.md](proactive-tutor.md) — Phase A section
**Branch:** `feature/proactive-tutor-greet`
**Base commit:** `2cb35f4` (dev HEAD as of 2026-05-25)
**PR target:** `dev`
**Estimate:** ~0.9 day (matches design doc Phase A table)
**Created:** 2026-05-25

## Sprint goal

Ship the auto-greet half of the proactive tutor: when a student joins a brand-new session for a skill that opts in via `proactive_greet: true`, the tutor speaks first (real agent turn) so the student isn't left staring at a blank chat wondering what to do.

Motivating incident: 2026-05-25 live student test — student joined the LOCAL_MODE demo group, saw the static welcome banner, sat silent for 30s, asked the room *"what do I do?"* The session never started.

## Scope (locked from design doc Phase A)

**In scope:**
- New `SkillMetadata.proactive_greet: bool` (default false) — per-skill opt-in
- New `SkillMetadata.opening_template: str | None` — skill-author-supplied seed text used in the agent's first turn
- New `backend/adk/proactive_greet.py` — instruction wrapper that appends the opening template to the agent's system prompt when proactive_greet is true
- New `POST /api/sessions/{session_id}/greet` endpoint — idempotent; fires one agent turn when session is brand-new
- Frontend bootstrap fires `/greet` on chat-page mount when `skill.proactive_greet && (session is new)`
- Author `proactive_greet: true` + `## Opening` for problem-set-hints (the LOCAL_MODE demo skill)
- OTel span tag `tutor.proactive_kind=greet` on the proactive turn

**Out of scope (Phase B, deferred to JB sign-off):**
- Idle-heartbeat check-ins
- `idle_heartbeat_seconds` / `idle_nudge_template` fields
- `useIdleHeartbeat` frontend hook
- The `/heartbeat-nudge` endpoint

## Velocity context

The 2026-05-25 session shipped Phase 1 + Phase 2 of teacher-UI (3 PRs, ~2500+ LOC including the post-pilot design stubs). Phase A here is ~1d of focused work on a single feature — well within the demonstrated throughput.

## Milestones

### M1 — SkillMetadata fields + skill_materializer mapping (~0.1d)

**Files:**
- `backend/db/models/__init__.py` — add `proactive_greet: bool = False` (alias `proactiveGreet`) and `opening_template: str | None = None` (alias `openingTemplate`) to `SkillMetadata`
- `backend/skills/skill_materializer.py` — map both fields in `frontmatter_metadata` (lines 27-39 area)

**Acceptance:**
- [ ] Fields land in `SkillConfig` Pydantic model with camelCase aliases for Firestore consistency
- [ ] `skill_from_config()` includes them in the assembled metadata
- [ ] Existing skills (without the new fields) round-trip without breaking — defaults hold

### M2 — `backend/adk/proactive_greet.py` instruction wrapper (~0.1d)

**Files (new):**
- `backend/adk/proactive_greet.py` — `inject_opening_guidance(instructions: str, opening_template: str | None, proactive_greet: bool) -> str`

Pattern mirrors `backend/adk/teacher_focus.py:inject_teacher_focus()`. No-op when either flag is false / template is None. When both are set, appends an `OPENING GUIDANCE` block to the instructions (clearly delimited so the model treats it as system context, not user data — same pattern as the iframe-context block).

**Acceptance:**
- [ ] Unit tests in `backend/tests/unit/test_proactive_greet.py`:
  - No-op when `proactive_greet=False`
  - No-op when `opening_template=None`
  - Append happens when both are set
  - Block uses clear delimiter framing

### M3 — Wire into agent factory (~0.05d)

**Files:**
- `backend/adk/agent.py` — extend the `compose_instruction_providers(...)` call in `create_agent()` to include `inject_opening_guidance(...)` before the `compose_instruction_providers` chain (same position as `inject_teacher_focus`)

**Acceptance:**
- [ ] Existing `test_teacher_focus.py` still passes (no regression in the chain order)
- [ ] When a skill has `proactive_greet: true` + `opening_template: "..."`, the assembled agent instruction contains both the opening guidance AND the teacher focus block

### M4 — `POST /api/sessions/{id}/greet` endpoint + tests (~0.3d)

**Files (new):**
- `backend/protocols/proactive_routes.py` — endpoint definition
- `backend/tests/api_tests/test_proactive_routes.py` — pytest cases

**Endpoint behaviour:**
- Validates session does not exist OR exists with `turn_count == 0`
  - If session exists with `turn_count > 0`: return 200 with `{ "skipped": true, "reason": "session has prior turns" }` (idempotent)
  - If session does not exist: continue (the agent's normal session-tracker callback will create it)
- Looks up the skill via `skills.skill_config.get_skill(skill_id)`
- If skill has `proactive_greet: false` or missing: 200 with `{ "skipped": true, "reason": "skill opted out" }`
- Otherwise: invokes the existing skill-stream flow with `message=""` (synthetic empty user content)
- OTel span tagged `tutor.proactive_kind=greet`
- Auth: `Depends(get_current_user)` — same gate as the chat-stream path
- Returns `202 Accepted` with the agent's tutor turn text in the response body (one-shot, no SSE — keeps the contract simple)

**Acceptance:**
- [ ] Test: greet fires on a fresh session for a `proactive_greet: true` skill
- [ ] Test: greet is a no-op on a session with `turn_count > 0`
- [ ] Test: greet is a no-op for a `proactive_greet: false` skill
- [ ] Test: 401 when no auth
- [ ] Test: 404 when skill doesn't exist
- [ ] Registered in `fast_api_app.py`

### M5 — Frontend bootstrap trigger (~0.2d)

**Files:**
- `frontend/src/hooks/useSkillAgent.ts` (or wherever the chat-page bootstrap lives) — on mount, when the skill's `proactiveGreet` is true and there's no existing thread/turn-count, POST `/api/proxy/api/sessions/{id}/greet`
- `frontend/src/lib/proactiveGreet.ts` (new) — typed `fetchProactiveGreet(sessionId, skillId)` helper using `fetchWithAuth`

**Behaviour:**
- Frontend only fires `/greet` once per chat mount (use a ref to guard against React StrictMode double-effects)
- The greet's response body is appended to the chat-message list as the first tutor message (no SSE — direct insert)
- On error: log + fall back to the existing static-banner behaviour (no crash)

**Acceptance:**
- [ ] Manual: fresh `/group` join → land in chat → tutor first message appears within ~2s without any student input
- [ ] Manual: same flow but with `proactive_greet: false` skill → today's behaviour (static banner only)

### M6 — Skill template content for problem-set-hints (~0.1d)

**Files:**
- `backend/skills/templates/problem-set-hints/SKILL.md` — add `proactiveGreet: true` to frontmatter; add new `## Opening` section with skill-author guidance for the tutor's first turn (~5 sentences, Danish + English mix appropriate for stx audience)
- `backend/admin/platform_seed.py` — if frontmatter parser doesn't already read these fields, extend it (mirror the pattern for `initialMessage`)

**Acceptance:**
- [ ] After re-seed, `problem-set-hints` SkillConfig has the new fields populated
- [ ] Manual: LOCAL_MODE join → tutor's first turn reflects the `## Opening` guidance (not generic)

### M7 — Quality gates (~0.1d)

- [ ] `cd backend && make lint && make test-fast` — green; pre-existing failing tests excluded
- [ ] `cd frontend && npm run quality:check` — green (lint + typecheck + tests + build)
- [ ] No emoji introduced (per [feedback-no-emoticons](file:///Users/voightkampff/.claude/projects/-Users-voightkampff-dev-sunholo-data-cphu-aipla-app/memory/feedback_no_emoticons.md))

### M8 — PR + deploy (~0.1d)

- [ ] PR opened against `dev` from `feature/proactive-tutor-greet`
- [ ] PR body includes: link to [proactive-tutor.md](proactive-tutor.md) Phase A section, the test plan from the design doc, and an "end-to-end check on the deployed dev URL" item that confirms students see the auto-greet after merge

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Empty synthetic user message pollutes the conversation log analytics | Medium | OTel span tag `tutor.proactive_kind=greet` lets downstream analytics filter; documented in the design doc |
| Agent generates a poor first turn | Medium | The skill-author writes the `## Opening` content — deterministic seed |
| Token cost spikes if greet fires on every page refresh | Low | Endpoint is idempotent (no-ops on `turn_count > 0`); session-bootstrap already exists; refresh hits existing session |
| Frontend fires `/greet` twice due to React StrictMode | Medium | Use a ref guard in the useEffect |

## Success criteria

- [ ] PR opened against `dev` from `feature/proactive-tutor-greet`
- [ ] All 8 milestones' acceptance gates met
- [ ] Backend test-fast + frontend quality:check both green
- [ ] Manual end-to-end on local LOCAL_MODE: join `/group` with code `local-demo` → tutor first turn appears unprompted within ~2s

## Out of scope (do NOT start)

Per the design doc Phase A:

- Idle heartbeat (Phase B — needs JB sign-off on timing + copy)
- Multi-language auto-detection
- Cross-session "welcome back" memory (1.F territory)
- Server-side idle detection (frontend-only timer in Phase B)
