# The live view says what each group has been doing in the last few minutes

**Status**: **PROPOSED** 2026-11-26 — **1.1.163**
**Priority**: **P1**. Teachers like the live view and ask for the next step: *what is this group actually doing?* Today the answer is one word (*active / quiet / stuck*), and getting more means leaving the class page for the group report
**Estimated**: **~3d** (M0 window query ~0.5d · M1 the "what they did" line, no model ~0.75d · M2 the one-paragraph synopsis ~0.75d · M3 the row opens in place ~0.5d · M4 the class summary is built from the synopses ~0.25d · M5 tests ~0.25d)
**Scope**: Backend: a new `analytics/group_window.py` (one BigQuery read per group and window), a new `analytics/group_synopsis.py` (the model call, cached), one route `GET /api/classes/{id}/groups/{code}/synopsis?minutes=` in `protocols/classes_routes.py`, `config/models.yaml` (a `live_synopsis` purpose). Frontend: `app/teacher/classes/[id]/_GroupsTable.tsx` (a row that opens), `_LiveClassView.tsx` (the class summary reads the synopses), `frontend/messages/{da,en}/` (copy). No new collection
**Dependencies**: [1.1.31 teacher-analytics-framework](../v1.1.0-feedback/teacher-analytics-framework.md) (**shipped**, the live poll and the env-gated class summary) · [live-group-drilldown](../v1.1.0-feedback/live-group-drilldown.md) (**shipped**, the per-group report this links to) · [1.1.161 live-status-counts-workbench-work](live-status-counts-workbench-work.md) (**proposed**: the `lastWorkAt` stamp tells this doc which groups changed; it works without it, less cheaply) · [1.1.155 sim ledger](../v1.1.0-feedback/sim-context-and-class-report.md) (**shipped**, readings in words) · [1.1.164 tutor-tracks-what-is-settled](tutor-tracks-what-is-settled.md) (**proposed**: its open points are one line of the synopsis, optional) · [1.1.99 live-class-work-wall](../v1.1.0-feedback/live-class-work-wall.md) (M1 shipped; this is the text form of its unbuilt M0)
**Source**: classroom feedback relayed 2026-11-26: *"the teachers really like the live view, but can we expand its functionality a bit so we see the student work a bit more, perhaps a synopsis of what the student has been doing last x minutes."*

## What the teacher sees today

On the class page's lesson view, one table, one row per group
(`_GroupsTable.tsx`):

> Kode · Navne · **Status** · Sidst aktiv · Beskeder · Kopiér link · Rapport

Above it, raised hands and, when switched on, a **class summary**
(`analytics/live_class_summary.py`). That summary is the one AI layer the live
view has, and it reads very little: per group it is given the status, the
number of turns, *stuck* or not, and the activity title (`build_prompt`). It
has never seen a word the group wrote or asked. So it can say *"three groups
are active, one is stuck"*, which the table already shows. It cannot say
*what* a group is stuck on.

The content exists, one click away. The group report
(`teacher/reports/groups/[groupId]`) has the transcript, the workbench events
and an AI narrative (`reports/narrative.py`). But the narrative covers the
**whole session**, regenerates on a 5-minute debounce, and opening it takes
the teacher off the page where the raised hands are.

## What "the last X minutes" can be built from

Everything needed is already logged with a timestamp, in the two BigQuery views
the researchers use. Checked on prod for `green-beetle-49`, 2026-11-25:

| Source | What it holds | For the window |
|---|---|---|
| `chat_logs.chat_turns` | every student and tutor turn, with `tools_called` | questions asked, *Ask for feedback* requests, calculator use, what the tutor asked them to do |
| `chat_logs.workbench_events`, `server=writing` | the **whole** text of every sheet, on every change (62 snapshots in 55 min) | words added per sheet: diff the last snapshot before the window with the last one in it |
| `…workbench_events`, `server=<sim id>` | the sim's state on every push (72) | runs and readings, through the sim ledger's labels and units |
| `…workbench_events`, `server=documents` | material opened (8) | which handout they were reading |
| table / checklist / concept progress | cells, steps, concepts | steps ticked, rows filled |
| lesson transcript (`recording_routes.py`) | the group's talk, ~50 s segments | **optional** (see Privacy) |

