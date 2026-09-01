# AIPLA v2.0.0-handover — Build Sequence

> The handover workstream (weeks 16–17, handover milestone **2026-09-15** —
> **not** the end of the engagement; the extension runs to at least April 2027
> at 2.5 days/week, so this package is delivered *with its author still in the
> room*, and the self-host work is a live negotiation rather than a farewell
> note. See [ku-ai-office-alignment.md](ku-ai-office-alignment.md)). Per the
> top-level [SEQUENCE.md](../SEQUENCE.md), v2.0.0-handover = v1 + runbooks + eval
> automation + DPIA + Strand C scoping note + **the self-host migration package**.
> Architecture/strategy lives in the scoping site
> ([architecture.qmd](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd),
> [self-hosting.qmd](file:///Users/mark/Documents/clients/cph-uni/self-hosting.qmd),
> [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd)); this is execution.

## Ordering

| # | Doc | What it locks | ADRs | Est | Status |
|---|-----|---------------|------|-----|--------|
| 3.1 | [handover-package.md](handover-package.md) | Manifest: every Week-17 contracted deliverable against its actual evidence, the five promised runbooks, the co-owner fan-out, and a dated gap list. **The index the package is read through.** | — | 0.5d (inventory done) | **OPEN — inventory taken 2026-09-01.** 6 of 10 criteria met; gaps are the Strand C note (due 09-09), the JB-owned DPIA, two laptop-bound dependencies (P4.2/P4.4), two missing runbooks, and a stale co-owner table |
| 3.2 | [self-hosting-and-terraform-handover.md](self-hosting-and-terraform-handover.md) | UCPH on-prem **resource list**, hybrid topologies, ADR-003-tier model sizing, and a portable two-layer Terraform deliverable. The costable "what IT needs to host this" artefact. | 003, 005, 006, 007, 010, 012, 017 | 2d (audit, contracted) + 3–4d (reference stack, stretch) | **Planned — opened 2026-06-17** (UCPH IT request) |
| 3.4 | [ku-ai-office-alignment.md](ku-ai-office-alignment.md) | **Positioning against KU's 110M DKK AI push** (from 2026-09-01). Whether AIPLA is a *tenant* of the KU-wide AI platform, a *template* for it, or parallel to it. Decision doc + action list; touches no runtime code. Recommendation: tenant now, template as a conversation. | 001, 003, 006, 007 | ~1d (done) | **Scoping (OPEN) — opened 2026-08-27** |
| 3.5 | [capability-floor-for-ku-ai-office.qmd](capability-floor-for-ku-ai-office.qmd) | The capability-floor eval extracted for an **institutional** audience deciding a model catalogue: the three findings that generalise past physics (self-hosting viable now; a self-host tier needs a text model *and* a VL model; published benchmarks mis-rank the cheap candidates). Outward-facing companion to `ucph-it-hosting-requirements.qmd`. | 003 | ~0.5d (done) | **Drafted 2026-08-27** |
| 3.3 | [firestore-portability-seam.md](firestore-portability-seam.md) | Firestore→Postgres seam audit + hardening (Phase-1 slice of 3.2). Re-rates the DB port H→M, closes the two DAL leaks, formalises the `FirestoreClient` Protocol, fixes a latent `LOCAL_MODE` crash. | 001, 010, 017 | 1d | **Implemented 2026-06-17** |

## Phasing (3.2)

| Phase | Output | Est | Gate |
|---|---|---|---|
| 0 | This doc + accurate component inventory + resource list | done on landing | satisfies contracted "notes good enough for IT to estimate" |
| 1 | Portability-seam audit (GCP-bound code paths + per-seam swap spec; pgvector retrieval tool). **Firestore slice delivered** → [3.3](firestore-portability-seam.md) (H→M, leaks closed, Protocol formalised). **Memory-bank decision made: drop** (foreclosed by ADR-001 anonymity + not populated today). Remaining: session-service / RAG / auth / GCS seams. | ~2d | — |
| 2 | On-prem reference Terraform/Helm (Layer 2) + `docker compose` local mirror | ~3–4d | stretch / over-deliver; trades vs remaining v1.1 work |

## Dependencies

- Builds on **1.1** [aipla-cloud-bootstrap.md](../v1.0.0-pilot/aipla-cloud-bootstrap.md) (GCP Terraform consolidation = Layer 1).
- Migration **trigger** is eval-gated: the capability-floor eval ([evaluation.qmd](file:///Users/mark/Documents/clients/cph-uni/evaluation.qmd)) clearing ~70–80% local-readiness per task class **and** UCPH IT confirming hosting (`self-hosting.qmd` "when to trigger"). **Both gates now look likely to land inside the engagement.** The eval gate is *already met* for stx physics — the July-2026 snapshot puts Tiers 1–3 over the ≥80% floor on both text and figures ([capability-floor-for-ku-ai-office.qmd](capability-floor-for-ku-ai-office.qmd)). The hosting gate is moving: KU IT is building internal local-model infrastructure as part of the 110M DKK AI push from 2026-09-01. So "produces the scoping, does not execute the cutover" is **no longer a safe default assumption** — re-decide it deliberately at the first AI-office contact.
- Co-owned with **P2 (when hired) + UCPH IT** from a Week-6 runbook v0 (timeline.qmd handover fan-out).

## Timeline anchors

- **2026-06-17** — UCPH IT requested the resource list; 3.2 opened.
- **2026-08-14** — Pilot starts (v1.0.0-pilot); handover docs firm up alongside.
- **2026-09-01** — KU's 110M DKK / 3-year AI push begins; first vice-rector for AI takes office; AI office, cross-faculty taskforce and AI-labs stand up. The counterparty for this workstream now exists and is funded.
- **2026-09-15** — Handover milestone. Self-host package complete enough for IT to estimate effort (the original contracted bar). **Not the end of the engagement.**
- **2026-09 → ≥2027-04** — Extension at 2.5 days/week, overlapping the AI office's entire formation phase. Executing at least the tenancy half of the migration (teacher SSO onto KU OIDC, inference pointed at KU-hosted models) is a real candidate in this window.
