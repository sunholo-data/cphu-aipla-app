# Boldkast MCP App — interactive projectile sim as an in-chat artefact

**Status**: Planned
**Priority**: P2 (Stretch) — v0.1 over-deliver, not on the Jutland critical path
**Estimated**: 1.5 days (0.75 sim authoring · 0.5 workspace-surface wiring · 0.25 demo polish + smoke)
**Scope**: Frontend + one static artefact + minor backend tool exposure
**Dependencies**: v0.1 working (✅ as of `20c84a0`). Soft dep on AR sign-off of the sim's pedagogical shape — defers to AR's existing GenAI projectile-motion trials.
**Created**: 2026-05-20
**Last Updated**: 2026-05-20

## Problem Statement

v0.1 ships a chat tutor for **Opgave 1 — Boldkast** (projectile motion, v₀ = 15 m/s @ 40°, g = 9.82 m/s²) that scaffolds students through sub-steps without giving the answer ([problem-set-hints SKILL.md](../../../../backend/skills/templates/problem-set-hints/SKILL.md)). The chat-only form factor works but leaves a clear over-deliver lever on the table for the Jutland visit:

- The Boldkast problem is fundamentally **spatial and dynamic** — a ball flying through the air, decomposed into x(t) and y(t). Pure text scaffolding asks the student to hold the geometry in their head while reasoning about the algebra. AR's existing GenAI trials (form factor referenced in [ADR-013](../_scoping-snapshot/architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html)) demonstrate the lift from a small interactive visualization next to the tutor.
- v1 ships the **full artefact-review pipeline** for *bot-generated* HTML ([SEQUENCE.md §1.11](SEQUENCE.md)). That's deliberately deferred; this doc carves out a v0.1-shaped slice that uses the **library-bypass path** ADR-013 already authorises: *hand-curated* artefacts skip the runtime review pipeline because they've been reviewed once at commit time.
- The buffer week (2026-05-20 → 2026-05-27) is now available. The chat path is stable, the deploy pipeline is green, branding + layout are demo-ready. Marginal effort to ship a single curated sim is small; the demo lift is large.

**Current State:**
- `MCPAppToolCallRouter` ([frontend/src/components/protocols/MCPAppToolCallRouter.tsx](../../../../frontend/src/components/protocols/MCPAppToolCallRouter.tsx)) is wired and exercised by [frontend/src/app/dev/mcp-apps/active/page.tsx](../../../../frontend/src/app/dev/mcp-apps/active/page.tsx).
- `mcp-sandbox` ([infrastructure/mcp-sandbox/](../../../../infrastructure/mcp-sandbox/)) is deployed at `https://mcp-sandbox-...lz.a.run.app` (AIPLA dev) — provides the sandboxed iframe origin per ADR-013's defence-in-depth.
- `mcp-ext-apps-map` is a working template for a single-tool MCP server we can shape ours after.
- No physics artefact exists yet. No `workspace` surface is mounted in the chat page (anon-group mode currently runs chat-only).

**Impact (if not built):**
- Jutland demo is text-only. Functional but undersells AIPLA's actual product direction — the v1 pitch *is* multi-surface + artefacts. Demoing only chat understates the platform.
- AR's iteration loop on artefact shape doesn't start until post-Jutland. Pulling it forward by a week buys real feedback before the mid-point review.

## Goals

**Primary Goal:** A student in chat with `problem-set-hints` can click a **"📐 Open Boldkast sim"** button in the welcome panel (or a chat-quick-action chip) and an interactive projectile-motion sim opens in a `workspace` surface to the right of the chat (collapsible on narrow screens). The sim:

1. Shows v₀, angle θ, and g as adjustable inputs (defaults locked to 15 m/s, 40°, 9.82).
2. Plays the trajectory on demand; pauses; shows current (x, y, v_x, v_y) at the cursor's t.
3. Has labelled axes, a height marker for `y_max`, a range marker for the landing point — **with the numerical values redacted to dashes** until the student toggles "Show value" *per marker individually*. The redaction is the pedagogical guardrail.
4. Loads from the sandbox origin via the existing `MCPAppToolCallRouter`, with the same iframe sandbox + CSP ADR-013 mandates.