One group and one window is two small queries over a day's partition. It is not
part of the 10-second poll. It runs when the teacher asks for a group (M3),
under the *blocking I/O in an async route* rule (`asyncio.to_thread`, as
`insights/compare` does since 1.1.131).

## Decision (proposed)

### Two layers per group, the first without a model

**1. "What they did", counted (M1).** A deterministic line, for every group, in
the teacher's language:

> *Last 10 min: wrote 64 words in "Undervejs (Del 2-5)" · 4 sim runs (cykler
> 0 → 500, kapacitet 79,9 %) · asked 3 questions · 2 feedback requests ·
> opened "Materiale – Lithium-ion-batteriet"*

No model, no cost, never wrong about what happened. It is what the teacher can
trust when the AI line and their own eyes disagree.

**2. A synopsis, written (M2).** Three or four sentences from a model, given
the window's turns and the counted line:

> *Working on Del 4 (ageing). Measured maximum capacity at several cycle counts
> and fitted a curve. Asked twice what they were supposed to measure, so they
> may be unsure of the task. Earlier they corrected "protons" to Li⁺ ions in
> Undervejs.*

Rules, taken from `narrative.py` because teachers already read that voice:

- **"The group", never a person.** Groups are anonymous (ADR-001), and a
  synopsis that guessed at a student would undo that.
- **No verbatim quoting** of students.
- **Only what the data shows.** Sim values come from the ledger, never from the
  model.
- **One sentence on what may need the teacher**, when the window shows it:
  repeated *"what should we do"* questions, a tutor point raised three times,
  long quiet with the page open. It is said in words, not as a new status
  label. Labels stay with [1.1.161](live-status-counts-workbench-work.md).

A model is worth its cost here because the counted line cannot say *unsure of
the task*. It is not worth it on every poll.

### The window is the teacher's choice: 5, 10 or 20 minutes

The default is 10. The choice is remembered in this browser, like the column
choices. Twenty is the longest, because past that the teacher wants the report.

### When the model runs

- **On demand.** The model runs when a teacher **opens a row** (M3), or presses
  *Summarise all groups*. It never runs from the background poll.
- **Cached per group and window**, keyed on what changed (the last turn index
  plus the last workbench event time). Re-opening a group that has done nothing
  since is free. While the row stays open, it refreshes every 2 minutes, and
  only if something changed.
- **Model:** a `live_synopsis` purpose in `models.yaml`, defaulting to the
  `live_summary` model (`flash-lite`). That goes through `llm.generate`, so
  `make check-model-calls` stays green.
- **Spend:** metered to the **teacher** through `budget.spend_guard.guard_spend`
  (the teacher is the caller), never to a group. A teacher over their cap still
  gets layer 1. ⚠️ Checked 2026-11-26: `guard_spend` has **no caller yet**
  outside its own docstring. Tutor turns are metered by the ADK callback, and
  the report narrative and class summary are not metered at all. So this would
  be its first caller. M2 must test that it actually refuses, not only that it
  is called.
- **Gate:** the existing `AIPLA_LIVE_SUMMARY` flag, on in dev and set on prod's
  service. Off means layer 1 only.

Cost check: a class of 10 groups, every row opened every 2 minutes for a
60-minute lesson, is 300 calls at roughly 3 k tokens in. On `flash-lite` that
is cents, not a budget line. In practice a teacher opens two or three groups.

### Where it appears

**M3: the row opens in place.** Clicking a group's row (or its chevron) opens
a panel under it, on the class page, with the raised hands still in view:

```
▾ green-beetle-49   active   2 min ago   36
   Last [10 min ▾]
   Working on Del 4 (ageing). Measured maximum capacity at several cycle
   counts … They may be unsure of the task.
   wrote 64 words in Undervejs · 4 sim runs · 3 questions · 2 feedback requests
   Tutor's open points: none · fixed: protons → Li⁺ ions (09:42)
   [Open report]
```

- One row open at a time, so the page does not become a wall of text. The
  ui-simplify rule is ≤4 visible choices.
