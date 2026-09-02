# LED Planck virtual lab — second physics skill (procedural-lab class)

**Status**: Ready for sprint planning (2026-05-27 review)
**Priority**: P1 (v1 critical-path; second of three physics skills, first new lesson since v0.1)
**Estimated**: ~2 days
**Scope**: Fullstack — backend (skill template + tools opt-out config + cover image), frontend (`LedPlanckLabFrame` host wrapper + lesson cover), artefact (postMessage wiring on AR's existing HTML, commit-on-submit per 1.E-Ph2)
**Dependencies**: v0.1 shipped; [implemented/mcp-app-iframe-spec-compliance.md](implemented/mcp-app-iframe-spec-compliance.md) merged (sandbox-proxy + `StaticArtefactFrame` ready); [lesson-picker.md](lesson-picker.md) shipped (so students can find it); [workbench-state-debounce.md](workbench-state-debounce.md) §Phase 2 (commit-on-submit convention this skill adopts from day one); ADR-013 pipeline scan; [boldkast-mcp-app.md](../v0.1.0-jutland/boldkast-mcp-app.md) as reference implementation
**Pedagogical source-of-truth:** [`led-planck-skill-brief.md`](../../_scoping-snapshot/prototypes/led-planck-skill-brief.md) in the scoping site (M's machine: `~/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/led-planck-skill-brief.md`) — full Danish Socratic tutor prompt, skill config YAML, postMessage event shapes, deploy checklist, accuracy notes. **The brief is the design for the lesson's pedagogy and tutor behaviour; this doc is the execution layer that turns the brief into shippable code in `cphu-aipla-app`.**
**Lab source HTML:** `/Users/voightkampff/dev/sunholo-data/aipla/assets/examples/led-planck-virtual-lab.html` on this machine (40 KB, self-contained, zero external fetches). Forks see M's machine at `~/Documents/clients/cph-uni/sources/leds_planck_virtual_lab.html` — translate per reference-scoping-site-path — `reference_scoping_site_path.md` (agent-memory note, not a project file) memory.
**Created**: 2026-05-24
**Last Updated**: 2026-05-27

## Problem Statement

v0.1 ships one student-facing physics skill (`problem-set-hints` / Boldkast). Per [strands.qmd](https://aipla.ku.dk/project/workstreams) line 144, v1 commits to "two student-facing chat skills" — the second is the LED Planck virtual lab tutor. The pedagogical work is done (AR built the lab HTML; the brief documents the tutor prompt + lesson structure). What's missing is the **technical execution**:

- Where does the artefact HTML live in `cphu-aipla-app`?
- Which existing patterns does it follow (Boldkast / StaticArtefactFrame / mcp-app-artefact skill)?
- How does the Danish tutor skill template land — file path, `tool_configs`, A2UI opt-out, default-tools opt-out?
- What's the test coverage shape (Boldkast set the bar at 14/14 + spec-compliance handshake tests; LED Planck should match)?
- How does the iframe-context state propagate through to the agent's prompt (the pattern shipped in PEDCTX + the spec-compliance migration)?

The brief answers the **pedagogical** "what" (Socratic prompt, three teaching phases, accuracy notes against H_TRUE = 6.62607015e-34). It doesn't answer the **technical** "where in this repo" — that's this doc.

**Current State:**
- AR's lab HTML lives at `~/Documents/clients/cph-uni/sources/leds_planck_virtual_lab.html` on M's machine; on this machine it is at `/Users/voightkampff/dev/sunholo-data/aipla/assets/examples/led-planck-virtual-lab.html` (40 KB on disk, self-contained, zero external fetches)
- `cphu-aipla-app/infrastructure/mcp-sandbox/artefacts/` has three entries: `_template`, `boldkast`, `test-artefact`. Boldkast is the canonical reference for the spec-compliant path (sprint MCPAPP-SPEC shipped 2026-05-21).
- `backend/skills/templates/` has `problem-set-hints/SKILL.md` (Danish, paired with Boldkast). LED Planck would be a sibling.
- No `LedPlanckLabFrame` host wrapper exists; the Boldkast pattern (`BoldkastSimFrame` + `StaticArtefactFrame`) is the template.

**Impact (if not built):**
- v1.0.0-pilot ships with one student skill — under-delivers on the strands.qmd commitment of two.
- AR's existing lab artefact stays trapped as a standalone HTML file in the scoping-site assets. The platform's whole point is to host artefacts like this; not landing it leaves the platform's value-add unproven.
- The mcp-app-artefact skill's recipe is never exercised against a second artefact, so the spec-compliant onboarding pattern stays at N=1. We need N=2 before [1.D KineBot](kinebot-migration.md) makes the migration runbook canonical.
- Procedural-virtual-lab as a form factor (distinct from Boldkast's phenomenon-sim) never gets tested. We don't learn whether the StaticArtefactFrame abstraction handles a non-sim artefact class until we ship one.

## Goals

**Primary Goal:** A student who joins via the lesson picker ([1.B](lesson-picker.md)) sees "LED og Plancks konstant" alongside "Boldkast"; selecting it routes to `/chat/<led-planck-tutor-slug>`; the workspace mounts the LED Planck virtual lab via the spec-compliant `StaticArtefactFrame`; postMessage events from the lab (step-change, measurement, component-placed, led-polarity-error) flow into `mcp_app_context.led-planck.state` and reach the agent's next prompt via the existing InstructionProvider injection.

**Success Metrics:**
- LED Planck artefact loads at `${SANDBOX_ORIGIN}/artefacts/led-planck/v1/index.html` and renders in `<StaticArtefactFrame>` without console errors.
- All four event shapes from the brief fire correctly:
  - `step-change` (step 1 → 2 → 3 → 4)
  - `measurement` (per-LED U₀ + λ + computed h)
  - `component-placed` (with `correct: true|false`)
  - `led-polarity-error` (specific failure mode)
- Agent reply references the student's current step + most recent measurement by name within 1 turn of the event firing — qualitative AR sign-off check.
- `aiplatform sessions iframe-context <session_id>` dumps the `mcp_app_context.led-planck.state` payload showing the same shape as `mcp_app_context.boldkast.state` (proves the spec-compliant path is form-factor-agnostic).
- ADR-013 pipeline scan passes: no `fetch(`, no `XMLHttpRequest`, no external `<script src>`, total artefact size < 200 KB.
- All existing AIPLA tests still pass (`make test-fast` + `npm run test:run`); LED Planck-specific tests add 8–10 vitest cases for the host wrapper + 2 sandbox-side tests for the artefact serving.
- Danish tutor prompt (verbatim from the brief, ~60 lines) loads into Firestore via `platform_seed.py` without char-cap issues (10K limit per feedback-pre-push-ci-parity (`feedback_pre_push_ci_parity.md` — agent-memory note, on M's machine) memory).

**Non-Goals:**
- Generating the lab artefact via AI (`physics-lab-builder` skill — Year-2 per strands.qmd).
- Multi-language UI for the lab. The lab's labels stay Danish (matching the tutor prompt). v1 doesn't ship an English version.
- Pre-generated quiz bank for the lab. The brief mentions adaptive quiz for KineBot (1.D); LED Planck is procedure-driven, not quiz-driven.
- Accessibility audit pass. The brief flags "keyboard nav through drag-and-drop" as a stretch goal; v1 ships visually but doesn't add a11y test coverage.
- Per-lab budget surfacing. Lab-level analytics are 1.12 work.
- Cross-session persistence of step progress. The lab tracks where the student is *within* a session (via the workspace) — reloading the page restarts the lab. Resume-on-reload is a v2 nice-to-have.

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Static HTML artefact, same fast-load profile as Boldkast (<800ms from button click to interactive per the boldkast-mcp-app success metric, which this inherits) |
| 2 | EARNED TRUST | +1 | The Socratic prompt's "never reveal the formula directly" rule is enforced at the prompt level (see brief lines 158–164). Combined with the lab's per-LED measurements never collapsing to "here's h" without student input, the trust-building "earn the answer" pattern is intact. Same gate-pattern as Boldkast's Vis-button design |
| 3 | SKILLS, NOT FEATURES | +1 | Lands as a new skill in `backend/skills/templates/led-planck-tutor/`. Paired with a workspace artefact. Same shape as `problem-set-hints` — the skills-as-the-unit-of-work pattern keeps holding |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Same model router default as Boldkast (gemini-3.5-flash via Vertex global endpoint). No skill-specific model selection in v1 |
| 5 | GRACEFUL DEGRADATION | +1 | If iframe-context push fails the lab still works locally; if the lab fails to load the chat surface remains useful (student can still ask conceptual questions); if the Danish tutor falls back the InstructionProvider still injects state. Three independent failure modes, each handled |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses MCP Apps spec via `StaticArtefactFrame` (the spec-compliant path shipped 2026-05-21 in MCPAPP-SPEC). Same JSON-RPC envelope as Boldkast: `ui/update-model-context` carrying `structuredContent.kind`. **Zero new wire formats** — the brief's postMessage shapes get translated into the spec envelope at the artefact-side `emit()` helper (same pattern as Boldkast post-M3 of the spec-compliance sprint) |
| 7 | API FIRST | 0 | No new API. The skill loads via the existing `/api/skills` filter; the artefact mounts via the existing `StaticArtefactFrame`; iframe-context POSTs land at the existing endpoint. Net new API surface = zero |
| 8 | OBSERVABLE BY DEFAULT | +1 | OTel spans from `iframe-context` writes already carry `server=led-planck`. Per-step transitions are visible in BigQuery (1.2) — researcher can ask "of N students who reach step 2, how many measure ≥3 LEDs?" without any custom instrumentation |
| 9 | SECURE BY CONSTRUCTION | +1 | ADR-013 pipeline scan; sandbox-proxy isolation (origin-based auth via the spec-compliant path); zero external fetches in the artefact; same audited primitives as Boldkast |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Host wrapper (~30 LOC over `<StaticArtefactFrame>`) is the entire LED Planck-specific client surface. All event semantics live in either the artefact JS (per the brief) or the agent's prompt (the Danish system prompt) — the platform glue stays minimal |
| | **Net Score** | **+8** | Threshold >= +4 OK |

**Conflict Justifications:** None.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Iframe ↔ host wire | MCP Apps spec JSON-RPC over postMessage via the sandbox-proxy | Uses `<StaticArtefactFrame>` + the spec's `ui/update-model-context` notification with `structuredContent.kind` carrying the brief's event vocabulary (`step-change`, `measurement`, etc.). Zero deviation |
| Host-side auth | `e.origin === sandboxOrigin` (spec-canonical for the sandbox-proxy pattern) | Inherited from `StaticArtefactFrame`; no per-artefact auth code |
| Skill template format | Agent Skills spec (`SKILL.md` with frontmatter + body instructions) | Same shape as `problem-set-hints/SKILL.md`; `manage-class` and the other v1 teacher skills will follow the same |
| Agent prompt injection | Existing `wrap_with_iframe_context` InstructionProvider | Reads `mcp_app_context.led-planck.state` from session state and injects the block per the post-2026-05-21 prompt revision (positive instruction to reference values, not just defensive framing) |
| Artefact CSP | Existing `/artefacts/*` ADR-013 CSP (`default-src 'none'`, script-src + style-src `'unsafe-inline'` only) | Served unchanged via `infrastructure/mcp-sandbox/serve.ts`. Lab HTML is inline-only; no external resources |
| Skill access | Existing 5-type `AccessControl` model — defaults to `public` for v1 platform-owned skills; will accept `tagged` once [1.A teacher-permission-model](teacher-permission-model.md) lands | Same as `problem-set-hints` |

**No new protocols, no new wire formats, no new artefact-class abstraction.** This is "second artefact through the proven pipeline."

## CLI Surface

None new — the existing CLI surface covers what's needed for an additional skill:
- `aiplatform skills list` lists the LED Planck skill once seeded
- `aiplatform sessions iframe-context <id>` dumps the `mcp_app_context.led-planck.state` payload for debugging
- `aiplatform smoke jutland` (or its v1 successor) can be extended with `--check-led-planck` flag if useful for pre-deploy verification

**Backlink:** [mcp-app-artefact skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — the canonical AIPLA recipe for adding a new artefact through the spec-compliant path.

## Design

### Architecture overview

```
Student (post-lesson-picker)
   ↓ clicks "LED og Plancks konstant" card
   ↓
/chat/@aipla-platform/led-planck-tutor?session=<id>
   ↓
ChatShell mounts:
   ├── ChatMessageList (left)
   │     └── led-planck-tutor agent stream
   │           └── prompt injected with mcp_app_context.led-planck.state
   └── WorkspaceShell (right)
         └── <LedPlanckLabFrame sessionId={sessionId}>
               └── <StaticArtefactFrame
                       sandboxOrigin={SANDBOX_ORIGIN}
                       artefactPath="led-planck/v1"
                       onUpdateModelContext={routeEventToSnapshot}
                   />
                     └── outer iframe @ ${SANDBOX_ORIGIN}/sandbox.html
                         (allow-scripts allow-same-origin — proxy layer)
                         └── inner iframe (artefact HTML, document.written)
                               └── lab UI: step-circuit → step-part1 → step-part2 → step-report
                                     └── emit('step-change' | 'measurement' | …)
                                           → JSON-RPC ui/update-model-context
                                           → proxy → host
                                           → StaticArtefactFrame.onUpdateModelContext
                                           → LedPlanckLabFrame snapshot accumulator
                                           → POST /api/sessions/{id}/iframe-context
                                           → mcp_app_context.led-planck.state in ADK session
                                           → agent's next turn reads it via InstructionProvider
```

The architecture is **structurally identical to Boldkast** — only the artefact JS, the event vocabulary, the snapshot shape, and the Danish tutor prompt differ. Everything else is the spec-compliant path proven in MCPAPP-SPEC.

### Commit-on-submit convention (post-1.E-Ph2, 2026-05-26)

LED Planck adopts the [workbench-state-debounce.md](workbench-state-debounce.md) §Phase 2 pattern from the start — Boldkast retrofitted it, this skill ships correct on day one. Two distinct event classes:

- **Commitment events** (fire immediately): `step-change`, `measurement` (the student explicitly recorded a U₀), `component-placed`, `led-polarity-error`. These are the student's deliberate acts; they belong in `mcp_app_context` immediately.
- **Pre-commit exploration** (buffer locally, flush on commit signal): the voltage-sweep slider in step 2 fires continuous `input` events as the student drags. Per Phase 2, the slider value writes to a local `pendingChanges` map only; nothing reaches the host until the student presses "Recordtærskelspænding" (commit-class button) OR the host signals `ui/notifications/chat-flush` before a user message. The flush emits one `state-change` event with `triggeredBy: "record" | "chat-submit"` and the final voltage. Mirrors Boldkast's Afspil flush.

The mcp-app-artefact skill convention covers the pattern + code snippets — the implementer copies the Boldkast helper, just substitutes the LED-Planck-specific commit buttons.

### Lesson cover image

Per the 1.B follow-up, every lesson gets a cover image rendered on `/lessons` cards + the teacher's class-detail catalogue. Create `frontend/public/lesson-images/led-planck-tutor.svg` (~16:9 ratio, 480×270 viewBox to match the existing pair) showing the breadboard / LED / spectrometer motif. Reference it in the SKILL.md frontmatter:

```yaml
---
name: led-planck-tutor
displayName: LED og Plancks konstant
avatar: /lesson-images/led-planck-tutor.svg
description: >
  Dansk stx fysik-A virtuelt laboratorium…
---
```

### Snapshot shape

What gets POSTed to `iframe-context` and ends up in `mcp_app_context.led-planck.state`:

```typescript
interface LedPlanckSnapshot {
  /** Most recent event the lab emitted */
  lastEvent: string;
  /** Current step (1-4) the student is on */
  currentStep: 1 | 2 | 3 | 4;
  /** Step name (more readable for the model) */
  currentStepName: "circuit" | "part1" | "part2" | "report";
  /** Cumulative measurements: one entry per LED the student has recorded */
  measurements: Array<{
    led: "red" | "orange" | "yellow" | "green" | "blue" | "infrared";
    u0: number;        // volts, 2 d.p.
    lambda: number;    // nm
    h_computed: number;// J·s
  }>;
  /** Cumulative circuit components placed correctly (excludes wrong placements) */
  componentsPlaced: string[];
  /** Latest "LED placed backwards" event timestamp, if any */
  lastPolarityError: number | null;
}
```

The agent's prompt sees this block via `wrap_with_iframe_context` and can scaffold accordingly: *"Du har målt y_max for den blå og grønne LED. Hvad sker der med U₀ når bølgelængden bliver kortere?"* (when measurements covers blue + green; never named individually without student input).

### Files to create

| File | Purpose | LOC est. |
|---|---|---|
| `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` | The lab HTML, postMessage-wired per the brief (steps 2–4) + Phase-2 commit-on-submit pattern on the step-2 voltage slider | ~1900 + ~60 for postMessage + pendingChanges helpers |
| `frontend/src/components/workspace/LedPlanckLabFrame.tsx` | Host wrapper — thin like Boldkast post-refactor. Maps lab events to the snapshot + dispatches `useHumanToolEvents` cards + exposes `sendChatFlush()` via `forwardRef` (Phase-2 contract) | ~290 |
| `frontend/src/components/workspace/__tests__/LedPlanckLabFrame.test.tsx` | 8–10 vitest cases mirroring `BoldkastSimFrame.test.tsx`: event routing, snapshot accumulation, origin auth, card dispatch on measurement, `sendChatFlush` ref method | ~220 |
| `backend/skills/templates/led-planck-tutor/SKILL.md` | Danish tutor system prompt (verbatim from the brief lines 122–183) + frontmatter (displayName, **avatar: /lesson-images/led-planck-tutor.svg**, initialMessage, tool_configs.defaults opt-out) | ~80 lines (mostly prompt) |
| `frontend/public/lesson-images/led-planck-tutor.svg` | Lesson cover image (~480×270 viewBox, breadboard/LED motif, terse style matching the existing pair). Renders on `/lessons` cards + teacher class-detail | new |
| `frontend/src/app/chat/[...path]/page.tsx` | Add gate: when `skillSlug === "led-planck-tutor"`, mount `<LedPlanckLabFrame ref={labFrameRef}>` in workspace; thread `labFrameRef.current?.sendChatFlush()` into the existing chat-submit flush call (parallel to existing Boldkast gate) | +20 LOC delta |

### Files NOT to create

- A new `StaticArtefactFrame` variant. LED Planck reuses the existing one.
- New backend endpoints. The skill template registers via `platform_seed.py`; the workspace events land at the existing `/api/sessions/{id}/iframe-context`.
- New CLI commands. `aiplatform sessions iframe-context` + `aiplatform smoke` handle debugging.
- New CSP profile in `serve.ts`. The existing artefact CSP applies unchanged.

### Card labels (Danish, per project convention)

`useHumanToolEvents` dispatches in `LedPlanckLabFrame` mirror Boldkast's Danish-first labels:

| Event | Card label |
|---|---|
| `step-change` (1→2) | `Begyndte I-U-måling` |
| `step-change` (2→3) | `Begyndte spektroskopi` |
| `step-change` (3→4) | `Åbnede rapport` |
| `measurement` | `Målte U₀ for <farve> LED` (where farve = the Danish color name from the brief's LED-button text) |
| `component-placed` (correct) | `Placerede <komponent>` |
| `component-placed` (incorrect) | (no card — silent — student needs to figure out why it didn't work; card would short-circuit pedagogy) |
| `led-polarity-error` | `Forsøgte LED med omvendt polaritet` |

The "no card on incorrect placement" choice mirrors Boldkast's "no card on un-reveal" decision: cards surface what the student wants the agent to know; not what they want to hide.

## API Changes

**None.** All endpoints already exist:
- `GET /api/skills` (lesson picker uses this)
- `POST /api/sessions/{id}/iframe-context` (workspace events land here)
- `POST /api/sessions/{id}/bootstrap` (frontend fires for new sessions)
- `POST /api/skill/{id}/stream` (chat invocation)
- `POST /api/admin/seed-platform-skills` (CI seeds the new skill template at deploy)

## Migration

- **No data migration.** New skill template seeds into Firestore via `platform_seed.py` on next deploy. Pre-existing sessions in v0.1 continue to work; they just don't see the new lesson until they refresh.
- **No frontend feature flag.** The lesson picker (1.B) lists whatever skills the user can access — LED Planck appears for users whose access policy permits it (defaults to `public` in v1, will be class-tagged after 1.A).
- **Rollback:** revert the commits. If the lab artefact has issues post-deploy, removing the skill template + restarting platform-seed un-registers it; previously-bound sessions get "skill not found" but the chat path errors gracefully.

## Testing Strategy

Following the feedback-self-testable-loops (`feedback_self_testable_loops.md` — agent-memory note, on M's machine) principle — write tests Claude can run without M clicking around.

**Frontend (vitest):**

- `frontend/src/components/workspace/__tests__/LedPlanckLabFrame.test.tsx` (new, ~200 LOC):
  - mounts with the right sandboxOrigin + artefactPath
  - routes `ui/update-model-context` with `kind: "step-change"` → snapshot.currentStep updates
  - routes `kind: "measurement"` → measurements array appends (deduped by LED color)
  - routes `kind: "component-placed", correct: true` → componentsPlaced array appends + card dispatched
  - routes `kind: "component-placed", correct: false` → no card dispatched (intentional silence)
  - routes `kind: "led-polarity-error"` → lastPolarityError timestamp set + card dispatched
  - rejects events from wrong origin (inherited from StaticArtefactFrame; smoke-test only)
  - card labels are Danish per the table above
- Existing `BoldkastSimFrame.test.tsx`: unchanged.

**Backend (pytest):**

- `backend/tests/unit/test_led_planck_skill_template.py` (new):
  - SKILL.md loads cleanly via `_parse_template` (no >10K char issue)
  - Instructions contain the three Danish teaching phases marker
  - `tool_configs.defaults` opts out of artefacts + memory (chat-only flow, no per-student doc context)
  - `tool_configs.mcp.allow_context_writes` includes `"led-planck"` (so the iframe-context POST passes the gate)
- Existing `tests/api_tests/test_workspace_observability.py`: extended with one case — POST iframe-context for `serverId: "led-planck"` with the snapshot shape from the brief, assert the rendered InstructionProvider block contains the Danish step name + measurement summary.

**Sandbox (vitest):**

- `infrastructure/mcp-sandbox/__tests__/serve.test.ts`: extended — `GET /artefacts/led-planck/v1/index.html` returns 200 with the ADR-013 CSP; size < 200 KB.

**ADR-013 pipeline scan (manual, blocking):**

```bash
# From repo root, before the artefact ships:
grep -nE "fetch\(|XMLHttpRequest|new WebSocket|<script src" \
  infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html
# Expected: no matches (per the brief — the lab is self-contained)

wc -c infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html
# Expected: < 200000
```

**Smoke (manual end-to-end, last):** open chat with led-planck-tutor in LOCAL_MODE, drag equipment in step 1, sweep voltage in step 2, measure 3+ LEDs in step 3, ask the agent "kan du hjælpe mig forstå hvad jeg har målt?" — agent should reference at least one measured LED color + threshold voltage by name.

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | Copy lab HTML to artefact tree | `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` (copy from `/Users/voightkampff/dev/sunholo-data/aipla/assets/examples/led-planck-virtual-lab.html` — M's machine: `~/Documents/clients/cph-uni/sources/leds_planck_virtual_lab.html`) | 0.05 d |
| 2 | Wire postMessage events per brief steps 2–4 | Same file — wrap `goStep()`, hook measurement recordings, wire equipment-placement events | 0.3 d |
| 3 | Add JSON-RPC envelope per spec (mirror Boldkast M3) | Same file — `rpcNotify("ui/update-model-context", { structuredContent: { kind, ...payload } })`; `ui/initialize` handshake on load | 0.15 d |
| 4 | Phase-2 commit-on-submit pattern on the step-2 voltage slider | Same file — `pendingChanges` map + `flushPendingChanges("record" / "chat-submit")` mirroring Boldkast Afspil; chat-flush message listener | 0.15 d |
| 5 | ADR-013 pipeline scan + size check | (no edits) | 0.05 d |
| 6 | `LedPlanckLabFrame` component (incl. `sendChatFlush` ref) | `frontend/src/components/workspace/LedPlanckLabFrame.tsx` | 0.45 d |
| 7 | Vitest suite for the host wrapper | `frontend/src/components/workspace/__tests__/LedPlanckLabFrame.test.tsx` | 0.3 d |
| 8 | Mount in chat page workspace + wire chat-submit flush | `frontend/src/app/chat/[...path]/page.tsx` (one gate parallel to Boldkast) | 0.15 d |
| 9 | Skill template — Danish prompt + frontmatter + avatar | `backend/skills/templates/led-planck-tutor/SKILL.md` | 0.2 d |
| 10 | Cover image | `frontend/public/lesson-images/led-planck-tutor.svg` | 0.05 d |
| 11 | Backend test for the template | `backend/tests/unit/test_led_planck_skill_template.py` | 0.15 d |
| 12 | Workspace-observability test extension | `backend/tests/api_tests/test_workspace_observability.py` (+1 case) | 0.1 d |
| 13 | Manual + AR sign-off (Danish prompt review) | (no edits) | 0.2 d |
| | **Total** | | **~2.0 d** |

## Success Criteria

- [ ] `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` serves at 200 with ADR-013 CSP; total size < 200 KB.
- [ ] ADR-013 pipeline scan returns zero matches for forbidden patterns.
- [ ] `LedPlanckLabFrame` mounts, completes `ui/initialize` handshake with the sandbox proxy, and routes all four event types to the snapshot accumulator.
- [ ] Vitest: 8+ cases on `LedPlanckLabFrame.test.tsx` pass.
- [ ] Pytest: `test_led_planck_skill_template.py` passes; `test_workspace_observability.py` extended case passes.
- [ ] `npm run quality:check` green (lint + typecheck + tests + build).
- [ ] `cd backend && make lint && make test-fast` green.
- [ ] Lesson picker (post-1.B) shows "LED og Plancks konstant" alongside "Boldkast" — both cards display their cover SVG.
- [ ] Agent reply references the student's current step + at least one measured LED color by name within 1 turn of `step-change` or `measurement` events — verified manually with M, signed off by AR.
- [ ] `aiplatform sessions iframe-context <session_id>` dumps `mcp_app_context.led-planck.state` with shape matching the `LedPlanckSnapshot` interface.
- [ ] Phase-2 acceptance: dragging the step-2 voltage slider produces zero host messages until the student presses the record-threshold button OR sends a chat message — verified via the iframe-context dump.
- [ ] No emoji introduced in any file changed (per `feedback-no-emoticons` memory).

## Out of Scope (deferred)

- `physics-lab-builder` AI-generation skill — Year-2 per strands.qmd; this doc only ships the hand-curated lab.
- Multi-language lab UI — Danish only for v1.
- Pre-generated quiz bank — not relevant (lab is procedural, not quiz-driven).
- Accessibility audit — brief flags keyboard nav as stretch; v1 doesn't add tests.
- Cross-session resume — refresh restarts the lab; v2 may add localStorage-keyed step persistence.

## Related Documents

- **Source of truth (pedagogy + tutor prompt):** [`led-planck-skill-brief.md`](../../_scoping-snapshot/prototypes/led-planck-skill-brief.md) on this machine (M's machine: `~/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/led-planck-skill-brief.md`) — see reference-scoping-site-path — `reference_scoping_site_path.md` (agent-memory note, not a project file) memory
- [SEQUENCE.md](SEQUENCE.md) row 1.C
- [teacher-permission-model.md](teacher-permission-model.md) — 1.A; LED Planck becomes assignable to classes once this lands (already shipped 2026-05-26)
- [lesson-picker.md](lesson-picker.md) — 1.B; how students discover this lesson (already shipped 2026-05-26)
- [workbench-state-debounce.md](workbench-state-debounce.md) — 1.E + 1.E-Ph2; LED Planck adopts the commit-on-submit convention from day one (Boldkast had to retrofit; both shipped 2026-05-26)
- [kinebot-migration.md](kinebot-migration.md) — 1.D; the next skill, which uses LED Planck as the migration pattern reference
- [boldkast-mcp-app.md](../v0.1.0-jutland/boldkast-mcp-app.md) — the v0.1 reference implementation this mirrors
- [implemented/mcp-app-iframe-spec-compliance.md](implemented/mcp-app-iframe-spec-compliance.md) — the spec-compliant artefact path
- [.claude/skills/mcp-app-artefact/SKILL.md](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — the canonical AIPLA artefact-onboarding recipe; this doc is the first artefact through that recipe post-spec-compliance migration
- ADR-013 (artefact safety / sandbox / CSP) — in the scoping site at `architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html`

---

## Implementation Report

**Completed**: 2026-05-27
**Status**: Wrong architecture — needs redo. The artefact built does not follow the Boldkast model.

### What Was Built

`infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` — a 152-line English-language self-contained lab app with: circuit builder, I-U measurement table, I-U graph, spectrometer, results table with % error, progress checklist, and Planck calculation. JSON-RPC 2.0 wiring is technically correct (rpcNotify/rpcRequest/ui/initialize handshake, commit-on-submit pattern). The host wrapper `LedPlanckLabFrame.tsx`, skill template, and tests were completed per plan.

### What Went Wrong

The artefact tried to be a **complete standalone lab app** rather than a **simulation core**. It replicated the full structure of a traditional virtual lab (checklist, data table, results calculator, formula display) inside the iframe, when those elements should live in AIPLA's platform surfaces:

- Procedure checklist → Socratic tutor guides this in chat
- Data recording table → Type 5 lab notebook or tutor-elicited
- Planck calculation and % error display → tutor or platform results
- Spectrometer + I-U graph together → maybe correct, but the checklist sidebar is not

The Boldkast reference was not followed. Boldkast is: one canvas, sliders, answer-reveal markers. Nothing else.

Additionally: the lab UI is in English, not Danish, and does not match the original `leds_planck_virtual_lab.html` UI that the tutor system prompt was written to reference.

### Correct approach (for the redo)

1. Port the **simulation core** from the original: the circuit builder (drag components, connect wires), the ammeter/voltmeter displays, the I-U graph canvas, the spectrometer visualisation. These are the interactive elements where the student's hands-on exploration happens.
2. Strip: the procedure checklist, the measurement data table, the results calculator, the % error display, the auto-build button. AIPLA provides these.
3. The artefact's postMessage events fire when the student does something in the simulation (places a component, takes a reading, collects a spectrum). The tutor reads these and asks questions. The student records results in the lab notebook (Type 5) or via chat.
4. UI must be Danish (matching the tutor system prompt).

### Lessons Learned

- **The workbench artefact is the simulation, not the whole lesson.** Existing teaching tools bundle sim + instructions + AI + data recording. Porting to AIPLA means extracting the sim core and handing the rest to the platform.
- **Boldkast is the architectural reference**, not the original source HTML. The original source is the interaction model reference (what the sim shows), but the scope model comes from Boldkast.
- **A design doc that says "port the lab HTML" without defining what to keep and what to strip will produce a full lab app.** Future artefact docs must explicitly list what stays (sim core) and what moves to AIPLA.
