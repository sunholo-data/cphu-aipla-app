# Verification debts — resolve before trusting a LIVE (non-dry) run

Current state is a **dry run**: the grader and pipeline are exercised on the
official keys fed back as answers (49/49, 41/41). None of the items below block
the dry run — they block *trusting model scores from a real run*. Tracked here so
nothing is silently treated as settled.

## 1. Stage-0 runnable set — ~13 borderline subquestions (M's sign-off)

Modality is tagged at the **problem** level, so the auto-classification is coarse
in three ways. Full problem-stem review deferred to pre-live; item ids below.

**a. Bilag reclaim** — 8 subquestions skipped as whole-problem bilag that have a
numeric key and *may* be text-solvable (later subquestion builds on an
already-extracted value):
`1stx231-5a 5b` (video), `1stx241-4a 4b` (xlsx), `2stx231-6a 6b` (video),
`2stx241-2a 2b` (xlsx). Decide per subq: **skip / runnable**.
(`2stx241-2c` has no key → stays out regardless.)

**b. Inline-graph tolerance** — 5 numeric items whose problem is a
characteristic-curve read (graph *inline* in the text, no bilag), currently at
tight 0.05: `1stx231-3a`, `1stx241-3a 3b`, `2stx231-3a 3b`. Decide: **0.05 / 0.10**.
Risk if wrong: false `incorrect`s that depress the score.

**c. image-bilag ≠ graph** — 3 items flagged graph-reading (0.10) purely from an
`image-bilag` modality: `1stx241-5a`, `2stx231-5a 5b`. Confirm each image is a
plottable graph, not a photo/apparatus diagram. Risk: wrongly loosened tolerance.

> Scoring note: all bilag-skipped items are `data-analysis-modelling`, so that
> topic's per-topic score rests on very few runnable items. Flag in Stage-2 output.

## 2. Grader static verification (Z3) — deferred, not blocking

Runtime `--verify-contracts` passes (self-test 9/9). Static `ailang verify` now
**skips gracefully** (AILANG fix landed, build 17:18:37 — no more crashes) but does
not yet *prove* `gradeNumeric`. To get static proof: restructure `convertTo`/
`unitCanon` to primitive-returning helpers + rewrite the postcondition over enum
constructors (no `isLegalVerdict` call). Pursue when hardening past dry-run, or
wait for AILANG's contract-callee inlining on their roadmap. Signatures handed to
core (`msg_20260714_192720`).

## 3. Model panel ids — provider-inferred, verify each live

Provider is inferred from the model-id (`GuessProvider`); one `--ai <id>` run per
model. Verified live 2026-07-15: `gemini-2.5-flash`, `gemini-2.5-pro` (Vertex),
`claude-haiku-4-5` (Anthropic direct), `deepseek/deepseek-chat` + `anthropic/claude-haiku-4-5`
(OpenRouter), `gpt-5-mini` (OpenAI). Still to confirm before a paid run:
`gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`
(models.yml names, not yet called). **OpenRouter slugs change** — verify
`meta-llama/llama-3.3-70b-instruct`, `qwen/qwen-2.5-72b-instruct`,
`mistralai/mistral-small` at openrouter.ai/models before use (deepseek confirmed).
Final panel is M's call (hardware/security).

## 4. question_text slicing (Stage A) — needed for live solver

The live path needs each subquestion's problem text sliced from
`extracted-text/<set>.txt`. Being finished separately; the live solver cannot run
without it.

## 5. Post-first-run checks

- **Ambiguous rate:** if `ambiguous` > ~2–3% of runnable, tighten the judge prompt
  or the unit table before trusting numbers. (Already: ambiguous never counted correct.)
- **Judge vs deterministic agreement:** spot-check that the LLM judge and the
  numeric grader agree where both fire.
- **Calibration gate:** top tier ≥ ~95% on gold before any model-generated key
  (Stage 3) is trusted.
