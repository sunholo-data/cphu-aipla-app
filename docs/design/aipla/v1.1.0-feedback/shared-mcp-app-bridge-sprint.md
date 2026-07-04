# Sprint Plan: SHARED-BRIDGE (1.1.54) — Shared MCP App guest bridge

## Summary
Extract one canonical guest bridge (`aipla-mcp-bridge.js`), inline it into every
artefact at build time, add the `window.openai` channel so ChatGPT sees student
commits, and guard drift in CI — so every current and future MCP App is
compatible with both the AIPLA app and ChatGPT with zero hand-copied bridge code.

**Duration:** ~1.5 days (4 milestones)
**Scope:** Artefact (View) + build tooling + CLI + CI. No backend runtime, no
server metadata, no frontend-app change.
**Dependencies:** [shared-mcp-app-bridge.md](shared-mcp-app-bridge.md) (the design);
[external-host-mcp-apps.md](external-host-mcp-apps.md) (1.1.49, SHIPPED — the
`ui://` MCP App path). ADR-013 (static-artefact security model).
**Risk Level:** Medium — M2 (re-inline the 3 live sims) touches working demo
artefacts; the per-sim integration tests are the regression bar. M4 (ChatGPT dev
mode) is human-gated (host-dependent).
**Design Doc:** [shared-mcp-app-bridge.md](shared-mcp-app-bridge.md)

## Current Status Analysis

### Recent Velocity
- 14-day window: 254 commits, 432 files, +43.5k/-7.7k (inflated by heavy doc work).
- Code milestones (e.g. 1.1.53 group-sync M0–M3) shipped ~0.5–1d each.
- This sprint is small + well-scoped; realistically executable in one session.

### Existing Implementation (what we build on)
- **4 artefacts** under `infrastructure/mcp-sandbox/artefacts/{boldkast,kinebot,led-planck,_template}/v1/index.html`.
  - 3 live sims speak SEP-1865 JSON-RPC (`ui/update-model-context`), each with its
    own hand-inlined `emit()` + `ui/initialize` handshake (drifted; verbose in
    boldkast, minified in kinebot/led-planck).
  - `_template` still emits the **pre-SEP-1865 flat `{source,type}`** format the
    current frontend ignores — a sim scaffolded from it is broken in the AIPLA app
    *and* ChatGPT.
  - **0** of 4 speak `window.openai` (ChatGPT is blind on commit).
- **Bridge seam (verified):** transport primitives (`__post`, `rpcRequest`,
  pending-emit queue, `emit`, `__contentText`, message/ping listener) sit near the
  script top; the `rpcRequest("ui/initialize",…)` call sits at the **bottom**
  (after app functions); the incoming listener dispatches to app functions
  (`flushPendingChanges`, kinebot `set-topic`). → shared transport + sim-authored
  call-sites (`init`, handler registration, `emit`).
- **Sandbox is a Node/ESM project** (`infrastructure/mcp-sandbox/package.json`):
  esbuild build + vitest. `.mjs` build script + a vitest bridge test fit natively.
- **CLI:** `aiplatform sim` is a Click group with `scaffold` — add `build`.
- **CI:** `.github/workflows/ci.yml` has jobs backend / local-mode-safety /
  frontend / security-audit / seed-reminder — add a light `sim-bridge` check.
- **Scaffolder:** `scripts/new-artefact.sh:45` clones `_template`. Skill
  `mcp-app-artefact/SKILL.md` documents the flat format + "copy the handshake" —
  both must change.
- **Regression bar:** `frontend/src/components/workspace/__tests__/{Boldkast,LedPlanck,KineBot}*integration.test.tsx`
  pin each sim's event-vocabulary → routing matrix (emitted JSON-RPC shape is
  unchanged by this sprint).

## Proposed Milestones

### Milestone 1: Canonical bridge + build tooling + bridge unit test
**Scope:** tooling (JS) + CLI (Python)
**Goal:** One source-of-truth bridge, a build/inline script with a drift `--check`,
CLI + Make wrappers, and an automated test of the dual-channel `emit()` — before
any artefact is touched.
**Estimated:** ~200 impl + ~90 test = ~290 LOC
**Duration:** ~0.6d

**Tasks:**
- [ ] Author `infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js` — the shared
      transport in conservative JS: `__post`, `rpcRequest`/`rpcNotify`, pending-emit
      queue, ping responder + envelope parser, `emit(kind, extra)` with the
      **guarded `window.openai` branch** (`setWidgetState` + `sendFollowUpMessage`)
      AND the postMessage path, `__contentText` fallback, and a public surface:
      `AIPLA_BRIDGE = { emit, init({name,version}), onChatFlush(cb), onHostNotification(method,cb) }`. (~130)
