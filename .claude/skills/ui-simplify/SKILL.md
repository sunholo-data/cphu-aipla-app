---
name: ui-simplify
description: Judge and reduce how busy and hard to navigate an AIPLA screen is, for teachers and researchers without a tech background — one primary action per screen, fewer visible choices with sensible defaults, progressive disclosure, icon-plus-word navigation, plain copy with one term per concept, first-run and empty states that say what to do next. Vendors four Impeccable references (distill, clarify, onboard, critique). Use when the user says a screen is "hard to find things on", "too much text", "too busy", "simplify", "declutter", "needs icons", "make it easier for teachers", when planning or mocking up a UI simplification sweep, when reviewing the activity builder/wizard, or when rewriting UI copy. Pairs with ui-guidelines-check, which covers accessibility and form mechanics but not busyness.
---

# UI simplify

The judgement `ui-guidelines-check` deliberately leaves out: **is this screen too
much, and can a teacher who is not technical find the next thing to do?**

Four reference files are vendored, unmodified, from
[Impeccable](https://github.com/pbakaus/impeccable) (Apache 2.0, `LICENSE` here),
pinned at commit `b4bff1626c344067788c2679f048a20057c7cc5a` (skill v4.8.2,
fetched 2026-11-12). Only the references are vendored; Impeccable's launcher,
binary detector, hooks and PRODUCT.md/DESIGN.md context are **not**, on purpose:
a hook that runs on every UI edit is not something to add to a shared checkout
without a decision. To update, re-fetch the four files at a newer commit and
change the SHA above.

| Reference | Use it for |
|---|---|
| [reference/distill.md](reference/distill.md) | Cutting a screen to its one job: what to remove, hide behind "More options", merge, or default |
| [reference/clarify.md](reference/clarify.md) | Labels, help text, errors, empty/loading states, one term per concept |
| [reference/onboard.md](reference/onboard.md) | First run, getting a teacher to a first working activity, empty states |
| [reference/critique.md](reference/critique.md) | Scoring a screen: read **Cognitive Load Assessment**, **Heuristics Scoring Guide** and the persona sections only |

## How to apply them here

Each reference ends with "hand off to `/impeccable polish`" and critique asks for
`impeccable detect`, `critique-storage` and an overlay. **None of that exists in
this repo** — skip those steps without a degraded banner, and use
`ui-guidelines-check` as the closing pass instead. Where a reference says to read
PRODUCT.md, the product context is below.

### Product context (stands in for PRODUCT.md)

- **Who:** Danish upper-secondary (stx) physics teachers, many not technical, on a
  laptop between lessons; researchers in the KU programme; students aged ~16–19
  (student surfaces have their own rule: usability is hard-fail, design first).
- **Language:** Danish by default; every string through `useT()` in
  `frontend/messages/{da,en}/*.json`. Danish runs ~20–30% longer than English —
  design for the Danish length.
- **Look:** KU red as the one brand colour (`bg-primary` / `text-brand`), neutrals
  otherwise, Inter, the `components/ui` kit, lucide-react icons.
- **Never remove** a control a guard or a bug depends on (Undo after remove,
  "Try as student", the acting-for-owner banner, LoadError's Retry). Move it.

### AIPLA rules distilled from the references

1. **One primary action per screen**, in KU red. Everything else secondary or in ⋯.
2. **≤ 5 top-level navigation items; ≤ 4 visible choices at any decision point.**
   More than that goes behind "More options" / ⋯ with today's default kept.
3. **Icon plus word, never icon alone** for navigation and section choices. An
   icon-only button is allowed only for universal row actions (⋯, close, remove)
   and always has an `aria-label`. One icon set (lucide), one stroke weight.
4. **No intro that restates its heading.** Help text answers a question the
   teacher would actually have; otherwise delete it. Tile help ≤ ~8 words.
5. **Teacher words, not system words.** Keep the glossary in the sweep's audit doc
   and use one term per concept in both languages ("What students should learn",
   not "Lesson prompt"; "Use in this activity", not "Cite").
6. **Steps for a first-time flow, sections for editing.** Creating something new
   is a short stepped flow with progress ("Step 1 of 3") and a live preview;
   editing an existing thing keeps all sections reachable at once.
7. **Smart defaults over questions.** Prefill from context (class from the URL,
   name suggested from the goal) and let the teacher change it.
8. **Empty states say what goes here and give the action** — and a failed read is
   never an empty state (`LoadError`).

## Steps for a sweep

1. Map the surface as the teacher sees it: every step, control and paragraph,
   with `file:line` (an Explore agent does this well; ask for word counts and
   jargon).
2. Score it with critique's cognitive-load checklist and the first-timer persona.
3. Propose cuts with distill, copy with clarify, first run with onboard.
4. **Mock up before building** on the design canvas, and note per board where
   every moved control went ("nothing is removed").
5. Build; then `ui-guidelines-check` on the diff, `make check-i18n`, the frontend
   suite on CI's Node (`make test-frontend-ci-node`), and the guide-maintenance
   skill for the guides that document the surface.
