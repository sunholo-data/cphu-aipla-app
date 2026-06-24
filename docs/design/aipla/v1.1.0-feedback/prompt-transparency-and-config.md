# Prompt transparency & configuration — one model for every prompt the tutor runs on

**Status**: Design (OPEN)
**Priority**: P1 — research enabler (post-pilot / v1.2 candidate)
**Estimated**: ~5–8d phased (transparency read ~1.5–2d · researcher edit ~2–3d · teacher-guardrailed overrides ~2–3d)
**Scope**: Fullstack
**Dependencies**: [1.1.5 researcher-role](researcher-role.md) (**SHIPPED** — ADR-016; the role + claim + ACL this builds on); [1.1.27 lesson-author-surface](lesson-author-surface.md) (**OPEN** — its `assemble_prompt()` + provenance map is the transparency primitive this generalises); [1.1.20 tutor-personas](tutor-personas.md) (**SHIPPED** — `interaction_style` preamble = the first config-over-prompt layer); [1.1.12 voice-personas](voice-personas.md) (**SHIPPED core** — the persona bundle; **custom personas** = the advanced teacher-config vehicle, v1.2 follow-up); [1.1.42 sim-catalogue-admin](sim-catalogue-admin.md) (**OPEN** — `tutorBlock` Firestore-override⊕YAML = the config-store pattern this generalises); [1.1.32 teacher-ux-refinement](teacher-ux-refinement.md) (**SHIPPED** — per-style injected-preamble + per-persona voicePrompt/bio visibility = partial transparency already live); the SKILL.md→Firestore **seed pipeline**
**Created**: 2026-06-24
**Last Updated**: 2026-06-24

> **This is a UNIFYING doc, not greenfield.** The teaching system already has a
> shipped researcher role, a shipped per-style preamble-visibility surface, a
> shipped per-activity teaching-style override, a shipped persona system (with
> custom personas as the planned advanced teacher-config path), an *open design*
> for a resolved-prompt preview, and an *open design* for a researcher-gated
> `tutorBlock` CMS. Each solved one prompt in one place. This doc makes
> **transparency** and **configuration** **first-class and system-wide**: one
> inventory, one resolve+provenance read, one layered override model, one role
> gate — so the next prompt is configurable by construction, not by a bespoke row.

## Problem Statement

AIPLA is a **research programme**, and the thing being researched is largely
*the prompts*: how the tutor is instructed to be Socratic, to give feedback, to
stay on the teacher's goal. Today those prompts are **scattered and mostly
invisible**, and only a couple are configurable without a code change + reseed.

**Current State — the prompt inventory (where each prompt lives today):**

