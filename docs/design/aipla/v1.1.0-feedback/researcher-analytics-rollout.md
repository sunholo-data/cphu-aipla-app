# Researcher analytics rollout — finish the cross-class read bypass

**Status:** ✅ **SHIPPED** — `feat(insights): [1.1.51] researchers get cross-class analytics — drill-downs, overview, transcripts`, plus the `/teacher/research` surface. ⚠️ **Relevant to the 2026-09-01 researcher-view ask** — this is the shipped baseline that request builds on. Originally — completion of [researcher-role.md](researcher-role.md) (1.1.5)
**Last Updated:** 2026-06-26
**Priority:** P1 — JB/AR/M carry the `role:researcher` claim specifically to see
cross-class engagement, not just cross-class *lists*. Today the claim opens the
class list, the activity scan and cross-class cost, but the **analytics** the
researchers actually came for (KPIs, per-group/per-activity breakdowns, the
cross-class overview, transcripts) is still owner-scoped. A researcher clicking
into a class they don't own hits a **404 cliff**.
**Estimated:** ~0.75–1d (Phases 1–3, deterministic REST). Phase 4 (analytics
chat) ~0.5d more, gated on an explicit sign-off — see below.
**Scope:** Backend route + aggregate guards; one frontend Overview toggle.
No new data, no schema change, no new auth mechanism.
**Dependencies:** [researcher-role.md](researcher-role.md) (1.1.5 — `is_researcher`,
`assert_can_read_class` shipped); [cost-dashboard.md](cost-dashboard.md) (1.1.9 —
the cost half of this already admits researchers, the pattern to copy);
[teacher-insights-dashboard / analytics-chat-tools.md](../v1.0.0-pilot/implemented/analytics-chat-tools.md).
**Source:** 2026-06-26 — M: *"when a researcher is logged in they need broad
access — can you check they can see all classes and teacher analytics, costs etc?"*
Audit found classes/activities/cost ✅ but analytics ❌.

## TL;DR

1.1.5 **specified** that analytics + transcripts admit researchers — see
researcher-role.md §"Endpoints to update" (the `transcript.csv` row → *"Bypass on
researcher claim"*, the analytics-chat row → *"helper that admits researchers"*,
and `analytics_routes.py` → *"Same swap"*). The shipped sprint only did the
**classes / activities / cost** surfaces. The **insights aggregates, the
cross-class overview, and transcripts were never swapped.** This doc finishes the
rollout and documents the one wrinkle 1.1.5 missed: it's not a pure gate swap —
the analytics queries carry a **defense-in-depth `allowed_group_codes` filter**
that must also be widened, or the researcher gets an authorized-but-empty result.

## The two gates (why "swap the gate" is half the fix)

Two authorization helpers live in [`backend/analytics/auth.py`](../../../../backend/analytics/auth.py):

| Helper | Admits researcher? | Used by |
|---|---|---|
| `assert_can_read_class(user, class_id)` | **yes** (1.1.5) | classes read routes, cost |
| `assert_caller_owns(uid, class_id)` | no (owner-only) | **every insights aggregate + analytics tool** |

Swapping `assert_caller_owns` → `assert_can_read_class` is necessary but **not
sufficient**. Each per-class aggregate also does:

```python
allowed = list(resolve_caller_group_codes(teacher_uid))   # the caller's OWNED codes
class_codes = _class_group_codes(class_id)                # the target class's codes
# SQL filters by BOTH:  WHERE group_code IN allowed  AND  group_code IN class_codes
```

