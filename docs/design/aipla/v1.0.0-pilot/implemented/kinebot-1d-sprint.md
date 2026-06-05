# Sprint plan — KineBot 1.D (KINEBOT-1D)

**Sprint ID**: KINEBOT-1D
**Design doc**: [`kinebot-migration.md`](kinebot-migration.md) +
[`kinebot-pre-sprint-audit.md`](kinebot-pre-sprint-audit.md)
**Playbook**: [`mcp-app-artefact/SKILL.md`](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — External-artefact migration runbook (just landed in commit `362c864`)
**Source**: `/Users/voightkampff/dev/sunholo-data/aipla/assets/examples/kinebot-v2.html` (1706 lines, 96 KB)
**Brief**: `/Users/voightkampff/dev/sunholo-data/aipla/strand-a-pedagogical-bot/prototypes/kinebot-migration-brief.md`
**Status**: Approved (2026-05-27)
**Duration**: 2 days (target)
**Estimated LOC**: ~1960 (incl. quiz JSON + tests)
**Branch**: `feature/kinebot-1d` (already created off dev HEAD `362c864`)
**Merge target**: `dev` (no PR per AIPLA workflow; FF-merge at M10)

## Goal

Third physics skill on AIPLA — KineBot kinematics tutor (NCERT/CBSE Class 11), paired with a slimmed iframe workbench (sim canvas + graph + quiz only) and a React workbench surface that owns lesson navigation, formula reference, notes, and progress. Demo-ready before DK's beta cohort can pilot. Establish the external-artefact migration runbook as battle-tested.

## Scoping decisions (locked 2026-05-27)

- **Notes panel:** ships in 1.D React workbench (sessionStorage-persisted)
- **Quiz bank:** ships with placeholder (~3 Q per topic = 33 Qs across 11 topics, generated this sprint and committed as static JSON; DK reviews + replaces post-sprint)
- **`aiplatform artefact audit` CLI:** deferred to follow-up sprint

## Milestones

| ID | Description | Scope | Est. LOC | Deps |
|---|---|---|---:|---|
| M1 | Skill template + cover SVG. `backend/skills/templates/kinebot-kinematics-tutor/SKILL.md` with verbatim SYSTEM_PROMPT extracted from source line 1083 + frontmatter (displayName "Kinematics Tutor (NCERT)", avatar, accessControl public, tool_configs.defaults artefacts/memory false, mcp.allow_context_writes: ['kinebot']). `frontend/public/lesson-images/kinebot-kinematics-tutor.svg` 480×270 cover (kinematics/projectile motif). | fullstack | 230 | — |
| M2 | Strip + slim KineBot lab HTML. Copy source to `infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html`. **Delete:** embedded chat panel + messages + input bar + send button; "Explain with AI" button; quiz-mode/clear/voice header buttons; sidebar topic nav; XP progress; Formulas tab; Notes tab; API key UI; 3 direct Anthropic fetch sites (~1056, ~1120, ~1558); Google Fonts CDN imports. **Keep:** simulation panel (canvas + sliders + stats), Graphs tab (canvas + parameter inputs + Plot button — drop the "🤖 Explain"), Quiz tab (markup only — JS rewritten in M3). Replace external fonts with system stack. **Result:** ~500 LOC of HTML/JS, fits 700px workspace pane after `@media` cleanup. | frontend | -1200 (net delta) | M1 |
| M3 | Static quiz bank. Generate ~3 NCERT/CBSE-Class-11-appropriate MCQs per topic for 11 topics = 33 questions. Format: `infrastructure/mcp-sandbox/artefacts/kinebot/v1/quizzes/<topic>.json` each containing `{topic, questions: [{prompt, options, correct, explanation}]}`. Quiz panel JS in the lab HTML rewritten to `fetch('./quizzes/<topic>.json')` (same-origin, allowed by ADR-013 CSP). DK reviews + replaces post-sprint. | frontend | 600 | M2 |
| M4 | JSON-RPC envelope + handshake + telemetry. Same Boldkast-/LED-Planck-shaped infrastructure: `__post`, `rpcNotify`, `rpcRequest`, `__pendingEmits` queue, `ui/initialize` request on load with `ui/notifications/initialized` post-handshake, ping responder. Public `emit(kind, payload)` auto-prefixes "kinebot." Wire three iframe-emitted events: `kinebot.sim-run {simType, params}` on sim play/param-change (debounced via Phase-2 commit-on-submit on slider drags), `kinebot.graph-change {graphType}` on graph selector change (immediate), `kinebot.quiz-attempt {topic, questionId, answeredCorrectly}` on quiz answer. Add inbound message handler for `kinebot.set-topic` (host → iframe, see skill's Host → artefact notifications section) that updates internal currentTopic + re-renders sim. | frontend | 100 | M3 |
| M5 | KineBotFrame host wrapper. `frontend/src/components/workspace/KineBotFrame.tsx` (~250 LOC) mirroring `LedPlanckLabFrame.tsx`. forwardRef exposes `KineBotFrameHandle { sendChatFlush(), setTopic(topic) }`. Internal `snapshotRef: KineBotSnapshot` (shape from design doc: lastEvent, currentTopic, topicsVisited, lastSimRun, currentGraph, quizProgress[]). Event routing: sim-run silent push (high frequency, no card), graph-change with English card "Viewing <type> graph", quiz-attempt-correct with card "Quiz: correct on <topic>", quiz-attempt-incorrect silent push (pedagogical silence per design doc). `setTopic` method: sends `kinebot.set-topic` notification + updates snapshot.currentTopic/topicsVisited locally + POSTs iframe-context (no waiting for iframe echo, per skill's no-mirror rule). `onSnapshotChange` callback to parent. | frontend | 280 | M4 |
| M6 | KineBotLabButton + KineBotWorkbench React surfaces. **Button** (`KineBotLabButton.tsx`, ~30 LOC) mirrors `LedPlanckLabButton`. **Workbench** (`KineBotWorkbench.tsx`, ~280 LOC) holds: (a) topic picker — sidebar nav with 11 topics grouped Fundamentals + 2D Motion, click pushes through to Frame.setTopic(topic), (b) lesson framing card per topic (~3 sentences each in English), (c) XP progress card derived from snapshot, (d) formula reference card showing the top 2–3 formulas for the current topic from a static map, (e) notes panel (textarea + tag input + save/clear, persisted to `sessionStorage` keyed by `kinebot:notes:<sessionId>`), (f) quiz progress summary from snapshot.quizProgress. | frontend | 350 | M5 |
| M7 | Vitest suite for KineBotFrame + KineBotWorkbench. **KineBotFrame**: ~12 cases mirroring LedPlanckLabFrame.test.tsx — mount, sandbox attrs, close button, the 3 event-kind routes (sim-run silent, graph-change with card, quiz-attempt correct/incorrect), `onSnapshotChange` callback, `setTopic` ref method (asserts sendNotification + iframe-context POST + snapshot mutation), null-session no-push, cross-origin rejection. **KineBotWorkbench**: ~8 cases — renders all six cards in null-snapshot state; topic-picker click calls onTopicChange; notes textarea persists to sessionStorage; quiz-progress card hidden when empty. | frontend | 350 | M6 |
| M8 | Mount in chat page. Add `kinebotFrameRef`, `showKinebotLab`, `kinebotSnapshot` state. Widen `showAiplaWorkspace` gate to include `"kinebot-kinematics-tutor"`. Add the new `skillSlug === "kinebot-kinematics-tutor"` branch with `<KineBotLabButton>` + `<KineBotWorkbench>` default view ↔ `<KineBotFrame>` on click. `useResizableWorkspaceRatio` already there — KineBot opens at 0.65 default (pre-baked in M1 of the resize sprint). Extend handleSend chat-flush to invoke `kinebotFrameRef.current?.sendChatFlush()`. | frontend | 40 | M7 |
| M9 | Backend tests. `backend/tests/unit/skills/test_kinebot_skill_template.py` (10+ cases): template parses, displayName/avatar, accessControl=public, description signals NCERT/CBSE/English, three KineBot prompt markers (kinematics scope, Class 11, Socratic personality), four-step lab phases mentioned, "2-4 paragraphs" or "concise" response constraint preserved, tool_configs opts out artefacts+memory, mcp.allow_context_writes includes 'kinebot', a2ui disabled. `backend/tests/api_tests/test_workspace_observability.py` +1 case for serverId 'kinebot' with KineBotSnapshot, asserting rendered InstructionProvider block carries currentTopic + topicsVisited + a sample sim-run params. | backend | 200 | M1 |
| M10 | Quality gates + FF-merge + reseed. `cd backend && make lint && make test-fast` green; `cd frontend && npm run quality:check` green; ADR-013 grep returns 0 forbidden patterns against migrated artefact (vs 3 fetch + 1 API key UI + 3 CDN imports in original); artefact under 200 KB; no emoji in any new file (per feedback-no-emoticons memory). Rebase + FF-merge feature/kinebot-1d to dev (NO PR). Push origin/dev. Wait for Cloud Build aipla-dev-deploy + aipla-mcp-sandbox-deploy. Trigger reseed via POST /api/proxy/api/admin/seed-platform-skills with SA --include-email token. Verify GET /api/skills (via demo anon-group join) returns 4 entries: problem-set-hints, led-planck-tutor, kinebot-kinematics-tutor (each with avatar), manage-class (teacher-only). | fullstack | 0 | M2, M3, M4, M5, M6, M7, M8, M9 |

## Quality commands

```bash
# Frontend
cd frontend
npm run quality:check:fast   # lint + typecheck + auth-fetch check
npm run test:run             # vitest
npm run quality:check        # full: lint + typecheck + tests + build

# Backend
cd backend
source .venv/bin/activate
make lint
make test-fast

# ADR-013 scan (run after M2 and post-migration verification)
ART=infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html
wc -c "$ART"   # < 200000
grep -nE 'fetch\("https?:|XMLHttpRequest|new WebSocket' "$ART"           # empty
grep -nE '<script src="https?://|<link[^>]+href="https?://' "$ART"        # empty
grep -nE 'eval\(|new Function\(' "$ART"                                    # empty
grep -nE 'apiKey|sessionStorage\.setItem.*[Kk]ey' "$ART"                   # empty
```

## Acceptance gates (carries through M10)

1. **Original artefact violations confirmed.** Manual run of the audit greps on `kinebot-v2.html` source returns the documented violations (3 fetch calls, 1 API-key UI, 3 CDN imports) — proves we're migrating the right thing.
2. **Migrated artefact ADR-013 clean.** Same greps on `kinebot/v1/index.html` return zero. Size < 200 KB. Loads at 200 OK from the sandbox.
3. **Responsive viewport gate.** Open the migrated artefact at 700px width in dev-tools device toolbar — no horizontal scrollbar, no clipped content.
4. **Triad mounted.** `/chat/@aipla-platform/kinebot-kinematics-tutor` shows the launcher button + workbench (topic picker + lesson framing + formulas + notes) by default; click → lab fills the pane.
5. **Topic-driven sim works.** Click a sidebar topic in the React workbench → iframe sim re-renders for that topic. Snapshot's currentTopic updates immediately; topicsVisited dedupes.
6. **Sim events flow.** Drag a slider + press Play → state-change event flushes pending param changes, then sim-run fires. Agent sees current sim params in next turn (verified via iframe-context POST landing in the session state).
7. **Graph events flow.** Switch graph type → graph-change card appears in chat; snapshot.currentGraph updates.
8. **Quiz works + tracks.** Static quiz bank fetches per topic; answering a question fires `kinebot.quiz-attempt`; correct answers card; incorrect silent (pedagogical silence). Snapshot's quizProgress accumulates.
9. **Notes persist.** Type into notes textarea, click Save → reload → notes still there (sessionStorage). Notes never POST anywhere external (verified via Network tab).
10. **All postMessage events match the kinebot.\* namespace.** No leftover `aipla:workbench`-shaped envelopes.
11. **Skill template parses + reseeds.** Post-deploy, `POST /api/admin/seed-platform-skills` returns `created: 1, updated: ...` with kinebot-kinematics-tutor in the created set. Marketplace endpoint shows kinebot alongside the existing 2 public skills.
12. **Boldkast + LED Planck regress unaffected.** Both chat paths still work end-to-end after the deploy.
13. **Tests green.** `npm run quality:check` clean. `make test-fast` clean. New cases: ~12 Frame + 8 Workbench (vitest) + 10 skill-template + 1 observability (pytest).
14. **Runbook validated.** The 7-step migration runbook in the skill drove this sprint successfully. Any rough spots become a small follow-up PR to the skill.

## Non-goals (out of scope this sprint)

- AI-regenerated adaptive quiz (placeholder bank only; DK fills in post-sprint)
- Cross-session progress persistence (sessionStorage only)
- `aiplatform artefact audit` CLI command (follow-up sprint)
- Accessibility audit / font-size pass / WCAG keyboard nav
- Danish translation of the artefact / skill prompt (English correct for NCERT/CBSE audience)
- Hint system overhaul (structured scaffolding) — stretch in the brief, v2
- DK joint sign-off on quiz content quality — DK reviews post-sprint

## Risk and rollback

Single feature branch (`feature/kinebot-1d`), single FF-merge at M10. Surface of change: backend skill template + new artefact + new React surfaces + chat-page wiring + tests. Rollback is `git revert` + redeploy. Boldkast and LED Planck paths are independent and unaffected.

The only real risk is the iframe migration introducing a regression in the sim canvas behaviour — KineBot's sims have specific edge cases the source authors tuned. M2's "strip" pass must NOT touch the sim rendering loop or the canvas init code; only the chat panel + API-key UI + CDN imports + sidebar nav + Formulas + Notes panels get deleted.

## Notes for the executor

- **The skill is the playbook.** Open `.claude/skills/mcp-app-artefact/SKILL.md` and follow the External-artefact migration runbook (steps 1–7) as the literal milestone sequence. M2 = Step 2 (Strip). M4 = Step 3 (Wire). M6 = Step 4-equivalent for React surfaces. Etc.
- **Reference shape:** the LED Planck triad ([LedPlanckLabButton](../../../frontend/src/components/workspace/LedPlanckLabButton.tsx), [LedPlanckWorkbench](../../../frontend/src/components/workspace/LedPlanckWorkbench.tsx), [LedPlanckLabFrame](../../../frontend/src/components/workspace/LedPlanckLabFrame.tsx)) is the structural template. Copy file shape; swap snapshot type, event vocab, labels.
- **`setTopic` is the new pattern.** Previous artefacts didn't push state INTO the iframe; KineBot does. The skill's "Host → artefact notifications" section is the playbook — `kinebot.set-topic {topic}` flows via `StaticArtefactFrame.sendNotification`. The Frame's `useImperativeHandle` exposes `setTopic(topic)` to the React workbench; the iframe-context POST happens in the Frame (not the workbench) so the agent always sees the new topic in one round-trip.
- **No emoji in any sprint-touched file** (per feedback-no-emoticons memory). The KineBot source has plenty (🚀, 📈, 💬, ➤) — strip them in M2 or replace with neutral text. The skill template body (extracted system prompt) likely has 🚀 too; remove it carefully without changing prompt semantics.
- **CSS responsive media query.** The KineBot source uses `grid-template-columns` similar to LED Planck. Add a `@media (max-width: 1100px)` rule that stacks the sim + graph + quiz vertically below 1100px so the artefact fits the 700px workspace pane (or the resize-widened pane).
- **Quiz bank quality.** Placeholder is fine for this sprint, but write the JSON in a shape that DK can edit cleanly: one file per topic, plain JSON, an `explanation` field per question so the placeholder doesn't read totally unrelated. Aim for "passable pedagogically; DK will refine."
- **English copy throughout.** Unlike LED Planck (Danish), KineBot is English for the NCERT/CBSE audience. Lesson framing cards, button labels, card dispatch labels — all English.
- **Velocity reference:** LED Planck 1.C shipped ~1000 LOC in one session; the integration follow-up another ~680 LOC; resize-workspace ~1034 LOC. KineBot at ~1960 LOC over 2 days is comfortably in range.
