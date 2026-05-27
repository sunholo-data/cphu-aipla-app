# Resizable workspace pane

**Status**: Implemented
**Priority**: P1 (unblocks KineBot 1.D + future ports; LED Planck 1.C also benefits)
**Estimated**: ~1 day (~250 LOC frontend, 0 backend)
**Scope**: Frontend only — `WorkspaceShell` resize handle + snap zones + per-skill sessionStorage persistence
**Dependencies**: `WorkspaceShell` (live since PEDCTX M2); the Button+Workbench+Frame triad (codified in
[`led-planck-integration-followup.md`](led-planck-integration-followup.md))
**Created**: 2026-05-27

## Why

`WorkspaceShell` is fixed at `md:w-1/2` — half the viewport on laptops, ~700px on a typical 1440-wide screen. Three live cases push against that ceiling:

1. **LED Planck 1.C** — the lab bench needs ≥620px just to render the breadboard + 7 instruments; at 700px workspace width the right-tab column gets cramped. Splitting the lesson scaffolding into the React workbench (already shipped today) helps, but the iframe still wants more horizontal room for the equipment placement step.
2. **KineBot 1.D** (next port) — 7 canvas sims + graph plotter. The graph plotter alone wants ≥800px to be readable.
3. **Future jitt.dk artefacts** — 23 candidate apps, each with its own natural aspect ratio. We can't pick a single split that works for all of them.

The opposite case also exists: a student deep in Socratic chat with the tutor wants the **chat** to be wider, the workbench narrower. Currently the only way is to fully collapse the workspace (chevron in the header), which loses the workbench's lesson context entirely.

## Goals

1. Student / teacher can drag a divider to set the chat ↔ workspace ratio anywhere between **30% workspace** and **100% workspace** (chat hidden = "fullscreen workbench").
2. The chosen ratio **persists per-skill** in `sessionStorage` so switching from KineBot back to LED Planck restores each one's preferred width.
3. **Soft snap zones** at 30/70, 50/50, 70/30, and 100% workspace so the common widths are easy to hit without precision dragging.
4. The existing **collapse-to-strip** flow (8px-wide chevron column) continues to work; expanding restores the last drag-set ratio (not the default 50%).
5. **Demo deadline:** ships before the KineBot port lands, so the migration sprint can lean on it for the sim-heavy KineBot panels.

## Non-goals

- **Mobile / portrait resize.** Below `md` the workspace stays stacked (tab pattern unchanged). The demo runs on laptops + iPads-landscape only.
- **SkillConfig schema field** for default ratios. Per-skill defaults are hardcoded TSX (a small map in `WorkspaceShell`) for v0.1. SkillConfig schema migration is v1.1 territory — captured in [Open questions](#open-questions) for later.
- **Touch / Apple Pencil resize.** PointerEvent covers mouse + finger + pen uniformly; we don't need a separate touch path. (Tested on a non-iPad target it's already adequate.)
- **A2UI agent-driven resize.** The agent doesn't decide how wide the workspace is — that's a student / teacher control. No protocol surface here.
- **Lab-iframe fullscreen modal.** Different problem (lab pops out OVER the chat); deferred to a possible 1.E follow-up. The "100% workspace" snap point covers most of what fullscreen would buy.

## Design

### Layout model

Replace `md:w-1/2` (fixed half) on the workspace aside with a flex-basis driven from React state. The chat column gets `flex-1` and shrinks; the workspace gets `style={{ flexBasis: width }}`. The divider is a 4px-wide bar between them, hit-tested via a 12px hover/active overlay for usability.

```
┌────────────── chat panel (flex-1, min-w 320px) ──────────────┬───┬─── workspace (flex-basis: ratio*viewport) ───┐
│                                                              │║│ │                                              │
│                                                              │║│ │                                              │
└──────────────────────────────────────────────────────────────┴───┴──────────────────────────────────────────────┘
                                                              divider — cursor: col-resize, drag to resize
```