`allowed_group_codes` is a belt-and-braces filter ("never trust the WHERE clause
to scope to the caller" — the M2 HARD GATE). For an **owner**, `class_codes ⊆
allowed`, so the intersection is just `class_codes`. For a **researcher on a
non-owned class**, `class_codes ∩ allowed = ∅` → the query runs, authorizes, and
returns **zero rows**. So the fix per aggregate is two lines:

```python
assert_can_read_class(user, class_id)                     # was: assert_caller_owns(uid, ...)
allowed = list(resolve_caller_group_codes(user.uid))
class_codes = _class_group_codes(class_id)
# Researcher reading a class they don't own: the class codes were just
# authorized by assert_can_read_class — widen the defense filter to include
# them. Append-only so the owner path's SQL/_debug output is byte-identical
# (for an owner class_codes ⊆ allowed, so `missing` is empty).
missing = [c for c in class_codes if c not in allowed]
allowed = allowed + missing
```

The append-only form means **owner behaviour, cache keys and `_debug.queries`
output are unchanged** — only the researcher-bypass path sees a widened filter.
Tests assert byte-identical owner output, so this property matters.

## Surface audit (what a researcher can see today vs. after)

| Surface | Endpoint | Today | After |
|---|---|---|---|
| All classes | `GET /api/classes?scope=all` | ✅ | ✅ (unchanged) |
| Single class | `GET /api/classes/{id}` | ✅ | ✅ (unchanged) |
| All activities | `GET /api/activities?scope=all` | ✅ | ✅ (unchanged) |
| Cross-class cost | `GET /api/insights/cost` | ✅ | ✅ (unchanged) |
| **Per-class KPIs** | `GET /api/insights/classes/{id}/kpis` | ❌ 404 | ✅ **P1** |
| **Per-class groups** | `…/groups` | ❌ 404 | ✅ **P1** |
| **Per-class activities** | `…/activities` | ❌ 404 | ✅ **P1** |
| **Per-class trend** | `…/trend` | ❌ 404 | ✅ **P1** |
| **Overview KPI strip** | `GET /api/insights/summary` | own only | ✅ `scope=all` **P2** |
| **Cross-class compare** | `GET /api/insights/compare` | own only | ✅ `scope=all` **P2** |
| **Per-group transcript** | `GET /api/recordings/group/{id}/transcript` | ❌ owner-only | ✅ **P3** |
| Analytics chat ("Ask the data") | tool calls | own only | **P4 — gated, see below** |

Writes/mint/delete stay owner-only throughout (`assert_caller_owns` /
`owner_uid == user.uid`) — this is read-only research access, per 1.1.5.

## Phases

### Phase 1 — per-class insights drill-downs (closes the 404 cliff)

The visible bug. A researcher on `/teacher/classes` toggles "all classes", clicks
a class they don't own, and the per-class panels 404. Fix in
[`backend/insights/aggregates.py`](../../../../backend/insights/aggregates.py):
`class_kpis`, `class_groups`, `class_activities`, `class_trend` take `user: User`
instead of `teacher_uid: str`; swap the gate + widen `allowed` per the snippet
above. Route layer [`insights_routes.py::_per_class`](../../../../backend/protocols/insights_routes.py)
passes `user=user` (cache key stays `teacher_uid=user.uid` so per-researcher cache
isolation is preserved). The byte-identical 404 translation in `_per_class` stays
— a non-researcher non-owner still gets `class not accessible`.

### Phase 2 — cross-class overview (`summary` / `compare`)

`teacher_summary` / `teacher_compare` iterate `list_classes_for_owner(teacher_uid)`.
Add `scope: str = "own"`; when `scope == "all"` **and** `user.is_researcher`,
iterate `list_all_classes()` instead and widen `allowed` to the union of all those
classes' codes. Routes gain `?scope=all` (researcher-only, 403 otherwise — mirror
`classes_routes.list_classes`). Frontend: a "All classes" toggle on the Insights
Overview, shown only when `useIsResearcher()`, identical pattern to the existing
Classes-page toggle. Owner labels on cross-class rows (reuse `resolve_owner_labels`).

### Phase 3 — per-group transcripts

[`recording_routes.py::get_group_transcript`](../../../../backend/protocols/recording_routes.py)
gates on `cls.owner_uid != user.uid`. Swap to `assert_can_read_class(user, cls.class_id)`.
**Consent-respecting** (1.1.5 §caveat + [student-consent-prompt.md](student-consent-prompt.md)):
the researcher sees the *fact* + metadata of a session, but transcript **content**
stays suppressed for consent-declined sessions — the existing consent gate is not
loosened, only the ownership gate. Delete stays owner-only.

### Phase 4 — analytics chat ("Ask the data") — GATED, not in this sprint

[`backend/analytics/tools.py`](../../../../backend/analytics/tools.py) resolves only
`uid` from `tool_context.state["user:id"]` — `is_researcher` is **not** in tool
state. Admitting researchers here means (a) plumbing `is_researcher` into the
analytics-agent session state, and (b) accepting that an **LLM**, not a
deterministic route, then gets cross-tenant query reach. That is a different risk
class from Phases 1–3 (which expose exactly the data the dashboard already renders
deterministically). 1.1.5 signed this off *in principle*, but the LLM-reach point
deserves an explicit yes before shipping. **Recommend: separate follow-up.**

## Acceptance criteria

- **P1.** A researcher `GET /api/insights/classes/{id}/kpis` for a class they do
  **not** own returns real KPIs (not 404, not empty). A non-researcher non-owner
  still gets 404 `class not accessible`. Owner output for an owned class is
  **byte-identical** to before (same `_debug.queries`). The OTel span carries
  `auth.researcher_bypass=true` on the bypass path only.
- **P2.** `GET /api/insights/summary?scope=all` and `…/compare?scope=all` return
  every class with owner labels for a researcher; 403 for a non-researcher even
  via URL-hack; `scope=own` (default) unchanged for everyone. Overview toggle is
  hidden for non-researchers.
- **P3.** A researcher reads any group's transcript; consent-declined sessions
  still suppress content; non-researcher non-owner still 404/403.
- All existing owner-path tests stay green (the regression bar for "didn't widen
  access for ordinary teachers").

## Test plan

Backend (`backend/tests/`):
- `tests/unit/analytics/` — extend with researcher-bypass cases on each aggregate:
  asserts (i) non-owned class returns rows for a researcher, (ii) the `allowed`
  filter is widened, (iii) owner output unchanged, (iv) non-researcher 404.
- `tests/api_tests/test_insights_routes.py` — researcher vs non-researcher on the
  per-class + `scope=all` routes; 403 URL-hack guard.
- `tests/api_tests/` recording route — researcher transcript read + consent
  suppression preserved.
- LOCAL_MODE: `LOCAL_MODE_RESEARCHER=1` already flips `is_researcher` in the stub
  (`backend/auth/local_mode_stub.py`) — use it for route tests.

Frontend (`frontend/src/`):
- Overview page: toggle visible only when researcher; `scope=all` threaded into
  the fetch; mirror `classes/__tests__/page.researcher.test.tsx`.

## Out of scope

- Phase 4 (analytics-chat cross-tenant) — gated follow-up.
- Any **write** access (still owner-only).
- Per-class researcher roles / role hierarchies (1.1.5 deferred to Year-2).
- The queryable `researcher_access_log` BQ audit table (1.1.5 §Open questions —
  OTel span only until UCPH compliance asks).

## Why this was missed

1.1.5's §Endpoints table listed the analytics swaps but the sprint shipped against
the *class* surfaces (the most visible "Research view"), and cost shipped its own
researcher gate in 1.1.9. The insights aggregates predate 1.1.5 (sprint
ANALYTICS-CHAT-AND-INSIGHTS) and were never revisited. The `allowed_group_codes`
widening — the reason a naive gate-swap returns empty — was not in the 1.1.5
design, which is the main thing this doc adds.
