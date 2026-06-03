# Group code TTL — extend from 30 days to a Danish school year

**Status:** Planned (P1; quick win)
**Last Updated:** 2026-06-03
**Priority:** P1 — quick win that unblocks the eventual portfolio-download feature. Teachers and students at 3 June check-in want codes to persist for the full school year, not the 30-day default
**Estimated:** ~2h
**Scope:** Backend config delta + small Firestore-doc archival flag; no UI change
**Dependencies:** [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) (1.F shipped)
**Source brief:** [`june-03-feedback-sprint-brief.md` §6](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md)

## Change

Extend the default group-code + session TTL from **30 days** to **300 days** (~10 months, approximately a Danish school year). Soft-archive on expiry rather than delete: chat-log and workbench-event rows stay in BigQuery; the Firestore session doc gets `archived: true`. Teacher can still manually expire/revoke a code from the class detail screen.

## Where the constant lives

The 30-day value lives in (verify the exact location during the change):

- [backend/auth/group_id_auth.py](../../../../backend/auth/group_id_auth.py) — JWT `exp` claim
- [backend/db/models/session.py](../../../../backend/db/models/session.py) — session TTL constant
- [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) — design-doc references in narrative + acceptance tests

Search for `30` in the session-persistence implementation files; replace the few literal occurrences with a named constant `DEFAULT_GROUP_CODE_TTL_DAYS = 300` exported from a single location. Don't grep for `30 days` only — the constant may be in seconds or ms.

## Archival semantics

When a code expires (300d from creation OR teacher-revoked):

| Surface | Behaviour |
|---|---|
| Firestore `sessions/{group_id}` doc | `archived: true`; `archived_at: <ts>`; not deleted |
| Group JWT validation | Returns 410 Gone on session restore attempts (existing behaviour from session-persistence) |
| BigQuery `chat_turns` / `workbench_events` rows | Retained per the broader UCPH research-data policy (NOT 300d-tied); driven by the consent-table retention conversation in [student-consent-prompt.md](student-consent-prompt.md) |
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
2. Per-class override? E.g. some teachers want a 30-day code (substitute teaching, short module). **Recommend: defer to a class-config field in [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) only if asked.** v1.1 ships the universal 300d default; no per-class knob.
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

- [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) — the doc this extends
- ADR-001 (anonymous group auth) — TTL was bound to ADR-001's 30d default; this doc relaxes that default
- [student-consent-prompt.md](student-consent-prompt.md) — the retention conversation lives there (BQ rows retained per consent table policy, not per group-code TTL)
- Future: a `portfolio-download.md` small sprint doc once this lands and the school year is far enough along that the data is interesting
