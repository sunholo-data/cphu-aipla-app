# The class view is a room — groups at tables, their work on them, their devices live

**Status**: **Design (OPEN)** — **1.1.99**
**Priority**: **P1** — the most-repeated teacher ask across three separate feedback rounds, and its enabler landed 2026-08-31. Needs **only teachers**, so it is un-gated by either legal blocker
**Estimated**: ~4–6d (M0 work wall ~2d · M1 compare-one-element ~1.5d · M2 drill-in wiring ~0.5d · M3 signals as overlay ~0.5d · M4 live transport ~1d)
**Scope**: Frontend-heavy — a new class view rendering per-group artefact miniatures; backend — a class-scoped read across the four per-group stores; transport for live updates
**Dependencies**: **[1.1.53 group-shared-session-sync](group-shared-session-sync.md) M3 (SHIPPED — `touch_presence` / `activeDevices`, the device-presence signal M6 surfaces)**; **[1.1.88 group-shared-table](group-shared-table.md) (SHIPPED 2026-08-31 — this is what makes the doc possible at all, see below)**; `db/{table,writing,checklist,concept}_progress.py` (**all four shipped**); [1.1.31 teacher-analytics-framework](teacher-analytics-framework.md) (**M0/M1 shipped** — the signals this demotes); [live-group-drilldown](live-group-drilldown.md) (**1.1.31 M2** — the per-group report this becomes a front door to); [1.1.29 call-teacher](call-teacher.md) (raised hands)
**Created**: 2026-09-02
**Source**: M, 2026-09-02 — *"the teacher actually requests being able to see what students do a lot better. I think we need a totally new UI for the class view that is more visual based to show student work in real time"* and *"the view should look a bit like a classroom with groups around tables… they can see different devices are live and around tables via our multi-session detection"*

## Problem Statement

**The live class view shows status lights. Teachers want to see the work.**

`_LiveClassView.tsx` is 162 lines and renders, per group: a coloured dot
(active/idle), a turn count, a last-activity time, and a "stuck" warning
triangle. [live-group-drilldown](live-group-drilldown.md) says so plainly in its
own framing — the live class view carries *"aggregate signals only — counts,
active/idle, stuck."*

So a teacher walking the room gets:

> ● Group 3 — 12 turns — active
> ○ Group 7 — 4 turns — idle — ⚠ stuck

What they actually want to know is *"has group 7 plotted the wrong axes?"* And
the honest answer today is: open group 7's report, read it, go back, open group
4's report, read it. **One group at a time, in text, while twenty students wait.**

### Why the "stuck" flag is the wrong shape, not just thin

A heuristic decides *stuck* from turn cadence. But a group can be **actively
chatting and completely wrong** — full of turns, dot green, table full of numbers
plotted against the wrong variable. The signal layer cannot see that, because
**it never looks at the work**. Meanwhile a group that is quiet because they are
carefully measuring reads as idle.

The teacher's own eye is a far better classifier than any heuristic we will
write, **and we are not giving it anything to look at.** That is the whole item.

### This is the third time it has been asked

| When | Ask |
|---|---|
| 2026-06-15 | *"Real-time class summary every ~5 min"* → [1.1.31](teacher-analytics-framework.md), which shipped the **signals** and gated the **content** on R1 |
| 2026-08-21 | Feedback item 20 — class-level progress dashboard. Triaged as *"partly exists… gaps: per-student progress over time"* |
| 2026-09-02 | *"a totally new UI… more visual based to show student work in real time"* |

Each round got a slightly better *indicator*. None of them showed the work.

## Why this is buildable now and was not three days ago

**The enabler is [1.1.88](group-shared-table.md), shipped 2026-08-31.**

Until then the data table — the element physics work actually lives in — was in
`window.sessionStorage`, **per browser tab**. A class-wide live view of student
tables was not merely unbuilt; it was **impossible**, because the numbers existed
only inside one student's tab and nowhere a server could read them.

With 1.1.88 the table became the fourth per-group Firestore store, joining
`checklist_progress`, `concept_progress` and `writing_progress`. **All four
fillable elements are now server-readable, per group, live.**

So the work is already sitting in Firestore, already keyed by group, already
updating as students type — and the class view renders a dot. **The gap is a
read and a render, not a data model.**

## Design

### M0 — The work wall

Replace the row-of-signals with a **grid of group cards, each rendering that
group's actual artefacts in miniature**:

- the **data table** — real numbers, not a row count
- the **chart** — the actual plot, small but readable enough to spot wrong axes
  or a missing point (this is where [1.1.84](workbench-chart-readability.md)'s
  ticks and labels pay off twice)
- the **writing** — first lines
- **checklist / concept-map** coverage as a small progress shape

Designed to be **scanned, not read**. The teacher's question is *"which of these
eight looks wrong?"*, and the answer should arrive in about two seconds from
across a classroom.

### M0b — What is on a table card, in priority order

M, 2026-09-02, confirming the content model: *"student requesting help — that
could be in the UI as well? And latest activity, chats etc is fine, and progress
through the workbench is fine."*

