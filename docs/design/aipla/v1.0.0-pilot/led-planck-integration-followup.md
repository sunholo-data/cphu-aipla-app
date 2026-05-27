# 1.C follow-up — LED Planck workspace integration

**Status**: Planned
**Owner**: AIPLA (M)
**Pairs with**: [led-planck-skill.md](implemented/led-planck-skill.md)
(implemented), [`.claude/skills/mcp-app-artefact/SKILL.md`](../../../../.claude/skills/mcp-app-artefact/SKILL.md)
(updated guardrails)
**Created**: 2026-05-27

## Why

Sprint 1.C shipped the LED Planck virtual lab end-to-end (skill template,
artefact, host wrapper, observability) but the **workspace integration
quality was rated 5/10** in same-day demo feedback. The lab:

1. Auto-mounted into the workspace pane with no launcher button or
   workbench context, skipping the Button + Workbench + Frame triad
   that Boldkast established.
2. Used a 1430px-wide grid layout (`grid-template-columns: 300px
   minmax(720px,1fr) 410px`) inside a 700px `md:w-1/2` workspace pane
   — horizontal overflow, content clipped off the right edge.
3. Wrapped lesson scaffolding (procedure list, interactive checklist)
   INSIDE the iframe, where the React host can't lay it out at
   app-width or reorder it for narrower viewports.

The root cause is a skill gap: the `mcp-app-artefact` skill described
the Frame-and-events plumbing in detail but had no opinion on **where
non-interactive lesson content belongs** or **how the workspace pane
mounts the artefact**. M8 of 1.C copied the Frame shape and skipped
the rest — and the skill didn't catch it.

## Goals

1. Make LED Planck usable in the demo this week — fit the workspace pane,
   show lesson context alongside the lab.
2. Codify the integration pattern in the `mcp-app-artefact` skill so
   future ports (KineBot in 1.D, future physics labs) ship the right
   shape on day one.
3. Preserve all existing telemetry (step-change, measurement,
   component-placed, led-polarity-error, state-change). The agent must
   still see what the student is doing.

## Non-goals

- Restructuring the lab HTML beyond removing the redundant left panel
  (procedure + checklist). The bench, the data tabs, the JSON-RPC
  plumbing all stay.
- Per-skill lesson-card schema in `SkillConfig` (1.B-Ph2 territory —
  for v0.1 the workbench is hardcoded TSX per skill).
- Mobile / portrait layout. Demo runs on laptops + iPads-landscape.
- Translating the Danish prompt or skill body — already correct.

## Design

### Triad mount in chat page

Replace the auto-mount with the Boldkast-shaped branch:

```tsx
{showAiplaWorkspace && skillSlug === "led-planck-tutor" && (
  <WorkspaceShell hideOnMobile={mobileTab !== "workspace"}>
    {showLedPlanckLab && BOLDKAST_SANDBOX_ORIGIN ? (
      <LedPlanckLabFrame
        ref={ledPlanckFrameRef}
        sandboxOrigin={BOLDKAST_SANDBOX_ORIGIN}
        sessionId={sessionId ?? agentSessionId}
        onClose={() => setShowLedPlanckLab(false)}
        onSnapshotChange={setLedPlanckSnapshot}
      />
    ) : (
      <div className="space-y-4">
        <LedPlanckLabButton onOpen={() => setShowLedPlanckLab(true)} />
        <LedPlanckWorkbench
          snapshot={ledPlanckSnapshot}
          sessionId={sessionId ?? agentSessionId}
        />
      </div>
    )}
  </WorkspaceShell>
)}
```

### Components

**`LedPlanckLabButton.tsx`** — mirrors `BoldkastSimButton.tsx`. Single
button, Danish label ("Åbn LED-laboratorium"), brief subtitle. ~30 LOC.

**`LedPlanckWorkbench.tsx`** — new React surface. Shows:

- **Lesson framing card** — short Danish description of the activity
  (what Planck's constant is, what we're measuring, what the relation
  `h = U₀ · e · λ / c` means). 1 paragraph + the formula.
- **Step progress card** — 4 steps (Kredsløb / I-U-måling / Spektroskopi
  / Rapport), driven by `snapshot.currentStep`. Each step shows its
  Danish label + a checkmark when reached. No interactive state — pure
  derived from the snapshot.
- **Measurements summary card** — table of `snapshot.measurements`,
  empty-state when none yet. Each row: LED color (Danish), U₀, λ, h.
- **Component placement progress** — small line summary
  ("Placerede: LED, voltmeter, modstand"). Derived from
  `snapshot.componentsPlaced`.

