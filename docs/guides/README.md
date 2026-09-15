# AIPLA user guides

Concise, task-focused how-to guides for teachers, students and researchers.

> **The guides are app pages, not documents** (1.1.116). The prose lives in
> **`frontend/content/guides/<slug>.md`** and renders at **`/guides/<slug>`**
> with the app's own chrome and typography. There is no render step, no Quarto
> and no LaTeX: edit the markdown, and the page is the guide.
>
> This directory keeps the *tooling* that surrounds them — the screenshot
> capture, the staleness manifest and the Danish glossary.

## The set

Source: `frontend/content/guides/`.

| Guide | Audience | Task |
|---|---|---|
| `t1-set-up-a-class.md` | Teacher | Create a class, mint group codes, share |
| `t2-create-your-first-activity.md` | Teacher | Build an activity in the builder |
| `t3-add-curriculum-materials.md` | Teacher | Attach and organise curriculum documents |
| `t4-author-with-the-copilot.md` | Teacher | Draft an activity with the AI co-pilot |
| `s1-join-and-use-your-tutor.md` | Student | Join with a group code and use the tutor |
| `r1-researcher-onboarding.md` | Researcher | Cross-teacher observation + rubric experimentation |
| `r2-propose-a-simulation.md` | Researcher / physics staff | Specify and draft a new simulation for the library |

Each teacher guide points to T4 (the co-pilot can do the same step). The teacher
and student guides (T1–T4, S1) also ship in **Danish** as `<slug>.da.md`,
reachable from the language switch at the top of each guide and served at
`/guides/<slug>.da`; they reuse the English screenshots. See
[da-glossary.md](da-glossary.md) for the terminology + the keep-English-labels
rule.

The **R** guides are English-only by decision, not by omission: the researcher
surfaces themselves are in English and the audience works in English.

## Front matter

Every guide declares the fields `frontend/src/lib/guidesContent.ts` requires —
`title`, `description`, `tag`, `audience`, `order`, `lang`, `status`, `owner`,
`reviewed`, `reviewBy`. `make check-guides` (CI-gated) fails on a missing field,
a `.da.md` with no English source, a lang/filename disagreement, a screenshot
that does not exist, and a review that has passed its own deadline.

The `audience` + `order` pair is the reading order of a track, and drives the
index, the section rail and each guide's previous/next.

## Change a guide

```bash
$EDITOR frontend/content/guides/t1-set-up-a-class.md   # the page IS the guide
make check-guides                                      # the gate CI runs
make guide-screens                                     # re-capture screenshots
make guides-pdf                                        # reprint the PDFs
```

- **`make guide-screens`** captures screenshots with Playwright into
  `frontend/public/guides/assets/` (one copy, served straight to the page):
  - **Teacher guides (T1–T4):** logs into the **deployed dev** frontend as the
    test teacher (`test-teacher@example.dk`), where the co-pilot and concept-map
    features are on and content is realistic. It creates one throwaway activity
    for the "activity created" shot and soft-deletes it afterwards (cleanup token
    minted via `scripts/mint-test-teacher-token.sh`).
  - **Student guide (S1):** joins the anonymous group-code flow with the seeded
    demo code `aipla-demo-1` (override with `GROUP=<code>`). No login.
  - Overrides: `BASE_URL`, `TEACHER_EMAIL`, `TEACHER_PASSWORD`, `GROUP`.
  - Subset re-runs: `ONLY=t4-02-proposal` or `SKIP=t2-05-success` (basenames).
- **`make guides-pdf`** prints each guide page to `frontend/public/guides/*.pdf`
  with Playwright. The PDF is the page — printed through the same print
  stylesheet a teacher gets from **Print this guide** — so the two cannot
  disagree. It needs a running app: deployed dev by default, or
  `make guides-pdf BASE_URL=http://localhost:3456`.
- **`make guide-staleness`** flags a guide whose documented UI surface has a
  newer commit than the guide (manifest: `guide-surfaces.json`).
- **`make seed-guide-corpus ENV=dev`** ingests those PDFs into the in-product
  corpus so the tutors can answer "how do I create a class?".

Screenshots and PDFs are committed so the app serves them without a capture or
print run; refresh them whenever the UI changes so they don't silently rot.

Capture scripts: `screenshots/capture.mjs` (teacher), `screenshots/capture-student.mjs`
(student), `screenshots/print-pdfs.mjs` (PDF). Wrappers:
`scripts/capture-guide-screens.sh`, `scripts/render-guide-pdfs.sh`.
