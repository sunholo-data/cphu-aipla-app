# Pre-ship checklist — MCP App artefact

Tickable extract of the gates from SKILL.md §ADR-013 + §Pre-ship usability gate
+ §Visual design standard. Paste into a PR description before merging a new sim
to `dev`. Tick by ticking — no exceptions.

## ADR-013 security gates (NEVER skip)

- [ ] **No external fetches.** `grep -nE "https?://|fetch\(|XMLHttpRequest|import\(['\"]http" infrastructure/mcp-sandbox/artefacts/<name>/v<n>/` returns zero hits
- [ ] **No inline `<script src>` to external origins.** Only `<script>` blocks with inline code or relative `src` paths
- [ ] **No third-party CDN URLs** in CSS `@import`, `url(...)`, or `<link href>`
- [ ] **Bundle size ≤ 200 KB total.** `du -sk infrastructure/mcp-sandbox/artefacts/<name>/v<n>/` ≤ 200
- [ ] **Sandbox flags intact.** Iframe rendered with `sandbox="allow-scripts"` (no `allow-same-origin`)
- [ ] **CSP allows only `self` + the sandbox origin.** Check the `aipla-v01-sandbox` Cloud Run service's headers

## Visual design

- [ ] **Light theme only.** No `prefers-color-scheme: dark` rules. No dark backgrounds. Tested in both light and dark OS settings — looks correct in both
- [ ] **Canonical CSS variables used** (see SKILL.md §Canonical CSS variables) — no ad-hoc colour literals
- [ ] **Header rule honoured** — no `<h1>` inside the artefact (host renders the title via `SimFrameHeader`)
- [ ] **Minimum font sizes** — body text ≥ 14px, instrument readouts ≥ 16px
- [ ] **No fixed min-width > 600px** in any CSS

## Pre-ship usability gate (Axiom 11)

- [ ] **Fits 360px width** without horizontal scroll (`scrollWidth <= clientWidth`)
- [ ] **Fits 700px width** without horizontal scroll (this is the prod workspace pane size on `md:w-1/2`)
- [ ] **Fits 1024px width** without horizontal scroll
- [ ] **Fits 1440px width** without horizontal scroll
- [ ] **Tested on a real iPhone or Android** (not just devtools emulation) — touch targets work, no zoom-on-focus surprises

## AIPLA frontend wiring

- [ ] **Snapshot hook authored** at `frontend/src/hooks/use<Name>Snapshot.ts` (use `aiplatform sim scaffold <name>` or copy from `frontend/src/_sim-template/`)
- [ ] **Hook uses `useSimSnapshotPush`** — not a hand-rolled `fetchWithAuth` call
- [ ] **Frame component authored** at `frontend/src/components/workspace/<Name>Frame.tsx` using the shared `SimFrameHeader`
- [ ] **Frame forwardRef exposes `sendChatFlush()`** via `useImperativeHandle`
- [ ] **Chat page branch added** in `frontend/src/app/chat/[...path]/page.tsx` alongside the existing Boldkast / LED-Planck / KineBot blocks

## Skill template

- [ ] **`backend/skills/templates/<skill>/SKILL.md`** with the right system prompt
- [ ] **`tool_configs.mcp.servers: [<name>]`** in skill frontmatter
- [ ] **`tool_configs.mcp.allow_context_writes: [<name>]`** in skill frontmatter — without this, `iframe-context` POSTs from the artefact return 403 silently and the agent never sees state
- [ ] **`accessControl.type: "public"`** or `"tagged"` per the skill's audience

## Tests

- [ ] **Vitest cases for the Frame** — event routing per kind, `sendChatFlush()` ref method, cross-origin rejection (~12 cases minimum, see LedPlanckLabFrame.test as reference)
- [ ] **Pytest cases for the skill template** — `_parse_template` returns the expected fields; seed roundtrip
- [ ] **Sandbox build green** — `make sandbox-build` succeeds with the artefact included

## Deployment

- [ ] **`infrastructure/mcp-sandbox/artefacts/<name>/v<n>/`** committed to `dev`
- [ ] **Cloud Build trigger** `aipla-mcp-sandbox-deploy` fires on the push (auto)
- [ ] **Skill seeded** to Firestore after deploy (via `POST /api/admin/seed-platform-skills` — see the manual-seed runbook in `docs/design/aipla/v1.0.0-pilot/aipla-cloud-bootstrap.md`)
- [ ] **End-to-end smoke** — join a group bound to the new skill, open the sim, interact, verify the workbench event lands in BigQuery via `make verify-chat-logs GROUP=<code> ENV=dev`
