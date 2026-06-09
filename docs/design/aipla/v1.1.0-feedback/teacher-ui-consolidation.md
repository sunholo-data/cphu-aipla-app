# Teacher UI consolidation — a simple, intuitive teacher surface + a config pattern that scales

**Status:** Planned (P1)
**Last Updated:** 2026-06-09
**Priority:** **P1** — the teacher surface has accreted features page-by-page and is now a *"mess of configs"*; it must be as simple and polished as the (good) student UI. **This is also a breadth-over-depth multiplier:** Year 1 runs many probes, each adding teacher-facing config — without a governing pattern, every probe makes the teacher UI worse. A clean config *system* lowers the cost of every future teacher-side feature, the same way [curriculum-library](curriculum-library.md) lowers the cost of every activity.
**Estimated:** ~5–7d phased (design system ~1.5d · IA/nav ~1d · analytics consolidation ~1.5d · class-detail refactor ~1.5d · activity-builder section model ~1.5d). Each phase is independently shippable.
**Scope:** Frontend-only — a teacher design-system component layer + information architecture (nav + route consolidation) + refactor of the two overloaded pages into the new pattern. **No backend/API change** (Axiom 10 — it is pure rendering of data the API already returns).
**Dependencies:** [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) (the shipped teacher surface this consolidates); [student-lesson-view.md](../v1.0.0-pilot/implemented/student-lesson-view.md) (the *quality bar* — the student UI is the reference for "simple and polished"); composes with every config-adding 9-June row ([tutor-personas](tutor-personas.md), [bidirectional-voice](bidirectional-voice-brief.md), [teacher-choice-ttl](teacher-choice-ttl.md), [cost-dashboard](cost-dashboard.md), [teacher-activity-authoring](teacher-activity-authoring.md))
**Source:** 2026-06-09 — M (teacher UI is a mess of configs as features accrete; student UI is good/simple, teachers need the same polish)

## Problem

The teacher surface grew page-by-page as features shipped, with **no shared component vocabulary, no information architecture, and no rule for where new config goes.** Concretely, in the current code:

| Symptom | Evidence | Why it hurts |
|---|---|---|
| **Kitchen-sink class page** | `frontend/src/app/teacher/classes/[id]/page.tsx` is **716 LOC** — Groups + Lessons + `ClassVoiceSettingsPanel` (215 LOC) + Recent activity + CSV/JSON export, all in one bespoke layout | Every new per-class config (voice modes, TTL choice 1.1.10, budget 1.1.9, consent) bolts onto this page → it only gets worse |
| **Three "how are students doing" surfaces** | `/teacher/analytics` (chat, 335 LOC) · `/teacher/insights` (KPI dashboard: KpiStrip/EngagementBar/TrendSparkline/CrossClassTable) · `/teacher/reports/groups/[id]` (per-group report, 368 LOC) | A teacher must learn three separate places with no unifying nav; overlapping purposes, no clear "start here" |
| **Half-stub builder tabs** | `activities/[id]/page.tsx` tabs: `goal` (real) · `parameters` (v1.1 *preview stub*) · `code` (*stub*) · `history` (*stub*) | Mixed real + placeholder tabs read as broken; and the 9-June additions (checklist, quiz, materials, persona, workbench-type, coverage-map) have **nowhere coherent to live** |
| **No navigation / IA** | `_TeacherClientShell.tsx` header links only to `/teacher/classes` + sign-out; everything else is deep-link-only | Features are undiscoverable unless you know the URL; there is no map of the teacher app |
| **No design system** | Each page hand-rolls layout (`max-w-6xl`, ad-hoc panels, one-off setting controls) | Inconsistent spacing/affordances; the next feature reinvents its own panel → compounding entropy |

The student UI is the counter-example and the **quality bar**: a focused lesson view, one primary action, designed empty/loading states, spare and motivating (Axiom 11). Teachers deserve the same — and the platform needs a pattern so they *keep* getting it as features land.

