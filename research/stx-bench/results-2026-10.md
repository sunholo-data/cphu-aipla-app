# Capability floor — October 2026 snapshot (internal results)

**Run:** 2026-10-05 on studio, `./run-snapshot.sh 5` → `runs/stage2-2026-10/`
(gitignored). **Scored:** `python3 score-snapshot.py`, the July method,
verified by reproducing July's published table from its own raw files.
**Published 2026-10-06** — the public page
[`/project/evaluation/capability-floor`](../../frontend/content/project/evaluation/capability-floor.md)
still shows the July 2026 snapshot; per its own rule a new snapshot replaces it
rather than amending it.

**Method, unchanged from July:** five runs per model; text = correct ÷
(correct + incorrect) with declines excluded; figures = correct ÷ 8, a decline
counting as a miss. Bar = 80%.

**What differs from July — read before comparing:**
- **Every open model ran through OpenRouter**, not on our hardware. Provider
  quantisation can differ from a self-hosted build; the "self-hosted tier" claim
  for these is about the weights, not a measurement on our GPU.
- **Gemini ran on Vertex's `eu` endpoint**, as the app does since 961e39ea.
- **The corpus grew from 33 to 44 text items** (recovered.jsonl keys). The
  33-item table is the July-comparable one; the 44-item table is within 1–3
  points of it for every model.
- **Openness not checked for every model.** Qwen 3.7 Flash / Plus and GLM 5.3
  Flash are listed on OpenRouter; whether their weights are downloadable (and so
  self-hostable at all) has not been verified. Qwen 3.8-27B and Gemma 4 are
  open-weight (Qwen 3.8-27B is also pulled in Ollama on studio).
- **The text score excludes declines**, so a model that declines a lot can score
  high on fewer questions — see "Declined / run" (Qwen 3.5-9B declines ~12 of 33).


## Text — the 33 July items

| Model | Score (mean ± sd) | Declined / run | Clears 80% |
|---|---|---|---|
| gemini-3.8-flash | 100 ± 0 | 6.2 | yes |
| gemini-3.5-flash | 98 ± 2 | 6.0 | yes |
| qwen3.7-plus | 97 ± 2 | 8.4 | yes |
| qwen3.6-35b-a3b | 96 ± 2 | 6.0 | yes |
| qwen3.8-27b | 95 ± 2 | 7.0 | yes |
| gemma-4-31b | 95 ± 2 | 5.8 | yes |
| deepseek-v4.1-flash | 95 ± 2 | 6.2 | yes |
| glm-5.3-flash | 94 ± 3 | 5.4 | yes |
| gemini-3.5-flash-lite | 87 ± 7 | 8.0 | yes |
| qwen3.5-9b | 87 ± 8 | 12.2 | yes |
| qwen3.7-flash | 85 ± 8 | 10.6 | yes |
| gemma-4-26b-a4b | 85 ± 6 | 5.6 | yes |
| ministral-8b | 82 ± 6 | 5.6 | yes |

## Text — all 44 items

| Model | Score (mean ± sd) | Declined / run | Clears 80% |
|---|---|---|---|
| gemini-3.8-flash | 100 ± 0 | 9.2 | yes |
| gemini-3.5-flash | 98 ± 1 | 9.0 | yes |
| qwen3.7-plus | 97 ± 1 | 13.2 | yes |
| qwen3.8-27b | 96 ± 1 | 10.0 | yes |
| qwen3.6-35b-a3b | 96 ± 1 | 8.6 | yes |
| glm-5.3-flash | 95 ± 3 | 8.4 | yes |
| gemma-4-31b | 95 ± 2 | 7.8 | yes |
| deepseek-v4.1-flash | 94 ± 2 | 7.8 | yes |
| gemini-3.5-flash-lite | 89 ± 5 | 12.2 | yes |
| qwen3.5-9b | 88 ± 7 | 16.8 | yes |
| qwen3.7-flash | 88 ± 6 | 14.6 | yes |
| gemma-4-26b-a4b | 88 ± 4 | 8.6 | yes |
| ministral-8b | 81 ± 6 | 8.2 | yes |

