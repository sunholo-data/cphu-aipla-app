# PILOT-1 — sprint plan: the tutor's picture of reality

**Sprint ID:** `PILOT-1`
**Design docs:** [1.1.69 tutor-sees-element-state](tutor-sees-element-state.md) · [1.1.70 progress-conversation-lifetime](progress-conversation-lifetime.md) · [1.1.72 opening-knows-the-lesson](opening-knows-the-lesson.md) · [1.1.63 M4 voice language](tutor-register-citation-and-language.md) · [1.1.71 multi-table-activities](multi-table-activities.md)
**Created:** 2026-08-10 (M)
**Context:** **Teacher pilot starts 2026-08-14 — four days.** All three environments are on `v0.1.11`.

## Summary

Aswin's 2026-08-10 feedback, all five items. Two of them are regressions from
PREPILOT-1 last week, and they share a root: **1.1.62 taught the tutor what
exists, and stopped there.** It knows the table is there but not whether it has
data; it knows the ticks are there but not that it never witnessed them earning.

| Doc | In scope | Why now |
|---|---|---|
| 1.1.69 element state | M1–M3 | The tutor auto-marks ILOs it cannot verify. Pilot-blocking. |
| 1.1.70 progress lifetime | M1–M3 | Tutor appears to forget the lesson then declare it done. Pilot-blocking. |
| 1.1.72 opening | M1–M2 | First sentence every student reads. ~0.4d. |
| 1.1.63 M4 voice | M4 | English text, Danish numbers. ~0.5d. |
| 1.1.71 multi-table | **DEFERRED** | Real, but not pilot-blocking, and it carries an id-migration risk that should not land four days out. |

**Estimated:** ~3.5–4d against **~3 available days** (Mon 8-11, Tue 8-12,
Wed 8-13), with Thu 8-14 the pilot. That does not fit, which is why the cut line
below is not decoration.

## Baseline (verified 2026-08-10)

| Gate | Result |
|---|---|
| `cd backend && make test-fast` | **GREEN** — 2796 passed |
| `cd frontend && npx vitest run` | **GREEN** — 1564 passed, 187 files |
| dev / test / prod | all `v0.1.11`, smoke-green |
| CI | green except `security-audit` (one transitive dep, `h2 4.3.0` → `4.4.1`, owned elsewhere) |

## The sequencing constraint

**1.1.69 M1 and 1.1.70 M1 both add a per-turn context block**, and both are read
by a tutor whose prompt budget is already shared five ways (`_TOTAL_FOCUS_CAP`
is 8000, and PREPILOT-1 found a maximal activity composing ~11,000 before it was
bounded). Land them in one milestone pair with the budget test extended **first**,
or the second one silently truncates the first.

They also differ in a way worth keeping straight: the element manifest is
composed **once per session**; both new blocks must be per-**turn** instruction
providers, because fill-state and progress both change mid-session. Getting that
wrong reintroduces staleness the manifest deliberately avoided.

## Milestones

### M1 — Element fill-state (backend, ~1d) · 1.1.69 M1+M2

- `element_state.py` beside `element_manifest.py`: per-kind fill readers over `mcp_app_context`, registry-driven with the same completeness test
- **Server-side synthesis of `EMPTY`** for authored-but-untouched elements — the fix for unknown/empty collapsing
- Per-**turn** instruction provider, not a build-time string
- Extend the composed-prompt budget test **before** writing the block

**Acceptance:** an authored, untouched table reports `EMPTY` in turn one's context; an absent element reports nothing; partial reports counts.

### M2 — Marks require verifiable evidence (backend, ~0.5d) · 1.1.69 M3

- `mark_checklist_item` refuses when the step's associated element is demonstrably empty, with a correctable reason
- Step↔element association: **infer from the step label** by default (option (a) in the doc); the explicit `elementId` field is deferred with the authoring UI

**Acceptance:** "done" on an empty table does not produce a mark; a mark still succeeds when the table has data.

### M3 — Inherited progress is labelled (backend, ~0.5d) · 1.1.70 M1

- Wire `checklist_state_summary` **and** `checkpoint_state_summary` — both currently dead
- Provenance + the continue-from-first-outstanding contract + permission to revisit
- A test that fails if either summary is defined-but-unwired

**Acceptance:** a fresh session with prior ticks contains the inherited block and does not treat them as witnessed.

### M4 — Continuity is visible to the student (fullstack, ~0.5d) · 1.1.70 M2+M3

- "Vi fortsætter, hvor I slap" line when a session opens with existing progress
- Rejoin telemetry

**Acceptance:** the line renders only with prior progress; rejoin is greppable.

### M5 — The opening knows the lesson (backend, ~0.4d) · 1.1.72

- Pass `_active_cfg` into `inject_opening_guidance`; bounded topic block; language-aware; degrades to today's greeting with no config

**Acceptance:** a wave activity opens by naming waves and does not ask the student to pick a topic.

### M6 — Voice follows the activity language (frontend, ~0.5d) · 1.1.63 M4

- Resolve the read-aloud voice from `activity.language`, persona only when languages agree; pronunciation rule set follows the same resolution

**Acceptance:** an English activity under a Danish persona reads with an English voice.

## Day-by-day

| Day | Plan |
|---|---|
| **Mon 8-11** | M1 (budget test first) → M2 |
| **Tue 8-12** | M3 → M4 → M5 |
| **Wed 8-13** | M6, full gates, tag `v0.1.12` → test, promote to prod |
| **Thu 8-14** | **PILOT.** No deploys. |

### The cut line

Drop in this order and say so:

1. **M4** student continuity line — M3 fixes the tutor's behaviour, which is the actual complaint; the UI line is the polish
2. **M6** voice — irritating, not blocking; nobody is graded on number pronunciation
3. **M5** opening — visible but cosmetic

**M1, M2 and M3 are not cuttable.** M1+M2 stop the tutor certifying work it cannot see; M3 stops it skipping a lesson. Those are assessment-integrity bugs in a week when teachers start trusting the output.

## Risks

| Risk | Mitigation |
|---|---|
| **Prompt budget** — two new per-turn blocks on an already five-way-shared budget | Extend the budget test FIRST (it caught a pre-existing overflow last sprint); bound both blocks at source |
| **Staleness** — a per-turn block composed once per session | Instruction *provider*, not a string. Test that the block changes between turns |
| **Step↔element inference is fuzzy** | Default to label matching, fail OPEN (allow the mark) when no element is confidently associated — a false refusal is worse than the status quo |
| **Four days to a pilot** | Cut line above; M1–M3 are the floor |
| **Seed** | M5 may touch `opening_template` in a `SKILL.md` → `make seed ENV=<env>` per env |
| **Promote twin** | Any new env var needs its `cloudbuild.promote.yaml` line |

## Out of scope

- **1.1.71 multi-table** — deferred. Real, asked for, and carrying a stable-id migration over data keyed `${table}::${row}::${col}`. Not four days from a pilot.
- **1.1.63 M3** student-UI i18n — still deferred.
- Ground-truth checking of table *values* (1.1.24).

## Post-sprint

The `workbench-element-builder` skill gains a **fourth** rule if M1 lands: an
element must report its fill state, not only its existence. Three of the four
rules in that skill now exist because the same class of bug shipped twice.
