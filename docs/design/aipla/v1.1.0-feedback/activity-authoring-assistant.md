# Activity authoring assistant — an AI co-pilot that helps a non-technical teacher build a good teaching bot

**Status:** Planned (P1, v1.1 — phased; **M0 gated on Aswin's meta-prompt**)
**Last Updated:** 2026-06-17 (17 June teacher check-in — Aswin: *"when creating a new activity, have an AI chatbot help guide the teacher in the lesson prompt — Aswin will send a meta-prompt"* + *"look at more guided form actions"*)
**Priority:** **P1** — the most direct answer to *"onboard non-technical teachers to make good teaching AI bots."* The manual builder ([teacher-activity-authoring.md](teacher-activity-authoring.md), 1.1.19) assumes a teacher who can write a good Socratic prompt and knows which elements help. This is the affordance for the teacher who can't yet — a new authoring **interface**, which is exactly the breadth-over-depth bet (a high-leverage new probe over the possibility space).
**Estimated:** ~1.5d M0 (prompt co-pilot) + ~1d per later milestone — phased; the full assistant is pilot-iteration work
**Scope:** Fullstack — a new teacher-facing ADK agent (`backend/skills/templates/activity-authoring-assistant/`) + authoring tools (`backend/adk/authoring_tools.py`) that mutate the in-progress `ActivityConfig` draft via the existing `/api/activity-configs` upsert + an AG-UI chat panel in `frontend/src/app/teacher/activities/` + A2UI accept/edit proposal cards + `frontend/src/lib/teacherApi.ts` wiring. **Reuses the student chat stack** (AG-UI) on the teacher auth path.
**Dependencies:** [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19 — the builder this lives inside; **re-homes its M6 equipment co-design + M7 auto-rubric as assistant tools**); [activity-elements-palette.md](activity-elements-palette.md) (1.1.38 — the palette the `add_element` tool assembles from); [curriculum-library.md](curriculum-library.md) (1.1.25 — the corpus the `suggest_materials` tool grounds in); [lesson-author-surface.md](lesson-author-surface.md) (1.1.27 — the verification handoff: assistant *generates*, the resolved-prompt preview + trial session *verify*); [teacher-ui-consolidation.md](teacher-ui-consolidation.md) (1.1.26 — the builder design system the chat panel slots into); ADR-003 (model tiers — a capable model for authoring), ADR-015 (A2UI), ADR-001 (**teacher auth, not group auth** — see the auth callout)
**Source:** 17 June teacher check-in note ([june-17-feedback.md](june-17-feedback.md)). **Pedagogical source-of-truth (incoming):** Aswin's **meta-prompt** — the agent's system prompt — which lands in the scoping site (`strand-a-pedagogical-bot/`) per the execution/scoping split; this doc is the execution wiring around it.

> **Read this with its two companions.** [activity-elements-palette.md](activity-elements-palette.md) (1.1.38) is *what* can be assembled (the element registry). [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19) is the *manual* builder. **This doc is the AI layer over both** — a conversational front-end that drafts the lesson prompt and proposes elements for a teacher who would otherwise face a blank form. It does not replace the manual builder; it pre-fills it, and the teacher always edits and accepts (human-in-the-loop).

## Why this exists

The 3 June check-in named teacher activity creation *"the primary design priority"*, and 1.1.19 delivers the **builder**. But 1.1.19's M0 acceptance is *"a teacher writes the Socratic lesson prompt"* — which silently assumes the teacher knows **how to write a good Socratic prompt** and **which elements** ([1.1.38](activity-elements-palette.md)) serve the lesson. Aswin's 17 June observation is that the target users — non-technical stx physics teachers — largely **don't** yet, and that is the actual barrier to "teachers make their own bots."

Two AI-assist seeds already exist inside 1.1.19, but as **isolated, headless features**:

- **M6 — equipment co-design:** "describe your lab kit; the AI proposes a workbench element to fill the gap."
- **M7 — auto-drafted rubric:** "from topic + level, draft the checklist/DRA from the curriculum."

Neither has a *front-end a teacher talks to*. They are tool-calls with no conversation. Aswin's ask is the missing conversational layer that **unifies** them: one in-builder chat where the teacher describes what they want to teach, and the assistant co-produces the prompt **and** the elements — calling M6/M7 (and the [palette](activity-elements-palette.md)'s `add_element`, and [curriculum](curriculum-library.md)'s retrieval) as its tools.

Framed in the platform's own terms: **activity authoring becomes a skill**, not a form. That is the SKILLS-NOT-FEATURES axiom applied to the teacher, exactly as the student tutors apply it to the student.

## What it is (and is not)

- **It is** a teacher-facing ADK agent rendered as a chat panel beside the activity builder, whose **tools write into the in-progress `ActivityConfig` draft** as *proposals* the teacher accepts/edits/regenerates.
- **It is** grounded: it cites the [curriculum library](curriculum-library.md) (1.1.25) so suggestions reflect real *faglige mål* / *kernestof* at the right A/B/C level, not generic physics.
- **It is not** autonomous: nothing publishes to a class without an explicit teacher action. Every tool-call surfaces as an accept/edit card (EARNED TRUST).
- **It is not** a code generator: it assembles **vetted prompts and declarative elements** from the [palette](activity-elements-palette.md) — never raw HTML/JS (tier-3 stays out, ADR-013).
- **It is not** a new student surface: it is teacher-only, code-split, and uses the **teacher auth token** (see the auth callout — this is the corner AIPLA has shipped wrong 4×).

## ⚠ Auth callout (the recurring AIPLA corner case)

This is a **teacher surface that streams an agent**. Per [CLAUDE.md](../../../../CLAUDE.md) and memory `feedback-anonymous-users-are-corner-case`, the `AGUIProvider` here **MUST** mint the **Firebase teacher token** (`useTeacherAuth`), not the default group token. `useAuth()` is the anonymous-group context whose `user` is null for a teacher → minting nothing → the stream POST fails `401: Missing Authorization header`. Every authoring-assistant fetch uses `fetchWithTeacherAuth`. This is called out **here, in the design**, because it is precisely the bug we keep re-shipping on identity-touching surfaces. Acceptance includes a test that the authoring stream carries the teacher token.

## Goals

**Primary goal:** A non-technical teacher describes, in plain Danish/English, what they want to teach ("energibevarelse for en B-klasse, vi har en rampe og en fotoport"), and the assistant co-produces a **complete, editable draft activity** — a sound Socratic lesson prompt + a fitting checklist + any helpful elements + suggested curriculum materials + a workbench type — which the teacher reviews, edits, and publishes.

**Success metrics:**

- A teacher who has **never written a prompt** produces a publishable concept-dialogue activity (prompt + checklist) via the assistant in **< 10 minutes**, and a student has a coherent Socratic session against it.
- Every assistant action is a **proposal the teacher accepted or edited** — measured: the provenance trail records accept/edit/reject per suggestion (EARNED TRUST + a research signal on how teachers author).
- The manual builder is **fully usable with the assistant disabled** (the assistant is additive scaffolding; model/Aswin-meta-prompt outage degrades to the shipped form).
- The assistant's suggestions are **curriculum-grounded** (cite a real *fagligt mål* / *kernestof*), not generic — verified against the [curriculum library](curriculum-library.md).

**Non-goals (explicit):**

- Autonomous publishing or auto-grading — the teacher is always in the loop.
- Authoring *new sims / artefacts* (tier-3, Year-2) — the assistant assembles the [palette](activity-elements-palette.md), it does not write code.
- A general teacher chatbot / help desk — this agent's scope is **authoring one activity**, bounded by its tools.
- Replacing the manual builder or the [resolved-prompt preview](lesson-author-surface.md) (1.1.27) — it **feeds** them.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | The chat itself streams within the <1s first-token bar (same stack as the tutors). A *proposal* is a tool-call that takes a model round-trip — surfaced honestly with a "drafting…" state and a skeleton card, not a frozen UI. Held neutral, not negative: the authoring agent is a considered draft, not a latency-critical student turn. |
| 2 | EARNED TRUST | +1 | **Nothing publishes without the teacher.** Every tool-call is an accept/edit/regenerate proposal; the provenance trail records what the AI suggested vs what the teacher kept. Human provenance is preserved on the authored artefact. |
| 3 | SKILLS, NOT FEATURES | +1 | The headline: **activity authoring becomes a skill** (a teacher-facing agent), not a form-filling feature. Directly serves "non-technical teacher makes a good bot." |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Uses a **capable cloud-tier model** (ADR-003) for a genuinely reasoning-heavy task (drafting pedagogy) — justified, not gratuitous; and it calls **deterministic tools** (palette element writes, curriculum retrieval) rather than free-texting structured config. |
| 5 | GRACEFUL DEGRADATION | +1 | Assistant unavailable / model error / **no meta-prompt yet** → the manual builder ([1.1.19](teacher-activity-authoring.md)) works unchanged. The assistant is purely additive scaffolding; its absence is a non-event. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Rides **AG-UI** (the tutor stack) + **A2UI** proposal cards + the existing **`/api/activity-configs`** upsert as the agent's tools. No new protocol; the assistant is an ADK agent like any other. |
| 7 | API FIRST | +1 | The assistant's tools **are** the public activity-config + curriculum APIs — anything it does is scriptable via `aiplatform activity`. The agent is a client of the same contract the web builder uses. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Authoring sessions are traced (OTel); accept/edit/reject per proposal → BQ. First-class research signal on *how teachers author* + which suggestions land. |
| 9 | SECURE BY CONSTRUCTION | 0 | A teacher-facing agent with **write-tools** is a new write path. Held neutral by construction: teacher-auth-gated (the callout above); tools are **owner-scoped to the teacher's own draft** (cannot touch another teacher's activities or any class); **no code-gen** (assembles vetted prompts/elements only — tier-3 raw-HTML stays out); and **proposals require explicit human accept** before persistence. Same `{teacher_focus}`-class injection boundary as shipped. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | The agent, its tools, and the curriculum grounding live backend; the frontend renders AG-UI/A2UI only. Teacher-only **code-split** route — student bundle unaffected. |
| 11 | USABLE BY DESIGN | +1 | Usability for non-technical teachers **is the feature.** Designed first-run / empty / "drafting…" / error states; the assistant is itself the affordance that turns a blank builder into a guided one. |
| | **Net Score** | **+9** | Threshold: ≥ +4. INSTANT and SECURE held at 0 by construction (justified above). No student-facing −1; ≤ 2 axioms at −1. Hard-fail passes. |

