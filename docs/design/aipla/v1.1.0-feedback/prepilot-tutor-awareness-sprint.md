# PREPILOT-1 — sprint plan: the tutor sees what the teacher authored

**Sprint ID:** `PREPILOT-1`
**Design docs:** [1.1.62 workbench-element-awareness](workbench-element-awareness.md) · [1.1.63 tutor-register-citation-and-language](tutor-register-citation-and-language.md) (M1+M2 only) · [1.1.64 multi-chart-variable-selection](multi-chart-variable-selection.md)
**Created:** 2026-08-06 (M)
**Hard deadline:** **teacher pilot starts 2026-08-14.** This must be in **prod**, not dev, by 2026-08-13.

## Summary

Three design docs, one sprint, because they collide in one function. Everything
here traces to Aswin's 2026-08-06 trial feedback — six of his eight complaints.

**Goal:** a teacher authors elements and sets a language, and the tutor acts on
both. Today it does neither.

| Doc | In scope | Deferred |
|---|---|---|
| 1.1.62 | M1–M4, all of it | — |
| 1.1.63 | M1 citation voice, M2 tutor language | **M3 student-UI i18n** (2–3d, does not fit before the pilot) |
| 1.1.64 | M1–M3, all of it | — |

**Estimated:** ~4.5–5d against **4 available build days** (Fri 8-07, Mon 8-10,
Tue 8-11, Wed 8-12), with Thu 8-13 reserved for promote + soak. Recent velocity
says this fits; the cut line is defined below in case it doesn't.

## Current Status Analysis

### Baseline (verified 2026-08-06, before any change)

| Gate | Result |
|---|---|
| `cd backend && make test-fast` | **GREEN** — 2706 passed, 1 skipped, 17 deselected, 21s |
| `cd frontend && npm run quality:check:fast` | **GREEN** — lint, typecheck, auth-fetch, no-mock, project-content all clean |
| `git status` | clean except the seven new design docs (uncommitted) |
| dev vs last tag | dev is **8 commits ahead of `v0.1.10`** |

> The memory `project_pre_existing_otel_test_isolation_failure` warns of 3
> `test_tenant_context.py` failures. **They did not occur on this run** — the
> suite is fully green. The OTLP `ConnectionError` noise on stderr is exporter
> teardown, not a test failure. Treat any red in this suite during the sprint as
> **yours**, not pre-existing.

### Recent velocity

| | |
|---|---|
| Last 14 days | 82 commits, 170 files, +14,067 / −826 |
| **ACTFACET (1.1.61), the closest comparable** | 3 milestones (backend + frontend + co-pilot), design estimate ~2–2.5d, **delivered in one day** (2026-08-05), 35 files, +2,803 |

ACTFACET beat its own estimate by roughly 2×. That is one data point, not a
trend, so this plan is scheduled against the **design-doc estimates** and treats
the velocity upside as buffer rather than spending it in advance.

### What we build on (all shipped, none of it needs building)