- [ ] `scripts/build-artefact-bridge.mjs` — dependency-free node fs: **write** mode
      (replace each artefact's `@aipla-bridge:start…end` region from the canonical
      source) + **`--check`** mode (exit 1 on drift or missing markers on a migrated
      file). (~80)
- [ ] `make sim-build` + `make sim-build-check` targets; `aiplatform sim build [--check]`
      subcommand shelling out to the script. (~30)
- [ ] Vitest in the sandbox: `bridge/__tests__/aipla-mcp-bridge.test.ts` — stub
      `window.openai`, assert labeled commit → `setWidgetState(structuredContent)` +
      `sendFollowUpMessage({prompt:label})`; unlabeled → no follow-up; absent
      `window.openai` → no throw + postMessage path; pending-queue flush on init. (~90)
- [ ] CLI unit test: `aiplatform sim build --check` exits non-zero on a seeded drift. (incl. above)

**Files to Create/Modify:**
- `infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js` (new)
- `infrastructure/mcp-sandbox/bridge/__tests__/aipla-mcp-bridge.test.ts` (new)
- `scripts/build-artefact-bridge.mjs` (new)
- `Makefile` (+2 targets)
- `cli/aiplatform/commands/sim.py` (+`build` command)
- `cli/tests/test_cli_sim.py` (new or extend)

**Acceptance Criteria:**
- [ ] `make sim-build-check` runs (reports nothing to check yet — no migrated files).
- [ ] Sandbox vitest green incl. the new bridge test (dual-channel behaviour proven
      without a real ChatGPT).
- [ ] `aiplatform sim build --check` exits 1 on a deliberately corrupted region.
- [ ] `cd backend && make lint` clean (CLI is Python).

**Risks:**
- Bridge must run under old host JS engines — Mitigation: `var`/`function`, no
  optional chaining, mirror the sims' existing conservative style.

### Milestone 2: Migrate the 3 sims + `_template` to the shared bridge
**Scope:** artefacts (View)
**Goal:** All four artefacts carry the marked bridge region + sim-authored
call-sites; `--check` green; emitted JSON-RPC shape byte-unchanged for the 3 sims;
`_template` now speaks JSON-RPC + `window.openai`.
**Estimated:** ~120 delta (mostly deletions) across 4 files
**Duration:** ~0.4d

**Tasks:**
- [ ] `boldkast`: replace L645–809 bridge with the `@aipla-bridge` region; body
      calls `AIPLA_BRIDGE.init({name:'boldkast',version:'1.0.0'})` + `onChatFlush(...)`;
      `emit(...)` call-sites unchanged.
- [ ] `kinebot`: same; register `onHostNotification('kinebot.set-topic', setTopic)`;
      drop the per-sim `__contentText` (now in the bridge).
- [ ] `led-planck`: same; `onChatFlush(...)`; drop per-sim `__contentText`.
- [ ] `_template`: replace the flat `{source,type}` `emit()` with the bridge region
      + call-sites (the correctness fix for all future sims).
- [ ] `make sim-build` to stamp all four; confirm `--check` green.

**Files to Modify:**
- `infrastructure/mcp-sandbox/artefacts/{boldkast,kinebot,led-planck,_template}/v1/index.html`

**Acceptance Criteria:**
- [ ] `make sim-build-check` green (4 files byte-identical to canonical source region).
- [ ] `grep -c window.openai artefacts/*/v1/index.html` → 1 each (was 0).
- [ ] `grep -c ui/update-model-context _template/v1/index.html` → ≥1 (was 0).
- [ ] Frontend integration tests (`{Boldkast,LedPlanck,KineBot}*integration.test.tsx`)
      green — emitted vocabulary/shape unchanged.
- [ ] Each artefact still opens standalone (`?test=1`) without throwing.

**Risks:**
- Re-inlining a live demo sim could change emit behaviour — Mitigation: the
  integration tests pin the matrix; diff the emitted messages before/after; keep
  `emit()` call-sites identical.
- `_template` migration changes its protocol — intended; covered by a new template
  smoke assertion.

### Milestone 3: CI drift-guard + tooling/skill hygiene
**Scope:** CI + scaffolder + skill
**Goal:** Drift can't reappear; the scaffold + skill stop teaching the old pattern.
**Estimated:** ~60 LOC + doc edits
**Duration:** ~0.35d

**Tasks:**
- [ ] `.github/workflows/ci.yml`: add a `sim-bridge` job (node) running
      `node scripts/build-artefact-bridge.mjs --check`.
- [ ] `scripts/new-artefact.sh`: after cloning `_template`, run the stamp (or note);
      ensure the clone carries the markers.
