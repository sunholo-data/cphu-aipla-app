# Local and open-weights models as the tutor — a test plan with thresholds, before any hardware decision

**Status:** Design (OPEN) — **1.1.143**
**Priority:** **P2** — a strategic question (ADR-003 on-prem tiers, the data-agreement fallback), and the meeting's *"plan to test local models, focusing on speed"* has no plan yet
**Estimated:** ~2–3d (M0 pick candidates ~0.25d · M1 harness adapter ~0.75d · M2 text run ~0.5d · M3 image + voice run ~0.75d · M4 write-up + decision ~0.25d). Hardware time and cost are extra, and M3's audio half follows the Klaus (Brighton) call
**Scope:** Research: `scripts/bench-tutor-discrimination.py` (BENCH-2 harness) gains a model adapter for an OpenAI-compatible or Ollama endpoint; `research/stx-bench/` (`bench-config.json`, `run-local-gpu.sh`) for exam accuracy. Backend: **none** until M4 decides. Ops: the UCPH GPU host
**Dependencies:** [BENCH-1/2](tutor-discrimination-benchmark-sprint.md) (scenarios, fit-all + tone, fidelity-r2, the flash-lite and 3.8-flash baselines); [`research/stx-bench/`](../../../../research/stx-bench/) (Fysik A accuracy; OpenRouter routes for open weights already verified); ADR-003 ([snapshot](../_scoping-snapshot/architecture.qmd)); [1.1.142](retry-then-escalate.md) (a local model can join its chain); [1.1.106](cloud-cost-envelope.md). **Un-gated** for text; **audio wants the Klaus call**
**Created:** 2026-09-30
**Source:** 09-29 meeting: *"considering testing locally installed models (e.g., Llama) to compare quality and latency … token speed being the main risk … summer benchmarking suggests parity with the current light model … real-time analysis capability with open-source models needs verification."* AI suggestion 3: *"a clear test plan for evaluating local models (metrics, scenarios, success thresholds) is needed."* Split out of 1.1.140 M6

## Problem Statement

The question is not "is an open model as smart as flash-lite". The summer stx-bench
suggests parity on exam accuracy, via OpenRouter (`google/gemma-4-26b-a4b-it`,
`deepseek/deepseek-v4-flash`, `bench-config.json`). The questions that decide it are:

1. **Latency on our hardware.** First token and full reply on the **real tutor prompt**
   (~10–25k chars with the approach, house style and activity), not a toy prompt. The
   meeting named token speed as the main risk.
2. **Pedagogy, not just correctness.** Does the approach survive (BENCH-2 fit-all), and
   is tone as good (tone probe)? A model that solves the exam but flatters every student
   or ignores ESRU is not a tutor.
3. **Danish.** Register and physics vocabulary in Danish.
4. **Multimodal turns.** Image reading (the solution element) and the voice path's
   analysis step. Recording and transcription storage are separate and unaffected.

Nothing measures 1, 2 or 4 today for an open model.

## Design

### M0 — Candidates (~0.25d)

At most three, chosen from what summer stx-bench already scored at parity, and that
**fit the UCPH GPU** in the quantisation we would actually serve:
- one Gemma-family multimodal (the gemma-4 row),
- one fast MoE/flash-class (the deepseek-flash row, or the nearest self-hostable equivalent),
- one Llama-family, because the meeting named it.
Record exact weights, quantisation, serving stack (Ollama or vLLM) and hardware in the
report. A result without those is not reproducible.

### M1 — One adapter, two harnesses (~0.75d)

The BENCH-2 harness calls tutors through Vertex. Add a `--tutor-endpoint` adapter for an
OpenAI-compatible or Ollama chat endpoint. Same composed instruction, same scripted
student turns, same blind judge (the **analysis model stays cloud**, so the ruler does not
change with the candidate). stx-bench already routes `ollama/<model>` via `OLLAMA_HOST`;
reuse it as is for exam accuracy.

### M2 — Text run (~0.5d)

Per candidate, and for flash-lite as the in-run baseline: the 8 BENCH scenarios × 7
approaches, **n = 8 per cell**, plus the stx-bench text items.

### M3 — Image and voice (~0.75d)

- **Image:** 6 solution-element style turns (hand-drawn graphs, including an amplitude
  reading), judged for correct reading against a key.
- **Voice analysis:** replay recorded (non-student, preview) audio through the voice
  path with the candidate as the analysis model, and measure the analysis step's latency
  against its real-time budget. **Take this to the Klaus (Brighton) call first**: which
  audio stages are latency-critical, and what a realistic budget is.

### Thresholds, fixed before the run

| Metric | Pass | Why |
|---|---|---|
| First token, p90, real tutor prompt | ≤ 1.5× flash-lite's | Students wait on it. The 1.1.131 stall line appears at 15 s |
| Full reply, p90 | ≤ 2× flash-lite's | |
| Approach discrimination (own-column top, z-margin) | within flash-lite's run-to-run spread, or better | the tutors must stay distinguishable (BENCH-2) |
| Tone (marked / 56) | ≤ flash-lite *with* the praise preamble (2/56) | the Mikkel fix must hold |
| Wrong-claim sycophancy | 0 | it is 0 today |
| Exam accuracy (stx-bench text) | ≥ flash-lite − 5 pp | summer parity claim, rechecked |
| Image reading | ≥ flash-lite | the amplitude case |
| Voice analysis step | within budget agreed after the Klaus call | |

**Decision rule (M4):** a candidate that passes every row becomes a **chain member**
in 1.1.142 (fail-over first, then an opt-in tier), never the default in one step. One that
fails latency but passes quality is a batch or analysis candidate (reports, judging),
where latency does not matter.

## Out of scope

- Buying or provisioning hardware. The plan runs on what UCPH has.
- Fine-tuning. Measure first.
- Moving the judge or analysis model local. The ruler stays fixed while the thing measured changes.

## Open questions

1. **(M)** Which host and GPU exactly, and who can run jobs on it: M, AD, or the UCPH admins?
2. **(JB)** Does a local-model path change the Firebase-DPA fallback story (AI suggestion 2)?
   If legal says no to the interim agreement, "student text never leaves UCPH" is the strongest
   answer, and this plan is its evidence.
3. **(Klaus call)** The real-time audio budget.