| Prompt | Lives in | Transparent? | Configurable? |
|---|---|---|---|
| Per-skill tutor `instruction` | `backend/skills/templates/*/SKILL.md` → Firestore (seeded) | No (not surfaced in UI) | Only by editing the template + `make seed` |
| `initialMessage` / `openingTemplate` / `proactiveGreet` | same SKILL.md | No | Same |
| `interaction_style` preamble (socratic/concise/rigorous/warm) | `backend/adk/agent.py` chain (1.1.20) | **Partial** — 1.1.32 shows the literal injected preamble per style | **Yes** — per-activity builder field (basic teacher config) |
| **Persona** (`voicePrompt`, name/title/bio, → `interaction_style`) | `backend/personas/*.yaml` (1.1.12) | **Partial** — voicePrompt/bio shown per card (1.1.32) | Presets **shipped**; **custom personas = advanced teacher config** (v1.2) |
| `{teacher_focus}` injection (the activity goal) | `ActivityConfig.teachingGoal` + `compose_teacher_focus()` | Indirect (it's the goal field) | **Yes** — per activity |
| Sim `tutorBlock` | `backend/artefacts/*.yaml` (1.1.41) | No | Designed (1.1.42, post-pilot) |
| **Solution-editor feedback prompt** (1.1.45 M4) | *hardcoded default, this sprint* | No | **No — the prompt this doc exists to make configurable** |
| Eval / judge prompts (verbosity, capability-floor) | `backend/tests/eval/*` | No | No |

**Impact:**
- **Researchers** (the shipped 1.1.5 role) can read class data but **cannot see
  or tune the exact prompt** behind an observed tutor behaviour — the core
  research loop (hypothesis → prompt change → measure) requires a code edit +
  redeploy + reseed, so it doesn't happen.
- **Teachers** can shape `interaction_style`, the goal, and (via a **custom
  persona**) the tutor's identity/voice/style — but every *other* prompt is
  opaque, and they can't tell *why* the tutor behaved as it did.
- **Every new prompt** (M4's feedback prompt being the latest) is born opaque and
  hardcoded, then needs a bespoke row to become configurable.

## Goals

**Primary Goal:** make every prompt in the teaching system **inspectable** (see
the resolved prompt + where each part came from) and **configurable** (sensible
default, role-gated override), through **one** model rather than per-prompt rows.

**Success Metrics:**
- A researcher can open any activity/turn and read the **fully-resolved prompt**
  with a **provenance map** (which layer contributed each block) — no code access.
- A researcher can **edit + version** a prompt layer and have the next session
  pick it up **without a deploy or reseed**.
- A teacher can configure the prompt fragments they own — basic (style + goal) and
  advanced (custom persona) — and see the effect in the resolved-prompt preview
  before publishing.
- Adding a new prompt (e.g. M4's feedback prompt) registers it in the inventory
  and is transparent + configurable **with no new bespoke surface**.

**Non-Goals:**
- Not building the researcher role (**shipped**, 1.1.5) — building on it.
- Not free-text prompt editing for *students* (never).
- Not arbitrary code execution — prompts stay sanitised markdown/SKILL.md text
  (no `eval`, same posture as the 1.1.38 calculator).
- Not replacing the SKILL.md templates as the *default* source — overrides layer
  **on top of** them (defaults ship in git; overrides live in Firestore).

## Axiom Alignment

Score each axiom per [Product Axioms](../../../product-axioms.md). Net score must be >= +4.

| # | Axiom | Score | Notes |
|---|---|---|---|
| 1 | INSTANT FEEL | 0 | Resolution merged at session start (not per-token) + cached; transparency is a read. No hot-path cost. |
| 2 | EARNED TRUST | **+1** | Researchers/teachers see *exactly* what drives the tutor — the single biggest trust + reproducibility win for a research platform. |
| 3 | SKILLS, NOT FEATURES | **+1** | Config attaches to the skill/activity/persona layers that already exist; reinforces the prompt as a property of the skill, not a hidden constant. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Orthogonal to model routing (1.1.46). |
| 5 | GRACEFUL DEGRADATION | **+1** | Override⊕default: a missing/invalid override falls back to the shipped default — never a blank or broken prompt. |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Reuses the Firestore-override⊕YAML pattern (1.1.42 / custom personas), the `assemble_prompt()` provenance primitive (1.1.27), and the `role:researcher` claim (1.1.5). Prompts stay markdown/SKILL.md — no new format. |
| 7 | API FIRST | **+1** | Two clean reads — *resolved prompt* + *provenance* — and a role-gated config write; consumed by UI **and** the `aiplatform` CLI (researchers script studies). |
| 8 | OBSERVABLE BY DEFAULT | **+1** | This *is* observability of the prompt layer — the resolved-prompt-with-provenance read is the headline; pairs with OTel `tutor.interaction_style`/provenance spans. |
| 9 | SECURE BY CONSTRUCTION | **+1** | Role-gated by construction (researcher edits underlying layers; teacher edits owned fragments/persona within guardrails; students never); overrides sanitised on store; audit trail on every write. |
| 10 | THIN CLIENT, FAT PROTOCOL | **+1** | Resolution + provenance computed server-side; the client renders resolved text + a provenance badge, holds no assembly logic. |
| 11 | USABLE BY DESIGN | **+1** | Makes opaque prompts legible + editable for non-engineers; rides the 1.1.26 teacher design system + the 1.1.12 persona-card pattern. Teacher/researcher-facing (not student), so the student hard-fail rule doesn't bind. |

**Net: +9.**

## Design

### 1. The prompt registry (inventory as data)

Generalise the SKILL.md/persona/element pattern: every prompt the tutor runs on
is a **registered layer** with `{ id, kind, defaultSource, owner, configurable }`.
The registry IS the inventory table above, as code — so "what prompts exist" is
queryable, and a new prompt (M4's feedback prompt) is **one registry entry**, not
a scattered constant. (Mirrors the 1.1.38 `ELEMENT_REGISTRY` move.)

### 2. Transparency — generalise `assemble_prompt()` + provenance (from 1.1.27)

1.1.27 already designs a read-only **resolved-prompt preview** for the *skill
instruction* via one `assemble_prompt()` with a **provenance map** (which source
contributed each block). This doc **generalises that one function** to assemble
*every* registered layer for a given (activity, persona, turn) and emit:

```
GET /api/activities/{id}/resolved-prompt   →  { resolved: "<full text>",
                                                provenance: [ {block, source, layer, overridable} ... ] }
```

- **Read-only, role-gated:** teacher sees their activity's resolved prompt;
  researcher (1.1.5 bypass) sees any class's. Reuses `assert_can_read_class`.
- **Reveal policy is JB-gated** (inherited from 1.1.27 open Q): verbatim skill
  template vs summarised. Resolve once, here.

### 3. Configuration — one layered override model

Defaults ship in git (SKILL.md / persona YAML); **overrides live in Firestore,
merged onto defaults at session start** (the exact 1.1.42 `tutorBlock` pattern +
the custom-personas-in-Firestore v1.2 pattern — *one* generalised store, not
several). Resolution order (last wins, each optional, each falling back to prior):

```
SKILL.md default
  → researcher layer override     (underlying prompts; study tuning; role:researcher)
  → persona layer                 (preset persona OR CUSTOM persona = teacher ADVANCED config)
  → teacher per-activity fragment (interaction_style + goal; guardrailed BASIC config)
  → {teacher_focus}
```

- **Researcher layer** — edit/version the *underlying* prompt layers (instruction,
  feedback prompt, eval prompt) to run studies. Gated on the **shipped** `role:
  researcher` claim. Versioned + audited; the next session picks it up with **no
  deploy / no reseed** — the part that unblocks the research loop.
- **Persona layer (teacher ADVANCED config)** — the persona system is already the
  teacher's escape hatch: a **custom persona** bundles `voicePrompt` + identity +
  (→) `interaction_style`, so a teacher who needs more than the preset knobs shifts
  the tutor's behaviour by authoring a persona. This doc treats the persona as a
  first-class config layer; custom-persona authoring (the v1.2 1.1.12 follow-up)
  is its UI. 1.1.32 already made the bundle transparent.
- **Teacher per-activity fragment (BASIC config)** — `interaction_style` preset +
  goal (shipped), plus selected guardrailed fragments later (length caps, the
  Socratic non-negotiables stay pinned, no raw system override).
- **Seed-pipeline interplay (must-resolve):** once a layer has a Firestore
  override, that override — not the SKILL.md template — is source-of-truth for it;
  `make seed` must **not** clobber an override (the existing "manual seed after
  template change" gotcha, formalised: seed writes defaults, never overrides).

### 4. Role model (build on 1.1.5, no new role)

| Role | Sees | Basic config | Advanced config | Gate (exists today) |
|---|---|---|---|---|
| Student | nothing | — | — | — |
| Teacher | their activity's resolved prompt | `interaction_style` + goal (shipped) | **custom persona** (voicePrompt/identity/style; v1.2) | Firebase teacher auth |
| Researcher | any class's resolved prompt + all layers | — | edit/version underlying prompt layers | `role:researcher` (1.1.5 / ADR-016) |
| Admin | all | — | platform defaults | admin gate |

### 5. M4's feedback prompt is the first migrant

1.1.45 M4 ships its solution-editor feedback prompt as a **hardcoded default
structured as a registry layer** (a registry entry + a default source file). When
this doc lands, that default becomes a **researcher-overridable layer** (and a
candidate teacher-guardrailed fragment) with zero M4 rework — the worked example
that proves the model. (This is the "migrate it next sprint" the M4 sprint refs.)

## Milestones

| # | Milestone | Scope | Est. | Gate |
|---|---|---|---|---|
| **M0** | **Prompt registry** — entries for the inventory above (incl. M4's feedback prompt); `assemble_prompt()` generalised to walk the registry. | BE | ~1.5d | — |
| **M1** | **Transparency read** — `GET …/resolved-prompt` (resolved + provenance), role-gated; researcher/teacher UI panel (rides 1.1.26 design system + 1.1.27 preview). | Fullstack | ~2d | JB reveal-policy (from 1.1.27) |
| **M2** | **Researcher config** — Firestore override store (override⊕default merge at session start), versioned + audited; researcher edit UI + `aiplatform prompts` CLI; seed-pipeline guard (seed never clobbers overrides). | Fullstack | ~2.5d | — (researcher role shipped) |
| **M3** | **Teacher config surfacing** — wire the persona (advanced) + guardrailed fragments (basic) into the resolved-prompt preview so a teacher sees the effect pre-publish; custom-persona authoring rides 1.1.12 v1.2. | Fullstack | ~2d | AR on which fragments teachers may override |
| **M4** | **Migrate M4's feedback prompt** to a researcher-overridable layer (worked example). | BE | ~0.5d | M4 (1.1.45) shipped |

**Core "transparency" = M0–M1** (independently valuable, research-loop-visible).
M2 unblocks the research loop; M3 surfaces the teacher config (basic + persona).

## Open Questions / Human Gates

1. **JB — reveal policy** (inherited from 1.1.27): does the resolved-prompt
   preview show the **verbatim** skill template or a **summarised** view? Gates M1.
2. **AR — teacher override surface**: which prompt fragments may a *teacher* edit
   directly vs. only via a custom persona vs. researcher-only? Gates M3.
3. **M — versioning + audit retention** for researcher prompt edits (study
   reproducibility vs. store growth).
4. **Numbering / timing**: register as **1.1.47**; likely a **v1.2 / post-pilot**
   build (it generalises the post-pilot 1.1.42 and the open 1.1.27). M0–M1 could
   pull forward if the research loop needs prompt visibility during the pilot.

## Related

- [lesson-author-surface.md](lesson-author-surface.md) — 1.1.27; the resolved-prompt preview this generalises
- [researcher-role.md](researcher-role.md) — 1.1.5 (shipped); the role + claim this builds on
- [tutor-personas.md](tutor-personas.md) — 1.1.20; `interaction_style`, the first config-over-prompt layer
- [voice-personas.md](voice-personas.md) — 1.1.12; the persona bundle + custom personas (advanced teacher config)
- [sim-catalogue-admin.md](sim-catalogue-admin.md) — 1.1.42; the Firestore-override⊕YAML config-store pattern
- [teacher-ux-refinement.md](teacher-ux-refinement.md) — 1.1.32; injected-preamble + persona transparency (shipped)
- [rich-document-workbench.md](rich-document-workbench.md) — 1.1.45; M4's feedback prompt is the first migrant