- `ELEMENT_REGISTRY` — 8 element kinds with caps ([activity_config.py:406](../../../../backend/db/models/activity_config.py#L406))
- `compose_teacher_focus` / `inject_teacher_focus` — the prompt-composition seam ([teacher_focus.py:180](../../../../backend/adk/teacher_focus.py#L180))
- `run_checkpoint` / `record_checkpoint` + per-group `concept_progress` — the exact pattern M3 copies ([checkpoint_tools.py](../../../../backend/adk/checkpoint_tools.py))
- `_load_preamble` file-based prompt layering ([interaction_style.py:48](../../../../backend/adk/interaction_style.py#L48))
- `WorkbenchChart` **already takes a chart array** ([elementRenderers.tsx:86](../../../../frontend/src/components/workspace/elementRenderers.tsx#L86)); registry already allows `max_items=5`
- `HumanToolUseCard` + `make audit-trust-cards` CI gate

## The sequencing constraint that shapes this sprint

**1.1.62 M1 and 1.1.63 M2 edit the same function.** The element manifest and the
language directive are both blocks stacked in `compose_teacher_focus`, and both
care about **ordering** (language first so it frames everything; ILOs before the
curriculum preamble). Building them as separate milestones means editing the
same 50 lines twice and reasoning about ordering twice.

So they are **one milestone** (M2 below). This is the single most important
scheduling decision in the plan.

1.1.64 is independent of both — different files entirely — **except** its chart
describer, which is a `describe_elements` entry and therefore lands with M2.

## Proposed Milestones

### M1 — Citation voice (backend, ~0.25d)

*1.1.63 M1. Isolated file, zero conflict with anything else. First because it is
the highest visible-annoyance-per-hour fix in the sprint.*

- Rewrite the grounding preamble at [`curriculum_retrieval.py:53-58`](../../../../backend/adk/curriculum_retrieval.py#L53) to the when/how contract
- **Rewrite the line-118 twin** (*"Always cite the source in your answer"*) — leaving it is the likeliest way for this fix to look like it did not work
- `_build_source_preamble` emits **title** first, domain parenthesised; filename fallback unchanged

**Acceptance:** no reply opens with "According to \<domain\>"; a load-bearing retrieved claim is still attributed by title; "where did that come from?" still answers specifically.

### M2 — Element manifest + tutor language (backend, ~1.25d)

*1.1.62 M1 + 1.1.63 M2 together — same function, shared ordering.*

- **New** `backend/adk/element_manifest.py`: `describe_elements()` iterating `ELEMENT_REGISTRY`, per-kind describers for `checklist`/`table`/`chart`/`calculator`/`note`/`document`, generic fallback for unknown kinds
- Chart describer **names the axes** (1.1.64's field names; harmless before M5 lands since the fields are optional)
- 2000-char cap, item-wise truncation with `(+N more)`
- Language directive in `compose_teacher_focus`, emitted **first**; separates *reading* (Danish curriculum) from *speaking* (activity language)
- **Narrow or remove** the `teacher_focus.py:176` "Match the student's language" heuristic — it now conflicts with an explicit setting
- Extend the `inject_teacher_focus` log line with per-kind element counts
- `aiplatform activity manifest <id>` CLI — prints exactly what the tutor is told

**Acceptance:** with a table + chart + checklist authored and **zero student interaction**, the tutor's opening turn names the table. `language: "en"` → English from turn one while citing a Danish source. Registry-completeness test passes. Composed focus stays under the 10k `SkillConfig` cap on a maximal config.

**Risk — the highest in the sprint.** The 10k instruction cap is real and this
milestone stacks a fifth block into a prompt that already carries sim
`tutorBlock` + solution + concept map + goal. The cap test is written **first**,
with a maximal config, not last.

### M3 — Checklist tick tools + trust card (fullstack, ~1d)

*1.1.62 M2. The ILO half — where Aswin's "automatic ILO check" actually becomes a feature.*

- **New** `backend/adk/checklist_tools.py`: `list_checklist` / `mark_checklist_item`, modelled on `checkpoint_tools.py`
- Per-**group** progress store (survives rejoin), reusing the `concept_progress` shape — not a third store
- Mandatory `evidence_summary`; reject a tick without one at the tool boundary
- Conditional tool registration when `cfg.checklist` is non-empty
- `HumanToolUseCard` variant + `ProgressChecklist` **AI-ticked vs student-ticked** distinction (student can untick an AI tick)

**Acceptance:** an item ticks from conversation with a visible card; ticks survive reload and a new session id; `make audit-trust-cards` green.

**Watch:** the tools must key group off the **verified JWT claim**, never a tool argument — otherwise one group ticks another's checklist. Students are `email=""` group JWTs; read `tool_context.state["user:id"]` + the group claim, never `User.email`.

### M4 — ILO precedence (backend, ~0.5d)

*1.1.62 M3. Small, and the direct answer to "the chat forces curriculum goals, not my ILOs".*

- Precedence block stating the teacher's checklist as the activity's objectives and curriculum as reference material
- Ordered **before** the curriculum sources preamble in the composed instruction
- Test asserting relative order

**Acceptance:** an authored ILO beats a conflicting curriculum objective.

### M5 — Multi-chart (fullstack, ~0.9d)

*1.1.64 M1 + M2. Fully independent of M1–M4 — the natural parallel/pickup-when-blocked milestone.*

- Optional `tableId` / `xColumn` / `yColumn` on `ChartElement` (**optional, so no backfill**)
- Shared `resolveChartBinding()` with the 3-step ladder: bound → auto-bind **+ visible note** → empty state
- `ChartEditor` → list editor (cap 5, Add disabled **with a reason**), **numeric columns only** on both axes
- `WorkbenchChart` per-chart resolution; axis labels carry units
- `TableEditor` warns before deleting a referenced column
- `ActivityPreview` renders all charts

**Acceptance:** 2 charts on different variable pairs both update as the table fills; deleting a referenced column shows the note and does not crash; **existing single-chart activities render identically**; `elementPayload()` multi-chart round-trip passes.

### M6 — Co-pilot, CLI, evals (fullstack, ~0.65d)

*1.1.64 M3 + 1.1.62 M4. The "is it actually done" milestone.*

- `add_element` accepts chart axis params; authoring skill element docs gain axis vocabulary
- `aiplatform activity add-chart` CLI
- **ADK evalset:** elements authored + no interaction → opening turn names the table; checklist ticks from conversation; authored ILO beats curriculum; English activity + Danish source
- 10-turn no-attribution-opener eval (M1's real gate)

**Acceptance:** the co-pilot can propose a chart with named axes; evals pass.

## Day-by-day

Working days available: **Fri 8-07, Mon 8-10, Tue 8-11, Wed 8-12**, with **Thu 8-13 for promote + soak**.

| Day | Plan |
|---|---|
| **Thu 8-06** (today, part) | Commit the seven design docs + SEQUENCE rows. Create sprint JSON. |
| **Fri 8-07** | M1 (0.25d) → M2 start. Write the 10k-cap test **first**. |
| **Mon 8-10** | M2 finish + M3 start |
| **Tue 8-11** | M3 finish + M4 |
| **Wed 8-12** | M5 + M6. `make lint && make test-fast` + `npm run quality:check` (**full, not `:fast`**). Tag `v0.1.11` → test. |
| **Thu 8-13** | Smoke test. `make promote VERSION=v0.1.11 FROM=test TO=prod`. **Seed.** Verify on prod with a real join code. |
| **Fri 8-14** | **PILOT STARTS.** No deploys. |

### The cut line, if it slips

Drop in this order, and say so rather than half-shipping:

1. **M6 evals** — keep the co-pilot/CLI bits, defer the evalset. Costs confidence, not function.
2. **M4 ILO precedence** — M2 already puts the ILOs in the prompt, which is most of the win; explicit precedence is the refinement.
3. **M5 multi-chart** — genuinely independent and the only item with no pilot-blocking consequence. Aswin can be told it lands in the next release.

**M1, M2 and M3 are not cuttable.** Without them the sprint has not addressed the complaint it exists for.

## Cross-cutting risks

| Risk | Mitigation |
|---|---|
| **10k `SkillConfig` instruction cap** — M2 adds a fifth prompt block | Cap test with a maximal config, written first. Manifest hard-capped at 2000 chars with item-wise truncation |
| **Deploy path is the real deadline, not the code** | Thu 8-13 is reserved. `cloudbuild.promote.yaml` twin for any new env var / build-arg — missing twins have bitten **three separate ways**. `make check-cloudbuild` before pushing pipeline edits |
| **Seed after prompt changes** | If wording lands in a `SKILL.md`, `make seed ENV=<env>` per env. Prompt text in Python ships with the deploy. Symptom of getting it wrong: "works in tests, deployed app shows old behaviour" |
| **Pre-push CI parity** | `npm run quality:check` (full) and `make lint && make test-fast`. The `:fast` variants skip tests — LOCAL-MODE-AND-FORK shipped 9 red commits this way |
| **Trust card dropped** (M3) | `make audit-trust-cards`, and the card ships **in M3**, not as a follow-up. This exact half has been dropped twice (calculator, table) |
| **Full-overwrite activity POST** (M5) | `elementPayload()` must send the complete chart array; multi-chart round-trip test |
| **Group-keyed state** (M3) | Group from the verified JWT claim, never a tool arg. Never `User.email` (`""` for students) |

## Testing Strategy

- **Backend:** `test_element_manifest.py` (per-kind + **registry-completeness**, the test that would have caught the original bug), `test_checklist_tools.py` (per-group isolation, evidence required, survives session change), `test_teacher_focus.py` (ordering + 10k cap), `test_curriculum_retrieval.py` (no template phrasing)
- **Frontend:** `HumanToolUseCard` variant, `ProgressChecklist` AI/student ticks, `resolveChartBinding` ladder, `ChartEditor` list behaviour, `elementPayload()` round-trip
- **Eval:** the four ADK cases in M6
- **Manual (`aitana-frontend-verify`):** **Aswin's exact reproduction** — author table + chart + checklist, join as student, send one neutral message *without touching anything*, assert the tutor names the table

## Quality Gates

Per milestone: `cd backend && make lint && make test-fast` · `cd frontend && npm run quality:check:fast`
Before tag: `npm run quality:check` (full) · `make audit-trust-cards` · `make check-cloudbuild` · `make security-check`
After promote: `./scripts/smoke-deployed.sh prod all` · real join-code round trip

## Out of scope

- **1.1.63 M3** — student-UI i18n (2–3d; needs `next-intl` + a CI guard against new literal Danish). Aswin gets an English *tutor* this sprint and English *buttons* later.
- Ground-truth checking of table values (1.1.24), multi-series charts, cross-table charts, new element kinds
- 1.1.65 rubric surfacing, 1.1.66 frameworks, 1.1.67/68 scoping docs — next sprint at the earliest

## Post-sprint

The `workbench-element-builder` skill gains a **third rule**: an element must be
described to the tutor at prompt time, not only pushed on interaction. It
currently encodes push + trust card, which is why this class of bug shipped
four times.
