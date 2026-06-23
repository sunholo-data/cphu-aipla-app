# Sim catalogue admin — import + manage artefacts (the tutorBlock CMS)

**Status:** Planned — **roadmap signal, POST-PILOT** (the pilot runs on the static YAML catalogue + AR-via-PR; this is its runtime-editable evolution)
**Last Updated:** 2026-06-22
**Priority:** P2 — post-pilot. Lets a non-engineer (AR / researcher / admin) **import a sim into the catalogue and edit its `tutorBlock`** (and topics / levels / status) **without a deploy**. Today those live in `backend/artefacts/*.yaml` and change only by PR.
**Estimated:** ~3–4d (Firestore override store + merge into the loader + admin CRUD endpoints + a thin admin UI + role gate + audit)
**Scope:** Fullstack — a Firestore artefact-override collection merged onto the static YAML defaults (1.1.41), admin CRUD endpoints (researcher/admin-gated), a `/teacher/admin/sims` (or researcher-view) surface, `aiplatform artefact set/import` CLI
**Dependencies:** [teacher-sim-resources.md](teacher-sim-resources.md) (1.1.41 — the catalogue + `ArtefactMeta` + loader this makes runtime-editable); [researcher-role.md](researcher-role.md) (1.1.5 / ADR-016 — the elevated `role:researcher` claim this gates on); [tutor-personas.md](tutor-personas.md) (1.1.12 — the **custom-personas-in-Firestore** v1.2 pattern this mirrors); [teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md) (2.4 — artefact *code* upload, the tier above this); [`mcp-app-artefact` skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) + ADR-013 (artefact safety)
**Source:** 2026-06-22 — M: *"perhaps add an admin section for importing sims where [the tutorBlock] is edited/set?"*

> **Read with 1.1.41 and 2.4 — this is the middle layer.** [1.1.41](teacher-sim-resources.md) shipped the catalogue as **static YAML** (deploy-time, AR-via-PR) — right for the pilot. [2.4 teacher-artefact-authoring](../post-pilot/teacher-artefact-authoring.md) is the Year-2 top layer (teachers *write new artefact code*, ADR-013 review queue). **This doc is between them: a runtime CMS over the catalogue *metadata + `tutorBlock`*** for artefacts whose code is already deployed — so AR can iterate tutoring wording and onboard a deployed sim **without an engineer or a deploy**. It does **not** open a code-upload path (that stays 2.4 / the developer ADR-013 flow).

## Why this exists

1.1.41's `tutorBlock`s ship as YAML (`backend/artefacts/boldkast.yaml`), edited only by PR + redeploy. Two post-pilot frictions make that too slow:

1. **AR will iterate `tutorBlock`s from pilot transcripts.** "The Boldkast tutoring should ask about units earlier" is a one-line wording change that currently needs a PR + a backend deploy. AR should edit it in a UI and see it live next session.
2. **The catalogue grows.** The jitt-dk 23 + others onboard post-pilot; registering each (metadata + `tutorBlock` for an already-deployed artefact path) shouldn't be an engineering task once the artefact code is deployed.

The shape is **already proven**: the persona catalogue (1.1.12) flagged **custom personas in Firestore merged onto the YAML defaults** as its v1.2 follow-up. This is the identical move for artefacts.

**Hard boundary (keep it honest):** this manages **metadata + `tutorBlock`** for artefacts whose **code is already deployed** (under `infrastructure/mcp-sandbox/artefacts/`, ADR-013-reviewed). It does **not** upload or execute artefact code — that capability is tier-3 ([2.4](../post-pilot/teacher-artefact-authoring.md)) with its own review queue. "Import a sim" here = **register/override its catalogue entry**, not ship its HTML.

## Design

### Override store merged onto the YAML defaults

The 1.1.41 loader becomes: **static YAML defaults ⊕ Firestore overrides** (overrides win per-id; new ids are admin-added entries):

```
load_artefacts() = merge(
    yaml_defaults(),                    # backend/artefacts/*.yaml (shipped, AR-seeded)
    firestore_overrides(),              # artefact_catalogue/{id} (admin-edited, runtime)
)
```

