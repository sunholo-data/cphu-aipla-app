---
name: guide-maintenance
description: >-
  Keep the AIPLA user-facing how-to guides (docs/guides/) up to date and in sync
  with the product. Use when the user says "update the guides", "regenerate /
  republish the guides", "the guides are stale / out of date", "re-capture the
  guide screenshots", "add a new guide", or mentions "guide-staleness" — and
  also proactively when a change lands on a UI surface a guide documents (the
  teacher class/activity/materials/co-pilot flows, the student join/workspace,
  or the researcher views). Covers the full pipeline: render, screenshot capture
  on deployed dev, publish into the app, seed the in-product corpus + onboarding
  tutors, and the staleness check.
---

# Guide maintenance

The AIPLA how-to guides live in `docs/guides/` (Quarto `.qmd` → PDF + HTML) with
real screenshots. They are surfaced three ways: the in-app **`/guides`** page,
direct links (teacher sidebar, student join/lessons, landing), and — dogfooded —
as **queryable tutors** in an "AIPLA onboarding" class grounded in the guide PDFs.

**Reference of record:** [docs/guides/README.md](../../../docs/guides/README.md).

## The guide set

| Slug | Audience | Documents |
|---|---|---|
| `t1-set-up-a-class` | Teacher | Create a class, mint group codes, share |
| `t2-create-your-first-activity` | Teacher | The activity builder (goal, workspace, preview) |
| `t3-add-curriculum-materials` | Teacher | The Materials section (browse/upload/cite/organise) |
| `t4-author-with-the-copilot` | Teacher | The authoring co-pilot ("Medbygger") |
| `s1-join-and-use-your-tutor` | Student | Anonymous group-code join → tutor + workspace |
| `r1-researcher-onboarding` | Researcher | Cross-teacher views + rubric experimentation |

The map from each guide to the code it documents is
[docs/guides/guide-surfaces.json](../../../docs/guides/guide-surfaces.json) — the
staleness check reads it, so keep it current when a guide's subject moves.

**Danish versions.** The teacher + student guides (T1–T4, S1) have Danish
counterparts `docs/guides/<slug>.da.qmd` (render to `<slug>.da.{html,pdf}`, auto
-published by the same glob). They reuse the English screenshots. Terminology +
the "keep on-screen English labels as-is" rule live in
[docs/guides/da-glossary.md](../../../docs/guides/da-glossary.md). When you change
an English guide, update its `.da.qmd` alongside it (they document the same
surfaces, so the staleness check flags the English slug). The `/guides` page
links Danish as primary + English secondary for these; R1 is English-only.

## The pipeline (make targets)

Run from the repo root. Order matters: capture → publish → (seed).

| Command | What it does |
|---|---|
| `make guide-staleness` | **Start here.** Flags guides whose documented UI changed after the guide. Heuristic — a prompt to look. |
| `make guide-screens` | Re-capture screenshots. Logs into **deployed dev** as the test teacher (Playwright) for the teacher guides, and joins with the demo code for the student guide. Writes `docs/guides/assets/*.png`. |
| `make guides` | Render `.qmd` → PDF + HTML into `docs/guides/_output/`. Needs `quarto` + `xelatex`. |
| `make guides-publish` | `make guides` + copy HTML/PDF into `frontend/public/guides/` (committed; the app serves them). |
| `make seed-guide-corpus` | Ingest the guide PDFs into the **shared corpus** (subject "AIPLA guides") + build the onboarding class with teacher/student/researcher tutors. Dogfoods the guides. **Not idempotent** — re-running duplicates; clean up first on an already-seeded env. |

**Typical "the guides drifted" loop:** `make guide-staleness` → for each flagged
guide, look at the change → if a real workflow changed, `make guide-screens &&
make guides-publish`, then commit the refreshed `assets/` + `public/guides/`. The
committed PNGs mean the guides render without a capture run; re-capture only when
the UI actually changed.

## Adding a new guide

1. Write `docs/guides/<slug>.qmd` (copy an existing one — same voice: English,
   task-focused, callouts, screenshot per step, cross-links). Reference each
   screenshot as `assets/<tag>-NN-name.png` (tag = `t5`, `s2`, …).
2. Add the guide → surfaces it documents in `docs/guides/guide-surfaces.json`.
3. Add it to the `/guides` page: `frontend/src/app/guides/page.tsx` (the right
   audience array).
4. If it should be queryable, add it to `scripts/seed-guide-corpus.mjs` (the
   `GUIDES` array + a tutor activity if a new audience).
5. Capture its screenshots: add shots to the capture script for its surfaces
   (`docs/guides/screenshots/capture.mjs` for teacher/researcher,
   `capture-student.mjs` for student), then `make guide-screens && make guides-publish`.

## Capture internals

- Teacher/researcher shots: `docs/guides/screenshots/capture.mjs` — logs into the
  deployed dev frontend as `test-teacher@example.dk`, drives the section tabs,
  clips to the viewport, hides dev chrome, and (for the "activity created" shot)
  creates + soft-deletes a throwaway activity. Subset re-runs: `ONLY=` / `SKIP=`.
- Student shots: `capture-student.mjs` — anonymous group-code join (`GROUP=`,
  default `aipla-demo-1`), no login.
- Placeholders: the guides render even before capture because missing screenshots
  are filled with labelled placeholder PNGs (the capture overwrites them with
  real ones).

## Gotchas

- **Researcher screenshots use a dedicated account.** R1's surfaces need the
  `role:researcher` claim. A dedicated **`test-researcher@example.dk`** account
  exists (uid `yZ4TjBAf5KOYALqVNZ8i5tpO5mt2`) and has been granted the claim on
  dev; `capture-guide-screens.sh` runs a **researcher pass** that auto-detects it
  (probes `scope=all`) and captures the R1 shots. Re-provisioning a fresh env?
  Grant it there too (`aiplatform users grant-researcher <uid>`) — and note the
  backend SA needs `roles/firebaseauth.admin` for that endpoint to work, else it
  500s (`InsufficientPermissionError`); see `docs/design/aipla/v1.1.0-feedback/researcher-role.md`.
- **The co-pilot converses before it proposes** (and its UI is Danish). The
  capture nudges it directively and answers follow-ups until a proposal card
  appears — see `copilotPropose()` in `capture.mjs`.
- **`make guide-screens` touches shared dev.** It logs in as the test teacher and
  creates/deletes a throwaway activity (cleanup needs a minted token, handled by
  the wrapper). Don't point it at test/prod.
- **Repo weight.** `frontend/public/guides/` holds self-contained HTML (embedded
  screenshots) + PDFs (~2–3 MB per guide). If this grows, move rendered guides to
  GCS or generate at build time rather than committing.
- **Re-seeding an already-seeded env** duplicates the corpus docs + onboarding
  class. Delete the prior docs/activities (curriculum + activity DELETE routes)
  before re-running `make seed-guide-corpus`, or do a targeted add for just the
  new guide.
