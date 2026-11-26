# Session feedback — 23rd November 2026

**Raw capture, then each point checked against the repo.** Same convention as
[notes-2026-11-19.md](notes-2026-11-19.md). People are referred to by initial
only.

**Source:** four points from the session on 2026-11-23, relayed by M on
2026-11-24. There is no transcript. Attendees: TBD.

**Status:** each point has been checked against the code on `dev` (`c0d43fb7`).
Nothing has been designed or fixed yet. The follow-up actions at the end are
**proposals for the roadmap**, not decisions.

## The feedback, as relayed

1. Simulations can have text fields, but when we close the simulation and come
   back, the text is gone.
2. Does the student active/inactive status work when they are in the workbench,
   or is it just chat?
3. When we are audio recording a group, is the tutor aware of it during the
   conversation, or just afterwards in the summary?
4. We are contemplating that the tutor could be more active and interject as
   needed.
5. *(Added 2026-11-26.)* A student wanted to use voice input (talk to type),
   but the group's audio recording was on, and it would not let them.
6. *(Added 2026-11-26.)* Teachers like the live view. Can it show more of the
   students' work, for example a synopsis of what a group did in the last few
   minutes?
7. *(Added 2026-11-26.)* The chat history seemed forgotten: a student corrected
   a wrong answer, but the tutor kept going back to the old error.

## The answers in one page

