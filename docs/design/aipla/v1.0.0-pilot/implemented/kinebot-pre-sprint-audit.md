# KineBot pre-sprint audit — does the skill drive this port cleanly?

**Status**: Audit (pre-implementation dry-run)
**Pairs with**: [`kinebot-migration.md`](kinebot-migration.md) (the migration design doc),
[`.claude/skills/mcp-app-artefact/SKILL.md`](../../../../.claude/skills/mcp-app-artefact/SKILL.md) (the porting skill, updated 2026-05-27 with the LED Planck workspace-integration learnings)
**Source surveyed**: `/Users/voightkampff/dev/sunholo-data/aipla/assets/examples/kinebot-v2.html` (1706 lines, 96 KB)
**Brief**: `/Users/voightkampff/dev/sunholo-data/aipla/strand-a-pedagogical-bot/prototypes/kinebot-migration-brief.md`
**Created**: 2026-05-27

## What the audit is

Before we sprint-plan + execute the KineBot port, classify every surface of the external artefact against the skill's **Iframe scope rule** (added today after LED Planck shipped at 5/10 integration quality). Identify any skill gaps that would let the same "wrap all roles into one app" mistake happen again, and close them BEFORE writing code.

## Panel inventory + classification

KineBot ships as one HTML file with these surfaces:

| # | Surface | Lines | Today | Disposition | Why |
|---|---|---|---|---|---|
| 1 | **Header** chrome (logo, title, Quiz Mode toggle, Clear, Voice mic) | 303–323 | iframe | **DELETE** | AIPLA host provides chrome via `WorkspaceShell` + chat-page header. The quiz-mode/clear/voice buttons relate to chat, which moves out entirely. |
| 2 | **Sidebar topic picker** (11 topics + section headers) | 328–352 | iframe | **React workbench** | Pure navigation. Render in React at app-width with proper styling. Click → `sendNotification("kinebot.set-topic", {topic})` to drive the iframe canvas. |
| 3 | **XP progress bar** (gamification) | 345–351 | iframe | **React workbench** | Display-only, derived from snapshot. |
| 4 | **Sim panel** — canvas + selector + sliders (V/A/Angle/V₂) + play/reset + live stats (Pos/Vel/Time/Accel) | 361–397 | iframe | **KEEP in iframe** | Canvas pointer events; live state binding; the actual interactive sim. |
| 5 | **Tab: Chat** — messages + quick-prompt bar + textarea + send button (Anthropic direct call at ~1056, ~1120) | 409–417 | iframe | **DELETE** | AIPLA chat surface owns this. Brief explicitly chose option (b): remove entirely. |
| 6 | **Tab: Formulas** — static formula-sheet grid keyed by topic | 420–422 | iframe | **React workbench** | Pure static lookup. No canvas, no pointer interactivity. |
| 7 | **Tab: Quiz** — AI-MCQ panel (Anthropic direct call at ~1558) | 425–427 | iframe | **KEEP in iframe** + replace AI gen with static JSON bank | Interactive choice-clicking; coupled with current topic + sim state. Quiz data switches from runtime LLM call to `fetch('./quizzes/<topic>.json')` (same-origin, allowed). |
| 8 | **Tab: Graph** — selector + numeric inputs (u, a) + Plot button + "🤖 Explain" button + canvas + legend | 430–450 | iframe | **KEEP in iframe** (drop "Explain" button) | Canvas plotting depends on parameter inputs. "Explain" was a chat trigger → delete. |
| 9 | **Tab: Notes** — toolbar + tag input + textarea + saved-notes list | 452–464 | iframe | **React workbench** | Pure textarea + save. Persist to `sessionStorage` keyed by `(skillId, sessionId)`. No reason for the sandbox. |
| 10 | **API key UI** (modal/input that asks the student for an Anthropic key) | various | iframe | **DELETE** | AIPLA handles auth; no key needed. |
| 11 | **Google Fonts CDN imports** (3 `<link>` to `fonts.googleapis.com`) | head | iframe | **DELETE** | System font stack instead. CSP-cleaner. |

### Outcome (post-migration shape)

**Iframe** (the actual sim): sim canvas + sliders + stats + Graph panel + Quiz panel. ~5 of 11 surfaces. Estimated ~600 LOC of HTML/JS after stripping (down from 1706).

**React workbench**: sidebar topic picker, XP progress, formula reference, notes textarea. Plus the `KineBotLabButton` launcher and the `WorkspaceShell` resize handle.

**Deleted**: embedded chat panel, "🤖 Explain" button, header chrome, API key UI, all 3 direct Anthropic fetch calls, Google Fonts CDN.

**Chat**: AIPLA chat surface (same as Boldkast + LED Planck).

## Skill gaps surfaced by the audit

Walking the existing skill section by section against the KineBot mapping, three gaps come up:

### Gap 1 — Host → artefact notifications are undocumented