## Goals

**Primary goal:** A teacher can find any feature from a clear nav, every config sits in a consistent, progressively-disclosed pattern, and **adding a new config is a one-line slot into an existing section, not a new bespoke panel.** Match the student UI's simplicity.

**Success metrics:**
- A teacher reaches any surface (a class, an activity, insights, a report, settings) in **≤2 clicks from a persistent nav** — no deep-link knowledge required.
- The "how are students doing" question has **one** home (Insights) with clear sub-views, not three sibling routes.
- An activity's **essential** config (name, language, level, lesson goal) is visible in one screen; **advanced** config (workbench, quiz, persona, voice, materials) is one disclosure away — never a wall of fields.
- A new teacher-facing config ships by adding a `SettingRow` to the right tier — **zero new layout code**, and it inherits spacing/help/empty-state for free.
- `classes/[id]/page.tsx` drops from a 716-LOC monolith to a composed page of `SettingsSection`s, each <120 LOC.
- The student JS bundle is **unchanged** (teacher routes are already code-split; Axiom 10).

**Non-goals:**
- Backend/API changes — this renders existing data; no new endpoints (config contracts are owned by their own docs).
- New teacher *features* — this is the **container** the features land in, not the features (personas, voice, quiz, etc. keep their own docs).
- A visual rebrand — reuse the existing design tokens (Tailwind + Radix); this is IA + componentisation, not a new look.
- Student-UI changes — it is the reference, not in scope.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Shared `SettingsSection`/`TeacherCard` ship designed skeleton/loading states; nav makes transitions predictable. No new latency. |
| 2 | EARNED TRUST | 0 | No factual-claim surface change; renders the same data with the same provenance. |
| 3 | SKILLS, NOT FEATURES | +1 | **Core fit.** Progressive disclosure enforces the "≤3 concepts to start" bar — essential config visible, advanced collapsed. Activity creation stays a <60s happy path even as options grow. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Pure UI; no model path. |
| 5 | GRACEFUL DEGRADATION | +1 | One canonical `EmptyState`/error component → every surface degrades consistently (no class yet, no sessions, no insights) instead of ad-hoc blanks. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses the existing Radix + Tailwind design tokens and the student UI's patterns rather than inventing teacher-only widgets; one component vocabulary, not N bespoke panels. |
| 7 | API FIRST | +1 | Forces the discipline that config is **data the API returns**, rendered uniformly — no business logic creeping into bespoke teacher panels (it currently does). |
| 8 | OBSERVABLE BY DEFAULT | 0 | Rendering layer; analytics consolidation surfaces existing signals more coherently but adds no telemetry. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new data access; teacher-auth gate unchanged. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Explicitly frontend-only rendering; refactor *removes* logic that has accreted in page components back toward "render protocol data." Student bundle unaffected (teacher routes code-split). |
| 11 | USABLE BY DESIGN | +1 | **The headline.** Extends the student-only usability discipline to the teacher surface: designed IA, empty/loading/error states, and the narrowest viewport handled *before* the next feature lands — replacing the ship-then-patch entropy. |
| | **Net Score** | **+7** | Threshold: ≥ +4. |

**Conflict Justifications:** none (no −1). **Note on Axiom 11's framing:** the axiom's stated "why" is about *students* (our motivatable end-users). Teachers are a different user, but the same discipline applies — and a confused teacher misconfigures the very lessons students then fail. This doc is the case for treating teacher usability with the same upfront rigor; worth a one-line note in `product-axioms.md` that Axiom 11 covers any user-facing surface, teacher included.

## Standards compliance

- **Design system:** extend the existing Radix UI + Tailwind component layer (already used app-wide) — no new UI framework. The teacher primitives are thin compositions of what the student UI already uses, so the two surfaces share a vocabulary.
- **Config rendering:** where a config is genuinely declarative, prefer rendering it as **A2UI** (the platform's declarative-UI protocol) so teacher-config forms and student surfaces stay on one rail (consistent with [teacher-activity-authoring](teacher-activity-authoring.md)'s A2UI stance). Bespoke React only where interaction demands it.
- **No new protocol or schema** (Axiom 6).

