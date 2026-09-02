# Researcher role — new permission tier above teacher

**Status:** ✅ **SHIPPED** — the `role:researcher` custom claim, `analytics.auth.assert_can_read_class` cross-class read bypass (span-tagged `auth.researcher_bypass`), `useIsResearcher` + the header badge.
**Last Updated:** 2026-06-13

> ## Implementation reconciliation (2026-06-13) — grounded against current code
>
> The design below is accurate in intent; these are the corrected file
> locations / mechanisms after reading the shipped code (the original guesses
> in §Files predate later sprints):
>
> - **Claim surfacing** lives in [`backend/auth/firebase_auth.py`](../../../../backend/auth/firebase_auth.py): add `is_researcher: bool` to the frozen `User` model and read `decoded.get("role") == "researcher"` in `_user_from_decoded_token`. (There is no separate `firebase_token.py`.) LOCAL_MODE stub (`backend/auth/local_mode_stub.py`) gains an env-gated researcher flag for dev.
> - **`assert_can_read_class`** belongs alongside the existing `assert_caller_owns` in [`backend/analytics/auth.py`](../../../../backend/analytics/auth.py) — NOT `backend/auth/permissions.py` (that file is tool-class permissions, unrelated). It admits researchers and tags the OTel span `auth.researcher_bypass=true`.
> - **`grant-researcher` / `revoke-researcher`** are **admin endpoints** on the existing SA-allowlisted [`backend/admin/routes.py`](../../../../backend/admin/routes.py) (gated by `_assert_caller_is_service_account` + `ADMIN_SEED_ALLOWED_SAS`), calling `firebase_admin.auth.set_custom_user_claims` with a **merge** of existing claims. The CLI `aiplatform users grant-researcher` wraps these over the existing SA-token path — the CLI does not call firebase-admin directly.
> - **Class read routes** are in [`backend/protocols/classes_routes.py`](../../../../backend/protocols/classes_routes.py); `list_classes` gains a `scope=all` param (researcher-only), read paths swap `_load_owned` → a researcher-admitting `_load_readable`. Write/mint/delete stay owner-only. Needs a new `list_all_classes()` in `backend/db/classes.py`.
> - **Frontend** teacher surface uses `useTeacherAuth` (not the app `AuthContext`); add a `useIsResearcher()` reading `getIdTokenResult().claims.role` and a Research-view toggle that threads `?scope=all` into the class-list fetch.
>
> Sprint plan: [implemented/researcher-role-sprint.md](implemented/researcher-role-sprint.md).
**Priority:** P1 — JB, AR, M need cross-class, cross-teacher access to all sessions and raw BigQuery. Currently any teacher view filters on class ownership; researcher view bypasses that filter
**Estimated:** ~1d
**Scope:** Firebase Auth (custom claim); backend endpoint guards; CLI flag; teacher UI "Research view" toggle
**Dependencies:** [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A shipped)
**Source brief:** [`june-03-feedback-sprint-brief.md` §5](../_scoping-snapshot/prototypes/june-03-feedback-sprint-brief.md)

## Problem

The shipped permission model has two tiers:
- **Anonymous group** — `AccessControl.type: tagged`, scoped to class-tag namespace
- **Teacher** — Firebase auth + `is_teacher` flag, sees only their own classes

Researchers (JB, AR, M) need to see **everything across the deployment**: all classes, all teachers, all sessions, raw BigQuery. Today, JB has to either be added as a teacher to each class (artificial; loses the "this is mine" semantics for actual teachers) or query BigQuery directly via console (no UI affordance, no audit trail in the platform). Neither scales beyond the current 2-teacher state to the pilot's 10 teachers.

The right shape is a **third tier** that explicitly bypasses class-ownership checks, set per-identity by a platform admin (M in v1; UCPH IT in year-2 if it migrates).

## Design

### The claim

Firebase Auth custom claim:

```json
{ "role": "researcher" }
```

Set manually by an admin via the existing Firebase Admin SDK / `aiplatform users grant-researcher <uid>` CLI (small new CLI command). One claim, present-or-absent — no role hierarchies, no per-class researcher (deferred to year-2 if institutions need it).

