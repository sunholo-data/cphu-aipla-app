# The tutor remembers the group's other activities — a carried digest, not a merged transcript

**Status**: **Design (OPEN)** — **1.1.103**
**Priority**: **P1** — it is a *reported* problem and a *requested* feature at the same time, and the current behaviour is correct but invisible, which is the worst combination to leave a student in
**Estimated**: ~2–3d (M0 the digest ~1d · M1 tutor injection ~0.5d · M2 student-visible continuity ~0.5d · M3 teacher control ~0.5d)
**Scope**: Backend — a per-group cross-activity digest assembled from stores that already exist, injected on the same seam the progress context uses; frontend — a short continuity line at the top of a new activity's conversation. **No session-model change**, which is the point
**Dependencies**: `db/group_sessions.py` (**SHIPPED** — the per-`(group, activity)` key this deliberately does *not* change); [1.1.53 group-shared-session-sync](group-shared-session-sync.md) (**SHIPPED** — the group/session model); [progress-conversation-lifetime](progress-conversation-lifetime.md) (**SHIPPED** — the closest precedent, and the pattern this copies); the four per-group stores `checklist_progress` / `concept_progress` / `writing_progress` / `table_progress` (**all SHIPPED**); [1.1.98 teaching-prompt-standardisation](teaching-prompt-standardisation.md) (the budget this must live inside)
**Created**: 2026-09-09
**Source**: [notes-2026-09-09.md](../../../notes-2026-09-09.md) items 3 + 10 — *"Aswin had session where no chat history was persisted — busy-garden-11 with 4 activities"* and *"we will add a feature to let chat history across activities be shared"*. **Decision D5** in the [triage](meeting-2026-09-09-triage.md)

## Problem Statement

**A bug report and a feature request arrived in the same meeting, and they are
the same sentence read from opposite ends.**

`db/group_sessions.py` keys the group's active conversation per activity:

```python
def _doc_key(group_id: str, activity_id: str | None) -> str:
    """ALS-1: a group now runs MANY activities, each with its own conversation,
    so the active session is scoped per (group, activity) — {group_id}:{activity_id}."""
    return f"{group_id}:{activity_id}" if activity_id else group_id
```

So a group running four activities has four conversations. Each one is intact.
None of them can see the others. **`busy-garden-11` with 4 activities is that
sentence happening to a person**, and what it looks like from the student's
chair is *"my chat history was not persisted"*.

⚠️ **This explanation is a hypothesis until someone reads the four
`group_sessions/busy-garden-11:*` documents.** Four active, non-archived,
unexpired mappings means the design; anything else means a second bug hiding
behind a comfortable answer. The same group's logs produced three real defects
this week. **Do this check before building anything here.**

### Why the current behaviour is not simply wrong

The per-activity partition was a deliberate change, and the first-wins write
that guards it closed a real bug:

> *"This does NOT overwrite an existing ACTIVE mapping — that was the clobber
> bug: a stray fresh session would overwrite the pointer and orphan the
> conversation with all the history."*

So *"share chat history across activities"* is a **revision of a decision**, not
a gap to fill, and it must be designed as one.

## Decision — D5: carry a digest, do not merge the sessions

Each activity keeps its own session and its own transcript. Entering activity B,
the tutor is handed a short, provenanced summary of what this group established
elsewhere. **Merging the sessions was rejected on three grounds, in ascending
order of cost:**

1. **It reverses ALS-1 on ground built for the opposite case.** The key, the
   first-wins guard and the archive-all query all assume the partition.
2. **It destroys attribution, which is the discipline layer's product.**
   [1.1.92](session-benchmark-tutor-activity.md) grades **tutor × activity**. A
   transcript spanning four activities occupies no cell in that matrix. Since
   D7 committed workstream D to exactly that instrument, merging would spend
   25 days building a benchmark and then feed it unattributable data.
3. **The context budget cannot hold it.** `MAX_INSTRUCTIONS_CHARS = 25_000`,
   re-sent every turn, and latency was already an August complaint. Four
   activities of transcript is a corpus, not a prompt.

**The digest also answers the report better than a merge would.** The student's
actual experience was *silence about something that happened*. A visible line
saying what carried over fixes the reported symptom; a merged transcript fixes
it by accident while breaking three other things.

