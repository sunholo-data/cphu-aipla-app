# Try as student — the builder opens the real student view, no join code

**Status:** **SHIPPED (code) 2026-09-24** — **1.1.133**
**Priority:** **P1** — teacher-requested, and the workaround (minting a real join code per test) fails often and pollutes class data
**Estimated:** ~0.75–1d
**Scope:** Backend — `auth/group_id_auth.py` (code prefix), `db/classes.py` (preview mint), `protocols/activity_routes.py` (route), `analytics/research_logs.py` (exclusion). Frontend — the activity builder button, the `/group` join page
**Dependencies:** **Implements the trial-session half of [1.1.27 lesson-author-surface](lesson-author-surface.md)** ("Try this lesson", designed 2026-06-12, never built), with a different identity decision (below); [1.1.40 builder live preview](activity-preview-mode.md) (**shipped** — the workbench-only preview this completes with the tutor); `preview:{uid}` exclusion from [1.1.113 tutor preview](researcher-configurable-tutors.md) (**shipped** — the same "nobody was taught" rule). **Un-gated**
**Created:** 2026-09-24

## The request

> *"Knap i 'builderen', der viser elevernes interface. Kan man lave en knap inde
> på den side hvor vi bygger siden op, der viser elevernes interface, så man ikke
> skal lave en elevkode hver gang (som ofte ikke virker)?"*

"A button in the builder that shows the students' interface, so we don't have to
make a student code every time (which often doesn't work)."

## What exists, and the gap

- The builder's **live preview** (1.1.40) renders the student workbench (sim,
  elements, documents) from the same converter students get, but with
  `sessionId=null`. **It has no tutor**, and the tutor is what a teacher most
  needs to test.
- A **"Preview as student"** button sits disabled in the builder's roadmap panel.
- The workaround is to mint a class code, open it, and join as a fake group. It
  fails when a pasted *link* goes into the code box (401, seen on prod
  2026-09-22), when a code comes from another environment, or when the code has
  lapsed. Every test group it creates is a **real student group**: it appears in
  the class roster and analytics, and in the research chat-log lens.

## Decision: a preview group, opened in a new tab

> **This departs from 1.1.27 on one point.** 1.1.27 had *"the teacher's Firebase
> UID flow through as the session's user identity (not a group code)"*, flagged
> by `is_trial` metadata. That puts a teacher token on the student chat page.
> Everything else in 1.1.27 carries over: a real session, the same agent loop, a
> new tab, and exclusion from class and research aggregation.


**Not** a teacher-authenticated chat page. The chat page is built for the group
token, and teaching it a second identity is the dual-auth surface this repo has
broken 4+ times. Instead the server mints a **short-lived preview group** and the
button opens the ordinary join link in a **new tab**. From there the student
pipeline runs unchanged: group JWT, class binding, activity resolution, greet,
tutor, workbench. The group token is tab-scoped (sessionStorage), so the
teacher's own tab is untouched.

| | Real class code | **Preview group** |
|---|---|---|
| Code | `bright-fox-42` | `preview-bright-fox-42` |
| TTL | 30 days | **1 day** |
| Bound to class (`anon_groups.classId`) | yes | yes, so activity context resolves |
| In `Class.groupCodes` (roster, class analytics) | yes | **no**, so it never counts as a student |
| Research chat-log lens | shown | **excluded** by prefix, like `preview:{uid}` |
| Spend | class owner | class owner (a teacher's test is the teacher's spend) |
| Join | student presses *Join* | **auto-join** when the code is a `preview-` code, then straight into the activity |

A fresh group per click, so every try starts at the opening turn, which is the
first thing a teacher wants to check.

## Route

`POST /api/activities/{activity_id}/preview-student`, body `{classId?}`.
Teacher-gated; owner or researcher (`_load_for_modify`). The class is either the
given `classId` (must be editable by the caller and contain the activity) or the
first of the caller's classes that contains it. It returns
`{code, joinUrl, next}`, where `next` is
`/chat/{skillId}?activity_id={id}`. If no class contains the activity it returns
**409** *"Assign this activity to a class first"*, because the tutor resolves its
context through the class.

## Join page

`/group?code=preview-…&next=/chat/…`: auto-join, then `router.replace(next)`.
`next` must be a same-origin path starting `/chat/` (no `//`, no scheme), or it
is ignored. Real codes keep today's behaviour: prefill only, the student presses
the button. Also fixed while there: a pasted join **link** in the code box is
reduced to its `code=` value.

## Tests

- Mint: prefix, TTL, class binding, and **absent from `Class.groupCodes`**.
- Route: owner OK, researcher OK, stranger 404, no class → 409, `next` shape.
- Research lens: a `preview-` group is counted as excluded, not as a student.
- Join page: `preview-` + safe `next` → joins and routes; unsafe `next` ignored;
  a real code is never auto-joined; a pasted link becomes its code.

## Open

- Uses the **saved** activity. The button says so; auto-save first is a later
  nicety.
- Expired preview groups are left to TTL, not deleted. Revisit if the
  `anon_groups` collection grows noticeably.