> **Deployment prerequisite (2026-07-14).** `grant-researcher` calls
> `firebase_admin.auth.set_custom_user_claims`, which needs the backend
> Cloud Run SA to hold **`roles/firebaseauth.admin`** — `roles/firebaseauth.viewer`
> (read-only) is NOT enough and the endpoint returns **500
> `InsufficientPermissionError`**. This was missing from the dev SA on first real
> use (the feature's tests mock firebase-admin, so the gap went unnoticed until a
> live grant was attempted). Fixed in `scripts/bootstrap-aipla-dev.sh` (SA role
> list); apply on an existing env with:
> `gcloud projects add-iam-policy-binding <project> --member="serviceAccount:aipla-v6@<project>.iam.gserviceaccount.com" --role="roles/firebaseauth.admin" --condition=None`.
> test/prod SA role bindings must carry the same role.

Researchers are still authenticated as themselves with Firebase Auth (Google OAuth provider per [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md)) — they're not anonymous, not pseudonymous. The claim *layers on top of* their teacher identity. A researcher can also own classes (M might create a test class for development); the claim just means "you can see other people's stuff too".

### Backend changes

Every endpoint that currently does:

```python
if not user_owns_class(user, class_id):
    raise HTTPException(403)
```

becomes:

```python
if not (user.has_researcher_claim or user_owns_class(user, class_id)):
    raise HTTPException(403)
```

A single helper `assert_can_read_class(user, class_id)` should encapsulate this so future endpoints don't reinvent. Likely lives in [backend/auth/permissions.py](../../../../backend/auth/permissions.py).

**Endpoints that gain researcher bypass:**

| Endpoint | Current check | Researcher bypass |
|---|---|---|
| `GET /api/classes` | Filter to `owner_uid == user.uid` | Bypass filter; return all classes |
| `GET /api/classes/{id}` | `assert_owner` | `assert_can_read_class` |
| `GET /api/classes/{id}/sessions` | `assert_owner` | `assert_can_read_class` |
| `GET /api/sessions/{id}` | Owner check via group→class→teacher chain | Bypass chain on researcher claim |
| `GET /api/sessions/{id}/transcript.csv` ([1.1.4](session-report-summary-primary.md)) | Owner check | Bypass on researcher claim |
| Analytics-chat skill tool calls (`assert_caller_owns` in [analytics-chat-tools.md](../v1.0.0-pilot/implemented/analytics-chat-tools.md)) | Per-tool owner assertion | `assert_caller_can_read_session` helper that admits researchers |
| `aiplatform logs` CLI endpoint(s) | Class filter on caller | `--all-classes` flag honoured if researcher claim present |

### CLI: `aiplatform logs --all-classes`

The `aiplatform logs` CLI currently scopes BigQuery queries to the caller's owned classes. New flag:

```
aiplatform logs --all-classes [other flags]
```

- If caller has `role:researcher` claim → flag is honoured; query runs without class filter
- If caller does NOT have the claim → flag is rejected with `403 — researcher claim required`
- Without the flag, behaviour is unchanged (own-classes scope)

Also: `aiplatform users grant-researcher <uid>` and `aiplatform users revoke-researcher <uid>` — admin commands callable only by the platform-admin Firebase user (a single hardcoded uid in env, or by membership in a Firestore `admins` collection — pick the simpler).

### Teacher UI: "Research view" toggle

For users with the claim, the teacher UI surfaces a toggle in the top nav:

```
┌────────────────────────────────────────────────────────┐
│  AIPLA Teacher    [ My classes ] [ Research view ]    │
│  ◀──────── currently in My classes mode ──────────▶   │
└────────────────────────────────────────────────────────┘
```

- `My classes` (default): same as today; only teacher's own classes
- `Research view`: shows all classes across all teachers; teacher-name column visible; per-class detail and per-session detail still reachable with the same drill-down UX

Implementation: a single `?view=research` URL param on the existing teacher routes, threaded through the existing class-list query. Backend interprets the param + the caller's claim: only researchers can use it; non-researchers get a 403 if they try to bypass via URL hacking.

### Audit logging

Every researcher read of cross-class data emits an OTel span with attribute `auth.researcher_bypass=true`. Lets us answer "who looked at what" if a question comes up. Lives alongside the existing OTel instrumentation; no new infrastructure.

## Acceptance