**Conflict justifications:**

- **#1 INSTANT FEEL (0, not −1):** the streaming chat meets the bar; only the *tool-call proposal* takes a round-trip, which is inherent to "draft me a lesson" and is surfaced with a designed drafting state rather than hidden latency.
- **#9 SECURE BY CONSTRUCTION (0, not −1):** a new agent-driven write path would normally pull negative; held neutral by (a) teacher-auth gate, (b) owner-scoped draft-only tools, (c) no code-gen / declarative assembly only, (d) human-accept-before-persist. No new injection vector beyond the shipped `{teacher_focus}` path.

## Standards compliance

- **Agent:** a standard ADK `Agent` defined by a `SKILL.md` template (`backend/skills/templates/activity-authoring-assistant/`), teacher-only `accessControl`, model selected via the four-tier router (1.4) at the cloud tier. Its **system prompt is Aswin's meta-prompt** (the human gate).
- **Tools:** ADK `FunctionTool`s wrapping the existing activity-config + curriculum APIs (below). No tool reaches outside the teacher's own draft.
- **Rendering:** AG-UI stream in a builder-side chat panel (reuse the tutor chat components); proposals render as **A2UI accept/edit cards** — the same declarative rail the quiz/element editors use.
- **No new wire protocol, no new store:** the draft *is* the `ActivityConfig` the manual builder already persists.

