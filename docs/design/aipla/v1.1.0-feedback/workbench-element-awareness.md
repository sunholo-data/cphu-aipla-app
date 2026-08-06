# Workbench element awareness — the tutor is told what the student has in front of them

**Status:** Design (OPEN) — **P0, pre-pilot.** Written 2026-08-06 from Aswin's 2026-08-06 trial feedback.
**Priority:** **P0** — three of Aswin's eight trial complaints are this one bug. The pilot starts **2026-08-14**; a teacher who authors a table, a chart and a checklist and finds the tutor never mentions them concludes the elements are decorative.
**Estimated:** ~2–3d (M1 manifest block ~0.75d · M2 checklist tick tool + trust card ~1d · M3 ILO precedence ~0.5d · M4 eval ~0.5d)
**Scope:** Backend-heavy — [`backend/adk/teacher_focus.py`](../../../../backend/adk/teacher_focus.py) (`compose_teacher_focus`), a new `mark_checklist_item` tool pair beside [`backend/adk/checkpoint_tools.py`](../../../../backend/adk/checkpoint_tools.py), per-group checklist state, and one frontend trust card. No new element types, no new authoring surface.
**Dependencies:** [1.1.38 activity-elements-palette](activity-elements-palette.md) (**SHIPPED** M0–M4 — the registry this reads); [living-concept-map](living-concept-map.md) (**IN BUILD** — `run_checkpoint`/`record_checkpoint` is the exact precedent this copies for the checklist); the `workbench-element-builder` skill (dual-surface + trust-card recipe); [1.1.41 unified-sim-rendering](unified-sim-rendering.md) (the `tutor_block` stacking `compose_teacher_focus` already does)
**Source:** Aswin, 2026-08-06 — *"I designed a class where the students need to fill out the tables of the experiments in the workbench, upload images, and drawing graph but they do not connect to the chat. The chat never asked me to work on those tools."* + *"How can I activate the automatic ILOs check in the workbench?"* + *"The chat force students to achieve goals from the curriculum only, not with my ILOs."*
**Created:** 2026-08-06 (M)
**Last Updated:** 2026-08-06 (M)

## Problem Statement

**The tutor does not know the workbench elements exist.**

