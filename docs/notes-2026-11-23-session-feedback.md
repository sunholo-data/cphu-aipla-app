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

## The answers in one page

| # | Short answer | Bug, gap, or new feature? |
|---|---|---|
| 1 | **Confirmed.** Closing a sim removes it from the page. When it opens again, it starts from scratch. *(Corrected 2026-11-24:)* a restore path exists on the server but is **never connected to the sim**. | **Bug** that students will hit. Quick fix possible per sim; proper fix is in the platform → [1.1.160](design/aipla/v2.1.0-extension/sim-state-survives-close.md) |
| 2 | **Chat only.** The teacher's *active / quiet / stuck* label comes from the last **chat turn**. A group working in the table, writing box or sim without chatting shows as *quiet*, and after 6 min may be flagged *stuck*. | **Wrong signal.** The data to fix it already exists |
| 3 | **Only afterwards.** The recording is transcribed while it runs, and the session summary reads the transcript. The live tutor never sees it. | **Designed, not built**: [group-talk-to-tutor.md](design/aipla/v2.1.0-extension/group-talk-to-tutor.md) (PROPOSED 2026-09-21, ~2d, waiting for JB's data-use OK) |
| 4 | The tutor already speaks first in three cases: greeting the group, after a **sim event** and after a **checklist step**. It never speaks because of silence, a table entry or what the group says out loud. | **New feature.** Needs a design and a research decision first. Depends on 2 and 3 |

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

Each doc has an **M0** of read-only prod log queries for the 23 November
session. They have **not been run yet**: the gcloud account in use could not
read `aipla-prod-2026`.

Mapped to the
[extension plan](design/aipla/v2.1.0-extension/plan-2026-09-to-2027-04.md)
workstreams. Estimates are rough and **not yet sized against a design doc**.

| # | Action | Workstream | Est | Owner | Notes |
|---|---|---|---|---|---|
| 1 | **Find out which sim** lost its text, and on what device / browser | — | — | M | Probably `sekant-intro`. If it was a teacher's own sim, item 3 matters more |
| 2 | **Quick fix:** `sekant-intro` keeps its text fields in `sessionStorage` | C (residue) | ~0.25d | M / AD | Fixes close and reopen in the same tab only. Good pairing task for AD |
| 3 | **Platform fix: restore sim state on reopen.** When the sim opens, the platform gives it the last saved `state` through the bridge's existing `initialState()`, and connects the dropped `restoredWorkbenchState`. Sims opt in. Add "text the student typed goes in `state`" to the authoring prompt and the `mcp-app-artefact` skill, and check it in the import path | C → design doc | ~1.5–2d | M | Covers new tabs, other devices and the next lesson. Teachers' imported sims get it only if they follow the bridge. A cheaper stopgap is to **hide the iframe instead of unmounting it**, but that is same-tab only and keeps the sim running in the background |
| 4 | **Active/inactive counts workbench work.** "Last activity" = latest of chat, workbench writes and sim events. Show *where* the group is working, and separate "page open" from "doing something" | C (residue) | ~1–1.5d | M / AD | Fix it **before** anything uses *stuck* as a trigger (item 7). Group-level only. A test with a group that only uses the table must show *active* |
| 5 | **Tell the tutor a recording is running**, without the transcript | D (tutors) | ~0.5d | M | No new data reaches the model, so it may not need the data-use OK. **Confirm with JB** |
| 6 | **Decide on [group-talk-to-tutor](design/aipla/v2.1.0-extension/group-talk-to-tutor.md)** M0–M2 with JB / AR: is the Accountable Talk arm wanted in 2026/27? If yes, get the data-use OK and build it | D (tutors) | ~2d | JB / AR decide, M builds | Without it, the Accountable Talk tutor is gated on a recording it can't hear |
| 7 | **Design doc: "the tutor interjects"** — interjecting as a per-approach setting in the framework YAML. Triggers: corrected *stuck* (item 4), the recorded discussion (item 6), workbench entries. Every interjection logged with its trigger, so the tutor study can measure it. Revisit why the idle check-in was retired | D (tutors) | design ~0.5d, build TBD | M + AR / JB | **Research question first:** is interjection a variable in the tutor comparison, or a product default? Must keep the passthrough guarantee in the tutors handover |

**Suggested order:** 1 → 2 (this week, small) → 4 → 3 → decide 6 → 5/6 → 7.
Items 2–4 are bugs or wrong signals on surfaces in use now. Items 5–7 are tutor
work and belong in the D allocation, next to the tutor comparison from 19
November.

**Capacity.** About 6–7 days if items 2–6 are all built, before item 7 is sized.
At 2.5 days a week, that is roughly three weeks. Something already in C or D
has to move. Raise this at the next planning check with AD.

## Open questions

- Which sim, and which device / browser? (item 1)
- Was the question in point 2 about the **teacher's** live view (assumed here),
  or about whether the **tutor** knows the group is working in the workbench? The
  tutor half is mostly covered already: workbench state reaches the tutor's
  context (`adk/element_state.py`), including *empty* elements.
- Who was in the session?
