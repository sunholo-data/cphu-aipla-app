# STX Fysik-A benchmark harness (AILANG)

Implementation of [stx-benchmark-ailang-kickoff.md](../stx-benchmark-ailang-kickoff.md).
Measures which model tiers can solve Danish stx Fysik A written-exam problems,
calibrated against official answer keys.

Built against **AILANG v0.29.2**. Verified API surface, not assumed.

## Status (2026-07-14)

| Piece | State |
|---|---|
| Pure grading core (`benchmark/grader.ail`) | **Built, type-checks, tested** |
| Grader self-test (`benchmark/selftest.ail`) | **9/9 PASS** — no AI, no cost |
| `bench-config.json` (model panel as data) | Scaffolded |
| Stage 0 — key extractor (`benchmark/keyparse.ail` + `stage0.ail`) | **Built** — 49/60 numeric, dry-run 49/49 correct, 1 symbolic, 10 review |
| Stage 0 — catalogue ingestion + item builder (`catalogue.ail` + `items.ail`) | **Built** — `std/yaml` integrated; writes full `items.jsonl` with topics/flags |
| Stage 1 — dry-run pipeline (`benchmark/stage1.ail`) | **Built** — reads items.jsonl (41 runnable), 41/41 correct, results carry topics |
| Report layer (`benchmark/score.ail`) | **Built** — accuracy overall / per-set / per-topic off results.jsonl |
| Live AI plumbing (`benchmark/smoke.ail`) | **Verified live** — 2/2 correct on gemini-2-5-flash; FACIT contract reinforced |
| Stage 2 — report (`benchmark/matrix.ail` + `mockrun.ail`) | **Built** — per-model / per-topic matrix + divergence + cost, validated on mock tiers |
| Stage 2 — live demo (`benchmark/stage2demo.ail`) | **Verified live** — per-call model selection (gemini-2.5-flash + -pro), real results -> matrix |
| Cross-provider trial (`benchmark/trial.ail` + sweep) | **Verified live** — 4 routes (Vertex/Anthropic/OpenAI/OpenRouter), 2/2 each -> matrix |
| Stage 2 — full corpus runner | **Pending** — trial.ail over items.jsonl question_text; gated (spend + question_text + VERIFY.md) |
| Stage 3 — provisional keys | Gated on Stage 1 passing |

## Run it

```bash
cd strand-c-scoping/stx-bench
ailang check benchmark/grader.ail                                  # type-check
ailang run --caps IO --entry main benchmark/selftest.ail           # grader self-test (9/9 PASS)
ailang run --verify-contracts --caps IO --entry main benchmark/selftest.ail   # + runtime contracts
ailang run --caps IO,FS --entry main benchmark/stage0.ail          # extract 4 gold keys + real dry-run
ailang run --caps IO,FS --entry main benchmark/items.ail           # Stage-0 build -> runs/stage0/items.jsonl
ailang run --caps IO,FS --entry main benchmark/stage1.ail          # Stage-1 dry run -> runs/dryrun/*
ailang run --caps IO,FS --entry main benchmark/score.ail           # report: accuracy overall/per-set/per-topic
ailang run --caps IO,FS --entry main benchmark/mockrun.ail         # synthetic multi-tier results (for the report)
ailang run --caps IO,FS --entry main benchmark/matrix.ail          # Stage-2: per-model/per-topic matrix + divergence
ailang run --ai-stub --caps IO,AI --entry main benchmark/smoke.ail # live AI wiring check (free)
ailang verify benchmark/grader.ail                                 # Z3 (see caveat)
```

The live model path (`solveLive`/`judgeAnswer` in `stage1.ail`) needs `--caps
IO,FS,AI,Env` and spends provider budget. It is intentionally not wired into an
entrypoint: a real run waits on M's Stage-0 sign-off and the per-item
`question_text` (problem-text slicing, still to come).

## Stage-0 coverage (real gold keys, 2026-07-14)

Over the four 2023-24 answer-key files (60 subquestions), the deterministic
extractor produces **49 numeric items**, and every one of them passes the
dry-run self-test (**49/49** grade `correct` when fed back as its own answer).
1 reaction scheme is flagged `Symbolic`; 10 go to manual review (multi-value
final lines, truncated equations, and graph-reading values embedded in prose
with no `=` anchor). This matches the kickoff's "~50 runnable gold items"
estimate. No guesses are emitted — unparseable keys are named, not invented.

