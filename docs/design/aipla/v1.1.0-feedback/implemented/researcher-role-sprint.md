# Sprint plan — 1.1.5 researcher-role

**Design doc:** [../researcher-role.md](../researcher-role.md)
**Created:** 2026-06-13
**Estimate:** ~1–1.5d
**Branch/policy:** commit straight to `dev` (AIPLA workflow), TDD, `make lint` + `make test-fast` + `npm run quality:check` green per milestone.

## Goal

A `role:researcher` Firebase custom claim that layers on top of teacher identity and grants cross-class read access — the foundation the cost-dashboard (1.1.9) researcher/cohort views and the session-report (1.1.4) CSV auth both build on.

## Milestones

### M1 — Backend claim plumbing
- `User.is_researcher: bool = False` on the frozen model in `backend/auth/firebase_auth.py`.
- `_user_from_decoded_token`: `is_researcher = (decoded.get("role") == "researcher")`. Researcher is still `is_teacher=True`.
- LOCAL_MODE stub: env-gated `LOCAL_MODE_RESEARCHER=1` → workshop user is a researcher (dev affordance).
- **Tests:** decoded token with/without `role=researcher`; LOCAL_MODE env flag.

### M2 — Admin grant/revoke endpoints
- `POST /api/admin/grant-researcher {uid}` and `POST /api/admin/revoke-researcher {uid}` in `backend/admin/routes.py`, SA-allowlist-gated.
- Use `fb_auth.get_user(uid).custom_claims` → merge `{"role": "researcher"}` (or drop the key) → `set_custom_user_claims`. Never clobber `groupTags`.
- **Tests:** grant merges + preserves existing claims; revoke removes only `role`; non-SA caller 403 (existing guard).

### M3 — `assert_can_read_class` helper + researcher bypass on class read routes
- `backend/db/classes.py`: `list_all_classes(include_revoked=False)` (collection scan, exclude revoked).
- `backend/analytics/auth.py`: `assert_can_read_class(user, class_id)` — owner OR researcher; on researcher-bypass tag OTel span `auth.researcher_bypass=true`. Keep enumeration-resistant 404 shape for non-owner non-researcher.
- `classes_routes.py`: `list_classes(scope: "own"|"all" = "own")` → `all` returns `list_all_classes()` for researchers, 403 for non-researchers; `_load_readable(class_id, user)` admits researchers for `GET /{id}` + `/recent-sessions`. Write/mint/delete unchanged (owner-only).
- **Tests:** researcher `scope=all` → all classes; non-researcher `scope=all` → 403; researcher reads other's class; non-researcher → 404; OTel bypass attr set.

### M4 — CLI: `users` group + `logs --all-classes`
- New `cli/aiplatform/commands/users.py`: `aiplatform users grant-researcher <uid>` / `revoke-researcher <uid>` → POST the admin endpoints. Register in `cli.py`.
- `aiplatform logs` already prints a researcher BQ query via `schema`; add `--all-classes` to the relevant read command path (honoured only if claim present — backend enforces via `scope=all`/researcher).
- **Tests:** mock-backend CLI tests for grant/revoke; `--all-classes` flag wiring.

> **Descope (2026-06-13):** `logs --all-classes` was NOT built. The current
> `aiplatform logs` reads per-group reports (`/api/reports/groups/{code}`),
> not a class-scoped BQ query there is anything to "widen", and per ADR-005
> researchers query BigQuery directly via the cross-class query that
> `aiplatform logs schema` already prints. Adding the flag would be cosmetic.
> The cross-class data path lands meaningfully in 1.1.9 (cost-dashboard
> researcher endpoints, which consume `assert_can_read_class`). `users
> grant-researcher`/`revoke-researcher` — the essential claim-management
> CLI — shipped.

### M5 — Frontend Research-view toggle
- `frontend/src/hooks/useIsResearcher.ts`: read `getIdTokenResult().claims.role === "researcher"`.
- `ResearchViewToggle` in the teacher nav (`frontend/src/components/teacher/...`), visible only to researchers; toggles a `?scope=all` (or `view=research`) param.
- Class-list page: when researcher + research view, fetch `scope=all`, show a teacher/owner column.
- **Tests:** vitest — toggle hidden for non-researcher; visible + switches scope for researcher.

## Acceptance (from design doc)
- Claim set/revoked via CLI; researcher `GET /api/classes?scope=all` returns all, non-researcher 403; researcher reads non-owned class, non-researcher 404; OTel `auth.researcher_bypass=true`; toggle only for researchers; URL-hack `scope=all` by non-researcher 403; `make lint` + `make test-fast` + `npm run quality:check` green.

## Out of scope (per design)
Per-class researcher, write privileges, UCPH SSO provisioning, researcher hierarchy. The `researcher_access_log` BQ table is deferred (OTel span only).
