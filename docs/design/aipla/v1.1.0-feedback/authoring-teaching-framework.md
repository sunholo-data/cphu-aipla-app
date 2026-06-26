# Activity-authoring teaching framework — researcher-authored meta-prompt rules the co-pilot follows

**Status:** Design (OPEN) — **feasibility-now assessment + the framework layer** over [1.1.39 activity-authoring-assistant](activity-authoring-assistant.md)
**Priority:** **P1** — research enabler. The pedagogical framework is the part of "teachers make good bots" that the *researchers* own; this doc is where their rules become a versioned, role-gated artefact instead of a constant baked into a skill template.
**Estimated:** ~2–3d on top of [1.1.39](activity-authoring-assistant.md) M0 (framework-as-a-layer ~0.5d · structure rubric + eval ~1d · researcher override store ~1–1.5d, mostly [1.1.47](prompt-transparency-and-config.md) M2 reuse · version provenance ~0.5d)
**Scope:** Backend-heavy — the authoring agent's system-prompt *layer* (`backend/skills/templates/activity-authoring-assistant/SKILL.md` default ⊕ a researcher Firestore override), a **structure rubric** the agent's tools honour + the eval scores against, and the researcher edit/version surface (rides [1.1.47](prompt-transparency-and-config.md) M2). No new student surface.
**Dependencies:** [1.1.39 activity-authoring-assistant](activity-authoring-assistant.md) (**OPEN** — the chat panel + activity-mutating tools this steers; **its `SKILL.md` system prompt is what this doc makes researcher-configurable**); [1.1.47 prompt-transparency-and-config](prompt-transparency-and-config.md) (**OPEN** — the override⊕default Firestore store + registry this rides; the framework is one registered prompt layer); [1.1.5 researcher-role](researcher-role.md) (**SHIPPED** — ADR-016; the role gate for authoring + versioning the framework); [1.1.38 activity-elements-palette](activity-elements-palette.md) (**SHIPPED** M0–M4 — the palette the structure rubric references); [1.1.27 lesson-author-surface](lesson-author-surface.md) (**OPEN** — the resolved-prompt preview that makes the active framework version legible); ALS-1 / ALS-SHARE activity store (**SHIPPED** — `ActivityUpsert` / `create_activity` / `save_activity`, the owner-scoped write target)
**Created:** 2026-06-26 (M)
**Last Updated:** 2026-06-26 (M)

> **This is the synthesis doc, not a fourth assistant.** [1.1.39](activity-authoring-assistant.md) already designs the chat interface (an AG-UI panel beside the builder whose ADK tools propose edits to the activity draft) and [1.1.47](prompt-transparency-and-config.md) already designs the configurable-prompt substrate (override⊕default in Firestore, role-gated, no reseed). This doc answers the two questions those predate: **(1) is the AI co-pilot buildable now?** — yes, the basis shipped — and **(2) how do the researchers' pedagogical rules become a real, editable artefact** rather than a static prompt? It defines the **teaching-framework meta-prompt**: a researcher-authored, versioned, role-gated layer that steers the [1.1.39](activity-authoring-assistant.md) agent toward well-structured activities.

## Feasibility verdict (the "can we?" answer)

**Yes — and the basis is materially stronger than when [1.1.39](activity-authoring-assistant.md) was written (2026-06-17).** Every load-bearing primitive the co-pilot needs is now shipped; what remains is wiring + the researchers' framework content. The honest gate is **pedagogical, not technical**: the assistant is only as good as the framework AR/JB author and the eval that holds it to that bar.

