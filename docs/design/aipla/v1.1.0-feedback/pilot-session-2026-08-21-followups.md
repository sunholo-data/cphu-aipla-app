# Pilot-session follow-ups — 2026-08-21

**Status**: ✅ **SHIPPED to all three environments** — the four silent defects fixed (`fix(pilot): … (1.1.79)`), confirmed by `docs(1.1.79): shipped to all three environments, and what stays open`.
**Priority**: P0
**Estimated**: ~2d
**Scope**: Backend + infrastructure (one frontend-parity test)
**Dependencies**: None — every item is independently shippable
**Created**: 2026-08-25
**Last Updated**: 2026-08-25

## Problem Statement

The first real teacher pilot session on prod ran Friday **2026-08-21, 13:00–14:45 CEST**
on `aipla.ku.dk` (revision `aipla-v01-frontend-00026-2tg`, cut 2026-08-18). JB and
Aswin ran it; M was away.

**It substantially worked.** 334 chat turns across 35 sessions and 22 groups, 12
teacher accounts, 10 active student groups, **30/30 group joins with zero failures**,
and a matching tutor turn for every student turn — no dropped responses.

Underneath that, four defects fired. **None of them produced a message that told
anyone what was wrong.** Every one degraded to silence, so the room had no way to
distinguish "broken" from "slow" or "I used it wrong". That is the common thread,
and it matters more than any individual fix.

### The four defects

| | Defect | Occurrences | Who saw what |
|---|---|---|---|
| **A** | Document upload returns 500 | 23 uploads, 100% failure | Upload appears to do nothing |
| **B** | Writing element's state never reaches the tutor | 12 × 403 | Student writes; tutor never refers to it |
| **C** | Checklist anti-fabrication guard crashes on every call | 14 | Guard silently absent; tutor free to mark empty work done |
| **D** | Gemini quota exhaustion | 3 bursts | Turn fails mid-conversation |

#### A. Document upload is dead on prod — for everyone, and for two independent reasons

23 upload attempts between 11:23 and 12:40 UTC from at least five participants,
every one a 500. Several came from an activity named **"Dokumentfeedback"** — a
session built around uploading documents for feedback.