## Stage-0 full item build (`items.ail`, catalogue + keys)

`std/yaml` shipped 2026-07-14 and is integrated. `items.ail` joins each key
subquestion to its catalogue problem (title/topics/modality) and writes the full
`runs/stage0/items.jsonl` (60 records, gitignored). Modality drives kind/flags:

| kind | count | rule |
|---|---|---|
| numeric | 38 | plain numeric key, tol 0.05 |
| graph-reading | 3 | modality `image-bilag`, tol 0.10 |
| **runnable total** | **41** | numeric + graph-reading |
| skipped (bilag) | 9 | modality `video-data`/`spreadsheet-data` (kept, excluded) |
| symbolic | 1 | reaction scheme |
| needs-review | 9 | unparseable key |

**Two discrepancies vs the kickoff estimates — for M's sign-off:**
- Bilag-skipped is **9, not ~5**. Modality is tagged at *problem* level, so we
  currently skip every subquestion of a bilag problem; some may be text-solvable.
  Per-subquestion review could reclaim a few as runnable.
- Graph-reading is **3, not ~7**. We only catch items whose problem carries an
  `image-bilag` modality; graphs drawn inline in the problem text (no bilag) are
  not flagged and land in `numeric`. Widen if those need the 0.10 band.

## Per-call model-id finding (2026-07-15)

Tier descent relies on `step(model, …)` with a different model string per call.
Gotcha found live: the per-call model must be the **provider API name** (dots,
`gemini-2.5-flash`), **not** the friendly `--ai` name (dashes, `gemini-2-5-flash`)
— the per-call path skips the `models.yml` friendly→api resolution that `--ai`
applies, so a friendly name returns `ModelNotFound`. Also, per-call routing stays
within the bound handler's provider: a `claude-*` id while `--ai` binds Vertex
returns `ModelNotFound` (cross-vendor needs OpenRouter). `bench-config.json` panel
ids are now API names; reported upstream.

## Providers & where scoring data comes from

Provider-agnostic: AILANG's `GuessProvider` infers the provider from the model-id,
so **one `ailang run --ai <id>` per model** auto-selects the route (the canonical
"one run per model" tier descent).

| Model-id form | Route | Key |
|---|---|---|
| `gemini-2.5-flash` | Vertex (ADC) | ADC |
| `claude-haiku-4-5` | Anthropic direct | `ANTHROPIC_API_KEY` |
| `gpt-5-mini` | OpenAI direct | `OPENAI_API_KEY` |
| `anthropic/…`, `deepseek/…`, `openrouter:…` | OpenRouter | `OPENROUTER_API_KEY` |
| `ollama/<model>` | Ollama GPU (deferred) | `OLLAMA_HOST` |

**Scoring plan (M, 2026-07-15):** the scores come from **cloud APIs** (Gemini /
Claude / GPT frontier tiers) **+ OpenRouter** to audit the smaller / open-weights
models — that's expected to be enough to actually score. **No local GPU is needed
for scoring.** Running selected models on the server's GPU cluster is a *future*
step, decided from the scores. Verified live from the dev laptop 2026-07-15: Vertex
(gemini-2.5-flash/-pro), Anthropic direct (claude-haiku-4-5, 2/2), OpenRouter
routing (`anthropic/claude-haiku-4-5`). Ollama is **not** run here.

## Live AI smoke finding (2026-07-14)

First real calls (`gemini-2-5-flash`, Vertex ADC) ran fine but **ignored the
`FACIT:` answer-format contract** when it lived only in the system prompt — the
model stated the result in prose, so the deterministic parser found no FACIT line
(would fall through to the judge = extra cost). Fix: reinforce the contract in the
*last* user message (`solver.userMessage`). Re-run: **2/2 graded `correct`
deterministically**, output tokens down ~5×. Watch-item: the strong "nothing after
the FACIT line" phrasing can suppress shown working on some items — fine for the
numeric axis (we grade the value), revisit if the method/rubric axis needs it.

## Scoring methodology (decided 2026-07-14)

We have official answer keys — ground truth — so the score is **absolute
accuracy against the key**, not a preference rating.

- **Primary: accuracy vs key** (overall / per-set / per-topic), off the
  model × item verdict matrix. Drives both adequacy gates. Legible to JB/AR.
  `ambiguous` is never silently counted correct: score =
  `correct / (correct + incorrect + ambiguous)`, ambiguous reported alongside.
