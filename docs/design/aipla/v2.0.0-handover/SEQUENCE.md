# AIPLA v2.0.0-handover — Build Sequence

> The handover workstream (weeks 16–17, final handover **2026-09-15**). Per the
> top-level [SEQUENCE.md](../SEQUENCE.md), v2.0.0-handover = v1 + runbooks + eval
> automation + DPIA + Strand C scoping note + **the self-host migration package**.
> Architecture/strategy lives in the scoping site
> ([architecture.qmd](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd),
> [self-hosting.qmd](file:///Users/mark/Documents/clients/cph-uni/self-hosting.qmd),
> [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd)); this is execution.

## Ordering

| # | Doc | What it locks | ADRs | Est | Status |
|---|-----|---------------|------|-----|--------|
| 3.1 | `handover-package.md` (planned) | Manifest: index of runbooks, deep-dive sessions, sign-offs, co-owners (handover fan-out in timeline.qmd) | — | TBD | Planned |
| 3.2 | [self-hosting-and-terraform-handover.md](self-hosting-and-terraform-handover.md) | UCPH on-prem **resource list**, hybrid topologies, ADR-003-tier model sizing, and a portable two-layer Terraform deliverable. The costable "what IT needs to host this" artefact. | 003, 005, 006, 007, 010, 012, 017 | 2d (audit, contracted) + 3–4d (reference stack, stretch) | **Planned — opened 2026-06-17** (UCPH IT request) |
| 3.3 | [firestore-portability-seam.md](firestore-portability-seam.md) | Firestore→Postgres seam audit + hardening (Phase-1 slice of 3.2). Re-rates the DB port H→M, closes the two DAL leaks, formalises the `FirestoreClient` Protocol, fixes a latent `LOCAL_MODE` crash. | 001, 010, 017 | 1d | **Implemented 2026-06-17** |

## Phasing (3.2)

| Phase | Output | Est | Gate |
|---|---|---|---|
| 0 | This doc + accurate component inventory + resource list | done on landing | satisfies contracted "notes good enough for IT to estimate" |
| 1 | Portability-seam audit (GCP-bound code paths + per-seam swap spec; pgvector retrieval tool). **Firestore slice delivered** → [3.3](firestore-portability-seam.md) (H→M, leaks closed, Protocol formalised). **Memory-bank decision made: drop** (foreclosed by ADR-001 anonymity + not populated today). Remaining: session-service / RAG / auth / GCS seams. | ~2d | — |
| 2 | On-prem reference Terraform/Helm (Layer 2) + `docker compose` local mirror | ~3–4d | stretch / over-deliver; trades vs remaining v1.1 work |

## Dependencies

- Builds on **1.1** [aipla-cloud-bootstrap.md](../v1.0.0-pilot/aipla-cloud-bootstrap.md) (GCP Terraform consolidation = Layer 1).
- Migration **trigger** is eval-gated: the capability-floor eval ([evaluation.qmd](file:///Users/mark/Documents/clients/cph-uni/evaluation.qmd)) clearing ~70–80% local-readiness per task class **and** UCPH IT confirming hosting (`self-hosting.qmd` "when to trigger"). This workstream produces the *scoping + deliverable*; it does not execute the cutover within the contract unless both gates land.
- Co-owned with **P2 (when hired) + UCPH IT** from a Week-6 runbook v0 (timeline.qmd handover fan-out).

## Timeline anchors

- **2026-06-17** — UCPH IT requested the resource list; 3.2 opened.
- **2026-08-14** — Pilot starts (v1.0.0-pilot); handover docs firm up alongside.
- **2026-09-15** — Final handover. Self-host package complete enough for IT to estimate effort (the contracted bar).
