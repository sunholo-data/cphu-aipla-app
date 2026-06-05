# Sprint: LED-PLANCK-1C — LED Planck virtual lab (second physics skill)

**Sprint ID:** `LED-PLANCK-1C`
**Design doc:** [led-planck-skill.md](led-planck-skill.md) — refreshed 2026-05-27 (`70f32f7`)
**Pedagogical brief:** [led-planck-skill-brief.md](file:///Users/voightkampff/dev/sunholo-data/aipla/strand-a-pedagogical-bot/prototypes/led-planck-skill-brief.md)
**Branch:** `feature/led-planck-skill` (executor scratch; FF-merge to `dev` per AIPLA workflow)
**Base commit:** `70f32f7` (dev HEAD as of 2026-05-27)
**Promotion path:** `dev` → `test` (PR-gated) → `prod` (PR-gated). **No PR for `dev`.**
**Estimate:** ~2 days
**Created:** 2026-05-27

## Sprint goal

Ship the second AIPLA physics skill — a Danish stx virtual lab where students determine Planck's constant by measuring six LEDs' threshold voltages. Establishes the N=2 artefact through the spec-compliant pipeline + proves the `StaticArtefactFrame` abstraction handles a procedural-virtual-lab form factor (not just Boldkast's phenomenon-sim). Adopts the 1.E-Ph2 commit-on-submit pattern from day one.

After this sprint: `/lessons` shows two cards (Boldkast + LED Planck); the teacher's class-detail picker can link either to a class; both render through the same `StaticArtefactFrame` with different snapshot shapes.

## Scope (locked from the design doc)

**In scope:**
- Backend skill template `led-planck-tutor` with full Danish Socratic tutor prompt (verbatim from brief), `avatar: /lesson-images/led-planck-tutor.svg`, `accessControl: public`
- Frontend cover image `led-planck-tutor.svg` (16:9 viewBox, breadboard/LED/spectrometer motif, matches the existing pair)
- Lab HTML at `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` — copied from AR's source on the scoping site, postMessage-wired per brief tasks 2–4
- JSON-RPC `ui/initialize` handshake + `ui/update-model-context` notifications (mirror Boldkast post-MCPAPP-SPEC)
- Phase-2 commit-on-submit on the step-2 voltage slider (`pendingChanges` map + flush on Record-threshold button OR `chat-flush` notification)
- `LedPlanckLabFrame` host wrapper via `forwardRef` exposing `sendChatFlush()` (mirrors `BoldkastSimFrame`)
- Snapshot accumulator producing `mcp_app_context.led-planck.state` matching the `LedPlanckSnapshot` interface
- Human-tool-use cards on commitment events (step-change, measurement, component-placed-correct, polarity-error)
- Chat-page gate mounting `<LedPlanckLabFrame>` in the workspace when `skillSlug === "led-planck-tutor"`
- Chat-page `handleSend` threads the new lab's `sendChatFlush()` call alongside the existing Boldkast one
- Vitest suite for `LedPlanckLabFrame` (8+ cases mirroring `BoldkastSimFrame.test.tsx`)
- Backend test for the skill template (parses cleanly, contains three Danish teaching phases, `tool_configs.defaults` opt-outs, `accessControl=public`)
- Workspace-observability test extension verifying the rendered InstructionProvider block carries Danish step name + measurement summary
- ADR-013 pipeline scan + size check (manual gate)

**Out of scope (per design doc):**
- `physics-lab-builder` AI-generation skill (Year-2)
- Multi-language UI for the lab (Danish only for v1)
- Cross-session resume of step progress (refresh restarts the lab)
- Accessibility audit pass
- Per-lab budget surfacing (1.12 territory)
- Pre-generated quiz bank (lab is procedural, not quiz-driven)

## Velocity context

Past 2 days: 68 commits, 126 files, ~16k LOC across the 1.A teacher-permission-model sprint + several follow-ups. Throughput is comfortable; the conservative bottleneck is the AR Danish-prompt sign-off (manual review). ~2d wall-clock with the structure below.

## Milestones

The 13 design-doc steps fold into 10 executor milestones. Sequential — each is a discrete commit on `feature/led-planck-skill`.

### M1 — Skill template + cover image (~0.25d)

**Files:**
- `backend/skills/templates/led-planck-tutor/SKILL.md` (new) — frontmatter: `name`, `displayName: "LED og Plancks konstant"`, `description`, `avatar: /lesson-images/led-planck-tutor.svg`, `initialMessage`, `metadata` (model: gemini-2.5-flash, tool_configs.defaults artefacts+memory: false, tool_configs.mcp.allow_context_writes: ["led-planck"], tool_configs.a2ui.enabled: false). Body: the full Danish Socratic tutor prompt verbatim from the brief lines 120–183.
- `frontend/public/lesson-images/led-planck-tutor.svg` (new) — 16:9 viewBox, same dark background + accent palette as the existing pair; show a breadboard rail + LED + spectrometer cone.

**Acceptance:**
- [ ] `SKILL.md` parses via `_parse_template` (test passes)
- [ ] Prompt body contains all three Danish teaching phases markers ("FØR MÅLING", "UNDER/EFTER MÅLING", "REFLEKSION")
- [ ] `avatar` field is wired through `_template_updates` so reseed picks it up
- [ ] SVG renders correctly on `/lessons` cards (manual check post-deploy)

### M2 — Copy lab HTML + ADR-013 sanity (~0.1d)

**Files:**
- `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` (new) — copy from `/Users/voightkampff/dev/sunholo-data/aipla/assets/examples/led-planck-virtual-lab.html`. No edits yet — just plant the file.

**Acceptance:**
- [ ] File present at the expected path
- [ ] `grep -nE "fetch\(|XMLHttpRequest|new WebSocket|<script src" infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` returns zero matches
- [ ] `wc -c infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` < 200000

### M3 — Wire postMessage events on the lab HTML (~0.3d)

**Files:**
- `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` (modify)

Wrap `goStep(n)` to emit `step-change` per brief. Hook the measurement-recording path in step 2/3 to emit `measurement` (led, u0, lambda, h_computed). Wire equipment-placement clicks in step 1 to emit `component-placed` with `correct: boolean`. Wire LED polarity-error path to emit `led-polarity-error`. All emits use a local `emit(kind, payload)` helper that defers until `ui/initialize` resolves.

**Acceptance:**
- [ ] `goStep(1)` → `goStep(2)` produces a `step-change` event with `step: 2, stepName: "part1"`
- [ ] Recording a U₀ for a red LED produces a `measurement` event with the four required fields
- [ ] Placing the voltmeter in parallel (correct) produces `component-placed {correct: true}`; placing it in series (incorrect) produces `correct: false`
- [ ] All four event shapes match the brief verbatim

### M4 — JSON-RPC envelope + ui/initialize handshake (~0.15d)

**Files:**
- `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` (modify)

Wrap `emit()` to produce spec-compliant JSON-RPC: `{jsonrpc: "2.0", method: "ui/update-model-context", params: {structuredContent: {kind, ...payload}}}`. Add `ui/initialize` request on load, queue events until response. Mirror the Boldkast pattern. Register a `ping` responder + `message` listener for inbound notifications.

**Acceptance:**
- [ ] Inbound `ping` request gets `{jsonrpc: "2.0", id, result: {}}` response
- [ ] Initialize handshake completes via the `StaticArtefactFrame` proxy (visible in the host on mount)
- [ ] Events emitted before initialize is resolved are queued, flushed in order after

### M5 — Phase-2 commit-on-submit on step-2 voltage slider (~0.15d)

**Files:**
- `infrastructure/mcp-sandbox/artefacts/led-planck/v1/index.html` (modify)

Per [workbench-state-debounce.md](workbench-state-debounce.md) §Phase 2: the step-2 voltage slider writes to a local `pendingChanges` map; nothing reaches the host until (a) the student presses the Record-threshold button OR (b) a `ui/notifications/chat-flush` notification arrives from the host. On flush, emit one `state-change` event with `triggeredBy: "record"` or `"chat-submit"` and the final voltage.

Commitment events from M3 (step-change, measurement, component-placed, polarity-error) keep firing immediately — only the continuous slider is buffered.

**Acceptance:**
- [ ] Dragging the voltage slider produces zero host messages
- [ ] Pressing Record-threshold flushes the pending value as `state-change {triggeredBy: "record"}` BEFORE the `measurement` event (if both fire on the same click)
- [ ] Inbound `ui/notifications/chat-flush` notification flushes as `triggeredBy: "chat-submit"`
- [ ] No-op when `pendingChanges` is empty (clicking Record without a fresh slider value)

### M6 — `LedPlanckLabFrame` host wrapper (~0.45d)

**Files:**
- `frontend/src/components/workspace/LedPlanckLabFrame.tsx` (new) — `forwardRef` with `LedPlanckLabFrameHandle` exposing `sendChatFlush()`; internal `staticFrameRef` to dispatch the JSON-RPC notification; snapshot accumulator (`LedPlanckSnapshot` shape); `useHumanToolEvents` dispatch for commitment events.

Mirror `BoldkastSimFrame.tsx` structurally. Replace event vocabulary:
- `step-change` → set `snap.currentStep` + `snap.currentStepName`, dispatch Danish card ("Begyndte I-U-måling", etc.)
- `measurement` → append to `snap.measurements` (dedupe by led color, latest wins), dispatch "Målte U₀ for <farve> LED"
- `component-placed {correct: true}` → append to `snap.componentsPlaced`, dispatch "Placerede <komponent>"; `correct: false` → silent (no card, no push — same pattern as Boldkast un-reveal)
- `led-polarity-error` → set `snap.lastPolarityError` timestamp, dispatch "Forsøgte LED med omvendt polaritet"
- `state-change` (from M5 commit-on-submit) → silent push only (the consolidated voltage; the `measurement` event covers the pedagogically interesting moment)

**Acceptance:**
- [ ] `ref.sendChatFlush()` dispatches `{jsonrpc:"2.0", method:"ui/notifications/chat-flush", params:{}}` via the staticFrame ref
- [ ] Snapshot accumulator produces shape matching `LedPlanckSnapshot` interface from the design doc
- [ ] Card labels are Danish per the design-doc table
- [ ] No `accessControl`-style filter logic (this is the workspace frame, not /lessons)

### M7 — Vitest suite for `LedPlanckLabFrame` (~0.3d)

**Files:**
- `frontend/src/components/workspace/__tests__/LedPlanckLabFrame.test.tsx` (new)

Mirror `BoldkastSimFrame.test.tsx`. 8–10 cases:
- mount with correct sandboxOrigin + artefactPath
- routes `step-change` → snapshot.currentStep updates + Danish card
- routes `measurement` → measurements array appends, dedupes by LED color
- routes `component-placed correct:true` → array appends + card
- routes `component-placed correct:false` → no card, no push
- routes `led-polarity-error` → lastPolarityError timestamp + card
- rejects messages from wrong origin (inherited via `StaticArtefactFrame`)
- `sendChatFlush` ref method dispatches correct notification (Phase-2 test)

**Acceptance:**
- [ ] All cases green; ~200 LOC test file
- [ ] No regression in existing `BoldkastSimFrame.test.tsx`

### M8 — Mount in chat page workspace + wire chat-submit flush (~0.15d)

**Files:**
- `frontend/src/app/chat/[...path]/page.tsx` (modify)

Add a `ledPlanckFrameRef = useRef<LedPlanckLabFrameHandle | null>(null)`. Add a gate parallel to the existing Boldkast one: when `skillSlug === "led-planck-tutor"`, mount `<LedPlanckLabFrame ref={ledPlanckFrameRef} sessionId={...} />` in the workspace pane. Extend the existing `handleSend` chat-flush call to also fire `ledPlanckFrameRef.current?.sendChatFlush()` — both refs flush, only the mounted one acts.

**Acceptance:**
- [ ] Visiting `/chat/@aipla-platform/led-planck-tutor` mounts the lab in the workspace
- [ ] Boldkast chat path unaffected
- [ ] Chat-submit calls both flushes (verified by reading the handleSend body)

### M9 — Backend tests for skill template + workspace observability (~0.2d)

**Files:**
- `backend/tests/unit/test_led_planck_skill_template.py` (new) — verify SKILL.md parses, prompt body contains the three Danish teaching-phase markers, frontmatter has `avatar`, `tool_configs.defaults.artefacts: false`, `tool_configs.mcp.allow_context_writes: ["led-planck"]`
- `backend/tests/api_tests/test_workspace_observability.py` (modify) — add one case: POST iframe-context for `serverId: "led-planck"` with the snapshot shape from the design doc, assert the rendered InstructionProvider block contains the Danish step name + at least one measurement summary

**Acceptance:**
- [ ] All new + extended tests pass under `make test-fast`
- [ ] `backend/admin/platform_seed._parse_template` round-trips the new template's `avatar` field

### M10 — Quality gates + direct-to-dev merge + seed (~0.25d)

**Files:** none new — verification + deploy steps.

Gates:
- `cd backend && make lint` clean
- `cd backend && make test-fast` green (no regression, +new template + observability tests)
- `cd frontend && npm run quality:check` green (lint + typecheck + vitest + build, +new `LedPlanckLabFrame.test.tsx`)
- ADR-013 pipeline scan: zero matches for `fetch\(|XMLHttpRequest|new WebSocket|<script src`
- Size check: artefact under 200 KB
- No emoji introduced (per `feedback-no-emoticons` memory)
- `git diff dev~10..dev -- backend/auth/access_context.py` shows no changes (axiom-9 promise)

Then:
- Rebase `feature/led-planck-skill` onto current `origin/dev`
- FF-merge to `dev` — **no PR** per AIPLA workflow
- Push to `origin/dev`
- Wait for Cloud Build deploy
- Re-seed via `POST /api/admin/seed-platform-skills` (with SA token + `--include-email`) so the new template + avatar field land in Firestore + `manage-class.initialMessage` carries through any other template tweaks

**Acceptance:**
- [ ] `dev` carries the FF-merged commits; CI green
- [ ] After deploy + reseed, `GET /api/skills` returns 3 entries: `problem-set-hints`, `manage-class`, `led-planck-tutor` (each with its `avatar` URL)
- [ ] `/lessons` student view shows two cards (Boldkast + LED Planck — `manage-class` filtered as teacher-only)
- [ ] `/teacher/classes/<demo-physik-id>` → Add lesson picker offers `LED og Plancks konstant` alongside `Manage classes` (the un-linked option)
- [ ] Manual smoke: visit `/chat/@aipla-platform/led-planck-tutor`, open the lab in workspace, complete step 1 (drag equipment), do a measurement in step 3, send "kan du hjælpe mig forstå hvad jeg har målt?" — tutor response references at least one measured LED color and the step name

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Danish tutor prompt has charset issues at Firestore write (>10K chars / non-ASCII) | Low | Prompt is ~3K chars per the brief; existing problem-set-hints SKILL.md is similar size with similar Danish chars and works |
| Lab HTML's existing `postMessage` references (if any) conflict with the new JSON-RPC wiring | Low | M3 audits + replaces; the brief is explicit that the source HTML has no existing host integration |
| step-2 voltage slider fires `input` events on every pixel; pendingChanges map could leak memory with no flush | Low | The map is keyed by field name (so just one entry for "voltage"); cleared on every flush. Same shape as Boldkast's |
| Phase-2 flush race — student records U₀ in same tick as the slider settles | Low | M5 explicitly flushes pending before emitting the `measurement` event; deterministic order on the wire |
| ADR-013 scan miss — lab uses some pattern I didn't grep for | Medium | The scan grep set is the canonical one from the mcp-app-artefact skill; if a new pattern surfaces, file an ADR-013 amendment |
| AR Danish-prompt sign-off lags after M10 | Medium | The prompt is verbatim from AR's brief; if AR requests edits, those go in a follow-up commit, not a blocking gate |

## Success criteria

- [ ] All 10 milestones' acceptance gates met
- [ ] Backend `make lint` + `make test-fast` green
- [ ] Frontend `npm run quality:check` green
- [ ] ADR-013 scan: 0 forbidden patterns, artefact size < 200 KB
- [ ] After deploy + reseed: `/lessons` (student view) shows Boldkast + LED Planck cards with covers; `/teacher/classes/<id>` Add-lesson picker offers LED Planck alongside Manage classes
- [ ] Manual smoke: complete a measurement, ask the tutor, get a Danish reply referencing the measured LED + step name
- [ ] No emoji introduced in any sprint-touched file
- [ ] Direct-to-dev FF merge done; pushed to `origin/dev`

## Hand-off note for sprint-executor

This sprint is **planned only** — the user has the plan + JSON for review. When invoked:

1. Create branch `feature/led-planck-skill` off current `dev` HEAD
2. Run M1 → M10 sequentially. Each milestone = one commit on the feature branch.
3. After each milestone, run the milestone-specific quality gate before moving on.
4. M10 FF-merges direct to `dev` — **no PR** per `feedback-aipla-git-workflow` memory.
5. Push to `origin/dev`. Cloud Build deploys automatically.
6. Once deploy succeeds, trigger the seed: `POST /api/admin/seed-platform-skills` with the SA-impersonation `--include-email` token pattern (see `reference-admin-seed-token-mint` memory).

## Out of scope (do NOT start)

Per the design doc Out-of-Scope + Non-Goals:
- `physics-lab-builder` AI-generation skill
- Multi-language lab UI
- Cross-session resume of step progress
- Accessibility audit
- Per-lab budget UI
- Pre-generated quiz bank
- Wiring LED Planck into the seeded demo classes (teacher does that via the Add-lesson picker — the picker is the demonstration surface)
