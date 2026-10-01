# What the 29 September meeting left open — completion turns, sim chrome, real-session fidelity, model routing, local models

**Status:** Design (OPEN) — **1.1.140**
**Priority:** **P1** for M0–M3 (each is a teacher- or researcher-visible gap from a live session, un-gated) · **P2** for M4–M8
**Estimated:** ~7–9d phased (M0 completion turns ~0.75d · M1 sim chrome ~0.75d · M2 test/dev tutor assignments ~0.25d · M3 real-session fidelity ~1d · M4 persona↔activity contradiction pass ~1.5d · M5 stronger-model fallback ~1d · M6 local-model test plan + run ~1.5d · M7 release plumbing ~0.5d · M8 avatar-upload decision ~0.25d, build only if decided)
**Scope:** Frontend: `lib/proactiveEventCheck.ts`, `components/workspace/GenericArtefactFrame.tsx` + `SimFrameHeader`. Sim authoring: `.claude/skills/mcp-app-artefact/resources/authoring-prompt.md` (→ `make sim-prompt`). Backend: `adk/` prompt composition, `analytics/framework_discrimination.py` + `scripts/bench-tutor-discrimination.py`, `adk/` model call path. Ops: `cloudbuild*.yaml` sandbox trigger, a release-notes script, a tutor-assignment sync script. Research: `research/stx-bench/`
**Dependencies:** [1.1.133 tutor-controls-sims](../v2.1.0-extension/tutor-controls-sims.md) (open, the "tutor manipulates the sim" half, which the meeting put **before** speed and cost work); [1.1.78 question-set-element](question-set-element.md) (open); [1.1.98 teaching-prompt-standardisation](teaching-prompt-standardisation.md) (open); [1.1.107](framework-fit-profile.md) + [BENCH-1/2](tutor-discrimination-benchmark-sprint.md) (**shipped**, the fit-all judge and harness); [1.1.135 teacher-authored-tutors](teacher-authored-tutors.md) (**shipped**, picker-only avatars); [1.1.138](no-crash-across-a-deploy.md) (school-hours promote guard); [1.1.106 cloud-cost-envelope](cloud-cost-envelope.md). **Un-gated**, except that M6's audio half wants the Klaus (Brighton) call
**Created:** 2026-09-30
**Source:** [09-29 meeting summary](../../../09-29_Meeting_AI_Tutoring_Platform_Simulation_UI_Model_Testing_and_Research_Planning-Summary.md) (transcript) and its reconciliation in [notes-2026-09-29.md](../../../notes-2026-09-29.md), "What the transcript adds". Items already done or designed elsewhere are **not** repeated here: sycophancy (praise preamble, v0.1.74), aggregated concepts (1.1.139 + concepts-at-top, v0.1.74), figures in evaluations (1.1.136), screen sizes (instrumented, v0.1.74), translation (1.1.108).

## Problem Statement