- Editing `boldkast`'s `tutorBlock` writes `artefact_catalogue/boldkast` (override) — the YAML stays as the deploy-time default/fallback.
- Adding `pendul` (jitt-dk, code already deployed) writes a new `artefact_catalogue/pendul` doc — no YAML, no deploy.
- **Graceful by construction:** Firestore unreachable → the YAML defaults still serve (the pilot's exact behaviour). The override layer is purely additive.
- An override may only point `artefactPath` at a **deployed** artefact dir (validated against the served sandbox manifest) — so a catalogue entry can never reference code that isn't there.

### Admin surface (researcher/admin-gated)

A `/teacher/admin/sims` surface (or a tab in the researcher view) — gated on the elevated **`role:researcher`** claim (ADR-016), the same tier that already bypasses class scoping:

- **List** the merged catalogue (source-badged: `yaml default` vs `override` vs `admin-added`).
- **Edit** an entry's `tutorBlock`, `displayName`, `description`, `topics`, `levels`, `status` (live/beta/deprecated — the same `status` filter the builder picker reads, so deprecating hides a sim from teachers instantly).
- **Import** a deployed artefact: pick from the served sandbox manifest (the artefact dirs that exist) → fill metadata + `tutorBlock` → publish.
- **Preview the composed prompt** — reuse the [1.1.27 resolved-prompt preview](lesson-author-surface.md) so AR sees how the `tutorBlock` reads inside a real activity's `{teacher_focus}` before publishing.

### API + CLI

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/admin/artefacts` | GET | merged catalogue **with** source + `tutorBlock` (admin view) | researcher |
| `/api/admin/artefacts/{id}` | PUT | upsert an override / new entry | researcher |
| `/api/admin/artefacts/{id}` | DELETE | drop an override (revert to YAML default) | researcher |

CLI parity: `aiplatform artefact set <id> --tutor-block-file <f> --status live`, `aiplatform artefact import <path>`.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 2 | EARNED TRUST | +1 | `tutorBlock` edits are **audited** (who/when) and previewable in the resolved prompt before publish — pedagogy provenance, not a silent change to how the AI tutors. |
| 4 | RIGHT MODEL | +1 | Deterministic CRUD + merge; no model. |
| 5 | GRACEFUL DEGRADATION | +1 | Firestore down → YAML defaults serve (the pilot's behaviour). The override layer is additive; nothing depends on it existing. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Extends the 1.1.41 catalogue + reuses the custom-personas Firestore-override pattern (1.1.12). No new format. |
| 7 | API FIRST | +1 | Admin CRUD endpoints + CLI; the UI renders the contract. |
| 8 | OBSERVABLE | +1 | Every catalogue change audited (researcher uid + diff). |
| 9 | SECURE BY CONSTRUCTION | +1 | Researcher/admin-gated; `tutorBlock` is reviewed text reaching the model via the existing `{teacher_focus}` boundary; **no code path opened** — `artefactPath` must resolve to a deployed (ADR-013-reviewed) artefact, so the CMS can never introduce executable content. |
| 10 | THIN CLIENT | +1 | Merge + CRUD + audit backend; the UI is a thin admin surface. |
| 11 | USABLE BY DESIGN | +1 | AR iterates tutoring wording + onboards deployed sims with no engineer, no deploy. |
| | **Net Score** | **+9** | Threshold ≥ +4. (INSTANT / SKILLS neutral — admin tooling.) |

## Milestone phasing

| MS | Deliverable | Est |
|---|---|---|
| **M0** | **Override store + merge.** `artefact_catalogue/{id}` Firestore model + loader merge (YAML ⊕ overrides) + tests (override wins; new id added; Firestore-down falls back to YAML). | ~1.5d |
| **M1** | **Admin CRUD + audit + role gate.** `/api/admin/artefacts` (researcher-only) + `artefactPath`-must-be-deployed validation + audit log + CLI. | ~1d |
| **M2** | **Admin UI.** List (source-badged) + edit `tutorBlock`/metadata + import-deployed + resolved-prompt preview (reuse 1.1.27). | ~1.5d |

## Open questions

- **Q1 — role.** Gate on `role:researcher` (exists, ADR-016) or a dedicated `role:catalogue-admin`? Recommendation: researcher for now (smallest surface); split out only if the audiences diverge.
- **Q2 — does an override fully replace or patch the YAML default?** Recommendation: **field-level patch** (override only the fields present) so a `tutorBlock`-only edit doesn't have to restate topics/levels — and reverting one field is a delete-field, not a whole-entry revert.
- **Q3 — versioning the `tutorBlock`.** Keep an edit history (revert to a prior `tutorBlock`)? Likely yes (audit already captures diffs); a "restore previous" affordance is cheap on top.
- **Q4 — boundary with 2.4.** This doc deliberately stops at metadata. Confirm the artefact-*code* upload + ADR-013 review queue stays [2.4](../post-pilot/teacher-artefact-authoring.md) and that the two share the catalogue (2.4 publishes code → this CMS manages its metadata).

## Related documents

- [teacher-sim-resources.md](teacher-sim-resources.md) — 1.1.41; the catalogue + `tutorBlock` this makes runtime-editable
- [tutor-personas.md](tutor-personas.md) — 1.1.12; the custom-personas-in-Firestore v1.2 pattern this mirrors
- [researcher-role.md](researcher-role.md) — 1.1.5 / ADR-016; the elevated role this gates on
- [lesson-author-surface.md](lesson-author-surface.md) — 1.1.27; the resolved-prompt preview reused to show the composed `tutorBlock`
- [teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md) — 2.4; the tier above (artefact *code* upload + review queue)
- [`mcp-app-artefact` skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) + ADR-013 — the artefact-code path this does **not** replace
