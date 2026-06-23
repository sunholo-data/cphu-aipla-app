# Teacher sim resources — simulations as reusable activity resources

**Status:** **M0 catalogue + M1 render-path + M3 builder picker SHIPPED 2026-06-22** (a teacher can attach a vetted sim to an activity end-to-end); **M2 prompt composition** is the remaining pre-pilot piece (gated on AR `tutorBlock`s). M4 migration post-pilot. (**P1, pre-pilot** — additive, the 3 legacy sims coexist.)
**Last Updated:** 2026-06-22
**Priority:** **P1.** Resolves the architectural nuance surfaced 2026-06-22: a teacher should be able to **add a simulation to an activity**, and **the same simulation should appear in many activities with different learning goals, supporting questions, and formulae.** Today a sim is welded to one fixed tutor prompt (it *is* a skill, 1.1.32), so it can't be reused with a different pedagogy. This decouples the **artefact (a reusable resource)** from the **activity (the per-instance pedagogy)**.
**Estimated:** ~5–7d across the pre-pilot milestones (M0–M3); the legacy-retirement migration (M4) is post-pilot
**Scope:** Fullstack — artefact manifest + loader (`infrastructure/mcp-sandbox/` + `backend/`), `GET /api/artefacts`, `artefact_id` on `ActivityConfig`, an artefact instruction-block injection into the sim-activity tutor, a **generic** artefact frame mount (collapsing the bespoke per-sim wrappers), and a builder "Add a simulation" picker
**Dependencies:** [activity-elements-palette.md](activity-elements-palette.md) (1.1.38 — the elements that *wrap* the sim); [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J — `workbench_type="app"`); [lesson-author-surface.md](lesson-author-surface.md) (1.1.27 — the artefact block becomes a prompt source); [teacher-ux-refinement.md](teacher-ux-refinement.md) (1.1.32 — the decision this *completes*, see below); [jitt-dk-artefacts.md](../v1.0.0-pilot/jitt-dk-artefacts.md) (1.I — the catalogue's growth); [`mcp-app-artefact` skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) (the artefact path + ADR-013 gates); ADR-013 (artefact safety) + ADR-015 (unified multi-surface UI) in the scoping site
**Source:** 2026-06-22 — M: *"activities need an option to add the simulations available … simulations are perhaps another resource type we import via MCP Apps … a simulation can appear in many activities, but with different learning goals, supporting questions, formulae … a marketplace of simulations."*

> **Read this with the four docs it reconciles.** **[1.1.32](teacher-ux-refinement.md)** removed the "Paired workbench" knob — *correctly*, because it was a lie (dispatch was on the skill slug, so attaching a sim to a concept activity did nothing). This doc makes attaching a sim **actually work** by decoupling the artefact from the skill; it **completes** 1.1.32's decoupling, it does not reverse it. **[1.J](../v1.0.0-pilot/expanded-workbench-types.md)** says the workbench is *one interactive surface* with the platform elements layered on top — so a sim is the **surface** (`workbench_type="app"`), and **[1.1.38](activity-elements-palette.md)**'s checklist/table/calculator/**note** are the **per-activity pedagogy** layered on it. **[1.1.27](lesson-author-surface.md)** is where the artefact's instruction block joins the activity's goal in the resolved prompt.

## Why this exists — the crux

Today, a sim is a **bundle**. One `SKILL.md` (e.g. [`backend/skills/templates/led-planck-tutor/SKILL.md`](../../../../backend/skills/templates/led-planck-tutor/SKILL.md)) welds together:

1. the **artefact** (the iframe HTML/JS under `infrastructure/mcp-sandbox/artefacts/led-planck/v1/`),
2. a **fixed tutor prompt** (the Socratic instructions, lines ~100–164), and
3. **proactive config** (`proactiveEventReactive`, `reactiveTemplate`, …).

Because the tutor prompt is welded to the artefact, **LED Planck can only ever teach one lesson**. There is no way to say "use the LED Planck sim, but for *this* class the goal is X, the supporting questions are Y, and these are the formulae to keep in view." That is exactly what M asked for, and the current model cannot express it.

The fix is to **split the bundle**:

| Layer | What it carries | Cardinality | Where it lives |
|---|---|---|---|
| **Sim artefact** (resource) | the sandboxed iframe + its **event vocabulary** + ADR-013 safety + an **intrinsic instruction block** ("this is a projectile sim; the student sets angle/velocity; events you'll see are `play`/`show_value`/…") | **one**, shared | `infrastructure/mcp-sandbox/artefacts/<name>/v<v>/` + a new `meta.json` |
| **Activity** (pedagogy) | the **learning goal** (`teaching_goal`), **supporting questions** (Socratic prompt / quiz), **formulae** (the **note** element), **structure** (checklist) — and **a reference to the artefact** | **many** | `ActivityConfig` (the surface teachers already author) |

A simulation becomes **the richest workbench resource a teacher adds** — and everything 1.1.38 shipped (checklist / table / calculator / **note-with-formulae** / preview / templates) *is* the per-activity pedagogy that wraps it. `Boldkast`-in-activity-A and `Boldkast`-in-activity-B share the artefact but differ in goal + checklist + formulae. **That is M's sentence, expressed in the data model.**

## The hard part is already done

Two pieces that would make this scary are already generic (verified by code inspection 2026-06-22):

- **Event → tutor wiring is artefact-agnostic.** [`useArtefactReportEvent`](../../../../frontend/src/hooks/useArtefactReportEvent.ts) (denylist-shaped, SIM-ERGONOMICS 2026-06-04) forwards *any* artefact's `ui/update-model-context` events to `iframe-context` with no host edit; [`proactiveEventCheck.ts`](../../../../frontend/src/lib/proactiveEventCheck.ts) maps event keywords (`play`/`run`, `step`/`advance`, `measure`/`record`) to proactive triggers generically. **A sim dropped into an arbitrary activity already drives proactive tutor turns.**
- **`StaticArtefactFrame` already renders any artefact by path.** The per-sim `BoldkastSimFrame` / `LedPlanckLabFrame` / `KineBotFrame` are thin wrappers around it; the code already flags the follow-up: *"migrate the bespoke wrappers onto a generic artefact-iframe mount so a new sim needs no render case at all"* ([`workspaceContent.ts:19`](../../../../frontend/src/app/chat/[...path]/workspaceContent.ts)).

So this work is mostly **registration + reference + composition**, not a rebuild.

## What's missing (the seams to build)

| # | Piece | New / change |
|---|---|---|
| 1 | **Artefact catalogue** — a machine-readable manifest (per-artefact `meta.json` aggregated by a loader) replacing the hand-maintained markdown table in the `mcp-app-artefact` skill | new |
| 2 | **Activity → artefact reference** — `artefact_id` on `ActivityConfig` (the *working* version of the removed `paired_workbench`) | change |
| 3 | **Generic artefact frame mount** — collapse the bespoke per-sim frames onto `StaticArtefactFrame` keyed by `artefact_id` | change |
| 4 | **Builder "Add a simulation" picker** — browse the catalogue, like the Materials picker (the marketplace UI) | new |
| 5 | **Prompt composition** — the artefact's intrinsic block is injected into the sim-activity tutor alongside the activity's `teaching_goal` (so the same artefact tutors per-activity-goal) | new |
| 6 | **Coexistence** — the legacy 3 sim-skills keep working untouched; the new path is additive. Retiring the bundles is post-pilot (M4). | additive |

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | The artefact renders via the shipped `StaticArtefactFrame` (same path as today's sims); the catalogue picker is a fast read. No latency-path change. |
| 2 | EARNED TRUST | +1 | Teachers attach only **ADR-013-vetted** artefacts from a curated catalogue; the per-activity pedagogy (goal/questions/formulae) is teacher-authored with human provenance. Reuse-with-explicit-goals is a clarity win. |
| 3 | SKILLS, NOT FEATURES | +1 | The headline: a sim becomes a **reusable resource teachers compose into activities**, not a developer-bundled skill cut once per lesson. Adding a sim is teacher-configurable. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | No change to model usage; the artefact is deterministic; the tutor composition reuses the existing injection path. |
| 5 | GRACEFUL DEGRADATION | +1 | Unknown / unavailable `artefact_id` → the activity degrades to its chat + elements (goal, checklist, note still work). Legacy sim-skills keep working (coexistence). |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses **MCP Apps** (the artefact protocol) + `StaticArtefactFrame` + the generic event wiring. The manifest is metadata, not a new protocol — and the decoupling **deletes** bespoke per-sim frontend code. |
| 7 | API FIRST | +1 | `GET /api/artefacts` (catalogue) + `artefact_id` on the activity-config API; the builder picker + `aiplatform artefact list` consume the same contract. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Which activities use which artefact becomes queryable (catalogue + activity refs); sim events are already observable via `iframe-context`/OTel. |
| 9 | SECURE BY CONSTRUCTION | +1 | The catalogue **is** the vetting gate: a teacher can only reference an ADR-013-reviewed artefact, and `artefact_id` is a **bounded enum** validated against the catalogue (not free input, not raw HTML — that capability stays tier-3). More secure than today's implicit slug binding. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Catalogue, composition, and reference live backend; the frontend renders the artefact + picks from the catalogue. The bespoke per-sim frames **collapse** (less client code). |
| 11 | USABLE BY DESIGN | +1 | Teachers reuse a sim across activities with different goals (the headline usability win); the picker + the 1.1.40 preview make it visible. Designed empty/loading/error states for the picker + the artefact mount. |
| | **Net Score** | **+11** | Threshold ≥ +4. No −1s. Strong on SKILLS-NOT-FEATURES + SECURE (catalogue vetting). |

## Design

### 1. Artefact manifest (the catalogue)

Each artefact gains a colocated `meta.json` (so "drop an artefact dir → it self-registers"; the `mcp-app-artefact` recipe gains one step):

```jsonc
// infrastructure/mcp-sandbox/artefacts/boldkast/v1/meta.json
{
  "id": "boldkast",
  "version": "v1",
  "displayName": "Boldkast — projektilbevægelse",
  "description": "Interaktiv simulation af projektilbevægelse: vinkel, fart, rækkevidde.",
  "topics": ["kastebevægelse", "kinematik"],
  "levels": ["B", "C"],
  "language": "da",
  "eventVocabulary": ["play", "pause", "reset", "show_value", "state-change"],
  // The artefact-INTRINSIC tutor block: what the sim is + what its events mean.
  // NOT the lesson goal (that's per-activity). AR-reviewed.
  "tutorBlock": "Eleven arbejder med en projektil-simulation. De kan ændre udgangsvinkel og starthastighed og se rækkevidden. Når du ser 'show_value', har eleven afsløret et facit — spørg ind i stedet for at bekræfte.",
  "sizeBytes": 28000,
  "adr013ReviewedBy": "AR",
  "status": "live"
}
```

A backend loader aggregates the catalogue, served by `GET /api/artefacts` (teacher-auth). The hand-maintained markdown table in the `mcp-app-artefact` skill is replaced by these files (the skill points at them).

> **M0 shipped reality (2026-06-22) — adjusted for deployability.** The catalogue lives **backend-side as per-artefact YAML** (`backend/artefacts/<id>.yaml` + `backend/artefacts/loader.py` + `db/models/artefact.py`), **mirroring the shipped persona catalogue** (1.1.12) — so it deploys with the backend image rather than depending on the separate `mcp-sandbox` service at runtime. The artefact *code* stays under `infrastructure/mcp-sandbox/artefacts/<id>/v<v>/`; the *metadata* is the backend YAML. `tutorBlock` is **server-side only** — `ArtefactMeta.public()` strips it, and the no-leak property is route-tested. `artefactPath` is derived (`{id}/{version}`). The `mcp-app-artefact` recipe gains a "+ `backend/artefacts/<id>.yaml`" step.

**The "marketplace."** For v1.1 this is a **curated library** — the 3 live artefacts + the [jitt-dk 23](../v1.0.0-pilot/jitt-dk-artefacts.md) as they onboard, each ADR-013-gated. An *open* marketplace (third-party contributions + a review queue) is the Year-2 evolution that connects to [post-pilot teacher-artefact-authoring (2.4)](../post-pilot/teacher-artefact-authoring.md); the manifest + the ADR-013 gate are its backbone.

### 2. Activity → artefact reference

`ActivityConfig` gains a real reference (the working `paired_workbench`):

```python
# backend/db/models/activity_config.py
artefact_id: str | None = Field(default=None, alias="artefactId", max_length=64)
# when set, workbench_type resolves to "app" and the workspace mounts the artefact
```

Validated against the catalogue on upsert (a bounded enum — unknown id → 400). `workbench_type="app"` + `artefact_id` selects the sim surface; the activity's `checklist`/`table`/`calculator`/`note` (1.1.38) layer on top — **answering the palette's open Q1** (sim + elements compose; the [preview](activity-preview-mode.md) renders both).

### 3. Generic artefact frame mount

The frontend dispatch ([`workspaceContent.ts`](../../../../frontend/src/app/chat/[...path]/workspaceContent.ts)) gains a third path, **additive** to the legacy slug dispatch:

```
if (skillSlug ∈ SIM_WORKSPACE_SLUGS) → legacy bespoke frame   // the 3 originals, untouched
else if (activity.artefactId)        → <GenericArtefactFrame artefactPath={…}/>  // NEW
else                                  → WorkspaceElements (1.1.38) / none
```

`GenericArtefactFrame` is a thin parametric wrapper over the shipped `StaticArtefactFrame` (artefactPath from the catalogue) + the already-generic `useArtefactReportEvent`. No per-sim render case. This is the flagged follow-up, now built for the new path; the 3 bespoke frames stay for the legacy path and are deleted in M4.

### 4. Builder "Add a simulation" picker

In `/teacher/activities/new` (+ `[id]`), a **Simulation** section (sibling to the Materials picker): "Add a simulation" → a catalogue browser (filter by topic/level) → sets `artefact_id`. Single sim per activity (1.J: one interactive surface). The [1.40 preview](activity-preview-mode.md) extends to show the artefact alongside the elements — so a teacher sees the sim + their checklist/note before publishing. Sim-aware **templates** (e.g. "Boldkast + projektil-tjekliste + rækkevidde-beregner") fall out for free.

### 5. Prompt composition (the unlock)

The sim-activity tutor's system prompt composes three teacher-relevant sources at session-start:

```
SystemPrompt(sim activity) =
    BaseSkill (workbench-aware Socratic frame)
  + ArtefactBlock        (from meta.json — what the sim is / what its events mean)   ← NEW source
  + TeachingGoal         (the activity's per-instance goal — supporting questions)
  + [InteractionStyle / Persona / Curriculum]   (existing sources)
  + iframe-context state  (live sim state — existing InstructionProvider injection)
```

Implementation: the `ArtefactBlock` rides the **same focused-injection path** the shipped `{teacher_focus}` uses (an InstructionProvider keyed off `artefact_id`), so it does **not** block on the [1.1.27 `assemble_prompt()`](lesson-author-surface.md) refactor — but it **converges** into it (the artefact becomes one more attributed source in the resolved-prompt preview). This is *how* the same artefact tutors differently per activity: the artefact supplies mechanics, the activity supplies the goal.

**Base skill (Open question Q1).** Sim-activities need a workbench-aware Socratic base skill (one that expects an artefact + injects its state). Recommendation: **extend the shipped `concept-dialogue`** to be workbench-aware (it already receives `{teacher_focus}` + the InstructionProvider already injects sim state for the legacy sims) rather than mint a new skill — confirm before M2.

### 6. Coexistence + migration (phased)

- **Pre-pilot (M0–M3):** the new path is **purely additive**. The 3 legacy sim-skills (`problem-set-hints`/`led-planck-tutor`/`kinebot-kinematics-tutor`) render via their bespoke frames exactly as today. A teacher can *additionally* attach **any** catalogued artefact (incl. the 3) to a *new* activity via the new path. Nothing shipped breaks.
- **Post-pilot (M4):** migrate the 3 originals to artefact+activity (split each SKILL.md's prompt into `meta.json` `tutorBlock` + a seeded default activity), retire the bespoke frames, drop `SIM_WORKSPACE_SLUGS`. A runbook (like the KineBot migration). **Deferred so we never migrate the pilot's live sims mid-pilot.**

## API changes

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/artefacts` | GET | The artefact catalogue (id, displayName, topics, levels, status — never the raw `tutorBlock` to non-authors) | teacher |
| `/api/activity-configs` (+ `/active`) | POST/PATCH/GET | extend with `artefactId` (validated against the catalogue) | teacher / student |

CLI parity: `aiplatform artefact list` (catalogue) + `aiplatform activity set-sim <id> --artefact <artefactId>`.

## Migration

- Additive Firestore field (`artefactId`, default null) — legacy rows unchanged; legacy `paired_workbench` stays as-is (the M4 migration maps it where relevant).
- No artefact code changes pre-pilot — the 3 `index.html` files are untouched; only `meta.json` files are added.
- Feature-flag the builder Simulation picker behind a teacher-tier flag for the first 48h.
- Rollback: picker flag off + `artefactId` ignored (activity degrades to chat+elements); legacy path unaffected.

## Security

- **Catalogue = the vetting gate.** A teacher can only reference an artefact that exists in the catalogue, which means it passed the **ADR-013** gates (≤200 KB, no external fetches, no nested iframes, AR/domain sign-off, pedagogical guardrails). `artefact_id` is validated server-side against the catalogue — a bounded enum, never raw markup. Raw-HTML artefact authoring stays tier-3 ([2.4](../post-pilot/teacher-artefact-authoring.md)) with its own review.
- The artefact still renders in the **sandboxed iframe** (`StaticArtefactFrame` + CSP) regardless of which activity hosts it — the safety boundary is per-artefact, not per-skill, so decoupling does not weaken it.
- `tutorBlock` is teacher-author/AR-reviewed content reaching the model — it rides the same reviewed injection boundary as `{teacher_focus}`; no new vector.

## Milestone phasing

| MS | Deliverable | Est | Gate | Lands |
|---|---|---|---|---|
| **M0** ✅ | **Artefact catalogue — SHIPPED 2026-06-22.** `ArtefactMeta` (`db/models/artefact.py`) + `backend/artefacts/{boldkast,led-planck,kinebot}.yaml` (placeholder `tutorBlock`s) + cached loader (`backend/artefacts/loader.py`, mirrors personas) + `GET /api/artefacts` (public view, **`tutorBlock` stripped + route-tested**) + 11 tests. Backend-side YAML (deployable). *`aiplatform artefact list` CLI deferred to M3.* `tutorBlock`s are placeholders pending AR. | ~1.5d | **AR** refines the 3 `tutorBlock`s | **shipped** |
| **M1** ✅ | **Activity → artefact + generic mount — SHIPPED 2026-06-22.** `artefact_id` on `ActivityConfig` (catalogue-validated at the route — unknown → 400; resolves `workbench_type` to `app`); `/active` returns the **resolved** artefact public view (path, never `tutorBlock`); `GenericArtefactFrame` mounts **any** catalogued artefact over `StaticArtefactFrame`, forwarding the **full** structured content to the tutor (the generic path has no per-sim narrowers) with a suffix-based noise filter; the chat page mounts it as the workspace surface **above** the 1.1.38 elements (Q1: stack). Additive — the 3 legacy sims (their slug-dispatch) untouched. Backend 67 + frontend `GenericArtefactFrame` 4 tests. *Q1 base skill deferred to M2 — the render path doesn't need it; the tutor composition does.* | ~2d | — | **shipped** |
| **M2** | **Prompt composition.** Inject the artefact `tutorBlock` (focused injection, `artefact_id`-keyed) + verify the same artefact tutors per-`teaching_goal`. Generic proactive wiring confirmed for the new path. | ~1.5d | M1; **AR** on the composed prompt | pre-pilot |
| **M3** ✅ | **Builder "Add a simulation" picker — SHIPPED 2026-06-22.** `SimPicker` (browses `GET /api/artefacts?status=live`, sets `artefactId`, remove/change) in `/teacher/activities/new` + `listArtefacts` client; obsolete 1.1.32 "can't attach a sim" note replaced; the `Kastebevægelse` starter template now sets `artefactId: "boldkast"` (a real Boldkast activity). Picking a sim is all the teacher does — the `tutorBlock` comes from the catalogue. Tests: SimPicker (3) + builder-page (pick → save `artefactId`) + the 1.1.32 test re-pointed. *Status filter `live` = the JB/AR pilot-visibility gate.* | ~1.5d | JB/AR catalogue (via `status`) | **shipped** |
| **M4** | **Legacy migration** — split the 3 bundled SKILL.md prompts into `meta.json` + seeded default activities; retire bespoke frames + `SIM_WORKSPACE_SLUGS`. Runbook. | ~2–3d | none new | **post-pilot** |

**Pre-pilot scope = M0–M3** (~6.5d): teachers can attach any vetted catalogued sim to an activity with their own goal + elements, the 3 originals untouched. **M4 (retiring the legacy bundles) is post-pilot** to protect the live pilot sims.

## Testing strategy

- **Backend (pytest):** catalogue loader aggregates `meta.json` + rejects malformed/oversized; `artefact_id` validates against the catalogue (unknown → 400); `/api/artefacts` shape + auth; the artefact-block injection composes with `teaching_goal` (two activities, same artefact, different goal → different prompts).
- **Frontend (vitest):** `GenericArtefactFrame` mounts `StaticArtefactFrame` from a catalogue path + routes its events through `useArtefactReportEvent`; the dispatch chooses legacy-frame vs generic-mount vs elements correctly; the builder picker writes `artefactId`; the preview renders the artefact + elements together.
- **E2E (LOCAL_MODE):** a teacher creates two activities both using Boldkast with different goals + checklists; a student in each gets the same sim but a different tutor framing; proactive turns fire in both. Legacy Boldkast (`problem-set-hints`) still renders unchanged.
- **Regression:** the 3 legacy sim activities are byte-identical in behaviour (snapshot the bespoke-frame render + the proactive path).

## Human gates (tee up now)

1. **AR — the 3 `tutorBlock`s** (gates M0): the artefact-intrinsic instruction blocks (what the sim is + what its events mean), distinct from any lesson goal. AR owns the physics-tutoring wording.
2. **Q1 base skill — extend `concept-dialogue` vs new workbench-tutor skill** (gates M1): recommendation extend; confirm.
3. **JB/AR — pilot-visible catalogue** (gates M3): which artefacts teachers can attach during the pilot (the 3 + any jitt-dk that onboard in time).
4. **AR — the composed prompt** (gates M2): that artefact-block + goal compose into sound tutoring (reuse the verbosity/Socratic eval).

## Open questions

- **Q1 — base skill** (above): extend `concept-dialogue` to be workbench-aware vs a dedicated `workbench-tutor` base skill. Recommendation: extend.
- **Q2 — one sim per activity?** 1.J says one interactive surface; recommend one `artefact_id`. A second surface (sim + drawing) is out of scope.
- **Q3 — `meta.json` vs single `artefacts.json`.** Recommend per-artefact `meta.json` (self-registering, matches the dir structure + the `mcp-app-artefact` drop-in recipe). The loader aggregates.
- **Q4 — legacy `paired_workbench`.** Leave as legacy pre-pilot; the M4 migration decides whether to fold it into `artefact_id` or drop it.
- **Q5 — sensor/video artefacts (1.J Types 3/4).** The same reference model should carry them when they land (the manifest gains a `type`); confirm the manifest is forward-compatible (it is — add a `surfaceType` field).

## Related documents

- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38; the elements that wrap the sim (the per-activity pedagogy); answers its Q1 (sim + elements compose)
- [activity-preview-mode.md](activity-preview-mode.md) — 1.1.40; the preview extends to show artefact + elements
- [lesson-author-surface.md](lesson-author-surface.md) — 1.1.27; the artefact block becomes an attributed prompt source in the resolved-prompt preview
- [teacher-ux-refinement.md](teacher-ux-refinement.md) — 1.1.32; this **completes** its decoupling (the "Paired workbench" knob, done right)
- [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) — 1.J; `workbench_type="app"` + the one-surface principle; forward path for sensor/video artefacts
- [jitt-dk-artefacts.md](../v1.0.0-pilot/jitt-dk-artefacts.md) — 1.I; the 23 Danish apps that grow the catalogue
- [`mcp-app-artefact` skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — the artefact path + ADR-013 gates; gains the `meta.json` step + loses the markdown table
- [teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md) — 2.4; the open *marketplace* (third-party artefacts) is the Year-2 evolution of this catalogue
- ADR-013 (artefact safety) + ADR-015 (unified multi-surface UI) — scoping-site `architecture.qmd`
