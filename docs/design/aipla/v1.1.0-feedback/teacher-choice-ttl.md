# Teacher-choice group-code TTL — let teachers pick per-code lifespan

**Status:** Planned (P1; follow-up to [group-code-school-year-ttl.md](group-code-school-year-ttl.md))
**Last Updated:** 2026-06-03
**Priority:** P1 — pulled out of [1.1.6 group-code-school-year-ttl](group-code-school-year-ttl.md) mid-sprint on 2026-06-03 once it became clear that lifting the *platform default* to 300d was the wrong shape: longer-lived data should be a deliberate per-code teacher decision, not a one-size-fits-all default
**Estimated:** ~0.5-1d combined (mostly frontend; the backend parameter already exists)
**Scope:** Backend route param pass-through + validation; frontend form field on group-code creation + class-detail display; CLI flag for parity
**Dependencies:** [group-code-school-year-ttl.md](group-code-school-year-ttl.md) (rename + archival shipped); [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A shipped — the group-code creation flow lives in the teacher UI surface)
**Source brief:** [`june-03-feedback-sprint-brief.md` §6](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md) (the teacher / student ask for school-year-lived codes is preserved; the *delivery mechanism* moves from platform default to per-code teacher choice)

## Problem

The brief asked for group codes to persist for the full Danish school year so students can rejoin and build a portfolio over time. The first cut of [1.1.6](group-code-school-year-ttl.md) implemented this as a platform default of 300 days for every code. Mid-sprint the team flagged a privacy concern: **applying 300d to every code is overshoot.**

- Short-lived demo / one-off codes don't need school-year persistence — they accrue research-consent retention overhead for nothing
- Teachers don't all want the same shape: a Physics A class might want school-year persistence; a one-off Open Day demo wants 1 week
- Privacy posture is better when the longer-lived storage is an explicit deliberate decision per-code rather than the default