Ratio is stored as a **fraction** (0.30 → 1.00) of the viewport's chat-row width. Storing a fraction (not pixels) keeps the layout sane across window resizes.

### Snap zones

Drag is freeform within `[0.30, 1.00]`. While dragging, if the cursor passes within **±2.5%** of a snap point, the divider snaps to that value with a brief visual cue (one-frame brighter divider colour).

Snap points:
- `0.30` — wide chat (Socratic Q&A focus)
- `0.50` — default split (current behaviour)
- `0.70` — wide workbench (sim-heavy work)
- `1.00` — fullscreen workbench (chat hidden behind the divider; click the divider to bring chat back)

The 100% snap is special: when ratio = 1.0, the chat column gets `display: none` (not just `flex-basis: 0`) so it doesn't take any space. The collapse-to-strip chevron is replaced by a "show chat" tab on the left edge of the workspace.

### Persistence

Per-skill sessionStorage key:

```
aipla.workspaceRatio:<skillId>
```

On `WorkspaceShell` mount, read the key. If present, use the stored ratio. If absent, fall back to the **per-skill default** (hardcoded map):

```ts
const DEFAULT_RATIOS: Record<string, number> = {
  "problem-set-hints": 0.50,  // Boldkast: single canvas, fits comfortably
  "led-planck-tutor":  0.55,  // bench wants a touch more room
  "kinebot":           0.65,  // 7 canvas sims + graph plotter
};
const DEFAULT_RATIO = 0.50;   // used when skillId not in the map
```

This map lives next to `WorkspaceShell` (not in skill metadata) — for v0.1 it's a frontend constant. Lifting it into SkillConfig is a separate item.

Writes happen on `pointerup` (one write per drag-end, not per drag-move) to keep storage churn low.

### Component shape

`WorkspaceShell` gains:
- `skillId` prop (string) — used to scope the sessionStorage key + look up the default ratio.
- Internal `ratio` state, initialized via a `useState(() => readRatio(skillId))` initializer.
- `<WorkspaceDivider>` — new sibling component rendered between the chat column and the workspace. Owns the drag state; calls `onRatioChange(next)` on commit.
- `<ChatRevealTab>` — small left-edge tab visible only when `ratio === 1.0`. Clicking sets ratio back to `0.50`.

The collapsed-strip behaviour (existing chevron flow) stays as-is; it represents a discrete "I want chat to take the whole row" state. Drag-to-resize and collapse are two separate states; the user picks one or the other:
- **Collapsed:** workspace is an 8px strip with a chevron. Chat takes the whole row.
- **Expanded:** workspace has a real width determined by `ratio`; divider is draggable.
- The collapse toggle resets to the stored `ratio` on re-expand (not the default).

### Chat page wiring

The chat page passes `skillId` into `<WorkspaceShell>`:

```tsx
<WorkspaceShell
  skillId={skillId}
  hideOnMobile={mobileTab !== "workspace"}
>
  …
</WorkspaceShell>
```

No other changes. The triad (Button + Workbench + Frame) inside is unaffected.

### Edge cases

- **Window resize:** `ratio` is a fraction, not pixels — flexbox handles the recompute naturally.
- **Below md breakpoint:** workspace stacks below chat; divider is hidden (`hidden md:flex`). Stored ratio is preserved for when the viewport widens again.
- **Very narrow viewports between md and a hard floor:** clamp `flexBasis` so the chat column never drops below `min-w-[320px]`. If the ratio would force chat below 320px, the divider stops at the clamp (visual "hard stop" behaviour).
- **`prefers-reduced-motion`:** suppress the snap-flash animation; keep snap behaviour itself (it's not motion, it's discrete state).

### Accessibility

- Divider has `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow={ratio}`, `aria-valuemin={0.30}`, `aria-valuemax={1.00}`.
- Keyboard: divider is `tabIndex={0}`; `ArrowLeft` / `ArrowRight` adjust by 5% per press, `Home` / `End` jump to min/max, `Enter` toggles between current value and 0.50.
- Cursor: `cursor: col-resize` on the divider, `cursor: ew-resize` on the body during drag.