## Design

### The authoring loop

```
┌─ Create activity ─────────────────────────────┬─ Build assistant ──────────────┐
│  Name        [ Energibevarelse — 7B        ]  │  You: I want to teach energy   │
│  Language     (•) Dansk  ( ) English          │  conservation to a B class.    │
│  Workbench    [ None ▾ ]                       │  We have a ramp + photogate.   │
│                                                │                                │
│  Lesson prompt (Socratic teaching goal)        │  Assistant: Here's a Socratic  │
│  ┌──────────────────────────────────────────┐  │  prompt + a 4-step checklist + │
│  │ « assistant proposal, editable »         │  │  a data table for your photo-  │
│  └──────────────────────────────────────────┘  │  gate readings. ▸ [Lesson      │
│  Progress checklist     [+ add step]           │   prompt] [Apply] [Edit]        │
│   « proposed steps, each [Apply]/[Edit] »      │  ▸ [Checklist ×4] [Apply all]   │
│  Elements   [+ table] [+ chart] [+ calc]       │  ▸ [Data table: t, v] [Apply]   │
│  Materials  « suggested from curriculum »      │  ▸ [Material: B-syllabus §4]    │
│             [ Save draft ] [ Publish ▾ ]       │  [Type here…]                   │
└────────────────────────────────────────────────┴────────────────────────────────┘
```

