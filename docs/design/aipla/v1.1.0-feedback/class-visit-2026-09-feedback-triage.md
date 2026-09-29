# Class-visit feedback, week of 22 September 2026 — disposition map

**Status:** Triaged 2026-09-29. Design docs written; no code changed.
**Source:** An observer's notes from a class visit, relayed by M on 2026-09-29 (verbatim below). The date and afternoon timing match the **22 Sep 1st-year lesson** already triaged from logs in [classroom-session-2026-09-22-followups.md](classroom-session-2026-09-22-followups.md). ⚠️ *Confirm the date with the observer.* The prod log evidence below fits 22 Sep only.
**Nature:** The **human** half of that session. The logs said what broke; this says what the observer and the teacher saw, and what they asked for.

> Some insights during the class visit today. I think it went well and the
> teacher also had a good impression about it. The teacher said that the
> students became more active even though it was in the afternoon class. Some
> of the students use the platform positively well because the platform won't
> give them answers. I also came up with a few feedback:
> 1. One student reported that the platform was crashed, it was easy fix by
>    only refreshing the browser. I don't know whether it was related to the
>    traffic or something else. I also had that experiences.
> 2. In students evaluation, it would be nice we don't only see the full
>    dialogue but also data/figures/writings that students input in the workbench.
> 3. The teacher also mentioned if there is an option where they can write
>    students names in codes and download them as an excel.

## Summary

**The headline is good news.** The teacher saw an afternoon class become *more*
active, and students used the tutor well *because* it would not hand them
answers. That is the pedagogy working as designed, noticed by a teacher who
was not told to look for it.

**Of the three requests, all three are feasible and none needs a new legal
gate. One of them is only feasible in a particular shape.**

| # | Request | Feasible? | Disposition |
|---|---|---|---|
| 1 | "Crashed, refresh fixed it" | **Two causes found in prod logs. One fixed, one mostly fixed** | **Cause A — [1.1.131](insights-off-the-event-loop.md), SHIPPED prod v0.1.63.** A researcher's insights query froze the class's instance 14:44–14:48 on 22 Sep; a student's `/chat` shows `Load failed` at 14:49:22. **Extended today with M3/M4**: the group-report route has the same bug (smaller, and still live), and the guard that found it pages nobody. **Cause B — NEW [1.1.138 no-crash-across-a-deploy](no-crash-across-a-deploy.md).** 14 error-boundary crashes from school-hours prod deploys, one of them mid-lesson on 22 Sep. `e529ccba` auto-reloads now; M0 finds out whether the 4 after it are recoveries or a service-worker path |
| 2 | See workbench data/figures/writing in evaluations, not just the dialogue | **Yes — the data is already stored** | **NEW → [1.1.136 review-work-beside-the-transcript](review-work-beside-the-transcript.md).** Table, writing, checklist, calculator and sim state are all in Firestore or BigQuery. No review screen shows them next to the conversation. Charts are re-renderable from the table. **Photos/whiteboard are not kept, by policy**, a JB decision, not proposed here |
| 3 | Teacher writes student names against codes, downloads as Excel | **Yes, if the names stay on the teacher's device** | **NEW → [1.1.137 class-list-on-the-teacher-device](class-list-on-the-teacher-device.md).** Storing names server-side is the identity map ADR-001 removed (*"not pseudonyms, not first names"*) and the promise made to UCPH IT. A browser-only sheet with a local Excel export gives the teacher everything asked for. **Also found:** today's CSV exports garble æøå in Danish Excel (no BOM) |

## Prod log evidence for item 1 (verified 2026-09-29)

Prod `aipla-prod-2026`, 21–27 Sep, ~102.6k request rows, read with full permission.

- **The server itself was healthy.** 2 × 5xx all week (both a Nessus scanner), all 383
  stream POSTs 200, no OOM, no restart, no 300 s timeout. Group-token expiry is
  ruled out (8 h lifetime, zero stream 401s).
- **22 Sep class:** 16.6k requests in the 14:00 hour from 22 IPs. At 14:44:22 `insights/compare?scope=all`
  took 66 s on `00058-9pq`; everything else on that instance queued behind it
  (33–65 s). All four >60 s streams of the week are in this window.
- **The same freeze had already happened** on 21 Sep and the morning of 22 Sep.
  The observer's own "I also had that" could be either cause.
- **14 `reading 'call'` crashes** across 21–28 Sep, aligned with school-hours deploys.

## What this costs, against the extension plan

| Doc | Est | Serves | Plan fit |
|---|---|---|---|
| 1.1.131 M2–M4 | ~0.85d | every lesson | Workstream **F** (silent-failure hardening), **pull forward** |
| 1.1.138 | ~1.25–1.75d | every lesson | Workstream **F** |
| 1.1.137 | ~1–1.25d | teachers | Workstream **C** (teacher residue) |
| 1.1.136 | ~3–4d | researchers | Workstream **D**, the *"rubric-scored logs as assessment evidence"* bet. Its M4 is where it becomes evidence |
| **Total** | **~6–8d** | | Of ~75. F was budgeted ~5d and this is most of it |

### Suggested order

1. **1.1.131 M3 + M4** (~0.75d). A live, known freeze on a route the teacher's
   class view polls, and a detector nobody is told about. Do first.
2. **1.1.138 M0 + M1** (~0.5d). Find out what the post-fix crashes are, and
   stop promoting into lessons. Both cheap.
3. **1.1.137 M0** (~0.25d). The BOM fix helps every export teachers already use.
4. **1.1.137 M1–M2** (~1d). A good first pairing task for AD: frontend-only,
   small, and it teaches ADR-001 by building against it.
5. **1.1.136** (~3–4d), after or alongside [1.1.99](live-class-work-wall.md). They
   share the miniature renderers; build them once, here first (static is a
   subset of live).

## Questions

1. **For the observer:** which day was the visit, and roughly when did your
   own crash happen? If it was not 22 Sep 14:44–14:49, it was more likely cause B.
2. **For JB:** confirm that a browser-only class list is acceptable under
   ADR-001 and the DPIA. It stores nothing, but the page does *handle* names.
3. **For JB:** do we ever want solution photos/whiteboards kept for evaluation?
   (1.1.136 *Decision needed*.) Recommendation: not before the Google data
   agreement.
4. **For the teacher:** is a downloaded Excel file plus "import on another
   device" enough, or do they expect the list to follow them between machines?
   The latter is a stored identity map (1.1.137 *server-side alternative*).