The meeting reviewed JB's first classroom run of a teacher-built **Sun–Earth–Moon**
simulation (missions with tiers; the tutor stops questioning at the top tier). It
worked: *"the concept was well understood"*, and tight tutor↔activity coupling was
named as what makes the platform better than a student opening ChatGPT. It left a set
of gaps, several without an owner (the meeting tool's own "AI suggestions" flagged 13).
Verified against code and prod data on 2026-09-30, they come in two groups.

**Group 1: a live-session gap with a concrete cause.**

1. **"The tutor should acknowledge mission completion." It cannot, for any sim.**
   `frontend/src/lib/proactiveEventCheck.ts` lets a sim make the tutor speak on
   exactly three categories: a run (`run`, `play`, `simulate`, `afspil`), a step (`step`,
   `next`, `advance`, `placed`, `calibrated`) and a measurement (`reading`, `measure`,
   `record`, `commit`, `show_value`, `fit`, `spectrum`). **There is no completion verb.**
   A sim that emits `complete`, `finished`, `solved` or `submitted` is inert by
   construction, including one built with the authoring prompt. Teachers then prompt
   the tutor by hand (*"it just records the answers and you have to prompt"*).
2. **Sim menus obstruct the view and cannot be minimised.** JB authored the sim
   from scratch with Claude, **without** the standard authoring prompt. The prompt
   carries the frame conventions, and a sim built with it (a teacher, Eida) *"had
   smoother results"*. But nothing in the platform frame lets a student collapse a
   sim's own chrome either. Together with *"cramped on smaller screens"*, the sim
   surface needs a layout rule, not a per-sim fix.
3. **Test and dev tutors run with no teaching approach.** Verified 2026-09-30: prod
   has all 11 tutors assigned in `tutor_framework_assignments` (Mikkel ESRU, Sofie POE,
   Amina Toulmin, Astrid 5E, Frida accountable talk, Henrik authentic dialogue, Jonas
   CER, the four skill tutors 5E). **Test and dev have zero.** The research-group demo,
   any pre-prod check and every teacher trial on test sees pedagogy prod does not have.
4. **Do the approaches show up in real lessons?** The approach reaches every prod
   turn (`chat_turns.framework_id`, 26–30 Sep; JB's 28 Sep session was Mikkel/ESRU,
   83 turns, 12 groups). BENCH-2 showed the approaches differ, **modestly**, in
   *preview* composition. A real turn also carries activity text, materials, teacher
   focus and history. JB's *"different personas sometimes gave the same answers"*
   is the real-session question BENCH has not asked yet.

**Group 2: named in the meeting, no owner or spec.**

5. **Activity prompt vs persona conflicts.** *"The import process could strip
   personality traits from activities."* If an activity says *"be playful, give hints
   freely"* and the tutor is ESRU, the later instruction wins silently.
6. **Route to a stronger model when the primary fails.** Today a Gemini 5xx is not
   retried (`quota_retry` matches 429 only; 1.1.131 notes a failed turn), and nothing
   escalates a turn the small model cannot handle (*"Flash struggles with some harder tasks"*).
7. **Local / open-source models.** The team *"plans to test local models, focusing
   on speed"*, including whether real-time audio analysis survives the switch. There is
   no test plan (AI suggestion 3).
8. **Release plumbing.** M owes release notes in Teams for v0.1.70–v0.1.74. And every
   `v*` tag fires `aipla-prod-sandbox-release`, so prod's sim host was rebuilt 5× on the
   30 Sep demo day with **identical content**. That is unnecessary churn on the day M was to
   *"avoid pushing platform updates"*. (*"Deployment for UI tweaks is a bottleneck"*
   was deferred by the meeting and stays deferred here, but M7 removes one source of it.)
9. **Avatar uploads.** The meeting *"agreed it is safe for teachers to upload custom
   avatar pictures"*. [1.1.135](teacher-authored-tutors.md) decided (M, 2026-09-28)
   **no upload**: the project ships a set and a teacher picks from it, so there is no
   user-generated student-facing imagery. The two decisions conflict.

## Design

### M0 — Completion is a trigger (~0.75d) · **P1**

- Add a fourth category to `proactiveEventCheck.ts`, **`completion`**:
  `complete`, `completed`, `finished`, `solved`, `submitted`, `mission_complete`,
  `answered_all`. It maps to a new `ProactiveKind` that the tutor prompt already
  understands as *"the student finished something"*. Tests beside the existing
  per-sim mapping table.
- **What the tutor should do on it** (a short block in the sim-event guidance, not a
  new preamble): acknowledge **specifically** what was completed, which is consistent
  with the praise preamble's *name what is right*; ask one reflection or transfer
  question; **honour a stop condition** if the sim's state says the student reached
  its top tier (JB's pattern: no more questions, consolidate).
- Authoring prompt: add `complete` to the trigger list and a *"mission / question set
  finished"* example (`emit("<id>.complete", {label, state:{score, answers, tier}})`).
  `make sim-prompt` republishes it. `make check-sim-prompt` is the gate.
- **Retrofit:** JB's Sun–Earth–Moon sim needs its completion event renamed or added.
  One line, done with JB rather than for him, as a worked example of M1's rule.
- Relation to 1.1.78: the question-set **element** will emit the same verb, so one
  mechanism covers sims and elements.

**What shipped — 2026-09-30** ✅ (frontend + guidance; ⚠️ one line outstanding)

- `proactiveEventCheck.ts`: `completion` category, checked **first** (a kind like
  `quiz-submitted` or `step-complete` reads as "finished"); `answered-all` /
  `mission-complete` match hyphenated too. Per-verb tests, plus an end-to-end test in
  `GenericArtefactFrame.test.tsx`: `<id>.complete` → gate called with
  `eventKind: "completion"` → the trigger reaches `onProactiveTrigger`.
  `verify_sim.mjs` mirrors the list.
- Tutor guidance: `backend/adk/proactive_reactive.py` — the REACTIVE GUIDANCE block
  gives `completion` its own shape (acknowledge specifically, per `praise.md`; one
  reflection/transfer question; **stop condition** at the top tier — consolidate,
  ask nothing). English prose, reply in the session language. New
  `REACTIVE_EVENT_KINDS` names the kinds the guidance covers.
- Authoring prompt: completion verbs in the trigger list, a *mission / question set
  finished* example carrying `tier` / `maxTier`, self-review item 13. Regenerated.
- ⚠️ **Not yet live end to end:** the gate allowlist `MEANINGFUL_EVENT_KINDS` in
  `backend/protocols/proactive_routes.py` still lacks `completion`, so the gate
  answers "event kind not meaningful". That file was being edited in a parallel
  session; the one-line fix is to add `"completion"` (better: import
  `REACTIVE_EVENT_KINDS`). A **strict-xfail** test in `test_proactive_reactive.py`
  flips red the moment it lands — delete the marker then.
- Retrofit with JB: `sol-jord-maane` now emits `complete` (2026-10-01, see the
  note below); JB to check the label and the meaning of `tier`.
- Extra: `GenericArtefactFrame` now sends `ui/notifications/host-context-changed
  {locale}` to a running sim when the student switches DA/EN, instead of the locale
  reaching it only at the next load. No sim listens for it yet; the guest bridge
  would need to merge it into `hostContext()`.

**Note for JB — what changed in `sol-jord-maane` (2026-10-01).** It is your sim, so
please check the wording before it reaches a class; everything below is small and
easy to change.

- **New event `sol-jord-maane.complete`**, sent once each time a student finishes a
  mission (presses *Send svar* on its last step). This is the event that makes the
  tutor acknowledge the finished mission. Its card label reads
  *"Fuldførte mission 2: Afstand eller hældning? – «…svar…» (2 af 5)"*, and on the
  fifth *"… · alle 5 missioner er færdige"*. **Please check that label.**
- **What "tier" means here — please confirm.** The sim has no levels of its own (the
  level is the tutor's diagnosis), so `tier` is *missions finished* and `maxTier` is
  5. At 5 of 5 the tutor consolidates instead of asking further questions. If you
  meant something else by the top tier — one mission's own goal level, say — tell
  us and we change the one function (`Missions.completion`).
- **The final answer now arrives inside `complete`** (`detail.tekst`, and every text
  the student wrote in that mission in `state.answers`), not as a separate
  `answer-commit`. Two tutor-triggering events in the same instant race each other
  at the gate, so one of them would have been lost. `answer-commit` is still in the
  code for any answer that is not a mission's last step. The tutorBlock says so.
- **Indstillinger can now be folded at every width** (it was fixed open above
  860 px) and starts folded below 900 px; *Målinger* also starts folded below
  900 px. Nothing else in the layout moved.
- Not changed: the missions, the quiz, the physics, any Danish text in the sim.

### M1 — Sim chrome the student can get out of the way (~0.75d) · **P1**

- **Platform frame:** `GenericArtefactFrame` / `SimFrameHeader` gain a **focus
  mode** that hides the workspace side panels, and a compact header below a width
  threshold (use `make screen-sizes` data once prod has it to set it).
- **Authoring prompt rule:** a sim's own control panels must be **collapsible**, must
  collapse by default below ~900 px, and must never overlay the visualisation when
  expanded. Add a check item to the prompt's self-review list.
- Tell teachers, via the guide and the build-a-simulation page, to start from the
  standard prompt. JB's sim is the example of what it prevents.

**What shipped — 2026-09-30** ✅ (teacher-guide nudge added 2026-10-01: T2 da+en, R2, `/project/build-a-simulation`)

- **Focus mode** reuses the split's existing "chat hidden" state (ratio 1.0, which
  the chat page already renders as `md:hidden` on the chat column) — no chat-page
  change. `WorkspaceShell` hands the split down (`workspaceLayout.tsx`,
  `WorkspaceLayoutContext`); `useSimFocusMode` applies it for the life of the open
  sim: a toggle in `SimFrameHeader` (md+ only — below md the chat is already a tab),
  remembered **per activity** in `localStorage` (`aipla.simFocus:<activityId>`,
  try/catch); closing the sim hands the chat back; bringing the chat back by the
  "Show chat" tab clears the preference. No toggle where there is no chat (the
  builder preview). Tests use a fresh in-memory `localStorage` per test and pass on
  Node 20.
- **Compact header** below 900px: tighter padding, icon-only close (keeps its
  aria-label). 900 is the prompt's number; revisit with `make screen-sizes`.
- ⚠️ **Interim label:** the toggle reuses the existing `ChatRevealTab.showChat`
  string as a pressed-state toggle ("Show chat", pressed while the chat is shown),
  because new message keys need `frontend/src/i18n/messages.ts`, which was being edited
  in a parallel session. Wanted: `StudentWorkspace.focusMode` (en *Focus on the
  simulation* / da *Fokus på simuleringen*) and `StudentWorkspace.exitFocusMode`
  (en *Show the chat again* / da *Vis chatten igen*).
- **Authoring prompt:** control panels collapsible, folded by default below 900px,
  never overlaying the visualisation; self-review item 14.

### M2 — Test and dev teach what prod teaches (~0.25d) · **P1** · ✅ built

**What shipped — 2026-09-30.** `make sync-tutor-assignments FROM=prod TO=test|dev [GO=1] [PRUNE=1]`
(`backend/scripts/sync_tutor_assignments.py`): one explicit `firestore.Client(project=…)`
per env, diffs on `frameworkId`, a `frameworkId: null` row is copied as a row, writes stamp
`updatedBy: "sync:<from>"` + `syncedFrom` / `syncedFromUpdatedBy` / `syncedFromUpdatedAt`,
`TO=prod` refused without `FORCE=1`, a read failure exits 1 and never reads as "0 rows".
`make deploy-status` now prints `assign <n> rows #<hash>` per env and `ASSIGNMENT DRIFT`
(or `(CANNOT READ)` + no verdict + exit 1). Dry-run on 2026-09-30: prod 11 rows → test 11
adds, dev 11 adds. **Applied 2026-09-30:** `GO=1` run for test and dev; `deploy-status` reports all three envs level (11 rows `#4fc66c51`).

`make sync-tutor-assignments FROM=prod TO=test` (dry-run by default, `GO=1` to write):
copies `tutor_framework_assignments` rows, stamping `updatedBy` as the sync and keeping
the source's author in a field. Run it for test and dev now. Add a line to
`make deploy-status` that reports **assignment drift** between envs, the same shape
as the version drift it already prints, so this cannot silently recur.

### M3 — Fidelity on real sessions, not only previews (~1d) · **P1**

A `--from-sessions` mode for the BENCH harness. It selects prod sessions by tutor, date
and min turns, reads their turns from `chat_turns`, and runs `score_fit_all` (fidelity-r2) plus
the tone probe on each, **blind**. The output is the same per-column report,
rows = the tutor's assigned approach. It reads data only and makes no tutor calls, so cost is
judge-only (~7 calls per session). Run it on 26–30 Sep (Mikkel/ESRU 12 groups,
Henrik, Jonas, Amina). **This is the direct answer to JB's two complaints with his
own sessions.** Guard: group ids never leave the report (ADR-001, group grain only),
and preview-prefixed turns are excluded.

- [x] **Build (2026-09-30)** — `make bench-tutor-sessions` (`scripts/bench-tutor-discrimination.py
  --from-sessions`, logic in `backend/analytics/session_discrimination.py`). Selects
  `teaching_source='tutor'` rows with a framework, student groups only; a session reassigned to
  a second approach inside the window is excluded and counted. Report adds per-row n (sessions
  and groups, small-n flagged) and a tutor-turns histogram; group ids only as a per-run salted
  hash in the gitignored jsonl. **Run awaits go.**
- **Real dry run, prod, 26–30 Sep** (min 6 tutor turns): **14 sessions in 13 groups** — ESRU 7
  (mikkel) · authentic-dialogue 3 (henrik) · 5E 2 (astrid, 1 group) · CER 1 (jonas) · POE 1
  (sofie) · Toulmin 0 · Accountable Talk 0. Excluded: 8 under 6 tutor turns, **7 assigned to
  more than one approach in the window**. 112 judge calls (98 fit + 14 tone), est. **EUR 0.53**
  on `gemini-3.8-flash`. Only the ESRU row clears small-n; the headline will be ESRU's column plus
  anecdote, and the 7 mixed sessions (a tutor switched mid-session) are worth a look by hand
  before the run — they are the closest thing in the data to JB's "different personas gave the
  same answers".
- [ ] **Run:** `make bench-tutor-sessions ARGS="--go --since 2026-09-26 --until 2026-09-30"`

### M4 — Persona ↔ activity contradiction pass (~1.5d) · P2

1. **Detect:** a lint over the *assembled* lesson prompt that flags instructions
   in activity text that set tone, persona or pedagogy (*"be playful"*, *"give the answer
   if…"*, *"act as…"*) and contradict the tutor's approach constructs. A cheap
   analysis-model call at **authoring** time, never per turn, surfaced to the teacher
   as a warning in the activity editor.
2. **Prevent on import:** when an activity is created by the co-pilot or imported,
   strip persona and tone instructions from its teaching goal into a **"suggested
   tutor"** hint instead, as the meeting proposed.
3. Measure with M3 before and after. This is the likely reason real sessions blur the approaches.

### M5 — Retry, then escalate (~1d) · P2

Adapt upstream `backend/adk/resilient_llm.py` (the template's silent-failure family,
[CLAUDE.md "Upstream tracking"](../../../../CLAUDE.md)) rather than writing one:
- retry transient 5xx with backoff, as well as 429;
- **escalate** to the smart tier after a retry fails, or when the turn carries
  an image the tutor must read carefully. *"They couldn't draw the amplitude"* was an
  image-reading turn. Escalation is logged on the chat turn (`model` already is), so
  cost stays visible against 1.1.106.
Not "route every hard question to Pro". There is no Pro in the registry, and first-token
latency on the smart tier (p90 ~20 s) is why students are on flash-lite.

### M6 — Local-model test plan, then one run (~1.5d) · P2

A written plan before any hardware: **metrics** (first-token and full-turn latency
p50/p90 on the real tutor prompt; BENCH-2 fit-all and tone on the same scenarios;
Danish quality on the stx-bench items), **scenarios** (8 BENCH scenarios + an
image turn + a voice turn), **thresholds** (p90 first token ≤ current flash-lite ×
1.5; column-z margin within the flash-lite run's spread; no increase in wrong-claim
sycophancy). Candidates: whichever multimodal open models the summer stx-bench
already ranked at parity with flash-lite. Run on the existing GPU path
(`research/stx-bench/run-local-gpu.sh`). **Real-time audio:** verify that the voice
path's analysis step (not recording, which is separate) meets its latency budget on
the local model. Take the question to the **Klaus (Brighton) call, Thu 13:00**.

### M7 — Release plumbing (~0.5d) · P2 · ✅ built 2026-09-30

> **Built.** `make release-notes FROM=… [TO=…] [ALL=1]` (`scripts/release_notes.py`,
> stdlib-only, tests `scripts/tests/test_release_notes.py`, CI `local-mode-safety`).
> Deviations from the plan below: `build:` is **kept** (as *behind the scenes*,
> with `fix(test)`, `refactor`, `ci` and infra scopes); `docs:`/`test:`/`chore:`
> are excluded unless `ALL=1`; notes are one section per tag, newest first.
> **The sandbox half is a skip step, not `includedFiles`, and needs no
> terraform:** Cloud Build documents the changed-files diff for branch pushes
> only, so for a new tag it is undefined — and a filter that diffed only the
> tagged commit would silently drop a sim change made earlier in the release.
> `infrastructure/mcp-sandbox/cloudbuild.yaml` now starts with `sandbox-changed`,
> which diffs `infrastructure/mcp-sandbox/` (the whole docker context) between the
> **live** image's tag and the new one and compares `ALLOWED_HOST_ORIGINS`; it
> fails open (deploys) on any read it cannot complete. Takes effect on the next
> `v*` tag, since the triggers read the YAML from the tag. See
> [deploy.md](../../../ops/runbooks/deploy.md).

- `make release-notes FROM=v0.1.69 TO=v0.1.74` prints teacher-readable notes
  from conventional-commit subjects, grouped as *teachers / students / researchers /
  behind the scenes*, with `docs:`/`test:`/`build:` excluded. M pastes it into Teams.
  The first run covers what is owed.
- The prod sandbox trigger gets an `includedFiles: infrastructure/mcp-sandbox/**`
  filter (or a no-op check step), so a tag with no sim change does not roll prod's sim
  host. Terraform, applied via `make tf-apply ENV=prod GO=1`.

### M8 — Avatar uploads: decide, then maybe build (~0.25d decision) · P2

A decision for M (with JB), not a build. 1.1.135's reason for picker-only was *"no
user-generated student-facing imagery, and so no policy question"*. The meeting's
*"safe"* needs to answer that question: who may upload, moderation, face or
identifiable-image policy (a teacher photo on a student surface), retention.
**Recommendation:** keep picker-only and **add more shipped avatars**, unless a teacher
has asked for their own face. If uploads are chosen, 1.1.44's upload→GCS→serve pattern
applies, and the design belongs in 1.1.135 as a new milestone.

## Out of scope, with owners

- Monday sessions (Daniel's class, Lisbet/AMSC), the Klaus call, the Firebase-DPA
  interim, the conference and the teacher-education grant: **JB**. Tracked in the
  notes, not engineering.
- A kinaesthetic exercise and tutor-revealed content (images, sim state on progress):
  **JB structures the idea first**. The engineering half is the "concept maps as tech
  trees" note in the [30 Sep plan revision](../v2.1.0-extension/plan-2026-09-to-2027-04.md),
  which also builds on M0 and 1.1.133.
- Socratic guidance vs validation (*"a student became frustrated when the tutor wouldn't
  confirm"*): the praise preamble (v0.1.74) now says *confirm plainly when asked
  whether right*; [1.1.129](explain-on-the-second-ask.md) holds the rest.
- *"Sim variables displayed as LaTeX"*: needs one real example from the logs first.
  The notation preamble may be typesetting sim parameter names; check before changing it.

## Suggested order

M2 (a quarter-day, and it makes test honest) → M3 (answers JB with his own data) →
M0 (the teacher-visible ask, and the step before 1.1.133) → M1 → M7 → M4 → M5 → M6
(after the Klaus call) · M8 whenever M decides.

## Acceptance

- A sim emitting `<id>.complete` makes the tutor speak once, specifically, and stops
  questioning when the state says top tier; the authoring prompt teaches the verb.
- Test and dev report the same 11 tutor assignments as prod, and `deploy-status` shows
  assignment drift when there is some.
- A fidelity report exists for the 26–30 Sep prod sessions, per assigned approach, with
  tone, and JB has read it.
- `make release-notes` produced the v0.1.70–74 notes and they are in Teams.
- A tag with no sandbox change does not fire the prod sandbox release.

## M3 first run — real classroom sessions, 2026-09-30

`make bench-tutor-sessions ARGS="--go --since 2026-09-26 --until 2026-09-30"` →
`research/tutor-discrimination/sessions-20260930T185756Z/` (gitignored). 14 prod
sessions, 13 groups, 112 judge calls (≈ EUR 0.5), 0 failed.

| | preview (BENCH-2, before praise) | **real classroom sessions** |
|---|---|---|
| Own approach top of its own column | 4–5 of 7 | **0 of 5** readable |
| Mean column-z margin | +1.4 / +2.0 | **−0.54** |

**What it can and cannot say.** Only one row has real n: **Mikkel/ESRU, 7 sessions in
7 groups**. ESRU is its highest column (0.80, z +0.73), a weak lean, on the
judge's most generic ruler. POE, CER and 5E have 1–2 sessions each, and each scored ~0
on its own approach. That is *consistent* with "approaches blur in real lessons", and it
is the direction 1.1.141 predicts, but it is anecdote, not evidence. Accountable talk
and Toulmin had no qualifying sessions. 7 sessions were excluded for switching
approach mid-window; read them by hand.

**Tone disagrees with JB's "Mikkel was too sycophantic"**: none in 6 of 7 Mikkel sessions.
Likely reason: the harness judges **student groups only** (`teacher:`, `preview:`,
`preview-` excluded). If JB's experienced-teacher session ran as teachers or
"try as student", **it is not in this sample.** **Ask JB** which accounts the
teachers used, and if needed add a `--include-teacher-trials` mode for that one session.

**Next:** more sessions (the window was 5 days), then 1.1.141 M0 on this harness.
Do not quote the 0-of-5 headline without the n table beside it.
