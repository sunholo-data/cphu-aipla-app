# Teacher co-working co-pilot — one shared AI partner across every teacher surface

**Status:** DESIGN (2026-06-27). The pattern already exists and ships for activity authoring (`_AuthoringCopilot` — floating panel + propose/Apply cards). This doc generalises it into a **shared** mechanism and brings it to **class management** and **analytics**. No refactor code yet.
**Last Updated:** 2026-06-27 (M, after first hands-on with the deployed manage-class assistant): *"we want the co-pilots and AI chat helpers to be on the same page the human uses, and see the changes the AI makes alongside those they edit themselves — so it's a co-working partnership."* + *"apply [the activity co-pilot approach] to ours in a centralised, refactored way."*
**Priority:** **P1** — the teacher AI helpers (manage-class, analytics-chat, activity-authoring) are diverging: the authoring co-pilot is a floating, propose/Apply **co-working partner**; manage-class is a standalone full-page chat that mutates state invisibly (no trust). Unify them onto one shared co-pilot so every surface gets the same trustworthy experience and the *next* helper is a thin config, not a rebuild.
**Estimated:** ~2d Part 1 (extract shared co-pilot shell) · ~2–2.5d Part 2 (class-management co-pilot, propose-only writes) · ~0.5–1d Part 3 (analytics panel) · ~1d Part 4a (resume) · ~2–3d Part 4b (history tier)
**Scope:** Fullstack — extract `frontend/src/components/teacher/copilot/` (shared shell from `_AuthoringCopilot`), rewire the 3 surfaces, convert manage-class write tools to propose-only (`backend/tools/class_management.py`), add per-surface Apply routers, plus the continuity layer (`AGUIProvider` resume + `chat_sessions` scope tag + history UI).
**Dependencies:** the activity co-pilot (`_AuthoringCopilot.tsx`, `applyCopilotProposal.ts`, `authoring_tools.py`) — the reference implementation; `useSkillSlugResolver` (shared, done); the manage-class hub + `agent_tools` (done); `feedback_trust_card_with_tutor_push` (the student-side cousin of "see the AI's change").
**Source:** 2026-06-27 hands-on (M). Supersedes the narrower "embed-for-trust" framing.

> **⚠ Coordinate before building.** The activity co-pilot is under **active parallel development** by another agent in this same checkout (recent commits float the panel, mount it on `/new`; there is uncommitted `proactiveGreet` work in the tree). Part 1 *extracts shared code out of `_AuthoringCopilot.tsx`* — a file they're editing. Sequence this with them (or have them own the extraction) to avoid collision.

## The vision: a co-working partner, not a separate tool

Every teacher AI helper should be a **floating co-pilot on the page the human is already working on**, where the human watches the AI's changes land *next to the edits they make themselves*, and **nothing the AI does takes effect until the human Applies it** (earned trust). The activity-authoring co-pilot already is this. manage-class is not — it's a standalone page that silently mutates class state. This doc makes them all the former.

This is the teacher-side expression of the same principle as the student "shared with the AI" trust card: an AI action is only trustworthy if its effect is *visible* on the surface the human owns.

## What already exists (the reference: activity co-pilot)

- **`FloatingCopilot`** — fixed bottom-right panel, minimizes to a pill, **stays mounted while minimized** (conversation never lost on collapse). Co-located with the builder so proposals land in the form behind it.
- **Propose-only tools** — `authoring_tools.py` returns `{ok, proposal: {kind, …}}`; it NEVER persists. The write rides the teacher's Apply.
- **`parseProposal`** (tool result → typed `Proposal`) → **`ProposalCard`** (Apply / Edit / Dismiss; free-text kinds get inline Edit) → **`applyCopilotProposal(p, builder)`** — the surface's router that maps each proposal kind to a mutation on the human's working state.
- Already uses the shared `useSkillSlugResolver`.

## Part 1 — Extract the shared co-pilot shell