## Acceptance gates

1. **Drag works.** On a md+ viewport, dragging the divider between the chat and workspace columns updates the split smoothly (60fps). Releasing commits the new ratio.
2. **Snaps work.** Dragging within ±2.5% of 0.30 / 0.50 / 0.70 / 1.00 snaps to that value with a one-frame visual cue.
3. **Fullscreen works.** Dragging or snapping to 1.00 hides the chat panel; a left-edge tab brings it back at 0.50.
4. **Persistence works.** Set workspace to 0.65 on `/chat/...led-planck-tutor`; switch to `/chat/...problem-set-hints` (loads at 0.50, its default); switch back to LED Planck (loads at the stored 0.65, not the default 0.55).
5. **Defaults work.** First visit to KineBot (no stored value) opens at 0.65; first visit to Boldkast (no stored value) opens at 0.50.
6. **Collapse still works.** The chevron collapses to the 8px strip; expanding returns to the last stored ratio (not always 0.50).
7. **Keyboard works.** Tab to divider, ArrowRight 4× moves +20%.
8. **No mobile regression.** Below md the workspace stacks; divider is not visible; ratio is not consulted.
9. **Boldkast / LED Planck unaffected at their defaults.** The current 50/50 demo continues to look identical to today for users who never drag.

## Risk and rollback

Single PR, single feature branch. `WorkspaceShell` is the only surface that changes — the chat page passes one new `skillId` prop. Rollback is a revert.

The only behaviour change for a user who never drags is that the workspace **opens at the per-skill default** (0.50 for Boldkast, 0.55 for LED Planck, 0.65 for KineBot once that lands). If the slight LED Planck default-shift is unwelcome, drop the map entry and it goes back to 0.50.

## Open questions

1. **Per-skill default in SkillConfig?** The hardcoded `DEFAULT_RATIOS` map works for v0.1 (we know all three skills). When the marketplace grows or teachers fork skills, the per-skill default should travel with the skill, not the frontend. Captured as a v1.1 schema-extension item: `SkillConfig.uiHints.defaultWorkspaceRatio`. Out of scope here.
2. **Teacher override per class?** A teacher could want "for this class, default KineBot to 0.50 so the chat is more visible." Possible Class-entity field later. Not for the demo.
3. **Sim-driven default?** Should the artefact itself request a width on `ui/initialize`? Tempting, but it conflates the artefact's preference with the user's choice. Defer until we have data — for now the hardcoded map is the right level of indirection.
4. **Telemetry on drag events?** "Student widened workspace to 0.85" is mildly interesting research signal. Not for v0.1; could add an `aipla.workspace.ratio-change` OTel span later.

## Sprint outline

If approved, the sprint is small enough to be one-shot:

- **M1** — `WorkspaceShell` accepts `skillId` + per-skill default lookup. (~30 LOC)
- **M2** — `<WorkspaceDivider>` component: pointer drag, ratio state, snap zones. (~120 LOC + tests)
- **M3** — `<ChatRevealTab>` for the fullscreen state. (~30 LOC)
- **M4** — sessionStorage read/write per skill. (~20 LOC)
- **M5** — keyboard a11y + ARIA. (~20 LOC)
- **M6** — vitest for `WorkspaceDivider` (drag math, snap zones, keyboard) + `WorkspaceShell` integration test. (~150 LOC)
- **M7** — Quality gates + commit to dev (no PR per AIPLA workflow). No reseed needed (frontend-only).

Total: ~370 LOC + tests, single sprint commit, deploy lands within the existing `aipla-dev-deploy` Cloud Build.

---

## Implementation Report

**Completed**: 2026-05-27
**Actual Effort**: [e.g., 5 days vs 3 estimated]
**Branch/PR**: [link or commit range]

### What Was Built
- [Summary of actual implementation]
- [Any deviations from plan]

### Files Changed
- [New files created]
- [Modified files]

### Lessons Learned
- [What went well]
- [What could be improved]