## Milestones

### M0 — the digest ~1d

A pure function over stores that already exist. No new collection.

For a `(group_id, current_activity_id)`, read the group's **other** activities
and assemble, per activity:

| Field | Source | Why it earns its characters |
|---|---|---|
| Activity title + when | `activities` + `group_sessions.created_at` | Provenance. *"Earlier today, in Bølger"* is what makes the rest usable |
| Concepts marked | `concept_progress` | The only field that is a claim about **understanding** rather than about activity |
| Checklist items met | `checklist_progress` | Already summarised by `checklist_state_summary`, written for exactly this shape |
| One-line outcome | last turn / stored summary | ⚠️ See the open question — this is the only field that may need generating |

**Hard rules, both learned the expensive way:**

- **Distinguish "no other activities" from "could not read".** `None` and `[]`
  are different values and only one of them is safe to render as *"this is your
  first activity"*. This is the [footgun row](../../../../CLAUDE.md) about a
  checker answering when it could not read its subject, and the table fix on
  09-09 was the third instance in five weeks.
- **Budget it explicitly.** A per-activity cap and a total cap, with the count
  spent before the detail — the shape `ae2fcb3` used for the table block, for
  the same reason: one busy activity must not be able to starve another of the
  line that carries its existence.

### M1 — the tutor is told, with provenance ~0.5d

Inject on the same seam as `progress_context`, which exists because of the
**identical** problem one level down:
[progress-conversation-lifetime](progress-conversation-lifetime.md) shipped
*"the ticks survive a session; the conversation does not, and nothing tells the
tutor which it is looking at."* This is that, across activities.

The prompt contract matters more than the data:

- **Reference, do not resume.** *"This group established X in an earlier
  activity"* — not *"as we discussed"*. The tutor did not discuss it; a
  different session did, possibly with different students at the keyboard.
- **Never assert the digest as a student's understanding.** A concept marked in
  activity A is evidence, not a fact about the person in front of it now.
- **The group is not the student.** ADR-001 makes the group the unit, so
  *"you showed me"* is wrong even within one activity and is wronger across four.

### M2 — the student can see it ~0.5d

The half that actually closes the report. A dismissible line at the top of a new
activity's conversation: *"Picking up from Bølger — 3 goals met."* Precedent
exists: `progress-conversation-lifetime` M2 shipped the same affordance for the
within-activity case, and the wording should match rather than invent a second
voice.

**Without M2 this doc does not fix the thing that was reported.** The student
who thought their history was lost gets a tutor that mysteriously knows things,
which is a different confusion, not less of one.

### M3 — the teacher decides ~0.5d

An activity-level toggle, default **on**. Two reasons a teacher needs off:

- **A fresh-eyes activity.** *"What do you think will happen"* is ruined by a
  tutor that already knows what this group concluded last week — which is POE's
  entire first phase, and POE is one of the seven frameworks about to become
  tutors ([1.1.91](researcher-configurable-tutors.md) M5).
- **Assessment.** If a session is being scored ([1.1.92](session-benchmark-tutor-activity.md)),
  carried context is a confound the researcher has to be able to switch off.

## Open questions

1. **Does the one-line outcome need generating?** If it does, generate it
   **once, when an activity's session goes idle** — never per-turn behind the
   teacher's back, per 1.1.98's rule. If the checklist and concept summaries are
   enough on their own, M0 needs no model at all, and that is much the better
   answer. **Measure before deciding.**
2. **How far back?** All activities in the group's life, or a window? The group
   code has a 30-day TTL, which is a natural and already-enforced bound.
3. **Across classes?** No — start within a class. A group code belongs to one
   class, so this does not arise yet, but it will when individual codes do
   (ADR-001 revision, August items 24 + 27).
4. **Does the digest count as personal data leaving its activity?** It is
   group-scoped and carries no student identity, so on the face of it no — but
   it is new movement of student work between contexts and belongs in the DPIA
   conversation rather than being assumed.

## What this doc deliberately does not do

- **Merge sessions.** D5.
- **Build a memory service.** ADK has one; this is a bounded digest of four
  known stores, and reaching for general memory would make an un-gated 2-day
  item into an architecture project.
- **Fix the report before verifying it.** See the ⚠️ above.