## Design

### 1. Information architecture — give the teacher app a map

Add a **persistent primary nav** — the single biggest fix. **Shape (decided, by breakpoint): a left rail at `≥ md` (laptop) that becomes a bottom bar at `< md` (tablet/phone).** One nav component, two responsive forms, so it fits both the planning-at-a-desk and glancing-in-class realities. Four top-level destinations, each a clear job:

```
┌────────────┬─────────────────────────────────────────────┐
│ ◧ Classes  │   (Classes is the default landing)          │
│ ◳ Activities│                                             │
│ ◴ Insights │   content area (TeacherPage)                 │
│ ⚙ Settings │                                             │
│            │                                             │
│  ─────     │                                             │
│  T  ⏻      │                                             │
└────────────┴─────────────────────────────────────────────┘
```

| Destination | Holds | Replaces today's |
|---|---|---|
| **Classes** | Class list → class detail (roster, group codes, **class settings** as tiered sections) | `/teacher/classes`, `/teacher/classes/[id]` (de-kitchen-sinked) |
| **Activities** | Activity library → builder (the [1.1.19](teacher-activity-authoring.md) surface, re-sectioned) | `/teacher/activities/*` |
| **Insights** | **One** analytics home with sub-views: *Overview* (KPIs) · *Ask the data* (chat) · *Reports* (per group/session) | unifies `/teacher/insights` + `/teacher/analytics` + `/teacher/reports/*` |
| **Settings** | Teacher account + **defaults** (default language, default interaction style, default voice mode) so per-activity config inherits sane defaults | (new — currently no home for teacher-level defaults) |

### 2. The teacher design system (parity with the student UI)

A small set of primitives under `frontend/src/components/teacher/ui/`, each a thin Radix/Tailwind composition, so every page speaks one language:

| Primitive | Job |
|---|---|
| `TeacherPage` | Consistent page header (title + breadcrumb + primary action slot) + max width + spacing |
| `SettingsSection` | A titled, optionally-collapsible group of settings with a one-line description |
| `SettingRow` | `label · control · help/aside` — the atom every config renders as (so a new config is one row) |
| `AdvancedDisclosure` | The collapsible "Advanced" container — the progressive-disclosure mechanism (below) |
| `TeacherCard` | The card used for classes, activities, groups, reports — one card, not five |
| `EmptyState` | The single designed empty/first-run state (Axiom 5/11) |
| `StatPill` / `KpiCard` | Reuse/generalise the existing insights atoms across all surfaces |

### 3. Progressive disclosure — **the rule that keeps it simple as features grow**

This is the governing pattern and the direct answer to "a mess of configs as we add them." Every config is tiered:

- **Essential** (always visible): the 3-concept happy path. For an activity: *name · language · level · lesson goal*. For a class: *name · group codes*. A teacher who touches nothing else gets a working result (Axiom 3).
- **Advanced** (collapsed by default, in an `AdvancedDisclosure`): everything else — workbench type, checklist, quiz, materials/curriculum, **interaction persona** (1.1.20), **voice mode** (1.1.23), **TTL** (1.1.10), **budget** (1.1.9), consent. Visible in one click, never in your face.

**The governance rule (write it into the `mcp-app-artefact`/design-doc conventions):** *a new teacher config defaults to an Advanced `SettingRow` in the relevant `SettingsSection`. It is promoted to Essential only with an explicit reason.* This means the next probe's config slots in **without** enlarging the default surface — the simplicity is structural, not maintained by willpower.

### 4. Refactor the class-detail kitchen sink

`classes/[id]/page.tsx` (716 LOC) becomes a `TeacherPage` composing:

