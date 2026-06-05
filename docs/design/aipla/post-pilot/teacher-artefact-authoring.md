# Teacher artefact authoring — code-level editing with AI assist

**Status:** Roadmap signal — **not committed to build**. Aspirational stub for feedback + Year-2 planning.
**Target:** v2 / Year-2 — explicitly **outside** the current 4-month contract window (2026-05-15 → 2026-09-15).
**Audience:** AIPLA contract leadership; Year-2 / Year-3 research-programme owners.
**Scope question:** *"Can a teacher fix a rendering bug in Boldkast or build a new sim themselves, without us writing every line?"*
**Created:** 2026-05-25
**Last Updated:** 2026-05-25

## Why this exists as a doc, not as code

This is the **third tier** of teacher control over artefacts, after teaching goal (v1) and bounded parameters ([teacher-artefact-parameters.md](teacher-artefact-parameters.md), v1.1). It's the *biggest* lever — and the *highest* risk.

The strategic vision (from the 2026-05-25 conversation): AIPLA scales by *assisting teachers in creating content using their own skills*, not by becoming a bottleneck of physics-based simulations. That's a Year-2+ research outcome — not a contract-window deliverable. This doc captures the direction so the v1 design choices don't paint us into a corner.

The good news: the `.claude/skills/mcp-app-artefact` skill *already encodes the authoring guardrails* (ADR-013 security gates, 200KB cap, CSP/sandbox flags, library-bypass review). The path to teacher-facing authoring is "surface this skill behind a teacher chat", not "build a new authoring system from scratch."

## What "code-level authoring" actually means

Three sub-capabilities, each with different risk profiles:

| Sub-capability | What teacher can do | Risk surface | Likely UX |
|---|---|---|---|
| **Tier 3a: AI-assisted edit** | Describe a change in chat ("show velocity vectors in red"); LLM edits the artefact source under guardrails | LLM hallucination, prompt injection | Chat with diff preview before publish |
| **Tier 3b: Raw source edit** | Edit HTML / JS / CSS directly in an in-browser code editor | All of 3a + any code the teacher can write | Monaco / CodeMirror split view |
| **Tier 3c: Author a new artefact** | Start from a template, build a new sim end-to-end | All of 3b + "is this artefact pedagogically sound?" | Wizard + AI co-author + review queue |

The mockup at `/teacher/activities/[id]` under the "Code" tab signals **3a + 3b**. Tier 3c is its own design doc later.

## How guardrails work (the entire problem)

"Live with guardrails" is *not* a side concern — it's the design. Without these, teacher-authored code is an institutional liability.

| Guardrail | Enforced by | Catches |
|---|---|---|
| 200 KB artefact size cap | Server-side validator on save | Bloated images, accidental dependency-bundle inclusion (ADR-013) |
| CSP-safe (no external script sources) | AST scan + content-type sniff | Cross-origin data exfil paths |
| Sandbox-iframe-compatible | Static check for `allow-same-origin` requirement | Sandbox-escape attempts |
| No external fetches | Regex + fetch-shape detector | Calls to 3rd-party APIs (privacy, billing) |
| HTML-injection safe | Sanitise any teacher-supplied text rendered by the artefact | Stored XSS via the teaching goal or label fields |
| Per-teacher artefact namespace | `artefacts/<artefactId>/teachers/<teacher_uid>/v<n>/` Firestore path | Cross-tenant blast radius |
| Versioning + draft/publish | Required workflow — never overwrite live | Bad edits affecting in-progress student sessions |
| Pedagogical / accuracy review | **Human** — code can't check this | Physics errors, misleading visualisations, copyright issues, accessibility regressions |

The last row is the hard one. Code catches code problems. Code doesn't catch *"this simulation models gravity wrong"* or *"this is copied from a copyrighted lab manual"* or *"a screen reader can't navigate this."* The deploy model has to be **draft → review queue → publish**, not *"live"* in the literal sense — closer to a CMS than an IDE.

## Why this is **explicitly out of the 4-month contract**

1. **Scope.** This is 6-10 weeks of focused engineering on its own: editor + storage + validators + review queue + versioning + rollback + per-teacher namespacing.
2. **Research design impact.** Year-1 cohorts need to be comparable; if every teacher has their own Boldkast, the research instrument is muddied. v1 / v1.1 must hold the canonical version as the research baseline. Authoring opens *after* the baseline is established.
3. **Support model.** "My Boldkast doesn't work" stops being M's bug and starts being a UCPH ops question. That's a different operations contract — not part of the May→Sep build.
4. **Authoring-skill maturity.** The `.claude/skills/mcp-app-artefact` skill is *new*. Its prompts haven't been red-teamed by non-developer authors. Surfacing it as a teacher-facing chat without that hardening invites a class of failure modes we can't predict.
5. **MCP App ecosystem.** ADR-013 is built for *trusted* first-party artefacts plus a future review pipeline (1.11). The review pipeline isn't built yet. Until it is, teacher-authored artefacts have nowhere to land safely.