So the card is a **stack with a deliberate visual hierarchy**, because a teacher
scanning a room needs the urgent thing to win:

| Priority | What | Source | State |
|---|---|---|---|
| **1** | 🖐 **Raised hand** — a student explicitly asking for a human | `db/group_signals.list_raised_for_class` → `GET /{class_id}/signals` | **Ships** (1.1.29). Already class-scoped and teacher-readable |
| **2** | **The work** — table, chart, writing miniature | the four `*_progress` stores | **Ships** (1.1.88 + siblings) |
| **3** | **Workbench progress** — checklist / concept coverage | `checklist_progress`, `concept_progress` | **Ships** |
| **4** | **Latest activity** — last turn excerpt, last action, time since | the BQ turn stream + `compute_group_signals` | **Ships** |
| **5** | **Devices live** — small annotation | 1.1.53 M3 `activeDevices` | Ships, but **needs the teacher-side read** (M6) |

**Everything on this list already exists.** The card is an assembly problem, not
a data problem — which is the second time this doc has reached that conclusion.

**The raised hand should not be a badge.** It is the only signal in the stack
that is a *person deliberately asking*, as opposed to something we inferred from
telemetry. Everything else is us guessing at need; this is need, stated. So the
**table itself** changes state — unmissable from across a room, and it should
survive being the only thing a teacher notices in a busy minute. It also has an
implicit ordering claim: a raised hand outranks a stuck heuristic every time,
because one of them is evidence and the other is a hypothesis.

⚠️ **`call-teacher.md` still reads "Planned" while the mechanism ships** — the
third stale `Status:` header found in this batch, after `cost-dashboard` and
`tutor-personas`. Worth a sweep at some point; the retrospective's rule about
verifying against code keeps earning its keep.

### M1 — Compare one element across all groups *(probably the most valuable screen)*

Pick an element, see it **for every group at once**: eight graphs in a grid,
eight tables side by side.

For physics teaching this is the whole point. Outliers are instantly visible —
one graph with a different slope, one table with a decimal error, one group who
plotted time on the wrong axis. It is also the natural surface for the whole-class
conversation afterwards: *"look at these three results — why do they differ?"*

### M2 — Drill in, without rebuilding anything

Clicking a card opens the **existing per-group report**, which
[live-group-drilldown](live-group-drilldown.md) already made *"one view, two data
cadences"* — live while the group is active, frozen after. **This doc is the front
door to that, not a replacement for it.** No new drill-down surface.

### M3 — The inferred signals become an annotation

The raised hand is promoted to a first-class card state (M0b). What is left —
active/idle, turn count, the "stuck" heuristic — becomes **small type at the foot
of the card**. They stop being the view and become a hint on top of the work.

Keeping them is worth it (turn count and time-since are genuinely useful at a
glance) but **the "stuck" flag should be reviewed once the wall exists**. Its
whole purpose was to compensate for a teacher who could not see the work. With
the work visible, a heuristic that fires on turn cadence may do more harm than
good — it is confidently wrong exactly when a group is quiet and careful.

### M4 — Live transport

⚠️ **A useful asymmetry the codebase's own footgun note implies but does not
state:** `CLAUDE.md` warns that Firestore `onSnapshot` must be gated on
`isAnonymousGroupAuthMode()` because **group JWTs are not Firebase identities**.
**Teachers are.** So the teacher class view *can* use client-side `onSnapshot`
listeners where a student surface cannot — this is one of the few places that
door is open.

Options, in order of preference: `onSnapshot` on the four per-group collections
scoped to the class's group codes (true real-time, no polling, rules already
express owner/researcher access); or extend the existing class poll if listener
fan-out at 30 groups proves costly. **Measure before choosing** — 30 groups × 4
collections is the number to check.

### M5 — The room, not a grid

**The layout should look like the classroom.** A teacher does not think *"group
7"*; they think *"the pair by the window"*, *"the table by the door"*. A uniform
grid forces them to translate between a screen and a room they are standing in,
every time they look.

So: group cards are **tables on a floor plan**, and the teacher **arranges them
once to match their actual room** — drag a table, save, persisted per class.
After that the screen and the room are the same shape, and a card lighting up
maps directly onto somewhere to walk.

This is a small feature with an outsized effect on the thing being asked for:
*"see what students do a lot better"* is partly a **navigation** problem, and
spatial memory is the cheapest navigation there is.

### M6 — Devices live at each table

**The presence signal already exists and ships**, and it is currently invisible
to the person who most needs it. [1.1.53](group-shared-session-sync.md) M3 gives
each tab an ephemeral device token, heartbeats it ~2.5s via `/api/auth/group/pulse`,
and returns `activeDevices` — *"how many devices are on this (group, activity)
right now"* — through `touch_presence` / `read_group_pulse`.

