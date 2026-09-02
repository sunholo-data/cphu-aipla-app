# KineBot kinematics tutor — third physics skill + canonical external-artefact migration runbook

**Status**: Implemented — **except the quiz half, which was stripped. See the correction below.**

> ## Correction 2026-08-17 — the quiz half of this doc was never wired
>
> This doc records a pre-generated quiz bank, `kinebot.quiz-attempt` events,
> `quizProgress` snapshot state, and a correct-answer trust card as **implemented**.
> They are not. A 2026-08-17 audit found:
>
> - The artefact ships **sim only** — [index.html:86](../../../../../infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html#L86)
>   says so in its own header comment ("CONTENT — SIM ONLY. Quiz + graph + topic
>   nav + formulas + notes" stripped), corroborated by
>   [unified-sim-rendering.md:74](../../v1.1.0-feedback/unified-sim-rendering.md#L74).
> - The `fetch('./quizzes/<topic>.json')` this doc specifies at line ~127 was
>   never written.
> - No `kinebot.quiz-attempt` handler exists in `KineBotFrame`, the snapshot
>   push, or the trust-card dispatch. Grep returns this doc and the skill file only.
>
> **The 11 DK-vetted quiz banks (11 topics, ~30 questions each) were deleted from
> the tree on 2026-08-17** — they had no loader and read as shipped content.
> They remain in git history and are recoverable:
> `git log --diff-filter=D -- 'infrastructure/mcp-sandbox/artefacts/kinebot/v1/quizzes/*'`
> then `git show <sha>^:<path>`. They are worth recovering as seed content when
> [question-set-element.md](../../v1.1.0-feedback/question-set-element.md) (1.1.78)
> M2 lands — that element is the platform-side home for a quiz, per this project's
> standing rule that quizzes are AIPLA's job and not the artefact's
> ([expanded-workbench-types.md:30](../expanded-workbench-types.md#L30)).
>
> Everything else in this doc — the 7 sims, the strip/wire runbook, the
> postMessage event shapes for `topic-change` / `sim-run` / `graph-change` — is
> accurate and shipped.
**Priority**: P1 (v1 critical-path; third of three physics skills; canonical AIPLA onboarding runbook for external artefacts)
**Estimated**: 2–3 days
**Scope**: Fullstack — artefact (strip direct API calls + wire postMessage, ~1707 LOC source), backend (skill template + tool config), frontend (`KineBotFrame` host wrapper)
**Dependencies**: v0.1 shipped; [mcp-app-iframe-spec-compliance.md](implemented/mcp-app-iframe-spec-compliance.md) merged; [lesson-picker.md](lesson-picker.md) shipped; [led-planck-skill.md](led-planck-skill.md) shipped (establishes the artefact-pipeline pattern as N=2 before this becomes the runbook); ADR-013 pipeline scan
**Pedagogical source-of-truth + migration brief:** [`kinebot-migration-brief.md`](../../_scoping-snapshot/prototypes/kinebot-migration-brief.md) in the scoping site — full audit/strip/wire/extract/package/pair/test workflow, the original artefact's behaviour catalogue (7 sims + graph plotter + quiz + chat + formula ref), skill config sketch, postMessage event shapes, pre-beta deploy checklist. **The brief is the design for the lesson's pedagogy and the migration audit; this doc is the execution layer that turns the brief into shippable code + establishes the runbook for future external-artefact onboarding.**
**Created**: 2026-05-24
**Last Updated**: 2026-05-27

## Problem Statement

KineBot is an externally-built AI artefact (~1707 LOC HTML, DK's work for ~100s of Indian NCERT/CBSE Class 11 students) that **violates several AIPLA invariants** as-shipped:

- **Direct Anthropic API calls in the browser** at three call sites (lines ~1056, 1120, 1558 per the brief). Bypasses AIPLA backend → bypasses budget enforcer (ADR-014) → bypasses chat-log pipeline (1.2) → bypasses model router (1.4). Every chat message is invisible to AIPLA observability.
- **Student-supplied Anthropic API key** in `sessionStorage`. Defeats AIPLA's "students never see or provide an API key" budget control (per strands.qmd line 148).
- **No log capture** — chat goes browser → Anthropic directly, no BigQuery sink. Researchers can't analyse usage; teachers can't see what their students asked.
- **Direct quiz generation** via the same Anthropic-API path (line ~1558).
- **CDN font imports** (`fonts.googleapis.com`) that work under `sandbox="allow-scripts"` but break under stricter CSP.

Beyond the technical violations, KineBot is the **first AIPLA onboarding of an externally-built AI artefact**. AIPLA committed (per strands.qmd direction-of-travel) to a "platform that hosts pedagogical bots teachers build elsewhere." If onboarding takes ad-hoc surgery each time, the platform doesn't scale. We need a **runbook**, and KineBot is the chance to write one against a real artefact while the pattern is still fresh.

**Current State:**
- KineBot source at `~/Documents/clients/cph-uni/sources/kinebot_v2 (3).html` (~1707 LOC, four modes: chat + 7 canvas sims + graph plotter + adaptive quiz + formula ref)
- The brief documents the full audit + the migration sub-tasks
- AIPLA has the spec-compliant artefact pipeline ready ([implemented/mcp-app-iframe-spec-compliance.md](implemented/mcp-app-iframe-spec-compliance.md)) and one artefact through it (Boldkast); LED Planck (1.C) lands the second through the pipeline
- DK's Indian student cohort (~100s) is available as the beta audience once migration is complete

**Impact (if not built):**
- KineBot's chat traffic stays invisible to AIPLA — no budget enforcement (a runaway student could rack up a $100 bill silently), no chat-log capture for research, no model-router routing. ADR violations active in production if we ship it as-is.
- DK's beta cohort either uses the original Anthropic-key version (defeats the platform's whole point) or doesn't run at all.
- The "AIPLA can host externally-built artefacts" promise stays untested. v2's `student-as-creator` (Strand B) depends on a robust artefact-onboarding pipeline; without runbook validation now, that work has nothing to build on.
- The third v1 skill commitment (per strands.qmd) goes un-shipped, leaving v1.0.0-pilot at 2/3 student-facing chat skills.

## Goals

**Primary Goal:** KineBot lands in `cphu-aipla-app` as an AIPLA-compliant skill + paired workbench artefact, with all direct Anthropic API calls stripped, all telemetry flowing through the AIPLA backend, and the migration documented as a **runbook** in `.claude/skills/mcp-app-artefact/` so any future external-artefact onboarding follows the same checklist. Beta deployment to DK's Indian student cohort within v1 timeline.

**Success Metrics:**
- **Zero direct external API calls** from the artefact. `grep -nE "fetch\(|XMLHttpRequest" infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html` returns no matches (post-migration). Original artefact has 3; migrated has 0.
- **Zero `sessionStorage.setItem.*apiKey`** in the migrated artefact. The API-key input modal/UI is removed.
- All four postMessage event types from the brief fire correctly:
  - `topic-change` (sidebar topic click)
  - `sim-run` (with topic-specific params)
  - `graph-change`
  - (Possibly) quiz-event analogues — see "Quiz handling" decision below
- Chat moves OUT of the artefact entirely (the brief's "easier path" — recommended). The AIPLA chat surface handles all student–tutor dialogue; the artefact is the workbench.
- Artefact size stays under ADR-013's 200 KB ceiling after migration (the brief's source is ~1707 LOC ≈ ~70 KB unminified — comfortably in range).
- Tutor system prompt (KineBot's existing well-designed Socratic prompt, lines ~1030 in source) extracted to `backend/skills/templates/kinebot-kinematics-tutor/SKILL.md` verbatim — preserved, not rewritten. Loads inside the 10K char cap.
- **Migration runbook** lands as a documented workflow in `.claude/skills/mcp-app-artefact/SKILL.md`, cross-referenced from this doc. The seven steps (audit, strip, wire, extract, package, pair, test) become the canonical AIPLA external-artefact onboarding checklist.
- 12+ vitest cases on `KineBotFrame.test.tsx` covering the topic + sim-run + graph-change routing.
- ADR-013 pipeline scan passes (post-migration only — the original WILL fail it, intentionally — that's the point of the migration).
- AR + DK joint sign-off on the migrated artefact behaviour against curriculum coverage (DK confirms quiz quality + topic coverage; AR confirms pedagogical scaffolding remains intact).

**Non-Goals:**
- **Re-architecting the 7 sims.** They're already well-built; the migration preserves their behaviour, just strips the API surface.
- **Translating the artefact to Danish.** KineBot is English / NCERT-CBSE-curriculum; that stays. Multi-language is a separate decision; for the Indian cohort English is correct.
- **AI-regenerated quiz.** The brief flags the AI-generated quiz as unpredictable. Migration ships with a **pre-generated quiz bank** (30+ questions per topic, vetted) — simpler, deterministic, no per-quiz LLM call. Adaptive AI-quiz is v2.
- **Cross-class progress carry-over.** Within a session: `localStorage` keyed by group_id is fine (per brief step 5). Across sessions: defer.
- **Hint system overhaul.** Brief mentions structured scaffolding hints as a stretch — punt to v2.
- **Accessibility audit.** Base font `.7rem` is too small per brief; the migration optionally bumps to 1rem but doesn't ship a full WCAG audit.
- **Embedded chat panel inside KineBot.** The brief gives two options — keep the embedded chat (postMessage-routed to AIPLA backend) OR remove it entirely and let the AIPLA chat surface handle it. **Decision: remove entirely.** Reasoning: matches the Boldkast / LED Planck pattern (workspace = artefact; chat = AIPLA surface). One pattern, not two. Simplifies the migration considerably and the platform-level chat is more capable than an embedded panel anyway.

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Sim load profile unchanged from original (it's already fast canvas rendering). Tutor latency is the AIPLA standard (gemini-3.5-flash via Vertex; same TTFT profile as `problem-set-hints`) |
| 2 | EARNED TRUST | +1 | Stripping the student-API-key flow MEANS students never see costs (matches budget invariant per ADR-014). Also: the migration eliminates the chat-traffic blind spot — every message flows through AIPLA's audited path. Trust is a SECURE-BY-CONSTRUCTION + EARNED dual win |
| 3 | SKILLS, NOT FEATURES | +1 | Lands as a new skill in `backend/skills/templates/kinebot-kinematics-tutor/`. Same skill-as-unit-of-work pattern. Demonstrates AIPLA can host **externally-authored** skills via migration, not just platform-authored ones — important for v2 scope (teachers as skill authors) |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Migration moves model selection from "the student's Anthropic key calls claude-sonnet-4-20250514 always" to "AIPLA's model router decides per-skill." This is +1 in spirit (more right-model-right-moment-able) but for v1 we keep gemini-3.5-flash as the default; per-skill mapping is 1.4. Score honestly: 0 |
| 5 | GRACEFUL DEGRADATION | +1 | Original artefact: if the student's API key is invalid, the whole chat dies. Migrated: invalid API key impossible (no key in browser); AIPLA's audited fallback path applies (model router retries, error UX surfaces). Net robustness improvement |
| 6 | PROTOCOL OVER CUSTOM | +1 | Same spec-compliant path as Boldkast + LED Planck. JSON-RPC `ui/update-model-context` for events; `StaticArtefactFrame` for the host wrapper. Zero new wire formats. The migration EXPLICITLY moves from a custom direct-API path to the spec path — this axiom is the headline win |
| 7 | API FIRST | +1 | Chat moves OUT of the artefact, INTO the AIPLA chat API (`POST /api/skill/{id}/stream`). API-first becomes literal: the artefact has no chat surface; the API is the chat surface |
| 8 | OBSERVABLE BY DEFAULT | +1 | Chat traffic now flows through AIPLA's OTel + BigQuery pipeline (1.2). Researchers can study DK's Indian-cohort usage; teachers can audit what their students asked. Original artefact: zero observability. Net new observability surface = 100% of the chat |
| 9 | SECURE BY CONSTRUCTION | +1 | Removing the student-API-key flow + the direct browser-to-Anthropic calls eliminates a class of issues: leaked keys, prompt-injection routed to a key the student paid for, budget runaway. The migration's whole point is to land KineBot inside AIPLA's audited security envelope |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | The migrated artefact is *thinner* than the original — chat panel removed (~200 LOC), API key UI removed, fetch helpers removed. The AIPLA platform protocol absorbs all the chat + model-routing concerns. Net thinning of the client per artefact |
| | **Net Score** | **+8** | Threshold >= +4 OK |

**Conflict Justifications:** None.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Iframe ↔ host wire | MCP Apps spec JSON-RPC over postMessage via sandbox-proxy | Same as Boldkast / LED Planck. Brief's `aipla:workbench` envelope wraps inside `ui/update-model-context` with `structuredContent.kind` carrying the brief's event vocab (`topic-change`, `sim-run`, etc.) |
| Skill template format | Agent Skills spec (`SKILL.md` with frontmatter + body instructions) | KineBot's existing well-designed Socratic prompt extracted into this format. Verbatim preservation — the prompt is one of the artefact's strengths |
| Quiz data format | JSON file per topic, served from `infrastructure/mcp-sandbox/artefacts/kinebot/v1/quizzes/` | Plain static JSON — no schema invention. Pre-generated, vetted by DK. Each file: `{topic, questions: [{prompt, options, correct, explanation}]}` |
| Progress state | `localStorage` per brief step 5 — keyed by group_id | Standard browser storage; no new protocol |
| Chat surface | AIPLA chat surface — embedded chat in original artefact is REMOVED | The artefact's chat panel goes away; students use AIPLA's chat. One chat per page, not two |

**No new protocols, no new wire formats.** The migration moves KineBot from a parallel-protocol world (direct Anthropic calls) into AIPLA's audited primitives. PROTOCOL OVER CUSTOM gets its biggest single win of v1 here.

## CLI Surface

The migration adds value if it produces a reusable runbook. The CLI surface is **scoped to support the migration workflow**, not just KineBot:

| Command | Purpose | Position in tree |
|---|---|---|
| `aiplatform artefact audit <path>` | Run the ADR-013 pipeline scan + the "direct API calls" check + the "size cap" check against a candidate external artefact. Outputs a markdown report mirroring the brief's audit format | new `aiplatform artefact` family |
| `aiplatform artefact strip <path>` | (Optional, stretch) Mechanical strip pass — flag fetch() calls, sessionStorage keys, external `<script src>` for manual removal. Doesn't auto-edit; outputs an annotated diff | same family |

Estimate: **~0.3d** for `audit` (a single Click subcommand calling some grep + wc), nothing for `strip` in v1 (defer to v2; the audit output is enough to drive manual work for now).

**Backlink:** [mcp-app-artefact skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — this work elevates the skill from "how to author a new artefact" to "how to *onboard* an external artefact." Section "External-artefact migration runbook" added as part of this sprint.

## Design

### Migration sub-tasks (concrete, from the brief)

The brief defines seven workflow steps; this design pins each to a concrete change in `cphu-aipla-app`:

#### Step 1: Audit
- **Input:** `~/Documents/clients/cph-uni/sources/kinebot_v2 (3).html`
- **Tool:** `aiplatform artefact audit` (new CLI command, ships with this sprint) — or manual grep per the brief's audit format
- **Output:** Confirmed violations: 3 direct API calls, 1 API-key UI, CDN font imports. Brief documents this; we re-verify via the new command to dogfood it.

#### Step 2: Strip
| Source line range | What | Replacement |
|---|---|---|
| ~1030 | `SYSTEM_PROMPT` constant | Extract to `backend/skills/templates/kinebot-kinematics-tutor/SKILL.md` instructions body |
| ~1056 | Chat message send (direct Anthropic fetch) | **Delete entire embedded chat panel UI** (brief option (b)); AIPLA chat surface handles it |
| ~1120 | Streaming response handler | Delete (chat panel removed) |
| ~1558 | Quiz generation (direct Anthropic fetch) | Replace with pre-generated quiz bank lookup (`fetch('./quizzes/<topic>.json')` — local same-origin, allowed by CSP) |
| ~? | API key input modal/UI | Delete entirely |
| Header `<link rel="stylesheet" href="https://fonts.googleapis.com/...">` (×3) | Google Fonts CDN | Replace with system-font stack fallback (per brief recommendation; CDN imports break stricter CSP) |
| `apiKey`-related `sessionStorage` calls | API key persistence | Delete (no key needed) |

#### Step 3: Wire (postMessage events)

Per the brief's event vocab, wrapped in JSON-RPC envelope (spec-compliant path):

```js
// In KineBot index.html, after sidebar topic click:
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "kinebot.topic-change",
    topic: currentTopic  // e.g. 'projectile-motion'
  }
});

// When sim runs:
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "kinebot.sim-run",
    simType: activeSim,
    params: { velocity, angle, acceleration }
  }
});

// When graph type changes:
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "kinebot.graph-change",
    graphType: activeGraph
  }
});

// Plus quiz events (new, since we control the quiz bank now):
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "kinebot.quiz-attempt",
    topic, questionId, answeredCorrectly
  }
});
```

Plus the `ui/initialize` handshake on load (per spec; mirrors Boldkast post-MCPAPP-SPEC pattern).

#### Step 4: Extract (skill config)

`backend/skills/templates/kinebot-kinematics-tutor/SKILL.md`:

```yaml
---
displayName: "Kinematics Tutor (NCERT)"
slug: "kinebot-kinematics-tutor"
language: "en"
description: "Socratic kinematics tutor paired with interactive simulations. NCERT/CBSE Class 11 curriculum."
initialMessage: "Hi! Ready to explore kinematics? Pick a topic from the workbench on the right and we'll start with a question."
tools: []  # chat + iframe-context only; no MCP tools
toolConfigs:
  defaults:
    artifacts: false
    memory: false
  mcp:
    servers: ["kinebot"]
    allow_context_writes: ["kinebot"]
  a2ui:
    enabled: false
---

[Body: KineBot's existing SYSTEM_PROMPT extracted verbatim from source line ~1030, ~150 lines]
```

#### Step 5: Package (ADR-013 pipeline scan)

```bash
# Re-run the audit on the migrated artefact — expect zero violations
aiplatform artefact audit infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html
```

Expected output: ✓ no external fetches, ✓ no API key UI, ✓ size < 200 KB, ✓ no CDN imports.

#### Step 6: Pair (skill ↔ workbench)

Workspace mount logic in `frontend/src/app/chat/[...path]/page.tsx`:

```tsx
const showKineBot = isAnonymousGroupAuthMode() && skillSlug === "kinebot-kinematics-tutor";
// ...
{showKineBot && (
  <KineBotFrame
    sandboxOrigin={SANDBOX_ORIGIN}
    sessionId={sessionId ?? agentSessionId}
  />
)}
```

Same gate-pattern as Boldkast / LED Planck. `KineBotFrame` is the host wrapper.

#### Step 7: Test
- Group-ID join → lesson picker shows "Kinematics Tutor (NCERT)" → click → workspace mounts KineBot
- Pick a topic in sidebar → agent sees `kind: "kinebot.topic-change", topic: "projectile-motion"` in `mcp_app_context.kinebot.state` on next turn
- Run a sim with specific params → agent can reference them
- Take a quiz question → progress reflected in snapshot

### Snapshot shape

```typescript
interface KineBotSnapshot {
  lastEvent: string;
  currentTopic: string;        // e.g. "projectile-motion"
  topicsVisited: string[];     // cumulative set of topics the student has explored
  lastSimRun: {
    simType: string;
    params: Record<string, number>;
  } | null;
  currentGraph: string | null; // 'x-t' | 'v-t' | 'a-t' | 'range-angle' | 'max-height' | null
  quizProgress: {
    topic: string;
    attempts: number;
    correct: number;
  }[];
}
```

### Card labels (English, per artefact's curriculum)

| Event | Card label |
|---|---|
| `kinebot.topic-change` | `Switched to <topic>` |
| `kinebot.sim-run` | (no card — too frequent; would clutter chat. Snapshot still updates) |
| `kinebot.graph-change` | `Viewing <graph-type> graph` |
| `kinebot.quiz-attempt` (correct) | `Quiz: correct on <topic>` |
| `kinebot.quiz-attempt` (incorrect) | (no card — pedagogical silence; student should reflect, not see "you got it wrong" from the platform) |

### Migration runbook (the contribution to `.claude/skills/mcp-app-artefact/`)

This sprint adds a new section to the mcp-app-artefact skill: **"External-artefact migration runbook (post-2026-05-24)."** Seven steps mirroring the brief's workflow:

1. **Audit** — run `aiplatform artefact audit <path>` against the source HTML. Identify direct API calls, key inputs, external imports, size violations.
2. **Strip** — delete direct API calls, API key UIs, sessionStorage of secrets, external imports. Replace embedded chat with deletion (workspace doesn't carry chat; AIPLA chat surface does).
3. **Wire** — add JSON-RPC envelope helpers (`rpcNotify`, `rpcRequest`, ping responder, `ui/initialize` handshake). Wrap existing event hooks (button clicks, state changes) in `ui/update-model-context` notifications with artefact-namespaced `kind` field.
4. **Extract** — system prompt → `backend/skills/templates/<slug>/SKILL.md`. Preserve verbatim. Add frontmatter (displayName, slug, initialMessage, tool_configs).
5. **Package** — re-run `aiplatform artefact audit` against the migrated file. Expect zero violations.
6. **Pair** — create skill-to-workspace binding in `frontend/src/app/chat/[...path]/page.tsx`. Add a `<XyzFrame>` host wrapper following the Boldkast / LED Planck / KineBot pattern.
7. **Test** — vitest cases for host wrapper event routing; manual end-to-end with the actual artefact in LOCAL_MODE.

This runbook becomes the canonical checklist for v2's `student-as-creator` skill and any future teacher-built or DK-style externally-authored artefact onboarding.

### Files to create

| File | Purpose | LOC est. |
|---|---|---|
| `infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html` | Migrated artefact (post-strip + post-wire) | ~1500 (from ~1707 — removed chat panel + API key UI offsets the added JSON-RPC helpers) |
| `infrastructure/mcp-sandbox/artefacts/kinebot/v1/quizzes/*.json` | Pre-generated quiz bank, one file per topic (11 topics) | ~3000 LOC across 11 files (~30 Qs × 11 topics) |
| `frontend/src/components/workspace/KineBotFrame.tsx` | Host wrapper, thin like Boldkast/LED-Planck | ~300 |
| `frontend/src/components/workspace/__tests__/KineBotFrame.test.tsx` | 12+ vitest cases | ~250 |
| `backend/skills/templates/kinebot-kinematics-tutor/SKILL.md` | Skill template with extracted KineBot system prompt + frontmatter | ~150 |
| `cli/aiplatform/commands/artefact.py` | New CLI family — `audit` subcommand | ~80 |
| `cli/tests/test_cli_artefact.py` | Test for the audit CLI | ~60 |
| **Append to** `.claude/skills/mcp-app-artefact/SKILL.md` | "External-artefact migration runbook" section | ~120 LOC delta |

### Files NOT to create

- New `StaticArtefactFrame` variant — KineBot reuses the existing one.
- New chat surface — original artefact's embedded chat is **deleted**, replaced with the AIPLA chat that's already there.
- New model router code — gemini-3.5-flash default applies.

## API Changes

**None.** All endpoints already exist (same as LED Planck).

## Migration

### From original Anthropic-keyed version to AIPLA-compliant

- **Data:** none. KineBot is stateless across sessions (was per the original's sessionStorage; we keep it that way per brief step 5).
- **DK's existing beta users:** none yet (the brief flags this as "beta cohort: DK's students (Indian, ~100s available)" — not yet live). So we deploy fresh, not in parallel with an active user base.
- **Feature flag:** none. Either it ships or it doesn't.
- **Rollback:** revert. The original artefact isn't deployed in AIPLA today; nothing to fall back to.

## Testing Strategy

**Frontend (vitest):**

- `frontend/src/components/workspace/__tests__/KineBotFrame.test.tsx` (new, ~250 LOC):
  - mounts at correct sandboxOrigin + artefactPath
  - routes `kinebot.topic-change` → snapshot.currentTopic updates; topicsVisited appends (dedup)
  - routes `kinebot.sim-run` → snapshot.lastSimRun updates; no card dispatched (high frequency)
  - routes `kinebot.graph-change` → snapshot.currentGraph updates; card dispatched
  - routes `kinebot.quiz-attempt` (correct) → quizProgress.correct++; card dispatched
  - routes `kinebot.quiz-attempt` (incorrect) → quizProgress.attempts++; **no card** (pedagogical silence)
  - rejects events from wrong origin (inherited from StaticArtefactFrame)
  - cleans up on unmount
- Existing `BoldkastSimFrame.test.tsx` + `LedPlanckLabFrame.test.tsx` (1.C): unchanged.

**Backend (pytest):**

- `backend/tests/unit/test_kinebot_skill_template.py` (new):
  - SKILL.md loads cleanly; instructions body matches the extracted KineBot system prompt
  - `tool_configs.defaults` opts out of artefacts + memory
  - `tool_configs.mcp.allow_context_writes` includes `"kinebot"`
- `backend/tests/api_tests/test_workspace_observability.py`: +1 case — iframe-context POST with `serverId: "kinebot"` + KineBotSnapshot payload, assert agent prompt block contains current topic + latest sim params.

**CLI (pytest under `cli/tests/`):**

- `cli/tests/test_cli_artefact.py` (new):
  - `aiplatform artefact audit <path>` on a fixture with `fetch(` calls → reports violation
  - `aiplatform artefact audit <path>` on a clean fixture → exits 0 with all-green output

**Sandbox (vitest):**

- `infrastructure/mcp-sandbox/__tests__/serve.test.ts`: +1 case — `GET /artefacts/kinebot/v1/index.html` returns 200 with ADR-013 CSP

**ADR-013 pipeline scan (blocking, manual):**

```bash
# Before original migration (expect 3 violations):
aiplatform artefact audit ~/Documents/clients/cph-uni/sources/"kinebot_v2 (3).html"
# Expected: 3 fetch() calls, 1 API-key UI flag, 3 CDN imports — confirms what the brief documented

# After migration (expect 0 violations):
aiplatform artefact audit infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html
# Expected: zero violations, size < 200 KB
```

**Joint sign-off (manual, blocking):**

- **AR review** — pedagogical scaffolding intact post-migration; Socratic prompt + sim accuracy preserved
- **DK review** — curriculum coverage matches NCERT/CBSE Class 11 expectations; quiz bank quality vetted; ready for Indian student beta

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | `aiplatform artefact audit` CLI command | `cli/aiplatform/commands/artefact.py` + tests | 0.3 d |
| 2 | Audit original artefact (dogfood the new CLI) | (no edits) | 0.05 d |
| 3 | Strip + wire KineBot artefact | `infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html` | 0.6 d |
| 4 | Generate quiz bank (11 topics × ~30 Qs, DK-vetted) | `infrastructure/mcp-sandbox/artefacts/kinebot/v1/quizzes/*.json` | 0.3 d |
| 5 | `KineBotFrame` host wrapper | `frontend/src/components/workspace/KineBotFrame.tsx` | 0.4 d |
| 6 | Vitest suite for host wrapper | `__tests__/KineBotFrame.test.tsx` | 0.3 d |
| 7 | Skill template + extract system prompt | `backend/skills/templates/kinebot-kinematics-tutor/SKILL.md` | 0.2 d |
| 8 | Backend + sandbox test extensions | `test_kinebot_skill_template.py`, `test_workspace_observability.py`, `serve.test.ts` | 0.15 d |
| 9 | Mount in chat page workspace | `frontend/src/app/chat/[...path]/page.tsx` | 0.1 d |
| 10 | **Migration runbook** in mcp-app-artefact skill | `.claude/skills/mcp-app-artefact/SKILL.md` (+120 LOC delta) | 0.2 d |
| 11 | AR + DK joint review | (no edits) | 0.3 d |
| 12 | Smoke + manual end-to-end | (no edits) | 0.15 d |
| | **Total** | | **~3.05 d** |

## Success Criteria

- [ ] Migrated artefact at `infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html` serves at 200 with ADR-013 CSP; size < 200 KB.
- [ ] `aiplatform artefact audit` on the migrated file returns zero violations (vs 3+ on original).
- [ ] All four event types (`topic-change`, `sim-run`, `graph-change`, `quiz-attempt`) route through the spec-compliant `ui/update-model-context` envelope to the host wrapper.
- [ ] `ui/initialize` handshake completes on artefact load.
- [ ] Quiz bank lookup works via same-origin `fetch('./quizzes/<topic>.json')` — no AI quiz-generation, no external fetches.
- [ ] System prompt extracted verbatim into the SKILL.md; loads under the 10K char cap.
- [ ] Vitest: 12+ cases on `KineBotFrame.test.tsx` pass.
- [ ] Pytest: skill-template + workspace-observability extension cases pass.
- [ ] `npm run quality:check` green; `cd backend && make lint && make test-fast` green.
- [ ] Lesson picker shows "Kinematics Tutor (NCERT)" alongside Boldkast + LED Planck (post-1.B/1.C/1.D).
- [ ] Migration runbook section appended to `.claude/skills/mcp-app-artefact/SKILL.md`.
- [ ] AR + DK joint sign-off recorded — pedagogical scaffolding preserved + curriculum coverage validated.
- [ ] Smoke test confirms agent reply references current topic + latest sim params within 1 turn.

## Out of Scope (deferred)

- AI-regenerated adaptive quiz — ships with deterministic pre-generated bank in v1; AI-adaptive is v2.
- Cross-session progress persistence — within-session via localStorage is enough for v1.
- Hint system overhaul (structured scaffolding for struggling students) — stretch goal in the brief, v2 here.
- Accessibility audit (font size bump, WCAG AA contrast, keyboard nav) — v2.
- Translation to other languages — KineBot is English / NCERT; that's the curriculum match. Multi-language is v2.

## Related Documents

- **Source of truth (pedagogy + migration brief):** [`kinebot-migration-brief.md`](../../_scoping-snapshot/prototypes/kinebot-migration-brief.md) in scoping site
- [SEQUENCE.md](SEQUENCE.md) row 1.D
- [led-planck-skill.md](led-planck-skill.md) — 1.C; establishes the second-artefact-through-the-pipeline pattern this builds on
- [teacher-permission-model.md](teacher-permission-model.md) — 1.A; KineBot becomes assignable to a teacher's class once this lands
- [lesson-picker.md](lesson-picker.md) — 1.B; how students discover this lesson
- [boldkast-mcp-app.md](../v0.1.0-jutland/boldkast-mcp-app.md) — first artefact, the reference pattern
- [implemented/mcp-app-iframe-spec-compliance.md](implemented/mcp-app-iframe-spec-compliance.md) — the spec-compliant artefact path this uses
- [.claude/skills/mcp-app-artefact/SKILL.md](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — the AIPLA artefact-onboarding recipe; **this sprint adds the external-artefact migration runbook section**
- [ADR-013](../../_scoping-snapshot/architecture.qmd#adr-013-artefact-safety-content-review-pipeline-for-generated-html) — artefact safety / sandbox / CSP
- [ADR-014](../../_scoping-snapshot/architecture.qmd#adr-014-per-group-per-class-budget-enforcement) — budget enforcement, the rule the original KineBot violated

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