## Open questions (for the Year-2 plan)

1. **AI assist or raw editing first?** Raw editing is simpler to build (just an editor + the existing validators); AI-assisted is the higher-leverage capability. Probably ship both, but in which order?
2. **Per-teacher namespace vs class-scoped vs school-scoped?** A teacher's edits affect their classes, their school's classes, or the whole institution? Each has trade-offs around comparability, IP, and ops.
3. **Review queue model.** Trusted teachers ship directly? School admin gates each publish? UCPH-wide review board for substantive changes? The right answer depends on the institutional risk tolerance — JB to scope.
4. **Pedagogical drift control.** Already raised in [teacher-artefact-parameters.md](teacher-artefact-parameters.md); 10× harder when teachers edit code. Canonical pinned versions for research cohorts? Snapshot the live version at session start?
5. **Cost model.** Per-edit Cloud Build (clean, slow, expensive)? Runtime serve from Firestore (fast, novel infra)? CDN-cached signed URLs (in between)? Each affects ops + audit.
6. **What does "AI assist" actually mean?** The `.claude/skills/mcp-app-artefact` skill prompt is the obvious answer, but turning a Claude Code skill into a web chat surface has its own friction (no filesystem, no Bash, no Read — needs adaptation).
7. **Where does student-as-creator (Strand B) fit?** Strand B and teacher-authoring share most of the infrastructure — sandbox, validators, namespace, review. Build them together? Build teacher-only first and let students inherit?

## Pros

- **Aligns with AIPLA's research thesis.** A platform teachers run is precisely this — removing the developer bottleneck for content authorship is the contract's strategic outcome.
- **The Claude Code authoring skill already exists.** `.claude/skills/mcp-app-artefact` encodes the ADR-013 gates and the runbook. Adapting it for a teacher chat surface is real work but not from scratch.
- **MCP Apps protocol isolates blast radius.** A buggy teacher-authored artefact crashes its iframe, not AIPLA. CSP + sandbox are the right primitives for *this exact use case*.
- **Builds the right data flywheel.** Teachers iterate → AIPLA captures telemetry → research learns which authoring patterns improve learning → publish.
- **Student-as-creator (Strand B) shares the infrastructure.** Year-2 student-authored sims get the editor + sandbox + validators for free.
- **Decoupling first-party from authored artefacts** lets AIPLA team focus on platform, not content.

## Cons

- **It's a 6-10 week sub-project.** That cost has to be justified in the Year-2 research plan separately.
- **"Live with guardrails" is the entire problem,** as enumerated above. Underestimating this is the most likely failure mode.
- **Pedagogical correctness is unsolvable by code.** Without a human review queue, teacher-authored content can degrade what students see. Designing that queue is institutional work, not engineering.
- **Comparative research gets harder.** Year-1 baseline matters; authoring opens after that's locked. If we open authoring too early, the research story weakens.
- **Support burden shifts to UCPH ops.** AIPLA contractors don't field "my Boldkast broke" calls in Year-2 — UCPH needs the runbook for that.
- **Copyright / accessibility / IP exposure.** Teachers paste in code from random sources; the institution carries the liability. Needs legal sign-off before launch.
- **Skill prompt-injection.** A teacher chatting with an LLM to write artefact code is a *moderate* attack surface — the LLM can embed code that runs in the sandbox. Sandbox prevents host-page compromise; it doesn't prevent visually misleading physics or leaked teacher PII via clever artefact text.

## Decision criteria — when would we commit?

Build this in Year-2 if **all four** are true:

1. **v1.0.0-pilot has shipped and held up** in the 10-teacher cohort. Year-1 research baseline established.
2. **v1.1 parameters surface ([teacher-artefact-parameters.md](teacher-artefact-parameters.md))** is live and teachers are *still* asking for more.
3. **Review-queue / governance model is signed off by UCPH.** This is the institutional pre-req that can't be skipped.
4. **The `.claude/skills/mcp-app-artefact` skill has been hardened** against non-developer authors. Red-team it with JB / AR or a friendly teacher *before* this ships to a real cohort.

Don't build this if **either**:
- The pilot reveals that authoring is *not* the bottleneck (e.g. teachers want better analytics or session-summary tooling more than code editing).
- The institutional risk appetite for teacher-authored content can't be reconciled with the research design.