- **Adequacy is role-relative.** Gate 1 (key oracle): top tier ≥ ~95% on gold →
  may generate Stage-3 provisional keys, carrying error rate = 1 − gold accuracy.
  Gate 2 (deployment tier): a pedagogical bar JB/AR set from the descent curve,
  not a harness constant.
- **Secondary robust lens: Rasch / IRT**, not raw ELO. On a ground-truth test,
  an ELO-style rating collapses to the Rasch model
  P(model correct on item) = σ(θ_model − b_item). IRT keeps the absolute scale,
  gives ability θ with CIs, and yields item difficulty b **for free** — which is
  exactly what the student-difficulty correlation (model-failure ranking vs
  forcensur "hardest subquestions") needs. Online-ELO update is pure and could
  live in AILANG; the Rasch MLE is a fit better done in the analysis notebook.
- **Pairwise ELO / Bradley-Terry is reserved for the no-ground-truth axes:**
  first solution-quality under the 2025 five-level rubric (LLM-judge preference,
  Arena-style), and later **student conversational feedback** — pairwise "did
  this exchange help more?" preference data is ELO's native setting. Kept
  separate from the numeric-exam score.
- Sample size (~49 items, small panel) → any rating has wide CIs. Accuracy is
  the headline; IRT is the robustness check; report uncertainty, not points.

## The grading core is the crown jewel

`benchmark/grader.ail` is **effect-free** on purpose (kickoff §"AILANG specifics"):

- **Contracts** — `withinTol` requires `tolerance_rel > 0`; `gradeNumeric`
  ensures a legal `Verdict`. Enforced at runtime under `--verify-contracts`
  (self-test passes with them on).
- **WASM path** — the same pure module is the future in-browser zero-token
  answer checker for the AIPLA app. No FS/AI/IO in the grading path keeps that
  door open. All effects stay in the (not-yet-built) harness shell.

### Two honest caveats found while building (not assumed)

1. **Static Z3 verification — crash fully fixed (build 2026-07-14_17:18).** Every
   shape now either verifies or SKIPs gracefully; zero `unknown constant` anywhere
   (AILANG commits `efd251f`/`94e2a5d`, confirmed locally). Enum-constructor
   `ensures` verify; primitive-returning callees inline and verify. What still only
   *skips* (not proves): user functions in a contract predicate, and callees
   returning records/enums/`Option`. So `gradeNumeric` doesn't statically verify
   yet — runtime `--verify-contracts` covers the dry run. Path to static proof
   (primitive-restructure) is deferred; see [VERIFY.md](VERIFY.md) §2.
2. **`stepWithCache` is a NO-OP on Gemini** (`CacheBreakpoint` docs, v0.18.4):
   only Anthropic populates `cache_read_input_tokens`. The kickoff's "cache the
   solver system prompt across ~50 items" saving will **not** materialise on the
   Gemini-first panel. Coded anyway (harmless; helps the Anthropic spot-check),
   but the cost model must not assume it. Recorded in `bench-config.json`.

## Upstream dependency: `std/yaml` — RESOLVED

`std/yaml` shipped 2026-07-14 (`decode` + `yamlToJson`) and is integrated in
`catalogue.ail`; catalogue ingestion no longer needs Python. History below.

The corpus catalogue is the only YAML input; AILANG v0.29.2 has no YAML reader
(42 stdlib modules, none for YAML). Per M's steer (2026-07-14) we do **not**
shell out to Python — we requested the capability upstream and gate catalogue
ingestion on it:

- Local: `ailang messages` id `msg_20260714_181417`
- Remote public-feedback: ticket `fb_28c91526c3595794` (minimal
  `std/yaml.yamlToJson` bridge preferred; full `decode` offered)

Everything else in the pipeline is unblocked: answer keys are JSON (`std/json`),
problem texts are plain `.txt` (`std/fs`), outputs are JSONL.

## Layout

```
stx-bench/
  benchmark/
    grader.ail       pure grading core (Verdict, Expected, unit table, tolerance)
    selftest.ail     grader self-test (9 cases, no AI)
  bench-config.json  model panel + tolerances + budget (data, not code)
  .gitignore         never commit anything derived from the private sources
```

Nothing derived from `sources/` is ever committed (see `.gitignore`); reports
may quote item ids / topics / scores, never problem text.
