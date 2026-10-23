# Pacing and reactivity — a reply you can read, a draft nobody interrupts, and cards that mean something

**Status:** **Design (OPEN)** — **1.1.154**
**Priority:** **P1** for M1–M3 (every student meets them on every turn; cheap, frontend-only) · **P2** for M4–M6 (they need a decision from M or JB first). Not gated by the Google DPA, except M6's measurement, which calls Gemini on dev
**Estimated:** ~5d phased (M0 evidence ~0.25d, M runs the SQL · M1 never interrupt a draft ~0.5d · M2 honest, coalesced trust cards ~0.75d · M3 paced reveal ~0.75d · M4 proactive budget as data ~0.5d · M5 sim pace standard ~0.75d · M6 model-tier measurement + per-skill thinking budget ~1d · M7 release + re-measure ~0.25d)
**Scope:** Frontend: `app/chat/[...path]/page.tsx` (composer lock, proactive trigger), `components/chat/StreamingBubble.tsx` + a new `lib/pacedReveal.ts`, `components/workspace/GenericArtefactFrame.tsx` (`cardLabel`), `hooks/useHumanToolEvents.ts` (coalescing). Backend: `protocols/proactive_routes.py` (one gate, one config read), `db/models/__init__.py` (`SkillConfig`: one optional field), `adk/agent.py` (`_resolve_thinking_budget` gains a per-skill override), `admin/platform_seed.py` (parse the new frontmatter keys). Sims: `kettle-efficiency` and `phase-change` (a speed control). Docs: `.claude/skills/mcp-app-artefact/resources/authoring-prompt.md` (+ `make sim-prompt`). Bench: `scripts/bench-tutor-discrimination.py` (a latency column and a thinking-budget arm). No schema change to activities, no new authoring surface
**Dependencies:** [1.1.105 tutor-turn-taking-and-closure](tutor-turn-taking-and-closure.md) (open, **the content of a turn**, which this doc does not touch); [1.1.90 bounded-tutoring-answer-trees](bounded-tutoring-answer-trees.md) (the question budget, a sibling problem); [proactive-sim-reactive-tutor](implemented/proactive-sim-reactive-tutor.md) (**shipped**: the gates M1 and M4 extend); [1.1.149 tutor-directs-to-workbench](tutor-directs-to-workbench.md) (implemented, unreleased: the per-turn nudge, which raises how often the tutor mentions the workbench); [1.1.53 group-shared-session-sync](group-shared-session-sync.md) (the queued-message mechanism M1 reuses); [1.1.142 retry-then-escalate](retry-then-escalate.md) (`tutor_chain`, which M6 must not break; and its **open M3**, per-activity `modelTier: smart`, which is the per-activity half of the tier question M6 measures); the **maths-tool** and **Elkedel / sim class report** docs written the same day from the same notes (siblings: see [What this doc deliberately does not do](#what-this-doc-deliberately-does-not-do))
**Created:** 2026-10-22
**Source:** [notes-2026-10-22.md](../../../notes-2026-10-22.md) — M, verbatim: *"needs to be more reactive to the student (Although a flood of notifications). graphs moving too fast."* · *"we have consensus if the model is smarter not fast - the strema is so fast that it outputs one big blob and it was."* · *"the students were trying to answer."* · *"use a smarter model?"*

## Problem Statement

The notes carry four complaints that read as contradictions until the code is read:

1. **The tutor is too fast.** A reply lands as one block of text, not as something
   you read while it arrives.
2. **The tutor is not reactive enough**, and yet **there is a flood of
   notifications.**
3. **The students were trying to answer.** (Low-confidence reading: students were
   typing a reply while the tutor was busy.)
4. **The graphs move too fast.**

Plus one proposed remedy: **a smarter model**, accepted by the room as worth some
speed.

The code shows these are four distinct mechanisms, and that complaints 1 and 2 are not
in tension: **the "flood" is trust cards, not tutor turns**, and in a teacher-built
activity the tutor never reacts to the sim at all (F3, F4). Each mechanism has a cheap
fix that does not depend on the others, so the doc is built as independent milestones.

## Findings

Every finding below is **verified against code** on 2026-10-22 unless marked
*hypothesis*. None is verified against the session's data. Reading prod was not part of
writing this doc. M0 does that.

### F1. Tokens do stream, but nothing paces them, so a short reply arrives as one block

- The backend streams. `ag_ui_adk` runs every turn with `StreamingMode.SSE`
  (`.venv/…/ag_ui_adk/adk_agent.py:727`), and `adk/agui.py:260` forwards each event as it
  comes.
- The frontend renders every delta. `useSkillAgent.ts:469` resyncs the message list on
  each `onMessagesChanged`, and `StreamingBubble.tsx:58` re-renders the Markdown with
  KaTeX on every delta (1.1.147 M0).
- **There is no reveal pacing anywhere.** No typewriter, rate or reveal buffer exists in
  `frontend/src` or `backend`. Text appears exactly as fast as the model produces it.
- The model is the fastest we have. Every tutor skill pins `gemini-3.5-flash-lite`
  (`concept-dialogue/SKILL.md:73`, `kinebot-kinematics-tutor/SKILL.md:90`,
  `led-planck-tutor/SKILL.md:91`, `problem-set-hints/SKILL.md:124`), and thinking is
  **off** on every deployed environment (`cloudbuild.yaml:436`
  `AIPLA_THINKING_BUDGET=0`, `adk/agent.py:226`).
- The reply is short by rule: *"Maximum 3 sentences"* (`concept-dialogue/SKILL.md:136`).

Three short sentences from flash-lite with no thinking are a few dozen tokens, and Gemini
streams those in very few chunks. *Hypothesis, measured by M0 Q3:* the whole reply lands
within a few hundred milliseconds of the first token, so the bubble goes from empty to
full in what the eye sees as one step. That is "one big blob". The stream works. **It is
too fast to read as a stream.**

### F2. The composer locks during every tutor turn, and a proactive turn can start while the student is typing an answer

- `page.tsx:1190`: `inputDisabled = isLoading || error !== null`. `isLoading` is set on
  `RUN_STARTED` for **any** run (`useSkillAgent.ts:474`), including a proactive one that
  the student did not ask for.
- A proactive turn is sent through the same `sendMessage` (`page.tsx:1231-1240`).
- The proactive gate's "don't interrupt" check reads only **sent** messages:
  `last_student_message_at` against `proactive_heartbeat_seconds`
  (`proactive_routes.py:406-412`, default 10 s, `db/models/__init__.py:215`). The gate
  request carries no signal about a draft in the composer
  (`ProactiveEventCheckRequest`, `proactive_routes.py:307-311`).

So a student can press *Run* in the sim, start typing an answer to the tutor's last
question, and have a proactive turn fire 10–30 s later. The composer then locks under
their cursor while the tutor asks a **new** question that may replace the one they were
answering. *Hypothesis:* this is *"the students were trying to answer"*. A second,
simpler reading fits the same lock: students tried to type while the tutor's own reply
was streaming, and could not. M1 fixes both. Whether the half-typed draft survives the
lock is **not verified**; M1's test settles it.

### F3. The "flood" is trust cards, and most of them break the contract the sims were written to

The authoring contract says an unlabelled event is silent:

> *"`label` is the important field. A payload with a non-empty `label` shows the student a
> card in the chat … **A payload without one is silent.**"*
> (`.claude/skills/mcp-app-artefact/resources/authoring-prompt.md:333-339`, the text
> published at `/project/build-a-simulation`)

The frame does the opposite. `GenericArtefactFrame.tsx:85-95` (`cardLabel`) **falls back
to a `key=value` dump of `state`** when there is no label, and `:239` dispatches a card
for any non-null label. The only events dropped are kinds ending `.pause`, `.reset`,
`-error` and `.sync` (`:74-76`). `useHumanToolEvents.ts` does no coalescing.

The Elkedel (`kettle-efficiency`) sim sends `state` on events the contract says should be
silent: `open` (`index.html:1042`), `state-change` (`:844`) and `stop` (`:950`). It
labels only `run` and `reading`. So one boil cycle (set power and volume, run, stop,
capture) puts **up to four cards** in the chat. Two or three of them read like this:

> `power_W=2000, volume_L=1.4, mass_kg=1.4, temperature_C=20, elapsed_s=0, meter_kWh=0, boiling=false, readings_captured=0`

That is a debug line, shown to a 16-year-old as a chat message, several times a
minute. The fallback was added *"so a card still renders for an artefact that hasn't
adopted `label` yet"* (`:82-84`). It has outlived that purpose: the contract now requires
a labelled emit (`authoring-prompt.md:340`).

### F4. In a teacher-built activity, the tutor never reacts to the sim; only the cards do

- Teacher-built activities run `concept-dialogue` (1.1.149 F1,
  `frontend/src/app/teacher/activities/new/page.tsx:34,131`).
- `concept-dialogue` opts in to `proactiveGreet` (`SKILL.md:36`) but **not** to
  `proactiveEventReactive`, which defaults to `False` (`db/models/__init__.py:211`).
- So gate 2 returns `skill opted out` for every sim run (`proactive_routes.py:372-377`).

The student runs the kettle, a card appears, and the tutor says nothing until the student
types. That is the reading that reconciles the notes: **the chat is noisy and the tutor
is quiet at the same time.** "More reactive" and "fewer notifications" are one fix seen
from two sides: fewer machine cards, more tutor turns that are actually about what the
student did.

Where reactive turns *are* on (the bespoke sim tutors KineBot, LED Planck and
problem-set hints), there is **no per-session cap** (`proactive_max_per_session`
defaults to `None`, `db/models/__init__.py:226`; JB retracted "max 2" on 2026-06-03) and
a 30 s cooldown (`proactive_routes.py:86`). A student running variations every 30 s gets
a tutor turn every 30 s.

### F5. Two sims run a live curve at 30–40× real time with no way to slow it

| Sim | Pace | Control |
|---|---|---|
| `kettle-efficiency` (Elkedel) | `TIME_SCALE = 30` (`index.html:798`). 1.4 L from 20 °C to boiling at 2000 W takes ~272 simulated s (4186 × 1.4 × 80 / (0.86 × 2000)), so **~9 s on screen** | none |
| `phase-change` (Faseovergange) | `TIME_SCALE = 40` (`index.html:816`), a live heating curve on a canvas (`:301`, `:955`) | Pause only (`:290`) |
| `sol-jord-maane` | a speed selector (`index.html:414`) | yes |
| `otto-engine` | `SPEED = 90`, chosen *"slow enough to follow"* (`index.html:1543`) | fixed, deliberately slow |

*Inferred:* "graphs moving too fast" is the phase-change heating curve, or the kettle's
thermometer and clock, which share the same time compression. Which sim it was is not
recorded (M0 Q1 shows it). The authoring prompt has rules for noise, labels and
debouncing, and **none for how fast simulated time may run** in front of the student
(`authoring-prompt.md`; `grep -i "speed|time scale"` finds only physics, not pace).

### F6. "Smarter" has one measured option, and it is five times the latency axiom

- The platform's latency axiom: *"First token latency: <1s (no tools), <3s (with
  tools)"* (`docs/product-axioms.md:44`).
- The smart tier, `gemini-3.8-flash`, measured on the real tutor prompt: **median first
  token 4.75 s, p90 20.7 s** (`config/models.yaml:46`), which the registry calls
  *"acceptable for compaction, not for a turn a student waits on"*.
- A middle option exists in code and has never been measured: flash-lite **with a
  bounded thinking budget**. `_resolve_thinking_budget` accepts `N>0` (*"cap thinking to
  ~N tokens: bounded latency, some reasoning"*, `adk/agent.py:229-250`), but it reads
  one env var for the whole service. Its docstring names *"per-skill and per-turn …
  budgets"* as the next step (`:251`).
- A per-turn router also exists: `_HeuristicRouter` picks a thinking agent on long or
  multi-question messages (`adk/agent.py:202-215`, `:1153`). It is **unused**: every tutor
  has `thinkingModel: null` or omits it (`led-planck-tutor/SKILL.md:92`,
  `kinebot-kinematics-tutor/SKILL.md:91`).
- The quality cost of the status quo is on record. 1.1.151 F8 logged Danish non-words
  and arithmetic slips (*"170 divideret med 3 giver omkring 56,7"*) on flash-lite with no
  thinking ([seminar-log-follow-ups.md](seminar-log-follow-ups.md) §F8).
- The tutor bench can run any tutor model (`make bench-tutors … --tutor-models`,
  `scripts/bench-tutor-discrimination.py:13`) and has a wrong-claim probe (`:6`). It
  records **no latency** and has **no thinking-budget axis**.
- An env-var change would also need a `cloudbuild.promote.yaml` twin (the footgun table:
  *"Anything per-env in `cloudbuild.yaml` needs a `cloudbuild.promote.yaml` twin"*).
  `AIPLA_THINKING_BUDGET` appears only in `cloudbuild.yaml`.

**So "use a smarter model" is not one decision but a measurement nobody has run**:
flash-lite at 0, flash-lite at a bounded budget, and 3.8-flash, scored on wrong claims
and on first-token latency on the same scenarios.

### F7. Hypotheses, to be tested by M0, not asserted

- H1. Reply text arrives within < 500 ms of the first token on most turns (F1).
- H2. In the session, cards outnumbered tutor turns by a wide margin, and most cards were
  unlabelled fallbacks (F3).
- H3. The activities ran `concept-dialogue`, so no sim-reactive turn fired (F4).
- H4. Some student turns arrived just after a proactive turn, in reply to the
  *previous* question (F2).

## Goals

1. A tutor reply is **readable while it arrives**, at a reading pace, and never slower
   than the student wants (skippable).
2. **A student's draft is never interrupted.** No proactive turn starts while the
   composer holds text, and the student can type while the tutor speaks.
3. **A card in the chat always means a deliberate student action**, worded for a
   student, and a burst of actions shows as one card.
4. Proactive tutor turns run on a **budget that is data**, set per skill, with a
   recorded default.
5. A sim that shows something changing over time can be **slowed down**, and new sims
   are told how fast is too fast.
6. The model-tier question is answered **by measurement**, with the latency and
   wrong-claim cost of each arm on the record before any default changes.

## Decision

### Options considered for pacing (G1)

| Option | For | Against |
|---|---|---|
| **A. Client-side paced reveal** (chosen) | Decouples what the student sees from model speed. Works for every model, including a future local one. Frontend-only, reversible, needs no prompt change | Adds latency to the *end* of a reply, which INSTANT FEEL scores against unless the first word stays immediate |
| B. Slower model as the pacing | "Free" if M6 picks a slower model anyway | Pacing would then change whenever the model does. Thinking time arrives *before* the first token, which is the wait the axiom exists to prevent |
| C. Shorter replies / one question per turn | Fixes overload at the source | Content, not pacing: that is 1.1.105 and 1.1.90. Do not duplicate them |

**A, with three rules.** The first word appears immediately (TTFT unchanged). The reveal
runs at a reading rate (default ~12 words/s, a constant, not a setting). The reveal
never trails the stream by more than ~4 s. A click or tap on the bubble shows the rest at
once. The finalised `MessageBubble` is unaffected, and so are history, the transcript
and voice (read-aloud starts from the full text as now).

### Never interrupt a draft (G2)

The draft is client state, so the client decides. Before `onProactiveTrigger` sends the
sentinel, it checks the composer. If it holds non-whitespace text, the trigger is
**dropped**, not queued. A queued reaction to an event that is now 40 s old is worse than
none, and the student's own message will carry fresh sim state anyway (the flush path,
`GenericArtefactFrame.tsx:188-210`). The drop is logged to the gate as `composing`
(a new optional field on the check request), so M0-style queries can count it.

Separately, the composer stays **typable** while the tutor streams: `inputDisabled` locks
*sending*, not *typing*. A message submitted mid-stream goes through the queued-message
path that already exists for group sessions (1.1.53 M1, `page.tsx:863-880`) and sends
when the turn ends.

### The card rule (G3)

1. **The frame honours the published contract.** `cardLabel` returns `null` when there is
   no `label`, so an unlabelled event is silent. The `key=value` fallback is removed.
   Before removal, an audit lists every catalogue sim whose deliberate commits are
   unlabelled. Any found get a label in the same change, so no sim goes dark.
2. **Coalescing.** Consecutive cards from the same artefact within 8 s collapse into one
   card showing the latest label and a count ("+2"). Coalescing is visual only: every
   push still reaches the backend and the log.

### The proactive budget (G4)

`SkillConfig` gains `proactiveMinSpacingSeconds` (default 30, today's
`PROACTIVE_COOLDOWN_SECONDS`), read by gate 6 in place of the constant.
`proactiveMaxPerSession` stays. This doc **records** the defaults; it does not choose
new numbers, because JB retracted the last one.

**Whether `concept-dialogue` opts in to sim-reactive turns is M's and JB's decision**,
not this doc's (open question 1). The recommendation is to opt in for `completion` and
`measurement_commit` only, which are deliberate and rare, and leave `sim_run` off. The
tutor then reacts to a reading the student took, not to every press of *Run*. It
interacts with 1.1.149's nudge, so it is measured with it (M7).

### Sim pace (G5)

Every sim that animates simulated time offers **½× · 1× · 2×**, with the default chosen
so the event the student must watch takes **≥ ~20 s on screen**. Reported state stays in
simulated seconds, unchanged, so the tutor and the table never see the speed. Kettle and
phase-change get the control. The authoring prompt gets the rule.

### The model tier (G6)

No default changes in this doc. M6 runs the measurement and **adds a per-skill
`thinkingBudget` frontmatter key** (overriding `AIPLA_THINKING_BUDGET` for that skill).
A tier decision then travels through the seed step on **both** pipelines, so it needs no
promote twin. The decision rule M is asked to adopt: **the cheapest arm whose wrong-claim
rate is significantly below flash-lite/0, with p50 first token ≤ 2 s and p90 ≤ 5 s.**
That loosens the axiom for tutor turns, deliberately, as the room's "smarter, not fast"
asks. Paced reveal (M3) is what makes the trade acceptable: a student reading at 12
words/s does not feel 1.5 s of thinking the way they feel a blank bubble. Whether the
axiom itself is amended is M's call (open question 2).

## Milestones

### M0 — evidence (M runs; ~0.25d)

Read-only, prod, `aipla-prod-2026`. `@day` is the session date (not recorded in the
notes) and `@class_id` the class used.

**Q1 — what ran, and what fired, per session.**

```sql
SELECT session_id, ANY_VALUE(skill_id) AS skill, ANY_VALUE(activity_id) AS activity,
  ANY_VALUE(model) AS model,
  COUNTIF(role='user' AND STARTS_WITH(content,'[event_reactive:')) AS reactive_turns,
  COUNTIF(role='user' AND content='[session_start]')               AS greets,
  COUNTIF(role='user' AND NOT STARTS_WITH(content,'['))             AS student_turns,
  COUNTIF(role='assistant')                                         AS tutor_turns
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts)=@day AND class_id=@class_id
GROUP BY session_id ORDER BY student_turns DESC;
```

Tests H3 (`skill` = `concept-dialogue`, `reactive_turns` = 0).

**Q2 — cards per session, labelled vs fallback.**

```sql
SELECT session_id, server AS sim,
  COUNT(*)                                        AS pushes,
  COUNTIF(label IS NOT NULL AND label LIKE '%=%') AS fallback_cards,
  COUNTIF(label IS NOT NULL AND label NOT LIKE '%=%') AS labelled_cards
FROM `aipla-prod-2026.chat_logs.workbench_events`
WHERE DATE(ts)=@day AND class_id=@class_id
GROUP BY session_id, sim ORDER BY pushes DESC;
```

Tests H2. `LIKE '%=%'` approximates the fallback's `key=value` shape. Spot-check
10 rows by eye.

**Q3 — the stream window.** Cloud Logging, `service_name="aipla-v01-frontend"`,
`jsonPayload.event="ttft"`, same day:
`total_response_ms − first_model_token_ms` per turn, p50 and p90, by `skill_id` and
`model_used`. Tests H1. Cross-check `token_out` in `chat_turns` for the same turns.

**Q4 — answers that crossed a proactive turn.** In `chat_turns`, student turns whose
previous row is an assistant turn answering an `[event_reactive:…]` sentinel, sent within
15 s of it. Read 10 by hand: does the student answer the *earlier* question? Tests H4.

### M1 — never interrupt a draft (~0.5d)

- `onProactiveTrigger` drops the trigger when the composer is non-empty, and reports
  `composing: true` on the gate check (new optional field, logged, `extra="forbid"`
  updated).
- `inputDisabled` splits into `sendDisabled` (as today) and a typing state that stays
  enabled during a run. A mid-stream submit takes the queued-message path.
- Test: a draft typed before a proactive trigger is (a) not interrupted, (b) still
  present after any run, (c) sent once, after the run, if submitted mid-stream.

### M2 — honest, coalesced trust cards (~0.75d)

- Audit script: for each `backend/artefacts/*.yaml` sim, list emitted kinds and whether
  each deliberate commit carries `label`. Fix any unlabelled commits in the same change.
- Remove the `cardLabel` fallback. **This ships once, as
  [1.1.155 M1](sim-context-and-class-report.md)** (reconciled 2026-10-22: both docs
  had it). If 1.1.155 M1 has landed, skip this bullet; otherwise do it here and mark
  1.1.155 M1 done. Add coalescing in `useHumanToolEvents` (same artefact, ≤ 8 s,
  visual only).
- `make audit-trust-cards` must still pass. Its rule is "push without card", and an
  unlabelled push is now *deliberately* card-less, so its allowlist semantics may need a
  one-line update. Read `scripts/audit-trust-cards.sh` before changing it.
- Update the authoring prompt only if wording changes. The contract already says this.

### M3 — paced reveal (~0.75d)

- `lib/pacedReveal.ts`: a pure function from (full streamed text so far, ms since first
  token, `revealedAt` clicks) to the visible prefix, at word boundaries, holding open
  math via the existing `holdOpenMath`. Unit-tested with fake time.
- `StreamingBubble` renders the paced prefix. The finalised bubble waits for the reveal
  to finish (or a tap) before swapping, so there is no jump.
- Respect `prefers-reduced-motion`: reveal at once.
- The first word stays at first token. `LatencyHUD` and `tFirstTextChunk` are unchanged.

### M4 — proactive budget as data (~0.5d)

- `proactiveMinSpacingSeconds` on `SkillConfig`, parsed by `platform_seed.py`, read by
  gate 6. Default = today's 30 s, so there is no behaviour change.
- If M and JB decide open question 1: `concept-dialogue` gains `proactiveEventReactive:
  true` plus a kind allowlist (`proactiveEventKinds: [completion, measurement_commit]`),
  enforced in gate 3 against `MEANINGFUL_EVENT_KINDS`. Keep
  `test_proactive_reactive.py`'s set equality.

### M5 — sim pace standard (~0.75d)

- Kettle and phase-change: a ½× · 1× · 2× control (strings in the sim's own string
  object, per the localisation rule). Defaults are chosen so a full run is ≥ ~20 s on
  screen. Reported `elapsed_s` stays simulated.
- Authoring prompt: one paragraph on pace, then `make sim-prompt` and `make check-sim-prompt`.
- `make sim-screenshots ID=kettle-efficiency` and `ID=phase-change` after the look changes.
- **Coordinate with the sibling Elkedel doc**, which changes the same artefact's
  payload. Land one change per artefact, not two racing edits.

### M6 — model-tier measurement (~1d)

- `bench-tutor-discrimination.py`: record first-token and total latency per turn, and
  accept a `--thinking-budgets` axis.
- Per-skill `thinkingBudget` frontmatter: `_resolve_thinking_budget(skill)` reads the
  skill first, then the env var. Parse it in `platform_seed.py`.
- Run on dev, four arms: flash-lite/0, flash-lite/512, flash-lite/1024, 3.8-flash/0.
  Use the existing scenarios plus a short Danish arithmetic-from-the-table probe (the F8
  example), coordinated with the sibling maths-tool doc so the probe is shared, not
  duplicated.
- Write the table into this doc. **M decides.** No default changes in this milestone.
- **This measurement is also the evidence 1.1.142 M3 lacks.** That milestone proposes `modelTier: smart` per activity and accepts 3.8-flash latency for those turns. M6 supplies the latency and wrong-claim numbers either choice needs. Per-skill `thinkingBudget` (here) and per-activity `modelTier` (there) are two knobs on one axis. Ship whichever M picks, not both blindly.
- `tutor_chain` (1.1.142) applies fail-over only when the requested model is the chain
  head. A skill that moves off flash-lite loses fail-over. Say so in the results.

### M7 — release and re-measure (~0.25d)

Ship through test → prod, then re-run Q1–Q4 on the next classroom session. Success
means: the fallback-card count is zero, no reactive turn starts during a draft, and the
stream window p50 shows on screen at reading pace.

## Acceptance criteria

1. With a non-empty composer, no proactive turn starts. The gate log shows `composing`.
2. The composer accepts typing during a tutor run. A mid-run submit sends exactly once,
   after the run.
3. No chat card shows a `key=value` dump. An unlabelled sim event produces no card.
4. Three labelled actions from one sim within 8 s show as one card with a count.
5. A streamed reply reveals at ~12 words/s from the first token. A tap reveals it all.
   Reduced motion reveals at once. TTFT metrics are unchanged.
6. Gate 6 reads `proactiveMinSpacingSeconds`, defaulting to 30.
7. Kettle and phase-change run at ½× / 1× / 2×, and the reported state is identical across
   speeds for the same simulated time.
8. The bench reports latency per arm, and the M6 results table is in this doc.
9. `cd backend && make lint && make test-fast`, `cd frontend && npm run quality:check`,
   `make audit-trust-cards`, `make check-i18n`, `make check-sim-prompt` all pass.

## Tests

- `pacedReveal.test.ts`: fake-timer reveal rate, the max-lag cap, tap-to-reveal, held
  math, reduced motion.
- `page` composer test: a draft survives a proactive trigger (drop), and a mid-stream
  submit queues and sends once. **Give it a fresh in-memory `localStorage`** (the Node
  22 vs 26 footgun) and run `make test-frontend-ci-node`.
- `GenericArtefactFrame` test: unlabelled `state-change` → no card. Labelled `run` →
  card. Three labelled within 8 s → one card, count 3, three pushes.
- `test_proactive_reactive.py`: per-skill spacing is read. Kind allowlist ⊆
  `MEANINGFUL_EVENT_KINDS`.
- `test_agent.py` (or wherever `_resolve_thinking_budget` is tested): the skill
  override beats the env var, and an absent override falls back.
- Sim self-tests: `usefulDeltaT` is unchanged, and `elapsed_s` at a given simulated
  time is identical across speeds.

## Handover to a cloud agent

Start with M1 and M3. Both are frontend-only and need no decision. M2 next: **run the
label audit before deleting the fallback**, or a sim goes silent in a live class. M4's
`concept-dialogue` opt-in, M5's defaults and M6's tier change all wait on M. Do not
guess them.

Read first: the trust-card section of the `workbench-element-builder` skill (cards are
the student's receipt and must not be lost wholesale), the `mcp-app-artefact` skill
(artefact gates, 200 KB cap, `make sim-prompt`), and the 1.1.149 doc's implementation
notes (the nudge interacts with M4).

Footguns that apply here: the Node-version `localStorage` leak (any composer test), the
client-render allow-list (if a new card type is introduced, it is not), and the promote
twin (avoided by design: M6 uses frontmatter, not an env var).

## Open questions for M

1. **Should teacher-built activities react to the sim?** `concept-dialogue` currently
   never does (F4). The recommendation is to react to `completion` and
   `measurement_commit` only. This needs M and JB, and it interacts with 1.1.149's nudge.
2. **What latency will we accept for a smarter tutor?** The proposed rule is p50 ≤ 2 s,
   p90 ≤ 5 s on tutor turns, against the axiom's < 1 s. Is the axiom amended for tutor
   turns, or does it stand and M6 only picks among arms that meet it?
3. **Which sim had the fast graph, and on which day?** Q1–Q4 need `@day` and
   `@class_id`, and M5's priority depends on whether it was the kettle or phase-change.
4. Reveal rate: is ~12 words/s right for Danish 1st-years, or should it be slower? It
   is a constant, so it is cheap to change once observed.
5. "Students were trying to answer": does it match either reading in F2, or was it
   something else (e.g. answering in the workbench instead of the chat)?

## What this doc deliberately does not do

- **The content of a turn:** one question per turn, ending a conversation, question
  budgets. That is 1.1.105 and 1.1.90.
- **Kettle-specific payloads and the sim class report** (time missing, "parameters
  explored" incomplete, too many settings sent to the AI). That is the sibling Elkedel
  doc. This doc owns only the **frame-level** card rule, which applies to every sim.
- **Maths correctness and equations-first replies.** That is the sibling maths-tool doc.
  M6 shares its arithmetic probe, nothing more.
- **Local or EU-hosted models.** Any local model joins M6 later as another arm. The bench
  and `tutor_chain` are data for exactly that reason.
- Notification channels outside the chat (toasts, badges). None were found on the
  student surface. If "notifications" meant something other than cards, open question 5
  reopens this.