The backend already supports per-code TTL — `mint_group(ttl_days: int = DEFAULT_GROUP_CODE_TTL_DAYS, ...)` at [backend/auth/group_id_auth.py:402](../../../../backend/auth/group_id_auth.py#L402) accepts a `ttl_days` argument. What's missing is the route-level and teacher-UI surface so teachers can actually pass it.

## Design

### Backend route + validation

The group-code creation route (verify path during build — likely under [backend/protocols/](../../../../backend/protocols/) something like `class_routes.py` or `group_routes.py`):

- Accept `ttl_days: int | None` in the request body. If omitted → use `DEFAULT_GROUP_CODE_TTL_DAYS` (= 30).
- **Range validation:** clamp to a sensible range. Recommended: **minimum 7 days, maximum 365 days**. Below 7 frustrates classroom use; above 365 covers the school-year case + a small buffer for late-summer codes carrying into autumn. Reject with HTTP 422 + clear error message outside the range.
- Pass through unchanged to `mint_group(ttl_days=...)`.

**Extension flow** — already exists. [backend/auth/group_id_auth.py:455](../../../../backend/auth/group_id_auth.py#L455) `set_group_code` accepts `ttl_days` on the re-mint / extend path. The teacher UI should expose "extend this code by N days" as a separate affordance for codes nearing expiry (small follow-up — out of scope for this doc).

### Frontend UX

On the group-code creation form (lives under [frontend/src/app/teacher/...](../../../../frontend/src/app/teacher/) — exact path verified during build; likely the class-detail or class-create page):

**Recommended shape: preset dropdown with one custom option.**

```
┌────────────────────────────────────────────────────────┐
│  Create group code for Physics A — period 3            │
│                                                        │
│  Code lifespan:                                        │
│  ( ) 30 days   (default — recommended for most use)   │
│  ( ) 90 days   (one term)                              │
│  ( ) 180 days  (one semester)                          │
│  ( ) 300 days  (full Danish school year)               │
│  ( ) Custom: [___] days                                │
│                                                        │
│  Note: longer codes keep more session data alive for   │
│  research. Use the shortest lifespan that fits your    │
│  use case.                                             │
│                                                        │
│  [ Create code ]                                       │
└────────────────────────────────────────────────────────┘
```

**Behaviour rules:**
- Default radio selection: 30 days (matches platform default; safest privacy posture)
- Custom field validates 7-365 client-side; backend re-validates per the rules above
- Note copy is mild — informational, not preachy. The note documents the trade-off so teachers can make an informed choice.
- Display on class detail: each code shows its TTL + remaining days alongside the code itself (e.g. `ABC-123 · 30d · 12 days remaining`)

### CLI parity

The `aiplatform group new` / `aiplatform class lessons` / wherever code creation lives in the CLI (verify during build): add `--ttl-days N` flag, default 30, validation matches backend.

### Why preset dropdown over free-form number

- Three out of four teachers will pick one of the presets — the UX should make those one-click
- "School year" is the most-requested long-lived choice; making it a labelled preset (300d) is more discoverable than asking teachers to type the right number
- Custom field is there for the edge case (specific event date, multi-class shared code) without making the dropdown unwieldy

If pilot teachers consistently pick "Custom" + a value not in the presets, the dropdown options can be tuned without API changes.

## What about already-minted codes?

Out of scope for this doc — same posture as in [group-code-school-year-ttl.md](group-code-school-year-ttl.md): existing codes keep their original TTL (set at mint time; the constant change does not retroactively extend). If a teacher wants to extend an existing code, that's the **extension flow** affordance (small follow-up doc); for v1.1 the answer is "mint a new code with the longer TTL."

## Acceptance

- [ ] Backend route accepts `ttl_days: int | None` in the body; validates 7 ≤ ttl_days ≤ 365 or returns 422
- [ ] Backend default behaviour unchanged (omit `ttl_days` → 30 days)
- [ ] Frontend group-code creation form shows the preset dropdown with the four preset options + custom
- [ ] Default selection on the form is 30 days; teacher must actively pick longer
- [ ] Class-detail page shows TTL + days-remaining per code
- [ ] CLI `aiplatform group new --ttl-days 300` mints a 300-day code; default behaviour unchanged
- [ ] One pytest: 7d, 30d, 300d, 365d all accepted; 0, 6, 366 rejected with 422
- [ ] One vitest: form posts the chosen TTL; default state is 30d
- [ ] No emoji
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Teachers default-pick the longest option "just in case" | Medium | Default radio is 30d + note copy frames longer as opt-in for a reason; review with JB if pilot shows the bias |
| Range bounds wrong | Low | 7-365 is conservative and easy to relax; revisit if a real use case appears outside |
| Code-extension flow not built → teachers mint new code mid-class | Low | Documented gap; follow-up doc lands if pilot teachers ask |
| Privacy gain undone by default-pick behaviour | Medium | Default is the short value; this is the same privacy posture as never adding the flag, plus an explicit opt-in path |
| CLI default and UI default drift | Low | Both default to 30 (the platform constant); changing one without the other shows up in tests |

## Open questions

1. **Preset values** — 30/90/180/300 are reasonable but unvalidated. JB might prefer different chunks (term-aligned with the Danish school calendar). Easy to tune; pick a starting set, iterate after pilot feedback.
2. **Class-level default** — should each `Class` carry its own default TTL that pre-fills the form? Adds one more field on `Class`; defers until a teacher asks. v1.1: per-code only.
3. **Notification when a code is approaching expiry** — out of scope; no notification infrastructure in v1. Filed as a follow-up if teachers request.
4. **Should the note copy be in Danish + English** — yes for pilot (Danish teachers). UI i18n already handles both per [teacher-ui.md](../v1.0.0-pilot/teacher-ui.md).

## Files (estimate)

| File | Purpose | LOC est. |
|---|---|---|
| `backend/protocols/<group-code-route>.py` (verify exact file during build) | Accept + validate + pass-through `ttl_days` | +30 |
| `backend/tests/api_tests/test_group_code_ttl_choice.py` | Range validation cases | ~80 |
| `frontend/src/components/teacher/<GroupCodeCreateForm>.tsx` (verify) | Preset dropdown + custom field + default state | +120 |
| `frontend/src/components/teacher/<ClassDetail>.tsx` | TTL + days-remaining display | +30 |
| `frontend/src/components/teacher/__tests__/...` | Vitest for default state + post shape | ~60 |
| `cli/aiplatform/group.py` (or wherever group commands live) | `--ttl-days` flag + validation | +20 |
| `cli/tests/test_group_new_ttl.py` | CLI flag test | ~40 |

## Out of scope

- Mid-life code extension UI (separate small follow-up if teachers request)
- Class-level default TTL pre-fill
- Notification on impending expiry
- Per-cohort or per-skill TTL defaults
- Bulk re-TTL of existing codes
- Audit-log when teacher picks a long TTL (research-compliance future-proofing — defer)

## Related

- [group-code-school-year-ttl.md](group-code-school-year-ttl.md) — sibling doc; ships the rename + archival half. This doc ships the per-code-choice half
- [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A) — the teacher-UI surface where this lives
- [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) (1.F) — TTL-aware session restore
- ADR-001 (anonymous group auth) — informs the privacy posture rationale for why per-code choice > platform default