[`compose_teacher_focus`](../../../../backend/adk/teacher_focus.py#L180) builds the `{teacher_focus}`
substitution from exactly four sources, in order:

1. the hosted sim artefact's `tutor_block` (when `cfg.artefact_id` is set)
2. `SOLUTION_FEEDBACK_PROMPT` + the solution task (when `cfg.solution`)
3. the concept-map node structure + checkpoint contract (when `cfg.concept_map`)
4. the teacher's `teaching_goal`

The `ELEMENT_REGISTRY` has **eight** element kinds. Four of them —
`checklist`, `table`, `chart`, `calculator` — plus `note` and `document` are
**absent from that list entirely**. Nor do the student tutor templates fill the
gap: [`concept-dialogue/SKILL.md:15`](../../../../backend/skills/templates/concept-dialogue/SKILL.md#L15)
describes itself as the engine for *"teacher-authored no-workbench"* activities,
and [`problem-set-hints/SKILL.md`](../../../../backend/skills/templates/problem-set-hints/SKILL.md)
mentions the workbench only as a sim.

So a tutor in an activity with a three-column data table and a chart has, in its
system prompt, no evidence that either exists.

**The only path by which an element reaches the tutor is student interaction.**
`useSimSnapshotPush` POSTs to `/api/sessions/{id}/iframe-context`, which writes
into ADK session state under `mcp_app_context.{serverId}.{toolName}`. That is a
*push on change*. Before the student touches anything, the state key is absent.
The tutor therefore cannot invite the student to use a tool it has never been
told about — which is precisely Aswin's report. The elements are discoverable
only by a student who has already discovered them.

### The three complaints are one bug

Aswin confirmed on 2026-08-06 that **"ILOs (Intended Learning Outcomes) is the
learning checklist in the workspace"**. With that mapping:

| Complaint | Actual cause |
|---|---|
| *"The chat never asked me to work on those tools"* | `table`/`chart`/`calculator` not in the prompt |
| *"How can I activate the automatic ILOs check?"* | `checklist` not in the prompt, and there is no tool to tick an item — there is no such feature to activate |
| *"The chat forces goals from the curriculum only, not my ILOs"* | The curriculum preamble ([`curriculum_retrieval.py:53-58`](../../../../backend/adk/curriculum_retrieval.py#L53)) is injected; the checklist is not — so the only stated objectives the model can see are the curriculum's |

The third is the sharpest: it is not that the curriculum *outranks* the
teacher's ILOs, it is that the teacher's ILOs are **not in the prompt at all**
while the curriculum sources are. The model is behaving correctly on the
information it has.

### Why this wasn't caught

1.1.38 shipped each element as an independently-verifiable student surface —
render, edit, push-on-change, trust card. Every one of those checks passes.
None of them asks *"does the tutor know this is here before anyone clicks?"*
The `workbench-element-builder` skill encodes the dual-surface rule (push +
trust card) and both halves are correctly wired; the skill has no third rule
for **prompt-time presence**, which is the gap this doc closes.

## Goals

**Primary:** A tutor in an activity with authored elements knows, from its first
turn, what those elements are and what the student is expected to do with them —
and can tick a checklist item off when the conversation evidences it.

**Success metrics:**

- With a table + chart + checklist authored and **zero** student interaction, the
  tutor's opening turn references the actual task ("start by measuring the fall
  time for each height and putting it in the table").
- Checklist items tick from conversation, with a visible "shared with the AI"
  card, and survive reload/rejoin.
- Teacher-authored checklist items appear in the prompt **above** the curriculum
  preamble, and the tutor prefers them when they conflict.
- Adding element kind #9 requires no edit to `compose_teacher_focus`.

**Non-goals:**

- Ground-truth checking of table values (that is [1.1.24 offline-lab](offline-lab-workbench.md)).
- Any new element type.
- Replacing the concept-map checkpoint flow — checklist ticking is the *lighter*
  sibling and must not duplicate it.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Adds a bounded block to a system prompt composed once per session. Capped (below) so a 50-item checklist cannot blow the context. |
| 2 | EARNED TRUST | +1 | A ticked item is the AI's read, carded to the student ("the AI marked step 2 done") and overridable — same posture as `record_checkpoint`. Never a silent state change. |
| 3 | SKILLS, NOT FEATURES | +1 | The manifest is composed into the skill's own instructions; no new user-facing concept. The teacher authored elements — this makes the skill act on them. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | The manifest is deterministic string composition, zero LLM. Only the tick judgement is a model call, and it rides the turn already happening. |
| 5 | GRACEFUL DEGRADATION | +1 | Every block optional. No elements → empty string → the template degrades exactly as today. An element kind with no manifest renderer is skipped, not fatal. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Reuses the shipped `{teacher_focus}` substitution and the ADK tool/session-state path. Invents nothing. |
| 7 | API FIRST | 0 | No new HTTP surface; the tick is an ADK tool on the existing run. |
| 8 | OBSERVABLE BY DEFAULT | +1 | `inject_teacher_focus` already logs `focus_chars`; extended with a per-kind element count so "did the tutor get told?" is answerable from logs. |
| 9 | SECURE BY CONSTRUCTION | +1 | Manifest is built from the config already resolved through the student's verified `group_tags` → class binding. No new read path, so no new leak surface. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | All composition server-side. The client gains one card. |
| 11 | USABLE BY DESIGN | +1 | Closes the loop a teacher already believes exists when they author an element. |
| | **Net Score** | **+8** | Threshold: >= +4 |

## Design

### Overview

Three additions, in dependency order:

1. **An element manifest block** in `compose_teacher_focus` — registry-driven, so
   it does not need editing per element kind.
2. **A checklist tick tool pair** (`list_checklist` / `mark_checklist_item`),
   modelled exactly on the shipped `run_checkpoint` / `record_checkpoint`.
3. **Explicit precedence** — the teacher's ILOs are stated as the activity's
   objectives, the curriculum as reference material for reaching them.

### The core decision: registry-driven, not per-kind

The manifest is generated by iterating `ELEMENT_REGISTRY` and calling a
per-kind `describe()` renderer, defaulting to a generic one-liner when a kind
has no bespoke renderer:

```python
# backend/adk/element_manifest.py (new)

def describe_elements(cfg: ActivityConfig) -> str:
    """One prompt block naming every authored element and what it is for."""
    lines: list[str] = []
    for kind, spec in ELEMENT_REGISTRY.items():
        items = getattr(cfg, spec.field, []) or []
        if not items:
            continue
        lines.extend(_DESCRIBERS.get(kind, _describe_generic)(items, spec))
    ...
```

The alternative — an explicit `if cfg.table: ... if cfg.chart: ...` chain — is
what `compose_teacher_focus` does today for its four sources, and is exactly why
four element kinds were silently missed when 1.1.38 added them. **A new element
kind must appear in the tutor's prompt by default, and require a positive
decision to be hidden.** That inverts the failure mode: the worst case becomes a
too-generic description rather than total invisibility.

A registry-completeness test (below) makes the inversion enforced rather than
aspirational.

### Manifest content and bounds

Per kind, the block states *what exists* and *what the student does with it* —
never the student's current values (those arrive fresh via `iframe-context`;
baking them into a once-per-session instruction would go stale, the same reason
`living-concept-map` deliberately omits node statuses):

```
This activity's workbench has the following tools. Refer to them by name and
invite the student to use them when the conversation reaches them — do not wait
to be asked.

- Data table "Faldforsøg" — columns: højde (m), tid (s), hastighed (m/s).
  5 empty rows for the student to fill in.
- Chart "Hastighed mod tid" (scatter) — plots the data table as it fills.
- Calculator "Fart" — inputs: strækning (m), tid (s).
- Note "Sikkerhed" — reference text the student can read.

The student's current entries are not shown here; you receive them as they
work.
```

**Bounds.** `checklist` allows 50 items and `table` allows 8 columns × 5 tables.
The manifest is capped at **2000 characters**, truncating item-wise with a
`(+N more)` suffix, and the composed focus is logged with its length. This
matters — `SkillConfig.instructions` is validated at 10,000 characters
(memory `feedback-skill-instructions-10k-cap`), and `{teacher_focus}` already
stacks a sim `tutor_block` + solution prompt + concept map before this block
is added.

### Checklist as ILOs — the tick tool

The checklist is the teacher's stated learning outcomes, so it gets more than a
description. Two tools, registered only when `cfg.checklist` is non-empty:

| Tool | Signature | Behaviour |
|---|---|---|
| `list_checklist` | `() -> list[{id, label, done, evidence}]` | Fresh per-group state. Called when the tutor needs to know what is outstanding. |
| `mark_checklist_item` | `(item_id: str, done: bool, evidence_summary: str) -> {ok, item}` | Records the AI's read with a one-line justification. |

State lives per **group**, not per session — a group that rejoins on a new
session must not lose its ticks. This mirrors `concept_progress` from CONCEPT-1;
reuse that store's shape rather than inventing a second one.

`evidence_summary` is mandatory and is what the trust card renders. A tick with
no evidence is rejected at the tool boundary — the student is entitled to know
*why* the AI thinks they did something.

### The precedence fix

`compose_teacher_focus` gains an explicit ordering statement when a checklist
exists. Today the curriculum preamble is the only goal-shaped text in the
prompt; the fix is not to weaken it but to put the teacher's objectives above
it and say so:

```
These are the learning outcomes the TEACHER set for this activity. They are the
objectives — work toward them. Curriculum material you retrieve is reference
for reaching these outcomes, not a competing set of goals.
```

This block is emitted **before** the curriculum sources preamble in the composed
instruction. Where they conflict, the authored outcome wins.

### Frontend Changes

One new trust card variant in [`HumanToolUseCard`](../../../../frontend/src/components/chat/HumanToolUseCard.tsx)
for `mark_checklist_item`, and a tick indicator in
[`ProgressChecklist`](../../../../frontend/src/components/workspace/ProgressChecklist.tsx)
distinguishing **student-ticked** from **AI-ticked** (an AI tick is a suggestion
the student can untick; a student tick is authoritative). Per the
`workbench-element-builder` rule: the push and the card ship together, in this
milestone, or the milestone is not done.

### Backend Changes

| File | Change |
|---|---|
| `backend/adk/element_manifest.py` | **New** — `describe_elements()`, per-kind describers, cap + truncation |
| `backend/adk/teacher_focus.py` | `compose_teacher_focus` stacks the manifest + ILO-precedence block; extend the `inject_teacher_focus` log line with per-kind counts |
| `backend/adk/checklist_tools.py` | **New** — `list_checklist` / `mark_checklist_item`, modelled on `checkpoint_tools.py` |
| `backend/db/checklist_progress.py` | **New** or extend `concept_progress` — per-group tick state |
| `backend/adk/agent.py` | Conditional tool registration when `cfg.checklist` is non-empty |

### API Changes

None. The tick is an ADK tool call on the existing AG-UI run; state reads ride
the existing session bootstrap.

### CLI Surface

`aiplatform activity manifest <activity-id>` — prints the exact manifest block
the tutor will receive for an activity. This is the debugging affordance the
whole bug argues for: the failure was invisible because nothing rendered what
the tutor was actually told. One Click subcommand + one httpx call, ~0.15d.

## Implementation Plan

### M1 — Element manifest (~0.75d)

- `element_manifest.py` with registry iteration + per-kind describers for
  `checklist`, `table`, `chart`, `calculator`, `note`, `document`
- Generic fallback describer + the completeness test
- Stack into `compose_teacher_focus`; cap at 2000 chars; extend logging
- `aiplatform activity manifest` CLI

### M2 — Checklist tick tools + trust card (~1d)

- `checklist_tools.py`, per-group progress store, conditional registration
- Prompt contract wording (ask conversationally, never as a form — same
  discipline as `run_checkpoint`)
- `HumanToolUseCard` variant + `ProgressChecklist` AI/student tick distinction
- Vitest for the card, pytest for the tools

### M3 — ILO precedence (~0.5d)

- Precedence block ordered ahead of the curriculum preamble
- Test asserting relative order in the composed instruction

### M4 — Eval (~0.5d)

- ADK evalset: activity with table + chart + checklist, no interaction →
  assert the opening turn names the table
- Assert a checklist item ticks after the student describes doing it
- Assert an authored ILO is preferred over a conflicting curriculum objective

## Migration & Rollout

No schema change; no backfill. Every existing activity gains the manifest the
next time a session starts. Behind `AIPLA_ELEMENT_MANIFEST` (default **on** in
dev, flipped on for test/prod after M4 passes) so it can be killed without a
redeploy if it degrades tutor quality.

> **Promote twin.** If the flag is passed as a `--build-arg` or
> `--set-env-vars`, [`cloudbuild.promote.yaml`](../../../../cloudbuild.promote.yaml)
> needs the same line. A per-env value added to `cloudbuild.yaml` alone never
> reaches prod — this has bitten three ways already (see CLAUDE.md footguns).

## Testing Strategy

### Backend (pytest)

- `test_element_manifest.py` — one case per element kind; empty config → empty
  string; the 2000-char cap truncates item-wise with `(+N more)`
- **Registry completeness:** iterate `ELEMENT_REGISTRY`; every kind must produce
  non-empty manifest text for a populated config. *This is the test that would
  have caught the original bug* — it fails the moment element kind #9 lands
  without a describer.
- `test_checklist_tools.py` — tick/untick, per-group isolation, rejection of a
  tick with empty `evidence_summary`, survival across session ids
- `test_teacher_focus.py` — ILO block precedes the curriculum preamble; composed
  focus stays under the `SkillConfig` 10k instruction cap with a maximal config
  (50 checklist items + 5 tables + sim `tutor_block` + solution + concept map)

### Frontend (Vitest + RTL)

- `HumanToolUseCard` renders the `mark_checklist_item` variant with evidence
- `ProgressChecklist` distinguishes AI-ticked from student-ticked; student can
  untick an AI tick
- `make audit-trust-cards` passes (the CI `local-mode-safety` gate)

### Manual (aitana-frontend-verify)

Author an activity with a table + chart + checklist, join as a student, **send
one neutral opening message without touching any element**, and assert the
tutor's reply names the table. That is Aswin's exact reproduction.

## Security Considerations

The manifest is composed from a config already resolved through the student's
verified `group_tags` → class binding ([`teacher_focus.py:45`](../../../../backend/adk/teacher_focus.py#L45)),
so it introduces no new read path. The tick tools must key off `group_id` from
the **verified JWT claim**, never a tool argument — otherwise one group could
tick another group's checklist. Both students (group JWT, `email=""`) and
teachers in preview must work; the tools read `tool_context.state["user:id"]`
and the group claim, never `User.email`.

## Success Criteria

- [ ] With elements authored and no interaction, the tutor's first turn names them
- [ ] `mark_checklist_item` ticks an item from conversation, with a visible card
- [ ] Ticks survive reload and rejoin on a new session id
- [ ] A teacher-authored ILO beats a conflicting curriculum objective
- [ ] Registry-completeness test fails when a new element kind has no describer
- [ ] Composed focus stays under the 10k instruction cap on a maximal config
- [ ] `aiplatform activity manifest` prints what the tutor is told
- [ ] `make audit-trust-cards` green

## Open Questions

1. **Does a chart with no data deserve manifest space?** A chart auto-plots the
   table, so it may be noise until the table has rows. Proposed: include it —
   the tutor can then say "the chart will fill in as you go", which is exactly
   the invitation Aswin found missing.
2. **Checklist vs concept-map overlap.** An activity with both gets two
   progress-shaped blocks. Proposed for M1: emit both and observe; if the tutor
   conflates them, the concept map (richer) suppresses the checklist tick
   contract while keeping its description.
3. **Should an AI tick be provisional until the student confirms?** Axiom 2
   argues yes; the friction argues no. Proposed: tick immediately, card it,
   allow untick — matching `record_checkpoint`'s shipped posture.

## Related Documents

- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38, the registry
- [living-concept-map.md](living-concept-map.md) — the checkpoint precedent this copies
- [tutor-register-citation-and-language.md](tutor-register-citation-and-language.md) — 1.1.63, the sibling prompt fix from the same feedback
- [multi-chart-variable-selection.md](multi-chart-variable-selection.md) — 1.1.64
- `.claude/skills/workbench-element-builder/SKILL.md` — gains a third rule from this doc
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's raw feedback
