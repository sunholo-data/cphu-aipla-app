# Sprint Plan: TUTOR-1 — the Tutor object (1.1.91 M0)

## Summary

Ship **M0 of [researcher-configurable-tutors.md](researcher-configurable-tutors.md)**: a `Tutor`
that carries its **theory** as structured data — `TeachingFramework` → `Construct` →
`behaviours` — plus lineage and versioning. Pure model + registry layer; no store, no
co-pilot, no UI. It is the object every later milestone (M1 store, M2 co-pilot, M3 preview,
M4 cross-view) and **[1.1.92](session-benchmark-tutor-activity.md)**'s comparison arms hang off.

**Duration:** ~1 day · **Scope:** Backend only · **Design doc:** [researcher-configurable-tutors.md](researcher-configurable-tutors.md) §M0
**Gate:** none to *ship the slots*. AR/JB own the pedagogical **content** — carried by an
explicit `status: placeholder` marker, the `authoring_framework.py` precedent.

## What changed since the design doc was written (2026-09-02)

`docs/literature/tp-framework/README.md` landed **2026-09-08** (`9cd81b56`) and supersedes
M5's framework list. This sprint is built against the README, not the doc:

| Design doc (2026-09-02) | Literature README (2026-09-08) |
|---|---|
| ESRU, SDT, dialogic/Dysthe, IBSE, "Bob Evans" | **5E, Accountable Talk, Authentic Dialogue, CER, ESRU, POE, Toulmin** |
| "phonetic transcriptions … **not verified citations**" | Seven **real citations** (Tanner 2017, Dysthe 1996, Ruiz-Primo 2006, Erduran/Simon/Osborne 2004, …) |
| "**Embodied Cognition is the umbrella**, SDT incorporated inside it" → `framework` needs a **parent** | "SDT and embodied cognition were **deferred to the conceptual framework** … **not the TP cycle**" |

So the doc's **open question 5 is answered** (ESRU = Ruiz-Primo 2006; dialogic = Dysthe 1996),
IBSE and "Bob Evans" are out, and **the umbrella/parent structure is not what the literature
set describes.** See scoping decision 2.

## Scoping decisions — deviations from the doc, recorded

**1. A `Tutor` COMPOSES a `Persona`; it does not re-declare one.** The doc's M0 sketch gives
`Tutor` its own `name, displayName, avatar, voice`, described as *"what SKILL.md already
carries."* But `db/models/persona.py` (1.1.12) already carries exactly that bundle — six
personas ship as YAML in `backend/personas/`, with a resolution chain
(`resolve_persona_chain`: activity > class > default) already wired into
`adk/interaction_style.py`. Re-declaring the four fields on `Tutor` creates **two sources of
truth for one avatar** — the half-adoption pattern the handover audit names as the worst
outcome. `Tutor.persona_id` references it instead.

**2. `framework.layer`, not the doc's `parent`.** The doc wants a parent pointer because a
persona is *"an operationalisation of"* an umbrella theory. The literature set does not
describe a tree — it describes **two separate stacks**: the TP *cycle* methods (turn/lesson
teaching moves) and the *conceptual* framework (SDT, embodied cognition) held deliberately
apart. A flat `layer: tp_cycle | conceptual` discriminator models what the README actually
says without inventing a hierarchy to hold it. ⚠️ **Confirm with JB before M5** — the doc's
own instruction, and the reason this is a decision and not a detail.

**3. `TeachingFramework`, not `Framework`.** `adk/authoring_framework.py` (1.1.50) already
owns "framework" for the **activity co-pilot's authoring pedagogy** — a different concept at
a different layer. Two `Framework`s in one backend is a bug waiting to be written.

**4. `version` ships in M0, answering open question 4 early.** 1.1.92 needs an edited tutor
to become a *new version* or earlier sessions are unattributable. An integer field now costs
nothing; retrofitting it once sessions reference tutors is a migration.

**5. Provenance is human-supplied *by construction*.** The doc makes "the co-pilot must not
invent citations" a **hard requirement, not a caution**. M2 is where a model could violate it —
so `Provenance` requires a non-empty `vouched_by` with **no default**, making an unvouched
citation unconstructable at the type level, before the co-pilot exists.