| The co-pilot needs… | State (2026-06-26) | Evidence |
|---|---|---|
| A **palette** to assemble (`add_element`) | **SHIPPED** — checklist, table, chart, calculator, note (+ solution, document) on the registry | [1.1.38](activity-elements-palette.md) M0–M4; `ELEMENT_REGISTRY` |
| An **owner-scoped write target** for the tools | **SHIPPED** — `POST`/`PATCH /api/activities`, `create_activity` / `save_activity`, class-independent `Activity` | ALS-1 / ALS-SHARE; `protocols/activity_routes.py` |
| Tools that **read the authed user** (owner-scoping) + **write** | **SHIPPED primitives** — `tool_context.state["user:id"]`; tools already write `tool_context.state` | `backend/adk/tools.py:57,124` |
| A **role** to gate framework authoring | **SHIPPED** — `role:researcher` claim + ACL bypass | [1.1.5](researcher-role.md) / ADR-016; ALS-SHARE researcher CRUD |
| A **configurable prompt store** (edit without reseed) | **DESIGNED** — override⊕default merged at session start | [1.1.47](prompt-transparency-and-config.md) M2 |
| A **teacher-auth AG-UI chat** surface | **STACK EXISTS** — student tutors run it; teacher-token wiring is the known risk | [1.1.39](activity-authoring-assistant.md) auth callout |

**Net:** the chat assistant is "mostly tool-wiring" exactly as [1.1.39](activity-authoring-assistant.md) predicted, *because* the palette + write API + role shipped in the interim. The one genuinely-new design surface is **this doc's framework layer**.

## Why this exists

[1.1.39](activity-authoring-assistant.md) names the agent's system prompt **"Aswin's meta-prompt"** and treats it as a single static string that lands in the scoping site and gets seeded into the `SKILL.md`. That is right for M0, but it under-serves what this is *for*: AIPLA is a **research programme**, and *how an activity should be pedagogically structured* is a **research variable the researchers must be able to author, version, and tune** — not a constant frozen behind a code edit + `make seed`.

Three needs the static-prompt framing doesn't meet:

1. **It's a framework, not just interview guidance.** "Be Socratic, ask the teacher what they teach" is style. The researchers also want the assistant to produce activities with a **sound pedagogical structure** — e.g. learning-objective-first, activate prior knowledge, a Socratic scaffold, a formative checkpoint, curriculum grounding. That structure is a *checkable rubric*, not just prose, and it should drive which [palette](activity-elements-palette.md) elements the co-pilot proposes.
2. **Researchers must edit it without a deploy.** The research loop is *hypothesis → change the framework → measure across the next cohort of authored activities*. With the framework as a seeded `SKILL.md` constant, that loop costs a code edit + redeploy + reseed, so it doesn't happen. [1.1.47](prompt-transparency-and-config.md)'s override⊕default store is exactly the unblock — this doc is its first high-value tenant.
3. **Cohort comparability.** AI-assisted authoring diverges activities across classes (the risk [1.1.39](activity-authoring-assistant.md) and [teacher-activity-authoring.md](teacher-activity-authoring.md) both flag). If every authored activity is **stamped with the framework version that produced it**, studies can control for it — turning a confound into a measured variable.

## What it is (and is not)

- **It is** the **researcher-owned layer** of the [1.1.39](activity-authoring-assistant.md) co-pilot: a versioned *teaching-framework meta-prompt* = (a) the agent's **system-prompt** (how to interview + draft, Danish-first) **plus** (b) a **structure rubric** (what a well-formed activity must contain) that both steers the agent's tool-calls and is scored by the eval.
- **It is** a **registered prompt layer** ([1.1.47](prompt-transparency-and-config.md)): `framework_default` ships in git; a `researcher_override` lives in Firestore, merged at session start, versioned + audited, picked up next session **with no reseed**.
- **It is not** a new agent, chat panel, tool set, or write path — those are [1.1.39](activity-authoring-assistant.md). This doc only specifies *the prompt the agent runs on* and *how researchers own it*.
- **It is not** teacher-editable. Teachers steer their activity via the shipped `interaction_style` + goal (and, later, a custom persona — [1.1.47](prompt-transparency-and-config.md) M3). The **framework** — the pedagogical skeleton applied to *all* teachers' authoring — is researcher-gated. (Students never.)
- **It is not** autonomous authoring. The framework shapes **proposals**; the teacher still accepts/edits/publishes every one (EARNED TRUST, inherited from [1.1.39](activity-authoring-assistant.md)).

## Design

### 1. The framework as a registered prompt layer (rides 1.1.47)

The authoring agent's instruction resolves the same override⊕default way [1.1.47](prompt-transparency-and-config.md) defines for tutor prompts:

```
authoring SKILL.md default  (git — ships a sane starter framework)
  → researcher framework override   (Firestore; versioned; role:researcher)        ← THIS DOC
  → runtime context (the teacher's described topic/level, curriculum hits)
```

One registry entry (`authoring.teaching_framework`) in the [1.1.47](prompt-transparency-and-config.md) prompt registry; the seed-pipeline guard already specified there applies verbatim (**`make seed` writes the git default, never clobbers a researcher override**). Until [1.1.47](prompt-transparency-and-config.md) M2 lands, the framework is the seeded `SKILL.md` (static) — i.e. **[1.1.39](activity-authoring-assistant.md) M0 works without this doc**; this doc is what makes the framework *live-editable*.

### 2. The two parts of the framework artefact

| Part | What it is | Who authors | Consumed by |
|---|---|---|---|
| **System prompt** | How to interview a teacher, the Danish-first register, conciseness, the "propose don't impose" stance | AR/JB (pedagogy) | the [1.1.39](activity-authoring-assistant.md) agent's instruction |
| **Structure rubric** | The checkable skeleton a well-formed activity must satisfy — e.g. *has a stated learning objective · activates prior knowledge · a Socratic scaffold (not answer-giving) · a formative checkpoint · grounded in a real fagligt mål* | AR/JB | (a) steers tool-calls; (b) the **eval** scores assistant output against it |