```
Class: 7B
  ▸ Roster & group codes        (SettingsSection — Essential)
  ▸ Lessons / activities         (SettingsSection — Essential)
  ▾ Class settings               (SettingsSection)
      Essential:  default language · default interaction style
      Advanced ▸  voice mode · TTL · budget · consent · audio-capture toggle
  ▸ Recent activity + export     (SettingsSection — links into Insights › Reports)
```

`ClassVoiceSettingsPanel` (215 LOC) collapses into one `SettingRow` group inside *Class settings › Advanced*, alongside the future TTL/budget rows — instead of a standalone bolted-on panel.

### 5. Activity builder — a coherent section model, not stub tabs

Replace `goal | parameters(stub) | code(stub) | history(stub)` with disclosure-tiered sections in one scroll (or two honest tabs: **Build** + **History**):

```
Build
  Essential:  Name · Language · Level (A/B/C) · Lesson goal (Socratic prompt)
  Advanced ▸  Teaching style (persona 1.1.20) · Workbench type
              Checklist · Quiz · Materials (curriculum cite) · Voice mode
History  (real session history; drop the placeholder "code" tab or gate it clearly)
```

Every 9-June builder addition (1.1.19 M1–M8, personas, voice) lands as an **Advanced `SettingRow`/section** — so the builder absorbs the whole breadth roadmap without becoming a wall.

### 6. Consolidate the three analytics surfaces

`/teacher/insights` becomes the shell with three sub-views (tabs or segments), each the existing code re-homed:
- **Overview** — the KPI dashboard (KpiStrip, EngagementBar, CrossClassTable) — the "start here."
- **Ask the data** — `_AnalyticsChat` (the chat-to-the-data path).
- **Reports** — the per-group/session report (`reports/groups/[id]`), reached from a class's Recent-activity or an Insights list.

One mental model ("Insights"), three lenses — not three top-level routes.

## Migration

- **Phased, each independently shippable** (see Phasing) — no big-bang rewrite. Build the design-system primitives first; refactor one page at a time onto them.
- Routes: `/teacher/analytics` and `/teacher/reports/*` become sub-routes/redirects under `/teacher/insights` (keep redirects so existing links/bookmarks survive).
- No data migration (frontend-only).
- Rollback per phase: the primitives are additive; a page refactor can revert independently.

## Phasing

| Phase | Deliverable | Est | Independent value |
|---|---|---|---|
| **P1** | Teacher design system primitives (`TeacherPage`, `SettingsSection`, `SettingRow`, `AdvancedDisclosure`, `EmptyState`, `TeacherCard`) + Storybook/vitest | ~1.5d | New config can already use the pattern |
| **P2** | Primary nav + IA shell (the four destinations) | ~1d | Features become discoverable immediately |
| **P3** | Class-detail refactor onto sections + tiered settings | ~1.5d | Kills the worst kitchen-sink; unblocks clean per-class config for 1.1.9/1.1.10/1.1.23 |
| **P4** | Activity-builder section model (Essential/Advanced) | ~1.5d | Gives 1.1.19 M1–M8 + personas + voice a coherent home |
| **P5** | Insights consolidation (Overview/Ask/Reports) | ~1.5d | One analytics home |

**Sequencing insight:** P1+P3+P4 ideally land **before (or alongside) the config-heavy 9-June rows** (personas, voice modes, TTL, budget, quiz/materials). If those features ship into the *old* surface first, they add to the mess and then get refactored twice. Doing the pattern first means each new config lands clean. At minimum, **P1 (the primitives) should precede the 9-June config rows** so they have somewhere good to go.

## Testing strategy

- **Frontend (vitest):** each primitive (render, collapsed/expanded disclosure, empty state); nav active-state + routing; refactored class-detail renders the same data as before (snapshot/behaviour parity); insights sub-view routing + redirects from old routes.
- **Visual/manual (LOCAL_MODE):** teacher walkthrough — sign in → nav to each destination in ≤2 clicks → create an activity touching only Essential config → expand Advanced → set a class voice/TTL → view a report from Insights. Verify mobile/narrow viewport (the teacher surface should also work on a tablet).
- **Bundle check:** CI asserts the student bundle is unchanged (teacher routes code-split).
- **A11y:** nav + disclosures keyboard-navigable; `SettingRow` label/control association.

