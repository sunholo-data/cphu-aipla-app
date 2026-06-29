# Per-group live drill-down + live/report convergence (1.1.31 M2)

**Status:** In progress (started 2026-06-29)
**Builds on:** [teacher-analytics-framework.md](teacher-analytics-framework.md) (the live class view) · [live-teacher-dashboard-sprint.md](live-teacher-dashboard-sprint.md) (M0/M1 shipped) · [session-report-summary-primary.md](session-report-summary-primary.md) (the per-group report this converges with)
**Decision:** collapse the live-vs-post-hoc split at the **group** level into **one place** — the per-group report — which is *live while the group is active* and *frozen after*. The live class view drills into it. No duplicate "live transcript" surface.

## The problem this fixes

We had two per-group truths drifting apart: a **live** class view (aggregate signals only — counts, active/idle, stuck) and a **post-hoc** session report (the rich content — chat transcript, audio transcript, workbench interactions, AI narrative). A teacher mid-lesson could see *that* a group was stuck but not *what* they were stuck on without leaving the live view, and "live" vs "report" were two different mental models of the same group.

## The model — one view, two data cadences

There is **one per-group view** (`teacher/reports/groups/[groupId]`). It is the same surface during and after the lesson; the only difference is whether its data is still moving.

| Layer | Cadence | Source | Cost |
|---|---|---|---|
| **Raw data — streamed** (chat transcript, audio transcript, workbench interactions, deterministic signals) | **Polled ~10–15s while the group is active**; static once archived | existing report payload (`GET /api/reports/groups/{code}`) + the live signals (`/live`) | zero LLM |
| **AI summary — batched / on-demand** (the per-group narrative) | **On first visit**, then regenerated only when turns grow **past a ~5-min debounce**, or **forced** by a manual *Refresh summary* | `resolve_narrative` (already cached on the session index) | one Flash call per regeneration |

This is exactly the cadence the platform already implements for the report narrative ([narrative.py](../../../../backend/reports/narrative.py): "*generated on-demand … regenerated only when the live message count exceeds the count the cached summary was built from*"). This doc makes the **raw layer live** (poll while active) and adds a **manual refresh** for the AI layer — it does not invent a new pipeline.

## UI

### Class level — the live overview (existing, 1.1.31 M0)

`teacher/classes/[id]` Live view: Calls strip + per-group rows (active/idle · turns · stuck) + the rolling class summary. **Each group row becomes a link** into that group's view.

### Group level — the drill-down (this doc)

```
┌─ Group 7B-rød · Energibevarelse ───────────── ● live ─┐
│  AI summary            updated 3 min ago  [Refresh]   │   ← batched / on-demand
│   The group set v0 to 17.5 m/s and is testing whether │
│   horizontal and vertical motion are independent…     │
│                                                        │
│  Workbench interactions          12 interactions      │   ← streamed (zero LLM)
│   v0: 12 → 17.5 m/s · angle: 30° → 45° · Play ×4       │
│                                                        │
│  Transcript                              [collapsed]   │   ← streamed
│   chat + spoken discussion, summary-first              │
└────────────────────────────────────────────────────────┘
```

- **● live** badge while the group's session is active (recent activity); drops to a static "last active …" when idle/archived. Polling stops when not live.
- **AI summary** block: the narrative, marked AI-generated, with *updated N min ago* and a **Refresh** button (`?refresh=1` → force regenerate). Between refreshes it auto-updates on the ~5-min debounce as turns grow.
- **Workbench interactions** + **Transcript**: the existing report sections, now refreshed by the live poll so they grow during the lesson. Transcript stays collapsed-by-default (summary-first, the privacy-forward shape).
- Empty/loading/error states reuse the report page's existing handling.

### Navigation

Live class view (overview) → click a group → the group view (live detail). One back-step. The group view is reachable the same way after the lesson (from the reports list) — same URL, same component, just no longer polling.

## Build

| MS | Deliverable | Status |
|---|---|---|
| **B0** | Backend: `?refresh=1` on `GET /api/reports/groups/{code}` → `resolve_narrative(force=True)` (bypass cache/debounce, still cache the result) | done |
| **B1** | FE: live class-view group rows link to `/teacher/reports/groups/{groupId}` | this sprint |
| **B2** | FE: the group report goes **live-aware** — poll the report payload while the session is active; a **● live** / *last active* indicator | this sprint |
| **B3** | FE: **Refresh summary** button (`fetchGroupLatestReport(code, sessionId, {refresh:true})`) + *updated N min ago* on the AI summary | this sprint |

## Privacy / scope (ADR-001)

- Everything stays **group-level** — the transcript/workbench/narrative are a group's own session, never per-student. Teacher reads are owner/researcher-gated (`assert_can_read_class` lineage, same as the report endpoint today).
- The per-group narrative is the **existing** report summary (already shipped, grounded, cached) — it is *not* the R1-gated content-aware **class** summary. R1 still only gates the live *class-level* rubric summary (1.1.31 M1); this drill-down reuses the per-group narrative that already ships.

## Acceptance

- [ ] A teacher on the live class view clicks a group and lands on that group's view with its live transcript + workbench interactions + AI summary.
- [ ] While the group is active the raw layer updates without a manual reload; a **● live** indicator shows it's polling; polling stops when idle/archived.
- [ ] **Refresh summary** regenerates the AI narrative immediately (`?refresh=1`); *updated N min ago* reflects it. Between refreshes the summary still auto-updates on the ~5-min debounce.
- [ ] No per-student data anywhere; reads owner/researcher-gated.
- [ ] `make lint` + `make test-fast` (backend) and `npm run quality:check` (frontend) green.
