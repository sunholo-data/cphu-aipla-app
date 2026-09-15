---
name: guide-maintenance
description: >-
  Keep the AIPLA user-facing how-to guides (frontend/content/guides/) up to date
  and in sync with the product. Use when the user says "update the guides", "the
  guides are stale / out of date", "re-capture the guide screenshots", "reprint
  the guide PDFs", "add a new guide", or mentions "guide-staleness" — and also
  proactively when a change lands on a UI surface a guide documents (the teacher
  class/activity/materials/co-pilot flows, the student join/workspace, or the
  researcher views). Covers the full pipeline: the markdown that IS the page,
  screenshot capture on deployed dev, printing the PDFs, seeding the in-product
  corpus + onboarding tutors, and the staleness check.
---

# Guide maintenance

The AIPLA how-to guides are **app pages** since 1.1.116: the prose lives in
`frontend/content/guides/<slug>.md` and renders at `/guides/<slug>` with the
app's chrome, typography and rail. There is no Quarto, no LaTeX and no render
step — editing the markdown ships the guide.

They are surfaced three ways: the in-app **`/guides`** index, direct links
(teacher sidebar, student join/lessons, landing), and — dogfooded — as
**queryable tutors** in an "AIPLA onboarding" class grounded in the guide PDFs,
which are now *printed from the pages* (`make guides-pdf`, Playwright).

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
| `r2-propose-a-simulation` | Researcher / physics staff | Specify a new simulation precisely enough to be built |

The map from each guide to the code it documents is
[docs/guides/guide-surfaces.json](../../../docs/guides/guide-surfaces.json) — the
staleness check reads it, so keep it current when a guide's subject moves.

**Danish versions.** The teacher + student guides (T1–T4, S1) have Danish
counterparts `frontend/content/guides/<slug>.da.md`, served at
`/guides/<slug>.da` and reachable from the language switch at the top of the
English page. They reuse the English screenshots. Terminology + the "keep
on-screen English labels as-is" rule live in
[docs/guides/da-glossary.md](../../../docs/guides/da-glossary.md). R1 and R2 are
English-only.

⚠️ `lang:` in the front matter and the `.da` in the filename must agree —
`make check-guides` fails if they don't, because a mismatch makes the language
switch link a guide to itself.

**Two derived artefacts move with the guides — `make guide-staleness` flags both:**

- **The Danish versions** — when an English `<slug>.md` changes, update its
  `<slug>.da.md` to match (the check flags a `.da.md` older than its source).
- **The `aipla-help` help co-pilot** — its how-to knowledge is embedded in
  `backend/skills/templates/aipla-help/SKILL.md` (a snapshot, not RAG). When a
  guide's *content* changes, refresh that skill's instructions and re-register:
  `make seed ENV=dev`. The help bot is the floating **"Hjælp"** panel (header
  button) on every teacher/researcher surface; flag `NEXT_PUBLIC_AIPLA_HELP`.

## The pipeline (make targets)

Run from the repo root. Order matters: capture → publish → (seed).

| Command | What it does |
|---|---|
| `make guide-staleness` | **Start here.** Flags guides whose documented UI changed after the guide. Heuristic — a prompt to look. |
| `make guide-screens` | Re-capture screenshots. Logs into **deployed dev** as the test teacher (Playwright) for the teacher guides, and joins with the demo code for the student guide. Writes `frontend/public/guides/assets/*.png` — one copy, served straight to the page. |
| `make check-guides` (= `make guides`) | The CI gate: front matter, a `.da.md` with no English source, a lang/filename disagreement, a missing screenshot, a review past its deadline. |
| `make guides-pdf` | Print each guide PAGE to `frontend/public/guides/<slug>.pdf` with Playwright. Needs a running app — deployed dev by default, `BASE_URL=http://localhost:3456` for a local one. |
| `make seed-guide-corpus ENV=dev\|test\|prod` | Ingest the guide PDFs into that env's **shared corpus** (subject "AIPLA guides") + build the onboarding class with teacher/student/researcher tutors. Dogfoods the guides. **Idempotent** since 2026-08-04 — re-running is how you publish an updated guide. |

**Typical "the guides drifted" loop:** `make guide-staleness` → for each flagged
guide, look at the change → edit `frontend/content/guides/<slug>.md` (and its
`.da.md`) → `make guide-screens` if the UI moved → ship → `make guides-pdf` once
the new pages are deployed → commit `public/guides/`. The page updates with the
markdown; only the PDF needs the print run.