**A1 — empty Firestore document id (19 of 23).**
[`resolve_documents_bucket`](../../../../backend/db/clients.py#L37) computes
`domain = user.domain or …`, which is `""` for every anonymous-group student
(ADR-001), then hands it to `get_document("clients", "")`. Firestore rejects the
path `…/documents/clients/` with `InvalidArgument: 400 Document name`. Nothing
catches it, so it surfaces as a 500.

This exact bug, in this exact shape, **was already found and fixed on 2026-05-20**
in [`permissions.py`](../../../../backend/auth/permissions.py#L102-L109), which
carries a nine-line comment explaining the trailing-slash `InvalidArgument` and
guards with `if user_email:`. The knowledge was written down inside the codebase
and still did not reach the next Firestore key site.

**A2 — there is no documents bucket on any environment.** `DOCUMENTS_BUCKET` is
set in **no** `cloudbuild.yaml`, no `cloudbuild.promote.yaml`, and no Terraform
var-file. `resolve_documents_bucket` therefore always returns its hardcoded
fallback `"aitana-documents-bucket"` — a bucket belonging to the **upstream Aitana
project**, not `aipla-prod-2026`, whose bucket list contains no documents bucket
at all. Prod's runtime SA has no access to it.

So A1 and A2 are not one bug with one fix. **Fixing A1 alone converts a Firestore
500 into a GCS permission failure**, and upload stays broken. The four teacher-side
500s that produced *no* backend traceback are consistent with failing past the
Firestore step, but the cause is **unconfirmed** — see Open Questions.

#### B. The writing element's state never reached the tutor

[`_WORKSPACE_ELEMENT_SERVERS`](../../../../backend/protocols/iframe_context_routes.py#L105)
is `frozenset({"progress", "table", "calculator", "chart"})`. `WorkbenchWriting`
pushes `serverId: "writing"`, which is in neither that allowlist nor the artefact
catalogue, so every push 403s with `server not in skill activation`.

`WorkbenchWriting.test.tsx` asserts the frontend sends `"writing"` and passes.
The backend allowlist has its own test that parametrises over the four names it
already knows. **Both sides are green; the feature is broken between them.** This
is the [activity-elements-palette](activity-elements-palette.md) two-surface
footgun again — same element, second time (the first was the auth dispatcher).

#### C. The checklist anti-fabrication guard never ran once

[`checklist_tools.py:158`](../../../../backend/adk/checklist_tools.py#L158) calls
`dict(tool_context.state or {})`. ADK's `State` implements `__getitem__`,
`__setitem__`, `__contains__`, `get`, `update`, `setdefault` and `to_dict` — but
**no `keys()` and no `__iter__`**. `dict()` therefore falls back to the sequence
protocol, asks for `state[0]`, and raises `KeyError: 0`.

The call is wrapped in `except Exception` with `empty = None`, so **marking kept
working** — this cost nobody a mark. What it cost is the guard itself: the check
that stops the tutor marking a step done when the element behind it is empty
fell through to "allow" on all 14 invocations.

The test suite cannot see this. `_Ctx.state` in
[`test_checklist_tools.py:351`](../../../../backend/tests/unit/test_checklist_tools.py#L351)
is a **plain dict**, and `dict(plain_dict)` is fine. The test at line 362 is
labelled *"Aswin's exact case"* — it is green in CI and was not working at the
session Aswin was running.

#### D. Gemini quota exhaustion

Three `429 RESOURCE_EXHAUSTED` bursts (11:55, 12:26, 12:45 UTC) surfacing as
`_ResourceExhaustedError` out of `google_llm.generate_content_async`. Student
turns failed at those moments. At 22 groups this is not a load the platform
should be unable to absorb, and the pilot scales up from here.

### Explicitly not in scope

**Teachers signing in on unregistered addresses.** Four accounts on the day were
not on the register and were correctly downgraded to `tier=visitor`; because of
`40147f4` their students were refused too, and two groups recorded zero turns.
This is **working as designed** — Gmail and other unregistered addresses are meant
not to carry spend authority — and the replacement sign-in route is its own
workstream (teachers' trust in Google being the driver). The pre-emptive grants
in [pilot-session-2026-08-21-prep.md](../../../ops/pilot-session-2026-08-21-prep.md)
worked exactly as intended for all three teachers they anticipated. No action here.

### The pattern

Three of the four are the same failure: **a second registration site that nothing
forces you to update.**

- A1 — a guard exists in `permissions.py`; nothing propagates it to the next site.
- A2 — a config key the code reads that no environment sets.
- B — an element registered on the frontend and separately on the backend.
- C — a real type whose test double is a more permissive one.

Per the [handover audit](handover-maintainability-audit.md) P1 goal, each fix below
therefore ships **with the gate that keeps it fixed**. A fix without a gate is how
A1 came back three months after it was solved and documented.

## Goals

**Primary Goal:** Close all four defects, and for each, add the machine check that
would have caught it before the session — so the next pilot session fails loudly or
not at all.

**Success Metrics:**
- Document upload succeeds on prod for both an anonymous-group student and a teacher (0/23 → working).
- Writing-element pushes return 204, and the tutor demonstrably refers to written text.
- The empty-element guard refuses a mark in a real ADK-`State` test (currently unreachable).
- Zero `KeyError: 0` and zero `InvalidArgument: 400 Document name` in prod logs over a session.
- A new workspace element cannot reach `dev` registered on only one side.

**Non-Goals:**
- The teacher sign-in / access-register route (separate workstream, see above).
- Reworking the artefact-vs-element authorization model. B is a missing entry, not a wrong design.
- Offline upload queueing.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | No latency change. |
| 2 | EARNED TRUST | **+1** | C restores the guard that stops the tutor asserting work is done when it is empty — the axiom's central case. B lets the tutor see what the student actually wrote instead of responding around it. |
| 3 | SKILLS, NOT FEATURES | 0 | No change to the skill abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | D is quota/backoff, not routing. |
| 5 | GRACEFUL DEGRADATION | **+1** | Four silent failures become either working paths or visible ones; D adds backoff plus an honest message instead of a dead turn. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Uses the existing iframe-context wire and ADK `State.to_dict()`; invents nothing. |
| 7 | API FIRST | 0 | No new endpoints. |
| 8 | OBSERVABLE BY DEFAULT | **+1** | A silently-swallowed guard failure becomes a distinguishable, alertable signal; blank Firestore ids fail loudly at the call site rather than as an opaque gRPC 400. |
| 9 | SECURE BY CONSTRUCTION | **+1** | B is resolved by adding one vetted element to the allowlist, preserving deny-by-default; the parity gate makes the allowlist provably complete rather than assumed complete. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | No client/protocol shift. |
| | **Net Score** | **+4** | Threshold: >= +4 |

**Conflict Justifications:** None — no axiom scores -1.

## Design

### A1 — guard the empty domain, and make blank ids loud

In `resolve_documents_bucket`, skip the lookup when `domain` is empty and fall
straight to the configured bucket. This is the documented intent already
("Falls back to the DOCUMENTS_BUCKET env var for unmapped domains") and mirrors
the `if user_email:` shape in `permissions.py`.

The gate is the second half. `db/firestore.py` helpers (`get_document`,
`set_document`, `update_document`, `delete_document`) **raise `ValueError` on a
blank `collection` or `doc_id`.** A blank id is never a legitimate Firestore call;
today it becomes an opaque `InvalidArgument` from inside gRPC that reads like a
service fault. Raising at the call site names the caller and turns the whole class
of bug into a test-time failure.

> Deliberately `ValueError`, not a `None` return. Returning `None` would fold
> "you passed garbage" into "no such document" — the exact conflation the
> [`deploy-status` footgun](../../../../CLAUDE.md) row warns against.

There are 75 `get_document` call sites; the migration step below covers the sweep.

### A2 — give each environment a real documents bucket

1. A `<project>-documents` bucket per environment, in `infrastructure/env/`
   alongside the existing artifacts/tts-cache buckets, with the runtime SA granted
   `roles/storage.objectAdmin` on it.
2. `DOCUMENTS_BUCKET` set in `cloudbuild.yaml` **and** `cloudbuild.promote.yaml`.
   Per the documented footgun, a per-env value added only to the deploy path never
   reaches prod, because prod is reached only by promote. The promote guard that
   asserts the value is non-empty extends to cover it.
3. The hardcoded `"aitana-documents-bucket"` default is **removed**. An upstream
   bucket name silently reachable as a default is how A2 stayed invisible; absent
   config should fail at startup, not resolve to another project's bucket.

### B — register `writing`, then make registration provable

Add `"writing"` to `_WORKSPACE_ELEMENT_SERVERS`.

The gate: a test that reads the element server ids the **frontend** actually pushes
and asserts the backend allowlist covers every one. The frontend already states
each id in a form a test can consume (`useSimSnapshotPush(sessionId, "<id>")`),
so the parity check is mechanical — a committed manifest both sides assert against,
extending `scripts/audit-trust-cards.sh`, which already walks these components for
the sibling footgun. A new element then cannot ship registered on one side only.

### C — `to_dict()`, and a test double that can fail

Replace `dict(tool_context.state or {})` with `tool_context.state.to_dict()`,
handling a `None` context as today.

The gate is the test double. `_Ctx` becomes backed by a real
`google.adk.sessions.state.State`, so the suite exercises the type production
uses. Every existing assertion should still pass — if any does not, it was
passing on the permissiveness of a plain dict.

Additionally, the `except Exception` keeps failing open (correct — a check must
never block a mark) but logs at `error` with a distinguishable message, so a
recurrence is greppable rather than inferred from a stack trace.

### D — absorb quota bursts

1. Confirm the actual limit and headroom for the prod Gemini/Vertex quota and
   raise it for the pilot's expected concurrency.
2. Bounded retry with jittered backoff on `_ResourceExhaustedError` — a 429 is
   transient, and today it terminates the turn on first contact.
3. If retries are exhausted, the student sees an honest Danish "try again in a
   moment" rather than a stalled stream.

Sequenced after A–C: those are deterministic and independently verifiable, this
one needs a quota conversation.

### CLI Surface

No new commands. `make smoke-deployed` gains an upload round-trip so A is covered
by the existing post-deploy gate rather than a new tool.

## Testing Strategy

**Backend (pytest)**
- `resolve_documents_bucket` with `domain=""` and `email=""` returns the configured bucket and performs **no** Firestore call.
- `get_document`/`set_document`/`update_document`/`delete_document` raise `ValueError` on blank collection or id.
- `mark_checklist_item` refuses a mark on an empty table when `tool_context.state` is a **real ADK `State`** — the assertion that is currently unreachable.
- The whole existing checklist suite passes against the real-`State` double.
- iframe-context accepts `serverId: "writing"` (extends the existing parametrised case).
- Allowlist-parity test: every frontend element server id is present in `_WORKSPACE_ELEMENT_SERVERS`.

**Frontend (Vitest)**
- `WorkbenchWriting` keeps asserting the pushed `serverId`, now cross-checked by the parity manifest.

**Deployed smoke**
- Upload a small file as an anonymous-group student and as a teacher on dev, then test, then prod; assert 200 and a readable object.

## Migration

- **A1/A2 are a single change window.** Shipping the `ValueError` guard without the bucket leaves upload broken with a different error; shipping the bucket without the guard leaves students 500ing. Land together, verify on dev, promote as one version.
- **Blank-id sweep.** Adding `ValueError` may surface other latent blank-id callers among the 75 sites. Run the full backend suite plus a dev soak before promoting; the intent is to find them, and finding them in a test run is the point.
- **No data migration.** Nothing here changes a stored shape.
- **Rollback:** all four are small and independently revertable; the bucket is additive and safe to leave in place.

### Infrastructure before application — the ordering that is not automatic

**No application pipeline runs Terraform.** `cloudbuild.yaml` and
`cloudbuild.promote.yaml` contain zero terraform steps, and the terraform
pipeline gates its own apply: absent `_CONFIRM=APPLY`,
[cloudbuild.terraform.yaml](../../../../infrastructure/env/cloudbuild.terraform.yaml)
prints `PLAN ONLY — no changes applied` and exits 0. Every push-triggered infra
build is a plan.

So a `v*` tag deploys an app that *reads* `DOCUMENTS_BUCKET` to an environment
that may have no bucket behind it. Apply the infrastructure first:

```bash
make tf-apply ENV=test GO=1                             # bucket exists first
git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z    # then the app
make tf-apply ENV=prod GO=1
make promote VERSION=vX.Y.Z FROM=test TO=prod GO=1
```

Read the plan at apply time rather than trusting a number from earlier — "2 to
add" was true on 2026-08-25 and says nothing about a later state.

**dev cannot use this path at all.** `make tf-apply` hard-refuses `ENV=dev`
(dev is script-provisioned; applying would adopt live script-created
resources), which is why the bucket also lives in
[`scripts/bootstrap-aipla-dev.sh`](../../../../scripts/bootstrap-aipla-dev.sh).
A Terraform-only change would have fixed test and prod and left dev quietly
broken — the environment where the fix gets exercised first.

### What actually happened (2026-08-25)

| Env | Bucket | App |
|---|---|---|
| dev | `bootstrap-aipla-dev.sh` | push to `dev` (`2111e22`) |
| test | `make tf-apply ENV=test GO=1` — 2 added, 0 destroyed | tag `v0.1.28` |
| prod | `make tf-apply ENV=prod GO=1` — 2 added, 0 destroyed | `make promote VERSION=v0.1.28` |

Verified on deployed dev with a real `aipla-demo-1` group token, not a mock:
student upload `200` with the object present in GCS, `writing` push `204` with
`iframe_context: write … server=writing` in the logs, and an unknown `serverId`
still `403` — deny-by-default intact.

## Success Criteria

- [ ] A student and a teacher can each upload a document on prod and see it in the workbench.
- [ ] Zero `InvalidArgument: 400 Document name` in prod logs over a full session.
- [ ] `DOCUMENTS_BUCKET` is set on dev, test and prod, and the promote guard asserts it non-empty.
- [ ] The hardcoded `aitana-documents-bucket` default no longer exists in the codebase.
- [ ] Writing-element pushes return 204 on prod; the tutor refers to written text in a live session.
- [ ] The parity test fails when an element is registered on only one side (verify by temporarily removing an entry).
- [ ] The empty-element guard refuses a mark under a real ADK `State`, and zero `KeyError: 0` appear in prod logs.
- [ ] A quota burst degrades to a retry and an honest message, not a dead turn.

## Open Questions

1. ~~**The four teacher-side upload 500s** produced no backend traceback — possibly the Next.js proxy, possibly a fifth defect.~~
   **ANSWERED 2026-08-25 — not a fifth defect, the same A2 root cause.** All four
   logged `GCS upload failed … 403 POST …/b/aitana-documents-bucket/o`:

   ```
   12:19:52  aflevering.pdf
   12:18:54  Instrument og lydanalyser.docx
   12:18:41  Instrument og lydanalyser.docx
   11:23:27  dokument_1_elevbesvarelse_test_1.docx
   ```

   A teacher HAS a real domain, so they passed the Firestore lookup that stopped
   students at A1 and reached the GCS write — where the hardcoded upstream bucket
   refused them. `upload.py` raises an explicit `HTTPException(500)` there, and an
   `HTTPException` carries no traceback, which is why the 500 looked sourceless.
   **So A2 fixes all 23 uploads, not 19**, and the proxy is not implicated (its
   own error path returns 502, not 500).

   Two method notes worth keeping. The `log.error` line WAS written, but Cloud Run
   left it at DEFAULT severity — the `ERROR:` is only text inside `textPayload` —
   so a `severity>=WARNING` filter misses it entirely. Search log TEXT, not
   severity, when a handled error is suspected. And "no traceback" is a signal in
   itself: it distinguishes a deliberate `HTTPException` from an unhandled crash.
2. **Should `writing` be an element or an artefact?** It is being treated as a workspace element here, consistent with table/calculator. If the writing surface is heading toward artefact-like behaviour, the allowlist entry is still correct but the parity gate should cover both catalogues.
3. ~~**What quota ceiling does the pilot actually need?**~~
   **PARTLY ANSWERED 2026-08-25 — the question has no engineering answer.** Vertex
   serves Gemini 2.x here under **Dynamic Shared Quota**: capacity is best-effort
   from a shared pool and there is no per-project requests-per-minute limit to
   raise, so a 429 is an expected operating condition rather than a
   misconfiguration. The only lever that guarantees capacity is **Provisioned
   Throughput**, which is a purchasing decision for M, not a config change. The
   client-side absorption (`adk/quota_retry.py`) ships regardless and is the
   right fix either way. **Open:** whether to buy Provisioned Throughput before
   the pilot scales past 22 groups.

4. **Backend error strings are English; the new quota message is Danish.**
   Decided 2026-08-25 to keep the split and record it rather than resolve it.
   `QUOTA_EXHAUSTED` is the only upstream error a **student** meets in normal
   running, so it is written for a Danish classroom; its neighbours
   (`VERTEX_AUTH_FAILED` tells you to re-run `gcloud auth application-default`)
   are developer-facing and stay English. The frontend's `classifyRunError`
   fallbacks are also English. A real message catalogue keyed by error code is
   the proper fix and would have to decide what those frontend fallbacks do —
   worth doing when a second student-facing error appears, not before.

## Related Documents

- [pilot-session-2026-08-21-prep.md](../../../ops/pilot-session-2026-08-21-prep.md) — the prep doc for this session; its access-address mitigation worked
- [activity-elements-palette.md](activity-elements-palette.md) — the two-surface element recipe defect B belongs to
- [handover-maintainability-audit.md](handover-maintainability-audit.md) — P1 "drive every footgun row to enforced", which this doc follows
- [delegated-programme-administration.md](delegated-programme-administration.md) — the bounded-admin claim, relevant to the separate sign-in workstream
- `.claude/skills/workbench-element-builder` — the skill that should learn the allowlist step once B's gate exists
