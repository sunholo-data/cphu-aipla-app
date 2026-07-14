# AIPLA user guides

Concise, task-focused how-to guides for teachers and students, built with
Quarto (PDF + HTML + DOCX) with real screenshots. The same Markdown source is
intended to also feed an in-app `/help` route (a fast-follow).

## The set

| Guide | Audience | Task |
|---|---|---|
| `t1-set-up-a-class.qmd` | Teacher | Create a class, mint group codes, share |
| `t2-create-your-first-activity.qmd` | Teacher | Build an activity in the builder |
| `t3-add-curriculum-materials.qmd` | Teacher | Attach and organise curriculum documents |
| `t4-author-with-the-copilot.qmd` | Teacher | Draft an activity with the AI co-pilot |
| `s1-join-and-use-your-tutor.qmd` | Student | Join with a group code and use the tutor |

Each teacher guide points to T4 (the co-pilot can do the same step). Language:
English first (the co-pilot UI itself is currently Danish-only — the guides name
its Danish buttons with English glosses).

## Regenerate

```bash
make guide-screens   # capture real screenshots (see below)
make guides          # render docs/guides/*.qmd → _output/*.pdf (+ html, docx)
```

- **`make guides`** needs `quarto` + a LaTeX engine (`xelatex`). Output lands in
  `_output/` (gitignored).
- **`make guide-screens`** captures screenshots with Playwright into `assets/`:
  - **Teacher guides (T1–T4):** logs into the **deployed dev** frontend as the
    test teacher (`test-teacher@example.dk`), where the co-pilot and concept-map
    features are on and content is realistic. It creates one throwaway activity
    for the "activity created" shot and soft-deletes it afterwards (cleanup token
    minted via `scripts/mint-test-teacher-token.sh`).
  - **Student guide (S1):** joins the anonymous group-code flow with the seeded
    demo code `aipla-demo-1` (override with `GROUP=<code>`). No login.
  - Overrides: `BASE_URL`, `TEACHER_EMAIL`, `TEACHER_PASSWORD`, `GROUP`.
  - Subset re-runs: `ONLY=t4-02-proposal` or `SKIP=t2-05-success` (basenames).

Screenshots (`assets/*.png`) are committed so the guides render without a
capture run; re-capture whenever the UI changes so they don't silently rot.

Capture scripts: `screenshots/capture.mjs` (teacher), `screenshots/capture-student.mjs`
(student). Wrapper: `scripts/capture-guide-screens.sh`. Renderer:
`scripts/render-guides.sh`.