Move the host-agnostic pieces into `frontend/src/components/teacher/copilot/`:
- `FloatingCopilot` (panel chrome + minimize/FAB + stays-mounted) — generic.
- The resolver + `AGUIProvider` + chat loop (messages, tool-call pills, input) — generic.
- `ProposalCard` (Apply/Edit/Dismiss) — generic over a `Proposal` base.
- A `<TeacherCopilot>` that takes per-surface **config**:
  ```
  <TeacherCopilot
    skillName="manage-class"
    scopePrefix={classId ? `[class_id=${classId}]` : ""}
    parseProposal={parseClassProposal}     // surface's kinds
    onApplyProposal={(p) => applyClassProposal(p, deps)}   // surface's router
    suggestions={[...]} />
  ```
Each surface keeps ONLY: its skill slug, scope prefix, proposal kinds + parser, and apply router. The panel, chat, resolver, cards, minimize, persistence = shared. (This is the "extract the shared shell once the activity branch lands" item from `reference_teacher_chat_skill_pattern` — it has landed.)

**Acceptance:** the activity co-pilot is re-expressed on `<TeacherCopilot>` with no behaviour change; its tests still pass.

## Part 2 — Class-management co-pilot (the big one)

Bring the co-pilot to `/teacher/classes` so a teacher creates classes and mints codes *by talking, alongside the New-class button*, and watches them appear in the list.

- **Convert manage-class WRITE tools to propose-only.** `create_class` and `mint_group_codes` stop persisting; they return `{ok, proposal:{kind:"create_class", name, …}}` / `{kind:"mint_codes", classId, count}`. (Same earned-trust contract as authoring.)
- **Apply router** (`applyClassProposal`) calls the existing REST endpoints the dashboard already uses (`POST /api/classes`, `POST /api/classes/{id}/groups`) → then **refetches the class list** so the new class / codes appear next to manually-created ones.
- **READ tools stay direct** — `list_my_classes`, `class_spend`, `class_kpis`, `class_trend`, and the `analytics_chat` delegation answer in chat (no card; nothing to Apply).
- Mount `<TeacherCopilot skillName="manage-class">` as the floating panel on `/teacher/classes` (keep `/teacher/classes/assistant` as a deep link).

**Decision needed:** propose-only writes (recommended — matches the co-working/earned-trust model) vs keep direct-execute + show a "done" card. Recommend propose-only.

**Acceptance:** "create Fysik 9A and mint 5 codes" → two Apply cards → Apply → the class + codes appear in the list the teacher is looking at, indistinguishable from ones they made by hand.

## Part 3 — Analytics panel

Mount `<TeacherCopilot skillName="analytics-chat">` as the floating panel on `/teacher/insights` (and/or `/teacher/classes`), read-only (no proposals). Lowest effort — it's the shell with no apply router. Keep the dedicated `/teacher/analytics` page for the scoped data view.

## Part 4 — Continuity (resume + history)

The floating panel already preserves a conversation *within* a session (stays mounted when minimized). Two gaps remain:
- **4a — Resume across visits.** `AGUIProvider` already accepts a `sessionId` to resume by threadId. Persist the threadId per `(teacher, skill, scope)` (localStorage first), restore on mount, plus a "New chat" reset. ~1d.
- **4b — Scoped history tier.** Tag `ChatSessionIndex` with `classId` + `kind ∈ {manage,analytics,authoring}` (`activityId` already exists); add `GET /api/teacher/chats?classId=&kind=` over `list_sessions_for_skill`-style queries; a teacher history view grouped by class (manage + that class's analytics + its activities' authoring chats), each thread reopenable (reuses 4a). ~2–3d.

## Phasing, decisions, open questions

- **Order:** Part 1 (shared shell) → Part 2 (class co-pilot — the headline value) → Part 3 (analytics, cheap) → Part 4a (resume) → Part 4b (history). 1–3 deliver the co-working partnership; 4 adds memory.
- **Coordinate Part 1 with the parallel co-pilot work** (see warning above) — likely the highest-risk integration point.
- **Decision — propose-only manage-class writes** (recommended) vs direct-execute-with-receipt.
- **Open — resume pointer durability** (localStorage vs backend) and the manage-hub's scope key (`"global"` vs class-scoped once a class is open).
- **Open — history retention/privacy** — confirm against the privacy model before 4b ships a browsable long-lived history.
- **Non-goal:** student-facing co-pilot/history. Teacher surfaces only.