| # | Short answer | Bug, gap, or new feature? |
|---|---|---|
| 1 | **Confirmed.** Closing a sim removes it from the page. When it opens again, it starts from scratch. *(Corrected 2026-11-24:)* a restore path exists on the server but is **never connected to the sim**. | **Bug** that students will hit. Quick fix possible per sim; proper fix is in the platform → [1.1.160](design/aipla/v2.1.0-extension/sim-state-survives-close.md) |
| 2 | **Chat only.** The teacher's *active / quiet / stuck* label comes from the last **chat turn**. A group working in the table, writing box or sim without chatting shows as *quiet*, and after 6 min may be flagged *stuck*. | **Wrong signal.** The data to fix it already exists |
| 3 | **Only afterwards.** The recording is transcribed while it runs, and the session summary reads the transcript. The live tutor never sees it. | **Designed, not built**: [group-talk-to-tutor.md](design/aipla/v2.1.0-extension/group-talk-to-tutor.md) (PROPOSED 2026-09-21, ~2d, waiting for JB's data-use OK) |
| 4 | The tutor already speaks first in three cases: greeting the group, after a **sim event** and after a **checklist step**. It never speaks because of silence, a table entry or what the group says out loud. | **New feature.** Needs a design and a research decision first. Depends on 2 and 3 |

## What the prod logs show (added 2026-11-24)

Read-only queries on `aipla-prod-2026` (BigQuery `chat_logs.chat_turns` /
`chat_logs.workbench_events`, Cloud Logging for `aipla-v01-frontend`). **The
lesson:** class `f2b1419f2e54`, 13:53–14:51 local time, 5 student groups plus
the teacher's preview groups, the **Accountable Talk** tutor, two **teacher-built**
sims: `bohr-spektrum` (all groups, 404 state pushes) and `li-ion-batteri` (2
groups, 101). 84 student turns, 84 tutor turns. No student text or group code is
quoted here.

| # | Evidence |
|---|---|
| 1 | **It was `bohr-spektrum`, not `sekant-intro`.** It has a free-text *prediction* field, and the typed text **is** in the state it pushes. In **3 of the 5 student groups** (plus a teacher preview), the prediction went from filled (33–178 characters) to empty mid-lesson. At each of those moments the sim was back on its first tab with its power counter reset to 0, after a ~5 min gap: **a fresh load, i.e. close and reopen**, not the student deleting text. The server held the text the whole time |
| 2 | The 5 student groups had **129 minutes with workbench activity**. In **21** of them the chat-only rule would have shown the group as *quiet*, and in **16** as *stuck*, while the group was working in the sim. About one working minute in six was mislabelled. (Approximate: minute buckets, student turns only) |
| 3 | **3 of 5 groups recorded**: 279 segments, about 3.5 hours of audio. The tutor heard none of it, **with the Accountable Talk tutor assigned**, the one approach that needs it. One group had **two devices recording at once** for ~44 min (two `seq=0` runs), which is the problem [group-recording-coordination](design/aipla/v1.1.0-feedback/group-recording-coordination.md) (Planned, P1) exists for |
| 4 | **84 proactive-event checks, 0 proactive turns.** The only unprompted turns were 8 greetings. The tutor did not react to a single one of the 505 sim pushes. This matches [1.1.154](design/aipla/v1.1.0-feedback/tutor-pacing-and-reactivity.md) F4: teacher-built activities run `concept-dialogue`, which does not opt in to sim-reactive turns, so the gate answers *skill opted out*. (The skill id is a prod Firestore id, and that it is `concept-dialogue` is inferred from F4 and the greeting, not read.) **So "the tutor could be more active" describes a tutor that was switched off for sims, not one that was too restrained** |

## Points 5–7: what the prod logs show (added 2026-11-26)

Points 5–7 were relayed on 26 November. They come from the lesson on
**25 November**: class `6f46cd3c2233`, *Lithium-ion-batteriet Fysik B*, 9
student groups, 09:12–10:30 UTC. The conference session on 26 November (class
`ba0afab2d067`, 11 groups) is checked alongside it. Everything below was read
read-only from BigQuery, Cloud Logging, Firestore `recordings` and the ADK
sessions in Agent Engine.

| # | Evidence |
|---|---|
| 5 | **All 9 groups recorded nearly the whole lesson** (52–71 min of real audio each, 741 segments). Talk-to-type was therefore disabled for every group, all lesson: **0** dictation calls on 25 or 26 November. One group (`ivory-valley-81`) had **two devices recording at once** for the whole lesson: 129 min of audio over 65 min, 74 repeated segment numbers. That is the second lesson running with this ([group-recording-coordination](design/aipla/v1.1.0-feedback/group-recording-coordination.md), still unbuilt). A stored `durationMs` can be far longer than its audio. `spicy-crab-48`'s last segment says 246 min, but it holds 0.6 MB (~19 s): the clock ran while the laptop slept. **Nothing was recorded after the lesson** beyond seconds, but the duration field over-reports, so researchers should use `sizeBytes` |
| 6 | The teacher had the **live view open for the whole lesson** (90 distinct minutes, 08:13–10:19 UTC) and opened **one** group report (`huge-robin-49`). They watched the one-word statuses and almost never drilled in, which is what point 6 asks to change. On 26 November the live view was open 166 min, and one group's report was kept open |
| 7 | **Every one of the 9 sessions compacted, 1–5 times each** (21 compactions in ~80 min). Workbench pushes outnumbered chat events in all of them (64–353 pushes per session), and that drove the turn-count trigger ([1.1.164](design/aipla/v2.1.0-extension/tutor-tracks-what-is-settled.md) M0). A text search finds exactly **two** tutor replies asking about a point already fixed, both `green-beetle-49` (10:00 protons, 10:11 typo), and one student pushback (*"der står ikke protoner noget sted"*). Other effects of a summary replacing the history would not show in a text search. On 26 November, with few pushes, one session compacted once |

### Found in the same logs, not in the feedback (2026-11-26)

**The lesson hit Agent Engine's write quota, and chat turns were lost.** Prod's
quota is **100 session-event appends per minute** for the whole project.
- **The burst.** At 10:04 on 25 November one student (`ivory-valley-81`)
  dragged the Li-ion sim's cycle slider and sent **146 pushes in two minutes**;
  the lesson normally ran 20–60 a minute.
- **What failed.** For about a minute every group's workbench push returned
  HTTP 500 (53 of them, `429 RESOURCE_EXHAUSTED`), and **4 chat-turn writes
  failed**. A chat event that never reaches Agent Engine is missing from the
  tutor's history on the next turn.
- **How common.** 343 of the lesson's 951 sim pushes came within 1.5 s of the
  previous one. The writing sheet already throttles itself (1 of 623).

Fixed on 2026-11-26:
1. The sim frame merges same-kind pushes closer than 1.5 s into the latest one
   (`GenericArtefactFrame`, `PUSH_COALESCE_MS`). A different event, or a
   chat flush, still goes at once, and the latest state is never dropped.
2. A session write that hits the quota is retried with backoff (1, 2, 4, 8 s)
   instead of failing (`adk/session.py`, `_append_with_retry`). ADK applies
   an event only after the remote append succeeds, so a retry cannot duplicate
   it.

**Still open, and a decision for M:** ask Google to raise the quota. At 100 a
minute, a larger class or two classes at once can reach it without any
burst.

## 1. Sim text disappears on close and reopen

**What happens.** When a student opens a sim, it fills the workspace. Closing it
**unmounts the iframe** (`frontend/src/components/workspace/StudentWorkspace.tsx:106-122`,
`simOpen` → `false`). Reopening loads `index.html` again from scratch, so
anything typed into the sim is lost.

The workbench elements beside it do **not** have this problem. Their scratch
state is kept in `sessionStorage` and the table, writing and checklist have
durable server stores (`backend/protocols/*_progress_routes.py`). Sims are the
only surface with nothing like this.

**Which sim.** Of the built-in sims, only **`sekant-intro`** has text inputs (14),
and it saves nothing. `sol-jord-maane` is the only sim that uses
`sessionStorage`, and it saves only progress. It could also have been a teacher's
own sim from the workshop. **To confirm:** which sim was it?

**Why sims can't fix this alone.** The authoring prompt forbids `localStorage`,
for a good reason: the sandbox origin is shared by every student on a school
computer, so stored text would pass to the next student. It allows
`sessionStorage` "if state must survive a reload"
(`.claude/skills/mcp-app-artefact/resources/authoring-prompt.md:141-143`). That
fixes closing and reopening **in the same tab**. It does not help after the tab
is closed, on another groupmate's device, or in the next lesson.

> **Correction, 2026-11-24.** The first version of this note said the platform
> "has no way to give a sim its earlier state back". That is too strong. A
> restore was **built at both ends and never joined**.
> `POST /api/sessions/{id}/restore` returns the saved sim state on re-join, and
> the chat page stores it in `restoredWorkbenchState`
> (`app/chat/[...path]/page.tsx:815`), but **nothing reads that variable**, and
> no sim listens for the `aipla:restore` message it was meant to become. The
> bridge also has an `AIPLA_BRIDGE.initialState()` hook that returns saved state
> on ChatGPT and `null` in AIPLA. See
> [1.1.160](design/aipla/v2.1.0-extension/sim-state-survives-close.md).

**The proper fix belongs to the platform.** The pieces already exist:

- Sims already send their `state` to the server
  (`POST /api/sessions/{id}/iframe-context`) so the tutor can see it.
- A channel from the platform into the sim already exists and has been in use since
  [tutor-controls-sims](design/aipla/v2.1.0-extension/tutor-controls-sims.md)
  (`onHostNotification`).

What's missing is a **restore** step: when a sim opens, the platform sends it the
last state it saved, and a sim that supports this fills its fields back in. It
only covers what the sim put in its `state`, so the authoring prompt has to say
that text a student typed belongs there.

## 2. Active/inactive is chat-only

**What happens.** `backend/analytics/live_class.py` computes each group's label
from the chat-session index alone (`last_message_at`, `turn_count`):

- *active*: last chat turn under 5 min ago
- *stuck*: at least 2 turns, then 6–30 min with no new turn
- dropped from the live view after 90 min

Nothing a student does in the workbench counts unless it produces a chat turn.
A group filling a measurement table for ten minutes therefore shows as *quiet*
and is likely flagged *stuck*. The teacher is told to go and help the group
that is working hardest. (A sim event that triggers a tutor turn probably counts
as a side effect. That has not been checked.)

**The data to fix it already exists:**

- **Presence.** The student page sends a heartbeat every ~2.5 s while it is
  visible (`useGroupPulse` → `touch_presence`, 15 s window,
  `backend/db/group_sessions.py`). Today it only counts devices for the "a
  classmate is asking…" banner.
- **Workbench writes.** The table, writing, checklist and concept-map progress
  stores, plus every sim `iframe-context` write.

The fix is to define "last activity" as the latest of the last chat turn, the
last workbench write and the last sim event. The label should then say *where*
the group is working ("working in the table", "chatting with the tutor"), and a
group that has the page open but is doing nothing should be shown as such. It
stays at group level only, with no per-student data (ADR-001). These are
Firestore reads, so they must stay off the event loop (see the *Blocking I/O*
row in CLAUDE.md).

## 3. The tutor doesn't hear the recording

**What happens.** A recording is uploaded in segments, and each segment is
transcribed while the lesson runs, so the students' transcript panel fills in
almost live (`LessonRecordingPanel.tsx`, `backend/protocols/recording_routes.py`).
The **session summary** reads that transcript afterwards
(`backend/reports/session_summary.py:157`, `_voice_transcript_for_group`).
**No code under `backend/adk/` reads recordings**, so the live tutor knows
nothing about the recording: not that one is running, and not what was said.

**This matters now, not only later.** The *Accountable Talk* tutor can only be
assigned to a class with recording on. That gate shipped on 2026-09-21, because
the approach is built from several students' spoken statements. But the gate is
only half of it: that tutor still can't hear the group. As
[group-talk-to-tutor.md](design/aipla/v2.1.0-extension/group-talk-to-tutor.md)
puts it, the gate is *necessary but not sufficient*.

**The design exists.** It is PROPOSED and P2, ~2d for M0–M2: give the tutor a
window of recent transcript, add a consent and data-use note, show researchers
where it came from, and test it through the real agent path. It is **gated on
JB's data-use OK**. Who said what (M3) is not sized: there is one shared
microphone and no speaker separation.

A smaller first step that needs no transcript: tell the tutor **that** a
recording is running, so it can say "I can't hear your discussion — tell me what
you concluded" instead of acting as if the room were silent.

## 4. A more active tutor that interjects

**What exists today** (`backend/protocols/proactive_routes.py`,
`frontend/src/lib/proactiveEventCheck.ts`):

- **Greets on join** (Phase A, shipped).
- **Reacts to meaningful sim events**: `sim_run`, `step_advance`,
  `measurement_commit`, `completion`, and a checklist step marked done. The
  backend decides whether to fire, with a 30 s cooldown and an optional cap per
  skill (`proactive_max_per_session`).

**What it does not do:**

- **Speak up during silence.** The idle check-in was designed and then **retired
  on 2026-06-03** ([proactive-tutor.md](design/aipla/v1.0.0-pilot/proactive-tutor.md)):
  it overlapped with the greeting and "risks anti-Socratic interrupts".
- React to the table, writing or concept map.
- React to what the group says out loud (it can't, see 3).
- React when the teacher's view flags a group as *stuck*.

**What has changed since June.** Tutors now carry their teaching approach as data
([tutors-handover](design/aipla/v1.1.0-feedback/tutors-handover-2026-09-10.md)).
So *how often to interject* need not be a single global setting. It can be a
property of each approach: a Socratic tutor holds back, a more directive one
steps in. That also makes it measurable in the tutor-comparison study from
[19 November](notes-2026-11-19.md).

**Dependencies.** Good interjections need good triggers. Interjecting on a
*stuck* flag that is wrong (point 2) would interrupt the groups that are
working. Interjecting on the discussion needs the tutor to hear it (point 3).
**So build 2 and 3 first**, and make 4 a design question.

## Follow-up actions for the roadmap

**Design docs written 2026-11-24** (registered in
[v1.1.0-feedback/SEQUENCE.md](design/aipla/v1.1.0-feedback/SEQUENCE.md) under
*Classroom session, 2026-11-23*):

| Doc | Covers actions |
|---|---|
| [1.1.160 sim-state-survives-close](design/aipla/v2.1.0-extension/sim-state-survives-close.md) | 1, 2, 3 |
| [1.1.161 live-status-counts-workbench-work](design/aipla/v2.1.0-extension/live-status-counts-workbench-work.md) | 4 |
| [group-talk-to-tutor](design/aipla/v2.1.0-extension/group-talk-to-tutor.md), addendum M0a | 5, 6 |
| [1.1.162 tutor-interjects](design/aipla/v2.1.0-extension/tutor-interjects.md) | 7. Also depends on [1.1.154](design/aipla/v1.1.0-feedback/tutor-pacing-and-reactivity.md) M1 (*never interrupt a draft*), an open design from 22 October that this note originally missed |

Each doc's **M0** (read-only prod queries) **was run on 2026-11-24**. See
[What the prod logs show](#what-the-prod-logs-show-added-2026-11-24). Two things
it changed:

- **Sims:** the sim was teacher-built, and teacher sims have their bridge
  stamped **at publish**. A bridge-side restore therefore reaches `bohr-spektrum`
  only after its author edits it and republishes it. 1.1.160's first milestone
  is now **keep the sim mounted while it is closed**, which covers every sim
  with no author action.
- **Interjection:** the cheapest "more active" is already designed. 1.1.154's
  open question 1 asks whether `concept-dialogue` opts in to sim-reactive turns
  for `completion` and `measurement_commit`. That is a decision for M and JB
  plus about half a day, and it comes before anything in 1.1.162.

Item 1 is answered: it was `bohr-spektrum`. Items 2 and 7 change as above.

Mapped to the
[extension plan](design/aipla/v2.1.0-extension/plan-2026-09-to-2027-04.md)
workstreams. Estimates are rough and **not yet sized against a design doc**.

| # | Action | Workstream | Est | Owner | Notes |
|---|---|---|---|---|---|
| 1 | **Find out which sim** lost its text, and on what device / browser | — | — | M | Probably `sekant-intro`. If it was a teacher's own sim, item 3 matters more |
| 2 | **Quick fix:** `sekant-intro` keeps its text fields in `sessionStorage` | C (residue) | ~0.25d | M / AD | Fixes close and reopen in the same tab only. Good pairing task for AD |
| 3 | **Platform fix: restore sim state on reopen.** When the sim opens, the platform gives it the last saved `state` through the bridge's existing `initialState()`, and connects the dropped `restoredWorkbenchState`. Sims opt in. Add "text the student typed goes in `state`" to the authoring prompt and the `mcp-app-artefact` skill, and check it in the import path | C → design doc | ~1.5–2d | M | Covers new tabs, other devices and the next lesson. Teachers' imported sims get it only if they follow the bridge. A cheaper stopgap is to **hide the iframe instead of unmounting it**, but that is same-tab only and keeps the sim running in the background |
| 4 | **Active/inactive counts workbench work.** "Last activity" = latest of chat, workbench writes and sim events. Show *where* the group is working, and separate "page open" from "doing something" | C (residue) | ~1–1.5d | M / AD | Fix it **before** anything uses *stuck* as a trigger (item 7). Group-level only. A test with a group that only uses the table must show *active* **Built 2026-11-26** ([1.1.161](design/aipla/v2.1.0-extension/live-status-counts-workbench-work.md)): the chip says where, a page open with nothing happening is its own state, *stuck* needs the page open |
| 5 | **Tell the tutor a recording is running**, without the transcript | D (tutors) | ~0.5d | M | No new data reaches the model, so it may not need the data-use OK. **Confirm with JB** |
| 6 | **Decide on [group-talk-to-tutor](design/aipla/v2.1.0-extension/group-talk-to-tutor.md)** M0–M2 with JB / AR: is the Accountable Talk arm wanted in 2026/27? If yes, get the data-use OK and build it | D (tutors) | ~2d | JB / AR decide, M builds | Without it, the Accountable Talk tutor is gated on a recording it can't hear |
| 7 | **Design doc: "the tutor interjects"** — interjecting as a per-approach setting in the framework YAML. Triggers: corrected *stuck* (item 4), the recorded discussion (item 6), workbench entries. Every interjection logged with its trigger, so the tutor study can measure it. Revisit why the idle check-in was retired | D (tutors) | design ~0.5d, build TBD | M + AR / JB | **Research question first:** is interjection a variable in the tutor comparison, or a product default? Must keep the passthrough guarantee in the tutors handover |
| 8 | **Talk to type while the lesson records** *(point 5, built 2026-11-26)*. The mic button was disabled on purpose during a recording, so only one microphone stream is ever open: on iPads and iPhones a second one silences the first, which would have cut the recording. Now dictation reads the audio the recording already captures, and Record waits while dictation holds the mic on its own | C (residue) | ~0.25d | M | No second mic, and the lesson recording is unchanged. The dictated words are also in the recording, as they were said aloud. Unit-tested. Not yet checked in a real browser with a recording class |
| 9 | **Live view: a synopsis per group for the last 5/10/20 min** *(point 6)*. Row opens in place on the class page: a counted line (words written per sheet, sim runs, questions, feedback requests), no model, plus a 3–4 sentence synopsis on demand | C | ~3d | M / AD | [1.1.163 live-group-synopsis](design/aipla/v2.1.0-extension/live-group-synopsis.md). **Counted line in v0.1.114** (select a group's code on the Lesson tab). **The class summary now reads the work** (M4: per-group last 10 min, where they work, the teacher's language). The per-group written synopsis (M2) is next. Audio transcript left out until JB's view |
| 10 | **The tutor keeps track of what it raised and what is fixed** *(point 7)*. Found on prod: `green-beetle-49`, 2026-11-25. It said "protoner" was still there 17 min after the fix, and that a typo was still there in the very message that fixed it. Nothing was forgotten (prompt at 2 % of the window). The prompt held 15 drafts of the same sheet, and the current text only as a JSON dump with nothing saying it wins. Fix: collapse superseded drafts, give the current text every turn, plus a small open-points list the tutor ticks off | D (tutors) | ~2d | M | [1.1.164 tutor-tracks-what-is-settled](design/aipla/v2.1.0-extension/tutor-tracks-what-is-settled.md). **Cause found and fixed 2026-11-26: compaction.** Workbench pushes counted toward the turn-count backstop, so the lesson compacted 4 times in an hour. Two summaries froze "the student still needs to fix X" seconds before the fix. Replay: 7/10 bad replies as on prod, 0/10 without compaction. Backstop raised (40 → 500), summarizer told never to record a request as outstanding. M1 + M2 also built |

**Suggested order (revised after the logs):** keep sims mounted (1.1.160 M1)
→ decide 1.1.154's open question 1 with JB, and if yes, switch on sim-reactive
turns for teacher activities → 4 → restore across tabs (1.1.160 M2–M4) →
group-talk M0a and group-recording-coordination → decide 6 → 7. *(The first
version of this order was 1 → 2 → 4 → 3 → decide 6 → 5/6 → 7.)*
Items 2–4 are bugs or wrong signals on surfaces in use now. Items 5–7 are tutor
work and belong in the D allocation, next to the tutor comparison from 19
November.

**Capacity.** About 6–7 days if items 2–6 are all built, before item 7 is sized.
At 2.5 days a week, that is roughly three weeks. Something already in C or D
has to move. Raise this at the next planning check with AD.

## Open questions

- ~~Which sim?~~ `bohr-spektrum`, teacher-built (from the logs). Device and browser are still unknown, and probably don't matter: the cause is the unmount, not the browser.
- Was the question in point 2 about the **teacher's** live view (assumed here),
  or about whether the **tutor** knows the group is working in the workbench? The
  tutor half is mostly covered already: workbench state reaches the tutor's
  context (`adk/element_state.py`), including *empty* elements.
- Who was in the session?