### Why there is no nav band any more (1.1.74 → 1.1.116)

Quarto emitted self-contained HTML with **zero** links back into the app, so a
guide opened from `/guides` was a dead end: unrelated typography, no AIPLA mark,
no way back — on the first surface a new teacher is pointed at. `publish-guides.sh`
injected a KU-red band to paper over it, and CI asserted the band survived each
re-render.

The guides are app pages now, so the chrome, the rail and the way back are
structural. `inject-guide-nav.py` and `check-guide-nav` are gone; the CI slot
they held is now `check-guides`, which gates the content instead.

**The old URLs still resolve:** `next.config.mjs` permanently redirects
`/guides/<slug>.html` → `/guides/<slug>`, because people downloaded and mailed
those links around.

## Adding a new guide

1. Write `frontend/content/guides/<slug>.md` (copy an existing one — same
   voice: English, task-focused, `::: callout-note` / `::: callout-tip` panels,
   a screenshot per step, cross-links). Reference each screenshot as
   `/guides/assets/<tag>-NN-name.png` (tag = `t5`, `s2`, …) — an absolute path,
   because it is served from `/public`.
2. Fill in the front matter: `title`, `description`, `tag`, `audience`, `order`,
   `lang`, `status`, `owner`, `reviewed`, `reviewBy`. **Nothing else needs
   editing** — the index, the section rail and previous/next all read the
   content tree, so the guide appears on its own.
3. Add the guide → surfaces it documents in `docs/guides/guide-surfaces.json`.
4. If it should be queryable, add it to `scripts/seed-guide-corpus.mjs` (the
   `GUIDES` array + a tutor activity if a new audience).
5. Capture its screenshots: add shots to the capture script for its surfaces
   (`docs/guides/screenshots/capture.mjs` for teacher/researcher,
   `capture-student.mjs` for student), then `make guide-screens`.
6. `make check-guides`, then `make guides-pdf` once it is deployed.

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
- **Repo weight.** `frontend/public/guides/` holds the PDFs and the screenshots
  they embed. 1.1.116 dropped the self-contained HTML (which duplicated every
  screenshot as base64 inside each of 11 files); if the PDFs grow, print them in
  CI rather than committing them.
- **Re-seeding is now the update path, not a hazard.** `make seed-guide-corpus`
  reconciles: guide docs are matched by title within the "AIPLA guides" subject
  and replaced in place (new doc ingested, then the old one deleted), the class
  is matched by name, the tutors by title, and a group code is minted only if the
  class has none. So the loop for a changed guide is `make guides-publish &&
  make seed-guide-corpus ENV=<env>`. Note docIds churn on every run by design —
  the tutors are re-pointed at the fresh ids in the same pass.
- **The corpus + tutors are per-env and NOT seeded by any deploy.** The static
  `/guides` pages ride the frontend image, so they exist everywhere; the
  queryable corpus does not. Until 2026-08-04 this script took no env argument
  and defaulted to dev's hardcoded URL, which is why dev was the only env with
  the in-product guides. Seed test/prod explicitly after an env cut.
- **Seeding uses the PDFs, so print before you seed.** `seed-guide-corpus` reads
  `frontend/public/guides/*.pdf` (committed). The wrapper refuses if the guide
  markdown is newer than the PDFs (or uncommitted), comparing COMMIT times —
  mtimes are meaningless after a clone. Order: edit → deploy → `make guides-pdf`
  → commit → `make seed-guide-corpus ENV=<env>`. `STALE_OK=1` overrides.
- **`make guides-pdf` needs a RUNNING app, not a toolchain.** It prints the live
  page, so point it at something serving the new markdown: deployed dev by
  default, or `BASE_URL=http://localhost:3456` against `make dev`. Printing a
  URL that still serves the old text is the one way to get a stale PDF.
- **The test-teacher exists on all three envs.** `test-teacher@example.dk` /
  `aipla-demo-1` authenticated against prod on 2026-08-05, so
  `make seed-guide-corpus ENV=prod` needs no extra credentials. Override with
  `TEACHER_EMAIL` / `TEACHER_PASSWORD` if that account is ever removed (it is a
  convenience account and is a reasonable thing to retire before the pilot).
