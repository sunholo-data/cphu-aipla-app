# Sprint Plan: PEDCTX — pedagogical-context polish (v0.1 buffer week)

## Summary
Convert v0.1 from "chat that works" to "chat that gives the student enough context to work effectively" — Jutland over-deliver track. Five milestones, sequencible 1-2-3-4 then optional 5. Each lands as its own commit. Target: EOD **2026-05-21 (Thu)** with M5 spilling to Fri if needed. Demo is Wed 2026-05-27 — buffer remains generous.

**Duration:** ~6h core (M1+M2+M3+M4) + ~2h stretch (M5)
**Scope:** Fullstack (no infra changes)
**Dependencies:** v0.1 shipped (`89bf7ee`); `agent-protocols` skill landed; Boldkast design doc landed but artefact not yet built (separate Fri/Mon track)
**Risk Level:** Low — all changes are surface-level UX + one small backend filter; no migrations, no auth changes, no infra
**Design Docs:**
- [jutland-demo.md](jutland-demo.md) — v0.1 base
- [boldkast-mcp-app.md](boldkast-mcp-app.md) — workspace surface arrives there too
- ADR-001 (anonymous group IDs), ADR-015 (multi-surface UI) — both honoured

## Current Status

### Recent Velocity (last 7 days, post-v0.1-ship)
- `89bf7ee` agent-protocols skill — 10 vendored specs, +6011 LOC
- `310aab2` Boldkast MCP App design doc — +307 LOC
- `20c84a0` chat-input fold fix — banner-aware layout
- `36ee3cd` first-pass fold fix (insufficient — see #23 update)
- `c3699fd` anon-group surface gating (skill-create + doc-browse hidden)
- `7eec821` SkillsBar scoped to group skill_ids
- Pace: ~3-5 commits/day, mostly polish

### What works (don't re-build)
- Chat path end-to-end with anon-group auth
- `problem-set-hints` skill template (Danish welcome, scaffolding rules)
- Welcome panel renders on empty chat with KaTeX + 3 starter prompts
- `WorkspaceSurfaceRegion` and `MCPAppToolCallRouter` are wired but unmounted in anon-group flow ([frontend/src/app/chat/[...path]/page.tsx:531](../../../../frontend/src/app/chat/[...path]/page.tsx#L531))
- ADK SessionService persists message history; `state_delta` events available for state mutation

### What's missing (this sprint's targets)
- A2UI tool still wired to every skill regardless of `tools:` declaration (upstream-feedback #22) — currently band-aided with a prompt rule in `problem-set-hints/SKILL.md`
- Workspace surface never mounts for anon-group + problem-set-hints (we hid it during anon-group cleanup; need it back, gated correctly)
- Problem statement is in the system prompt but not visible to the student — they only see the welcome blurb + their physical worksheet
- Welcome panel disappears on first message (template default behaviour; wrong for AIPLA)
- No progress tracking — student can't mark sub-parts done; agent has no signal beyond conversation inference

## Proposed Milestones

### M1: A2UI opt-in framework fix (`feat(adk): A2UI toolset respects skill tools declaration`)
**Scope:** backend
**Goal:** A2UI toolset attaches only when a skill's `md.tools` list contains `"a2ui"`. Other skills (including `problem-set-hints`) don't get it. Delete the SKILL.md prompt-rule hack. Token savings + closes upstream-feedback #22.
**Estimated:** ~30 LOC delta in agent.py + ~10 LOC test + ~12 LOC delete in SKILL.md = ~50 LOC
**Duration:** 1h

**Tasks:**
- [ ] Read [backend/adk/agent.py](../../../../backend/adk/agent.py) and locate the unconditional `tools.append(make_a2ui_toolset(...))` call
- [ ] Wrap it in `if "a2ui" in md.tools:` — mirrors how search-tool wiring already works
- [ ] Add unit test: skill with `tools: []` → agent has no `send_a2ui_json_to_client` tool in registry; skill with `tools: ["a2ui"]` → agent does have it
- [ ] Delete the "NEVER call `send_a2ui_json_to_client`" hard rule + Boldkast-specific guardrail from [backend/skills/templates/problem-set-hints/SKILL.md](../../../../backend/skills/templates/problem-set-hints/SKILL.md) (the 8-line block under "Hard rules — never break these" rule #2)
- [ ] Update [docs/upstream-feedback.md](../../../upstream-feedback.md) entry #22 with "Resolved on AIPLA fork" footer + commit SHA
- [ ] Verify locally: start LOCAL_MODE, hit the skill, confirm no A2UI tools advertised in the agent's tool registry

**Files to Create/Modify:**
- `backend/adk/agent.py` (modify, ~5 LOC delta — guard the append)
- `backend/tests/unit/test_agent_factory.py` (modify or new — add the test)
- `backend/skills/templates/problem-set-hints/SKILL.md` (modify, delete the rule)
- `docs/upstream-feedback.md` (modify, add resolution footer to #22)

**Acceptance Criteria:**
- [ ] `cd backend && uv run pytest tests/unit/test_agent_factory.py::test_a2ui_opt_in -v` passes
- [ ] Manual: in LOCAL_MODE, ask the bot "hi" — no `Surface already exists` errors, no autonomous A2UI tool calls in OTel traces
- [ ] `grep -rn 'send_a2ui_json_to_client' backend/skills/templates/` returns zero matches
- [ ] `make lint` + `make test-fast` pass

**Risks:**
- Other inherited skills may rely on the implicit A2UI tool (workspace-demo, etc.). Mitigation: those skills declare `tools: ["a2ui"]` in their SKILL.md — should already be there for the v6 template; verify in the same PR.
- The agent factory may use a different config field name than `md.tools` for the A2UI hook. Mitigation: search for `a2ui` in `backend/adk/` first; the wiring point will be obvious.

---

### M2: Workspace surface mounted for anon-group + problem-set-hints (`feat(ui): workspace surface for problem-set-hints in anon-group mode`)
**Scope:** frontend
**Goal:** A right-pane workspace surface mounts when a problem-set-hints student is in chat. Renders a placeholder ("Working area — context appears here") until M3 fills it. Layout responsive: 60/40 desktop, slide-up panel below md.
**Estimated:** ~80 LOC component + ~40 LOC layout changes + ~30 LOC test = ~150 LOC
**Duration:** 1.5h

**Tasks:**
- [ ] Read [frontend/src/app/chat/[...path]/page.tsx](../../../../frontend/src/app/chat/[...path]/page.tsx) around line 531 (the `!activeTabId` WorkspaceSurfaceRegion gate)
- [ ] New gate: mount the workspace pane when `(isAnonymousGroupAuthMode() && skillSlug === "problem-set-hints") || (!activeTabId && !isAnonymousGroupAuthMode())` — keeps inherited behaviour for non-anon, adds anon-group path
- [ ] Restructure the chat-page flex chain: chat column gets `flex-1 lg:flex-[3]`, workspace column gets `lg:flex-[2] lg:border-l`. Below `lg`, workspace becomes a bottom slide-up panel with a peek-header.
- [ ] Workspace shell component: `frontend/src/components/workspace/WorkspaceShell.tsx` — header bar with title + collapse toggle; body slot for child content
- [ ] Placeholder content for now: a muted "Arbejdsområde (workspace) — opgaveinfo og simulator vises her" card
- [ ] Verify `useDocBrowser` listener gating from `c3699fd` still works — workspace mounting shouldn't reintroduce Firestore permission-denied errors
- [ ] Playwright (or Vitest) smoke: render the chat page as an anon-group user on problem-set-hints route → assert workspace shell mounts; render as same user on a different skill → assert no workspace mount

**Files to Create/Modify:**
- `frontend/src/components/workspace/WorkspaceShell.tsx` (new, ~80 LOC)
- `frontend/src/app/chat/[...path]/page.tsx` (modify, ~30 LOC delta — gate + layout)
- `frontend/src/components/workspace/__tests__/WorkspaceShell.test.tsx` (new, ~30 LOC)

**Acceptance Criteria:**
- [ ] Visually verified: anon-group user lands on problem-set-hints → sees chat on left, workspace placeholder on right (desktop) or slide-up (mobile)
- [ ] Non-anon user (Firebase Auth) on any skill → behaviour unchanged
- [ ] `npm run quality:check` passes (lint + typecheck + test + build)
- [ ] No new console errors when navigating to/from chat
- [ ] Collapse toggle works; collapse state persists across page reloads via `localStorage`

**Risks:**
- Existing layout uses `min-h-0` carefully (post-`20c84a0` fold fix). New flex chain might reintroduce overflow. Mitigation: re-test the input-fold case after this lands.
- Tailwind `lg:` breakpoint at 1024px may not match the iPad teachers will use in the room. Mitigation: test at 768px (iPad portrait) and 1024px (iPad landscape) before merge; if slide-up triggers on the iPad's primary mode, drop the breakpoint to `md:`.

---

### M3: ProblemStatementCard in workspace (`feat(ui): problem statement card — full opgave text + sub-parts a-d`)
**Scope:** fullstack (tiny backend touch)
**Goal:** The Danish problem text is visible to the student in the workspace. Sub-parts a/b/c/d listed as a static checklist (no state yet — that's M5). Sourced from a new `problemStatement` field on `skillMetadata` so it's per-skill data, not hardcoded.
**Estimated:** ~60 LOC frontend component + ~10 LOC backend wiring + ~30 LOC test + ~40 LOC content (the Danish problem) = ~140 LOC
**Duration:** 1h

**Tasks:**
- [ ] Add `problemStatement: str` field to the SKILL.md frontmatter for `problem-set-hints` — full Danish problem text + sub-parts a/b/c/d as a markdown string. Mirror format used elsewhere in the file (YAML multi-line `|`)
- [ ] Extend [backend/admin/platform_seed.py](../../../../backend/admin/platform_seed.py) `_parse_template` to read `problemStatement` (alongside `displayName` and `initialMessage` it already reads from `29d4cb1`)
- [ ] Plumb through [backend/skills/routes.py](../../../../backend/skills/routes.py) `SkillResponse` → field appears in the API JSON
- [ ] Extend [frontend/src/hooks/useSkillMeta.ts](../../../../frontend/src/hooks/useSkillMeta.ts) to expose `problemStatement` (already returns `initialMessage`)
- [ ] New component `frontend/src/components/workspace/ProblemStatementCard.tsx` — renders the markdown through `ChatMarkdown` (which has KaTeX support from `1636038`); shows title "Opgave 1 — Boldkast" + body text + sub-parts list
- [ ] Mount `ProblemStatementCard` inside `WorkspaceShell` when the skill has a non-empty `problemStatement`
- [ ] Backend test: skill with `problemStatement: "..."` in frontmatter → API returns it; no field → empty string
- [ ] Frontend test: card renders Danish text + four sub-parts; no card when field is empty

**Files to Create/Modify:**
- `backend/skills/templates/problem-set-hints/SKILL.md` (modify — add `problemStatement` block, ~30 LOC content)
- `backend/admin/platform_seed.py` (modify, ~5 LOC — same pattern as `initialMessage`)
- `backend/skills/routes.py` (modify, ~3 LOC — add field to SkillResponse)
- `backend/db/models/__init__.py` (modify if needed — add `problem_statement` to `SkillConfig`, ~3 LOC)
- `frontend/src/hooks/useSkillMeta.ts` (modify, ~5 LOC — expose the field)
- `frontend/src/components/workspace/ProblemStatementCard.tsx` (new, ~60 LOC)
- `backend/tests/unit/test_platform_seed.py` (modify or new — test the new field roundtrip)
- `frontend/src/components/workspace/__tests__/ProblemStatementCard.test.tsx` (new)

**Acceptance Criteria:**
- [ ] LOCAL_MODE: open chat → workspace card shows Danish problem text + sub-parts
- [ ] Deploying same change to dev → API JSON contains `problemStatement` populated
- [ ] Backend test: round-trip test passes
- [ ] Frontend test: card mounts when field non-empty, doesn't mount when empty
- [ ] KaTeX renders correctly in the problem statement (verify with `$v_0 = 15 \text{ m/s}$` in content)

**Risks:**
- The exact Danish problem text from AR may differ from the one currently seeded in the SKILL.md system prompt. Mitigation: use the same text already in the prompt for now; AR can refine pre-demo.
- `SkillConfig` schema changes may need a Firestore-mirror cleanup in cloud. Mitigation: idempotent — empty `problem_statement` is a valid default; old skill records simply return empty string until re-seeded.

---

### M4: Pinned-collapsible welcome panel (`fix(ui): welcome panel persists after first message`)
**Scope:** frontend
**Goal:** The starter-prompts + tutorial panel stays visible after the student types their first message. Default expanded; collapsible header so it doesn't eat chat space if the student wants more room.
**Estimated:** ~50 LOC delta in ChatMessageList + ~30 LOC test = ~80 LOC
**Duration:** 0.5h

**Tasks:**
- [ ] Edit [frontend/src/components/chat/ChatMessageList.tsx](../../../../frontend/src/components/chat/ChatMessageList.tsx) — find the gate `{messages.length === 0 && !initialMessages?.length && !error && !isLoading && (` block around line 202
- [ ] Replace with a collapsible header component that renders `skillInitialMessage` regardless of `messages.length`. Header: "👋 Sådan kommer du i gang" with chevron toggle. Body: existing `ChatMarkdown` panel.
- [ ] State stored in `useState<boolean>(true)` (open by default); persist to `localStorage` keyed by `skillId` so a returning student keeps their preference
- [ ] Header sticks to the top of the scroll area (doesn't scroll with messages) — `sticky top-0` + a small shadow when scrolled past
- [ ] Verify the existing "Send a message to start..." fallback for skills with no `skillInitialMessage` still works
- [ ] Vitest: render with messages → assert welcome still visible; click chevron → assert body hides; reload → state restored

**Files to Create/Modify:**
- `frontend/src/components/chat/ChatMessageList.tsx` (modify, ~30 LOC delta)
- `frontend/src/components/chat/__tests__/ChatMessageList.test.tsx` (modify or new)

**Acceptance Criteria:**
- [ ] LOCAL_MODE: send a message → welcome stays visible above; chevron collapses body
- [ ] Reload page → collapse state preserved
- [ ] Skill without `skillInitialMessage` → no header rendered (no empty pannel)
- [ ] `npm run quality:check` passes
- [ ] Welcome doesn't visually overlap the first message bubble

**Risks:**
- Sticky positioning inside an `overflow-y-auto` scroll area can render awkwardly if the scroll container has other sticky children. Mitigation: there are no other stickies in the chat list; verify after change.

---

### M5: Student-driven progress checklist (`feat(workspace): per-subpart progress checklist via ADK session state`) — STRETCH
**Scope:** fullstack
**Goal:** A `[ ]/[x]` checklist for sub-parts a/b/c/d in the workspace, persisted in ADK session state via `state_delta`, readable by the agent. Student-driven (no auto-grading) — student clicks "Marker som klar" when they think they've finished a part.
**Estimated:** ~80 LOC frontend + ~40 LOC backend (state hook) + ~40 LOC test + system-prompt update (~10 LOC) = ~170 LOC
**Duration:** 2h

**Tasks:**
- [ ] New ADK callback in [backend/adk/callbacks.py](../../../../backend/adk/callbacks.py) (or extend existing) that injects the current progress state into the agent's context on each turn (read-only `state.get("problem_progress", {})` → formatted as "Student has marked: a (done), b (done), c (not yet)")
- [ ] New API route `POST /api/sessions/{session_id}/progress` — body `{subpart: "a", status: "done"}` — emits a `state_delta` event into the ADK session
- [ ] Frontend hook `useProblemProgress(sessionId)` — reads state via existing session-context fetch, posts on toggle
- [ ] `ProgressChecklist` component — mounts above `ProblemStatementCard` in workspace; rows like `[ ] a. Bestem v₀ₓ og v₀ᵧ` with click toggle
- [ ] Update `problem-set-hints/SKILL.md` system prompt: add a paragraph "If the student has marked a sub-part as done, acknowledge it and offer to move to the next one. Do NOT auto-mark sub-parts done yourself."
- [ ] Test: toggle a checkbox → POST fires → session state updated → next chat turn includes the marker in agent's context

**Files to Create/Modify:**
- `backend/adk/callbacks.py` (modify, ~30 LOC — inject progress into agent context)
- `backend/api/sessions/progress.py` (new, ~40 LOC — POST endpoint)
- `backend/fast_api_app.py` (modify, ~2 LOC — mount new router)
- `frontend/src/hooks/useProblemProgress.ts` (new, ~50 LOC)
- `frontend/src/components/workspace/ProgressChecklist.tsx` (new, ~80 LOC)
- `frontend/src/components/workspace/WorkspaceShell.tsx` (modify, ~5 LOC — mount the checklist)
- `backend/skills/templates/problem-set-hints/SKILL.md` (modify, ~10 LOC — progress-awareness rule)
- `backend/tests/unit/test_progress_endpoint.py` (new)
- `frontend/src/components/workspace/__tests__/ProgressChecklist.test.tsx` (new)

**Acceptance Criteria:**
- [ ] LOCAL_MODE: toggle "a" → next agent reply references the progress
- [ ] Reload page → progress preserved (it's in ADK session, not local state)
- [ ] Agent does NOT mark sub-parts done autonomously (verified by inspecting events: only `user` author should produce `progress.*` state-deltas)
- [ ] All four sub-parts render; clicking each fires a separate API call; no race conditions
- [ ] `make test-fast` + `npm run quality:check` pass

**Risks:**
- ADK `state_delta` may not be the right primitive — could need a different lifecycle hook. Mitigation: spike for 15 min before committing to the approach; fallback is a separate Firestore document keyed by session.
- The agent's awareness of progress may distort scaffolding ("you marked b done so I'll skip ahead" when the student actually got it wrong). Mitigation: system-prompt rule explicitly says "the student claims to have finished — verify by asking a check question".

---

## Dependency Graph

```
M1 (A2UI opt-in)  ──┐
                    ├─► (independent, can run first or last)
M2 (workspace surface) ──► M3 (problem card) ──► M5 (checklist, stretch)
                              │
M4 (welcome pinned) ──────────┘ (independent of M2/M3)
```

**Recommended order:** M1 first (cleanup, low-risk, gives confidence) → M2 (the visible shape change) → M3 + M4 in either order → M5 if time permits.

## Day plan — Thu 2026-05-21

| Block | Time | Work |
|---|---|---|
| Morning | 09:00–10:00 | M1 — A2UI opt-in + delete the SKILL.md hack |
| Late morning | 10:00–11:30 | M2 — workspace surface mounted with placeholder |
| Midday | 11:30–12:30 | M3 — ProblemStatementCard |
| (break) | 12:30–13:30 | |
| Early afternoon | 13:30–14:00 | M4 — pinned welcome |
| Mid afternoon | 14:00–16:00 | M5 stretch — progress checklist |
| Late afternoon | 16:00–17:00 | Smoke on dev, fix anything that broke, push |

**Buffer:** 0.5h between M3 and M4 is the natural slack point. If M2 overruns past noon, drop M5; the demo doesn't strictly need it.

## What ships at the end of Thursday

- v0.1 chat *and* a persistent workspace next to it
- Student sees the full problem statement, sub-parts, and (stretch) marks progress as they go
- A2UI hack removed at framework level — `problem-set-hints` is a properly minimalist chat-only skill again
- Welcome panel persists, doesn't vanish
- Same deployed URL, no infra changes, all rolled forward via standard `dev` deploys (one per milestone or batched — likely 4-5 commits + push at EOD)
- Demo is now visibly multi-surface, foreshadowing the v1 pitch without overshooting v0.1 scope

## What lands later in the buffer week

- **Friday 2026-05-22:** Start Boldkast artefact build (sim HTML, Workspace mount, sandbox CSP). Per [boldkast-mcp-app.md](boldkast-mcp-app.md).
- **Monday 2026-05-25:** AR review of Boldkast pedagogical shape; iterate.
- **Tuesday 2026-05-26:** Demo dress rehearsal; smoke + JB walkthrough.
- **Wednesday 2026-05-27:** Jutland demo. JB + AR present.

## Out of scope for this sprint

- Bot-generated artefacts (full ADR-013 review pipeline) — v1 §1.11
- Teacher-facing config/dashboard — v1 §1.7 / §1.8
- `check_subanswer` MCP tool for hiding answers from prompt — v1 `problem-set-helper-config` (SEQUENCE 1.8). The pattern is right but the cost is wrong for v0.1.
- Multi-problem support — v0.1 is one problem (Boldkast)
- Mobile-phone-optimised touch UI — Jutland is laptops + iPad
- DPIA scaffold — v1 §1.13

## Related Documents

- [jutland-demo.md](jutland-demo.md)
- [boldkast-mcp-app.md](boldkast-mcp-app.md)
- [SEQUENCE.md](../SEQUENCE.md)
- [upstream-feedback.md](../../../upstream-feedback.md) — entries #22, #23, #24
- ADRs 001, 013, 015 in `~/Documents/clients/cph-uni/architecture.qmd`