- [ ] `mcp-app-artefact/SKILL.md`: delete flat-format guidance (≈L691, L776) + the
      "copy the ~30 LoC handshake" step (≈L906); replace with "bridge is generated —
      call `AIPLA_BRIDGE.emit(...)`; run `make sim-build`".
- [ ] Root `Makefile` help text + `docs/design/.../shared-mcp-app-bridge.md` status
      note if needed.

**Files to Modify:**
- `.github/workflows/ci.yml`, `scripts/new-artefact.sh`,
  `.claude/skills/mcp-app-artefact/SKILL.md`

**Acceptance Criteria:**
- [ ] CI `sim-bridge` job green on this branch; red if a region is hand-edited.
- [ ] A fresh `new-artefact.sh <name>` produces an artefact that passes `--check`
      and emits JSON-RPC (spot-check).
- [ ] Skill no longer references the flat `{source,type}` format.

**Risks:**
- Low. Additive CI + doc edits.

### Milestone 4: Verify (human-gated where host-dependent)
**Scope:** verification
**Goal:** Prove the channel end-to-end in ChatGPT + no-regression in the AIPLA app.
**Estimated:** ~0.25d (mostly manual)
**Duration:** ~0.25d

**Tasks:**
- [ ] **Automated (self-runnable):** the M1 bridge vitest already proves the
      `window.openai` calls fire correctly — this is the machine half of AC-1.
- [ ] **Human (host-dependent):** ChatGPT developer mode — `show_boldkast` → change
      param → ▶ Afspil → "what did I just do?" → model states committed v₀/θ. Repeat
      `show_kinebot`, `show_led_planck`. (Needs deployed/tunneled sandbox +
      backend redeploy per the load_html cache note.)
- [ ] **AIPLA app no-regression:** run a sim, commit, confirm trust card + session
      context unchanged, no console errors.

**Acceptance Criteria:**
- [ ] Bridge vitest green (machine proof of dual-channel emit).
- [ ] (Human) all 3 sims report committed values in ChatGPT dev mode.
- [ ] (Human) AIPLA app trust card + iframe-context unchanged; no thrown errors.

**Risks:**
- ChatGPT host drift (young platform) — Mitigation: framed as a probe, re-verified
  per build; the single bridge shrinks the fix surface.

## Day-by-Day Breakdown

### Day 1
- **Focus:** M1 (bridge + tooling + test) → M2 (migrate artefacts).
- **Checkpoint:** canonical bridge + build script + vitest green; all 4 artefacts
  stamped; `--check` green; frontend integration tests green.

### Day 2 (half)
- **Focus:** M3 (CI guard + scaffold/skill hygiene) → M4 (verify).
- **Checkpoint:** CI `sim-bridge` job green; skill/scaffold updated; automated
  bridge proof green; hand off ChatGPT + AIPLA-app manual verification to M.

## Quality Gates

After each milestone:
```bash
cd infrastructure/mcp-sandbox && npm run test && npm run lint   # bridge + tsc
node scripts/build-artefact-bridge.mjs --check                  # drift guard
cd backend && make lint                                         # CLI (Python)
cd frontend && npx vitest run src/components/workspace/__tests__ # sim regression bar
```

After all milestones:
```bash
make sim-build-check
cd frontend && npm run quality:check    # full CI parity (tests + build)
cd backend && make lint && make test-fast
```

## Success Metrics
- [ ] 4 divergent bridges → 1 canonical (+ inlined copies enforced byte-identical).
- [ ] 2 message formats → 1 (flat `_template` format retired).
- [ ] `window.openai` channel present in all 4 (was 0).
- [ ] CI drift-guard green; hand-edit turns it red.
- [ ] Frontend sim integration tests + sandbox vitest all green.
- [ ] `_template`-scaffolded sim works in both hosts with no hand-copied bridge.

## Dependencies
- Design doc [shared-mcp-app-bridge.md](shared-mcp-app-bridge.md) (approved by write).
- ADR-013 static-artefact security model (honoured: self-contained, no external
  fetch, single file).

## Open Questions
- Build script `.mjs` at repo `scripts/` (chosen — dependency-free node, invoked by
  Make + CLI) vs inside the sandbox esbuild pipeline. Going with repo `scripts/`.
- Ship bridge markers pre-stamped in `_template` (chosen) vs insert on first
  `sim build`. Going with pre-stamped so `new-artefact.sh` clones a ready scaffold.

## Notes
- The emitted JSON-RPC wire shape is **unchanged** for the 3 live sims — this is a
  refactor + additive channel, not a protocol change on the AIPLA-app side.
- Commit directly to `dev` per project policy (no PRs); conventional commits;
  `Co-Authored-By` trailer.
- M4's ChatGPT step is genuinely human/host-dependent; the M1 vitest converts the
  machine-checkable half into an automated gate (per the "self-testable loops"
  rule).
