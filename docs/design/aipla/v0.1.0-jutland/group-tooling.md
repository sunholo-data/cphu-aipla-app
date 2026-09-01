# Group-code tooling — `aiplatform group` CLI

**Status**: Planned
**Priority**: P1 (Medium) — unblocks ops; not a Jutland-demo gate
**Estimated**: ~0.5 day (~150 LOC CLI + ~80 LOC tests + 1 admin endpoint extension)
**Scope**: Backend (one new admin endpoint) + CLI
**Dependencies**: [jutland-demo.md](jutland-demo.md) ships (✓); `/api/admin/mint-demo-group` endpoint exists (✓ landed 2026-05-20)
**Created**: 2026-05-20
**Last Updated**: 2026-05-20

## Problem Statement

Minting an anonymous-group join code currently requires a four-step ritual that wasn't designed for repeated use:

```bash
# 1. Look up the skill ID (no command for this — manually grep marketplace)
SKILL_ID=$(curl -sS $URL/api/proxy/api/skills/marketplace | python3 -c "...")

# 2. Mint identity token via gcloud + impersonate (for deployed) OR
#    remember 'local-mode-stub-token' (for local) — different per env
TOKEN=$(gcloud auth print-identity-token --impersonate-sa=... --audiences=$URL --include-email)

# 3. POST the right JSON body (group_id vs code vs name — easy to get wrong)
curl -X POST $URL/api/auth/group/create -H "Auth: Bearer $TOKEN" \
    -d "{\"title\":\"...\",\"skill_ids\":[\"$SKILL_ID\"],\"ttl_days\":30,\"max_concurrent_sessions\":100}"

# 4. Parse the response, extract the group_id, hand to the teacher
```

This worked four times today (2026-05-20) for the Jutland demo prep. Mark caught it explicitly: *"err yeah this needs to be a lot easier"*.

**Current State:**
- No CLI command — every mint is a custom curl invocation.
- No "list active codes" surface — you either browse Firestore in the GCP Console or write another curl.
- No "revoke a code" surface — the backend `delete_group()` function exists but has no route.
- Token-auth shape differs between local (`local-mode-stub-token` literal) and deployed (SA-impersonated identity token with `--include-email`) — easy to use the wrong one.
- The skill-ID lookup is a separate manual step — no `--skill-name problem-set-hints` shorthand.
- No expiry-warning anywhere — if a Jutland-week code expires silently mid-demo, JB has no signal.

**Impact:**
- **Who:** Mark + JB (operationally), eventually AR + teachers (when v1 ships teacher SSO + a teacher-side UI).
- **How significant:** P1 — not blocking the v0.1 Jutland demo (we have 3 codes minted that survive 30 days), but every future demo / pilot setup is going to need this. Without tooling, every demo is a fresh "remember the right curl invocation" hurdle.

## Goals

**Primary Goal:** A single `aiplatform group new --skill problem-set-hints --title jutland-demo` command that mints a code, prints it large and centred, and returns 0. Same command shape works for both LOCAL_MODE backends and deployed Cloud Run, with auth resolved automatically per `--env`.

**Success Metrics:**
- Time-to-mint a code drops from ~2 minutes (multi-step curl ritual) to <5 seconds (one command).
- Zero ambiguity about which token format to use (auth resolved by `--env`).
- `aiplatform group list --env dev` shows all live codes with expiry + skill name + creator + usage.
- Mark can mint a code from JB's laptop without re-deriving the curl shape — JB just runs the install + one command.

**Non-Goals:**
- **No teacher-facing GUI.** Teachers will get UCPH SSO + an A2UI dashboard in v1.6 + 1.7 (see [SEQUENCE.md](SEQUENCE.md) Phase 1.6 `teacher-auth-ucph-sso.md` + 1.7 `class-and-group-management.md`). This doc is ops-tooling only; the v1 teacher path is a separate design.
- **No automation of demo setup beyond minting.** Demos still require running `make dev` / pushing to dev / etc. — this doc is just the group-code surface.
- **No multi-skill groups.** Current `create_group` accepts `skill_ids: list[str]` but for v0.1 every code is for ONE skill. The CLI takes `--skill-name` (singular) for simplicity; the v1 teacher UI handles multi-skill.
- **No revoke-by-prefix or bulk revoke.** One code at a time. If you minted ten and want to wipe them, you can iterate — this isn't a v0.1 ops shape.
- **No code expiry alerting.** Codes live 30 days by default; a Friday morning "your demo code expires today" notification is post-v1.

