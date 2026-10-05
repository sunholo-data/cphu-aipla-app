# Research access survives code deletion — revoking a join code must not orphan the evidence

**Status:** **Implemented (M1–M5), not yet deployed; M3 repair NOT yet run on prod** — **1.1.146** (2026-10-05). Option A shipped as recommended. M's prod step is under [Implementation notes](#implementation-notes-2026-10-05)
**Priority:** **P1** — a researcher on prod cannot review sessions that still exist, and every further Revoke by any teacher widens the gap. M0 (evidence) and M3 (repair) are the urgent half; M1–M2 stop it recurring
**Estimated:** ~2.5–3d (M0 evidence queries, run by M ~0.25d · M1 Revoke becomes a tombstone ~0.5d · M2 evidence vs live consumers + "Revoked codes" UI ~0.75d · M3 repair script + Makefile target ~0.5d · M4 researcher sees deleted classes ~0.25d · M5 end-to-end test + guard ~0.5d)
**Scope:** Backend: `db/classes.py` (`revoke_group_code`, `Class` roster semantics), `auth/group_id_auth.py` (tombstone check on verify, mint collision), `protocols/classes_routes.py`, `insights/aggregates.py`, `analytics/auth.py`, `protocols/progress_read_access.py`, `protocols/research_logs_routes.py`. New: `backend/scripts/repair_revoked_group_codes.py` + `make repair-revoked-codes`. Frontend: `app/teacher/classes/[id]/page.tsx` (a "Revoked codes" section), `messages/{da,en}/teacher-classes.json`
**Dependencies:** [1.1.80 group-erasure-cascade](group-erasure-cascade.md) (**open**, defines Erase as distinct from Revoke and is gated on JB; this doc builds the Revoke half only). [1.1.112 class-tutor-reaches-the-student](class-tutor-reaches-the-student.md) (the rename-in-place decision, taken because re-minting codes "splits the class's research evidence"). [1.1.135](teacher-authored-tutors.md) / `make check-client-api` (the gate that surfaced the unmounted `revokeGroupCode`, mounted 2026-09-29). **Un-gated** for M0–M5; the erasure question is listed for M and not decided here
**Created:** 2026-10-05
**Source:** Teacher seminar 2026-10-05, [notes-2026-10-05.md](../../../notes-2026-10-05.md): *"Tabitha deleted her group codes and now Aswin can't review the sessions. We do still have them."*

## Problem Statement

A teacher (Tabitha) removed join codes from her class on prod. A researcher
(Aswin, `role:researcher` claim) can no longer review the sessions those codes
produced. The conversations still exist. The control the teacher used promises
exactly that: its confirmation toast reads *"{code} revoked — it no longer works.
The group's work is kept."* (`frontend/messages/en/teacher-classes.json:271`).

The work is kept; the **route to it** is not. Every class-anchored review surface
enumerates a class's groups from `Class.groupCodes`, and Revoke removes the code
from that list and deletes the `anon_groups/<code>` document that held the only
code → class binding. The evidence becomes reachable only by someone who already
knows the code string or the session id.

This matters beyond one class. AIPLA's research output is rubric-scored logs as
assessment evidence. A teacher's housekeeping action silently subtracting groups
from every class analytic (KPIs, comparisons, progress, recent sessions) is a
data-integrity defect in the research instrument, not only a UX gap.

## Root cause

### Verified from code (2026-10-05, `dev` @ `f7391b64`)

**(a) What "Revoke" does.** The class page's per-code **Revoke** button
(`frontend/src/app/teacher/classes/[id]/page.tsx:294-305`, mounted in `52ca6b5a`
on 2026-09-29, first released in `v0.1.69`) calls `revokeGroupCode`
(`frontend/src/lib/teacherApi.ts:1071-1079`) → `DELETE /api/classes/{id}/groups/{code}`
(`backend/protocols/classes_routes.py:598-611`) → `db.classes.revoke_group_code`
(`backend/db/classes.py:444-470`), which performs two writes:

1. **Removes the code from `classes/<id>.groupCodes`** (`db/classes.py:453-459`).
2. **Hard-deletes `anon_groups/<code>`** (`db/classes.py:468`). That document is
   the only record of `classId` for the code (written at mint, `db/classes.py:386-391`).