The rubric is the bridge from "nice prose" to "measurable structure": it both **biases the agent's tool selection** (a rubric line "every activity has a formative checkpoint" → the co-pilot proposes a `checklist`/`solution` element) and **is the eval's scoring key** (reuse [1.1.39](activity-authoring-assistant.md)'s eval gate — the assistant's drafts are scored against the *current framework version's* rubric, AR sign-off).

### 3. How the framework steers the shipped tools

The framework doesn't need new tools — it *constrains the existing [1.1.39](activity-authoring-assistant.md) ones*. Each rubric line maps to a tool the co-pilot should reach for:

| Framework rubric line (researcher-authored, illustrative) | Steers the co-pilot toward |
|---|---|
| "State the learning objective up front" | `set_lesson_prompt` opens with the objective |
| "Activate prior knowledge before new content" | `propose_checklist` step 1 / the Socratic opening |
| "Include a formative checkpoint" | `add_element('checklist'\|'solution')` |
| "Ground in the syllabus at the right A/B/C level" | `suggest_materials` (curriculum retrieval) |
| "Keep tutor turns Socratic, ≤3 sentences" | `set_interaction_style('socratic')` + the 1.1.1 verbosity constraint |

This is why the palette shipping ([1.1.38](activity-elements-palette.md)) is the unlock: the rubric can *require* structure the co-pilot can actually assemble.

### 4. Researcher authoring + versioning surface

Rides [1.1.47](prompt-transparency-and-config.md) M2 (researcher config store): a `role:researcher` editor to **view → edit → version** the framework, audited, with the resolved-prompt preview ([1.1.27](lesson-author-surface.md)) showing the active framework so a researcher sees exactly what the co-pilot will run on. CLI parity via `aiplatform prompts` (the [1.1.47](prompt-transparency-and-config.md) surface) so studies are scriptable (API FIRST). No bespoke surface — this is one tenant of the [1.1.47](prompt-transparency-and-config.md) store.

### 5. Framework-version provenance (the research signal)

Every activity the co-pilot helps author is stamped with `authoringFrameworkVersion` (+ the accept/edit/reject provenance trail [1.1.39](activity-authoring-assistant.md) M4 already specifies). So a study can ask "did framework v3 produce better-structured activities than v2?" — the divergence risk becomes a measured variable. Stamp lives on the `Activity` (additive field; same shape as the ALS-SHARE provenance fields).

### 6. Graceful degradation

No researcher override → the git-default framework ships (never blank). [1.1.47](prompt-transparency-and-config.md) store down → fall back to the seeded `SKILL.md` default. Assistant/model down → the **manual builder works unchanged** ([1.1.39](activity-authoring-assistant.md) Axiom 5). The framework is additive at every layer.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Framework merged at session start (not per-token) + cached; no hot-path cost. Inherits [1.1.39](activity-authoring-assistant.md)'s "drafting…" honesty for tool-call proposals. |
| 2 | EARNED TRUST | **+1** | The pedagogy driving the co-pilot becomes **legible + attributable** (resolved-prompt preview) and every authored activity carries its framework version. Biggest reproducibility win for a research platform. |
| 3 | SKILLS, NOT FEATURES | **+1** | The framework is a property of the authoring *skill*, configured at the skill/prompt layer — not a hidden constant. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Orthogonal to routing; inherits [1.1.39](activity-authoring-assistant.md)'s cloud-tier choice for the drafting agent. |
| 5 | GRACEFUL DEGRADATION | **+1** | Override⊕default at every layer (researcher override → git default → manual builder). A missing/invalid framework is a non-event. |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Reuses [1.1.47](prompt-transparency-and-config.md)'s registry + override store, [1.1.5](researcher-role.md)'s claim, [1.1.39](activity-authoring-assistant.md)'s agent + tools, [1.1.38](activity-elements-palette.md)'s palette. Framework stays markdown — no new format. |
| 7 | API FIRST | **+1** | The framework is read/written via the [1.1.47](prompt-transparency-and-config.md) prompt API + `aiplatform prompts` CLI — researchers script studies; the editor is just one client. |
| 8 | OBSERVABLE BY DEFAULT | **+1** | Framework version + the accept/edit/reject trail → OTel → BQ: a first-class research signal on which framework produces which authoring behaviour. |
| 9 | SECURE BY CONSTRUCTION | 0 | A researcher-editable prompt that steers a write-capable agent is a new tuning surface — held neutral by: `role:researcher` gate, sanitised-markdown-only (no `eval`, [1.1.47](prompt-transparency-and-config.md) posture), versioned + audited, and the framework only shapes **proposals** the teacher must still accept ([1.1.39](activity-authoring-assistant.md)). No new injection path beyond [1.1.47](prompt-transparency-and-config.md)'s. |
| 10 | THIN CLIENT, FAT PROTOCOL | **+1** | Resolution + provenance server-side; the editor renders text + a version badge. |
| 11 | USABLE BY DESIGN | **+1** | Makes the pedagogy legible + tunable for the researchers who own it; the co-pilot it steers is itself the affordance that turns a blank builder into a guided one ([1.1.39](activity-authoring-assistant.md) Axiom 11). Researcher/teacher-facing — student hard-fail rule doesn't bind. |
| | **Net Score** | **+8** | Threshold ≥ +4. INSTANT + SECURE held at 0 by construction (justified). No student-facing −1. Passes. |

## Milestones

Ordered so the framework can ship **statically with [1.1.39](activity-authoring-assistant.md) M0** and become live-editable as [1.1.47](prompt-transparency-and-config.md) lands.

| MS | Deliverable | Est | Gate |
|---|---|---|---|
| **M0** | **Framework-as-a-layer.** A starter `framework_default` in the authoring `SKILL.md` + a `authoring.teaching_framework` registry entry; the [1.1.39](activity-authoring-assistant.md) agent runs on it. (Static — `make seed` to change.) | ~0.5d | **AR/JB framework content** + [1.1.39](activity-authoring-assistant.md) M0 |
| **M1** | **Structure rubric + eval.** The rubric as a checkable artefact; the [1.1.39](activity-authoring-assistant.md) eval scores assistant drafts against the *current* rubric version (AR sign-off on the scoring key). | ~1d | AR rubric |
| **M2** | **Researcher override store.** Edit/version the framework in Firestore, role-gated + audited, no reseed; resolved-prompt preview shows the active version. **Rides [1.1.47](prompt-transparency-and-config.md) M2.** | ~1–1.5d | [1.1.47](prompt-transparency-and-config.md) M2 |
| **M3** | **Framework-version provenance.** Stamp `authoringFrameworkVersion` on authored activities; join to the [1.1.39](activity-authoring-assistant.md) M4 accept/reject trail in BQ. | ~0.5d | [1.1.39](activity-authoring-assistant.md) M4 |

**Core = M0–M1** (the framework + the bar that holds it). M2 unblocks the live research loop; M3 makes it measurable. M0 is independently valuable the moment AR/JB's content lands — it *is* the "Aswin meta-prompt" slot in [1.1.39](activity-authoring-assistant.md), just specified as a versionable artefact from day one.

## Open questions / human gates

1. **AR/JB — the framework content (blocking).** The system prompt + the structure rubric for stx physics: what makes a *well-structured* activity (objectives, prior-knowledge, Socratic scaffold, formative checkpoint, level calibration). This is the pedagogical source-of-truth; it lands in the scoping site (`strand-a-pedagogical-bot/`) and is wired here. **Everything else is engineering.** Supersedes/absorbs the "Aswin meta-prompt" gate in [1.1.39](activity-authoring-assistant.md) M0.
2. **AR — eval scoring key (gates M1):** how the rubric is scored (binary per line vs weighted), and the pass bar for an assistant draft.
3. **M — versioning + retention (gates M2):** how long framework versions are retained for study reproducibility (reuse [1.1.47](prompt-transparency-and-config.md) Q3).
4. **JB — teacher visibility:** does a teacher *see* the framework that shaped their draft (transparency), or only the resolved activity? Recommendation: show it read-only in the resolved-prompt preview ([1.1.27](lesson-author-surface.md)); editing stays researcher-only.
5. **Relationship to [1.1.39](activity-authoring-assistant.md):** this doc **generalises [1.1.39](activity-authoring-assistant.md)'s static "Aswin meta-prompt" into a versioned framework layer.** [1.1.39](activity-authoring-assistant.md) M0's gate should point here on its next edit (no duplication — a pointer both ways).

## Risks

- **The framework content is the single dependency.** No AR/JB framework → M0 ships a placeholder behind the teacher-tier dark flag (same posture as [1.1.39](activity-authoring-assistant.md)); the manual builder never depends on it.
- **Plausible-but-mediocre structure.** The eval (M1) against the researcher rubric is the guard — the assistant is held to the *researchers'* bar, not the model's instinct.
- **Researcher-prompt tuning surface (security).** Held neutral by the [1.1.47](prompt-transparency-and-config.md) posture (role-gated, sanitised, audited) + proposals-not-writes ([1.1.39](activity-authoring-assistant.md)).
- **Coupling to two OPEN docs.** M2 depends on [1.1.47](prompt-transparency-and-config.md) M2; M0–M1 deliberately don't, so the framework ships statically first and gains live-editability later.

## Success criteria

- [ ] The [1.1.39](activity-authoring-assistant.md) authoring agent runs on a **framework layer** (default in git, registry entry), not an inline constant (M0).
- [ ] The structure rubric exists as a checkable artefact and the eval scores assistant drafts against the **current framework version** (M1, AR sign-off).
- [ ] A researcher edits + versions the framework and the **next** authoring session picks it up — **no deploy, no reseed** (M2).
- [ ] `make seed` writes the git default and **never clobbers** a researcher override (the [1.1.47](prompt-transparency-and-config.md) seed guard, verified).
- [ ] Every co-pilot-authored activity is stamped with its `authoringFrameworkVersion`, joinable to the accept/reject trail in BQ (M3).
- [ ] Manual builder + [1.1.39](activity-authoring-assistant.md) assistant remain fully usable if the framework store is unavailable (degradation).
- [ ] Net axiom score ≥ +4 (currently +8); SECURE + INSTANT held at 0 by construction.

## Related documents

- [activity-authoring-assistant.md](activity-authoring-assistant.md) — 1.1.39, the chat assistant + tools this framework steers; its static "Aswin meta-prompt" is generalised here
- [prompt-transparency-and-config.md](prompt-transparency-and-config.md) — 1.1.47, the override⊕default registry + researcher store this rides
- [researcher-role.md](researcher-role.md) — 1.1.5 (shipped), the role gate for authoring/versioning the framework
- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38 (shipped), the palette the structure rubric requires the co-pilot to assemble
- [lesson-author-surface.md](lesson-author-surface.md) — 1.1.27, the resolved-prompt preview that makes the active framework legible
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19, the manual builder the assistant pre-fills