The assistant **proposes**; the builder form is where proposals land as editable state; the teacher **accepts/edits/publishes**. The two panes share one `ActivityConfig` draft. A proposal is never a silent write — it is an A2UI card with `Apply` / `Edit` / `Dismiss`, and `Apply` is what mutates the draft.

### The agent's tools

Each tool is an ADK `FunctionTool` over an existing API, owner-scoped to the draft. The tool **returns a proposal**; the frontend renders it; `Apply` performs the actual upsert.

| Tool | Backs onto | Proposes |
|---|---|---|
| `set_lesson_prompt(text)` | `PATCH /api/activity-configs` `teachingGoal` | A Socratic lesson prompt (the M0 core — Aswin's meta-prompt drives quality) |
| `set_interaction_style(style)` / `suggest_persona` | `interactionStyle` (1.1.20) / persona (1.1.12) | A teaching style / persona fitting the lesson |
| `propose_checklist(items)` | `checklist` (1.1.38) | Progress steps — sources [curriculum #4](teacher-activity-authoring.md) auto-rubric (re-homes 1.1.19 M7) |
| `add_element(kind, spec)` | the [palette](activity-elements-palette.md) (1.1.38) | A table / chart / calculator that fits the lesson (re-homes 1.1.19 M6 equipment co-design) |
| `set_workbench_type(type)` | `workbenchType` (1.J) | `none` / a sim / notebook fitting the activity |
| `suggest_materials(topic, level)` | `GET /api/curriculum` retrieval (1.1.25) | Real *faglige mål* / *kernestof* docs to cite, at the right A/B/C level |
| `coverage_hint()` | [curriculum #6](teacher-activity-authoring.md) coverage map (1.1.19 M8) | "you have no activity on X" — points at the next probe |

This is the unification: **1.1.19 M6 (equipment co-design) and M7 (auto-rubric) stop being standalone milestones and become `add_element` and `propose_checklist` here** — driven conversationally instead of headlessly. (1.1.19's milestone table should be amended to note the re-home; see *Reconciliation*.)

### Aswin's meta-prompt (the human gate)

The agent's **system prompt is the meta-prompt Aswin is sending.** It encodes the pedagogy: how to interview a teacher, what makes a *good* Socratic prompt for stx physics, how to keep proposals concise + level-appropriate, the Danish-first register. Per the execution/scoping split (memory `feedback-execution-vs-scoping`), the meta-prompt **lives in the scoping site** as the pedagogical source-of-truth; this repo wires it into the `SKILL.md` template. **M0 cannot ship without it** — until it lands, M0 builds against a placeholder prompt behind the teacher-tier feature flag (dark), and the manual builder is unaffected (Axiom 5).

### Verification handoff (1.1.27)

The assistant *generates*; [lesson-author-surface.md](lesson-author-surface.md) (1.1.27) *verifies*. After the teacher accepts proposals, the **resolved-prompt preview** shows the system prompt the assistant + persona + style + curriculum composed (source-attributed), and the **trial session** ("Try this lesson", `is_trial=true`, analytics-excluded) lets the teacher test it as a student before publishing. Clean separation: 1.1.39 = authoring, 1.1.27 = inspection. The assistant should **link to the trial session** as its closing suggestion ("want to try this with a student's eyes?").

### CLI surface

The assistant is a GUI affordance, but its tools are the public API, so power users keep parity via the existing `aiplatform activity` commands ([1.1.19](teacher-activity-authoring.md)) + `aiplatform activity push <file>`. No new CLI is required — that *is* the API-FIRST point (Axiom 7). An optional `aiplatform activity draft --from-prompt "<description>"` one-shot (non-interactive call of the assistant) is a thin future add, not v1.1.

## API changes

> **Mostly reuse.** The assistant's tools call the **existing** `/api/activity-configs` (1.1.19) + `/api/curriculum` (1.1.25). The one new surface is the **agent stream** itself (a teacher-auth AG-UI chat for the authoring skill) — which rides the existing `/api/chat/{skill_id}` AG-UI endpoint the tutors use, with the skill being `activity-authoring-assistant` and the auth being teacher (the callout).

| Endpoint | Change | Auth |
|---|---|---|
| `POST /api/chat/activity-authoring-assistant` (AG-UI) | **the assistant stream** — existing AG-UI endpoint, new teacher-only skill | **teacher JWT** (callout) |
| `PATCH /api/activity-configs/…` | unchanged — the tools' write target (owner-scoped) | teacher JWT (owner) |
| `GET /api/curriculum` (+ retrieval) | unchanged — `suggest_materials` reads it | teacher JWT |

No new persistence: the draft is the `ActivityConfig`; the authoring conversation is an ordinary ADK session (teacher-scoped, optionally retained for the provenance trail).

## Milestone phasing

Ordered so **M0 is the standalone headline** (Aswin's literal ask — help with the lesson prompt) and later milestones layer the element/curriculum assembly.

| MS | Deliverable | Est | Gate | Lands |
|---|---|---|---|---|
| **M0** | **Prompt co-pilot.** The chat panel in the builder (teacher auth), the `activity-authoring-assistant` skill with **Aswin's meta-prompt**, and the single `set_lesson_prompt` tool → accept/edit card → fills `teachingGoal`. A teacher chats and gets a good Socratic prompt. | ~1.5d | **Aswin's meta-prompt** | pilot-iteration |
| **M1** | **Guided form actions.** (Aswin's *"more guided form actions"*) — `propose_checklist` + `set_workbench_type` + `set_interaction_style`/persona as accept/edit cards. | ~1d | none (post-M0) | pilot-iteration |
| **M2** | **Element assembly.** `add_element` proposing table/chart/calculator from the [palette](activity-elements-palette.md); re-homes 1.1.19 M6 equipment co-design. | ~1.5d | [1.1.38](activity-elements-palette.md) M1+ landed | pilot-iteration |
| **M3** | **Curriculum-grounded suggestions.** `suggest_materials` + level calibration + `propose_checklist` sourcing the auto-rubric; re-homes 1.1.19 M7. | ~1.5d | [1.1.25](curriculum-library.md) active (corpus seeded) | pilot-iteration |
| **M4** | **Provenance + observability.** Accept/edit/reject trail per proposal → OTel → BQ; `coverage_hint` (re-homes 1.1.19 M8). The research signal on how teachers author. | ~1d | aligns 1.1.17 / 2.5 | pilot-iteration |

**If the team is consumed by other P1 items:** M0 ships standalone the moment Aswin's meta-prompt lands — it delivers the exact 17-June ask (AI helps with the lesson prompt) and is independently valuable behind the teacher-tier flag. M1–M4 absorb into the 2026-08-14 → 09-15 pilot-iteration weeks. Because the assistant's tools are the palette + curriculum APIs, **M2–M3 are mostly tool-wiring** once [1.1.38](activity-elements-palette.md) and [1.1.25](curriculum-library.md) exist.

## Reconciliation with 1.1.19

This doc **re-homes three 1.1.19 milestones** from headless features into assistant tools. The [teacher-activity-authoring.md](teacher-activity-authoring.md) milestone table should be amended (on its next edit) to note:

- **M6 (equipment co-design)** → `add_element` tool here (the conversational front-end M6 lacked).
- **M7 (auto-drafted rubric)** → `propose_checklist` sourcing the curriculum rubric here.
- **M8 (coverage / gap map)** → `coverage_hint` tool here (the panel stays in 1.1.19; the assistant gains a conversational entry to it).

The *logic* (curriculum retrieval, equipment matching, rubric drafting) stays specified in 1.1.19 + [curriculum-library.md](curriculum-library.md); this doc adds the **conversational orchestration** over it. No duplication — a pointer both ways.

## Testing strategy

- **Backend (pytest):** the `activity-authoring-assistant` agent loads with the meta-prompt; each tool is **owner-scoped** (a tool call cannot write another teacher's activity / a class it doesn't own — 403); `set_lesson_prompt`/`propose_checklist`/`add_element` produce well-formed `ActivityConfigUpsert` deltas; the agent never calls a code-gen / raw-HTML path (declarative-only assertion); the stream **requires the teacher token** (the auth callout — a test that a group token is rejected).
- **Frontend (vitest):** the builder chat panel mounts with `useTeacherAuth` (regression-guard the auth corner); proposal cards render `Apply`/`Edit`/`Dismiss`; `Apply` mutates the draft and only then persists; the builder is fully functional with the assistant **disabled** (degradation); "drafting…" + error states render.
- **E2E / manual (LOCAL_MODE):** a teacher with no prompt-writing experience chats → gets a Socratic prompt → publishes → an anon student has a coherent session (M0 acceptance, <10 min). M2/M3: the assistant proposes a table + cites a real curriculum doc.
- **Eval:** the assistant's *output* prompts obey the verbosity + Socratic constraints (1.1.1) and are level-appropriate — an evalset over a handful of teacher requests scored against Aswin's meta-prompt criteria (AR sign-off on the rubric).

## Human gates (tee up now)

1. **Aswin — the meta-prompt** (gates M0): the agent's system prompt. The single blocking dependency; everything else is engineering. Lands in the scoping site; wired into the `SKILL.md` template here.
2. **AR — output quality rubric** (gates the M0 eval): what makes an assistant-drafted prompt "good" for stx physics — the evalset criteria.
3. **JB/AR — suggestion scope** (gates M2/M3): how proactive the element/material suggestions should be (propose-on-ask vs propose-eagerly); the equipment vocabulary (shared with 1.1.19 M6).
4. **JB — provenance retention** (gates M4): is the authoring conversation + accept/reject trail retained for research, and under what posture (reuse the [student-multimodal-upload.md](student-multimodal-upload.md) retention decision shape).

## Open questions

- **Q1 — propose-eager vs propose-on-ask:** does the assistant volunteer a full draft up front, or build it piece-by-piece as the teacher asks? Recommendation: **piece-by-piece with an explicit "draft the whole thing" affordance** — keeps the teacher in control (EARNED TRUST) without forcing a wall of proposals. JB/AR confirm.
- **Q2 — conversation retention:** retain the authoring chat (research value: how teachers author) vs ephemeral (lower data surface). Tie to gate 4.
- **Q3 — model tier:** cloud-tier capable model for drafting (ADR-003) — confirm via the 1.4 router which specific model, and whether a cheaper model suffices for the `propose_checklist` / `suggest_materials` tool-shaped calls vs the free-form prompt drafting.
- **Q4 — multilingual register:** the assistant interviews + drafts in Danish by default (stx teachers) but must handle English (DK's Indian cohort context). Confirm the language-switch behaviour with Aswin's meta-prompt.

## Risks

- **Meta-prompt is the single point of dependency (primary).** M0 cannot ship without Aswin's meta-prompt. Mitigated by building the wiring against a placeholder behind the dark flag, so the day the prompt lands, M0 is one config swap away — and the manual builder never depends on it (Axiom 5).
- **The assistant produces plausible-but-mediocre prompts.** A non-technical teacher can't always tell. Mitigated by the AR output rubric + eval (gate 2), the curriculum grounding (M3, so suggestions cite real læreplan), and the [trial session](lesson-author-surface.md) handoff (the teacher *sees* it work before publishing).
- **Auth corner regression.** The teacher-token requirement is the exact bug shipped 4×. Mitigated by the explicit callout + a dedicated auth test in acceptance.
- **Scope creep into a general teacher chatbot.** Bounded by the tool set — the agent can only do what its (activity-authoring) tools allow; it is not a free-roaming assistant.
- **Cohort comparability (research).** AI-assisted authoring diverges activities across classes. Mitigated by capturing the authored definition + the provenance trail (M4) so research can control for it — same concern flagged in [teacher-activity-authoring.md](teacher-activity-authoring.md) and [teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md).

## Success criteria

- [ ] A teacher who has never written a prompt produces a publishable concept activity via the assistant; a student has a coherent Socratic session against it (M0, <10 min).
- [ ] The authoring stream carries the **teacher** token; a group token is rejected (auth callout regression-guard).
- [ ] Every assistant write is an `Apply`'d proposal; nothing persists without a teacher action (M0–M4).
- [ ] The manual builder is fully functional with the assistant disabled (degradation).
- [ ] `add_element` proposes a palette element; `suggest_materials` cites a real curriculum doc at the right level (M2/M3).
- [ ] 1.1.19 M6/M7/M8 are re-homed (the milestone table amended; logic not duplicated).
- [ ] The provenance trail (accept/edit/reject per proposal) lands in BQ (M4).
- [ ] Net axiom score ≥ +4 maintained; SECURE + INSTANT held at 0 by construction as specified.

## Related documents

- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19, the builder this lives in; re-homes its M6/M7/M8
- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38, the palette `add_element` assembles from
- [curriculum-library.md](curriculum-library.md) — 1.1.25, the corpus `suggest_materials` grounds in
- [lesson-author-surface.md](lesson-author-surface.md) — 1.1.27, the resolved-prompt preview + trial session the assistant hands off to
- [tutor-personas.md](tutor-personas.md) / [voice-personas.md](voice-personas.md) — 1.1.20 / 1.1.12, the style/persona the assistant can set
- [teacher-ui-consolidation.md](teacher-ui-consolidation.md) — 1.1.26, the builder design system the chat panel slots into
- [june-17-feedback.md](june-17-feedback.md) — the raw 17-June source note
- ADR-003 (model tiers) + ADR-015 (A2UI) + ADR-001 (teacher vs group auth) — scoping-site `architecture.qmd`
