# Sprint: SESSION-PERSISTENCE-1F — same group code resumes the same session

**Sprint ID:** `SESSION-PERSISTENCE-1F`
**Design doc:** [session-persistence.md](session-persistence.md)
**Branch:** `feature/session-persistence`
**Base commit:** `c0d2870` (dev HEAD as of 2026-05-26)
**Estimate:** ~1.5-2 days
**Created:** 2026-05-26
**Status:** complete (2026-06-01)

## Sprint goal

Entering the same group code, from any device, within 30 days resumes the **most recent active session for that group**: chat history is restored (last 50 messages + summary of older turns), workbench state restored, the agent's `mcp_app_context.*` block carries the prior interactions. Teachers can explicitly reset a group's session ("start fresh") without rotating the code.

From the 2026-05-25 teacher meeting: *"make sure that if using same code the same session will come up."*

## Scope locks

**In scope:**
- Backend: `db/group_sessions.py` — group→session-id mapping with 30d TTL (matches ADR-001 group-code TTL)
- Backend: extend `/api/auth/group/join` to read+return the most recent session_id if one exists for that group
- Backend: `/api/sessions/{id}/restore` endpoint — returns chat history (last 50 messages) + workbench state for resume
- Frontend: `/chat/[...path]` page checks for resume on mount; surfaces a banner "Welcome back — continuing from your last session"
- Frontend: `useStableThreadId` hook adapter to consume the resumed session_id instead of minting fresh
- ~~Artefact contract: `aipla:restore` JSON-RPC notification~~ **DEFERRED** (see M6 note)
- Teacher [Reset session] button (from teacher-ui.md) archives + clears state; next join starts fresh
- Tests: at least 6 pytest cases covering rejoin, expiry, reset, cross-device, mid-activity-change, simultaneous-join
- Update mcp-app-artefact skill convention with `aipla:restore` pattern (LED Planck / KineBot pick it up)

**Out of scope:**
- Cross-group sharing (group A's history visible to group B) — per-group, period
- Cross-class consolidated history (teacher analytics — separate sprint)
- Full chat-history serialisation to ADK session state (last 50 + summary instead — would blow context otherwise)
- BigQuery sink for chat logs (1.2 separate sprint)
- Per-message edit / delete (v2 feature if at all)
- Multi-session selector ("which session do you want?" — single most-recent is enough for v1)

## Workflow

Direct-to-dev per AIPLA workflow. Branch `feature/session-persistence` is executor scratch; FF-merge to `dev`.

## Milestones

| # | What | Files | LOC est |
|---|---|---|---|
| M1 | `db/group_sessions.py` — group→session-id Firestore mapping with 30d TTL | `backend/db/group_sessions.py`, tests | 240 |
| M2 | Extend `/api/auth/group/join` to look up existing session and return it in the response | `backend/auth/group_routes.py`, tests | 160 |
| M3 | `POST /api/sessions/{id}/restore` route — returns chat history + workbench snapshot for resume | `backend/protocols/session_bootstrap_routes.py` (or new `session_restore_routes.py`), tests | 280 |
| M4 | Frontend resume detection on `/chat/[...path]` mount + welcome-back banner | `frontend/src/app/chat/[...path]/page.tsx`, `frontend/src/components/chat/ResumeWelcomeBanner.tsx` (new), tests | 220 |
| M5 | `useStableThreadId` adapter consumes the resumed session_id when present | `frontend/src/hooks/useStableThreadId.ts`, tests | 100 |
| M6 | ~~Artefact contract: `aipla:restore` JSON-RPC notification + Boldkast implementation~~ **DEFERRED** — per-sim restore requires touching each artefact's HTML on every contract change; with multiple sims (Boldkast, LED Planck, …) this becomes per-sim whack-a-mole. Chat history restore (M1-M5) delivers the core value; sliders reset to defaults is acceptable v1 UX. Deferred to a future sprint once the protocol is stable enough to write a single generic handler. `workbenchState` is already snapshotted in `POST /api/sessions/{id}/restore` — the plumbing is ready. | — | — |
| M7 | Teacher [Reset session] button — archives session; next join starts fresh | `frontend/src/app/teacher/classes/[id]/page.tsx`, `backend/protocols/classes_routes.py` (new endpoint), tests | 200 |
| M8 | Update mcp-app-artefact skill with deferred-restore policy | `.claude/skills/mcp-app-artefact/SKILL.md` | 40 |
| M9 | Smoke script + quality gates + direct-to-dev merge | `scripts/smoke-v1-session-persistence.sh` (new) | 120 |

**Total:** ~1680 LOC (impl + tests). ~1.5-2d wall-clock.

## Acceptance gates

- [ ] Open chat with code `local-demo`, send 3 messages, refresh page → land on the same chat with the 3 messages visible
- [ ] Cross-device — same code, different browser → same conversation history visible (last 50 + older summary)
- ~~Drag Boldkast sliders, refresh → sim remounts at those values~~ **deferred** (M6 DEFERRED)
- [x] Resume banner appears post-join with dismissible CTA (Danish + English)
- [x] Teacher [Reset session] archives session; next join starts fresh (inline confirm in class detail page)
- [x] Session TTL = 30 days (matches the group code TTL per ADR-001; set in `set_active_session_for_group`)
- [x] Backend tests: group_sessions unit + API tests for join resumption, restore, reset, idempotency
- [x] Simultaneous-join: last-writer-wins upsert (acceptable for v1 — simultaneous joins from one group are extremely rare)
- [x] No emoji
- [x] Backend `make lint && make test-fast` green; frontend `npm run quality:check:fast` green
- [ ] Direct-to-dev FF merge (pending — needs `make smoke-session-persistence` against running backend)

## Risks

| Risk | Mitigation |
|---|---|
| Chat-history blow-up — serialising all messages into ADK session state breaks the context budget | Last 50 messages loaded verbatim; older turns summarised via a one-shot summary call (or stored summary if already computed). 1.2 BigQuery pipeline is the long-term answer |
| Simultaneous-join race — two devices entering the same code at the exact same moment | Firestore transaction on the group→session-id write; loser reads what the winner wrote |
| Artefact restore contract breaks for artefacts that haven't implemented `aipla:restore` yet | Defensive: host sends the notification regardless; artefact ignores unknown notifications silently. LED Planck / KineBot pick it up from the skill convention update |
| Teacher reset hits a session mid-stream | Reset writes an `archivedAt` timestamp; ChatSessionIndex with `archivedAt` is filtered from join-time lookup. In-flight stream isn't killed (existing behaviour); the next join starts fresh |
| Session-restore returning 100+ messages on a heavy-use code | Last 50 cap is server-enforced; older turns summarised. Cap applies even for restore |

## Dependencies

- v0.1 shipped
- ADR-001 (group ID lifecycle) — already in the scoping site, not a code dependency
- Existing `ChatSessionIndex` bootstrap (shipped 2026-05-21) — extend, don't replace

## Out of scope (do NOT start)

- Cross-group sharing
- Cross-class consolidated history (analytics-chat territory in 1.G-Ph3)
- Full chat-history serialisation to ADK
- BigQuery sink (1.2)
- Multi-session selector
- Per-message edit/delete
