# Sprint Plan: TUI-1 — Teacher-UI consolidation P1 + P2

## Summary

Ship the **teacher design-system primitives** (P1) and the **by-breakpoint primary nav shell** (P2) from [teacher-ui-consolidation.md](teacher-ui-consolidation.md) (1.1.26). This is the hard-prerequisite container the config-heavy 9-June rows land into — so it must exist before personas/voice/TTL/budget/quiz UI is built.

**Duration:** ~2–2.5 days
**Scope:** Frontend only (no API/backend change)
**Dependencies:** none (additive component layer + shell change)
**Risk Level:** Low (additive primitives) → Medium (shell layout integration)
**Design Doc:** [teacher-ui-consolidation.md](teacher-ui-consolidation.md)
**Locked decisions:** nav = **by breakpoint** (left rail `≥ md`, bottom bar `< md`); progressive-disclosure config pattern (Essential vs Advanced).

## Current Status Analysis

### Recent velocity
- Team ships fast (249 commits / 14d; large daily LOC). This 2-milestone, ~1000-LOC frontend sprint fits comfortably in ~2–2.5d.

### Existing implementation (grounding — Explore sweep)
- **Tokens:** Tailwind + HSL CSS vars in `src/app/globals.css` (`--background/--foreground/--muted/--border/--primary` orange). Reuse via `bg-background`, `text-muted-foreground`, `border-border`.
- **No `components/ui/` layer yet** — UI is hand-rolled. Patterns to consolidate: `KpiCard.tsx` (card = `article.rounded.border.border-border.bg-background.p-3.shadow-sm`), `ClassVoiceSettingsPanel.tsx` (section header + `label.flex.flex-col.gap-1.text-sm` form rows), the dashed-border empty pattern.
- **Radix installed but NO collapsible** → `AdvancedDisclosure` uses native `<details>/<summary>` (already the codebase's disclosure idiom).
- **Shell:** `_TeacherClientShell.tsx` (client) — sticky header (logo→/teacher/classes + account + sign-out + LOCAL_MODE banner) + `max-w-6xl` main + `AppFooter`. **No nav, no `usePathname`, no breakpoint-switching nav exists.**
- **Routes:** `classes`, `insights`, `analytics` have index pages; **`activities`, `settings` do NOT** → nav needs minimal index pages for those (dogfoods primitives → satisfies "≥2 pages use the primitives").
- **Tests:** vitest + `@testing-library/react`, adjacent `__tests__/`, `@/` alias, `screen`/`fireEvent`, test-ids. No Storybook.

## Proposed Milestones

### Milestone M1 — Design-system primitives
**Scope:** frontend · **Goal:** the reusable teacher vocabulary every page/config uses.
**Estimated:** ~360 LOC impl + ~280 LOC tests = ~640 LOC · **Duration:** ~1.25d

**Components** (`frontend/src/components/teacher/ui/`):
- [ ] `TeacherCard.tsx` — card wrapper consolidating the `KpiCard` article pattern; optional header slot (~50)
- [ ] `EmptyState.tsx` — dashed-border first-run/empty state: icon + title + description + optional action (~55)
- [ ] `SettingRow.tsx` — the config atom: `label · control · help/aside`, label/control association (~55)
- [ ] `SettingsSection.tsx` — titled group + description + optional action; optionally collapsible (~70)
- [ ] `AdvancedDisclosure.tsx` — native `<details>` "Advanced" container, `defaultOpen` (~45)
- [ ] `TeacherPage.tsx` — page header (title + breadcrumb + actions slot) + spacing wrapper (~60)
- [ ] `index.ts` — barrel export (~10)
- [ ] vitest for each (render, props, disclosure open/close, a11y label assoc) (~280)

**Acceptance:**
- [ ] All 6 primitives render with token classes (no hard-coded colors); match student-UI spacing.
- [ ] `AdvancedDisclosure`/collapsible `SettingsSection` toggle open/closed (tested).
- [ ] `SettingRow` associates label↔control (htmlFor/id), tested.
- [ ] vitest green; `npm run quality:check:fast` (lint + typecheck) clean.

**Risks:** over-abstraction → keep props minimal, mirror existing patterns 1:1. Mitigation: each primitive is a thin wrapper of an already-shipped pattern.

### Milestone M2 — By-breakpoint nav shell
**Scope:** frontend · **Goal:** a persistent, device-adaptive primary nav; features discoverable in ≤2 clicks.
**Estimated:** ~230 LOC impl + ~170 LOC tests = ~400 LOC · **Duration:** ~1d

**Tasks:**
- [ ] `TeacherNav.tsx` — 4 destinations (Classes/Activities/Insights/Settings) with `usePathname` active highlight; renders **left rail at `md:flex`** + **bottom bar at `md:hidden`** (~120)
- [ ] Integrate into `_TeacherClientShell.tsx` — keep header; desktop = flex row `[rail | main]`; mobile = `main` + sticky bottom bar; preserve auth gate + AppFooter + LOCAL_MODE banner (~60)
- [ ] `app/teacher/activities/page.tsx` — minimal index using `TeacherPage` + `EmptyState` + link to `/new` (~30)
- [ ] `app/teacher/settings/page.tsx` — minimal placeholder index using `TeacherPage` + `EmptyState` (~25)
- [ ] vitest: `TeacherNav` (4 links, active state by pathname, rail+bar both present); index pages render; shell smoke (~170)

**Acceptance:**
- [ ] All 4 destinations reachable from the nav; active route highlighted (tested via `usePathname` mock).
- [ ] Rail present at `≥ md` (`md:flex`), bottom bar present at `< md` (`md:hidden`) — asserted by class presence.
- [ ] `/teacher/activities` and `/teacher/settings` no longer 404; both render via primitives (≥2-pages criterion met).
- [ ] Existing header (account/sign-out/LOCAL_MODE) + auth gate + footer still work.
- [ ] vitest green; `npm run quality:check:fast` clean.

**Risks:** shell layout regression (auth gate / footer). Mitigation: keep the auth-gate + loading branches untouched; only restructure the authed return; add a shell smoke test.

## Day-by-Day Breakdown

### Day 1 — M1 primitives
- Scaffold `teacher/ui/` + 6 primitives + barrel (TDD: test → component each).
- Checkpoint: all primitives + tests green; quality:check:fast clean.

### Day 2 — M2 nav shell
- `TeacherNav` (rail + bottom bar) + tests; integrate into `_TeacherClientShell`.
- Minimal `activities` + `settings` index pages on the primitives.
- Checkpoint: nav reachable both viewports; 4 destinations; no 404; full vitest + quality:check green.

## Success Metrics
- [ ] 6 primitives shipped + barrel; each vitest-covered.
- [ ] By-breakpoint nav (rail `≥md` / bottom bar `<md`); 4 destinations; active highlight.
- [ ] ≥2 pages built on the primitives (activities + settings index).
- [ ] `npm run quality:check` green (lint + typecheck + vitest + build); student bundle unaffected (teacher routes code-split under `/teacher`).
- [ ] No backend/API change.

## Out of scope (later phases)
- P3 class-detail refactor · P4 builder section model · P5 insights consolidation — these re-home existing pages onto this pattern and are separate sprints.