It is a delete, not a revoke. A soft-revoke primitive already exists and is not
used: `auth.group_id_auth.delete_group` (`backend/auth/group_id_auth.py:623-650`)
sets `revoked: True` on the document (`_mark_revoked_in_firestore`, `:444-451`),
and `_load_group_from_firestore` already treats a revoked document as absent for
joins (`:430-441`). Its only route is the template's `DELETE /api/auth/group/{id}`
(`backend/auth/group_routes.py:555-567`), which the class page does not call.

**(b) The class-level Delete is a different control.** `DELETE /api/classes/{id}`
(`classes_routes.py:483-495`) soft-deletes the class (`revoke_class`,
`db/classes.py:334-351`; `revoked`/`revokedAt` set, `groupCodes` untouched). Its
copy already warns that *"session reports become inaccessible"*
(`teacher-classes.json:226`). Both `list_classes_for_owner` and `list_all_classes`
exclude revoked classes by default (`db/classes.py:105-128`), so a deleted class
disappears from the researcher's class list (`classes_routes.py:405, 441`) and from
`insights scope=all` (`insights/aggregates.py:300-302`). "Deleted her group codes"
may describe either control; M0 tells them apart.

**(c) Which review surfaces break.** Grouped by how each resolves sessions:

| Surface | Resolves sessions via | After per-code Revoke |
|---|---|---|
| Class page code list → group report link | `cls.groupCodes` (`page.tsx:384-390`, link `:496`) | **Gone.** No row, no link |
| Class page "recent sessions" | `list_sessions_for_group_codes(cls.group_codes)` (`classes_routes.py:674-692`) | **Gone** |
| Class live signals | `compute_group_signals(cls.group_codes)` (`classes_routes.py:814`) | Gone (acceptable: live view) |
| Class activity summary, teacher bootstrap | `summarize_activity_for_group_codes(c.group_codes)` (`classes_routes.py:445-449`, `teacher_bootstrap_routes.py:145-168`) | **Under-counts** |
| Insights KPIs / groups / activities / trend | `_class_group_codes` (`insights/aggregates.py:52-58`, used `:129, :201, :237, :449`) | **Silently drops the group** |
| Insights summary / compare (incl. researcher `scope=all`) | `cls.group_codes` (`aggregates.py:286-304, :329, :389`) | **Silently drops the group** |
| Teacher analytics chat + `cost/mine` | `resolve_caller_group_codes` (`analytics/auth.py:120-133`), `insights_routes.py:347-353` | Drops the group |
| Per-activity all-groups progress | `all_groups_scope` → `cls.group_codes` (`progress_read_access.py:40-55`) | **Drops the group** |
| Class list sheet (local names) | `codes={cls.groupCodes}` (`page.tsx:524`) | The teacher's name mapping for that code is no longer shown |
| Group report `/teacher/reports/groups/<code>` | BigQuery by group code (`reports_routes.py:149-200`); class only for header labels via `get_class_for_group` (`:38-62`, `db/classes.py:202-213`) | **Still works if the URL is known**; `className`/`classId` come back null, so no link back to the class |
| Researcher conversation log (`/teacher/insights/conversations`) | BigQuery `chat_turns` by session id / filters (`research_logs_routes.py:91-123`, `analytics/research_logs.py:98-124, 275`) | **Still works.** No Firestore join |
| Group timeline (teacher report) | `_assert_can_read_group` → `get_class_for_group` (`research_logs_routes.py:147-164`) | Researcher passes (`:158-159`, "unclassed group"); **the owning teacher gets 404** |
| Rubric runs / backfill | Firestore `rubric_runs` keyed by `group_id` string (`analytics/rubric_runs.py:34, 42-57, 115`); backfill from BigQuery (`research_lens_routes.py:295-345`) | **Still works** by code |

The pattern: everything that reads **from the log by key** survives; everything
that **discovers** groups through the class roster or the binding document loses
them, and the insights family does so silently (fewer groups, no error).

**(d) What still exists after a per-code Revoke.** Nothing in
`revoke_group_code` touches any other store (`db/classes.py:444-470`). So:
BigQuery turns (`chat_logs.aipla_chat_turn`, view `chat_logs.chat_turns`,
`backend/db/bigquery.py:24-25`, `infrastructure/modules/chat-logs/views.tf:43`;
365-day partition expiry on test/prod, `backup.tf:11-12`) and workbench events;
the Firestore `chat_sessions` index (keyed by `ownerUid = anon-<code>`,
`db/chat_sessions.py:339-375`); ADK sessions in Agent Engine
(`backend/adk/session.py:659-674`, keyed by the same synthetic uid); `rubric_runs`;
per-group progress stores (concept, checklist, writing) and uploads; the daily
Parquet backup. 1.1.80 audited the per-group stores in full
([group-erasure-cascade.md](group-erasure-cascade.md), "Store audit").