## Suggested phasing if we commit

| Phase | What | Estimate |
|---|---|---|
| **A** | Per-teacher artefact namespace + draft/publish API + version history | 1-1.5 weeks |
| **B** | Raw-source editor (Monaco) + the validator pipeline (size, CSP, fetch, AST) | 1.5-2 weeks |
| **C** | Review queue UX (admin approves/rejects, teacher sees status) | 1-1.5 weeks |
| **D** | AI-assist chat surface backed by `.claude/skills/mcp-app-artefact` (preview-diff before publish, AI never publishes directly) | 2-3 weeks |
| **E** | Pedagogical-correctness review tooling (a11y checker, math/physics sanity probes, copyright fingerprinting) | 1-2 weeks |
| | **Total** | **6-10 weeks** |

A, B, C are the safe-default order — together they ship the raw editing tier. D and E follow once the institutional gate is sound.

## Considered and rejected: CopilotKit Open Generative UI

**Date considered:** 2026-05-26. **Verdict:** paradigm mismatch — revisit only as a Tier-3a preview helper inside Phase D.

CopilotKit's [Open Generative UI](https://docs.copilotkit.ai/built-in-agent/generative-ui/open-generative-ui) feature lets an LLM emit a `generateSandboxedUi` tool call with `{css, html, jsFunctions, jsExpressions}` strings; the CopilotKit runtime streams them into a sandboxed iframe and runs them. MIT-licensed, free, mature (31.7k★, v1.57). On its face it looks like a drop-in for "let teachers ask the AI for sims".

Why it does not slot into AIPLA:

| Concern | CopilotKit OGU | AIPLA today (ADR-013) |
|---|---|---|
| Origin isolation | Single iframe `sandbox="allow-scripts"` | Double-iframe separate-origin proxy (`localhost:3457`) — proxy origin blocks host cookies even with `allow-same-origin` |
| External fetches | Explicitly allowed (CDN scripts encouraged) | Blocked — audit-time grep + CSP `default-src 'none'` |
| Size cap | None — model can emit unbounded HTML/JS | 200 KB enforced at commit time |
| Audit trail | None — UI invented per turn | Versioned artefacts under `artefacts/<name>/v<n>/`, `aiplatform artefact audit` CLI |
| Wire protocol | Proprietary `Websandbox.connection.remote.*` | MCP Apps spec-compliant JSON-RPC `ui/update-model-context` |
| Research-baseline guarantee | None — every student sees a different sim | Canonical artefact — cohorts comparable |
| Backend | Node.js `CopilotRuntime` middleware | Python/FastAPI + ADK — integration is a sidecar or a port |

The deeper reason it does not solve our problem: OGU is *agent-invents-throwaway-UI-per-turn*. AIPLA's authoring tier is *teacher-curates-versioned-sim-that-many-students-use-across-a-research-cohort*. LLM-per-turn generation makes the research-baseline problem in section "Why this is explicitly out of the 4-month contract" point 2 strictly **worse**, not better. It also regresses the four security gates above against what ADR-013 already requires.

Where it could legitimately fit, **post-pilot only**:

- **Internal scratch space** for AR / JB / M to prototype sims via chat before promoting one to a versioned artefact. Never student-facing.
- **Phase D AI-assist preview** (Tier 3a): the LLM proposes an edit, OGU's progressive CSS→HTML→JS streaming gives the teacher a "see-what-it-does-before-publish" preview. The published artefact still goes through our existing audit + review queue; OGU is only the preview surface.

Importing the runtime + the security baggage *before* Phase A-C (namespace, draft/publish, raw editor, validator pipeline, review queue) are built would be premature — those phases are the hard parts; OGU is a nice-to-have UX on top.

## Related

- [teacher-artefact-parameters.md](teacher-artefact-parameters.md) — the v1.1 sibling for *bounded* configurability (no code)
- [v1.0.0-pilot/implemented/teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) — current teacher-config surface
- [.claude/skills/mcp-app-artefact/SKILL.md](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — the authoring runbook this would surface as a teacher tool
- Top-level [SEQUENCE.md](../SEQUENCE.md) row 1.11 — `artefact-review-pipeline.md` (the *infrastructure* prerequisite for Tier 3c new-artefact authoring)
- ADR-013 (artefact security gates), ADR-005 (chat log storage), ADR-014 (per-class budget) in the scoping site
- Mockup: `/teacher/activities/[id]` → "Code" + "History" tabs in [activity config page](../../../../frontend/src/app/teacher/activities/%5Bid%5D/page.tsx) — wireframe today, real in v2
