# Unified sim rendering — one system for simulations (retire the slug-driven path)

**Status:** Planned — **PRE-PILOT cleanup** (raised 2026-06-25, M). Surfaced by the
ALS-1 activity migration: a teacher edits a migrated "Problem-set hints (Boldkast)"
activity and the builder preview is empty, but the student sees the sim — a visible
"dirty in-between" that erodes trust in the editor.
**Last Updated:** 2026-06-25
**Priority:** P1 — directly fixes an observed editor/runtime divergence on a core
surface (the activity builder). Blocks a coherent sim-authoring story.
**Estimated:** ~4–6d fullstack, phased (artefact self-containment ~2–3d · runtime
dispatch unification ~1d · data migration ~0.5d · retire legacy ~0.5–1d)
**Scope:** Frontend-heavy (the rendering dispatch + the 3 sim artefacts) + a small
backend data migration. No protocol/event-bridge change — that's already unified.
**Dependencies:** [activity-library-sharing.md](activity-library-sharing.md) (ALS-1 —
the migration that surfaced this; sim activities now exist as library entries);
[teacher-sim-resources.md](teacher-sim-resources.md) (1.1.41 — the artefact model +
the catalogue/adopt pattern this generalises to ALL sims); [teacher-ux-refinement.md](teacher-ux-refinement.md)
(1.1.32 — names this the "Phase-B template refactor"); the `mcp-app-artefact` skill
(the static-artefact path + the two-surface event rule).
**Source:** 2026-06-25 — M: *"how is the migration of Boldkast working? … when I click
through to edit the activity the simulation is not live in its preview … but when I am
using it in the class I see the simulation. seems we are in a dirty inbetween state …
we need to tidy this up — no dual systems."*

## The problem: two systems render the same sims

A simulation reaches the student through **two parallel mechanisms**, and the teacher
builder only understands one of them.

| | **OLD — slug-driven (legacy)** | **NEW — artefact-driven (1.1.41)** |
|---|---|---|
| What selects the sim | `SIM_WORKSPACE_SLUGS` registry in [workspaceContent.ts](../../../frontend/src/app/chat/[...path]/workspaceContent.ts) (`problem-set-hints`→Boldkast, `led-planck-tutor`→LED-Planck, `kinebot-kinematics-tutor`→KineBot) | `activity.artefactId` (a catalogue id) |
| What renders it | bespoke `BoldkastSimFrame` / `LedPlanckLabFrame` / `KineBotFrame` **+** a React workbench-results panel (`BoldkastWorkbench` etc.) **+** a per-sim snapshot hook (`useBoldkastSnapshot` etc.) | the generic `GenericArtefactFrame` inside `StudentWorkspace` |
| Where it's wired | hardcoded render cases in [chat page](../../../frontend/src/app/chat/[...path]/page.tsx) (`usesStudentWorkspace = false` for the 3 slugs) | one generic mount; **the builder preview uses this same `StudentWorkspace`** |
| Editor can preview it | **No** | Yes |

A migrated sim activity is `skillId=problem-set-hints, artefactId=None`. At runtime the
**slug path** fires (skill slug ∈ `SIM_WORKSPACE_SLUGS`) → the sim renders. In the
builder the **artefact path** is read (`artefactId` is None) → empty preview. Same
activity, two answers. The teacher concludes the editor is broken.

## What is already unified (so this is smaller than it looks)

> **Read first.** The expensive part of a sim — the event bridge to the tutor — is
> **already one system**. Don't re-plumb it.

1. **The event/snapshot bridge is shared.** `useBoldkastSnapshot` already routes
   through the shared [`useSimSnapshotPush`](../../../frontend/src/hooks/useSimSnapshotPush.ts)
   → `POST /api/sessions/{id}/iframe-context` → session state under
   `mcp_app_context.{server}.{tool}` → injected into the agent prompt
   ([iframe_context_routes.py](../../../backend/protocols/iframe_context_routes.py)).
   The generic `GenericArtefactFrame` uses the **same** `useSimSnapshotPush`. The
   `tool_configs.mcp.servers: ['boldkast','progress']` on the skill is the
   iframe-context **namespace**, not a separate backend MCP call. So sim→tutor events
   are already protocol-unified — this refactor must **preserve**, not rebuild, it.
2. **The artefacts already exist.** `infrastructure/mcp-sandbox/artefacts/{boldkast,led-planck,kinebot}/v1/index.html`
   are live sandboxed sims (one already runs the generic path: the `Kastebevægelse`
   activity = `concept-dialogue` + `artefactId=boldkast`).

So the dual system is **purely in the rendering dispatch**: the slug registry + the 3
bespoke frames + their React workbench-results panels. Everything below the iframe is
one system.

