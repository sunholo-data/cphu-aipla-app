# Pre-ship checklist — a new or changed sim

Paste into the commit message or PR description. Every unticked line is a
decision you are making on purpose, not a TODO.

Replace `<id>` throughout.

## Run these

```bash
.claude/skills/mcp-app-artefact/scripts/audit_artefact.sh \
    infrastructure/mcp-sandbox/artefacts/<id>/v1        # ADR-013 + structure + theme
make sim-build-check                                    # bridge drift + broadcast floor
cd backend && uv run pytest tests/unit/test_artefact_catalogue.py -q
node .claude/skills/mcp-app-artefact/scripts/verify_sim.mjs <id> --drive
```

- [ ] `audit_artefact.sh` — all gates pass
- [ ] `make sim-build-check` — bridge matches source, sim has a labelled commit
- [ ] catalogue test passes
- [ ] `verify_sim.mjs` — self-test PASS, no page errors, no overflow at 390 / 700 / 1024
- [ ] `--drive` output shows the kinds, labels and `state` you expect on the wire

## The two files

- [ ] `infrastructure/mcp-sandbox/artefacts/<id>/v1/index.html` exists, ≤200 KB
- [ ] `backend/artefacts/<id>.yaml` exists, `id` matches the directory **and** the
      event-kind prefix
- [ ] `status: live` (or `beta` on purpose — a `beta` sim is invisible in the picker)
- [ ] `tutorBlock` says what the sim is, what its events mean, and fences any
      reference values with an explicit never-state instruction
- [ ] `eventVocabulary` lists the verbs the sim actually emits
- [ ] `minViewportPx` set, or deliberately unset because it audits clean at 390px

## Architecture

- [ ] **One simulation** in the iframe. No tab switcher, no second view
- [ ] Task lists, constants, quizzes, notes, pickers are **out** — in the tutor
      or in activity elements
- [ ] Embedded chat, API-key UI, external LLM calls, source branding: **deleted**
- [ ] **No host-side code added** — no per-sim Frame, hook, chat-page branch or
      SKILL.md. (If there is, `host-side-code.md` says why it was unavoidable)
- [ ] The `@aipla-bridge` block was not hand-edited

## Events

- [ ] Every kind is `<id>.<verb>`
- [ ] Deliberate actions use a verb from the proactive vocabulary
      (`run`/`play`, `step`/`next`, `reading`/`measure`/`record`…)
- [ ] At least one **labelled** emit, written in the sim's own language
- [ ] Passive and continuous events are **unlabelled**
- [ ] `state` is the whole snapshot and serialises well under 4 KB
- [ ] Continuous controls buffer until commit; `onChatFlush` is registered
- [ ] No value the student is meant to derive appears in any payload

## Language

- [ ] One `strings` object; no user-facing text inline in markup
- [ ] Canvas text re-drawn on a language change
- [ ] Numbers formatted per locale (Danish decimal comma)
- [ ] Initial language read from `hostContext().locale`, student toggle wins
- [ ] …or a recorded `// locale: en-only, by decision <ref>` comment

## Visual

- [ ] Canonical tokens; light theme; no dark header; no black instrument LCD
- [ ] Body ≥14px, labels ≥11px, nothing smaller
- [ ] Single-column default; no `min-width` above 600px
- [ ] `accent-color` set on range inputs
- [ ] `font-variant-numeric: tabular-nums` on live numbers

## Usability — drive it as a student for 60 seconds

- [ ] On first contact the next step is obvious with no instruction
- [ ] No panel renders a blank void; empty and error states are designed
- [ ] Everything reachable and legible at 390px
- [ ] A student can tell that what they did reached the tutor (the trust card)
- [ ] Nothing confused, cramped or stalled

## Pedagogy

- [ ] Defaults do **not** match the problem's values
- [ ] Answers are revealed only by explicit action, and that action is emitted
- [ ] A domain expert (AR, or another physics reviewer) has seen it — **or** this
      line records that they have not, and why that is acceptable for now

## Ship

- [ ] Both files in one commit, so one push fires the sandbox **and** backend builds
- [ ] After deploy: `curl $SANDBOX_URL/artefacts/<id>/v1/index.html` → 200
- [ ] After deploy: the sim appears in the teacher's SimPicker
- [ ] End to end: attach it to an activity, join as a student, interact, confirm
      the tutor's next turn references the state
      (`make verify-chat-logs GROUP=<code> ENV=dev` for the log half)
- [ ] The live-library table in `SKILL.md` includes it
