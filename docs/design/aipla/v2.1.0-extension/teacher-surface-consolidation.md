# The teacher surface, reviewed — fewer places, one rule for who sees what

**Status**: **SHIPPED prod v0.1.60, 2026-09-21** (dev the same morning) — 1.1.125, M0–M3 in sprint [TEACHER-IA-1](teacher-surface-consolidation-sprint.md) (`b9d911da` nav + account menu · `39503946` research tree retired, Conversations under Insights · `d799db95` one copilot entry). The two decisions below are still open — Approaches ships with BOTH entries until JB/AR prune one; the demo-class content is AR's
**Priority**: **P1** — the same signal three times in a month (*"teachers find the UI difficult"*), and the surface has grown by accretion: every feature since June added a page, a tab, a scope toggle or a copilot where it was convenient. Nothing was ever removed
**Estimated**: **~2.5–3d after 1.1.123 + 1.1.124**, mostly removals (M0 nav ~0.5d · M1 retire the parallel research tree ~0.5d · M2 Insights absorbs Conversations + Cost ~0.5d · M3 one copilot entry ~1d · guides + tests ~0.5d). Two decisions needed first, below
**Scope**: Frontend information architecture — `TeacherNav`, the `/teacher/research/*` tree, `/teacher/settings`, the five copilot mounts. Backend — nothing required; one optional tidy noted
**Source**: M, 2026-09-21: *"we have been adding features as we think of them, now we can review and plan it out"*; JB, 2026-09-19 (the request that prompted the review)
**Related**: [1.1.123](researcher-acts-for-teacher.md) and [1.1.124](teacher-onboarding-scaffold.md) (the first two moves inside this map — do them first, they make M1 possible) · [1.1.96](../v1.1.0-feedback/teacher-ui-friction-telemetry.md) · [1.1.86 activity-builder ergonomics](../v1.1.0-feedback/activity-builder-ergonomics.md) · [1.1.108 content-localisation](../v1.1.0-feedback/content-localisation.md) (every string this moves is a string to extract) · [plan-2026-09-to-2027-04.md](plan-2026-09-to-2027-04.md) workstream C

## Inventory, 2026-09-21

**Pages under `/teacher`: 16.** Nav destinations: **7 for a teacher, 10 for a
researcher** (plus a Cost tab and two scope toggles only a researcher sees).
**Copilots: 5**, each a different skill mounted on a different page.
**Backend: 137 routes across 30 router files** — not a user-facing problem,
noted at the end.

| Area | Pages | What a teacher sees | What a researcher additionally sees | How access is scaled |
|---|---|---|---|---|
| Classes | `/classes`, `/classes/[id]` | own classes, Manage | scope **All** toggle, owner column | ✅ **one surface, scope toggle** |
| Activities | `/activities`, `/activities/[id]`, `/activities/new` | own library + shared catalogue (adopt) | — | (own + published only) |
| Research | `/research/activities`, `/research/activities/[id]` | — | every activity, every state, **read-only detail** | ❌ **a parallel tree** — a second list and a second detail page for the same collection |
| Approaches | `/research/frameworks` | own custom approaches | the seven literature approaches, editable; tutor copilot | ✅ one surface, privilege-scaled — but filed under `/research/` although every teacher has it |
| Conversations | `/research/logs` | — | every transcript, grouped by approach | researcher-only page |
| Materials | `/materials` | own uploads, shared corpus | share-to-library switch | ✅ one surface |
| Insights | `/insights`, `/insights/cost` | cross-class KPIs (own) | Cost tab | ✅ tabs, privilege-scaled |
| Reports | `/reports/groups/[groupId]` | per-group transcript + narrative | same | one surface |
| Programme | `/programme` | — | register (read) / programme admin (write) | ✅ **one surface, privilege-scaled** — the reference pattern |
| Settings | `/settings` | defaults card + *"everything else lives where it applies"* | judge-lens panel | a nav slot spent on a page that points elsewhere |
| Home | `/teacher` | redirect to Classes | — | nothing |

**Three ways to reach a transcript** (class page → recent sessions → report;
Conversations → inline; the analytics copilot on the class page). **Three
views of activities for a researcher** (own library, shared catalogue,
Research scan) where a teacher has two. **Five copilots** — `aipla-help`
(global), `manage-class` (class list), `analytics-chat` (class page *and*
Insights), `activity-authoring-assistant` (builder), `tutor-authoring-assistant`
(Approaches) — each with its own panel and its own idea of what it can do.

### The pattern that worked, and the one that did not

Where a feature was added as **the same surface, scaled by scope or
privilege** — Classes' All toggle, Programme's read/write, Insights' Cost
tab, Materials' share switch — the result is one place to learn and one
place to maintain. The `/teacher/programme` header comment states the rule:
*"Read-only and write are the SAME surface at different privilege levels …
two surfaces would drift."*

Where a feature was added as **a parallel place** — the `/research/*` tree —
it drifted exactly as predicted. Research → Activities is a read-only copy of
the library whose *read-only* claim has been false since June (1.1.123);
Approaches was moved under `/research/` when it was researcher-only and
stayed there after 1.1.110 gave it to every teacher; and the nav needed a
`match` narrowing hack because two entries shared the prefix.

