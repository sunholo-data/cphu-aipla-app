# Sprint RUBRIC-1 — MAPS/SAAR judges + researcher lens-config surface

**Design doc:** [competency-rubrics.md](competency-rubrics.md) (1.1.57)
**Sprint ID:** `RUBRIC-1` · **Created:** 2026-07-11 · **Estimated:** 2 days (~1,200 LOC incl. tests)
**Scope decision (M, 2026-07-11):** the un-gated 1.1.57 slice (design-M0 judge prototype + CLI,
design-M2 SAAR agent-design activity) **plus a researcher configuration surface** in the
currently-placeholder `/teacher/settings` pane — researchers experiment with lens configs (judge
model, prompt version, enabled lenses, run-a-judge-against-a-session) per the
[prompt-transparency-and-config](prompt-transparency-and-config.md) researcher-versioned-layer
direction (1.1.5 researcher role is shipped; this is its first *config-write* surface).
**OUT:** anchor packs (1.1.57-M1, AR/JB pedagogy-days), four-format quiz (M3, TAA-gated),
misconception index (M4, corpus not on this machine), any teacher-facing rubric vocabulary (M5,
R1-gated — nothing this sprint ships is teacher-visible; the settings panel is researcher-only).

## Goal

A researcher can score a captured session against the MAPS (problem-solving) and SAAR
(inquiry) judges — offline via CLI or interactively from the settings pane — with the
evidence-integrity partition enforced (tutor-prompted turns never score as competence) and every
result stamped with the prompt version that produced it. A teacher can start the SAAR
agent-design activity from a starter template.

## Milestones

### M0 — lens registry + MAPS judge + evidence partition (backend, ~380 LOC)

- `backend/analytics/session_rubric.py` (the 2.5-planned file):
  - **Lens registry** — config-shaped entries `{lens_id, label, default_model, prompt_version,
    enabled}`; Lens C (MAPS) + Lens D (SAAR, judge lands M2). The registry merges a Firestore
    override over the code default (the 1.1.42 `tutorBlock` override⊕default pattern) — the M3
    surface writes the override.
  - **Evidence partition** — deterministic-first split of a session transcript into
    `student_initiated` vs `tutor_prompted` turns (turn adjacency to tutor hints), plus the
    SUBMIT-1 image artifacts. Partition is returned with every score for audit.
  - **MAPS judge** — Docktor Table I categories verbatim (CC-BY, attribution in-prompt), 0–5 +
    NA(problem)/NA(solver), consistency rule, anti-correct-answer-bias instruction. Scores ONLY
    partition-1 artifacts/turns. **No anchor pack → returns `abstained` with the reason** (the
    1.1.57 calibration rule; anchor packs are AR/JB's M1, stored on activity config later).
  - Judge calls via the `google.genai` client (the `analytics/summarise.py` precedent), one call
    per lens per session, cached on the session index (the `reports/narrative.py` pattern).
  - Every result carries `{lens_id, prompt_version, model, partition_summary}`.
- Tests: fixture transcript (student-initiated vs tutor-prompted mix) → partition correctness;
  judge prompt assembly; abstain-without-anchors; cache hit; registry override merge.

**Accept:** a captured session scores into the five-category profile with NA codes (mock/live
model behind a seam); tutor-prompted turns demonstrably excluded; abstains without anchors.

### M1 — CLI: `aiplatform rubric` (cli, ~130 LOC)

- `aiplatform rubric score <session-id> --lens maps|saar` — runs the judge locally against the
  captured session, prints the category profile + the evidence partition.
- `aiplatform rubric anchors validate <activity-id>` — lints an anchor pack (≥5 anchors,
  NA(solver) example present); useful the moment AR/JB start authoring (their M1).
- (The 1.1.57 doc says `aitana rubric` — our CLI tree is **`aiplatform`**; noted as a doc nit.)

**Accept:** both commands run against dev data; `make cli-selftest` still green.

### M2 — SAAR Lens D judge + agent-design activity template (fullstack, ~300 LOC)

- **Lens D judge** — Etkina testing-experiment rubric rows 1–8 (0–3 scale), few-shot from the
  paper's Tables X/XI graded transcripts (open access, quoted with citation; Student B = the
  canonical confirmation-bias negative). Registered in the lens registry.
- **Agent-design activity template** (`ACTIVITY_TEMPLATES` + teaching goal): the AR-suggestion
  flow run **chat-first** — state what your agent should do → design tests that could REFUTE it
  → run them (conversationally, tutor-guided) → judge from results → identify assumptions. A
  note element carries the student instructions; a checklist carries the five phases. (A real
  configure-and-run-your-agent workbench is a follow-on; the 1.1.57 estimate is for this
  chat-first form.)

**Accept:** the SAAR judge distinguishes a refutation-oriented design (3) from a
confirmation-oriented one (1) on fixture transcripts; the template appears in the builder's
starter list and fills goal + note + checklist.

### M3 — researcher lens-config surface in the settings pane (fullstack, ~450 LOC)

The first researcher *config-write* surface (prompt-transparency direction, building on shipped
1.1.5):

- **Store:** `analytics_lens_configs/{lens_id}` — `{enabled, model, prompt_version,
  prompt_override, updated_by, updated_at}`. Registry merge (M0) makes it live next judge run.
  Prompt edits bump `prompt_version`; results already stamp it (M0), so scored history stays
  interpretable — the living-concept-map "researcher layer" principle.
- **API (researcher-gated, `user.is_researcher` — the analytics/auth.py precedent; 404-shaped
  deny):** `GET/PUT /api/research/lens-configs`, `POST /api/research/rubric-score`
  `{sessionId, lens}` → profile + partition (the interactive twin of the CLI).
- **Settings pane** ([/teacher/settings](../../../frontend/src/app/teacher/settings/page.tsx) —
  currently a 32-line placeholder): non-researchers keep the placeholder untouched; researchers
  (`useIsResearcher`) additionally get a **"Research · judge lenses"** panel — per-lens card
  (enabled toggle, model select, prompt-override editor with version-bump-on-save) + an
  **experiment box** (session id → run lens → profile table + partition view + abstain state).
  Teacher auth throughout (`fetchWithTeacherAuth` / teacher token — no group-token surface here).
- Tests: endpoint deny for non-researcher; PUT bumps version; FE panel hidden without the role;
  experiment box renders profile + abstain.

**Accept:** a researcher edits the MAPS judge prompt in settings, saves (version bumps), runs a
session through the experiment box, and the result reflects + stamps the new version; a plain
teacher sees no trace of the panel.

## Sequencing

M0 → (M1, M2, M3 all depend only on M0; run serially M1 → M2 → M3 — parallel process active on dev).

## Risks

| Risk | Mitigation |
|---|---|
| Judge quality without anchors looks bad in demos | It's SUPPOSED to abstain — that's the headline behaviour; the experiment box renders abstains as a designed state, not an error |
| SAAR few-shot text licensing (Tables X/XI) | Open access quote-with-citation per the 1.1.57 license table; attribution in-prompt; no wholesale republication |
| Prompt-override lets a researcher break a judge | prompt_version stamping + one-click "reset to default" per lens; overrides never touch teacher/student surfaces (R1 quarantine holds) |
| Judge cost creep | One call per lens per session, cached; cost spans (Axiom 8) already wrap genai calls |
| Settings pane scope creep into general teacher settings | Panel is additive + researcher-only; the placeholder copy stays for everyone else |

## Quality gates

Per milestone: `cd backend && make lint && make test-fast` · `cd frontend && npm run quality:check`
(M1: `make cli-selftest`). Commits straight to `dev`, rebase before push, one commit per milestone.
