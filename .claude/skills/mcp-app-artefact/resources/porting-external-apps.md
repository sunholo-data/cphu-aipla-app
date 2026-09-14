# Porting a sim from outside AIPLA

For HTML that already exists — a jitt.dk app, a teacher's prototype, a mockup
somebody built in a chat session. Different from writing one from the scaffold:
external artefacts arrive with their own chat panels, API-key UIs, branding and
lesson scaffolding, and roughly half the work is deletion.

> **A port is not a faithful reproduction.** Sources were not built for a
> 700px pane beside a tutor. Improving layout, alignment, responsive behaviour
> and removing dead chrome is **part of the port**, not a later pass. Do not
> preserve bad UX out of faithfulness.

## 1. Audit before touching anything

```bash
SRC=path/to/source.html
wc -c "$SRC"
grep -nE 'fetch\(["'\''`]https://|XMLHttpRequest|new WebSocket' "$SRC"   # strip targets
grep -nE 'apiKey|(session|local)Storage\.setItem.*[Kk]ey'          "$SRC"   # delete targets
grep -nE '<script src="https://|<link[^>]+href="https://|@import url\(https' "$SRC"
grep -nE 'eval\(|new Function\('                                   "$SRC"
grep -nE '<(header|nav|section|main|aside|footer)' "$SRC" | head -40        # surface inventory
```

Write the surface inventory down as a table, every panel marked **keep /
move / delete**:

| Category | Examples | Goes to |
|---|---|---|
| **Keep (iframe)** | the canvas or bench, its controls, its instruments, the chart tied to live state | the artefact |
| **Move** | task lists, constants, problem statements, progress checklists, quizzes, notes, topic pickers | the tutor's `tutorBlock`, or activity elements the teacher configures |
| **Delete** | embedded chat, "ask AI" buttons, API-key UI and settings, its own header/logo/branding, external font + CDN imports, direct LLM calls | nowhere — AIPLA owns all of these |

The **delete** column is not negotiable: AIPLA has exactly one chat, one auth
system and one set of chrome. A second one inside the frame is a bug even when
it works.

## 2. Strip, in this order

1. The embedded chat panel and everything that anchors it (quiz-mode buttons,
   "Clear", voice, "🤖 Explain"). This usually removes the most code.
2. API-key UI and any `setItem(...key...)` persistence.
3. Remaining direct API call sites.
4. Replace LLM-generated content with a static bank — same-origin
   `fetch("./quizzes/<topic>.json")` is allowed and is vetted, deterministic and
   free.
5. External fonts and CDN scripts → system stack / inline.

Re-run the step 1 greps. Every one should be empty.

## 3. Restructure to one simulation

Apply the iframe scope rule. A tab switcher inside the frame is the tell that
more than one surface is in there — KineBot shipped sim + quiz + graph behind
tabs and needed reworking, with an empty default tab rendering a black void.

Move the non-sim surfaces out before wiring anything, or you will wire
telemetry for panels that are about to be deleted.

## 4. Wire the bridge

Do **not** copy the handshake from another sim. Scaffold a fresh artefact
(`scripts/new_sim.sh`) so the `@aipla-bridge` block is stamped from source, then
move the sim's markup and logic into it and add the call sites:

```js
const ARTEFACT_NAME = "<id>";
function emit(type, extra) { return AIPLA_BRIDGE.emit(ARTEFACT_NAME + "." + type, extra); }
…
AIPLA_BRIDGE.init({ name: ARTEFACT_NAME, version: "1.0.0" });
AIPLA_BRIDGE.onChatFlush(() => flushPendingChanges("chat-submit"));
```

Choose event verbs from the fixed vocabulary and label the deliberate commits —
see `event-vocabulary.md`.

## 5. Extract the prompt

If the source embedded a system prompt for its own chat, it does **not** become
a `backend/skills/templates/*/SKILL.md`. Take the part that describes *the
simulation and what its events mean* into the catalogue's `tutorBlock`, and
discard the rest — the activity's tutor already has a persona, a teaching
approach and a lesson goal, and a second prompt competing with those is the
problem this architecture removed.

## 6. Localise

One `strings` object, both languages, nothing user-facing inline. A port is the
cheapest moment to do this — you are already rewriting every label. English-only
is allowed as a recorded decision comment.

## 7. Catalogue and verify

`backend/artefacts/<id>.yaml`, then the full gate set from the main skill:
`audit_artefact.sh`, `make sim-build-check`, the catalogue test, and
`verify_sim.mjs`. Drive it as a student before you merge.

## Anti-patterns

- Fixing the source in place instead of porting the sim core out of it.
- Keeping the embedded chat "as a backup channel".
- Adding a new wire format. Reuse `ui/update-model-context`, `ping`, and
  `<id>.set-*`.
- Preserving the original branding because it looks finished.
- Deferring the 700px check to after the merge.

## Reference ports

- `docs/design/aipla/v1.0.0-pilot/kinebot-migration.md` — KineBot, the first
  stress test of this runbook.
- `docs/design/aipla/v1.0.0-pilot/led-planck-integration-followup.md` — not an
  external port, but the case that produced the iframe scope rule.
- `kettle-efficiency` and `phase-change` (2026-09-14) — mockup → catalogue sim,
  the shortest worked example of the current path.