## Axiom Alignment

Per [docs/product-axioms.md](../../../product-axioms.md):

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Replaces a ~120s curl ritual with a <5s command. Direct user-perceived latency improvement. |
| 2 | EARNED TRUST | +1 | The CLI prints exactly what was minted (code, expiry, skill, creator email) so ops can verify what they're handing to the demo audience — no silent state. |
| 3 | SKILLS, NOT FEATURES | 0 | Group-code tooling is ops infrastructure, not a skill. Doesn't touch the abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model routing in scope. |
| 5 | GRACEFUL DEGRADATION | +1 | Three explicit failure modes (auth mismatch, skill not found, backend unreachable) each surface a one-line actionable error instead of an opaque 4xx/5xx body. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses the existing `POST /api/auth/group/create` and `POST /api/admin/mint-demo-group` endpoints. Doesn't invent a new wire format. CLI is a thin client. |
| 7 | API FIRST | +1 | Every CLI command is a thin wrapper over an existing HTTP endpoint. Future GUIs (teacher dashboard, ops web page) use the same API. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Every group create/delete already logs to Cloud Logging via the backend; CLI adds a one-line audit trail on the user's terminal (date + caller + code) for local provenance. |
| 9 | SECURE BY CONSTRUCTION | +1 | Auth resolution is per-env: LOCAL_MODE → stub token (no PII surface); dev/test/prod → SA-impersonated identity token with `--include-email`. No way for `aiplatform group new --env prod` to silently use a stub token. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | CLI is pure transport; all permission checks and code generation stay server-side. |
| | **Net Score** | **+7** | Threshold ≥ +4 ✓ — strong alignment. |

**Conflict Justifications:** None.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| CLI command shape | Click subcommand under existing `aiplatform` root | New `aiplatform group` group, with `new` / `list` / `revoke` subcommands. Matches existing `aiplatform sessions inspect` / `aiplatform bucket list` pattern. |
| Auth resolution | Inherited `aiplatform.http.get_bearer_token` for cloud envs; literal `local-mode-stub-token` for `--env local` | Same precedence as existing CLI commands. |
| HTTP transport | `aiplatform.http.AIPlatformClient` | Reuses the env-resolved base URL, bearer injection, error mapping. |
| List output | Pure text table by default; `--json` flag for machine consumption | Matches `aiplatform sessions inspect --json`. |
| Configuration | `--env` flag (local | dev | test | prod) + `AIPLATFORM_API_URL` override | Existing pattern; same as CLI root. |

**No custom formats invented.**

## CLI Surface

Three new commands under `aiplatform group`:

```bash
# Mint a new code. --skill is the skill NAME (not UUID); CLI looks up the ID.
aiplatform group new --env dev --skill problem-set-hints --title "jutland-2026-05-27"
# → JOIN CODE: RHLR-96FA
#   expires: 2026-06-19T12:34:20Z (30 days)
#   skill:   problem-set-hints
#   creator: aipla-v6@aipla-dev-2026.iam.gserviceaccount.com
#   --title "jutland-2026-05-27"

# List active codes for an env.
aiplatform group list --env dev
# CODE        TITLE                  SKILL              EXPIRES          USAGE
# RHLR-96FA   jutland-2026-05-27     problem-set-hints  2026-06-19T...   0/100
# DXQL-HJRZ   jutland-demo-v01       problem-set-hints  2026-06-19T...   3/100
# ...

# Revoke a code (best for "leaked in screenshot" scenarios).
aiplatform group revoke --env dev RHLR-96FA
# → REVOKED: RHLR-96FA (was: jutland-2026-05-27, by Mark)

# Optional flags everywhere:
#   --json          machine-readable output instead of text table
#   --ttl-days N    override default 30-day TTL on `new`
#   --cap N         override default 100 session cap on `new`
#   --url <url>     override env URL resolution (rarely needed)
```

