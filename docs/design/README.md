# Design docs — where to look

One entry point for this tree. Not every folder here is the AIPLA roadmap; most
of it is inherited-template history. Read this before browsing.

## Start here for AIPLA

| You want… | Go to |
|---|---|
| **The AIPLA build sequence / roadmap** (what's shipped, what's next) | [`aipla/SEQUENCE.md`](aipla/SEQUENCE.md) |
| A specific AIPLA feature's execution design (paths, wire shapes, acceptance) | `aipla/<version>/` — `v0.1.0-jutland`, `v1.0.0-pilot`, `v1.1.0-feedback`, `v2.0.0-handover`, `post-pilot` |
| **Product / pedagogical design** (ADRs 001–015, strands, timeline, evaluation) | the **AIPLA scoping site** (public site <https://aipla.ku.dk/project>) — *not in this repo* |
| Maintainability & handover plan | [`aipla/v1.1.0-feedback/handover-maintainability-audit.md`](aipla/v1.1.0-feedback/handover-maintainability-audit.md) + its `-sprint.md` |

**The split, in one line:** *execution* design (how it's built in this repo) lives
here under `aipla/`; *product/pedagogical* design (why, ADRs, research questions)
lives in the scoping site. AIPLA docs here cite ADRs rather than restating them.

## What the other folders are (not the AIPLA roadmap)

- **`v6.0.0/`, `v6.1.0/`, `v6.2.0/`** — design docs for the **inherited
  open-source template** ("AI Protocol Platform v6"), frozen at the fork
  (2026-05-19). These are **kept, not archived**, because ~30 live code comments
  still backlink to them (e.g. `ttft-instrumentation.md`, `mcp-app-integrations.md`,
  `session-delete-ui.md`) as the design record for platform mechanics AIPLA still
  runs on. Treat them as reference for *how the platform works*, not as AIPLA's plan.
- **`forks/`** — design docs for other downstream forks of the template
  (`8bs-internal-tools`, `playground-tutor`). Not AIPLA.
- **`mockups/`** — image mockups (e.g. JB's workbench sketches).

## Conventions

- Each AIPLA feature is a design doc plus (usually) a `*-sprint.md` execution plan.
- Shipped docs move to an `implemented/` subdir under their version folder; the
  version `SEQUENCE.md` is the authoritative done-vs-open index (inline "shipped"
  notes in tables can be stale).
- New AIPLA design docs: use the `design-doc-creator` skill so they land in the
  right layout and register in `SEQUENCE.md`.