**Success Metrics:**
- Student → sim time-to-render: **<800 ms** from button click to interactive (sim is static HTML; cold cache budget).
- Sim source is **≤ 200 KB total** (HTML + inline CSS + inline JS) — matches ADR-013's size limit for review-pipeline-eligible artefacts, even though we're on the library-bypass path.
- Sim **never displays** the final numerical answers (height-max, range, time-of-flight) without an explicit per-marker user toggle. Verified by a Playwright/Vitest snapshot that renders the sim, clicks "Play", and asserts the value labels read `—`.
- AR sign-off on pedagogical shape before 2026-05-26 (one day before demo).
- Demo smoke (`aipla smoke jutland --check-sim`) returns the artefact's expected SHA-256 from the static asset endpoint.

**Non-Goals (deferred, mostly to v1):**
- Bot *generation* of artefacts (full ADR-013 pipeline) — that's [SEQUENCE.md §1.11](SEQUENCE.md).
- Multiple sims (energy, friction, 2-body). v0.1 is *one* sim, the one the seeded problem asks about.
- Agent-driven sim invocation via MCP tool call. v0.1 uses a hardcoded button in the welcome panel — the SKILL.md `no A2UI tool use` guardrail stays intact ([commit 279ec93](../../../../backend/skills/templates/problem-set-hints/SKILL.md)).
- Saving sim state per group/session. Each open is fresh; the sim is stateless.
- Touch-gesture polish for phones. Desktop / tablet only for the Jutland demo (teachers' laptops + iPad in the room).
- Internationalisation of labels beyond Danish + English fallback already in the welcome panel.

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Static artefact, no server round-trip after first load; <800 ms target |
| 2 | EARNED TRUST | +1 | The redacted-value-with-toggle pattern is the pedagogical guardrail made tangible. Students *see* the platform respect the "no full answer" rule, not just experience it as the bot refusing |
| 3 | SKILLS, NOT FEATURES | 0 | The sim is a per-skill artefact, but v0.1 ships it as a hardcoded button rather than as a `skillMetadata.artefacts` config — that's a v1 cleanup. Honest neutral until v1 lifts artefacts into the skill schema |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model in this path — sim is static HTML/JS. Neutral, not negative |
| 5 | GRACEFUL DEGRADATION | +1 | If the sandbox origin is down, chat still works. The button shows a "Sim unavailable" toast and the chat continues. No cross-coupling to the chat agent path |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses the existing `MCPAppToolCallRouter` + sandbox iframe contract + A2UI `surfaceId: workspace` semantics from ADR-015. Zero new formats |
| 7 | API FIRST | 0 | The sim is a static asset, not an API. The button is a frontend UI element. Neutral — no surface to expose via CLI yet (the URL is fetchable but that's trivial) |
| 8 | OBSERVABLE BY DEFAULT | +1 | Sim mount fires an OTel span `boldkast.sim.open` keyed by `group_id` + `session_id` via the existing iframe → host → backend bridge. We learn whether students actually use it |
| 9 | SECURE BY CONSTRUCTION | +1 | Sandbox iframe per ADR-013 (`allow-scripts` only, no `allow-same-origin`, CSP locked). No external resource fetches in the sim. Separate origin from the host frame (already established for `mcp-sandbox`) |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | The sim itself is client-heavy by necessity (animation runs in the browser). The host/iframe split keeps the host thin, but the sim has business logic. Neutral |
| | **Net Score** | **+5** | Threshold ≥ +4 ✓ |

**Conflict Justifications:** None. No -1 scores. Three 0s are honest neutrals — Skills-not-features (the artefact isn't yet a skill-config field) will rise to +1 when v1 lifts artefacts into `SkillConfig.artefacts`.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| In-chat artefact embedding | [MCP Apps](https://modelcontextprotocol.io/) sandbox iframe pattern | Reuses `mcp-sandbox` origin + iframe contract; same as `mcp-ext-apps-map` |
| Surface composition | [A2UI `surfaceId`](https://a2ui.org/) ([ADR-015](../_scoping-snapshot/architecture.qmd#adr-015-unified-multi-surface-ui-ai-directs-the-layout)) | Sim mounts in `surfaceId: workspace`; chat is `surfaceId: chat` |
| Artefact safety | [ADR-013](../_scoping-snapshot/architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html) library-bypass path | Hand-curated artefact, reviewed at commit time + AR sign-off; runtime review pipeline deferred to v1 §1.11 |
| Iframe sandbox | HTML5 sandbox attribute + CSP | `sandbox="allow-scripts"`, no `allow-same-origin`; CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`. Identical to ADR-013's spec |
| Animation | Vanilla `requestAnimationFrame` | No 3rd-party libs in the sim — keeps size under 200 KB and removes supply-chain risk |
| Telemetry | OpenTelemetry span via the existing iframe → host `postMessage` → backend bridge | `boldkast.sim.open`, `boldkast.sim.play`, `boldkast.sim.show_value` (per-marker) |

**No custom formats invented.** The artefact-fetch URL (`{sandbox_origin}/artefacts/boldkast/v1/index.html`) is the only AIPLA-specific addition — same shape as `mcp-ext-apps-map`'s `/tools/show-map`.

## CLI Surface

Per [design-doc-creator skill 5b-bis](../../../../.claude/skills/design-doc-creator/SKILL.md), every developer-facing surface needs a CLI affordance.

| Command | Purpose | Position in tree |
|---|---|---|
| `aiplatform artefact list [--skill <name>]` | List bundled artefacts. v0.1 has one (`boldkast/v1`); v1 grows the library | new `aiplatform artefact` family |
| `aiplatform artefact open boldkast` | Open the local file:// URL of the artefact in the system browser. Lets AR iterate on the sim without spinning the full stack | new |
| `aiplatform smoke jutland --check-sim` | Extends the existing smoke command: HEAD the artefact endpoint, verify Content-Type + SHA-256 matches the committed manifest | extends [scripts/smoke-jutland.sh](../../../../scripts/smoke-jutland.sh) |

Estimate: **0.25 day** total for all three CLI hooks (one Click subcommand + one bash flag).

## Design

### Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser: aipla-v01-frontend-...lz.a.run.app                     │
│ ┌─────────────────────────┐    ┌──────────────────────────────┐ │
│ │  chat (surfaceId)       │    │  workspace (surfaceId)        │ │
│ │  ────────────────       │    │  ─────────────────────        │ │
│ │  WelcomePanel           │    │  <iframe src=                 │ │
│ │   ┌───────────────────┐ │    │    https://mcp-sandbox-...    │ │
│ │   │📐 Open Boldkast   │ │───▶│    /artefacts/boldkast/v1/    │ │
│ │   │   sim button       │ │    │    index.html                 │ │
│ │   └───────────────────┘ │    │    sandbox="allow-scripts"     │ │
│ │  ChatMessageList         │    │    csp="..."                   │ │
│ │   (existing)            │    │  >                             │ │
│ │                         │    │   Boldkast.html (200 KB)       │ │
│ │  ChatInput              │    │     - canvas trajectory        │ │
│ │   (existing)            │    │     - inputs (v0/θ/g)          │ │
│ │                         │    │     - markers w/ toggle        │ │
│ └─────────────────────────┘    └──────────────────────────────┘ │
│            ▲                              │                      │
│            │ postMessage("close")          │ postMessage         │
│            └──────────────────────────────┘  ("opened","played", │
│                                                "show_value:...") │
└─────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                  OTel spans → Cloud Trace (group_id, session_id)
```

### Frontend

**New files:**
- `frontend/src/components/chat/BoldkastSimButton.tsx` — the quick-action button that lives in `ChatMessageList`'s welcome-panel area. Visible only when `skillSlug === "problem-set-hints"`. Clicking it dispatches a `surfaceOpen` action to the SurfaceRegistry with `surfaceId: workspace` and a sim URL.
- `frontend/src/components/protocols/BoldkastSimFrame.tsx` — thin wrapper around `<iframe>` that:
  - Renders the iframe with the correct `sandbox` + `csp` attrs
  - Listens for `postMessage` events from the artefact and forwards them as OTel spans via the existing `useOtelClientSpan` hook
  - Exposes a "close" button in the workspace-surface header

**Modified files:**
- `frontend/src/app/chat/[...path]/page.tsx` — mount a `WorkspaceSurfaceRegion` when in anon-group mode AND `skillSlug === "problem-set-hints"`. Currently `WorkspaceSurfaceRegion` only mounts when `!activeTabId` (line 530) — extend the condition.
- `frontend/src/components/chat/ChatMessageList.tsx` — when `skillInitialMessage` renders and the skill is `problem-set-hints`, render `<BoldkastSimButton />` below it. Gated on a new prop `skillSlug` rather than skillId so the gate is human-readable.
- `frontend/src/hooks/useSkillMeta.ts` — already exposes `slug`; thread it through to `ChatMessageList`.
- `frontend/src/lib/branding.ts` — add `BRANDING.boldkast.simUrl` so the sandbox origin isn't hardcoded across files (env-overridable via `NEXT_PUBLIC_BOLDKAST_SIM_URL`).

**Workspace surface on narrow screens:** below `md` breakpoint, the workspace appears as a slide-up panel covering 70% of viewport height with a back-button to chat. Above `md`, side-by-side 50/50 split.

### The artefact itself

**Location:** `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` (versioned dir; future revisions land as `v2/`).

**Structure:**
```html
<!doctype html>
<meta charset="utf-8">
<title>Boldkast — interaktiv visualisering</title>
<style>/* ~5 KB inline */</style>
<body>
  <header>
    <h1>Boldkast</h1>
    <p>v₀ = 15 m/s · θ = 40° · g = 9.82 m/s²</p>
  </header>
  <main>
    <canvas id="trajectory" width="600" height="320"></canvas>
    <aside class="controls">
      <label>v₀ <input type="range" min="5" max="25" value="15"></label>
      <label>θ  <input type="range" min="10" max="80" value="40"></label>
      <button id="play">▶ Afspil</button>
      <button id="pause">⏸ Pause</button>
      <button id="reset">↺ Nulstil</button>
    </aside>
    <aside class="markers">
      <p>Max højde:    <span class="value">—</span> <button data-marker="ymax">Vis</button></p>
      <p>Rækkevidde:   <span class="value">—</span> <button data-marker="range">Vis</button></p>
      <p>Flyvetid:     <span class="value">—</span> <button data-marker="tof">Vis</button></p>
    </aside>
  </main>
  <script>/* ~30 KB inline — see below */</script>
</body>
```

**Sim JS (sketch, ~30 KB target):**
- Compute `x(t) = v₀·cos(θ)·t`, `y(t) = v₀·sin(θ)·t − ½·g·t²` once per frame.
- Track current `t` from a `requestAnimationFrame` loop; render canvas trajectory + current ball position.
- Marker values (`y_max`, `range`, `time-of-flight`) are computed but rendered as `—` until the per-marker "Vis" button is clicked. Clicking fires `postMessage({type:'show_value', marker:'ymax'})` to the host so we observe whether the pedagogical guardrail is being bypassed in practice.
- No external resources; no `fetch`; no DOM injection from URL params (CSP would block scripts anyway).

**Why hand-coded HTML, not a React/Vue/D3 component:**
- ADR-013 sets a hard 200 KB ceiling. React + d3 + bundler runtime overshoots that by ~5×.
- Vanilla keeps the sim a *single committed file* that AR can diff and approve. No build step.
- The sim has one screen and ~50 lines of logic; React is overkill.
- Future sims (v1 library) follow the same pattern; this also establishes the convention.

### Backend

**Minimal changes** — the sim is a static artefact served from the existing sandbox; the agent doesn't need a new tool.

- `infrastructure/mcp-sandbox/serve.ts` — register the `/artefacts/` subtree as a static-file route. Already serves `/sandbox.html`; this is one additional path glob.
- `infrastructure/mcp-sandbox/Dockerfile` — `COPY artefacts/ ./artefacts/`.
- Backend OTel: no new spans needed; the iframe → host `postMessage` bridge already exists and forwards to `useOtelClientSpan`, which the existing `/api/proxy/api/sessions/{id}/iframe-context` route persists.

**Manifest for smoke-check:**
- `infrastructure/mcp-sandbox/artefacts/MANIFEST.json` — `{ "boldkast/v1/index.html": "<sha256>" }`. Generated by a `make manifest` target; checked into git; smoke command HEADs the URL and compares.

### Skill prompt update

`problem-set-hints/SKILL.md` gets one new bullet under the "Pedagogical guardrails" block:

```
- **If the student opens the Boldkast simulation, do NOT name the
  hidden marker values (y_max, range, time-of-flight) in your reply
  even if asked directly.** The sim's "Vis" buttons exist so the
  student commits to one calculation at a time. If you spoil them
  via chat you defeat the visualisation's whole point.
```

This is the only model-prompt change. No A2UI tool is added — the SKILL.md no-tools rule remains intact.

## API Changes

| Surface | Change | Auth |
|---|---|---|
| `GET {mcp-sandbox}/artefacts/boldkast/v1/index.html` | New static path | Public (sandbox origin already public; CSP + sandbox iframe + no PII transit make this safe) |
| `GET {mcp-sandbox}/artefacts/MANIFEST.json` | New static path | Public (used by smoke) |
| `POST /api/proxy/api/sessions/{id}/iframe-context` | Existing route; no schema change. New event types: `boldkast.sim.open`, `boldkast.sim.play`, `boldkast.sim.show_value` (these are just opaque strings to the route) | Bearer token (anon-group JWT) |

No backend route additions.

## Migration / Rollout

**v0.1 rollout (Jutland demo):**
- Build the artefact + ship in `dev` env. No flag — the button only appears for `problem-set-hints`, which is the only skill anon-group students see.
- AR review on 2026-05-25 (Mon). Sign-off blocks merge to `dev`.
- Smoke + deploy on 2026-05-26 (Tue) — one day before demo, leaving Wed for catch-fixes.

**Rollback:**
- Set `NEXT_PUBLIC_BOLDKAST_SIM_URL=""` in the frontend container env to hide the button. Chat continues to work. No data corruption surface — sim is stateless.

**v1 forward path:**
- The library grows: `artefacts/<topic>/v1/index.html`, one per problem set.
- `SkillConfig` grows an `artefacts: [...]` field; `BoldkastSimButton` becomes a generic `ArtefactButton` rendering whichever artefacts the skill declares.
- Bot-generated artefacts land via [SEQUENCE.md §1.11](SEQUENCE.md)'s review pipeline, **distinct path** from this library-bypass route.

## Testing Strategy

**Frontend (Vitest + Playwright):**
- `BoldkastSimButton.test.tsx` — renders only when `skillSlug === "problem-set-hints"`; dispatches surface-open action on click.
- `BoldkastSimFrame.test.tsx` — verifies the iframe is rendered with `sandbox="allow-scripts"` and a CSP attribute; verifies it does NOT have `allow-same-origin`.
- `boldkast-sim.spec.ts` (Playwright) — opens the chat, clicks the button, asserts the iframe is mounted, drags the v₀ slider, clicks "Play", asserts that marker values read `—` until "Vis" is clicked per-marker.

**Artefact-internal:**
- A tiny self-test in `index.html` runs on `?test=1` query: computes y_max for v₀=15, θ=40, g=9.82 and asserts it equals 4.74 m within tolerance. Run via `aiplatform artefact open boldkast --test`.

**Smoke:**
- `aiplatform smoke jutland --check-sim` — HEAD on artefact URL, assert 200 + Content-Type `text/html` + SHA-256 match.

**Pedagogical-guardrail eval (manual, AR + M):**
- Open chat → click sim → play sim → ask the tutor "hvad er max højde?". Assert the tutor refuses, NOT names the y_max value, AND suggests using the sim's "Vis" button. Captured as a screenshot in the design-doc implementation report.

## Success Criteria

- [ ] Sim renders at `<800 ms` from button click (measured in Chrome devtools Performance trace)
- [ ] Sim file size ≤ 200 KB (CI step: `wc -c index.html`)
- [ ] Sim never auto-displays `y_max`, `range`, `time-of-flight` values without user toggle (Playwright assertion)
- [ ] AR sign-off captured before 2026-05-26
- [ ] `aiplatform smoke jutland --check-sim` passes on `dev` deployment
- [ ] Tutor prompt update lands and tutor refuses to spoil marker values when asked directly (manual eval)
- [ ] Workspace surface degrades to chat-only when `NEXT_PUBLIC_BOLDKAST_SIM_URL` is unset (rollback path verified)
- [ ] OTel spans for `boldkast.sim.*` events visible in Cloud Trace, keyed by `group_id`

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Iframe CSP blocks the inline scripts unexpectedly | Med | Test against `mcp-sandbox`'s existing CSP early (day 1); the existing `ext-apps-map` precedent suggests it works |
| AR's pedagogical critique requires re-shape | Med | Reach out to AR on 2026-05-21 (day 2) with a static screenshot; ship review-feedback Mon |
| Mobile/tablet layout breaks the side-by-side split | Med | Below-md slide-up panel is the fallback; Jutland room has laptops + iPad on desks, not phones |
| 200 KB ceiling overshot | Low | Vanilla JS + no images = ~15-30 KB realistic. Headroom is large |
| Sandbox iframe origin not on the EU region | Low | Already verified — `mcp-sandbox` runs in `aipla-dev-2026` europe-north1 |

## Related Documents

- [jutland-demo.md](jutland-demo.md) — v0.1 design doc
- [SEQUENCE.md](SEQUENCE.md) — build order; §1.11 is the v1 review-pipeline doc this groundwork-shapes
- [group-tooling.md](group-tooling.md) — companion v0.1 over-deliver track
- [ADR-013](../_scoping-snapshot/architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html) — artefact safety; library-bypass path
- [ADR-015](../_scoping-snapshot/architecture.qmd#adr-015-unified-multi-surface-ui-ai-directs-the-layout) — multi-surface UI; `workspace` surface
- [local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — the `aiplatform` CLI affordance pattern (template doc — applies unchanged)
- [problem-set-hints/SKILL.md](../../../../backend/skills/templates/problem-set-hints/SKILL.md) — the chat tutor this sim complements
- AR's GenAI projectile trials — referenced by ADR-013; private to scoping site (`notes/2026-05-18-aswin-trials-analysis.md`)

## Implementation Plan

| Step | Work | Est | Owner |
|---|---|---|---|
| 1 | Write the artefact: `infrastructure/mcp-sandbox/artefacts/boldkast/v1/index.html` (canvas + controls + markers + redaction toggles + self-test) | 0.5d | M |
| 2 | Wire `BoldkastSimButton` into the welcome panel; gate on `skillSlug === "problem-set-hints"` | 0.25d | M |
| 3 | Mount `WorkspaceSurfaceRegion` for anon-group + problem-set-hints; iframe sandbox + CSP wiring | 0.25d | M |
| 4 | Tutor prompt update (one new guardrail bullet); regression check on the no-tools rule | 0.1d | M (text only) |
| 5 | OTel `boldkast.sim.*` spans via existing iframe → host bridge | 0.1d | M |
| 6 | CLI: `aiplatform artefact list/open` + `--check-sim` flag on smoke | 0.25d | M |
| 7 | Tests: BoldkastSimButton/Frame Vitest + boldkast-sim Playwright | 0.25d | M |
| 8 | AR review + iteration | 0.5d wall-clock (0.1d active) | AR sign-off, M iterates |
| 9 | Smoke on dev deployment + demo dress-rehearsal | 0.15d | M + JB |

**Total: ~1.5 days active work**, fits inside the 5-day buffer with 3 days of slack.
