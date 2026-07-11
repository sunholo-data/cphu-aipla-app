# Teacher account defaults + runtime beta-features opt-in

**Status:** Proposed (SETTINGS-1 executes immediately — M, 2026-07-11)
**Last Updated:** 2026-07-11
**Priority:** P2 (quality-of-life + the flag-graduation mechanism the pilot needs)
**Estimated:** ~1–1.5d (prefs store + API ~0.5d · Defaults card + seeding ~0.5d · beta-flag tri-state + one converted flag ~0.5d)
**Scope:** Fullstack — `teacher_prefs/{uid}` Firestore doc, GET/PUT API, a "Defaults" card in `/teacher/settings`, builder/class-create seeding, the `NEXT_PUBLIC_*` → runtime opt-in graduation path.
**Dependencies:** [1.1.32 teacher-ux-refinement](teacher-ux-refinement.md) (SHIPPED — the *"no control without a consumer"* rule this doc is filtered through; the dead `difficulty` knob is the cautionary tale); [1.1.12 voice-personas](voice-personas.md) (SHIPPED — the per-class persona this seeds); RUBRIC-1 M3 (SHIPPED — the researcher lens panel that now shares the settings pane); the `NEXT_PUBLIC_AUTHORING_COPILOT` / `NEXT_PUBLIC_CONCEPT_MAP` dark-flag convention (COPILOT-1 / CONCEPT-1).
**Source:** M, 2026-07-11 — *"teachers don't have any settings currently right? is there scope to move some things into that settings panel? defaults on language etc?"*

## Problem

The `/teacher/settings` pane was a pure placeholder until RUBRIC-1 M3 gave **researchers** a panel
there — ordinary teachers still have zero account-level settings. Every knob a teacher has is
contextual: per-class (persona, read-aloud voice/language) or per-activity (language, elements).
That's mostly RIGHT (the placeholder's own copy says "settings live where they apply"), but it
leaves two real gaps:

1. **Repeated defaults.** A teacher who works in English (the KineBot audience) re-flips the
   language selector on every new activity; a teacher whose classes all use the same persona
   re-picks it per class. One-time account defaults that *seed* the contextual controls would
   remove the repetition without moving the controls.
2. **No runtime feature graduation.** Experimental surfaces (authoring co-pilot, concept map) are
   gated by `NEXT_PUBLIC_*` build-args — all-or-nothing per environment, changeable only by
   rebuild. There is no path for "pilot teachers who volunteer try the beta" without turning it on
   for everyone.

## Goals

- A teacher sets **default activity language** and **default class persona** once; new
  activities/classes start from them. The contextual controls keep working exactly as today.
- A **tri-state flag convention** (`'1'` on for all · `'beta'` runtime opt-in · `''` off) so a
  dark-flagged feature can graduate to teacher opt-in without a rebuild.
- Non-goals: teacher UI language (the real i18n project), notification prefs (no consumer),
  moving any contextual setting into the account level.

## Framework-native capability check (5b-ter)

- Per-user preferences: no AG-UI / ADK / MCP capability covers user preference storage — a plain
  Firestore doc (`teacher_prefs/{uid}`) is the platform's canonical store for exactly this shape
  (same pattern as `analytics_lens_configs`, `concept_progress`). No custom transport: FE reads
  via the existing `/api/proxy` + teacher-auth path.
- Runtime flags: no new plumbing — the tri-state extends the existing build-arg convention; the
  runtime half is one prefs field + one hook. Deliberately NOT a feature-flag service (Axiom 6:
  the "standard" here would be LaunchDarkly-class machinery — massive overkill for a 2-flag pilot;
  justified below as a 0, not a −1, since no open *protocol* exists for this).

## Design

### Store — `teacher_prefs/{uid}`

```
{
  "defaultLanguage": "da" | "en" | null,     // seeds the builder's language field on /new
  "defaultPersonaId": string | null,          // applied to a class right after creation
  "features": { "<flagKey>": true, ... },     // beta opt-ins, e.g. {"authoringCopilot": true}
  "updatedAt": <iso8601>
}
```

Own-uid only: the API reads/writes the CALLER's doc — no admin surface, no cross-teacher reads.
Missing doc ⇒ every consumer behaves exactly as today (graceful degradation is the default path).

### API

- `GET /api/teacher/prefs` — the caller's prefs (`{}` when unset). Teacher auth (`get_current_user`,
  Firebase token; students never call this).
- `PUT /api/teacher/prefs` — partial update (`extra="forbid"`), returns the merged doc.

### Seeding (defaults SEED contextual controls, never fight them)

- **Builder `/new`:** `useActivityBuilder` starts `language` from `prefs.defaultLanguage ?? "da"`.
  The field stays fully editable; editing an EXISTING activity ignores the default (hydrate wins).
- **Class create:** after a successful create, when `prefs.defaultPersonaId` is set, apply it via
  the same persona-update call `ClassPersonaPanel` uses. The panel remains the per-class override.

### Beta features — the tri-state graduation path

