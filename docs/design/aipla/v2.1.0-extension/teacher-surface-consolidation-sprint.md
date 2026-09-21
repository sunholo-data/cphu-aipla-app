# Sprint Plan: TEACHER-IA-1 — fewer places, one rule (1.1.125 M0–M3)

## Summary

Sixteen pages, ten nav destinations for a researcher, five copilot entries, a
parallel `/research/*` tree that drifted. This sprint applies the one rule —
**one surface per resource, scaled by scope and privilege** — mostly by
removal, now that 1.1.123 and 1.1.124 have made the removals possible.

**Duration:** ~2.5–3d · **Scope:** Frontend IA · **Design doc:** [1.1.125](teacher-surface-consolidation.md)
**Builds on:** RSCH-EDIT-1 (the editor works for a researcher on any activity — so the read-only research detail is redundant) and RSCH-ONBOARD-1 (the checklist gives `/teacher/classes` its landing job).

## The two open decisions, and how this sprint proceeds without waiting

1. **Where Approaches lives.** Both options take it out of the nav; they differ
   only in its entry point. This sprint ships **both entries** — the account
   menu and a link beside the class page's Tutor setting — so JB/AR prune one
   rather than unblock one. Cost of doing both: a link.
2. **Demo-class content.** AR's; not code. Untouched here.

## Milestones

### M0 — Nav + account menu · ~0.5d
- [ ] `TeacherNav`: Settings and Approaches leave the destinations. Teacher nav = Classes · Activities · Materials · Insights · Guides.
- [ ] Header: the account area becomes a menu (avatar/email → Settings · Approaches · Sign out). The plain Sign out button folds into it.
- [ ] Class page, Tutor setting: an *Approaches* link (decision 1, option B).
- [ ] **New guard:** `TeacherNav.test.tsx` asserts every destination's `match` prefixes are pairwise disjoint — the reason the narrowing hack existed, made structural.

### M1 — Retire the parallel research tree · ~0.75d
- [ ] `/teacher/activities`: researcher scope toggle **My library / Research view** (the Classes pattern). Research view lists EVERY activity, owner-labelled, every state, each card linking to the editor (which says whose it is). Facets and the shared catalogue stay on the own view.
- [ ] `/teacher/research/activities` → redirect `/teacher/activities?scope=all`; `/teacher/research/activities/[id]` → `/teacher/activities/[id]`. `next.config` redirects (JB's mail and the guides link the old URLs). Pages, hook and tests deleted.
- [ ] Nav: the Research destination goes; Classes and Activities each carry their own All toggle.

### M2 — Insights absorbs Conversations · ~0.5d
- [ ] `/teacher/research/logs` moves to `/teacher/insights/conversations`; `InsightsTabs` = Overview · Conversations (researcher) · Cost (researcher). Redirect the old URL; `TutorCrossviewPanel`'s deep link updated.
- [ ] Nav: the Conversations destination goes. Researcher nav = the 5 + Programme.

### M3 — One way to ask for help · ~1d · attempted last, deferred if it does not fit
- [ ] One header button ("Ask AIPLA"); the shell owns the open state; the page chooses the skill (`pathname` → skill map) and the page's own copilot config (proposal parser + apply) is registered through a context so the shell can render it. Help is the fallback skill on pages without one.
- [ ] The five surfaces stop mounting their own floating pill.

## Guards
- `route-chrome-coverage.test.ts` (existing) — every surviving page keeps its chrome.
- `check-guide-nav` — guides still link into the app; r1/t1–t4 updated for the moved routes.
- Redirect test for each retired URL.

## Out of scope
Changing what Approaches *is* · the demo-class content · backend router consolidation (waits for 1.1.78).