## The one real gap: the workbench-results panel

`BoldkastWorkbench` is a **React** panel beside the iframe that computes physics
results (range, time-of-flight, revealed values) from the snapshot — it is **not**
in the sandboxed artefact, which is just the visual sim. KineBot/LED-Planck have the
same shape. So "drop the bespoke frame, render the generic artefact" loses that panel
unless we relocate it.

**Decision (recommended): make each sim artefact self-contained** — move the
results/workbench UI **into** the sandboxed `index.html` (it already has the snapshot
state internally; it's the source of the events). Then the artefact is the whole sim
(canvas + results), one `GenericArtefactFrame` renders it, and there is exactly one
render path. (Alternative — a generic mount that looks up a per-artefact React
workbench component from a registry — is rejected: it keeps a per-sim React component,
i.e. the dual system in a thinner disguise. See Open Questions.)

## Target architecture

```
            activity.artefact_id  ──►  GenericArtefactFrame  ──►  sandboxed iframe
                  (catalogue id)         (one mount, everywhere)     (sim + results,
                                                                       self-contained)
                          │                                              │
   editor preview ───────┘  (same StudentWorkspace)        useSimSnapshotPush
   student runtime ──────┘                                  └► iframe-context ► tutor
```

One selection input (`artefact_id`), one mount (`GenericArtefactFrame`), one event
bridge (`useSimSnapshotPush`/iframe-context — unchanged). `SIM_WORKSPACE_SLUGS`, the 3
bespoke `*SimFrame`/`*Workbench` components, and the per-sim snapshot hooks are
**deleted**. `workspaceContentKind` returns `"sim"` purely from `artefact_id`, not a
slug allowlist.

### Skills keep their tutor logic

`problem-set-hints` / `led-planck-tutor` / `kinebot-kinematics-tutor` stay as distinct
**skills** (their instructions, sub-parts, grounding) — they just stop being the
*selector* for a sim. The activity carries `artefact_id` (the sim) **and** `skill_id`
(the tutor). This matches ALS-1's "running skill resolved from content" and the 1.1.41
"a sim is an attachable resource" stance. (Collapsing them to `concept-dialogue` is a
non-goal — it would discard purpose-built tutor scaffolding; see Open Questions Q4.)

## Data migration

Set `artefact_id` on the migrated sim activities so the artefact path drives them:

| activity skill | set `artefact_id` |
|---|---|
| `problem-set-hints` (ec34861d…) | `boldkast` |
| `led-planck-tutor` (cb778efa…) | `led-planck` |
| `kinebot-kinematics-tutor` (ed127f37…) | `kinebot` |

A one-shot script maps the 3 sim-skill ids → their artefact ids and patches every
matching `activities/*` doc (idempotent; dry-run first; record side effects per the
Terraform-recipe discipline). Until run, the slug path still works (dual-read), so the
migration and the runtime cutover are independently shippable.

## Backend / API impact

Minimal. `artefact_id` already round-trips on `Activity` (ALS-1) and resolves to its
public catalogue view in `activity_config_routes`/`teacher_focus`. No new endpoint;
the only backend work is the data migration script + (optional) a CLI:
`aiplatform activity set-artefact <activity_id> <artefact_id>` and a one-shot
`scripts/backfill_sim_artefacts.py`.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 2 | EARNED TRUST | +1 | Editor preview === student runtime by construction — the teacher sees exactly what students get; removes the "is the editor broken?" doubt. |
| 3 | SKILLS, NOT FEATURES | +1 | A sim becomes a pure resource (artefact) attachable to any activity; the skill is just the tutor. Removes the "sim == its skill" special case. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Deletes a bespoke per-sim rendering path in favour of the generic MCP-App-artefact mount + the already-standard iframe-context event bridge. No new format. |
| 7 | API FIRST | 0 | Migration is a script + optional CLI; no new runtime API. |
| 8 | OBSERVABLE | 0 | Event bridge unchanged (still OTel-spanned via iframe-context). |
| 10 | THIN CLIENT | +1 | Removes ~3 bespoke frame components + workbench panels + snapshot hooks from the client; one generic mount. |
| 11 | USABLE BY DESIGN | +1 | One coherent authoring model — attach a sim, see it in the preview, students see the same. |
| | **Net** | **+5** | Threshold ≥ +4. No axiom scores −1. |

## Milestone phasing

| MS | Deliverable | Est | Gate |
|---|---|---|---|
| **M0** | **Artefact self-containment.** Move the results/workbench UI into each sim's sandboxed `index.html` (Boldkast first, then LED-Planck, KineBot). Verify the snapshot/event payloads are unchanged (the tutor still gets `mcp_app_context.boldkast.*`). | ~2–3d | per-sim browser parity vs the bespoke workbench |
| **M1** | **Runtime dispatch on `artefact_id`.** `workspaceContentKind` keys off `artefact_id`; `usesStudentWorkspace` true for sims; render via `GenericArtefactFrame`. Dual-read: the slug path stays until the data migration runs. | ~1d | a sim activity renders identically through the generic mount |
| **M2** | **Data migration.** `backfill_sim_artefacts.py` sets `artefact_id` on the 3 sim-skill activities (dry-run → apply on dev). Editor preview now shows the sim. | ~0.5d | editor preview === runtime on a migrated activity |
| **M3** | **Retire the legacy path.** Delete `SIM_WORKSPACE_SLUGS`, `BoldkastSimFrame`/`LedPlanckLabFrame`/`KineBotFrame`, `*Workbench`, the per-sim snapshot hooks, and their chat-page render cases. | ~0.5–1d | no slug registry; all sims on one path; full CI green |

M0–M1 are independently valuable (a sim can run on the generic mount before the legacy
path is deleted). M3 is the "no dual systems" gate.

## Testing strategy

- **Per-sim parity (M0):** browser-verify each sim through the generic mount vs the
  bespoke frame — same controls, same results panel, **same** iframe-context payloads
  (assert the `mcp_app_context.{sim}.*` state the tutor reads is byte-identical so the
  tutor's behaviour doesn't change). Use the `aitana-frontend-verify` skill.
- **Dispatch (M1):** unit-test `workspaceContentKind` keys off `artefact_id` (extend
  [workspaceContent.test.ts](../../../frontend/src/app/chat/[...path]/__tests__/workspaceContent.test.ts)).
- **Migration (M2):** test the backfill maps each sim skill → artefact id, idempotent,
  dry-run safe.
- **Regression (M3):** the chat page + builder preview render every sim; no dead
  imports; `npm run quality:check` + backend `make test-fast` green.

## Success criteria

- [ ] A teacher editing a sim activity sees the **live sim in the builder preview**
      (the reported bug).
- [ ] Student runtime renders every sim identically pre/post (no visual/behaviour
      regression); the tutor still receives the same sim events.
- [ ] `SIM_WORKSPACE_SLUGS` + the 3 bespoke frames/workbenches/snapshot hooks are
      deleted; exactly one sim render path remains.
- [ ] The 3 migrated sim activities carry `artefact_id`; dev data migrated.

## Open questions

- **Q1 — workbench UI: into the artefact, or a generic per-artefact panel?**
  Recommendation: **into the artefact** (self-contained → truly one path). A generic
  React panel registry keeps a per-sim component (dual system in disguise). Confirm,
  given M0 is the bulk of the effort.
- **Q2 — event-payload parity.** The tutor reads `mcp_app_context.{sim}.{tool}` from
  the snapshot. M0 must keep those payload shapes identical or tutor behaviour shifts.
  Pin the exact snapshot schema per sim before moving the UI. (The "wire BOTH surfaces"
  rule — in-chat `MCPAppToolCallRouter` vs in-workspace `useSimSnapshotPush` — still
  applies; verify both.)
- **Q3 — sim launcher / `proactive-event-check`.** The bespoke frames hook
  `sendChatFlush` + the proactive-sim gate. Confirm the generic mount already wires
  these (it shares `useSimSnapshotPush`, which owns the proactive gate) — likely yes,
  verify per sim.
- **Q4 — do sim skills survive?** Recommendation: **yes** — keep `problem-set-hints`
  etc. as tutor skills with `artefact_id` set; do NOT collapse to `concept-dialogue`
  (loses scaffolding). Revisit only if the tutor logic turns out to be thin.
- **Q5 — non-AIPLA forks.** The bespoke frames may be referenced by the upstream
  template; log the deletion in [upstream-feedback.md](../../upstream-feedback.md).

## Related documents

- [activity-library-sharing.md](activity-library-sharing.md) — ALS-1; the migration that surfaced this
- [teacher-sim-resources.md](teacher-sim-resources.md) — 1.1.41; the artefact model + catalogue this generalises to all sims
- [teacher-ux-refinement.md](teacher-ux-refinement.md) — 1.1.32; names this the "Phase-B" refactor + removed the "Paired workbench" knob that pretended sims were activity-attachable
- [sim-catalogue-admin.md](sim-catalogue-admin.md) — 1.1.42; the publish/visibility CMS for sims
- the `mcp-app-artefact` skill — the static-artefact path, the 200 KB/CSP/sandbox gates, and the two-surface event rule