~150 LOC. No new endpoints — reads only from the prop.

**`LedPlanckLabFrame.tsx`** — add an `onSnapshotChange?: (snapshot:
LedPlanckSnapshot) => void` prop. Invoke it from inside
`handleStructuredContent` after each mutation so the parent's snapshot
stays in sync. Keep the internal `snapshotRef` (the iframe-context POST
still reads from it).

### Lab HTML changes

Remove the **left panel** entirely from the lab's `<main>`:

```diff
-  <section class="panel">
-    <h2>Experiment procedure</h2>
-    <div class="content">
-      <p class="small">Goal: investigate the I-U characteristic...</p>
-      <ol>...8-step procedure...</ol>
-      <h3>Interactive checklist</h3>
-      <p class="small">The checklist updates automatically...</p>
-      <div id="checkProgress" class="progressbar"><div></div></div>
-      <div id="checks"></div>
-    </div>
-  </section>
```

Drop the `checkProgress` + `checks` rendering hooks from the JS
(`updateChecks` becomes a no-op or is deleted). Grid becomes
`grid-template-columns: minmax(720px,1fr) 410px` — main bench + right
tabs. Effective minimum width drops from ~1430 → ~1130 px. Combined
with the existing `@media(max-width:1280px)` stacking rule, the lab
collapses cleanly into a single column on narrow viewports.

The bench itself still has `#bench { min-height:690px; min-width:720px }`
internally — needs a media query relaxation for narrow workspaces:

```css
@media (max-width: 1100px) {
  #bench { min-width: 600px; min-height: 580px; }
}
```

Equipment positions inside the bench are absolute-positioned and will
need to overlap slightly — acceptable for the workspace mount; users
who want room can press the "Open in larger view" button (1.E follow-up
— not in this scope).

### Snapshot ownership

Snapshot lives at the chat-page level (`useState<LedPlanckSnapshot |
null>(null)`). Initial state is `null` until the lab is mounted at
least once. The Workbench renders sensible empty states for `null`
(step 1 "Kredsløb" highlighted, no measurements yet).

When the user closes the lab (X button), snapshot is preserved (it's
React state, not ref). Reopening the lab boots a fresh iframe but the
React workbench shows last-known state.

### Telemetry preserved

All five event kinds keep flowing on the same JSON-RPC wire (`ui/update-
model-context`, kind `led-planck.<event>`):
- `led-planck.step-change` → updates `snapshot.currentStep/Name`
- `led-planck.measurement` → appends to `snapshot.measurements`
- `led-planck.component-placed` → updates `snapshot.componentsPlaced`
- `led-planck.led-polarity-error` → updates `snapshot.lastPolarityError`
- `led-planck.state-change` (Phase 2 voltage commit) → updates
  `snapshot.voltage`

iframe-context POSTs to `/api/sessions/{id}/iframe-context` keep firing
with `serverId: "led-planck"` — agent visibility unchanged.

## Acceptance gates

1. Visit `/chat/@aipla-platform/led-planck-tutor` in a 1024×768 viewport
   (laptop default): workspace pane shows the **launcher button + lesson
   framing + step progress + measurements summary**. NO horizontal
   scrollbar. NO clipped content.
2. Click **"Åbn LED-laboratorium"**: workspace switches to the lab.
   Lab content fits the pane (~700px wide) without horizontal scroll.
3. Inside the lab, install a red LED + wire the circuit + take a
   reading: step-change events fire, the **React workbench's step
   indicator advances** when the lab is closed/reopened (snapshot
   preserved).
4. Save a result: `measurement` event fires, the workbench's measurements
   table shows the new row when the lab is closed/reopened.
5. The agent still sees all events via iframe-context (verified via
   existing `test_workspace_observability.py` LED Planck case).
6. Boldkast chat path completely unaffected (regression check).
7. `mcp-app-artefact` skill includes the Workspace Integration section
   with the Button+Workbench+Frame triad and the 700px viewport gate.

## Out of scope

- Lab "Open in larger view" / fullscreen toggle (1.E follow-up).
- Per-skill `lessonContext` / `progressSteps` schema in `SkillConfig`
  — for v0.1 the workbench is hardcoded per skill.
- A2UI agent-driven lesson scaffolding — `toolConfigs.a2ui.enabled:
  false` stays.

## Risk and rollback

Single commit, single feature branch (`fix/led-planck-integration`).
If the integration breaks for any reason during demo, the rollback is
revert + redeploy — Boldkast path is independent and untouched.
