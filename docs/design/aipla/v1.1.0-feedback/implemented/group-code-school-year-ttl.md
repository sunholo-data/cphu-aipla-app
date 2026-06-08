# Group code TTL — rename constant + graceful soft-archive on expiry (default stays 30d)

**Status:** **Rescoped 2026-06-03 mid-sprint** — default platform TTL stays at **30 days** (was: extend to 300d); rename + archival ship; teacher-choice flag for longer TTLs moves to follow-up doc [teacher-choice-ttl.md](../teacher-choice-ttl.md).
**Last Updated:** 2026-06-03
**Priority:** P1 — graceful expiry posture + naming clarity. The original "extend default to school year" goal was rethought on privacy grounds (longer default = larger PII / research-consent surface on every code, even ones that didn't need it). Teachers who *want* long-lived codes will get an explicit choice via the follow-up flag.
**Estimated:** ~2h (this doc's scope after rescope)
**Scope:** Backend constant rename + small archive-on-expiry helper; no UI change in this sprint
**Dependencies:** [session-persistence.md](../../v1.0.0-pilot/implemented/session-persistence.md) (1.F shipped)
**Source brief:** [`june-03-feedback-sprint-brief.md` §6](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md) (the underlying ask is preserved; the *implementation path* changed from "raise platform default" to "let teacher opt in per code")

## What changed mid-sprint

The brief and original design proposed lifting the platform-wide default from 30 days to 300 days. While Track B of QUICK-WINS-V11 was in flight, the team flagged a concern: **a 300-day default applies to every code, including short-lived demo / one-off codes that don't need the longer lifespan**. Longer-lived data means more data subject to research-consent retention policies, more state to revoke if something goes wrong, larger surface area in general. The pedagogical / portfolio benefit only accrues to codes that *should* live a school year — not to every code.

The reshape:

- **Platform default stays at 30 days** (`DEFAULT_GROUP_CODE_TTL_DAYS = 30`).
- **The rename ships** (`DEFAULT_TTL_DAYS` → `DEFAULT_GROUP_CODE_TTL_DAYS`) because the new name reads better regardless of value.
- **Soft archival on expiry ships** — graceful 410 Gone on archived-session restore; Firestore doc flipped `archived: true`; BigQuery rows retained. Independent of TTL duration.
- **Teacher-choice flag deferred** to [teacher-choice-ttl.md](../teacher-choice-ttl.md) — backend `mint_group(ttl_days=...)` already accepts the parameter; what's missing is the teacher-UI surface and the route-level pass-through.

This doc is the canonical record for the **rename + archival** half of the work; the teacher-choice doc is the canonical record for the **per-code TTL choice** half.

## Where the constant lives

The TTL value lives in one place:

- [backend/auth/group_id_auth.py:53](../../../../backend/auth/group_id_auth.py#L53) — `DEFAULT_GROUP_CODE_TTL_DAYS = 30` (renamed from `DEFAULT_TTL_DAYS` in this sprint)
- Used at lines 402 + 457 as the default for `mint_group(ttl_days=...)` and the deploy-time-seeding entry point
- Docstring at line 414 points teachers at the forthcoming teacher-choice flag for longer TTLs

## Archival semantics

When a code expires (300d from creation OR teacher-revoked):

| Surface | Behaviour |
|---|---|
| Firestore `sessions/{group_id}` doc | `archived: true`; `archived_at: <ts>`; not deleted |
| Group JWT validation | Returns 410 Gone on session restore attempts (existing behaviour from session-persistence) |
| BigQuery `chat_turns` / `workbench_events` rows | Retained per the broader UCPH research-data policy (NOT 300d-tied); driven by the consent-table retention conversation in [student-consent-prompt.md](../student-consent-prompt.md) |
| Teacher UI | Archived sessions visible in class detail under an "Archived" filter (defaults off); read-only |
| `aiplatform sessions resume <code>` CLI | Returns clear `archived` error; does not silently re-mint |

## Why this is small but worth a doc

Two concerns make it not-quite-trivial:

1. **Soft-archive vs hard-delete** is a posture decision. Default-soft is the right call (year-end portfolio download depends on data still existing) but it should be documented so the answer is clear when someone asks "why did we keep this row?" three months from now.
2. **Coupled to portfolio-download** which the brief defers explicitly. The end state is: end of school year, student downloads a summary of their sessions across the year. This doc is the *prerequisite* that the data still exists in 300 days. A separate small doc lands later for the actual download UX.

## Acceptance

- [ ] Default TTL constant raised to 300 days; all literal `30` references replaced with the named constant
- [ ] A group code created today is valid for 300 days (verify via JWT exp claim + integration test)
- [ ] At expiry, the session doc flips to `archived: true`; the BigQuery rows are unaffected
- [ ] Resume of an archived code returns 410 Gone with a clear error message
- [ ] Teacher UI's "Archived" filter on class detail shows archived sessions as read-only
- [ ] `aiplatform sessions resume <expired_code>` CLI returns a clear `archived` error code
- [ ] Backwards-compat: codes created before this change still expire at *their original* 30d boundary (the TTL is set at creation; existing JWTs don't retroactively extend); documented in the PR
- [ ] One pytest: expire-via-clock-forward → archived flag set, BQ rows still present
- [ ] `make lint` + `make test-fast` green; no FE changes needed for the TTL itself (the "Archived" filter is a small follow-up if it doesn't already exist)

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Stale data accumulates indefinitely | Low for v1.1; medium long-term | The retention policy is consent-table-driven, not group-code-driven. Document this in the runbook |
| Students share school-year codes outside the cohort | Medium | Teacher can manually revoke any time; same trust posture as today's 30d codes — extends the window but not the risk surface shape |
| Archive flag not honoured by some code path → expired codes still usable | Low | Single chokepoint in `validate_group_token`; pytest the negative path |
| Backwards-compat: existing 30d codes confuse teachers ("why did this code stop working?") | Low | Documented in PR + a one-line teacher-facing note: "Codes created before YYYY-MM-DD still expire at 30 days. Mint new codes for school-year persistence" |
| Encourages student carelessness with codes ("I'll just keep this one all year") | Low | Group codes are already supposed to be class-scoped; this just matches the existing pedagogical model |

## Open questions

1. Should existing 30d codes get retroactively bumped to 300d? **Recommend: no.** Backwards-compat surprise > the convenience of extension. Mint new codes if a teacher wants school-year persistence.
2. Per-class override? E.g. some teachers want a 30-day code (substitute teaching, short module). **Recommend: defer to a class-config field in [teacher-permission-model.md](../../v1.0.0-pilot/implemented/teacher-permission-model.md) only if asked.** v1.1 ships the universal 300d default; no per-class knob.
3. Archive *vs* expiry — what's the user-visible difference? In v1.1 nothing — both flip the session doc; the JWT just stops validating. If portfolio-download adds a "view but don't resume" path, that's the moment to distinguish them.

## Files

| File | Purpose | LOC est. |
|---|---|---|
| [backend/auth/group_id_auth.py](../../../../backend/auth/group_id_auth.py) | TTL constant; JWT `exp` claim derived | small |
| [backend/db/models/session.py](../../../../backend/db/models/session.py) | TTL constant; new `archived: bool`, `archived_at: datetime \| None` fields | +10 |
| [backend/protocols/session_routes.py](../../../../backend/protocols/session_routes.py) | Resume returns 410 on `archived = true` | small |
| `backend/tests/integration/test_session_lifecycle.py` (or equivalent) | Expire-via-clock-forward test; archived-resume test | +60 |
| `cli/aiplatform/sessions.py` | Resume command's error message for archived sessions | small |
| `frontend/src/components/teacher/.../ClassDetail.tsx` | "Archived" filter (if it doesn't already exist) | +30 |
| `docs/design/aipla/v1.0.0-pilot/implemented/session-persistence.md` | One-line note pointing to this doc for the v1.1 TTL change (don't rewrite the original doc) | small |

## Out of scope

- Portfolio-download UX (separate small doc post-pilot)
- Per-class TTL override (deferred)
- Auto-prompting teachers to renew expiring codes (not asked)
- Email/notification on archival (no notification infrastructure in v1; deferred)
- Migration of old 30d codes (backwards-compat: leave as-is)

## Related

- [session-persistence.md](../../v1.0.0-pilot/implemented/session-persistence.md) — the doc this extends
- ADR-001 (anonymous group auth) — TTL was bound to ADR-001's 30d default; this doc relaxes that default
- [student-consent-prompt.md](../student-consent-prompt.md) — the retention conversation lives there (BQ rows retained per consent table policy, not per group-code TTL)
- Future: a `portfolio-download.md` small sprint doc once this lands and the school year is far enough along that the data is interesting
