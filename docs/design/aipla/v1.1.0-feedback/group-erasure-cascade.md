# Group erasure — deleting a group code must delete what the group produced

**Status**: Planned
**Priority**: P0
**Estimated**: ~2.5d
**Scope**: Backend + one teacher-UI change + privacy notice
**Dependencies**: None. Independent of [1.1.79](pilot-session-2026-08-21-followups.md), though it is the same `parsed_documents` store.
**Created**: 2026-08-25
**Last Updated**: 2026-08-25

## Problem Statement

In a stakeholder meeting on 2026-08-25 the project stated that **when an
anonymous group ID is deleted, the documents that group uploaded are deleted
with it.** That is not true today, and nothing in the product does it.

It is a reasonable thing to have believed. It is what a teacher pressing
**Slet** expects, it is what the recordings code already does for audio, and it
is the only reading of the delete button that is defensible to a school.

### What actually happens

Both deletion paths touch the group record and nothing else:

- [`revoke_group_code`](../../../../backend/db/classes.py#L378) (the teacher UI button) — drops the code from the class and deletes `anon_groups/<code>`.
- [`delete_group`](../../../../backend/auth/group_id_auth.py#L598) — marks it revoked so the JWT stops verifying.

Neither reads `parsed_documents`, `writing_progress`, or GCS. The code stops
working; everything the group wrote or uploaded stays.

`delete_class` is a soft-delete (`revoke_class`) with **no cascade at all**.

### There is no erasure cascade anywhere in the product

The sharper finding, and the reason this is a design doc rather than a one-line
fix: erasure helpers **do exist**, and not one of them is wired to a deletion.

| Helper | Actually called from |
|---|---|
| `delete_recordings_for_group` | only its own endpoint `DELETE /api/recordings/group/{id}` |
| `clear_checklist_progress` | only the **reset-session** route |
| `clear_concept_progress` | only the **reset-session** route |
| `archive_session_for_group` | only reset-session |

So the audio "GDPR erasure" path — the one whose docstring says exactly that —
is a standalone endpoint that group deletion never calls, and that no teacher
surface appears to expose.

### Store-by-store erasure coverage

Verified against the collections that actually exist in prod Firestore:

| Store | Holds | Group erasure | On group delete |
|---|---|---|---|
| `parsed_documents` + GCS | **student/teacher uploaded files** | **none** (only per-doc, owner-only) | no |
| `writing_progress` | **student-authored text** | **none** | no |
| `checklist_progress` | AI/student marks | helper exists | no |
| `concept_progress` | concept marks | helper exists | no |
| `group_sessions` | session pointer | helper exists | no |
| `group_signals` | hand-raise state | helper exists | no |
| `chat_sessions` | conversation index | archive-on-expiry | no |
| `recordings` + GCS | lesson audio | full eraser | no |
| BigQuery `aipla_chat_turn` | research turns | partition TTL | n/a |

**The two stores holding student-authored content are precisely the two with no
group erasure path at all.** Everything with a helper is state *about* the work;
the two with nothing are the work itself.

### Retention today, both roles

Identical for students and teachers — same collection, same bucket, keyed only
by `userId`:

- **No GCS lifecycle rule** on dev, test or prod.
- **No Firestore TTL policy** — `gcloud firestore fields ttls list` returns 0 items.
- **No scheduled sweep.**
- Only deletion path is `DELETE /api/documents/{doc_id}`, one document at a
  time, owner-only (`doc.userId == user.uid`). A teacher **cannot** delete a
  student group's uploads: the owner is the synthetic group uid, not the teacher.

### Two hazards beyond retention

**1. Deterministic uids make deletion look like carry-over.**
[`_synthesize_uid`](../../../../backend/auth/group_id_auth.py#L304) returns
`anon-<code minus hyphens>`. Revoke `bright-fox-42`, re-mint the same string
next term, and the new cohort authenticates as `anon-brightfox42` — the *same*
owner uid — and inherits the previous cohort's documents and writing. This is
not a retention gap; it is one class reading another's work. The deterministic
uid is deliberate and correct (ADR-001: the group is the unit of identity, and a
shared uid is what makes one shared conversation possible) — so the fix belongs
in erasure, not in the uid.

**2. The clean-slate scripts miss the same two stores.**
`reset-group-state.sh` wipes `group_sessions`, `chat_sessions`, `anon_groups` —
never documents, never GCS. And `reset_teaching_data.py` lists a collection
named `"documents"`, but the real one is **`parsed_documents`**; prod has no
top-level `documents` collection, so that entry is a no-op. Uploads survive even
the dev clean-slate wipe.

### The privacy notice does not cover any of it

`frontend/src/app/(site)/privacy/page.tsx` is
still headed *"Udkast / Draft"*. It lists group code, chat content and workspace
interactions; it says nothing about uploaded documents, recordings, retention
periods, or deletion rights. It also promises a DPIA "før pilotstart
2026-08-14" — **overdue**.

### Why now, and why it is cheap

Prod holds **four** documents. Three are orphaned `failed` rows from the
2026-08-21 session (Firestore row written, bytes never stored, because the
upload path records before the GCS write that 403'd); the fourth is a smoke
file. Upload only began working on 2026-08-25 under
[1.1.79](pilot-session-2026-08-21-followups.md).

**There is no backlog yet.** Every week this waits, the reconciliation gets
more expensive and involves real student work.

## The tension this has to resolve first

Erasure-on-delete is not obviously right, and the doc must not pretend it is.

`research_audio`'s own comment says *"research data persists for the study;
erasure is the explicit delete-by-group_id route"*, and the chat-log pipeline is
consent-driven with a retention window. Under that posture, auto-erasing a
group's uploads because a teacher tidied up a class list would **destroy study
data** — and a teacher revoking a code at the end of term is housekeeping, not a
GDPR request.

But a button labelled **Slet** that silently retains everything is worse: it is
the failure this whole doc exists because of, and it is what was described to
stakeholders.

**Recommendation: split the two operations and name them honestly.**

| Operation | Meaning | Data |
|---|---|---|
| **Revoke** (today's button, renamed) | the code stops working | retained under the study protocol |
| **Erase** | a deliberate, confirmed erasure request | every store for that group destroyed, GCS included |

Erase is the one that satisfies both the meeting statement and GDPR Art. 17.
Revoke keeps the research record intact. What is not acceptable is one button
that reads as the first and behaves as the second.

**This needs JB's decision before M2 is built** — it is a research-protocol
question, not an engineering one. M1 (the registry and the erasure primitive) is
useful under either answer and should not wait for it.

## Goals

**Primary Goal:** A group's erasure destroys everything that group produced, in
every store, verifiably — and no future per-group store can be added without an
eraser.

**Success Metrics:**
- Erasing a group leaves zero rows in every per-group store and zero objects under its GCS prefix.
- A newly-minted code reusing a previously-erased code string starts empty.
- A new per-group Firestore collection fails CI until it is registered with an eraser.
- The privacy notice states retention and deletion for documents and recordings.

**Non-Goals:**
- Changing the deterministic uid scheme (ADR-001; it is load-bearing for shared sessions).
- BigQuery research-turn erasure — consent-driven and JB's call; out of scope beyond recording the decision.
- A general per-user GDPR export.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Erasure is a background-ish teacher action, not a student-latency path. |
| 2 | EARNED TRUST | **+1** | A delete control that does what it says is the base case of the axiom; today's says one thing and does another. |
| 3 | SKILLS, NOT FEATURES | 0 | No change to the skill abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involvement. |
| 5 | GRACEFUL DEGRADATION | **+1** | Partial erasure must be reported and resumable, never silently half-done. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Firestore/GCS deletes; nothing to standardise. |
| 7 | API FIRST | **+1** | One erasure endpoint + one registry, reused by routes, CLI and the reset scripts, rather than three divergent wipes. |
| 8 | OBSERVABLE BY DEFAULT | **+1** | Erasure emits a per-store audit line — a GDPR erasure you cannot evidence is one you cannot claim. |
| 9 | SECURE BY CONSTRUCTION | **+1** | Closes cross-cohort carry-over on code reuse, and the registry makes coverage structural rather than remembered. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Server-side. |
| | **Net Score** | **+5** | Threshold: >= +4 |

**Conflict Justifications:** None — no axiom scores -1.

## Design

### M1 — an erasure registry, not a function per caller

The failure mode here is not "documents were forgotten". It is that erasure
knowledge is scattered: four helpers, each wired to a different action, none to
deletion. A fifth helper would be forgotten the same way.

One registry — `backend/db/group_erasure.py` — where each per-group store
registers `(collection, field, eraser)`. `erase_group(group_id)` walks it,
calls every eraser, and returns a per-store count.

```python
ERASERS = [
    GroupStore("parsed_documents", erase_documents_for_group),   # + GCS objects
    GroupStore("writing_progress", erase_writing_for_group),
    GroupStore("checklist_progress", clear_checklist_progress),
    ...
]
```

Documents and writing get the two erasers that do not exist yet. Documents must
delete the **GCS object as well as the row** — a Firestore-only delete leaves
the bytes, which is the failure the recordings eraser already avoids.

**The gate.** A test enumerates the collections the backend writes to with a
group-shaped key and asserts each appears in the registry. A new per-group store
then fails CI until someone decides its erasure behaviour. Same shape as
1.1.79's element-parity gate, and the same reason: a second registration site
nothing forces you to update.

### M2 — wire it to a deliberate Erase, and rename Revoke

Gated on JB's decision above.

- `POST /api/classes/{id}/groups/{code}/erase` — teacher-owned, typed confirmation, calls `erase_group`, returns per-store counts.
- Today's delete button becomes **Tilbagekald** (revoke) and says what it does: the code stops working, the work is kept.
- **Erase** sits behind a confirm that names what will be destroyed and is irreversible.
- Both audit-logged with the acting uid.

Whether Erase should also drop BigQuery research turns is JB's call and is
recorded, not assumed.

### M3 — close the carry-over hazard directly

Erasure is the intended remedy, but a code can be revoked (not erased) and later
re-minted, and the uid still collides. Two options, to decide in build:

- **(a) Refuse re-mint of a previously-used code string** unless it was erased. Cheap, and makes the hazard structurally impossible.
- **(b) Salt the uid per mint generation** — breaks the "same code resumes the same conversation" property that ADR-001 depends on. Almost certainly wrong; recorded so the choice is visible.

Recommendation is (a).

### M4 — make the reset scripts tell the truth

- `reset_teaching_data.py`: `"documents"` → `parsed_documents`, add `writing_progress`. It is deleting a collection that does not exist.
- `reset-group-state.sh`: route its group wipe through `erase_group` so it cannot drift from the registry again.
- Both should report per-store counts, so "wiped" is evidenced rather than assumed.

### M5 — privacy notice

State, for documents and recordings: what is stored, where (EU `europe-north1`),
for how long, who can delete it, and how. Remove the "Udkast" framing for the
sections that are now settled. Flag the overdue DPIA to JB — that is a project
action, not a code change.

## Testing Strategy

**Backend (pytest)**
- `erase_group` leaves zero rows in every registered store and zero objects under the group's GCS prefix.
- Registry-coverage test: every group-keyed collection the backend writes is registered.
- A re-minted code (post-erase) sees an empty document list — the carry-over regression, written from the uid-collision path specifically.
- Erasure is idempotent, and a mid-way failure reports which stores succeeded rather than claiming success.
- Revoke does **not** erase; Erase does. Both audit-log.
- ACL: only the owning teacher may erase; an anonymous-group student may not erase anything.

**Deployed smoke**
- Upload as a group, erase the group, assert the object is gone from GCS. `scripts/smoke-deployed.sh` already mints a real group token for the 1.1.79 upload check; this extends it.

## Migration

- **Do it before the backlog exists.** Four documents on prod today, three of them orphaned `failed` rows with no bytes — those can simply be deleted as part of M1.
- **No schema change.** Erasure reads existing keys.
- **Rollback:** the registry and erasers are additive; the UI rename is cosmetic and revertable. Erasure itself is *not* reversible — hence the typed confirmation and the audit line.

## Success Criteria

- [ ] `erase_group` removes every trace across all registered stores, GCS included, and returns per-store counts.
- [ ] The registry-coverage test fails when a new group-keyed store is added without an eraser (verify by adding one).
- [ ] A code re-minted after erasure starts empty — asserted through the real uid-collision path.
- [ ] Revoke and Erase are distinct, differently labelled, and audit-logged.
- [ ] `reset_teaching_data.py` names `parsed_documents`; both reset scripts route through the registry.
- [ ] The privacy notice states document and recording retention and the deletion route.
- [ ] The three orphaned 2026-08-21 rows are cleaned up.

## Open Questions

1. **Does Erase include BigQuery research turns?** GDPR Art. 17 points one way, the study protocol the other. **JB decides**; M2 records the answer rather than assuming it.
2. **What is the actual retention period for documents?** Nothing is written down for any store except the BigQuery partition TTL. "Until the study ends" needs a date, and the DPIA needs it anyway.
3. **Should teachers be able to erase their own uploads in bulk?** Today's owner-only ACL means teacher documents have exactly the same gap as student ones, and the same non-answer.

5. **Document VISIBILITY, as distinct from erasure.** M's 17 Aug notes:
   *"researchers dockuments shudl be private"*. `parsed_documents` has no
   visibility model at all — only `userId`, checked for exact equality on read
   and delete. There is no "private / shared with my class / shared with the
   programme" axis, so a researcher's working documents sit in the same
   undifferentiated store as a student's homework photo, distinguished only by
   who uploaded them.

   Folded into this doc rather than given its own because it is the same store
   and the same missing model: erasure asks *who may destroy this*, visibility
   asks *who may see it*, and both currently answer "whoever owns the uid".
   Deciding them together avoids bolting a second ACL onto the first. It is
   **not** in this doc's milestones — it needs its own scoping once the erasure
   shape is settled, and it should be checked against the curriculum library's
   existing sharing model (which DOES have researcher-gated visibility) rather
   than inventing a third one.
4. **Is the standalone recordings-erasure endpoint reachable from any UI?** It exists and nothing in the backend calls it; if no teacher surface exposes it, audio erasure is currently a curl-only operation.

## Related Documents

- [1.1.79 pilot-session-2026-08-21-followups.md](pilot-session-2026-08-21-followups.md) — shipped the upload path this doc governs the lifecycle of
- [handover-maintainability-audit.md](handover-maintainability-audit.md) — P1 "drive every footgun row to enforced", which the registry gate follows
- ADR-001 (anonymous group IDs) in the scoping site — the deterministic-uid decision M3 must not break