⚠️ **But `/pulse` is keyed by `user.group_id`** — *"a student reads only their own
group's pulse; no cross-group leak"*. So **a teacher cannot read presence across
their class at all.** The instrumentation is done; the teacher-side read is
missing. That is the whole of M6: a class-scoped presence read, not new tracking.

On a table card that becomes: **three devices lit = three students working;
one = probably several heads round one screen; none = nobody has joined yet.**

It also makes the "stuck" heuristic largely redundant, which is the point. *Three
devices live and an empty table after ten minutes* is a completely different
situation from *no devices at all*, and today both render as one grey dot.

**Two honesty requirements:**

- **Presence decays, and the decay window must be visible.** A closed tab stops
  heartbeating; a card must not flip to "nobody here" faster than a student can
  cross the room. State the TTL in the UI rather than implying certainty.
- **It counts devices, never people.** ADR-001 holds: the card says *"3 devices"*,
  never *"Anna, Ben, Chris"*. There is no per-student identity to show and there
  should not be.

### ⚠️ The risk this design introduces, and how to hold it

A room-shaped view with live presence is **one design decision away from a
surveillance dashboard.** *"Table 4 has one device"* is a fact; read as a
productivity metric it becomes *"two students are slacking"*, which is August
feedback item 21 (students already said the monitoring felt like too much) served
back with better graphics.

The discipline: **the work is the content and presence is context.** A card's
dominant element is what the group has *made* — their table, their graph. Device
count is a small annotation. No leaderboards, no per-table time-on-task, no
ranking, no "engagement score" per table. If a future version sorts tables by
activity, that is the moment this became the other thing.

## Milestones

| M | What | Est | Gate |
|---|---|---|---|
| M0 | Work wall — per-group artefact miniatures | ~2d | None |
| **M0b** | **Card anatomy: raised hand first-class, work, progress, latest activity** | **~0.5d** | M0 |
| M1 | Compare one element across all groups | ~1.5d | M0 |
| M2 | Card → existing per-group report | ~0.5d | M0 |
| M3 | Signals + raised hand as card overlay | ~0.5d | M0 |
| M4 | `onSnapshot` live transport (vs poll) | ~1d | Measure fan-out |
| **M5** | **Room layout — drag tables, persisted per class** | ~1.5d | M0 |
| **M6** | **Class-scoped presence read + device dots on each table** | ~0.5d | M0; needs the teacher-side pulse read |

## Testing

- A class with 30 groups renders without jank; miniature rendering is virtualised or capped
- A group with no work yet shows an honest empty card, **not** a spinner forever
- A **researcher** sees the wall for a class they do not own (`_load_readable`, span-tagged); a **teacher** sees only their own
- Live updates arrive without a manual refresh; a dropped listener reconnects
- **A read failure renders as "cannot read", never as an empty card** — an empty card means "this group has done nothing", which is the reassuring-wrong-answer failure this project keeps shipping
- Chat-only activities (no workbench elements) degrade to a transcript excerpt rather than an empty grid
- A raised hand is visible from across a room and cannot be obscured by any other card state
- Lowering a hand clears the state promptly — a stale raised hand is worse than none
- A group with 3 live devices and no work renders differently from a group with 0 devices — the two must never collapse to one state
- Presence decay is bounded and shown; a brief network drop does not empty a table
- The room layout survives a reload and is per class, not per teacher-device
- No surface ranks, scores or sorts tables by activity level

## Open questions

1. **Does this replace `_LiveClassView` or sit beside it?** The ask says *"totally
   new UI"*, which argues replace — and two class views would be the half-adoption
   pattern the handover audit calls the worst outcome. Leaning replace, with the
   signals preserved as M3.
2. ⚠️ **Is this ever shown on a projector?** A teacher seeing every group's work is
   uncontroversial. **Students seeing each other's work is a different product** —
   it lands on August items 21 (surveillance) and 24 (isolated mode), and on the
   "internal competition" framing from item 20. **Design it as a teacher-only
   surface until somebody decides otherwise**, and do not let projector use happen
   by accident.
3. **What does a miniature chart need to be useful?** Possibly a genuinely
   different render from the workbench chart — fewer labels, bigger marks.
4. **Does it need history?** *"Group 4's table is empty now"* is less useful than
   *"…and has been for ten minutes"*. Sparkline-per-group is a cheap M5.
5. **How does it interact with [1.1.90](bounded-tutoring-answer-trees.md)?** If an
   activity has a concept map and answer trees, per-group *position in the tree*
   may be the single most legible thing on the card.
6. **Is the room per class or per activity?** `activeDevices` is scoped to
   `(group, activity)`, so a class running two activities at once has two
   presence truths. The room is probably per class with an activity filter —
   confirm against how teachers actually run a lesson.
7. **Who draws the room first?** Dragging tables is a setup cost on a surface
   whose whole point is saving time. A sensible default arrangement that a
   teacher *may* rearrange is likely better than an empty canvas.
8. **Does the room want a projector mode after all?** Open question 2 says
   teacher-only — but a *room* view showing each table's own work back to the
   class is a different and possibly good thing. Still a separate decision, not a
   default.