**(e) Attribution limits.** `class_id` has been stamped on chat turns only since
`e3a8c7f2` (2026-09-11, 1.1.91 TUTOR-5) and on workbench events since `d2798f8e`
(2026-09-29). A deleted code's turns **before 2026-09-11** carry no `class_id`, and
the binding document that would attribute them is gone. Two other witnesses
remain: the Cloud Logging lines `classes_db: revoked group code=%s from class=%s`
(`db/classes.py:470`) and `classes_route: revoked code=%s class=%s teacher=%s`
(`classes_routes.py:609`), within the log retention window.

### Found in passing (verified, out of scope here, flagged)

- **Revoke does not end an outstanding session token.** `verify_group_token`
  checks only the in-memory revoked set (`group_id_auth.py:823-824`), and
  `_resolve_class_tags` returns empty tags, not an error, when `anon_groups/<code>`
  is missing (`:238-240`). The code comment *"the next token verification fails"*
  (`page.tsx:288-290`) is therefore not what the code does: an 8-hour token
  (`:55`) keeps authenticating. Whether empty tags in practice deny the class's
  activities is a **hypothesis** (likely, via tagged access) to be confirmed in M1's
  test. The tombstone in M1 fixes this as a side effect.
- **Code reuse after hard delete.** The mint collision check is in-memory only
  (`group_id_auth.py:490`); after a hard delete, nothing durable prevents the same
  string being minted again, and the uid is deterministic (ADR-001), so a new
  cohort would inherit the old one's sessions. This is 1.1.80 M3's hazard, made
  reachable by the Revoke button.
- **`/api/reports/*` has no ownership check.** `get_session_report` and
  `get_group_latest_report` accept any authenticated caller (`_user` unused,
  `reports_routes.py:118-200`). Not caused by this doc; it needs its own fix, and
  that fix must resolve ownership through the tombstone (M1), or tightening it
  will re-break revoked codes for their own teacher.

### Hypotheses (not verified; M0 settles them)

- **H1.** Aswin looked through a class-anchored surface (class page, insights), not
  the conversation log. If they used the conversation log, the cause is different
  (filtering or pagination), and the repair below would not help them.
- **H2.** Tabitha used per-code **Revoke**, not class **Delete**. The two leave
  different traces in Firestore (shrunken `groupCodes` vs `revoked: true`).
- **H3.** All of the affected turns are after 2026-09-11, so `class_id` in BigQuery
  attributes them. Earlier turns need the Cloud Logging witness.


## M0 results — prod, read 2026-10-05 evening

**H2 confirmed: per-code Revoke, not class Delete.** Cloud Logging, `classes_route: revoked code=`:

| When (UTC) | Codes | Class | Student turns lost to review |
|---|---|---|---|
| 2026-09-30 09:01:31–36 | `busy-garden-11`, `tidy-boulder-05`, `huge-seed-10`, `late-guppy-49` | `0be138dda057` (*Fysik C – Energi*, the 10-05 seminar class) | 235 attributed + **62 before 2026-09-11 with `class_id` NULL** (`busy-garden-11`, H3) |
| 2026-09-30 09:02:25–28 | `nimble-button-13`, `salty-brook-09`, `happy-leaf-26` | `399b198bbe21` | 30 |
| 2026-09-30 10:45 | `leafy-thicket-13` | `59ad12cd997b` (JB's) | 5, all unattributed (Aug–Sep 3) |

All seven in the first two rows were revoked **the morning after the 29 Sept class**, about one
code per 2 seconds — a clean-up, not a security response. ⚠️ **The revoking uid is the class
owner, AR's account**, not a separate teacher account; the note says Tabitha. Either she was
signed in as AR, or the note conflates people. Worth one question, because 1.1.150 raises the
same shared-login possibility. The conversations are intact in BigQuery (queries above).

**M's requirement, 2026-10-05:** *"we want to analyse sessions even after they are revoked."*
That is Option A as recommended — Revoke ends access, never evidence — and the M3 repair input
is the table above.

## Decision

The governing distinction, already recommended by 1.1.80 and adopted here:
**Revoke ends access; it does not touch evidence. Erase destroys evidence; it is a
separate, deliberate control.** This doc builds Revoke properly. It does not build
Erase and does not decide erasure policy.

### Options

| | Option | For | Against |
|---|---|---|---|
| A | **Tombstone + historical roster.** Revoke sets `anon_groups/<code>` to `{revoked: true, revokedAt, revokedBy, classId}` (binding kept), and the code **stays** in `groupCodes`, with a new `Class.revokedGroupCodes` recording which are retired. Evidence surfaces read all codes; live surfaces filter to active ones | Failure mode is **loud**: a live surface that forgets to filter shows a revoked code, which a teacher sees. Every evidence consumer is correct with no edit. Ownership stays resolvable | Each live consumer must be found and filtered |
| B | **Tombstone + separate retired list.** Code leaves `groupCodes`; evidence surfaces switch to a new `evidence_group_codes` property | `groupCodes` keeps meaning "joinable" | A consumer that is not switched **silently** under-counts, which is the bug class this repo writes guards against |
| C | **Resolve from the log only.** Evidence surfaces read group sets from BigQuery `class_id` | No roster semantics at all | No attribution before 2026-09-11; costs a BigQuery read per page; insights already scope by roster for authorisation |
| D | **Do nothing but repair.** Re-bind Tabitha's codes; leave Revoke as is | Cheapest | Recurs on the next Revoke, by any teacher |

**Recommendation: A, with the M3 repair for the codes already deleted.** The
deciding argument is the failure mode. Under A a missed live consumer produces a
visible wrong row; under B a missed evidence consumer produces a smaller,
plausible number in a research table. AIPLA has shipped the second shape
repeatedly (see CLAUDE.md, "A checker answers when it could not read its subject").

Live consumers to filter under A (the complete list from the table above):
the class page code list and its Reset/Revoke buttons, `compute_group_signals`,
`reset_group_session` (`classes_routes.py:629`, refuse a revoked code), and the
mint path (never reissue a tombstoned string). Everything else reads all codes.

## Milestones

### M0 — evidence (run by M on prod; read-only; ~0.25d)

Not run in the design session: prod reads were not permitted. Each step is a read.

1. **Ask Aswin which page they used** (settles H1) and Tabitha which button (H2).
2. **Tabitha's uid and classes**, including deleted ones:
   ```bash
   scripts/aiplatform-admin.sh prod users list-access | grep -i tabitha   # uid column
   cd backend && GOOGLE_CLOUD_PROJECT=aipla-prod-2026 uv run python -c "
   from db.firestore import query_documents
   for c in query_documents('classes', filters=[('ownerUid','==','<UID>')], limit=50):
       print(c.get('__id'), c.get('name'), 'revoked=', c.get('revoked'), c.get('revokedAt'), 'codes=', c.get('groupCodes'))"
   ```
3. **The deletion events** (Cloud Logging, the witness that does not depend on `class_id`):
   ```bash
   gcloud logging read 'textPayload:"classes_route: revoked code=" AND textPayload:"<UID>"' \
     --project=aipla-prod-2026 --freshness=30d --format='value(timestamp,textPayload)'
   gcloud logging read 'textPayload:"classes_route: revoked class=" AND textPayload:"<UID>"' \
     --project=aipla-prod-2026 --freshness=30d --format='value(timestamp,textPayload)'
   ```
4. **Groups that chatted under her classes but are no longer on any roster:**
   ```sql
   -- aipla-prod-2026.chat_logs.chat_turns; substitute her class ids and current codes
   SELECT class_id, group_id,
          COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS turns,
          MIN(ts) AS first_ts, MAX(ts) AS last_ts
   FROM `aipla-prod-2026.chat_logs.chat_turns`
   WHERE class_id IN UNNEST(@class_ids)
     AND NOT STARTS_WITH(IFNULL(group_id, ''), 'teacher:')
     AND NOT STARTS_WITH(IFNULL(group_id, ''), 'preview')
     AND group_id NOT IN UNNEST(@current_codes)
   GROUP BY class_id, group_id ORDER BY last_ts DESC;
   ```
5. **Pre-2026-09-11 turns of those codes** (settles H3):
   ```sql
   SELECT group_id, COUNTIF(class_id IS NULL) AS unattributed_turns,
          COUNT(DISTINCT session_id) AS sessions, MIN(ts) AS first_ts
   FROM `aipla-prod-2026.chat_logs.chat_turns`
   WHERE group_id IN UNNEST(@deleted_codes)   -- from steps 3 and 4
   GROUP BY group_id;
   ```
   Neither query filters on `role`. If one is added, the values in `chat_turns`
   are `'student'` and `'tutor'` (`analytics/research_logs.py:72-76`), not the
   ADK pair `'user'`/`'assistant'`, which matches zero rows without an error.
6. **Confirm the binding documents are gone** and nothing re-minted the strings:
   `get_document('anon_groups', '<code>')` for each code, expect `None`.

Output: a list `(class_id, code, revoked_at, sessions, first_ts)` in the notes
file. It is the input to M3.

### M1 — Revoke becomes a tombstone (~0.5d)

- `revoke_group_code` stops deleting. It writes `anon_groups/<code>`
  `{revoked: true, revokedAt, revokedBy, classId}` (merge) and appends to
  `Class.revokedGroupCodes`; the code **remains** in `groupCodes`. Idempotent;
  a second call does not shift `revokedAt`.
- `_resolve_class_tags` raises `GroupRevoked` on a tombstoned document. It
  already reads the document on every verify (`group_id_auth.py:238`), so this
  makes revocation live across instances at no extra read.
- Mint refuses any code string whose `anon_groups` document exists, revoked or
  not (durable, replacing the in-memory check at `:490`).
- `get_class_for_group` resolves through a tombstone (it reads `classId` only).
- Route and response unchanged, so `revokeGroupCode` and its tests stand.

### M2 — evidence vs live consumers, and a visible "Revoked codes" section (~0.75d)

- `Class.active_group_codes` (= `groupCodes` minus `revokedGroupCodes`) used by
  the four live consumers named under Decision; every other consumer unchanged.
- Class page: active codes as today; a collapsed **Revoked codes** list below, each
  row with its revoked date and the existing report link (`page.tsx:496`), no
  Reset/Revoke/join-link. The class list sheet keeps the teacher's local names for
  revoked codes.
- Copy (da + en, via `useT()`; `make check-i18n`): the toast stays true; the
  confirmation adds *"Its conversations stay available to you and to researchers."*
- Researcher group timeline: unchanged behaviour, and the owner no longer 404s
  because the binding survives.

### M3 — repair the codes already deleted (~0.5d)

`backend/scripts/repair_revoked_group_codes.py` + `make repair-revoked-codes
ENV=prod [CLASS=<id>] [GO=1]`. Python, not AILANG: it needs the Firestore and
BigQuery clients the backend already wraps, and it ships with the backend, not
to a client.

- **Discovery** (both sources, reported separately): BigQuery `class_id ×
  group_id` pairs not in any roster (M0 step 4 query); Cloud Logging revoke lines
  (M0 step 3).
- **For each** `(class_id, code)`: refuse if `anon_groups/<code>` exists with a
  *different* `classId` (report, never overwrite); otherwise write the tombstone
  with `repairedAt` and `repairSource: "bq" | "log"`, append the code to
  `groupCodes` and `revokedGroupCodes`.
- **Dry run by default**, printing the table and the writes it would make; `GO=1`
  writes; `ENV=prod` without `CLASS=` refused unless `FORCE=1`. Idempotent.
- Codes found only as unattributed pre-2026-09-11 turns are **listed, not
  written**: attributing them to a class needs the log witness or M's decision.

### M4 — a deleted class stays visible to researchers (~0.25d)

Researcher class list and `insights scope=all` pass `include_revoked=True` and
mark the class "deleted by teacher". Owner lists unchanged. Whether a teacher can
see her own deleted classes is an open question below.

### M5 — tests and a guard (~0.5d)

See Tests. Add the class roster to the footguns table in CLAUDE.md under a new row
("Revoke hard-deleted the binding; evidence disappeared from every class surface").

## Implementation notes (2026-10-05)

**What shipped** (worktree branch, not yet on `dev`):

- **M1 — tombstone.** `db.classes.revoke_group_code(class_id, code, revoked_by=)`
  writes `anon_groups/<code>` `{revoked, revokedAt, revokedBy, classId}` (merge),
  keeps the code in `groupCodes`, appends it to the new `Class.revokedGroupCodes`
  and records the time in `Class.revokedGroupCodesAt`. Idempotent. A code not
  bound to the class now raises `GroupCodeNotInClass` → **404** (the old version
  deleted whatever `anon_groups` doc it was handed — another class's included).
  `auth.group_id_auth`: `_resolve_class_tags` and `_resolve_live_class_context`
  raise `GroupRevoked` on a tombstone (token refused, join and refresh refused,
  on every instance); `create_group` refuses any string whose `anon_groups` doc
  exists (`_code_taken`, a read failure propagates rather than reading as
  "free"); `upsert_group` refuses a tombstone (it would otherwise have re-persisted
  it with `revoked: False`). The found-in-passing token bug is fixed by this.
- **M2 — evidence vs live.** `Class.active_group_codes` (backend) and
  `activeGroupCodes()` / `revokedGroupCodes()` in `frontend/src/lib/classCodes.ts`.
  Live consumers filtered: class page code list + subtitle, `compute_group_signals`
  (`/live`), `reset-session` (**409** on a revoked code), onboarding stage
  (`onboarding/stage.py`, bootstrap `groupCodes`, client `classStage`), the
  class-list count and delete-dialog count, and the `manage-class` tool brief
  (adds `revoked_group_codes`). Every evidence consumer is unchanged and now
  sees revoked codes. Class page: a collapsed **Revoked codes** list with the
  revoke date, last activity, the teacher's local names and the report link; no
  join/reset/revoke. The class list sheet keeps local names for revoked codes
  (`retainedCodes`) but neither shows nor exports them. Copy da + en.
- **M3 — repair.** `backend/scripts/repair_revoked_group_codes.py` +
  `make repair-revoked-codes`. Witnesses: BigQuery `class_id × group_id` pairs on
  no roster (`bq`), Cloud Logging revoke lines (`log`), and **on prod the M0
  table itself (`m0`, `M0_PROD_EXPECTED`)** — added because the `_Default` log
  bucket keeps 30 days, so after ~2026-10-30 the log witness for the 30 Sept
  revokes is gone and `leafy-thicket-13` (all turns unattributed) would otherwise
  fall to list-only. On prod the dry run states whether today's `bq`/`log`
  discovery matches M0. Conflicting `classId` → refused and the run exits 1; a
  live binding → skipped; unattributed codes with no witness → listed only.
- **M4.** Researcher `GET /api/classes?scope=all`, `/api/classes/activity?scope=all`
  and insights `scope=all` include deleted classes; the research view marks them
  *"Deleted by teacher"*. Owner lists unchanged.
- **M5.** Tests as specified (below), plus a footguns row and an automation row
  in `CLAUDE.md`.

**M's prod step** (after this is deployed to prod, and after open question 1 is
answered for each class). Dry run first, one class at a time; read the table and
the M0 comparison line, then repeat with `GO=1`:

```bash
make repair-revoked-codes ENV=prod CLASS=0be138dda057          # 4 codes (Fysik C – Energi)
make repair-revoked-codes ENV=prod CLASS=0be138dda057 GO=1
make repair-revoked-codes ENV=prod CLASS=399b198bbe21          # 3 codes
make repair-revoked-codes ENV=prod CLASS=399b198bbe21 GO=1
make repair-revoked-codes ENV=prod CLASS=59ad12cd997b          # 1 code (JB's)
make repair-revoked-codes ENV=prod CLASS=59ad12cd997b GO=1
```

Needs ADC for `aipla-prod-2026` with Firestore write, BigQuery read and Logging
read. A second run of each must report `0 tombstone(s)` / "already repaired".
Deploy first: on the old code a repaired tombstone is harmless (the old verify
path ignores it) but the class page would not show the revoked list.

**Not built, by instruction or because it needs M:** Erase (1.1.80, gated on JB);
any change to `/api/reports/*` authorisation (flagged above, separate); open
questions 1–5 below are unanswered — in particular Q1 must be asked before
`GO=1`, Q2 (privacy-notice wording) before deploy, and Q3 is why pre-2026-09-11
codes with no log/M0 witness are listed, not written. A teacher still cannot see
her own deleted classes (Q4).

## Acceptance criteria

- [x] After Revoke, the code cannot join, and an outstanding group token is
      refused at its next request (401), on any instance.
- [x] After Revoke, the class page lists the code under Revoked codes with a
      working report link, for the owner and for a researcher.
- [x] After Revoke, class KPIs, compare, recent sessions and all-groups progress
      return the same counts for the revoked group's past window as before it.
- [x] A revoked code string is never minted again.
- [ ] `make repair-revoked-codes ENV=prod CLASS=<Tabitha's class>` dry-run lists
      exactly the M0 set; with `GO=1` Aswin can open each session from the class
      page; a second run writes nothing. *(Built and unit-tested; prod run is M's.)*
- [x] A class deleted by its teacher remains listed for researchers, marked.
- [x] No erasure behaviour changes. Nothing in this doc deletes data.

## Tests

- **`backend/tests/api_tests/test_research_survives_code_revocation.py`** (new,
  end-to-end, the one that witnesses the bug): mint a code under a class through
  the real route → join with a real minted group token → emit a chat turn (stub
  the BigQuery read with the emitted row, as `test_research_logs_routes.py` does)
  → `DELETE /api/classes/{id}/groups/{code}` → assert (i) the old token is refused,
  (ii) a researcher's `GET /api/classes/{id}` still carries the code and
  `recent-sessions` still returns the session, (iii) the owner's
  `GET /api/research/logs/groups/{code}/sessions/{sid}/timeline` is 200, not 404,
  (iv) insights `class_kpis` counts the group. Uses the real dispatcher, not a
  `dependency_overrides` of the symbol under test (CLAUDE.md, dual-auth row).
- `backend/tests/unit/test_classes_firestore.py`: rename the misnamed
  `test_revoke_group_code_marks_anon_group_revoked` (`:214`; it asserts removal,
  not marking) and make it assert the tombstone, the kept `classId`, idempotency.
- `backend/tests/unit/test_group_id_auth.py`: tombstone → `GroupRevoked` on
  verify; mint refuses a tombstoned string.
- `backend/tests/unit/test_repair_revoked_group_codes.py`: dry run writes nothing;
  conflicting `classId` refused; idempotent; unattributed codes listed only.
- `frontend/src/app/teacher/classes/[id]/__tests__/page.test.tsx`: revoked codes
  render in their own section with a report link and no Revoke/Reset buttons.

## Handover to a cloud agent

Read first: this doc; CLAUDE.md "Anonymous-Group Auth" and the footguns table;
[group-erasure-cascade.md](group-erasure-cascade.md) (why Revoke and Erase are
separate). Files: listed under **Scope**, with every consumer of `group_codes`
in the table in Root cause (c); find any new ones with
`grep -rn "group_codes\|groupCodes" backend frontend/src`.

Commands, all must pass before pushing to `dev`:

```bash
cd backend && make lint && make test-fast
cd frontend && npm run quality:check
make check-client-api check-i18n check-auth-dispatcher check-routes-tracked
make test-frontend-ci-node        # if a localStorage-touching test changed
```

After pushing, check the dev build went green
(`gcloud builds list --project=aipla-dev-2026 --region=europe-north1`).

Do **not**:
- run M0 or M3 against prod, or any write against test/prod; M runs them;
- delete any data, or add an Erase path (1.1.80, gated on JB);
- change `/api/reports/*` authorisation in this change (flagged above, separate);
- change the deterministic uid scheme (ADR-001);
- make evidence surfaces read BigQuery for group discovery (Option C);
- use `revoked` on `anon_groups` without keeping `classId` on the same document.

## Open questions for M

1. **Did Tabitha intend erasure?** If she deleted codes because students or a
   school asked for data removal, the right response is 1.1.80's Erase, not this
   repair, and M3 must not run on her classes. Ask her before `GO=1`.
2. **Erasure policy stays with JB and the DPO.** This doc makes Revoke keep data;
   that is only defensible if the privacy notice says so. Does the student notice
   shipped in `2a1d0619` state that revoking a code retains the group's work for
   the study period? If not, it should before M1 ships.
3. **Pre-2026-09-11 turns of a deleted code**: attribute via the Cloud Logging
   witness only, or leave them as unclassed (still readable in the conversation
   log)?
4. **Should a teacher see her own deleted classes** (read-only), or only
   researchers?
5. **Class Delete** has the same orphaning shape at class level. Is M4's
   researcher-only fix enough, or should Delete become reversible for the owner?
