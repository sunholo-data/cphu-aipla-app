---
name: mcp-app-artefact
description: >
  Add a new MCP App artefact (hand-curated HTML/JS rendered as a
  sandboxed iframe in the chat workspace) to the AIPLA fork. Covers the
  static-artefact path (one shared mcp-sandbox Cloud Run service, files
  under infrastructure/mcp-sandbox/artefacts/<name>/v<version>/),
  the decision tree for "static vs. dynamic MCP server", the
  ADR-013 security gates (CSP, sandbox flags, 200 KB size limit,
  library-bypass review), and the frontend wiring (NEXT_PUBLIC_MCP_SANDBOX_URL,
  MCPAppToolCallRouter, workspace surface mount). Use when the user
  says "add a new MCP app", "new artefact", "build a sim", "deploy
  a sandbox iframe", "embed an interactive visualization", or
  references Boldkast / mcp-sandbox / mcp-ext-apps-map. Do NOT use
  for the agent-skills authoring workflow (that's the inherited
  template's skill creator) or for dynamic-MCP-server scaffolding
  (a separate v1 skill).
license: Apache-2.0
metadata:
  author: AIPLA fork
  version: "0.1.0"
  added: "2026-05-21"
---

# MCP App Artefact — Hand-Curated Static Sim Path

> See also: [`agent-protocols/SKILL.md`](../agent-protocols/SKILL.md) for
> the underlying MCP / MCP Apps / A2UI spec disambiguation; this skill
> is the **how to ship one** companion.

> **A port is not a faithful reproduction.** The apps we onboard
> (jitt.dk, DK's KineBot, teacher prototypes) were not built for AIPLA's
> chat-workspace UX and often have weak usability as-is. Improving the
> UX — layout, alignment, responsive behaviour, the iframe/workbench
> split, removing dead chrome — is **in scope for the port, not a
> later pass**. Do not preserve bad UX out of faithfulness. Per
> [Axiom 11 (USABLE BY DESIGN)](../../../docs/product-axioms.md), if the
> source needs UX work to be motivating for a student, that work is
> part of shipping it — do it upfront (see "Step 0" below), not in a
> follow-up cleanup sprint.

## Live artefact inventory

Three artefacts are currently live (deployed to the `aipla-v01-sandbox`
Cloud Run service, reachable through `StaticArtefactFrame`):

| Artefact | Path | Paired skill template | Status |
|---|---|---|---|
| **Boldkast** | `infrastructure/mcp-sandbox/artefacts/boldkast/v1/` | `problem-set-hints` | Live — correct sim-core architecture, reference implementation |
| **KineBot** | `infrastructure/mcp-sandbox/artefacts/kinebot/v1/` | `kinebot-kinematics-tutor` | Live — has quiz/graph/sidebar in iframe (needs iframe-scope cleanup) |
| **LED Planck** | `infrastructure/mcp-sandbox/artefacts/led-planck/v1/` | `led-planck-tutor` | Live — wrong architecture (checklist + data table in iframe); full redo planned |

Next artefacts in the pipeline (see
[`jitt-dk-artefacts.md`](../../../docs/design/aipla/v1.0.0-pilot/jitt-dk-artefacts.md)):
Pendul → Kredsløb → Videoanalyse → GPS Fart → Frekvensanalysator.

Update this table whenever an artefact is added, removed, or its status changes.

## Decision tree — static artefact vs dynamic MCP server

**Static artefact** (this skill covers this path):
- The artefact is HTML + inline JS + inline CSS.
- All logic runs client-side in the iframe.
- No server-side computation, no per-user state, no tool-calls.
- Examples (current/planned): Boldkast projectile sim, future curated
  physics sims, parameter-driven dashboards initialized via query
  params or `postMessage`.
- Lives at `infrastructure/mcp-sandbox/artefacts/<name>/v<version>/index.html`.
- Deployed by the existing `aipla-mcp-sandbox-deploy` Cloud Build trigger.

**Dynamic MCP server** (NOT this skill — defer to a separate skill):
- The artefact needs server-side computation (e.g. lookup tables, RAG,
  external API calls, per-user state).
- Exposes MCP tools that return `ui://` resources.
- Examples: `mcp-ext-apps-map` (live external tool), future
  `mcp-aipla-grading` (server-side answer verification without
  exposing the answer to the agent).
- Lives in its own `infrastructure/mcp-<name>/` directory with its own
  Cloud Run service.
- AIPLA doesn't have one yet; the pattern lives in the inherited template
  at `infrastructure/mcp-ext-apps-map/`.

**Rule of thumb:** if you can ship it as a single committed HTML file
under 200 KB, use the static artefact path. Reach for a dynamic MCP
server only when you actually need a server.

## Step 0 — design the student experience BEFORE building (Axiom 11)

**Do this before you scaffold a single component or strip a single
line.** Our users are students we have to motivate; a confusing or
cramped first contact loses them in seconds. Usability is the feature,
not a fast-follow. Every artefact port in this repo so far (LED Planck,
KineBot) shipped UI-first and then needed a UX cleanup sprint — that
tax is avoidable. See [Axiom 11: USABLE BY DESIGN](../../../docs/product-axioms.md).

Write these down (in the design doc or the sprint plan) before coding:

1. **The student journey.** What does a student see on first contact?
   What is the single obvious next step, at every state? If you can't
   name "what do I do now" for the empty state, you're not ready to
   build.
2. **Every state, not just the happy path.** Design the **loading**,
   **empty**, and **error** states explicitly. A default-active panel
   that renders nothing is a black void (KineBot 1.D shipped one) — a
   bug, not a TODO.
3. **The narrowest target viewport.** The workspace pane is ~700px
   (and resizable). Decide the layout there first, not on your 1440px
   monitor. If the artefact is wider than one simulation's worth,
   it's too much for the iframe — split it (see "Iframe scope rule").
4. **What goes where (the split).** List every surface and mark it
   iframe (the ONE sim) / React workbench / delete. Quiz, graph,
   formula, notes, pickers → workbench. (This is the single most
   common porting mistake.)
5. **Motivation hooks.** Where's the encouragement, the progress, the
   "you're getting it"? A correct-but-cold surface still loses a
   disengaged student.

Only once these are written do you scaffold (`new-workbench-skill.sh`)
and build. The pre-ship usability gate below verifies you held to it.

## Visual design standard (NEVER use dark themes)

Artefacts live inside the AIPLA chat workspace, which uses a **light
theme** (white background, slate foreground, orange primary). A dark or
gradient header inside the iframe looks broken in that context — a
separate app that landed in the wrong container. Every artefact MUST
match the host.

### Canonical CSS variables

Copy this block verbatim into every new artefact's `<style>`:

```css
:root {
  --bg:           #ffffff;
  --fg:           #0f172a;   /* slate-900 */
  --muted:        #64748b;   /* slate-500 */
  --border:       #e2e8f0;   /* slate-200 */
  --accent:       #2563eb;   /* blue-600 — physics convention */
  --accent-soft:  #eff6ff;
  --ok:           #16a34a;
  --warn:         #d97706;
  --bad:          #dc2626;
}
```

### Header rule

**No dark or gradient headers.** The artefact header (if it has one at
all — many don't need one; the `WorkspaceShell` provides the outer
chrome) must use:

```css
header {
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  color: var(--fg);
}
```

Never: `background: linear-gradient(135deg, #0f172a, #2563eb)`,
`background: #0f172a`, or any dark fill.

### Instrument displays

Instrument readouts (ammeter, voltmeter, LCD-style values) must use a
**light** style. The green-on-black LCD look (`background:#111827;
color:#86efac`) is illegible against the white workspace and violates
the design system.

```css
.display {
  background: #f8fafc;
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
  text-align: right;
}
```

### Minimum font sizes

- Body text: **14px** minimum.
- Labels, axis tick text, small metadata: **11px** minimum.
- Never below 11px (`0.68rem` at 16px base = 10.9px — too small).
  `.lablabel`, `.chip`, `.tiny` classes must be `font-size: 11px`
  or larger.

### Layout — no fixed min-width wider than 600px

The workspace pane is `md:w-1/2` (~700px on a typical laptop). Any
artefact with a CSS `min-width` wider than ~600px forces a horizontal
scrollbar in the iframe. Use responsive media queries instead:

```css
/* Single-column default; expand at ≥ 720px */
main {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  padding: 12px;
}
@media (min-width: 720px) {
  main { grid-template-columns: 2fr 1fr; }
}
```

Do not set `min-width` on the bench or grid container. Elements that
are inherently wide (circuit benches with positioned absolute children)
may set `overflow: auto` on their container so the bench scrolls within
its panel, but the page itself must not overflow.

## ADR-013 security gates (NEVER skip)

Every static artefact MUST pass these checks at commit time:

1. **Size ≤ 200 KB** (HTML + inline scripts + inline CSS combined).
   `wc -c infrastructure/mcp-sandbox/artefacts/<name>/v<version>/index.html` — gate.
2. **No external resource fetches.** Grep the file: no `<script src="http`,
   no `<link href="http`, no `<img src="http`, no `fetch(`, no `XMLHttpRequest`,
   no `WebSocket`, no `eval(`. The host iframe's CSP blocks these anyway,
   but defence-in-depth is cheaper to add than to debug.
3. **No `<iframe>` nesting.** This artefact is *already* in a sandboxed
   iframe; nesting another one inside is a CSP / sandbox-flag headache
   no one needs.
4. **Pedagogical guardrail (AIPLA-specific):** if the artefact relates
   to a problem-set, answers that would defeat the "no full solution"
   skill prompt MUST be redacted by default. Boldkast's pattern is the
   reference — per-marker "Vis" toggles that fire a postMessage so the
   host can log toggle events.
5. **AR (or domain expert) sign-off** before merge for any pedagogically
   loaded artefact. Capture as a PR comment.
6. **Responsive viewport gate.** Open the artefact in a 700px-wide
   container (e.g. dev-tools device toolbar at 700×800) and confirm
   there is **no horizontal scrollbar** and no content clipped off the
   right edge. The workspace pane is `md:w-1/2` on the chat page,
   ~700px on a typical laptop. Failing this gate means the artefact
   looks broken inside the AIPLA chat. The Boldkast bench is a single
   canvas + sliders + markers — it fits naturally. Big multi-panel
   labs (LED Planck v1 shipped with a 1430px minimum grid) MUST
   either (a) collapse their layout below ~720px via media query, or
   (b) move their non-interactive panels OUT of the iframe into the
   React workbench surface (see "Workspace integration" below).

## Pre-ship usability gate (NEVER skip — Axiom 11)

Run this in the browser before you merge. Every "no" is a blocker, not
a follow-up — student-facing UX is hard-fail per Axiom 11.

- [ ] **Next step is always obvious.** On first contact (cold, no
      session), a student can tell what to do without instruction.
      There is a visible call to action and never a dead-end.
- [ ] **No empty void.** The default-visible surface renders real
      content or a designed empty state — never a blank panel waiting
      for an action that isn't signposted.
- [ ] **Loading + error states exist.** Slow fetch shows a loader;
      failed fetch shows a human message, not a blank or a console
      error.
- [ ] **Fits 700px wide.** No horizontal scroll, no clipped content,
      controls reachable. Test in the device toolbar.
- [ ] **Fits mobile-portrait** (if in scope): the workspace stacks /
      scrolls; nothing is cut off the bottom or right.
- [ ] **One simulation in the iframe.** No in-iframe tab switcher;
      quiz / graph / pickers / notes are in the React workbench.
- [ ] **A motivation hook is present.** Progress, encouragement, or a
      visible sense of "getting somewhere" — not just correctness.
- [ ] **Drive it as a student for 60 seconds.** Did anything confuse,
      cram, or stall? If yes, it's not done.

## Workspace integration (REQUIRED — codified after LED Planck 1.C)

Every artefact mounted in the chat workspace must ship the **Button +
Workbench + Frame triad**. LED Planck 1.C shipped only the Frame and
auto-mounted it directly into the workspace pane — the 1430px-wide lab
overflowed the ~700px `md:w-1/2` pane horizontally, the lesson
scaffolding was trapped inside the iframe where the React host couldn't
lay it out, and the demo was unusable. Don't ship that shape.

### The triad

1. **`<NameSimButton>`** (or `<NameLabButton>`) — launcher card mounted
   in the workspace pane by default. Mirrors
   [BoldkastSimButton.tsx](../../../frontend/src/components/workspace/BoldkastSimButton.tsx).
   Single click → opens the Frame. Cheap React component, ~30 LOC.

2. **`<NameWorkbench>`** — non-interactive lesson context surface,
   mounted alongside the button. Owns the parts of the lesson that DO
   NOT need to live inside the iframe:
   - Problem framing / Danish description / goal of the activity
   - Step progress (derived from artefact snapshot, NOT from React-
     local state, so it survives a frame close/reopen)
   - Hints, vocabulary, formula glossary
   - "What you've measured so far" summary cards
   The Workbench reads `snapshot` from a `React.useState` lifted to the
   chat page or a parent. Snapshot updates are pushed by the Frame via
   an `onSnapshotChange` prop. The Workbench renders this state into
   cards — no postMessage handling, no iframe internals.

3. **`<NameLabFrame>`** — the existing `forwardRef(StaticArtefactFrame)`
   wrapper. Owns the iframe mount, the JSON-RPC plumbing, the snapshot
   accumulation, the human-tool-event card dispatch, and the
   `sendChatFlush()` imperative method. **Does NOT own lesson framing
   or any text the React host could render itself.**

The chat page mounts the triad like Boldkast does (see
[`frontend/src/app/chat/[...path]/page.tsx`](../../../frontend/src/app/chat/[...path]/page.tsx)
inside the `showAiplaWorkspace && skillSlug === "..."` block):

```tsx
{showAiplaWorkspace && skillSlug === "my-lab" && (
  <WorkspaceShell hideOnMobile={mobileTab !== "workspace"}>
    {showMyLab && SANDBOX_ORIGIN ? (
      <MyLabFrame
        ref={frameRef}
        sandboxOrigin={SANDBOX_ORIGIN}
        sessionId={sessionId ?? agentSessionId}
        onClose={() => setShowMyLab(false)}
        onSnapshotChange={setSnapshot}
      />
    ) : (
      <div className="space-y-4">
        <MyLabButton onOpen={() => setShowMyLab(true)} />
        <MyLabWorkbench snapshot={snapshot} sessionId={sessionId ?? agentSessionId} />
      </div>
    )}
  </WorkspaceShell>
)}
```

### Iframe scope rule — "ONE simulation, nothing else"

**The iframe holds exactly ONE live simulation surface. Everything
else — including other *interactive* surfaces — moves to React.**

This is stronger than "interactive only", and the distinction cost a
rework. KineBot 1.D first shipped with three interactive surfaces
(sim **+** quiz **+** graph) crammed into the iframe behind a tab
switcher, because all three are "interactive" so the old rule said
keep them. The result was the same cramped multi-role failure as LED
Planck, plus an empty-tab black void (the default quiz tab rendered
nothing until an action that never surfaced). The fix was to make the
iframe **sim-only** and lift quiz + graph into React.

The sharper test: **if it's a different *mode* or *view* — a quiz, a
graph, a formula sheet, a notes pad, a topic picker — it is NOT the
simulation, even if it's interactive. It belongs in the React
workbench.** A tab-switcher inside the iframe is the anti-pattern that
tells you you've put more than one surface in there.

- **Quiz / MCQ** → React. It's data (static JSON) + click handling.
  No canvas. Never belongs in the iframe. (`KineBotQuiz.tsx` reads the
  bank from `${sandboxOrigin}/artefacts/<name>/v1/quizzes/<topic>.json`
  — CORS-open static content — and reports attempts through the shared
  snapshot hook.)
- **Graph / plot** → React `<canvas>`. Yes it's a canvas, but it's a
  *separate view*, not the live sim. Port the plotting math to a TS
  component (`KineBotGraph.tsx`, ~150 lines). It reports the active
  graph type through the snapshot hook so the tutor knows what the
  student is studying.
- **The one live simulation** (the thing with the moving ball / the
  bench / the dragging) → iframe, full-height, responsive. No tabs.

Concrete test (unchanged): imagine removing a panel from the iframe and
re-rendering it in React. If nothing breaks, it shouldn't have been in
the iframe.

Common mistakes — these belong in React, not the iframe:
- Lesson instructions, step lists, formula references
- Long-form problem statements
- Progress checklists driven by sim state — derive in React from the
  snapshot the host already accumulates. Don't render them in the
  iframe and then mirror to the host (LED Planck 1.C did this — see
  the redundant `<section class="panel"><h2>Experiment procedure</h2>
  ...checklist...</section>` in the original AR HTML, removed
  in the 1.C follow-up).
- Big static help text panels
- **Topic / mode pickers / sidebar nav** (KineBot pattern) — render
  in React. Drive iframe state via host → artefact notifications
  (see "Host → artefact notifications" below).
- **Formula / reference panels** (KineBot's Formulas tab) — pure
  static lookup keyed by current topic; no canvas, no sandbox needed.
- **Notes / sketchpad surfaces** (KineBot's Notes tab) — textarea +
  save/tag/export, persisted to `sessionStorage` or an AIPLA endpoint.
  Standard form controls don't need the sandbox.
- **XP / progress bars** (KineBot's gamification) — derived from
  snapshot, display-only.

Keep in the iframe:
- The canvas / WebGL / interactive bench
- Sliders, knobs, terminals, drag-targets that depend on pointer events
  inside the sim space
- Chart / data visualisation tied to the live sim state
- Anything that emits the postMessage telemetry

### DELETE category — surfaces that have no place anywhere on AIPLA

External artefacts (KineBot, future jitt.dk apps, anything ported from
outside) often ship with surfaces that AIPLA already provides at the
platform level. These get **deleted entirely** — neither iframe nor
React workbench:

- **Embedded chat panels** — AIPLA's chat surface owns chat. Always
  delete the artefact's own chat (input boxes, message threads,
  quick-prompt buttons, "🤖 Ask AI" / "Explain this" affordances
  that trigger model calls).
- **Auth chrome / API-key inputs** — AIPLA handles auth. Delete
  modals/inputs that ask for Anthropic/OpenAI/Gemini keys, any
  `sessionStorage.setItem.*apiKey` writes, and the entire "settings"
  surface around them.
- **Header chrome / logo / branding** — AIPLA's `WorkspaceShell`
  provides the header. Delete the artefact's own `<header>` (title,
  logo, action buttons like Clear / Settings / Voice that aren't
  pedagogically interesting).
- **External AI calls** — any `fetch("https://api.anthropic.com", ...)`,
  `fetch("https://api.openai.com", ...)`, etc. Delete the call site;
  if the feature is still wanted, route through AIPLA backend via the
  iframe-context channel (the tutor will see the state) instead.
- **External font / CDN imports** — `<link href="https://fonts.googleapis.com">`,
  CDN scripts. Replace with system font stack or self-host. ADR-013's
  CSP blocks these in production anyway.

### Telemetry channel is identical

The Workbench sees the same snapshot the iframe-context POST sends to
the agent. The artefact emits `ui/update-model-context` notifications;
the Frame's `onUpdateModelContext` callback updates the snapshot ref,
fires `onSnapshotChange(snapshot)`, AND POSTs to
`/api/sessions/{id}/iframe-context`. Two consumers, one source of
truth. The agent and the React workbench observe the same thing.

This means the Workbench's step progress / measurement summary is
**always consistent with what the tutor sees**. The student can't
"unsync" them.

### Shared snapshot hook — when MORE than the iframe reports events

For a simple artefact (Boldkast, LED Planck) the Frame owns the
snapshot: only the iframe produces events, so the Frame's
`onUpdateModelContext` accumulates state + POSTs iframe-context +
dispatches cards. Fine.

But once you lift quiz/graph/etc. into React (per the rule above),
those React surfaces ALSO produce pedagogical events — and they're
not inside the iframe, so they can't go through the Frame's
`onUpdateModelContext`. Two writers to one snapshot.

**Pattern: lift the snapshot into a hook.** `use<Name>Snapshot(sessionId)`
returns `{ snapshot, reportEvent }`. `reportEvent(evt)` is the single
entry point that mutates the snapshot, POSTs to
`/api/sessions/{id}/iframe-context`, and dispatches the chat card (with
the push-with-card vs silent decision). Every surface calls it:

- The **Frame** routes the iframe's events to `reportEvent` (its
  `onUpdateModelContext` just forwards: sim events in → `reportEvent`).
- The **React quiz** calls `reportEvent({kind:"<name>.quiz-attempt", …})`.
- The **React graph** calls `reportEvent({kind:"<name>.graph-change", …})`.
- The **topic picker** calls `reportEvent({kind:"<name>.set-topic", …})`
  AND `frameRef.setTopic(t)` (the latter just forwards a host→iframe
  notification so the sim re-renders; see "Host → artefact
  notifications").

The chat page calls the hook once and passes `snapshot` +
`reportEvent` down to both the Frame and the Workbench.
`use<Name>Snapshot` owns the catch-up-on-late-sessionId effect too.
Reference: [`useKineBotSnapshot.ts`](../../../frontend/src/hooks/useKineBotSnapshot.ts).

**When the sim re-renders from a host→iframe `set-*` notification, do
NOT echo it back** as a telemetry event (no-mirror rule) — the hook
already recorded it when the React surface called `reportEvent`.

### Host → artefact notifications (set-state pattern)

The iframe → host direction is covered by `ui/update-model-context`
(events flowing OUT). The opposite direction — React workbench pushes
state INTO the iframe — is also part of the spec, and many artefact
ports need it once lesson navigation lives in React rather than inside
the iframe.

Two existing host → iframe notifications in AIPLA today:
- **`ping`** — JSON-RPC request from host; the artefact responds with
  `{result: {}}` so the proxy knows the iframe is alive.
- **`ui/notifications/chat-flush`** — fire-and-forget; the artefact
  flushes any locally-batched changes (pendingChanges map in Phase 2
  commit-on-submit) as a state-change event so the tutor sees the
  current configuration before the user message lands.

For workbench-driven state pushes (the topic picker / mode selector
case), establish the convention **`<artefact>.set-<thing>`**:

```ts
// Frame side — caller is in React land
staticFrameRef.current?.sendNotification(
  "kinebot.set-topic",
  { topic: "projectile-motion" },
);
```

```js
// Artefact side — alongside the existing ping + chat-flush handlers
window.addEventListener("message", function (e) {
  const d = e.data;
  if (!d || d.jsonrpc !== "2.0") return;
  // ...existing ping handler...
  if (d.method === "kinebot.set-topic" && d.params) {
    currentTopic = d.params.topic;
    renderTopicCanvas();  // re-render the sim with the new topic
    return;
  }
});
```

The host wraps `sendNotification` through `StaticArtefactFrame`'s
`useImperativeHandle`-exposed method, which posts the JSON-RPC envelope
to the sandbox proxy with the correct origin.

**Naming convention.** Use `<artefact>.set-<noun>` for state pushes
that change a variable inside the artefact (e.g.
`kinebot.set-topic`, `boldkast.set-preset`). Use
`<artefact>.cmd-<verb>` for imperative commands that trigger an
action but don't carry persistent state (e.g.
`boldkast.cmd-reset`). `ui/notifications/chat-flush` is the
spec-defined chat-flush method (no artefact prefix because it's
generic across all artefacts).

**Do NOT mirror.** State that's been pushed into the iframe via a
`set-` notification should NOT be echoed back to the host via a
`ui/update-model-context` event for the same field. The host already
knows the value (it just sent it). If the iframe transforms the
state somehow (e.g. computes a derived value), that derived value
CAN come back as a normal telemetry event.

### When the Frame is closed

Snapshot state lives at the chat-page level (lifted above the Frame).
Closing the Frame unmounts the iframe but **preserves the snapshot**
in React state. Reopening the lab restores the in-progress state
visually (the iframe boots fresh, but the workbench cards still
reflect last-known state). This is the expected behaviour.

## The artefact is the sim, not the whole lesson

**The most important architectural rule.** The workbench artefact is the
simulation or interactive element only. AIPLA is the platform that wraps
it — the chat tutor, the lab notebook, the lesson picker, the session
report. Do not put any of the following inside the artefact:

- Procedure instructions or step-by-step checklists → the tutor handles this
- AI hints or explanations → the tutor provides Socratically
- Data recording tables, results calculators, % error displays → lab notebook or tutor
- Built-in quizzes or MCQs → platform or tutor
- Formula reference cards → tutor provides on demand

**Reference: Boldkast.** One canvas, sliders, answer-reveal markers. That's it.

**Counter-example: LED Planck 1.C (first attempt).** The first artefact
built for LED Planck included a procedure checklist panel, a data recording
table, a Planck results calculator with % error, and a multi-step wizard.
It had everything a standalone lab needs — but a standalone lab is not what
AIPLA needs. The artefact was scrapped; the redo extracts only the circuit
builder, ammeter/voltmeter displays, I-U graph, and spectrometer.

When porting an existing tool (jitt.dk app, virtual lab), read the source,
identify the sim core, strip everything else, and build the artefact from
that core only. The rest becomes input to the tutor system prompt ("the
student will see X — ask them what it implies").

## Patterns that work / patterns that don't (from Boldkast)

What actually shipped + what we learned:

**Works:**
- Single self-contained HTML, vanilla JS, <30 KB for a sim with one
  canvas + sliders + markers + two component graphs.
- Three structural panels: trajectory canvas (main), controls (sliders +
  play/pause/reset), markers (Vis-redacted answer rows).
- **Pedagogical default trick:** sliders should NOT start pre-set to the
  problem's exact values. Neutral starting values force the student to
  read the problem, drag the sliders to match, and only then verify.
  Pre-set defaults defeat the Vis gate. Boldkast 2026-05-20 caught this
  late; the artefact now starts at v₀=10, θ=30 (problem asks 15, 40).
- Slider drag resets reveals — student must re-commit per parameter set.
- Component / position graphs that ride the main animation cursor.
  Excellent for visualising decomposition-type misconceptions.
- postMessage events `{source: name, type: name + ".event"}` with stable
  names: `open / play / pause / reset / param.change / show_value`.
  Boldkast also emits per-marker `show_value` so OTel sees which answers
  the student revealed.
- **Field-name discipline on emit():** the host validates `e.data.source
  === "<artefact-name>"` to namespace messages. So the `extra` object
  passed to `emit()` MUST NOT include a key named `source` — it'll
  override the namespace via Object.assign and the host will reject
  the message as cross-namespace. Use `triggeredBy` for "where did
  this event come from" (slider vs preset click), `marker` for which
  answer-marker, `param` for which parameter changed, etc. Reserved
  field names enforced by convention only — easy to typo, easy to
  catch in a Playwright test.
- Self-test on `?test=1` — flips `document.title` to "TEST PASS" or
  "TEST FAIL". CI can probe headlessly.
- Danish-first copy; pedagogical-warning panel ("Værdierne er skjult
  med vilje…") as a yellow strip near the markers.

**Doesn't work:**
- React / Vue / Svelte — bundle blows the 200 KB ceiling 5-10×.
- CDN imports — `default-src 'none'` CSP blocks them anyway.
- `eval()`, `new Function()`, `WebSocket`, `fetch()` to anywhere —
  same CSP gate. Network artefact = don't ship.
- Cross-origin iframes nested inside the artefact — `frame-src 'none'`.
- Showing the answer-value without an explicit toggle. Defeats the
  whole pedagogical gate.
- Defaults that match the problem's exact parameters (see above).
- **Rolling your own iframe + `window.addEventListener("message", ...)` in
  the host wrapper.** Use [`<StaticArtefactFrame>`](../../../frontend/src/components/workspace/StaticArtefactFrame.tsx)
  instead. It mounts the spec's sandbox-proxy at `/sandbox.html`, runs
  the `ui/initialize` handshake, parses JSON-RPC envelopes, and
  authenticates by origin (the proxy has a real origin per spec
  §Sandbox proxy lines 470–487). Going off-proxy means re-implementing
  the auth gate AND deviating from MCP Apps spec — both are anti-patterns.
  See "postMessage from artefact → host" below.
- **Pushing iframe-context to the agent without dispatching a chat
  card.** The agent gets the state but the student / dev has no
  visible signal it landed. Always pair the iframe-context POST with
  a `useHumanToolEvents.dispatch` call (silent for non-pedagogical
  events, with a Danish label for student actions).

## Recipe — how to prompt an LLM to generate a new artefact

When asking Claude (or any coding agent) to generate a new artefact,
paste the prompt below. Substitute `<<PROBLEM>>` with the actual physics
or maths problem the artefact illustrates.

```
TASK: Generate a single self-contained HTML/JS/CSS artefact for the AIPLA
educational harness. The artefact will be served from a sandboxed iframe
on a separate origin from the host, and embedded in the chat workspace.

PROBLEM:
<<PROBLEM — paste the Danish stx problem statement, including givens
and sub-parts. Note the values the problem ASKS the student to use.>>

HARD CONSTRAINTS (the harness enforces these; failures = won't deploy):
1. Single file, <= 200 KB total (HTML + inline CSS + inline JS).
2. NO external resources. No script-src http, no img-src http, no
   network fetch calls, no eval, no nested iframes. The host's CSP
   blocks all of these — it will be a black screen if you try.
3. No frameworks (React/Vue/Svelte). Vanilla JS only. requestAnimationFrame
   is fine for animation. <canvas> for any visualisation.
4. Sandboxed iframe with `sandbox="allow-scripts"` only — NO
   allow-same-origin, NO popups, NO top-nav. Plan accordingly.

PEDAGOGICAL CONSTRAINTS:
5. The student must NOT be able to read the answer just by opening the
   artefact. Hide the answer-values (e.g. y_max, range) behind per-marker
   "Vis" toggle buttons. Render as "—" until clicked.
6. Slider defaults must NOT match the problem's exact parameter values.
   Start with NEUTRAL values (e.g. 60-70% of the problem's value) so
   the student has to read the problem and drag the sliders to match
   before the artefact is meaningfully calibrated.
7. When the student drags a slider, reset all revealed markers to "—"
   so they must re-commit to a calculation per parameter set.
8. If the artefact illustrates a documented misconception (e.g. for
   projectile motion: independence of horizontal/vertical axes), include
   secondary visualisations that make that misconception concretely
   visible (e.g. v_x(t) and v_y(t) graphs side-by-side with the
   trajectory canvas).
9. Danish-first UI copy with English-as-secondary in comments only.
   Decimal separator: comma (e.g. "4,74 m" not "4.74 m").

TELEMETRY / AGENT-OBSERVABILITY:
10. Emit postMessage events on every pedagogically meaningful user
    action so the host (and the agent through it) can observe what
    the student is doing inside the iframe. Pattern:
        parent.postMessage(
          { source: "<artefact-name>", type: "<artefact-name>.<verb>",
            ...payload }, "*");
    Mandatory event verbs (use these literal strings — the host has
    handlers keyed on them):
      - "open"          — fired once on artefact load.
      - "show_value"    — fired on per-marker reveal. Payload:
                          {marker: "<id>", revealed: true|false}.
      - "param.change"  — fired on every parameter change. Payload:
                          {param: "<id>", value: <number>,
                           triggeredBy?: "slider" | "preset:<name>"}.
                          The host debounces slider-drag pushes 500ms
                          so the agent sees the final value without
                          flooding (per the trust-the-context UX);
                          preset clicks push + card immediately.
      - "play" / "pause" / "reset" — control state. Host logs locally
                          but does NOT push to the agent (not
                          pedagogically interesting).
    Field-name discipline: never include a top-level `source` key
    in the payload — it collides with the namespace `source: "<artefact>"`
    that the host filters on. Use `triggeredBy:` for context-of-event.
11. Pedagogical-state snapshot: each `show_value` and preset-click
    event should leave the artefact in a deterministic state that the
    host can render as "what the student has interacted with so far".
    The host accumulates: which markers are revealed, current
    parameter values, last-clicked preset. Don't break invariants
    (e.g. don't auto-reveal a marker on init — student must click).

STRUCTURAL TEMPLATE:
Start from `infrastructure/mcp-sandbox/artefacts/_template/v1/index.html`.
Replace the TODO blocks. Keep the `emit()` helper, the slider event
handlers' reveal-reset behaviour, and the `?test=1` self-test stub.

OUTPUT:
Write the file at `infrastructure/mcp-sandbox/artefacts/<NAME>/v1/index.html`.
Where <NAME> is a kebab-case identifier (e.g. `wave-superposition`).
After writing, verify:
  - `wc -c <path>` shows under 200000.
  - `grep -E 'src="http|fetch\(|XMLHttpRequest|WebSocket|eval\('` matches nothing.
  - Open `<path>?test=1` and check the tab title says "TEST PASS — ...".
```

The `_template/v1/index.html` ships all the structural patterns —
slider state, animation loop, marker rendering, telemetry, self-test.
You can run the scaffold script and edit, or paste the prompt above
into a Claude session.

## External-artefact migration runbook (porting existing apps)

This section is for the **port-from-outside** workflow — taking an
HTML/JS artefact built by someone else (DK's KineBot, a jitt.dk app,
a teacher's prototype) and shipping it as an AIPLA-compliant activity.
It's a different workflow from "create a new artefact from the
scaffold" above: existing artefacts come with chat panels, API key UIs,
direct LLM calls, custom navigation chrome — none of which AIPLA wants.

The 7-step canonical runbook below is the migration checklist. Each
step is concrete: a command, a grep, a file edit. Follow them in
order — earlier steps unblock later ones.

### Step 1 — Audit

Read the source. Identify the violations and the surface inventory
before touching anything. Capture both as a short audit doc so the
sprint plan has a panel-by-panel mapping to point at.

```bash
SRC=path/to/external-artefact.html

# Size — must be < 200 KB after migration; if the source is way over,
# plan for a big strip pass.
wc -c "$SRC"

# Direct external API calls — every match is a strip target.
grep -nE 'fetch\(["'\''`]https://|XMLHttpRequest|new WebSocket' "$SRC"

# API-key UI and key persistence — every match is a delete target.
grep -nE 'apiKey|sessionStorage\.setItem.*[Kk]ey|localStorage\.setItem.*[Kk]ey' "$SRC"

# External resource imports — must move to inline / system-font.
grep -nE '<script src="https://|<link[^>]+href="https://|@import url\(https' "$SRC"

# eval / new Function — almost always a strip target (and would
# fail CSP anyway in production).
grep -nE 'eval\(|new Function\(' "$SRC"

# Top-level structural panels — gives you the surface inventory
# without reading 1700 lines of HTML.
grep -nE '<(header|nav|section|main|aside|footer|div class="(panel|tab|sidebar|toolbar))' "$SRC" | head -40
```

For each panel found, classify against the [Iframe scope rule]
(#iframe-scope-rule--interactive-only):
- **Iframe (keep)** — canvas, sliders, interactive bench, chart tied
  to live state
- **React workbench (move)** — topic picker, formula reference, notes,
  progress display
- **Delete (drop entirely)** — embedded chat panel, API key UI, header
  chrome, "Explain with AI" buttons, external font/CDN imports

Write the inventory as a markdown table in the audit doc. The sprint
plan refers to this table directly when scoping milestones.

### Step 2 — Strip

Delete the violations identified in Step 1. Order matters:

1. **Delete embedded chat panel + chat-related buttons** (Quiz Mode,
   Clear, Voice, "🤖 Explain") first. These usually anchor a lot of
   downstream code that you'll then delete too.
2. **Delete API-key UI + key persistence**. Removes the
   `sessionStorage.setItem(...apiKey...)` writes.
3. **Delete direct API call sites**. Each `fetch("https://api.anthropic.com")`
   etc. gets removed. The chat callers will already be gone from step
   1; the standalone callers (e.g. an "Explain" button on a graph,
   an "AI quiz generation" call) get individual deletion.
4. **Replace AI-generated dynamic content with static data**. If the
   artefact uses an LLM to generate quizzes, hints, or examples on the
   fly, replace with a static JSON bank served from the same origin
   (`fetch('./quizzes/<topic>.json')` — CSP allows same-origin).
   Vetted, deterministic, no per-request LLM call.
5. **Replace external font/CDN imports** with system font stack.

Re-run the Step 1 audit greps. All matches should be zero.

### Step 3 — Wire (telemetry events)

Add the JSON-RPC handshake + emit helpers (~30 LoC inline; copy from
the Boldkast / LED Planck artefact). Then wire each pedagogically
meaningful event hook through `emit()`:

```js
emit("<artefact-name>.<event>", { ...payload });
// → translated to:
// rpcNotify("ui/update-model-context", {
//   structuredContent: { kind: "<artefact-name>.<event>", ...payload }
// });
```

If lesson navigation moves to React (typical for any
multi-topic / multi-mode external artefact), also add the
host → artefact notification listener so the React workbench can push
state IN. See [Host → artefact notifications]
(#host--artefact-notifications-set-state-pattern).

### Step 4 — Extract (system prompt → SKILL.md)

If the artefact embeds a system prompt for its own chat (KineBot's
SYSTEM_PROMPT constant around line 1030, etc.), extract it verbatim
to `backend/skills/templates/<slug>/SKILL.md` and delete the original
constant from the HTML. The skill template owns the prompt; the
artefact just emits events the skill's tutor reads.

Frontmatter shape — copy from one of the existing skill templates
([`backend/skills/templates/led-planck-tutor/SKILL.md`](../../../backend/skills/templates/led-planck-tutor/SKILL.md)
is the recent reference):

```yaml
---
name: <slug>
displayName: "<Display Name>"
avatar: /lesson-images/<slug>.svg
description: >
  <one-paragraph description of the activity>
initialMessage: |
  <Danish or English greeting that introduces the activity and
  suggests a few starter prompts>
metadata:
  author: aipla
  version: "0.1.0"
  model: gemini-2.5-flash
  thinkingModel: null
  tools: []
  toolConfigs:
    a2ui:
      enabled: false
    mcp:
      allow_context_writes:
        - <artefact-name>
      servers: []
    defaults:
      artefacts: false
      memory: false
  subSkills: []
---

<verbatim system prompt body>
```

### Step 5 — Package (ADR-013 pipeline re-scan)

Run the full ADR-013 gate against the migrated artefact:

```bash
ART=infrastructure/mcp-sandbox/artefacts/<name>/v1/index.html
wc -c "$ART"                              # < 200000
grep -nE 'fetch\("https?:|XMLHttpRequest|new WebSocket' "$ART"   # empty
grep -nE '<script src="https?://|<link[^>]+href="https?://' "$ART"  # empty
grep -nE 'eval\(|new Function\(' "$ART"  # empty
```

Open the artefact at 700px viewport width (devtools device toolbar).
No horizontal scrollbar, no clipped content. This is the
[responsive viewport gate]
(#adr-013-security-gates-never-skip)
(ADR-013 gate #6).

### Step 6 — Pair (host wrapper + chat-page mount)

Build the Button + Workbench + Frame triad per
[The triad](#the-triad). Three files:

- `<Name>LabButton.tsx` (or `<Name>SimButton.tsx`) — launcher card
  (~30 LOC)
- `<Name>Workbench.tsx` — React surface for the panels that moved out
  of the iframe (topic picker, formulas, notes, progress)
- `<Name>LabFrame.tsx` (or `<Name>Frame.tsx`) — `forwardRef` wrapper
  around `StaticArtefactFrame`. Owns the snapshot accumulation +
  `onSnapshotChange` callback + `sendChatFlush()` + any
  `sendNotification("<name>.set-*", ...)` exposed via
  `useImperativeHandle` for host → artefact pushes.

Wire the chat page branch following the Boldkast / LED Planck
template (see
[`frontend/src/app/chat/[...path]/page.tsx`](../../../frontend/src/app/chat/[...path]/page.tsx),
the `showAiplaWorkspace && skillSlug === "..."` blocks).

### Step 7 — Test

Three test layers:

1. **Vitest** on the Frame — event routing per kind (snapshot field
   updates, card-vs-silent dispatch), `sendChatFlush()` ref method,
   any `sendNotification()` ref method for host → artefact state,
   cross-origin rejection (inherited from `StaticArtefactFrame`).
   ~12 cases is the LED Planck reference.
2. **Pytest** on the skill template — `_parse_template` returns the
   expected name / displayName / avatar / accessControl; system
   prompt body contains the expected markers; `toolConfigs.defaults`
   opts out of artefacts + memory; `mcp.allow_context_writes`
   includes the artefact name.
3. **Pytest** on workspace observability — extend
   `test_workspace_observability.py` with a case that POSTs the new
   snapshot shape under the artefact's serverId and asserts the
   `InstructionProvider` block carries the key fields the agent
   should see.

Final smoke: deploy to dev, visit the chat URL, drag the resize
divider through the snap zones, exercise each event type in the
iframe, confirm the tutor references state in the next turn.

### Anti-patterns to avoid during a migration

- **Don't try to "fix" the external artefact in-place.** Strip
  ruthlessly; the goal is AIPLA-compliant, not "preserve every
  feature the original had."
- **Don't keep the embedded chat as a "backup" channel.** One chat
  per page (AIPLA's), always.
- **Don't add new wire formats.** Reuse `ui/update-model-context`,
  `ping`, and the `<artefact>.set-*` convention for state pushes.
  No `aipla:workbench`-style custom envelopes.
- **Don't preserve original-artefact branding / headers.** AIPLA
  provides chrome via `WorkspaceShell`; the artefact is the
  interactive surface only.
- **Don't punt the responsive check.** Verify at 700px workspace
  width before you commit. The ADR-013 viewport gate is non-optional.

### Reference migrations

- [`kinebot-migration.md`](../../../docs/design/aipla/v1.0.0-pilot/kinebot-migration.md) —
  KineBot (1.D), the runbook's first stress-test
- [`led-planck-skill.md`](../../../docs/design/aipla/v1.0.0-pilot/implemented/led-planck-skill.md) +
  [`led-planck-integration-followup.md`](../../../docs/design/aipla/v1.0.0-pilot/led-planck-integration-followup.md) —
  LED Planck (1.C); not an external port, but the case study that
  drove the workspace-integration discipline this runbook codifies

## Steps to add a new artefact (using the scaffold)

Worked example below targets a hypothetical `wave-superposition` sim;
substitute your artefact name.

### 1. Scaffold the dir

```bash
./scripts/new-artefact.sh wave-superposition "Bølge-superposition"
```

This:
- Clones `_template/v1/` to `artefacts/wave-superposition/v1/`
- Substitutes `{{ARTEFACT_NAME}}` and `{{ARTEFACT_TITLE}}`
- Runs the safety gates (size cap, no external fetches) and bails if
  the scaffold somehow fails them
- Prints the URLs you can use to test it

Versioned dir (`v1`, `v2`, …) so future revisions land alongside, not
in place — the host frontend pins to a version-specific URL.

### 2. Write the artefact

Single file at
`infrastructure/mcp-sandbox/artefacts/wave-superposition/v1/index.html`.
Structure follows the Boldkast model:

```html
<!doctype html>
<meta charset="utf-8">
<title>Wave superposition — interaktiv visualisering</title>
<style>/* inline CSS, ~5 KB */</style>
<body>
  <header><h1>Title</h1><p>Givet: …</p></header>
  <main>
    <canvas id="viz"></canvas>
    <aside class="controls">
      <label>Param <input type="range" …></label>
      <button id="play">▶ Afspil</button>
    </aside>
    <aside class="markers">
      <p>Result: <span class="value">—</span> <button data-marker="x">Vis</button></p>
    </aside>
  </main>
  <script>/* inline JS, ~30 KB; uses requestAnimationFrame; emits postMessage on user events */</script>
</body>
```

Telemetry events to emit via `parent.postMessage({type, marker, ...}, '*')`:
- `<artefact>.open` — fired once on load (gives the host an "iframe ready" signal).
- `<artefact>.play` — user clicked play / interacted.
- `<artefact>.show_value` with `marker: <id>` — user clicked the per-marker reveal.

The host (frontend) routes these into OTel via the existing
`MCPAppToolCallRouter` → `/api/proxy/api/sessions/{id}/iframe-context`
pipeline. Cloud Trace then shows them per-session.

### 3. Run the local size + safety check

```bash
wc -c infrastructure/mcp-sandbox/artefacts/wave-superposition/v1/index.html
# must be ≤ 200000

grep -E 'src="http|href="http|fetch\(|XMLHttpRequest|WebSocket|eval\(' \
  infrastructure/mcp-sandbox/artefacts/wave-superposition/v1/index.html
# must be empty
```

### 4. Local smoke

```bash
# Backend + frontend already running via scripts/dev-local.sh.
# Open the file directly to iterate:
open infrastructure/mcp-sandbox/artefacts/wave-superposition/v1/index.html
```

For full iframe-in-host smoke, start the sandbox alongside (port 3457
by default — see scripts/dev.sh) and point a frontend test page at it.

### 5. Wire into the frontend (if it's a new mount, not a Boldkast revision)

If the artefact is a new top-level capability (not just a v2 of an
existing one), wire a launcher button in
`frontend/src/components/workspace/` or the relevant chat surface.

**Compose the URL from the sandbox origin** (drop the trailing
`/sandbox.html` from `NEXT_PUBLIC_MCP_SANDBOX_URL`, then append the
artefact path):

```tsx
// Strip the /sandbox.html suffix so we get just the sandbox origin.
const SANDBOX_ORIGIN = (process.env.NEXT_PUBLIC_MCP_SANDBOX_URL ?? "")
  .replace(/\/sandbox\.html$/, "");
const url = `${SANDBOX_ORIGIN}/artefacts/wave-superposition/v1/index.html`;
```

**Iframe attribute contract — REQUIRED, both layers needed.** Per
ADR-013, the server-side CSP (set by `serve.ts` on `/artefacts/*`)
covers script execution + external-fetch denial. The host-side
iframe `sandbox` attribute covers what the frame is allowed to do to
the host (top navigation, popups, same-origin storage). Always set
BOTH:

```tsx
<iframe
  src={url}
  // allow-scripts only — explicitly NOT allow-same-origin, NOT
  // allow-top-navigation, NOT allow-popups. With these omitted the
  // iframe runs in a unique-origin sandbox and can't reach host cookies.
  sandbox="allow-scripts"
  // Block any referrer leakage to the artefact.
  referrerPolicy="no-referrer"
  // Optional: title for screen readers.
  title="Wave superposition simulation"
  className="h-full w-full border-0"
/>
```

`NEXT_PUBLIC_MCP_SANDBOX_URL` is set at build time in
`cloudbuild.yaml` (`--build-arg`) and reads from `frontend/.env.local`
for LOCAL_MODE.

**postMessage from artefact → host — TWO paths; default to the spec-compliant one.**

### Spec-compliant path (RECOMMENDED for all new artefacts)

The MCP Apps spec defines JSON-RPC 2.0 over postMessage as the iframe ↔
host wire format, routed through a sandbox-proxy architecture (spec
lines 411–487 of the vendored snapshot at
[.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md](../agent-protocols/references/mcp-apps-spec-2026-01-26.md)).

AIPLA migrated Boldkast onto this path in sprint MCPAPP-SPEC (2026-05-21).

**Host side — use `StaticArtefactFrame`**
([frontend/src/components/workspace/StaticArtefactFrame.tsx](../../../frontend/src/components/workspace/StaticArtefactFrame.tsx)):

```tsx
import { StaticArtefactFrame } from "@/components/workspace/StaticArtefactFrame";

<StaticArtefactFrame
  sandboxOrigin={SANDBOX_ORIGIN}
  artefactPath="myart/v1"   // fetched from ${SANDBOX_ORIGIN}/artefacts/myart/v1/index.html
  onUpdateModelContext={(structuredContent) => {
    // structuredContent.kind carries the artefact's event vocab
    handleEvent(structuredContent as MyArtefactPayload);
  }}
  hostContext={{ theme: "light", locale: "da-DK" }}
/>
```

`StaticArtefactFrame` handles the full spec lifecycle (sandbox-proxy
handshake, JSON-RPC envelope parsing, origin-based auth via
`e.origin === sandboxOrigin`, ui/initialize handshake, ping responder,
cleanup). The wrapper file owns only artefact-specific event routing
(snapshot accumulation, push-with-card vs silent-push, slider debounce,
Danish label functions) — mirror [BoldkastSimFrame.tsx](../../../frontend/src/components/workspace/BoldkastSimFrame.tsx)
as a template.

**Artefact side — speak JSON-RPC directly** (no SDK needed; spec line 426):

```html
<script>
  // ~30 lines of vanilla JSON-RPC helpers; see Boldkast index.html
  // for a working copy. Key functions:
  //   rpcNotify(method, params)        — fire-and-forget
  //   rpcRequest(method, params)        — Promise<result>
  //   + ping responder per spec line 508

  rpcRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    capabilities: {},
    clientInfo: { name: "myart", version: "1.0.0" },
  }).then(() => {
    rpcNotify("ui/notifications/initialized", {});
    // Now safe to emit application notifications:
    // rpcNotify("ui/update-model-context", {
    //   structuredContent: { kind: "myart.event", ...payload }
    // });
  });
</script>
```

Events emitted before init completes should queue and flush on init
success (race-safe per Boldkast's implementation).

### Path policy: one way, no fallbacks

AIPLA had a defensive fallback hook (`useSandboxedIframeMessages`)
during the migration; it was deleted on 2026-05-21 once the spec path
proved out. **There is exactly one path for iframe artefacts: go
through `StaticArtefactFrame` + the sandbox proxy at `/sandbox.html`.**

References:

- [mcp-app-iframe-spec-compliance.md](../../../docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-spec-compliance.md) — the current path
- [mcp-app-iframe-harness.md](../../../docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-harness.md) — historical (superseded)

**Surface activity in chat — the "trust the context" card.** Whenever
the host pushes iframe-context state to the agent (so it sees what
the student did), also dispatch a card so the *student* and the *dev*
see the same thing in the chat transcript. Mirror the pattern in
[BoldkastSimFrame.tsx](../../../frontend/src/components/workspace/BoldkastSimFrame.tsx):

```tsx
import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";

const humanToolEvents = useHumanToolEvents();
// inside the onMessage handler, when a push is warranted:
const req = fetchWithAuth(`/api/proxy/api/sessions/${sid}/iframe-context`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ serverId: "myart", toolName: "state", structuredContent }),
});
const label = labelFor(data); // Danish, artefact-specific, e.g. "Justerede v₀ til 15 m/s"
if (label) humanToolEvents.dispatch({ label, push: () => req });
else void req.catch(() => {});  // silent push for non-pedagogical events
```

The card transitions pending → confirmed (POST 204) → failed (4xx/5xx),
so failed pushes are visible instead of silent.

### Phase 2 — commit-on-submit (1.E-Ph2, 2026-05-26)

**The Phase 1 rule "debounce slider drags ~500ms and emit one card per
drag-end" is superseded.** AR's 2026-05-26 feedback after live student
testing: *"only record when the student presses Afspil."*

Pre-commit slider exploration ("what about v₀=30? what about v₀=10?")
is *thinking out loud*. It doesn't belong in the chat record or the
model context. The new rule:

**Slider changes accumulate locally inside the artefact. The host only
sees them when the student commits.** Two commit signals:

1. **Commit-class button click** (e.g. Afspil/Play, Submit, Run) — the
   student saying "yes, *this* configuration"
2. **Chat-flush notification from host** (`ui/notifications/chat-flush`
   JSON-RPC notification, no id) — the host signals before sending a
   user message so the tutor sees current state when answering

#### Wire shape

One consolidated `*.state-change` event per commit:

```json
{
  "kind": "boldkast.state-change",
  "changed": ["v0", "theta"],
  "state": { "v0": 25, "theta": 40, "g": 9.82 },
  "triggeredBy": "play"
}
```

`changed` is the set of keys the student touched since the last
commit. `state` carries the full current snapshot (cheap, even for
KineBot-sized artefacts). `triggeredBy` is `"play"` (or other
commit-class button) or `"chat-submit"`.

#### Artefact pattern

```js
// Module-scope: accumulates pre-commit changes.
const pendingChanges = {};
let v0 = 10, theta = 30, g = 9.82;

function flushPendingChanges(triggeredBy) {
  const changedKeys = Object.keys(pendingChanges);
  if (changedKeys.length === 0) return; // No-op when nothing pending.
  emit("boldkast.state-change", {
    changed: changedKeys,
    state: { v0, theta, g },
    triggeredBy,
  });
  for (const k of changedKeys) delete pendingChanges[k];
}

// Slider settle: writes locally, NO host emit.
document.getElementById("v0").addEventListener("input", (e) => {
  v0 = parseFloat(e.target.value);
  // ...recompute markers, render...
  pendingChanges.v0 = v0;
});

// Commit button: flush, then fire the commit-class event.
document.getElementById("play").addEventListener("click", () => {
  flushPendingChanges("play");          // ← first, so state precedes
  emit("boldkast.play");                //   the play event on the wire
});

// Inbound chat-flush handler — alongside the existing ping responder.
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.jsonrpc !== "2.0") return;
  if (d.method === "ui/notifications/chat-flush") {
    flushPendingChanges("chat-submit");
  }
});
```

#### Host pattern (chat page side)

`BoldkastSimFrame` (and any other workbench frame) exposes a
`sendChatFlush()` method via `useImperativeHandle`. The chat page
holds a ref into the frame and calls `sendChatFlush()` at the top of
`handleSend` — fire-and-forget, no await, optional-chained so missing
frame is a no-op:

```tsx
const boldkastFrameRef = useRef<BoldkastSimFrameHandle | null>(null);
async function handleSend() {
  // ...
  boldkastFrameRef.current?.sendChatFlush();
  await sendMessage(text, { ... });
}
```

#### Acceptance gates (cribbed from workbench-state-debounce.md Phase 2)

- Drag a slider continuously, never press Play, never send chat →
  **zero** host messages from the artefact
- Drag + press Play → **exactly one** `state-change` with
  `triggeredBy: "play"` precedes the commit-class event on the wire
- Drag + type chat + Send → **exactly one** `state-change` with
  `triggeredBy: "chat-submit"` precedes the user message

**Discrete commitment events** (Pause, Reset, marker reveal) keep
firing immediately — those are already commitments. Only continuous
controls (sliders, picker dropdowns where mid-selection isn't a
commit) go through `pendingChanges`. Discrete preset clicks that
*change* a continuous param (e.g. planet → g) still write to
`pendingChanges` because the player hasn't yet pressed Play to commit
the new gravity.

See [workbench-state-debounce.md](../../../docs/design/aipla/v1.0.0-pilot/workbench-state-debounce.md) §Phase 2 for the design rationale.

**Per-artefact label function.** Each sim has its own vocabulary. The
labels are the *only* thing each new artefact wrapper has to write
beyond the iframe markup. Keep them in the wrapper file alongside the
event-shape interface; do NOT push them into the hook (the hook stays
artefact-agnostic).

### 6. Commit + push

The Cloud Build trigger `aipla-mcp-sandbox-deploy` only fires when
files inside `infrastructure/mcp-sandbox/**` change, so the artefact
addition triggers a sandbox redeploy. The frontend is unaffected
unless step 5 also changed frontend files (in which case the root
trigger `aipla-dev-deploy` fires that too).

```bash
git add infrastructure/mcp-sandbox/artefacts/wave-superposition/
git commit -m "feat(artefact): wave-superposition v1 sim"
git push
```

Watch the build:
```bash
gcloud builds list --project=aipla-dev-2026 --region=europe-north1 \
  --filter='trigger_id:7bcc7e59-923e-4684-b9af-6c0f3103deac' --limit=3
```

### 7. Verify deployed

```bash
SANDBOX_URL=$(gcloud run services describe aipla-v01-sandbox \
  --project=aipla-dev-2026 --region=europe-north1 \
  --format='value(status.url)')
curl -s -o /dev/null -w '%{http_code}\n' \
  "$SANDBOX_URL/artefacts/wave-superposition/v1/index.html"
# expect 200
```

## Why a separate Cloud Run service (and not a sidecar)

ADR-013 mandates the iframe live on a **different origin** from the
host frontend. Sidecars share the ingress origin — so they'd defeat
the security model. The `aipla-v01-sandbox` service exists *because*
it's a separate origin. Don't try to fold it back into
`aipla-v01-frontend` to save a Cloud Run service; the dollars saved
are a rounding error and the security model is load-bearing.

Each new artefact, however, **does not** need its own Cloud Run
service — they all live as static files under
`/artefacts/<name>/v<version>/` on the single shared sandbox. Spinning
up a new Cloud Run per artefact is overkill.

## Operational notes

- **Cloud Run service name:** `aipla-v01-sandbox` (dev). test/prod will
  use the same name in their respective projects.
- **Cloud Build trigger:** `aipla-mcp-sandbox-deploy`. Fires on push to
  `dev` AND change inside `infrastructure/mcp-sandbox/**`.
- **Image registry path:** `europe-north1-docker.pkg.dev/aipla-dev-2026/cphu/aipla-v01-sandbox:dev`.
- **Logs:** `gs://aipla-dev-2026-aipla-v01-logs` (shared with the frontend build).
- **Frontend integration env var:** `NEXT_PUBLIC_MCP_SANDBOX_URL` — set in
  `frontend/.env.local` for LOCAL_MODE; threaded through the Dockerfile
  build-arg via `cloudbuild.yaml`'s `--build-arg NEXT_PUBLIC_MCP_SANDBOX_URL=${_MCP_SANDBOX_URL}`.

## Session resume and artefact state (v1 policy — deferred)

When a student rejoins using the same group code within 30 days (sprint
1.F), the chat history is restored from the prior session. However,
**artefact slider/variable state is NOT restored** in v1 — the artefact
boots at its programmatic defaults each time.

This was a deliberate scoping call: implementing a per-sim restore
contract (an `aipla:restore` postMessage notification) would require
touching each artefact's HTML every time the contract changes. With
multiple sims already in the pipeline (Boldkast, LED Planck, …), that
becomes per-sim whack-a-mole. Instead, restore is deferred until the
protocol is stable enough to make a single generic handler worth writing
in every artefact.

**What this means for artefact authors:** you do NOT need to handle
any restore notification in v1. The student will see the slider reset to
defaults; the chat window will show where they left off. That's the
expected v1 UX.

**What a future sprint will add:** a generic `ui/notifications/aipla:restore`
handler that artefacts opt into once the shape is frozen. The MCP App
state for the prior session is already snapshotted in
`POST /api/sessions/{id}/restore` → `workbenchState` — the plumbing is
ready, the artefact side is deferred.

## See also

- [`agent-protocols/SKILL.md`](../agent-protocols/SKILL.md) — protocol-level
  reference: A2UI vs MCP App vs AG-UI disambiguation, the MCP Apps SEP-1865
  spec, sandbox iframe contract details.
- [`docs/design/aipla/v0.1.0-jutland/boldkast-mcp-app.md`](../../../docs/design/aipla/v0.1.0-jutland/boldkast-mcp-app.md) —
  worked example: the first AIPLA artefact (in progress).
- [`scripts/bootstrap-aipla-dev.NOTES.md`](../../../scripts/bootstrap-aipla-dev.NOTES.md) —
  Decisions 9 + 10 (deploy + artefact pattern), Terraform recipe trail.
- ADR-013 in the scoping site (`~/Documents/clients/cph-uni/architecture.qmd`)
  — artefact safety + library-bypass path.