The skill's "Workspace integration" section documents the iframe → host direction beautifully (`ui/update-model-context` notifications, the JSON-RPC envelope, the `kind`-namespaced events). But the **host → iframe** direction — which KineBot's port absolutely needs (the React sidebar picks a topic, the iframe canvas needs to know about it) — is only mentioned via the `chat-flush` example, with no general guidance.

KineBot needs:
- `kinebot.set-topic` — host → iframe when the React sidebar topic is clicked
- (possibly) `kinebot.set-graph-mode` — host → iframe if the graph selector also moves to React

Without skill guidance, the port might rebuild a custom postMessage channel or duplicate the topic-picker inside the iframe to avoid the question.

**Fix**: add a new subsection "Host → artefact notifications" under Workspace integration. Document `StaticArtefactFrame.sendNotification(method, params)`. Reference `chat-flush` as one example. Establish the convention `<artefact>.set-<thing>` for state-push notifications.

### Gap 2 — No "external-artefact migration runbook" section

The skill covers authoring a *new* artefact from scratch beautifully (template scaffold, `_template/v1/index.html`, the LLM prompt for generating one). But it has nothing on *porting* an externally-built one. KineBot is the explicit first case of that workflow; jitt.dk's 23 apps will need the same.

The kinebot-migration design doc already proposes the 7-step runbook (Audit → Strip → Wire → Extract → Package → Pair → Test) as a sprint deliverable. **Land that runbook in the skill BEFORE the sprint**, not as a sprint output — so the sprint plan can reference it as the playbook rather than producing it.

**Fix**: add a new section "External-artefact migration runbook" with the 7 steps, each with concrete commands and grep recipes. Make it self-contained enough that someone with no prior context can run it against a new external artefact and produce a compliant port.

### Gap 3 — The "iframe scope rule" examples are LED-Planck-centric

The skill's current iframe-scope-rule examples are: lesson instructions, problem statements, sim-derived progress checklists, big static help text panels. All from LED Planck. KineBot's audit surfaces three more categories that should be explicit:

- **Topic / mode pickers / sidebar nav** — belong in React. Drive iframe state via host → artefact notifications.
- **Formula / reference content** — belong in React. Static lookup, no sandbox needed.
- **Notes / sketchpad surfaces** — belong in React. Standard form controls; persist to `sessionStorage` or an AIPLA endpoint.

**And explicitly call out the "delete" category** — surfaces that exist in external artefacts but have NO place anywhere on AIPLA:
- **Embedded chat panels** — always delete (AIPLA chat surface owns chat)
- **Auth chrome / API-key inputs** — always delete (AIPLA handles auth)
- **Header chrome / logo / branding** — always delete (AIPLA host provides chrome)
- **External AI calls** (`fetch('https://api.anthropic.com', ...)` and similar) — always delete or route through AIPLA backend

**Fix**: extend the "Iframe scope rule" examples with KineBot's three categories + add an explicit "DELETE category" sub-list. The current "Common mistakes" / "Keep in the iframe" bullets cover the spirit but external-artefact ports need a sharper checklist.

## Recommendation

Do a **small pre-sprint skill update** (sometime today / tomorrow, ~150 LOC delta to the skill file). Then sprint-plan + execute the KineBot port with the upgraded skill as the playbook.

This mirrors the LED Planck integration follow-up — except we apply the fix BEFORE the port instead of after.

### Sequence

1. **Skill update** (this audit + a small commit):
   - New subsection "Host → artefact notifications" under Workspace integration
   - New section "External-artefact migration runbook" with the 7 steps
   - Extended "Iframe scope rule" examples + an explicit DELETE category
   - Quote KineBot as the case study where helpful
2. **Sprint plan** for KineBot 1.D using the upgraded skill (mostly existing kinebot-migration.md content; add references to the new skill sections)
3. **Execute** the sprint

### Why this order

- The kinebot-migration.md doc *plans* to add the migration runbook to the skill as a sprint deliverable. If the runbook arrives at the END of the sprint, the sprint itself can't use it as guidance.
- The 5/10 LED Planck integration is the case study for "skill gaps cost us a follow-up sprint." Catching the gaps before the next port is the whole point of the audit.
- A 150-LOC skill update is a one-hour task. The KineBot sprint is 2–3 days. The 1-hour pre-investment is well-rated.

## Open questions

- **Notes persistence**: KineBot's notes feature is in the brief as "stretch (post-beta)". Do we ship it in 1.D or punt to v1.1? The audit assumes it ships in React (small effort once we're already touching the workbench).
- **Quiz format**: brief calls for a "pre-generated quiz bank" replacing the AI quiz. Owner: DK to vet content. Block on DK availability or ship with a minimal placeholder bank (~3 questions per topic) and iterate?
- **The CLI `aiplatform artefact audit` command** — the migration doc plans this. Genuinely useful for jitt.dk's 23 apps later. Ship it as part of 1.D or defer to a small follow-up sprint? Adds ~0.3d to 1.D estimate.

## Next action if approved

Run a short "skill-prep" sprint: ~150 LOC skill update + this audit committed. Then start KineBot 1.D against the upgraded skill.