- A group with nothing in the window says so in one line (*"Nothing in the
  last 10 minutes"*) and makes no model call.
- *Tutor's open points* shows only once [1.1.164](tutor-tracks-what-is-settled.md)
  M3 exists. Until then the line is absent, not empty.

**M4: the class summary reads the synopses.** The class summary above the
table is rebuilt from the synopses already cached for this lesson, rather than
from counts. *"Two groups are on Del 4; one has asked several times what to
measure."* With no synopses cached, it falls back to today's input. Its
debounce and gate are unchanged.

### Privacy

- **Teacher-only:** owner, or a researcher reading the class. These are the
  same permissions as `GET /live` and the group report. The teacher's names
  for groups stay in the browser, and the route takes a code, never a name.
- **The model sees only what the report's narrative already sees.** No new
  data leaves the platform.
- **The audio transcript is not in M2.** The report narrative uses it, so a
  teacher seeing it is not new. But a synopsis of what a group *said aloud, two
  minutes ago, about each other* is a different thing to put on a projector
  than a report read afterwards. It is an M2b, behind a per-class switch,
  after JB's view. This is the same caution as [group-talk-to-tutor](group-talk-to-tutor.md)'s
  M0a.
- **Shown on a projected screen?** The panel is collapsed by default and opens
  one group at a time. That is the protection, and the guide should say so.

## Milestones

**M0 — the window query (~0.5d).** `analytics/group_window.py`: for
`(class_id, group_code, since)`, read `chat_turns` and `workbench_events` for
that group and day, and return a typed `GroupWindow`. Contents:
- turns;
- per-sheet word delta (last snapshot before `since` vs the last after);
- sim runs and readings through `sim_ledger.render`;
- documents opened;
- progress changes.

Run it read-only against `green-beetle-49` 09:40–09:50 and check it by hand
against the logs above.

**M1 — the counted line (~0.75d).** Render `GroupWindow` as the one-line
summary in DA and EN (i18n keys, not inline). Route
`GET /api/classes/{id}/groups/{code}/synopsis?minutes=5|10|20` returns
`{counted, synopsis: null, window, generatedAt}`. Owner/researcher guard via
`_load_readable`; the code must be one of the class's codes.

**M2 — the synopsis (~0.75d).** `analytics/group_synopsis.py`, with the
prompt (rules above), the cache keyed on the change signature, `guard_spend`
(teacher as caller), and the gate. On failure it returns `synopsis: null` with the
counted line intact. It never returns a 500, never returns an empty string as
if there were nothing to say, and never returns a stale synopsis without its
`generatedAt`.

**M3 — the row opens (~0.5d).** `_GroupsTable.tsx`: expandable row, window
picker, *Open report* link, empty state, loading state (the counted line can
show before the synopsis arrives), 2-minute refresh while open. All copy goes
through `useT`. Check it with `ui-guidelines-check`.

**M4 — the class summary reads the synopses (~0.25d).** As above.

**M5 — tests (~0.25d).**
- The word delta for a sheet edited before and inside the window.
- A group with no events gets no model call.
- The cache is hit when nothing changed.
- A teacher over their cap gets the counted line only.
- A student token is refused (dual-auth: the route is teacher-only, so a group
  JWT must 403 through the real dispatcher).
- A code from another class is refused.
- The rendered row puts no name in any request (extend `_ClassListSheet.test.tsx`).

## Acceptance criteria

- A teacher opens a group on the class page and, within ~3 seconds, reads what
  that group did in the last 10 minutes without leaving the page.
- The counted line matches the logs for the window, checked on a real lesson.
- A group that did nothing costs no model call. Re-opening an unchanged group
  costs none either.
- With the gate off or the cap reached, the panel still shows the counted line.
- No student identity, no verbatim student text, no audio transcript in M2.

## What this doc deliberately does not do

- **No new status labels** and no change to *active / quiet / stuck*. That is
  [1.1.161](live-status-counts-workbench-work.md).
- **No live thumbnails of the work.** The visual work wall is 1.1.99 M0, still
  unbuilt. This is its cheap, text-first sibling, and may make it less urgent.
- **No alerts.** The synopsis can say a group may be unsure; it does not ping
  the teacher. Triggers that act belong with [1.1.162](tutor-interjects.md)
  and the raised hand.
- **No change to the report.** The report stays the whole-session view.