**Flag conventions:**
- `--env` defaults to `local`.
- `--skill <name>` resolves to skill_id via the marketplace endpoint.
- `--json` produces a single-line JSON payload for scripting (matches existing CLI commands).
- Errors exit with code 1 and write a one-line message to stderr; success exits 0 with output to stdout.

## Design

### Overview

Three Click subcommands in a new `aiplatform/commands/group.py` module. The hard work was already done — `POST /api/auth/group/create` (for non-admin teachers) and `POST /api/admin/mint-demo-group` (for SA-authed admins) already exist; this doc is the **client wrapper** that picks the right one per env + handles output formatting.

### CLI Module Changes

**New file**: `cli/aiplatform/commands/group.py` (~150 LOC)

```python
@click.group()
def group():
    """Mint and manage anonymous-group join codes for the v0.1 demo flow."""

@group.command("new")
@click.option("--skill", required=True, help="Skill name (not UUID) to bind the code to.")
@click.option("--title", default="", help="Free-form title, for the audit trail.")
@click.option("--ttl-days", default=30)
@click.option("--cap", "max_concurrent_sessions", default=100)
@click.option("--json", "as_json", is_flag=True)
@click.pass_context
def new_group(ctx, skill, title, ttl_days, max_concurrent_sessions, as_json):
    client = AIPlatformClient(env=ctx.obj["env"])
    skill_id = _resolve_skill_id(client, skill)         # marketplace lookup
    record = client.post("/api/admin/mint-demo-group", json={
        "skill_name": skill,
        "title": title or f"cli-{datetime.utcnow().date()}",
        "ttl_days": ttl_days,
        "max_concurrent_sessions": max_concurrent_sessions,
    })
    _print_new(record, as_json)
```

The `_resolve_skill_id` helper hits `GET /api/skills/marketplace` (unauthenticated), filters by name, surfaces a clean "skill 'X' not found — available: Y, Z, ..." error if missing.

### Backend Changes

The `/api/admin/mint-demo-group` endpoint already exists (added 2026-05-20). Two small extensions:

**New: `GET /api/admin/list-demo-groups`** — returns all active groups visible to the caller (filtered by `creator_uid` for non-admin futures; admin SA sees all). Response shape:

```python
class GroupListResponse(BaseModel):
    groups: list[GroupListItem]

class GroupListItem(BaseModel):
    code: str
    title: str
    skill_id: str
    skill_name: str
    expires_at: float
    created_at: float
    creator_uid: str
    sessions_used_today: int
    max_concurrent_sessions: int
    revoked: bool
```

**New: `POST /api/admin/revoke-group/{code}`** — wraps the existing `delete_group()`. Returns 200 with the revoked group, 404 if missing.

Both go in `backend/admin/routes.py` next to `mint_demo_group`. Same SA-allowlist gate via `_assert_caller_is_service_account`.

### Auth Resolution

The CLI's `--env` flag drives the auth mode:

| Env | Token shape | Source |
|---|---|---|
| `local` | Literal `local-mode-stub-token` bearer | Hardcoded in the CLI when env=local; the firebase-auth stub accepts it |
| `dev` / `test` / `prod` | SA-impersonated Google identity token with `--include-email` | `gcloud auth print-identity-token --impersonate-service-account=<SA> --audiences=<URL> --include-email` — wrapped in a helper function |

The CLI calls `_resolve_bearer(env, audience_url)` once at command start. Errors at this step surface a clear `"Run 'gcloud auth login' then 'gcloud auth application-default set-quota-project ...'"` message, not an opaque 401. Mirrors the same gotcha from upstream-feedback #14 (the `include_email=true` requirement).

### Architecture Diagram

```
$ aiplatform group new --env dev --skill problem-set-hints --title jutland
        │
        ▼
[aiplatform CLI / commands/group.py]
        │
        ├─► resolve_skill_id(client, "problem-set-hints")
        │      └─► GET /api/skills/marketplace  →  uuid
        │
        ├─► _resolve_bearer(env="dev", audience=<URL>)
        │      └─► gcloud impersonate aipla-v6@ + --include-email
        │
        ├─► POST /api/proxy/api/admin/mint-demo-group
        │   { skill_name, title, ttl_days, max_concurrent_sessions }
        │       │
        │       ▼  (backend)
        │   _assert_caller_is_service_account(request) → claims["email"]
        │       │
        │       ▼
        │   skill = list_skills().filter(name=...)
        │   record = create_group(skill_ids=[skill.id], creator_uid=f"admin:{email}", ...)
        │       │
        │       ├─► _state.groups[code] = record   (in-memory cache)
        │       └─► _persist_group(record)          (Firestore write-through)
        │       │
        │       ▼
        │   { code, expires_at, skill_id, title }
        │
        ▼
[CLI prints the code + expiry + skill — boxed for the operator's terminal]
```