## Figures — 8 items

| Model | Score (mean ± sd) | Declined / run | Clears 80% |
|---|---|---|---|
| gemini-3.5-flash | 100 ± 0 | 0.0 | yes |
| gemini-3.8-flash | 100 ± 0 | 0.0 | yes |
| glm-5.3-flash | 98 ± 5 | 0.0 | yes |
| qwen3.8-27b | 95 ± 6 | 0.0 | yes |
| deepseek-v4.1-flash | 95 ± 6 | 0.0 | yes |
| gemini-3.5-flash-lite | 92 ± 10 | 0.0 | yes |
| gemma-4-31b | 90 ± 5 | 0.0 | yes |
| qwen3.7-plus | 82 ± 10 | 0.0 | yes |
| gemma-4-26b-a4b | 82 ± 13 | 0.0 | yes |
| qwen3.6-35b-a3b | 68 ± 17 | 0.0 | no |
| qwen3.5-9b | 50 ± 14 | 0.0 | no |
| qwen3.7-flash | 40 ± 5 | 0.0 | no |
| ministral-8b | 0 ± 0 | 0.0 | no |

## What changed since July

1. **The tutor's default model clears the bar on both.** Gemini 3.5 Flash-Lite:
   text 87 ± 7, figures 93 ± 10. Its July predecessor, 2.5 Flash-Lite, failed
   both (73 / 40). The smart tier, 3.8 Flash, is 100 / 100.
2. **One open model now covers a single-GPU tier.** July's most actionable
   finding was that a self-hosted tier needs a text model *and* a vision model,
   because no open model cleared both. Qwen 3.8-27B (95 / 95) and Gemma 4 31B
   (95 / 90) each clear both, at a size that fits one GPU. If it holds on our own
   hardware, that finding is superseded.
3. **The laptop tier still fails on figures, not physics.** Qwen 3.5-9B: text
   87, figures 50 (it declines about half). Ministral 8B: text 82, figures 0 —
   it declines every figure.
4. **Qwen 3.7 Flash is a text model in practice** (85 text, 40 figures — it
   declines most figures); Qwen 3.7 Plus clears both (97 / 83).
5. **Variance is still the story at the small end** — ±6–13 on the models near
   the bar, so their single runs would mislead, as in July.

## Time to answer (added 2026-10-06)

One timed run per model (`SNAP=stage2-2026-10-timing ./run-snapshot.sh 1`,
seven models concurrently), every item. `solve_ms` = wall time of the model's
answer, retries included, the grading judge not. Via OpenRouter / Vertex — the
provider's hardware, not ours. Median (90th percentile), seconds:

| Model | Text | Figures |
|---|---|---|
| gemini-3.5-flash-lite | 2 (3) | 2 (3) |
| ministral-8b | 5 (14) | 3 (12) |
| glm-5.3-flash | 6 (27) | 18 (113) |
| gemma-4-26b-a4b | 9 (29) | 11 (32) |
| gemini-3.8-flash | 9 (28) | 8 (15) |
| deepseek-v4.1-flash | 10 (64) | 17 (175) |
| gemma-4-31b | 11 (25) | 13 (16) |
| gemini-3.5-flash | 18 (351) | 14 (31) |
| qwen3.8-27b | 29 (137) | 23 (135) |
| qwen3.7-plus | 41 (140) | 10 (50) |
| qwen3.5-9b | 59 (199) | 70 (127) |
| qwen3.7-flash | 70 (97) | 60 (68) |
| qwen3.6-35b-a3b | 107 (250) | 29 (38) |

The Qwen models ran in their default reasoning mode; a reasoning-limited
configuration is the obvious next measurement. gemini-3.5-flash's 351 s tail
is almost certainly rate-limit retries under concurrency.

## Not yet done

- The same Qwen 3.8-27B on studio's own GPU (`./run-local-gpu.sh`), to test
  whether OpenRouter's numbers hold self-hosted. Deferred while the GPU is shared.
- ~~The public page update~~ — done 2026-10-06; July archived at `/project/evaluation/capability-floor-2026-07`.
