# The tutor keeps track of what it raised and what has since been fixed

**Status**: **M1 + M2 IMPLEMENTED 2026-11-26** (on `dev`, not yet released); M0, M3, M4 open — **1.1.164**
**Priority**: **P1**. A tutor that keeps telling a group to fix what they have already fixed tells them it isn't reading. It happened twice in one 60-minute session on prod, and the second time the fix was in the very message the tutor replied to
**Estimated**: **~2d** (M0 confirm the cause on prod ~0.25d · M1 superseded drafts collapsed ~0.5d · M2 the current text, every turn ~0.25d · M3 the tutor's open points ~0.75d · M4 tests and an eval case ~0.25d)
**Scope**: Backend: `adk/agent.py` `_composed_before_model` (one more request rewrite, beside the image-turn grounding strip), `adk/element_state.py` (writing text, not only word counts), a new `adk/open_points.py` (two tools plus a render), `adk/compaction_summarizer.py` (the prompt says what to do with resolved points), `backend/tests/eval/` (one case built from this session). Frontend: none
**Dependencies**: [1.1.69 tutor-sees-element-state](../v1.1.0-feedback/tutor-sees-element-state.md) (**shipped**, `element_state.py`) · [1.1.155 sim ledger](../v1.1.0-feedback/sim-context-and-class-report.md) (**shipped**, the same "state, not history" pattern for sims) · compaction (`adk/session.py`, `adk/compaction_summarizer.py`, **shipped**) · [1.1.163 live-group-synopsis](live-group-synopsis.md) (reads the open points M3 writes, optional)
**Source**: classroom feedback relayed 2026-11-26: *"the chat history seemed to have been forgotten — a student had a wrong answer, then corrected it to a right answer, but it kept fixating on the old error rather than recognising it had been fixed."* Then M, same day: *"needs to keep track of what is happening better? a memory or task function?"*

## What happened (prod, 2026-11-25, read-only)

Group `green-beetle-49`, activity *Lithium-ion-batteriet Fysik B*, tutor `jonas`,
approach `cer`, model `gemini-3.5-flash-lite`. The group used the writing
sheet's **Ask for feedback** button, which sends the whole sheet as a chat
message (*"Kan du give mig feedback på {title}? Her er hvad jeg har
skrevet: …"*). Times are UTC.

| Time | Who | What |
|---|---|---|
| 09:22 | group | *Undervejs* sheet: "**Protoner** transporteres fra den negative pol til den positive pol" |
| 09:35, 09:42 | tutor | "Læg dog mærke til den første sætning om protoner … Prøv at rette den del" — said twice |
| **09:42:40** | group | **Fixed:** "**Lit+ ioner** transporteres …" |
| 09:43 | tutor | "Det ser rigtig fint ud, at I har rettet det til" — **it noticed** |
| 09:43 → 09:58 | — | nine more turns: calculations, regression, Del 4 |
| **10:00:35** | tutor | "Jeg bemærker dog, at jeres formulering i begyndelsen **stadig nævner 'protoner'** et sted i jeres noter – husk at få rettet det" |
| 10:02:01 | group | "**der står ikke protoner noget sted**" |
| 10:11:07 | tutor | *Afslutning*: "der er en lille slåfejl med et '1,1W 1,1W' to gange i træk" — correct |
| **10:11:57** | group | sends the sheet again, typo fixed (one "1,1W") |
| **10:11:57** | tutor | "mangler I bare lige at få rettet slåfejlen med dobbelt enhed (`1,1W 1,1W`)" — **the fix was in the message it was replying to** |

The same session also shows the milder version. From 10:02 on, five tutor turns
in a row open by praising the same GeoGebra graphs ("Det er nogle rigtig flotte
grafer …"), uploaded at 09:35–09:58.

## What it is not: forgotten history

The words were *"the history seemed to have been forgotten"*. **It is the
opposite.** The tutor's prompt grew steadily from 11 k to 20.6 k tokens (the
`token_in` column, 36 tutor turns). That is about 2 % of the model's window, and
nothing near the 250 k compaction threshold. Every turn of the conversation was
in front of the model, including the correction.

What was also in front of it:

- **Fifteen near-identical copies of the sheet.** Each *Ask for feedback* adds
  the whole text again. Eight of those copies, plus the tutor's own three
  replies about them, say *protoner*. Only the newest copies say *Li+*.
- **Its own instruction, repeated, never closed.** The tutor said *"ret
  protonerne"* three times. Nothing in the conversation marks that instruction
  as done, except one sentence of its own at 09:43.
- **The current text, with nothing saying it wins.** *(Corrected 2026-11-26.
  The first version of this doc said the tutor was never told what the sheet
  says. That was wrong.)* The sheet's current text **is** in every prompt:
  `mcp_app_context.writing.state`, capped at 4,000 characters
  (`WRITING_PUSH_CHAR_CAP`). But it arrives as a raw JSON dump at the bottom of
  the instructions, under the generic *"Current iframe-app context"* framing
  written for sims. The conversation above it quotes fifteen drafts in full,
  and nothing says which version wins. (`element_state.py` separately reports
  only how much is written.)

The model is `flash-lite`, the cheapest tier. Weighing fifteen drafts by
recency is the kind of reading it does worst. A stronger model would make this
rarer, not impossible: the structure of the prompt asks every model to work it
out.

**Compaction is a possible second cause, unconfirmed.** Prod logged
`Compaction grew the request …` at 09:30:26 and 09:54:26. The first is seconds
after this group's 09:30:21 turn, but the log line carries no session id. If it
was this session, the compactor did what its prompt asks ("preserve … every
misconception surfaced, and every correction issued"). It carried *"the group
wrote protons; the tutor asked them to correct it"* into a summary that stays
at the top of every later request, with no word that it was resolved. M0 checks
this.

## Answer to "a memory or a task function?"

**A task function, not a memory.** Memory is for what the tutor has *lost*, and
it lost nothing. What it lacks is a **current state** that outranks the
history: what the sheet says now, and which of its own points are still open.

The repo already solved this once, for sims. Every sim push used to replace
the last, and the tutor reasoned from history. [1.1.155](../v1.1.0-feedback/sim-context-and-class-report.md)
gave it a **ledger** instead: settings, runs and readings, rendered fresh into
every request. This doc does the same for writing and for the tutor's own
feedback.

## Decision (proposed)

Three layers, cheapest first. Each fixes part of it on its own, so they ship in
order and stop early if the eval case passes.

### 1. Only the newest draft of a sheet is in the request (M1)

In the model request (not the stored session), replace every earlier
*Ask for feedback* message for the **same sheet** with one line:

> *[An earlier draft of "Undervejs (Del 2-5)" — replaced by the newer draft below.]*

The newest one stays whole. The session, the chat log and BigQuery keep every
draft. Researchers lose nothing, and the report still shows how the text grew.
The tutor's replies to old drafts stay, so it still knows what it said.

It belongs in `_composed_before_model`, next to the image-turn grounding strip:
same place, same kind of rewrite. The feedback message is built from one i18n
key (`feedbackRequest`), so the match is on that template and the sheet title,
in both languages. It must not be a regex over free text. A student who types
"kan du give mig feedback" by hand is not collapsed.

This alone removes 14 of the 15 copies in the session above.

### 2. The tutor is told that the current text wins (M2)

The writing snapshot is rendered as prose, one heading per sheet, instead of a
JSON dump, under a lead that ranks it:

> *What the writing sheets say NOW — this replaces any earlier version in the
> conversation. Before you say something is still wrong in a sheet, check it
> here.*

No new data: the text was already there. The cap stays the client's 4,000
characters, and a shortened text says so. Hidden-answer rule: this is the
student's own text, so there is nothing to hide.

### 3. The tutor keeps a short list of its open points (M3)

This is the "task function". Two tools and one block in the prompt:

- `note_point(text, sheet?)`: *"I asked the group to change X."* The tutor
  calls it when it asks for a specific correction.
- `close_point(id, how)`: *"fixed by the group"* or *"no longer relevant"*.
- Every request renders the list: open points first, then the points closed in
  the last ~15 minutes with when they were closed. *"Do not ask again for a
  closed point."*

Stored in session state (`open_points`), at most ~8 open, oldest dropped. There
is no new collection.

**And a deterministic check, so it does not depend on the tutor remembering to
call `close_point`.** A point noted against a sheet stores the phrase it is
about ("protoner"). When that sheet's current text (M2) no longer contains the
phrase, the render shows the point as *looks fixed — confirm with the group*.
This is a hint to the tutor, never shown to the group.

The compaction prompt gets one line: carry open points across as open, and
closed points as closed. The block is rendered fresh after compaction anyway,
so the summary is not the only copy.

M3 is the layer that also feeds the teacher: [1.1.163](live-group-synopsis.md)
can show *"Tutor asked: protons → Li⁺ ions · fixed 09:42"* without a model call.

### Why not a longer context or a stronger model

The context was 2 % full, so a longer one buys nothing. A stronger model is a
config change (`models.yaml`) and worth trying in the eval (M4). But it leaves
the tutor's prompt asking it to find the newest of fifteen drafts, and the tutor
comparison study needs the same model on every arm. A fix in the prompt
structure works on every model the study might use.

## What was built (2026-11-26)

- **M1** `backend/adk/superseded_drafts.py`, called in `_composed_before_model`
  after the sim-author pruning. Matches the exact `feedbackRequest` template in
  both languages. `test_superseded_drafts.py` fails if the backend copy drifts
  from `frontend/messages/{da,en}/workspace.json`. Off-switch
  `TUTOR_COLLAPSE_DRAFTS=0`. Fail-open.
- **M2** `_writing_prose` in `backend/adk/iframe_context.py`, for the
  `writing.state` key only. Falls back to the raw dump on an unexpected shape.
- **Replayed against the real session.** Rebuilding the request the tutor had
  at 10:00:35 and at 10:11:57 from the prod chat log, M1 collapses 16 drafts.
  Student turns containing "Protoner" go from 7 to 0, and the draft with
  "1,1W 1,1W" from 1 to 0. The tutor's own replies, which still say "protoner",
  are kept by design. This is a replay of the request, not a re-run of the
  model: M4's eval is what shows the reply changes.

## Milestones

**M0 — confirm on prod (~0.25d).** Read the ADK session for
`green-beetle-49` / `…950f22` (the `aitana-adk-testing` skill's session
endpoints, prod, read-only). Does it contain a compaction event, and what does
its summary say about protons? Then re-run the BigQuery search that found this
(students re-sending a sheet after a tutor correction) over every session since
2026-10-01. That counts how often the tutor brings a fixed point back, as a
baseline for M4.

**M1 — superseded drafts collapsed (~0.5d).** As in decision 1. Tests:
- three drafts of one sheet → one whole, two placeholders;
- drafts of two sheets → the newest of each;
- a hand-typed "feedback" message is untouched;
- Danish and English templates both match;
- the stored session is unchanged.

**M2 — the current text, ranked (~0.25d).** As in decision 2. Tests: the text
appears under the ranking lead with no JSON dump; a shortened text says so; an
empty sheet reads *(empty)*; an unexpected shape falls back to the raw dump.

**M3 — open points (~0.75d).**
- The tools are `note_point` and `close_point`.
- The render goes into the per-turn context block.
- The deterministic *looks fixed* check.
- The compaction prompt line.
- The two tools stay out of `_CLIENT_RENDER_TOOLS` (`adk/stream_redaction.py`):
  the student never sees them, like `record_assessment`. Add them to
  `NOT_STUDENT_WORK_TOOLS` (`reports/session_summary.py`) so the session report
  does not list them as the group's work.

Tests: noted, then the text changes, then the render shows *looks fixed*;
closed points stop rendering after 15 min; the cap of 8 holds.

**M4 — eval (~0.25d).** One ADK eval case rebuilt from this session (the sheet
history, anonymised), asserting the 10:00 and 10:11 replies do **not** ask for
the fixed point. Run it before M1 to show it fails, then after each milestone.
Run it on `flash-lite` and on the analysis model, to see how much a stronger
model would have done alone.

## Acceptance criteria

- The eval case from this session passes on `flash-lite`.
- In a session with N *Ask for feedback* requests on one sheet, the model
  request contains that sheet's text once.
- The tutor's prompt states each sheet's current text every turn.
- A point the group fixed is shown to the tutor as fixed within one turn,
  whether or not the tutor called `close_point`.
- Nothing changes in what researchers see. The chat log, the session and the
  report keep every draft.

## What this doc deliberately does not do

- **No cross-session memory.** Nothing was lost within the session. Carrying
  points into next week's lesson is a different question, with privacy
  consequences, and belongs with the concept-assessment work.
- **No change to the *Ask for feedback* button.** Sending the whole sheet is
  right: the student asks about what they have now. The problem is what the
  older copies do afterwards.
- **No teacher-facing view of the open points** beyond what 1.1.163 reads.