## Open questions

- **Q1 — nav shape: → ANSWERED (M, 2026-06-09): BY BREAKPOINT.** **Left rail on desktop (≥ md), bottom bar on tablet/phone (< md)** — one adaptive nav, matching the dual reality of planning on a laptop and glancing in class on a tablet. See the IA section, which is now the spec.
- **Q2 — Settings destination scope:** do teacher-level **defaults** (default language/persona/voice) ship now (so per-activity inherits) or later? Recommend the *container* now, populate defaults as each config doc lands.
- **Q3 — should this gate the 9-June config rows? → ANSWERED (M, 2026-06-09): YES — "in place first before we add more complexity to it."** P1 (primitives) + the class-detail (P3) and builder (P4) refactors land **before** the config-heavy rows (personas 1.1.20, voice 1.1.23, TTL 1.1.10, budget 1.1.9, quiz/materials 1.1.19 M2–M8) so each new config slots into the pattern, not the old mess. This makes 1.1.26 a **hard prerequisite**, not a soft one — see the gating note in [SEQUENCE.md](SEQUENCE.md).
- **Q4 — A2UI vs React for teacher config:** how much of the builder/settings is declarative A2UI vs bespoke React? Align with [teacher-activity-authoring](teacher-activity-authoring.md); resolve before P4.
- **Q5 — extend Axiom 11 wording** to explicitly cover teacher surfaces? (Small `product-axioms.md` edit; M to approve.)

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Refactor churn collides with in-flight 9-June config work | Medium | Phase it; ship P1 primitives first so new config targets the pattern, not the old page; refactor pages one at a time |
| "Consolidation" balloons into a redesign | Medium | Explicit non-goal: reuse existing tokens; IA + componentisation only, no new look |
| Hidden behaviour in the 716-LOC class page lost in refactor | Medium | Behaviour-parity vitest snapshot before/after; refactor section-by-section |
| Progressive disclosure hides config teachers need often | Low | Essential/Advanced tiering is data-driven and revisable; promote a row to Essential if pilot shows it's frequent |

## Success criteria

- [ ] Persistent primary nav; any surface reachable in ≤2 clicks (no deep-link knowledge).
- [ ] Teacher design-system primitives shipped + used by ≥2 refactored pages.
- [ ] `classes/[id]/page.tsx` decomposed into `SettingsSection`s, each <120 LOC; `ClassVoiceSettingsPanel` folded into tiered Class settings.
- [ ] Activity builder uses Essential/Advanced sections; placeholder stub tabs removed or honestly gated.
- [ ] Insights unifies Overview + Ask-the-data + Reports; old routes redirect.
- [ ] A new config demonstrably adds as a single `SettingRow` (prove it by landing one 9-June config — e.g. interaction-style — through the pattern).
- [ ] Student bundle unchanged; teacher routes still code-split.
- [ ] `npm run quality:check` green; a11y checks pass.

## Related documents

- [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) — the shipped teacher surface this consolidates
- [student-lesson-view.md](../v1.0.0-pilot/implemented/student-lesson-view.md) — the simplicity/quality bar to match
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — the builder this re-sections; its M1–M8 land as Advanced sections
- [tutor-personas.md](tutor-personas.md) · [bidirectional-voice-brief.md](bidirectional-voice-brief.md) · [teacher-choice-ttl.md](teacher-choice-ttl.md) · [cost-dashboard.md](cost-dashboard.md) — config rows that should land *into* this pattern, not the old surface
- [product-axioms.md](../../../product-axioms.md) — Axiom 11 (USABLE BY DESIGN); Q5 proposes extending its wording to teacher surfaces
- `frontend-design` skill — the build-time design-quality reference when these phases are implemented