## Implementation Plan

### Phase 1 — CLI shim (single PR, ~0.3 day)

- [ ] Create `cli/aiplatform/commands/group.py` with `new` / `list` / `revoke` (~150 LOC)
- [ ] Add `_resolve_skill_id(client, name)` helper that surfaces clean missing-skill errors (~30 LOC)
- [ ] Add `_resolve_bearer(env, audience_url)` helper (gcloud impersonation for cloud envs, stub for local) (~40 LOC)
- [ ] Register the command group in `cli/aiplatform/cli.py` (1 line)
- [ ] Pretty-print helpers — text table for `list`, boxed code display for `new`, JSON branch for both (~30 LOC)

### Phase 2 — Backend endpoint extensions (~0.15 day)

- [ ] `GET /api/admin/list-demo-groups` — SA-authed, returns active groups + usage counters (~40 LOC route + ~30 LOC pydantic model)
- [ ] `POST /api/admin/revoke-group/{code}` — wraps `delete_group()` with the admin-auth gate (~25 LOC)
- [ ] Both endpoints log to Cloud Logging via the existing logger pattern

### Phase 3 — Tests + ergonomic touches (~0.1 day)

- [ ] `cli/tests/test_cli_group.py` — mock the HTTP layer with `respx`; test new/list/revoke happy paths + skill-not-found error + auth-not-resolvable error (~80 LOC)
- [ ] `backend/tests/api_tests/test_admin_routes.py` — add cases for list + revoke
- [ ] `scripts/mint-jutland-group.sh` shell wrapper (1-line script that calls `aiplatform group new --env dev --skill problem-set-hints --title "$1"`) — convenience for ops who haven't installed the CLI
- [ ] Update `frontend/public/demo-walkthrough.md` to reference the new command shape

## Migration & Rollout

**Database migrations:** None — all reads/writes use the existing `anon_groups` Firestore collection.

**Feature flags:** None — pure additive surface. Old `curl` flows continue to work.

**Rollback plan:** Revert the CLI commit. The two new admin endpoints are additive; even if they ship and someone uses them in scripts, leaving the endpoints in place after a CLI revert is fine.

**Environment variables:** None new — same `AIPLATFORM_API_URL_<ENV>` overrides the CLI already understands.

## Testing Strategy

### CLI Tests (pytest + respx, ~80 LOC)
- [ ] `test_new_happy_path`: stub HTTP, assert correct payload, assert correct stdout shape
- [ ] `test_new_skill_not_found`: stub marketplace empty, assert exit 1 + helpful stderr
- [ ] `test_new_auth_unresolvable`: stub bearer fetch to raise, assert exit 1 with gcloud hint
- [ ] `test_list_text_format`: stub list endpoint with 2 groups, assert text-table column shape
- [ ] `test_list_json_format`: `--json` flag, assert valid JSON output
- [ ] `test_revoke_happy_path`: stub revoke 200, assert stdout
- [ ] `test_revoke_unknown_code`: stub 404, assert exit 1 with `code not found` message
- [ ] `test_group_subcommands_registered`: smoke-check the Click tree

### Backend Tests (pytest, ~40 LOC)
- [ ] `test_list_demo_groups_returns_array`: SA-authed call returns the groups in Firestore
- [ ] `test_list_filters_revoked`: revoked groups don't appear by default; `?include_revoked=true` includes them
- [ ] `test_revoke_group_marks_firestore_revoked`: revoke + then list confirms `revoked=true`
- [ ] `test_revoke_admin_only`: non-admin caller gets 403