**The one rule this review adopts: one surface per resource, scaled by scope
and privilege. No parallel trees.** A researcher is a teacher with two extra
switches, not a second product.

## Target map

```
Teacher nav (5)          Researcher sees the same 5, plus:
────────────────         ──────────────────────────────────────────
Classes                  · scope All · stage column (1.1.124 M0)
Activities               · scope All (replaces Research → Activities)
Materials                · share-to-library (as today)
Insights                 · tabs: Overview · Conversations · Cost
Guides                   · researcher guide appears in the list
                         + Programme  (register; the one extra destination)

Account menu (header, not nav): Settings · Approaches · Sign out
Home (/teacher): the getting-started card (1.1.124 M1) → then Classes
One "Ask AIPLA" entry, page-aware (M3)
```

Pages: 16 → **13** (retire the two Research → Activities pages; Conversations
moves under Insights; Settings leaves the nav but keeps its URL). Nav: 7/10 →
**5/6**. Copilot entry points: 5 → **1**, still five skills underneath.
**All three numbers are what shipped on 2026-09-21.**

### What moves where, and why

- **Research → Activities is retired.** After 1.1.123 the library in scope
  All *is* this page, with the editor as its detail (banner: *"editing X's
  activity as a researcher"*). Two pages, one hook and one test file go.
- **Conversations becomes an Insights tab.** *"What did students say to the
  tutor"* is an insight; the only reason it is a top-level destination is
  that the researcher tree was where researcher things went. It keeps its
  approach grouping and inline transcript unchanged.
- **Approaches leaves the nav.** Every teacher has it (1.1.110), but it is
  visited when choosing a class's tutor, not daily. Two candidates, **decision
  needed** (below): the account menu, or a link from the class page's Tutor
  setting (*"the tutor's approach → edit approaches"*). The URL stays.
- **Settings leaves the nav.** It is a defaults card and a signpost. The
  account menu is where a teacher expects it.
- **Programme stays**, as the researcher's one extra destination — the
  pattern to copy, not to fold.
- **Home stops being a redirect.** 1.1.124's checklist gives it a job; once
  the teacher is live it collapses to a one-line status above Classes.

### M3 — One way to ask for help · ~1d · ✅ shipped

The five copilots stay five skills — each is prompt-engineered for its
surface, and `analytics-chat`'s tools are not `activity-authoring-assistant`'s.
What changes is the **entry**: one button, one panel, and the skill chosen by
the page (`pathname` → skill, the same map the nav already keeps). The
`activity-copilot-shared-shell-migration` already put them on one shell; this
finishes it. The teacher learns one gesture. Mark's *"the AI Copilot should
help"* becomes true when there is one copilot to find.

Gate: 1.1.124 M3 (stage as copilot context) lands first, so the single entry
answers *"how do I start?"* correctly on day one.

## Decisions this needs

1. **Approaches — account menu or class-page link?** JB/AR, because it is
   about how a *teacher* is meant to think of an approach: an account-level
   preference, or a property of the class's tutor. Recommendation: **the
   class page** (it is where the tutor is chosen), with the researcher's
   editing of the seven reached from the same page. One decision, ~0 cost
   either way.
2. **Does the demo class teach the right thing?** It is the most-read
   onboarding surface (1.1.124) and its content is seed data nobody has
   reviewed since July. AR to look at it once. Not code.

## Sequencing inside workstream C

```
1.1.123 M0–M2  researcher edits          ~1.5d   ← unblocks M1 here
1.1.124 M0–M1  stage column + checklist   ~1.25d
1.1.125 M0     nav + account menu         ~0.5d
1.1.125 M1     retire research tree       ~0.5d
1.1.125 M2     Insights tabs              ~0.5d
1.1.124 M2–M3  ready class + copilot ctx  ~0.75d
1.1.125 M3     one copilot entry          ~1d
guides r1/t1–t4, both languages           ~0.5d   (guide-maintenance)
                                          ─────
                                          ~6.5d
```

Fits C's *"~10 days, teacher-sourced, surfaces that exist"* with 1.1.86 and
the Danish sweep alongside, at the cost of 1.1.78 moving behind it unless the
November teacher date is confirmed. Good pairing material for AD in October:
bounded, mostly deletion, and every step is verifiable in the browser.

## Guards

- `route-chrome-coverage.test.ts` and `make check-guides` already fail on a
  moved page that loses its chrome or its guide link; M1/M2 add redirects
  from the retired URLs (the guides and JB's mail both link them).
- **New:** a test that every `TeacherNav` destination's `match` prefixes are
  disjoint — the reason the narrowing hack exists, made structural.
- Every string moved is written into a `copy` object, never re-inlined
  (1.1.108 M4).

## Backend note — optional, not user-facing

`checklist_progress`, `table_progress`, `writing_progress`,
`concept_progress` are four routers of two routes each with the same shape
(save + load per activity element). One `element_progress` router keyed by
element type would remove three files and three test scaffolds. Worth doing
only when the next element arrives (1.1.78 question-set is that moment), not
as a tidy-up on its own.