**6. ESRU is the one fully-worked framework; the other six ship as slots.** Per the
one-framework-first call: ESRU is *turn-level* (a tutor's move within one turn), so it is both
promptable and directly scoreable by 1.1.92 — the same labels are the rubric. 5E and POE are
*lesson-cycle* structures spanning a whole activity and belong nearer activity authoring;
Accountable Talk / Authentic Dialogue / Toulmin are discourse-move frameworks and make the
better second wave (Authentic Dialogue as the deliberate contrast to ESRU).

**7. ESRU verified against the primary literature (2026-09-09) — three findings.** The
sprint's first cut transcribed the README faithfully and flagged a suspected letter
discrepancy. Verification settled it and turned up two more, so the framework was rewritten
rather than merely annotated. The PDFs are **not in this checkout** — they are gitignored, so
`9cd81b56` tracked the README and nothing else — so this was checked against the publisher
record (Taylor & Francis, CU Boulder Experts, ERIC EJ742530) and STEM Teaching Tool #16, a
research brief written entirely about the 2007 paper.

| | Finding |
|---|---|
| ✅ **Four moves, confirmed** | Ruiz-Primo & Furtak name four parts — Teacher **E**licits Response · **S**tudent Responds · Teacher **R**ecognises Student Response · Teacher **U**ses Student Response. Recognise is a distinct move (revoice + compare to accepted scientific ideas), not a sub-step of Use. The README's three-move gloss was wrong; the sprint's four are right |
| ❌ **The citation was a chimera** | The README cited *"Ruiz-Primo 2006 … (J Res Sci Teach)"*, which fuses **two real papers**: the 2006 is in ***Educational Assessment*** 11(3–4) 237–263, and ***JRST*** 44(1) 57–84 is the **2007**. ESRU-as-used-here is the **2007** paper. Both now cited, plus **Duschl & Gitomer (1997)**, whose *"assessment conversation"* ESRU operationalises — lineage the README did not record |
| ❌ **Some behaviours were mine, not the paper's** | The first cut's `use` behaviours ("pitch the next question just past what the response demonstrated") are ZPD/SDT language, not ESRU. Replaced with the paper's own operational examples (p. 60): *elaborate · make the learning goal explicit · promote argumentation*. `recognise` gained the defining half it was missing — *comparing the response to accepted scientific ideas* |

**Why the third one mattered most.** The whole premise of 1.1.91 is that
`constructs → behaviours` makes a generated prompt **reviewable** — a reader checks the
prompt against the theory instead of taking it on faith. Behaviours that merely sound
pedagogical defeat exactly that, and they are the hardest kind of error to see later because
they read well. Every behaviour now traces to the source.

**Two findings from the paper now shape the framework**, and both are worth more than the
citation fix: teachers ran **incomplete cycles**, and it was the **final step (Use)** that
learning gains depended on. So `use` gets a *counterfactual* evaluation hint — *would this
turn have differed had the student answered correctly?* — rather than a presence check. And
ESRU is explicitly contrasted with **IRE/F** (Initiation–Response–Evaluation/Feedback): a
tutor that **judges** an answer rather than acting on it has degenerated to IRE/F. That is a
far sharper thing for 1.1.92 to score than "was the tutor Socratic".

⚠️ **Only ESRU was verified.** The other six citations remain as transcribed from Drive
folder names, unchecked. Given one of seven was already a conflation, the rest should not be
assumed clean.

## Milestones

### M1 — `TeachingFramework` + `Construct` + provenance
**Scope:** backend · ~0.4d
- [x] `backend/db/models/teaching_framework.py` — `Provenance` (citation + `vouched_by`, no default), `Construct` (name, behaviours, `evaluation_hint`), `TeachingFramework` (id, label, summary, `layer`, constructs, provenance, `status`, `source`)
- [x] `backend/frameworks/*.yaml` + `backend/frameworks/loader.py` — mirrors `personas/loader.py` exactly (`yaml.safe_load`, `lru_cache`, `load_frameworks()` / `load_framework(id)`)
- [x] Seven YAML files from the literature README: `esru` fully worked (4 constructs, behaviours, evaluation hints, `status: ready_for_review`); `5e`, `accountable-talk`, `authentic-dialogue`, `cer`, `poe`, `toulmin` as slots (`status: placeholder`, citation transcribed, constructs empty)
- [x] Every citation transcribed from the README — none composed

**Acceptance:** `load_frameworks()` validates all seven; `esru` yields four constructs each with ≥1 behaviour and an `evaluation_hint`; a YAML with a citation but no `vouched_by` fails validation.

### M2 — `Tutor` + lineage + versioning
**Scope:** backend · ~0.4d
- [x] `backend/db/models/tutor.py` — `TutorLineage` (`parent_tutor_id`, `kind`), `Tutor` (id, `display_name`, `persona_id`, `framework_id`, `interaction_style`, `prompt`, `prompt_provenance`, `lineage`, `version`, `status`, `author_uid`, `author_role`, timestamps)
- [x] `resolve_tutor_persona()` / `resolve_tutor_framework()` — resolution through the shipped persona chain and the new framework registry, `None`-safe
- [x] A variant validator: `kind="variant-of"` requires `parent_tutor_id`; `kind="original"` forbids it
- [x] **Not** exported from `db/models/__init__.py` — `persona.py` (1.1.12) is imported by full path and is not in `__all__` either. Followed that precedent: one convention for the newer models, and no import cycle between `db.models` and the `frameworks` package.

**Acceptance:** a `Tutor` with no `persona_id`/`framework_id` validates and resolves to the global default persona + no framework (passthrough, as `socratic` does today); a variant without a parent fails; `version` defaults to 1.

### M3 — Tests
**Scope:** backend · ~0.2d
- [x] `tests/unit/test_teaching_framework.py` — all seven load; provenance requires `vouched_by`; unknown id → `None`; `layer` is a closed enum; ESRU's four constructs
- [x] `tests/unit/test_tutor.py` — defaults; variant lineage both ways; `interaction_style` resolves to the **shipped** primitive's enum (no second enum introduced); version default; unknown persona/framework id degrades to `None` rather than raising (Axiom 5)
- [x] `make lint` + `make test-fast` green

## Out of scope (later 1.1.91 milestones)
- **M1 store** — Firestore collection, researcher/teacher tiers, variants. This sprint is the object only.
- **M2 tutor co-pilot** — `set_framework`, `set_construct_behaviours`, `draft_tutor_prompt`, `suggest_evaluation`, `critique_tutor` on the shipped `adk/authoring_tools.py` pattern.
- **M3 preview / M4 researcher cross-view / M6 clash gatekeeper.**
- **Migrating the four student SKILL.md tutors** (open question 1) — `concept-dialogue`, `kinebot-kinematics-tutor`, `led-planck-tutor`, `problem-set-hints`. Doc says "leaning migrate, after M1"; unchanged by this sprint. *(The doc says "eight of them"; four of the eight templates are teacher/help assistants, not tutors.)*
- **Wiring a tutor into a live turn.** Nothing in this sprint reaches the agent path — zero runtime behaviour change by construction.

## Success criteria
- [x] A tutor's theory is expressible as data: framework → constructs → observable behaviours, each with an `evaluation_hint` seam to 1.1.92.
- [x] Seven frameworks load from YAML with human-vouched citations; ESRU fully worked, six marked placeholder.
- [x] A fabricated citation is **unconstructable** — `vouched_by` has no default.
- [x] `Tutor` composes the shipped `Persona` and `interaction_style` rather than duplicating either.
- [x] Open question 4 (versioning) answered in the model; 5 (framework names) answered by the literature set.
- [x] No change to any agent/runtime path; `make lint` + `make test-fast` green.

## Open questions carried forward
1. **Q3 — tutor per activity, per class, or both?** Not needed for M0; needed before M1's store. 1.1.92 needs it stamped per session either way.
2. **Q1 — migrate the four SKILL.md tutors or coexist?** After M1.
3. **`layer` vs the doc's umbrella `parent`** — scoping decision 2, for JB.
4. ~~**ESRU's R** — for AR.~~ **Resolved 2026-09-09** by verification against the 2007 JRST paper: four moves, Recognise is distinct. See scoping decision 7.
5. **The other six citations are unverified**, and one of seven was already wrong. Worth an hour before M5 seeds any of them — or worth AR/Aswin confirming, since they own the corpus.