### Manual Testing
- [ ] `aiplatform group new --env local --skill problem-set-hints` mints + prints
- [ ] `aiplatform group new --env dev --skill problem-set-hints` mints + prints against deployed
- [ ] `aiplatform group list --env local` shows the local in-memory codes
- [ ] `aiplatform group list --env dev` shows the persistent deployed codes
- [ ] `aiplatform group revoke --env dev <code>` revokes; subsequent `list` shows it gone

## Security Considerations

- **SA-allowlist gate.** Both new endpoints sit behind `_assert_caller_is_service_account` — same allowlist as the existing `seed-platform-skills` and `mint-demo-group`. No new auth path introduced.
- **Stub-token isolation.** The CLI's `--env local` branch uses `local-mode-stub-token` exclusively for backends that have `LOCAL_MODE=1`. A misconfigured backend (production with `LOCAL_MODE=1`) is an existing class of bug already caught by the backend's startup-guard (`STARTUP ERROR: LOCAL_MODE paired with K_SERVICE…`).
- **No PII in CLI logs.** The CLI doesn't write codes to disk by default. Operators can pipe to a file if they want a record; the audit trail of who minted lives in Cloud Logging.
- **Revocation is hard-block.** A revoked code returns 401 `not found or no longer active` from `join_group()` — same response as never-existed, so leaked codes don't leak post-revoke information.
- **Input validation.** Skill names go through `list_skills().filter` server-side — no SQL-injection-like surface. Group codes for revoke are validated against `_CODE_ALPHABET` shape before the backend lookup.

## Performance Considerations

- **One marketplace call per `new`.** The skill-by-name lookup hits the unauthenticated `/api/skills/marketplace` endpoint. ~10 skills in v0.1 — sub-100ms.
- **Three calls per `revoke`** (resolve-token + revoke + log). Bounded.
- **`list` reads all anon_groups docs.** Currently ~5 groups in v0.1; even at 100+ groups this is a single Firestore collection scan. Tiny.

## Success Criteria

- [ ] `aiplatform group new --env local --skill problem-set-hints --title test` outputs a code + expiry + skill in <5 seconds locally
- [ ] `aiplatform group new --env dev` works against the deployed backend via gcloud impersonation
- [ ] `aiplatform group list` shows the table format with all live codes
- [ ] `aiplatform group revoke <code>` revokes; subsequent join attempts return 401
- [ ] `--json` flag on any subcommand produces parseable JSON
- [ ] CLI suite passes (pytest in `cli/tests/`)
- [ ] Backend suite passes (pytest in `backend/tests/`)
- [ ] `frontend/public/demo-walkthrough.md` references the new command instead of the curl ritual

## Open Questions

1. **Should `aiplatform group new` automatically copy the code to clipboard?** Common ops affordance (`pbcopy` on macOS, `xclip` on Linux). Decision: **default no** (avoids surprising side effects on CI); add `--copy` flag in a follow-up if anyone asks.
2. **Should `list` show a usage histogram per code?** The backend tracks `sessions_today` already. Decision: **show in v1 list output** — useful for ops debugging "is anyone joining this code?". v0.1 ships with usage column.
3. **Where does `creator_uid` come from for admin-minted codes?** Currently `f"admin:{caller_email}"`. Decision: **keep as-is** — clearly marks ops-minted from teacher-minted.
4. **Do we want a `aiplatform group inspect <code>` subcommand?** Shows full record + recent join attempts (from logs). Decision: **defer to v1** unless ops demand it during Jutland buffer week.

## Related Documents

- [docs/design/aipla/SEQUENCE.md](../SEQUENCE.md) — overall AIPLA build sequence; this doc sits in the v0.1.0-jutland "stretch" track
- [docs/design/aipla/v0.1.0-jutland/jutland-demo.md](jutland-demo.md) — the v0.1 design that this tooling supports
- [docs/upstream-feedback.md](../../../upstream-feedback.md) — entries #14 (include_email=true), #19/20/21 (anonymous-group corner cases) — same area
- Scoping site [architecture.qmd ADR-001](https://www.sunholo.com/aipla/architecture.html#adr-001-student-identity-no-auth-anonymous-group-ids) — the anonymous-group design this tooling implements ops for
- v1 path: [SEQUENCE.md Phase 1.7](../SEQUENCE.md) `class-and-group-management.md` — when teacher UI ships, the CLI becomes a developer/ops-only fallback while teachers use the GUI
