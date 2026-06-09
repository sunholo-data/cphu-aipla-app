# Offline-lab workbench — students run the experiment offline, AI checks their entered data

**Status:** Planned (P1, design-doc stage — larger item, post-mid-point build)
**Last Updated:** 2026-06-09
**Priority:** **P1** — 9 June check-in. The lab experiments teachers actually use today (Haka Fysik / matematikfysik.dk) are **PDFs, not interactive**. Teachers want the hands-on experiment to stay physical while the AI catches data-entry mistakes — keeping the experiment real and the friction *visible* (the 9 June "deliberate friction" thread).
**Estimated:** ~3–4d (new data-entry workbench surface + ground-truth checking layer + error-flagging chat behaviour), after the design questions below are resolved. **Not sprintable until this doc settles the ground-truth model.**
**Scope:** Fullstack — a data-entry workbench surface (extends [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) Type 5 lab-notebook) + a per-experiment **expected-values / ground-truth** definition + tutor error-flagging behaviour + activity-config authoring of the experiment spec.
**Dependencies:** [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J — Type 5 `lab-notebook` is the surface this specializes); [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19 — the experiment is a teacher-authored activity; `notebook` workbench type is its M4); [curriculum-library.md](curriculum-library.md) (the Haka/matematikfysik-style PDFs become referenceable materials); ADR-013 (artefact safety — the notebook is a native React component, not an iframe, so the ADR-013 iframe gates do not apply); a `lab-troubleshoot`-style skill prompt
**Source brief:** [`june-09-feedback-sprint-brief.md` §B](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md)

## Problem

Real Danish stx physics labs are **offline and paper-driven**. The materials teachers use (Haka Fysik, matematikfysik.dk) are static PDFs describing a procedure. Students do the experiment with physical equipment, write down measurements, and the feedback loop on whether their *data* is sane happens (if at all) when the teacher walks past.

The wanted pattern, in the teacher's words: **teacher sets up the experiment → students run it offline and enter their measurements → the AI checks the entered data for mistakes in chat.** The experiment stays hands-on (the pedagogy teachers value); the AI is a real-time sanity check on the numbers, not a replacement for doing the lab.

This is squarely the 9 June **deliberate-friction** principle: the AI removes the *wrong* friction (a student silently recording a physically impossible value and only finding out a week later) while keeping the *right* friction (actually performing the measurement). And it is **formative** — "your third reading looks off, re-measure" — not a grade.

The hard part is **how the AI knows what's right** without hallucinating. A model told "check if 9.8 m/s² is reasonable for g" is fine; a model guessing whether a student's measured resistance is plausible for *their specific resistor* will confidently invent. This doc must resolve the ground-truth model before anyone builds it.

## Goals

**Primary goal:** A teacher authors an **offline-lab activity** — a structured data-entry table plus an expected-values spec — and a student doing the physical experiment enters readings and gets **chat feedback that flags entries inconsistent with the expected ranges**, without the AI inventing the expected values.

**Success metrics:**
- A teacher defines an experiment with N measurement fields and expected ranges/relationships in the activity builder, no developer.
- A student enters a value outside the expected range → the tutor flags it **in chat** with a question ("your second reading is 5× the first — re-check the units or re-measure"), not a silent pass and not an auto-corrected number.
- The AI **never asserts an expected value the teacher didn't supply** (anti-hallucination — measured by eval).
- Works on a shared phone/tablet (no laptop), single-column data entry.
- Formative: feedback is "re-measure / re-check," never a score.