- [ ] Firebase custom claim `role=researcher` can be set via `aiplatform users grant-researcher <uid>` and revoked via `revoke-researcher`
- [ ] A researcher's `GET /api/classes` returns all classes across all teachers; a non-researcher's returns only own classes
- [ ] A researcher can `GET /api/sessions/{id}` for a session in a class they don't own; a non-researcher gets 403 (unchanged)
- [ ] `aiplatform logs --all-classes` works for researcher; rejected with 403 for non-researcher
- [ ] Teacher UI shows "Research view" toggle only for users with the claim
- [ ] Switching to "Research view" lists all classes with teacher-name column visible
- [ ] OTel span `auth.researcher_bypass=true` recorded on every cross-class read
- [ ] Non-researcher attempting `?view=research` URL-hack gets 403, not a silent fallback
- [ ] `make lint` + `make test-fast` + `npm run quality:check` green
- [ ] One pytest: researcher claim grants access; absence denies
- [ ] One pytest: `--all-classes` CLI flag respects the claim

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Researcher claim accidentally granted to wrong user | Low | CLI is admin-only; PR review on first grants; audit OTel spans for any unexpected bypasses |
| `assert_can_read_class` helper not used uniformly → some endpoints leak; some block | Medium | Code review on every owner-check call site; pytest matrix covering each researcher-bypass-eligible endpoint |
| Researcher view shows so much data the UI is unusable | Medium | Class list paginates / search bar; per-class drill-down stays the primary affordance |
| Consent-declined sessions visible to researcher but transcripts return 410 | By design | Researcher sees the *fact* of the session and metadata; conversation content is suppressed per [student-consent-prompt.md](student-consent-prompt.md) — this is the correct posture |
| Researcher claim conflated with admin claim | Low | Keep them separate: researcher = read; admin = grant/revoke + ops. Don't grant admin powers based on the researcher claim |

## Open questions

1. **Where does the admin uid list live?** Env var (`AIPLA_PLATFORM_ADMIN_UIDS=uid1,uid2`) is simplest for v1.1. Move to a Firestore `admins` collection in year-2 if multiple admins need to manage each other.
2. **Per-deployment researcher claims?** A researcher granted on `aipla-dev-2026` is not automatically a researcher on `aipla-prod-2026`. Manual grant per project; document this in the runbook so it doesn't surprise anyone after prod cutover.
3. **Should researcher access also bypass the per-skill access-control tags?** Brief implies yes (researcher sees everything). Default to yes; if a skill ever needs to be researcher-blind (highly unlikely in v1.1), revisit.
4. **Audit-log surfacing** — for now OTel span only. If JB / UCPH compliance needs a queryable audit table, add a BQ table `researcher_access_log` writing one row per cross-class read. Defer unless asked.

## Files

| File | Purpose | LOC est. |
|---|---|---|
| [backend/auth/permissions.py](../../../../backend/auth/permissions.py) | New `has_researcher_claim`, `assert_can_read_class`, `assert_can_read_session` helpers | +60 |
| [backend/auth/firebase_token.py](../../../../backend/auth/firebase_token.py) (or equivalent) | Surface `role` claim on the decoded user object | +10 |
| `backend/protocols/classes_routes.py` / `session_routes.py` | Swap `assert_owner` → `assert_can_read_class` | per-route, small |
| `backend/protocols/analytics_routes.py` | Same swap | small |
| `cli/aiplatform/users.py` (new) | `grant-researcher` / `revoke-researcher` admin commands | ~80 |
| `cli/aiplatform/logs.py` | Add `--all-classes` flag + claim check | +30 |
| `frontend/src/components/teacher/ResearchViewToggle.tsx` | New | ~50 |
| `frontend/src/app/teacher/layout.tsx` (or wherever nav lives) | Conditional render of toggle on `user.role === "researcher"` | +20 |
| `frontend/src/lib/auth.ts` | Expose `useIsResearcher()` hook from the existing auth context | +10 |
| `backend/tests/api_tests/test_researcher_role.py` | New | ~150 |

## Out of scope

- Per-class researcher (researcher scoped to specific classes only) — year-2
- Researcher edit / write privileges (e.g. modifying a teacher's class) — not asked for; admin-uid path covers anything ops needs
- UCPH SSO-based researcher provisioning — year-2 once UCPH SSO lands per [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md)
- Researcher group hierarchy (lead researcher / assistant researcher) — overkill for the 3-person pilot research team

## Related

- [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) — base on which this layers
- [student-consent-prompt.md](student-consent-prompt.md) — researcher access still respects consent (sees metadata, not transcript content, for declined sessions)
- [analytics-chat-tools.md](../v1.0.0-pilot/implemented/analytics-chat-tools.md) — per-tool `assert_caller_owns` now must admit researchers
- ADR-001 (anonymous group auth) — unchanged
- ADR-014 (access control 5-type model) — researcher tier doesn't change the model; it's a bypass at the *check* layer, not a new `AccessControl.type`
