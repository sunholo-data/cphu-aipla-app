# Sprint plan — Resizable workspace (RESIZE-WORKSPACE)

**Sprint ID**: RESIZE-WORKSPACE
**Design doc**: [`resizable-workspace.md`](resizable-workspace.md)
**Status**: Approved (2026-05-27) — execution ready
**Duration**: 1 day
**Estimated LOC**: ~460 (incl. tests)
**Branch**: `feature/resize-workspace` (off `dev`)
**Merge target**: `dev` (no PR per AIPLA workflow; FF-merge at M6)

## Goal

Ship a draggable chat ↔ workspace divider with soft snap zones (30/50/70/100%), per-skill `sessionStorage` persistence, and per-skill default ratios. Demo unblocked for KineBot 1.D port and any future sim that needs wider space than `md:w-1/2`.

## Milestones

| ID | Description | Scope | Est. LOC | Deps |
|---|---|---|---:|---|
| M1 | `useResizableWorkspaceRatio` hook + `DEFAULT_RATIOS` constant + sessionStorage I/O helpers | frontend | 60 | — |
| M2 | `WorkspaceDivider` component (pointer drag, ratio math, snap zones, keyboard a11y, ARIA) | frontend | 150 | M1 |
| M3 | `WorkspaceShell` accepts `ratio` + `onRatioChange` props; renders divider inside aside; renders `ChatRevealTab` when ratio=1.0 | frontend | 70 | M2 |
| M4 | Chat page wires `useResizableWorkspaceRatio(skillId)`; conditionally hides chat panel at ratio=1.0; passes `skillId` to `WorkspaceShell` | frontend | 30 | M3 |
| M5 | Vitest: `useResizableWorkspaceRatio` (default lookup, sessionStorage round-trip), `WorkspaceDivider` (drag math, snap zones, keyboard), `WorkspaceShell` integration | frontend | 150 | M4 |
| M6 | Quality gates (`npm run quality:check`), commit on branch, rebase + FF-merge to `dev`, push origin/dev | infra | 0 | M5 |

## Acceptance gates (from design doc)

1. **Drag works** — md+ viewport: dragging divider updates split smoothly. Release commits ratio.
2. **Snaps work** — within ±2.5% of 0.30 / 0.50 / 0.70 / 1.00 snaps with one-frame visual cue.
3. **Fullscreen works** — ratio=1.0 hides chat; ChatRevealTab restores at 0.50.
4. **Persistence works** — set LED Planck to 0.65; switch to Boldkast (loads 0.50); back to LED Planck (loads 0.65, not 0.55).
5. **Defaults work** — first visit to KineBot opens at 0.65; first visit to Boldkast opens at 0.50.
6. **Collapse still works** — chevron collapses; expanding returns to last drag-set ratio.
7. **Keyboard works** — Tab to divider, ArrowRight 4× = +20%.
8. **No mobile regression** — below md, workspace stacks; divider hidden; ratio not consulted.
9. **Boldkast / LED Planck unaffected at defaults** — users who never drag see no change.

## Non-goals (out of scope this sprint)

- `SkillConfig.uiHints.defaultWorkspaceRatio` schema migration (v1.1).
- Per-class teacher override.
- Sim-driven default via `ui/initialize` capability.
- OTel span on drag events (research telemetry).
- Mobile / portrait resize.

## Quality commands

```bash
# Frontend (all this sprint touches)
cd frontend
npm run quality:check:fast   # lint + typecheck + auth-fetch check
npm run test:run             # vitest
npm run quality:check        # full: lint + typecheck + tests + build
```

## Velocity reference

Per `analyze_velocity.sh` recent runs: ~1000+ LOC/day on focused frontend sprints (LED Planck 1.C shipped ~1000 LOC of new code in one session; the integration follow-up another ~680 LOC). 460 LOC across 6 milestones is comfortably within one day.

## Risk / rollback

Single feature branch, single FF-merge to dev. Surface of change: `WorkspaceShell` + chat page layout. If the resize breaks, revert. No backend, no Firestore, no seed.

## Notes for the executor

- `WorkspaceShell` currently has a `collapsed` state (sessionStorage-persisted) — preserve that flow entirely; collapse is orthogonal to resize. Expanding from collapse restores the drag-set ratio (not always 50%).
- `chat page` layout container is a flex row on md+; chat panel has `flex-1 min-w-0`, workspace was `md:w-1/2`. Replace with flex-basis driven from React state.
- Hardcoded `DEFAULT_RATIOS = { 'problem-set-hints': 0.50, 'led-planck-tutor': 0.55, 'kinebot': 0.65 }`. Fallback default: 0.50. Lives in the hook (or the WorkspaceShell file) — not in skill metadata.
- Snap zones: ±2.5% of each snap point. When dragging passes through the zone, snap. Releasing inside a zone stays snapped.
- `prefers-reduced-motion` suppresses the snap-flash animation but keeps the snap behaviour itself.