`NEXT_PUBLIC_<FLAG>` values: `'1'` = on for everyone (today's dev behaviour, unchanged) ·
`'beta'` = shipped in the bundle but visible only to teachers with `features.<key>` opted in ·
`''`/unset = off. One hook owns the rule:

```ts
useTeacherFeature(key, buildValue): boolean
// '1' -> true · 'beta' -> !!prefs.features[key] · else -> false
```

The Defaults card lists any flags currently in `'beta'` as toggles (an empty state when none —
which is dev's situation, where everything is `'1'`). Honest caveat, stated in the card copy for
researchers/pilot planning: `'beta'` code SHIPS in the bundle (NEXT_PUBLIC bakes at build), so this
is visibility gating, not secrecy — fine for teacher-tier features, not a security boundary.
SETTINGS-1 converts the **authoring co-pilot** check to the hook as the pattern (its dev value
stays `'1'`, so nothing changes on dev).

### Settings pane

A **"Defaults"** card for ALL teachers (above the researcher lens panel): language select, persona
select (from the existing catalogue endpoint), beta toggles. Empty/unset states designed; saving
PUTs partial updates.

### CLI surface

Skipped (5b-bis): pure teacher-facing UI over one trivial resource; no developer workflow touches
prefs. Revisit only if support ever needs to inspect a teacher's prefs (then `aiplatform users
prefs <uid>` under the existing users tree).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Removes per-activity/per-class re-configuration clicks; prefs read is one cached GET. |
| 2 | EARNED TRUST | +1 | Defaults are visible + editable at the point of use (the seeded field shows the value); beta card states plainly that opt-in code ships in the bundle. |
| 3 | SKILLS, NOT FEATURES | 0 | Neutral — account plumbing. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involvement. |
| 5 | GRACEFUL DEGRADATION | +1 | No prefs doc ⇒ byte-identical current behaviour; prefs fetch failure ⇒ defaults. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Plain Firestore doc + existing auth path; deliberately no flag-service dependency (no open standard exists for user prefs). |
| 7 | API FIRST | +1 | GET/PUT prefs endpoint; the card is just a client of it. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Standard request logging; nothing new to observe. |
| 9 | SECURE BY CONSTRUCTION | +1 | Own-uid only; teacher token required; students have no route to it; no new data class (a language code + a persona id + booleans). |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Merge/validation server-side; client renders the doc. |
| 11 | USABLE BY DESIGN | +1 | The settings pane finally has a reason to exist for ordinary teachers; empty states designed; contextual controls untouched. |
| | **Net Score** | **+7** | Threshold ≥ +4. No −1 scores. |

## Milestones (SETTINGS-1)

| MS | Deliverable | Est |
|---|---|---|
| **M0** | `teacher_prefs` store + GET/PUT `/api/teacher/prefs` (own-uid, partial update, `extra="forbid"`) + tests | ~0.4d |
| **M1** | Defaults card in `/teacher/settings` (language + persona + beta toggles, empty states) + `useTeacherPrefs` hook + tests | ~0.5d |
| **M2** | Seeding: builder `/new` language + class-create persona; `useTeacherFeature` tri-state hook + convert the authoring-co-pilot check; tests | ~0.5d |

## Success Criteria

- [ ] A teacher sets default language `en`; `/teacher/activities/new` starts on `en`; editing an existing `da` activity still shows `da`.
- [ ] A teacher sets a default persona; a newly created class carries it; ClassPersonaPanel still overrides per class.
- [ ] With a flag at `'beta'`: opted-in teacher sees the feature, others don't; `'1'` behaves as today (dev unchanged); `''` hides it for everyone.
- [ ] No prefs doc ⇒ all current behaviour byte-identical; prefs fetch failure degrades to defaults.
- [ ] A teacher can only ever read/write their OWN prefs (API test).
- [ ] Gates green both ends.

## Risks

| Risk | Mitigation |
|---|---|
| Default fights the contextual control (the anti-pattern) | Seeding happens ONCE at create-time; hydrate/edit paths never re-apply defaults; tested explicitly |
| Dead-knob creep (the 1.1.32 lesson) | Only three settings, each with a named consumer that exists today; anything else waits for its consumer |
| `'beta'` misread as a security boundary | Card copy states the bundle-shipping caveat; teacher-tier features only — student-facing gating stays server-side |
| Settings pane becomes a junk drawer | Additions require a consumer + this doc's update; the researcher panel stays researcher-only |

## Related Documents

- [teacher-ux-refinement.md](teacher-ux-refinement.md) (1.1.32) — the no-control-without-a-consumer rule
- [voice-personas.md](voice-personas.md) (1.1.12) — the per-class persona being seeded
- [competency-rubrics.md](competency-rubrics.md) (1.1.57) / RUBRIC-1 M3 — the settings-pane cohabitant
- [prompt-transparency-and-config.md](prompt-transparency-and-config.md) — the wider config-layer direction (researcher tier); this doc is the teacher-tier sibling