**Non-goals:**
- Replacing the physical experiment with a simulator (that's the Boldkast/sim path — opposite intent; here the lab is real).
- Auto-grading lab reports (summative — excluded).
- Live sensor capture (that's Type 3 experiment-tool, 1.J — a different, sensor-permission-gated surface; this is *manual* entry of offline readings).
- Authoring *new* PDFs/procedures (teachers bring existing Haka/matematikfysik material via [curriculum-library.md](curriculum-library.md)).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Range/relationship checks are **deterministic and local** (no model call) → instant inline flag; the tutor's chat explanation streams after. The fast check is not gated on the LLM. |
| 2 | EARNED TRUST | +1 | **The crux.** Expected values are **teacher-supplied ground truth**, cited as the basis of every flag ("outside the range your teacher set: 9.6–10.0"). The model is forbidden from inventing expected values — it reasons over supplied ground truth only. Highest-leverage axiom here. |
| 3 | SKILLS, NOT FEATURES | +1 | An offline-lab is a teacher-authored activity type, configured in the builder — no developer per experiment. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Deterministic range/consistency checks do the numeric work (zero tokens); the model is used only to *explain* a flagged inconsistency Socratically. No reasoning model crunching numbers. |
| 5 | GRACEFUL DEGRADATION | +1 | No expected spec on a field → the AI asks a generic "does this look right to you?" instead of asserting; malformed entry → inline validation, chat still works; model down → the deterministic flag still fires. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses Type 5 `lab-notebook` (native `LabNotebookFrame`, host session-state push) + activity-config schema; the expected-values spec is a small Pydantic extension, not a new protocol. |
| 7 | API FIRST | +1 | Experiment spec + entered readings + check results are an API/activity-config surface; CLI can author and test. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Entries, flags raised, and re-measure events → OTel spans → BigQuery; a cohort signal of which readings classes consistently get wrong feeds engagement (1.1.17) and tells the teacher which step of the procedure is unclear. |
| 9 | SECURE BY CONSTRUCTION | +1 | Native React notebook component (**not** an iframe) keeps it inside the trust boundary — no ADR-013 sandbox surface added; teacher-authored spec is structured/validated, not executable. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | The numeric checks and the ground-truth live backend; the notebook frame renders fields and pushes state. |
| 11 | USABLE BY DESIGN | +1 | Single-column data entry for shared phones; flagged-cell + inline error + "re-measure" states designed up front; empty (no readings yet → procedure prompt), partial, and out-of-range states specified. |
| | **Net Score** | **+11** | Threshold: ≥ +4. |

**Conflict Justifications:** none. The risk axis (hallucinated expected values) is converted to a **+1 on EARNED TRUST** by the teacher-supplied-ground-truth-only constraint, which is the central design decision.

## Standards compliance

- **Surface:** Type 5 `lab-notebook` from [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) — a native `LabNotebookFrame` React component with fields from activity config, host-session-state push on debounced edit (no RPC handshake, no iframe). This doc specializes it with typed numeric fields + expected-values metadata.
- **Activity definition:** extends [teacher-activity-authoring.md](teacher-activity-authoring.md)'s `ActivityConfig` with an experiment spec (below); reuses `materials` for the source PDF.
- **No new protocol** (Axiom 6).

## Design

### The experiment spec (teacher-authored ground truth)

The anti-hallucination decision, concretely: the teacher authors **typed measurement fields with expected ranges and/or relationships**. The AI checks against *these*; it does not source expected values from its own knowledge.

```python
# extends ActivityConfig (offline-lab activity)
class MeasurementField(BaseModel):
    id: str
    label: str                      # "Reading 1 — voltage U₀ (V)"
    unit: str                       # "V"  — surfaced to the student; drives the units-loop
    expected_min: float | None = None
    expected_max: float | None = None     # teacher's plausible range; None = no range check
    sig_figs: int | None = None

class ExpectedRelationship(BaseModel):
    # lightweight, declarative — NOT a formula engine
    kind: Literal["monotonic_increasing", "monotonic_decreasing",
                  "roughly_constant", "ratio_within"]
    fields: list[str]               # field ids the relationship spans
    tolerance: float | None = None  # for ratio_within / roughly_constant

class ExperimentSpec(BaseModel):
    fields: list[MeasurementField]
    relationships: list[ExpectedRelationship] = []
    procedure_material: MaterialRef | None = None   # the Haka/matematikfysik PDF
    expected_conclusion: str = ""   # teacher's one-line "what they should find" (e.g. "g ≈ 9.8 m/s²")

# on ActivityConfig:
workbench_type = "notebook"         # (1.J lab-notebook)
experiment: ExperimentSpec | None = None
```

Design stance: **ranges and declarative relationships, not a symbolic-math engine.** v1.1 covers "is this value in a plausible band" and "should these readings trend / be constant / hold a ratio." Anything richer (propagating a formula, computing g from a slope) is either (a) the teacher pre-computing the expected band, or (b) a v1.2 calculation layer. Keep the spec declarative so a teacher can author it in a form.

### The checking layer (deterministic first, model second)

Two stages, in order — the deterministic stage gates the model:

1. **Deterministic check (backend, zero tokens):** on each committed reading, validate against `expected_min/max`, `sig_figs`, and `relationships`. Produces structured flags: `{field, kind: "out_of_range"|"relationship_violated"|"missing_unit", detail}`.
2. **Tutor explanation (model, only when a flag fires):** the flags are injected into the tutor context with the **teacher's ground truth as the only authority**. The tutor asks a Socratic question about the specific flag. The prompt forbids asserting expected values not in the spec:

```
The student entered lab readings. Deterministic checks flagged:
  {flags}     # structured, with the teacher's expected ranges as the basis
The teacher's expected ranges/relationships are the ONLY source of truth for
what is "expected". Do NOT state an expected value the teacher did not provide.
For each flag: ask one question that prompts a re-measure or unit re-check.
If the student asks "what should it be?" and the teacher gave a range, you may
state the teacher's range; otherwise say it depends on their setup.
Formative: re-measure / re-check, never a grade.
```

This is the same "don't invent, work from supplied ground truth" discipline as [end-of-class-notes-summary.md](end-of-class-notes-summary.md).

### Units loop (shared with multimodal)

A `MeasurementField.unit` that the student leaves blank or mismatched triggers the **units-loop** behaviour from [student-multimodal-upload.md](student-multimodal-upload.md) §units-loop ("What are the units?") — the same rigor-demand, here on typed entry rather than an uploaded graph. One shared behaviour, two entry surfaces.

### Student surface

```
┌─ Frihjuls-eksperiment (lab-notebook) ───────────────┐
│  Procedure: [ open Haka Fysik p.3 ▾ ]   (material)  │
│                                                     │
│  Reading 1 — U₀ (V)   [ 1.8  ]                       │
│  Reading 2 — U₀ (V)   [ 9.0  ] ⚠  outside 1.5–2.5    │  ← deterministic flag, inline
│  Reading 3 — U₀ (V)   [      ]                       │
│                                                     │
│  (tutor in chat): "Reading 2 is ~5× the others and  │
│   outside the range your teacher set. Did the unit  │
│   change, or is it worth re-measuring?"             │
└─────────────────────────────────────────────────────┘
```

Single column, reflows for shared-phone portrait. States (Axiom 11): empty (procedure prompt, no readings), partial (some fields), flagged (⚠ cell + chat question), complete (all in range → tutor invites the conclusion vs `expected_conclusion`).

## API changes

| Endpoint | Change | Auth |
|---|---|---|
| `GET /api/activities/{id}` | include `experiment` spec **without** raw `expected_*` if we choose to hide bands from students (Q2) | student/teacher |
| `POST /api/sessions/{id}/lab-reading` | **New** — commit a reading; runs deterministic checks; returns flags; pushes flagged state to the tutor context | student (group) |
| `POST/PATCH /api/activity-configs` | extend body with `experiment` spec | teacher |

Reading commit rides the existing debounced lab-notebook session-state push (1.J) rather than a chatty per-keystroke call.

## CLI surface

| Command | Purpose |
|---|---|
| `aiplatform activity new --type notebook --experiment <spec.yaml>` | author an offline-lab from a spec file |
| `aiplatform activity check-reading <id> --field <f> --value <v>` | run the deterministic checker against a fixture (eval/ops parity, anti-hallucination tests) |

Backlink: [local-dev-cli](../../v6.1.0/local-dev-cli.md).

## Migration

- Additive `experiment` field on `ActivityConfig`; legacy activities unaffected.
- Reuses the 1.J `LabNotebookFrame` once it lands (this doc is a **consumer** of 1.J Type 5 — sequence after it, or co-build the typed-numeric extension).
- BQ: lab readings + flags as `activity_events` (co-design with [student-engagement-signals.md](student-engagement-signals.md), same as 1.1.19 M5).
- Rollback: hide the workbench type; spec ignored.

## Testing strategy

- **Backend (pytest):** deterministic checker — out-of-range, relationship violations (monotonic, ratio, roughly-constant), missing unit; **the model is never asked to supply an expected value** (assert the prompt-injection content includes only teacher-supplied ranges); spec validation (ranges sane, relationship field ids exist).
- **Frontend (vitest):** notebook renders typed fields + units; out-of-range entry shows the ⚠ inline flag; single-column reflow; empty/partial/flagged/complete states.
- **Eval (anti-hallucination — the key gate):** a curated set of flagged readings where the teacher gave **no** expected value → the tutor must ask, not assert; where the teacher gave a range → the tutor may cite *that* range and nothing else. Score: zero invented expected values.
- **E2E (LOCAL_MODE):** author a 3-reading experiment with a range on reading 2 → enter a wild value → inline flag + tutor re-measure question → correct it → tutor invites the conclusion.

## Human gates (tee up to JB/AR)

1. **JB/AR — the ground-truth model** (gates build): confirm "ranges + declarative relationships, teacher-authored, no symbolic-math engine in v1.1" is the right scope; provide 1–2 real Haka/matematikfysik experiments to model the spec against.
2. **JB/AR — show or hide the expected band from the student** (Q2): does the student see "expected 1.5–2.5" (transparent) or only the flag (more discovery)? Pedagogical.
3. **JB — materials/PDF source + copyright** for the procedure docs (ties to [curriculum-library.md](curriculum-library.md) and the Strand C exam-archive copyright question — do not ingest copyrighted PDFs without clearance).

## Open questions

- **Q1 — relationship expressiveness:** is `monotonic / roughly_constant / ratio_within` enough for the real experiments, or is a slope/regression check (e.g. compute g from a v–t slope) needed in v1.1? Recommend the declarative set for v1.1; a calculation layer is v1.2. Validate against JB's two real experiments.
- **Q2 — expected band visibility** (see gate 2).
- **Q3 — relation to Type 3 sensor capture:** offline-lab is *manual* entry; if a class has phone sensors, does the same activity accept live capture (1.J Type 3)? Keep separate for v1.1 (Type 3 is sensor-permission-gated); a later activity could offer both entry modes.
- **Q4 — multi-student shared notebook:** on one shared phone, is the notebook the group's (yes, per ADR-001 group model). Concurrent entry from multiple devices on one group code is out of scope for v1.1.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Model invents expected values** (the headline risk) | High if unguarded | Deterministic-first checking; ground-truth-only prompt; anti-hallucination eval as a ship gate; "depends on your setup" fallback when no range given |
| Teachers find authoring ranges tedious | Medium | Default to relationship-only checks (monotonic/constant) which need no numbers; ranges optional per field; seed from JB's real experiments |
| Real experiments need real formulas (Q1) | Medium | Declarative scope for v1.1; pre-computed bands as the escape hatch; calculation layer flagged as v1.2 |
| Depends on 1.J Type 5 not yet built | Medium | Co-build the typed-numeric lab-notebook extension; sequence after or alongside 1.J |
| Copyrighted procedure PDFs | Medium | Gate on JB/curriculum-library clearance; teacher-uploaded or cleared corpus only |

## Success criteria

- [ ] Teacher authors an offline-lab activity (typed fields + ranges/relationships + procedure material) in the builder, no developer.
- [ ] Student entry outside a teacher-set range → inline ⚠ flag + tutor Socratic re-measure question in chat.
- [ ] Deterministic checks (range, monotonic, ratio, roughly-constant, missing-unit) run with zero tokens before any model call.
- [ ] Units-loop fires on a blank/mismatched unit (shared behaviour with 1.1.7).
- [ ] **Anti-hallucination eval passes: zero invented expected values** when the teacher supplied none.
- [ ] Single-column entry reflows on shared-phone portrait; empty/partial/flagged/complete states designed.
- [ ] Readings + flags land in BigQuery (consent-gated, co-designed with 1.1.17).
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green.

## Related documents

- [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) — 1.J; Type 5 `lab-notebook` is the surface this specializes (hard dependency)
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19; the offline-lab is a teacher-authored `notebook` activity (its M4)
- [curriculum-library.md](curriculum-library.md) — the Haka/matematikfysik procedure PDFs as referenceable materials
- [student-multimodal-upload.md](student-multimodal-upload.md) — 1.1.7; shares the units-loop behaviour
- [end-of-class-notes-summary.md](end-of-class-notes-summary.md) — shares the "check against supplied ground truth, don't invent" discipline
- [student-engagement-signals.md](student-engagement-signals.md) — 1.1.17; co-design the readings/flags BQ shape
