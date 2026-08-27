# self-hosting-and-terraform-handover — UCPH on-prem resource list + portable Terraform

**Status**: Planned — opens the v2.0.0-handover workstream (SEQUENCE row 3.2)
**Priority**: P0 — UCPH IT has formally requested the resource list (internal IT meeting 2026-06-17). This is the long-pole half of the final handover package and gates UCPH's own infrastructure planning/budgeting cycle.
**Estimated**: Doc + portability-seam audit ~2d; reference on-prem Terraform/Helm stack ~3–4d (phased — see Implementation Plan). The *contracted* minimum (migration notes good enough for IT to cost) is the ~2d audit.
**Scope**: Infra + handover — component inventory, hybrid topologies, model-sizing, a portable Terraform deliverable, and a costable resource list for UCPH IT.
**Dependencies**: ADR-003 (four model tiers), ADR-005 (chat-log storage / data residency), ADR-006 (GCP EU for the prototype), ADR-007 (`europe-north1`), ADR-010 + ADR-017 (RAG store: managed Vertex now, pgvector is the on-prem target), ADR-012 (AILANG ecosystem). Builds on [aipla-cloud-bootstrap.md](../v1.0.0-pilot/aipla-cloud-bootstrap.md) (the GCP-side Terraform consolidation) and the [`infrastructure/modules/`](../../../../infrastructure/modules/) set. Supersedes the execution detail of the scoping site's [`self-hosting.qmd`](file:///Users/mark/Documents/clients/cph-uni/self-hosting.qmd) stub (which is now out of date against what v0.1/v1 actually deployed — see "Correcting the self-hosting.qmd stub" below).
**Created**: 2026-06-17
**Last Updated**: 2026-08-27 (framing revised — see *What changed*)

---

## Problem Statement

UCPH internal IT met with us on **2026-06-17** and asked for a concrete list of what they would need to host AIPLA inside the university. The scoping site has long carried a [`self-hosting.qmd`](file:///Users/mark/Documents/clients/cph-uni/self-hosting.qmd) stub and ADR-003's four-tier model strategy, but two things are now true that the stub does not capture:

1. **The deployed reality has diverged from the stub.** `self-hosting.qmd` was written when the *lean* was Cloud SQL Postgres + pgvector and "prefer not to use Firestore" (ADR-005). What actually shipped in v0.1/v1 is **Firestore** (application DB), **Vertex AI RAG Engine** (curriculum RAG, not pgvector — ADR-017 records this), and **Vertex AI Agent Engine** (session + memory persistence — not in the stub at all). The stub's migration table is therefore an inaccurate basis for an IT estimate. UCPH needs the *real* component list.

2. **The contracted handover deliverable is specifically a costable estimate.** *(Framing updated 2026-08-27 — see "What changed" below; the estimate is still owed, but it is no longer the ceiling.)* Per the scoping site [`timeline.qmd`](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd), the Week-17 definition of done includes "UCPH self-host migration notes complete enough for IT to estimate effort," with **P2 (when hired) + UCPH IT co-owning** the cloud-infra artefact from a Week-6 runbook v0. IT cannot estimate against a stub.

**Current State:**
- Self-hosting guidance is split between an out-of-date scoping stub and ADR-003's tier strategy; neither maps the *actual* deployed GCP surface to UCPH equivalents.
- The team has kept a GCP deployment script ([`scripts/bootstrap-aipla-dev.sh`](../../../../scripts/bootstrap-aipla-dev.sh)) + modular Terraform ([`infrastructure/modules/`](../../../../infrastructure/modules/)) precisely so a migration target exists — but it targets GCP only. There is no on-prem/hybrid reference.
- Model selection is "use top-of-line cloud" (`gemini-3.5-flash` default, Sonnet 4.6 fallback). No documented open-weight equivalents sized to real hardware, and no link from the [capability-floor eval](file:///Users/mark/Documents/clients/cph-uni/evaluation.qmd) to a hardware spec.

**Impact:**
- **UCPH IT (blocked):** cannot scope hardware, budget, or governance without the real list. This is the immediate ask.
- **AIPLA handover (P0):** this is half the handover package; the other half (runbooks, DPIA) references it.
- **Architecture decision quality:** the Firestore + managed-RAG choices were made for v0.1 *speed* (ADK ships them first-class). That speed bought migration debt. This doc quantifies that debt honestly so the on-prem estimate is real, not optimistic.

---

## What changed (2026-08-27)

This doc was written on 2026-06-17 against two assumptions that no longer hold.
Both loosened the *same* constraint, so the revision points one way: **the
ceiling on this workstream was the calendar and the counterparty, and both moved.**

| Written assuming | Actually true from 2026-08-27 |
|---|---|
| The engagement ends **2026-09-15**, so the deliverable can only be *notes someone else acts on* | Extension awarded 2026-08 runs to **at least April 2027 at 2.5 days/week**. The author of the notes is present while they are acted on. |
| UCPH IT is a **passive counterparty** who might, someday, provision hosting | KU is spending **110M DKK over three years from 2026-09-01**, has appointed a first **vice-rector for AI**, and **KU IT is already building internal local-model infrastructure** with a planned KU-wide AI platform (log in with KU credentials, pick a model per task). |
| The local-readiness gate is **distant** | It is **met** for stx physics. The July-2026 capability-floor snapshot puts Tiers 1–3 over the ≥80% floor on text *and* figures. |

Three consequences, in order of how much they change the work:

1. **The question to UCPH IT changes from "can you host this" to "can AIPLA be a
   tenant of what you are building — and should your platform be built from
   AIPLA?"** The component inventory below is still exactly right; its *purpose*
   shifts from a costing input to an interop specification. Restated for the
   external audience in
   [ucph-it-hosting-requirements.qmd](ucph-it-hosting-requirements.qmd) §4b.
2. **"Do not execute the migration" is no longer a safe default** (see Non-Goals).
   The tenancy half is plausibly in-window.
3. **The capability-floor eval is now an institutional asset, not just a routing
   input.** KU has to size and right-size a model catalogue and has said it has
   no answer yet on the climate footprint. Extracted for that audience as
   [capability-floor-for-ku-ai-office.qmd](capability-floor-for-ku-ai-office.qmd).

Nothing in the technical inventory (§1–§7) is invalidated by this. The migration
debt called out honestly in §1 — Firestore, Vertex RAG Engine, Agent Engine —
is unchanged, and matters *more* under a template pitch than under a tenancy
pitch, because a platform others build on cannot carry a GCP-shaped seam quietly.

See [ku-ai-office-alignment.md](ku-ai-office-alignment.md) for the positioning
decision this feeds.


## Goals

**Primary Goal:** Produce (a) an accurate component-by-component inventory of the live AIPLA stack mapped to self-hosted equivalents, (b) a hybrid-topology decision framework, (c) model-sizing options tied to ADR-003's tiers and real GPU hardware, and (d) a portable-Terraform deliverable strategy — such that UCPH IT can cost an on-prem or hybrid deployment, and a successor can `terraform apply` (or read as scoping) the result.

**Success Metrics:**
- Every live GCP binding from the [infrastructure inventory](#1-the-real-deployed-surface--self-hosted-equivalents) has a named self-hosted equivalent, a migration-effort rating, and a portability note.
- UCPH IT can answer "what hardware do we buy / provision" from the [resource list](#5-the-costable-resource-list-for-ucph-it) without further derivation, given a chosen hybrid tier.
- The model-sizing section gives a *minimum-viable* and a *comfortable* GPU spec for each model tier, with named open-weight models and VRAM-at-quant figures.
- The Terraform deliverable is structured so the GCP modules and the on-prem reference modules share variables — "swap the backend module, keep the contract."
- The five (now refined) outstanding questions for UCPH IT are explicit and answerable.

**Non-Goals:**
- ~~Actually executing the migration.~~ **Under review as of 2026-08-27.** This was a safe non-goal when the engagement ended 2026-09-15 and both trigger conditions looked distant. Neither still holds: the local-readiness threshold is **already met** for stx physics (Tiers 1–3 clear the ≥80% floor on text *and* figures — July-2026 snapshot), KU IT is **actively building** internal local-model infrastructure under the 110M DKK AI push, and the engagement now runs to at least April 2027 at 2.5 days/week. Executing the *tenancy* half — teacher SSO onto KU OIDC, inference pointed at KU-hosted models, app and data staying where they are — is a plausible in-window deliverable. Keep the *full* on-prem cutover (Postgres, object storage, RAG store) as the non-goal until KU IT confirms what they can host. See [ku-ai-office-alignment.md](ku-ai-office-alignment.md).
- Picking the final on-prem models blind. Final selection is **eval-driven** (capability-floor eval per task class) — this doc sizes the *candidates*, the eval picks the winners.
- Re-deriving AIPLA product/pedagogical rationale — that lives in the scoping site ADRs; cited here, not restated.
- Productionising LOCAL_MODE as the on-prem runtime (LOCAL_MODE proves the seams exist; production on-prem fills them with real backends, not in-memory stubs).

---

## Axiom Alignment

Scored per [Product Axioms](../../../product-axioms.md). Net must be >= +4; max 2 conflicts.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Infra. Local inference may *raise* TTFT vs cloud frontier models on weaker GPUs — flagged as a hybrid trade, not a goal. |
| 2 | EARNED TRUST | 0 | No factual-claim surface changes. |
| 3 | SKILLS, NOT FEATURES | 0 | Invisible to end users; skills/UX unchanged across hosting. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Operationalises ADR-003's four tiers + capability-floor routing: place each task class on the cheapest tier that clears its floor, fall back up to cloud only where needed. |
| 5 | GRACEFUL DEGRADATION | +1 | Hybrid = tier fallback (local → cloud API). Leans on the existing in-memory/`LOCAL_MODE` fallbacks and the RAG graceful-degrade path; the on-prem design keeps "useful state on component loss". |
| 6 | PROTOCOL OVER CUSTOM | +1 | Targets OpenAI-compatible inference (vLLM/Ollama), S3-compatible object store, OIDC/SAML SSO, standard Postgres+pgvector, and ADK's own `DatabaseSessionService` — adopt standards, not bespoke. |
| 7 | API FIRST | 0 | One API surface; hosting is a transport/runtime concern, channels unaffected. |
| 8 | OBSERVABLE BY DEFAULT | +1 | The migration must not lose trace/log coverage: the resource list mandates an equivalent telemetry stack (OTEL → self-hosted collector + Grafana/Tempo/Loki or ELK), preserving the principle on-prem. |
| 9 | SECURE BY CONSTRUCTION | +1 | On-prem is the strongest form of "data inside the trust boundary." Combined with anon-group-JWT (no student PII by construction, ADR-001) + EU residency, full on-prem gives UCPH maximal data sovereignty. Tightens the boundary; relaxes nothing. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Frontend unchanged. |
| 11 | USABLE BY DESIGN | 0 | No student-facing surface; a correct migration is invisible to students (an explicit goal). |
| | **Net Score** | **+5** | Threshold met. Zero conflicts. |

**Conflict Justifications:** None (no -1 scores).

---

## 1. The real deployed surface → self-hosted equivalents

This is the **resource list** UCPH asked for, at the component level. It is the accurate inventory of what AIPLA actually runs on today (verified against the live `aipla-dev-2026` deployment, `cloudbuild.yaml`, `infrastructure/modules/`, and the backend service-init code), each row mapped to a self-hosted equivalent.

**Migration-effort key:** **L** = low (config/abstraction swap, hours), **M** = medium (new component to stand up + a code seam to fill, days), **H** = high (a subsystem with no drop-in OSS equivalent, 1–2+ weeks).

### 1a. Compute / runtime

| Live (GCP) | Role | GCP binding | Self-hosted equivalent | Effort | Portability notes |
|---|---|---|---|---|---|
| Cloud Run `aipla-v01-frontend` (Next.js + FastAPI sidecar, multi-container) | App runtime | Container + env-var/secret refs | UCPH **Kubernetes** (Deployment + Service + Ingress) **or** VM + `docker compose` | L | Containerised, stateless, portable as-is. Frontend ~1 vCPU/2Gi; backend sidecar ~2 vCPU/4Gi. The only Cloud Run-isms are scaling annotations + secret `value_source` refs. |
| Cloud Run `aipla-v01-sandbox` (MCP App iframe host) | Static artefact host, separate origin (ADR-013) | Container, public ingress | Same k8s/VM; or any static host on a distinct origin | L | Plain static file server; needs its own origin for CSP isolation. |
| Cloud Build triggers (`aipla-dev-deploy`, `aipla-mcp-sandbox-deploy`) | CI/CD | Branch-triggered build+deploy | GitHub Actions / GitLab CI / Jenkins → k8s/registry | L | Dockerfiles + deploy step are the portable part; the trigger wiring is the GCP part. |
| Artifact Registry | Image registry | Docker push/pull | UCPH Harbor / GitLab registry / Nexus | L | Standard OCI registry. |

### 1b. Data stores — the substantive work

| Live (GCP) | Role | GCP binding | Self-hosted equivalent | Effort | Portability notes |
|---|---|---|---|---|---|
| **Firestore** | Application DB (skills, sessions-mirror, groups, classes, activities, curriculum metadata, tool-permissions) | `google-cloud-firestore` client, `backend/db/firestore.py` | **PostgreSQL** (Supabase) | **M** *(re-rated from H, 2026-06-17 — see [firestore-portability-seam.md](firestore-portability-seam.md))* | The largest line item, but bounded, not hard. Evidence: a single `get_client()` factory, an in-memory drop-in (`db/firestore_inmemory.py`) the whole app runs on in `LOCAL_MODE`, **no transactions / realtime / collection-group / TTL / security-rule reliance** on the backend. A `PostgresFirestoreClient` implements the now-formalised `FirestoreClient` Protocol; the hard bits (`Increment`/`ArrayUnion`, dotted-path JSONB filter, keyset pagination, subcollection→FK) are mechanical mappings. The seam was hardened 2026-06-17 (leaks closed, typed contract) so the eventual port is **S**, deferred until the migration triggers. |
| **Vertex AI RAG Engine** (`RagManagedDb`) | Curriculum RAG (text retrieval) | ADK `VertexAiRagRetrieval` tool; `db/rag_corpus.py` | **pgvector on Postgres** + an embedding model + a retrieval tool behind the same interface | **M** | ADR-017 made the swap bounded *by design*: retrieval is one ADK tool, and ingestion already pre-parses to `.txt` (so we own the text — no re-parse needed). Replace the managed corpus with pgvector + a local embedder; the upstream contract (`get_corpus_name()` → retrieve) is the seam. pgvector also folds the C3 concept-graph stretch into the same store (ADR-010). |
| **Vertex AI Agent Engine** (`reasoningEngines`) — sessions | Chat-history persistence across Cloud Run instances/redeploys | ADK `VertexAiSessionService` | ADK **`DatabaseSessionService`** (Postgres) | **M** | ADK ships a first-class DB-backed session service — this is a config/URI swap, not a custom build, and it reuses the same Postgres. `AITANA_LOCAL_SESSION=memory` already exercises the swap-out seam today. |
| **Vertex AI Agent Engine** — Memory Bank | Cross-session *semantic recall into future sessions* (`load_memory`) — **distinct** from chat-history resume, which is the Session row above | ADK `VertexAiMemoryBankService` | **Drop.** On-prem defaults to `InMemoryMemoryService` (no-op); nothing to rebuild | **L (drop)** | **Reclassified 2026-06-17.** Its value is longitudinal *individual*-learner memory, which anonymous group IDs foreclose by construction (ADR-001 — we deliberately cannot follow individuals). And it is **not populated today**: there is no `add_session_to_memory` write path anywhere in the backend, so `load_memory` always returns empty. Dropping it is **zero behaviour-change**. Bonus cleanup available *now*: the dormant `load_memory`/`preload_memory` tools sit in the agent toolset ([`adk/agent.py`](../../../../backend/adk/agent.py)) costing prompt tokens + a per-turn pre-LLM fetch against an empty store — removable independently of the migration. |
| **BigQuery** `chat_logs` + Cloud Logging sink | Durable, group-ID-keyed chat/workbench logs → teacher reports + research export (ADR-005) | Log Router sink → BQ; `db/bigquery.py` reads | **PostgreSQL** (analytics schema) or **ClickHouse**/**DuckDB** for columnar research queries; app emits to it directly instead of via a log sink | **M** | The sink is the GCP-specific glue. On-prem, the app writes rows directly (it already has a structured emitter, `observability/chat_log.py`). Researchers query SQL either way. |
| **GCS buckets** (artifacts, logs, research-audio, tts-cache, config, documents) | Blob storage (ADK artifacts, OTEL GenAI logs, lesson audio, TTS cache, config mount) | `google-cloud-storage` client | **MinIO** (S3-compatible) or UCPH NFS | **L** | S3-compatible API abstracts cleanly; ADK's GCS artifact service has an S3/local analogue. Path scheme is provider-agnostic. |

#### Supabase as a consolidated data/auth/storage layer (recommended)

Supabase is self-hostable (Apache-2.0; Docker Compose / Helm), and because it **is** Postgres at the core, one Supabase deployment collapses several separate rows above into a single platform — and it's exactly the Postgres + `pgvector` the ADRs already lean toward (ADR-010). What it folds in:

| Row above | Supabase component | Fit |
|---|---|---|
| Firestore (app DB) | Postgres | The doc→relational DAL port still happens; Supabase adds migrations, the Studio admin UI, and PostgREST on top. |
| Vertex RAG → pgvector | `pgvector` ("Supabase Vector"), built in | First-class, in the *same* DB as the app. Exactly ADR-010. |
| Agent Engine sessions | Postgres via ADK `DatabaseSessionService` | Just needs a Postgres URL — reuses the same instance. (Pooler caveat below.) |
| GCS blobs | Supabase Storage (S3-compatible protocol) | Replaces artifacts / audio / tts-cache; ADK's artifact service needs an S3 adapter. |
| Firebase Auth (teachers) | Supabase Auth (GoTrue) — SAML 2.0 / OIDC | Can broker the UCPH IdP for teacher SSO. |
| Firestore `onSnapshot` (teacher-surface realtime) | Supabase Realtime | The cleanest answer to the realtime listeners — plain Postgres does not give this. |

It does **not** solve: LLM inference (still vLLM/Ollama, §3), the Agent Engine **Memory Bank** (still the hard build of §7 — though Supabase's `pgvector` is a good substrate for it), or STT/TTS.

**The real decision: Supabase *platform* vs just *Postgres + pgvector*.** The ADK paths (the DB session service, a `pgvector` retrieval tool) talk to Postgres directly — they do not care whether it is "Supabase." Supabase earns its keep specifically for the **Realtime** (`onSnapshot` replacement), **Auth** (SSO broker), and Studio/migrations DX. If those aren't wanted, plain managed Postgres + `pgvector` is a smaller ops footprint (one service vs Supabase's ~10-container stack). For UCPH — a non-specialist ops team that gets teacher SSO + realtime "for free" plus a friendly admin UI — **Supabase is the recommended consolidation**; plain Postgres + `pgvector` is the minimal-footprint fallback. Either way, **self-hosted only** (Supabase Cloud is a US-managed SaaS and would defeat the sovereignty purpose).

**Verify in the Phase-1 audit:** (1) ADK's `DatabaseSessionService` uses SQLAlchemy — confirm the Supabase connection-pooler mode (Supavisor transaction vs session pooling) doesn't break prepared statements; point it at the direct Postgres port or a session-mode pooler. (2) Supabase Storage's S3-compatibility against the ADK artifact-service S3 adapter. (3) Keep the **anon-group student JWT custom** (already PII-free + portable by construction, ADR-001) — do **not** fold students into Supabase Auth; only teachers need the IdP broker.

### 1c. Models (LLM / embeddings / speech) — sized in §3

| Live (GCP/cloud) | Role | Binding | Self-hosted equivalent | Effort | Notes |
|---|---|---|---|---|---|
| **Gemini 3.5 Flash** (Vertex, global endpoint) — default | Tutor chat, sub-agents, structured extraction, PDF OCR fallback | ADK `Gemini` via Vertex ADC | Tier-2/3 open-weight via **vLLM/Ollama** behind an OpenAI-compatible endpoint; router config swap | **M** | Model registry (`config/models.yaml`) + `resolve_model()` already abstract provider; ADR-003 §3 sizes the candidates. Multimodal/Danish quality is the risk to validate via eval. |
| Claude Sonnet 4.6 / Opus 4.7 (fallback tier), GPT-5.x | Cross-provider fallback / smart tier | LiteLLM / Claude via Vertex | Keep as cloud API (hybrid) *or* substitute Tier-2 DeepSeek class | L–M | Claude's cloud-agnosticism is the documented GCP hedge (ADR-003); in a hybrid these stay API-served. |
| **Embeddings** (RAG + memory) | Dense retrieval | Vertex-managed (opaque) | **BGE-M3** / **multilingual-e5-large** (multilingual, Danish-capable) | M | Becomes explicit + self-hostable once off managed RAG. Small GPU or even CPU. |
| **STT** = Gemini (Danish/English code-switch classroom audio) | Transcription of lesson recordings | `voice/providers/gemini_stt.py` | **Whisper large-v3** (or `faster-whisper`) | M | New voice provider behind `voice/registry.py`. Danish + code-switch is the quality bar to test. |
| **TTS** = GCP Cloud TTS (Chirp3-HD Danish) + Gemini-TTS | Read-aloud | `voice/providers/gcp_tts.py` | **Piper** (fast, local, Danish voice exists) / **XTTS-v2** / **Kokoro** | M | Danish voice *quality* is the risk — Cloud TTS Danish is strong; open Danish TTS is weaker. Validate before committing. Provider abstraction already exists. |
| **AILANG Parse** (deterministic doc parsing, 13 formats) | Document ingestion | External API (`DOCPARSE_API_KEY`) | **Decided (2026-06-17): keep AILANG Parse, self-host on-prem** (first-party — M owns the AILANG ecosystem, ADR-012) | L | Not a migration risk — our own product, no third-party lock-in, and the deterministic path needs **no GPU** (small CPU container/library). Only the Gemini **OCR fallback** for scanned PDFs/images (`tools/documents/ai_extract.py`) needs an on-prem swap → a local vision model (the §3a worksheet-photo model serves this), or a future AILANG Parse local-OCR path. |

### 1d. Auth, secrets, observability, network

| Live (GCP) | Role | Binding | Self-hosted equivalent | Effort | Notes |
|---|---|---|---|---|---|
| **Firebase Auth** (teachers) | Teacher SSO | `firebase_admin.verify_id_token` | **UCPH institutional SSO** via OIDC/SAML (Keycloak as broker, or direct to UCPH IdP) | M | ADR-001 already names UCPH SSO as the teacher-auth target. `auth/firebase_auth.py` verifies a JWT — swap the verifier to validate UCPH-issued OIDC tokens. |
| **Anon-group JWT** (students, HS256) | Student join, no PII | `auth/group_id_auth.py` + `GROUP_AUTH_SIGNING_SECRET` | **Identical** — only needs the signing secret | **L** | Fully portable by construction. No Firebase/GCP dependency. The students' entire identity story already runs anywhere. |
| **Secret Manager** | Secrets (signing secret, corpus name, docparse key, engine id) | Cloud Run secret refs | **Vault** / k8s Secrets / sops-encrypted env | L | Standard secret-retrieval swap. |
| **Cloud Logging + Cloud Trace + Cloud Monitoring** (OTEL) | Observability (ADR-008) | OTEL exporters → GCP | **OTEL Collector → Tempo/Loki/Prometheus + Grafana** (or ELK) | M | ADK exports OTEL natively → point the exporter at a self-hosted collector. The internal-only telemetry boundary (Axiom 8/9) becomes "inside UCPH" instead of "inside the GCP project." |
| Region pinning `europe-north1` / `europe-west1` (ADR-007) | EU data residency | GCP region config | N/A — on-prem *is* in Denmark | — | On-prem removes the residency question entirely; this is a primary motivation for UCPH. |

---

## 2. Correcting the self-hosting.qmd stub (cross-repo flag)

The scoping site stub must be refreshed; this execution doc is the accurate inventory. The deltas IT must know about:

| `self-hosting.qmd` stub said | Deployed reality | Consequence |
|---|---|---|
| App DB + RAG = Cloud SQL Postgres + pgvector | **Firestore** (app DB) + **Vertex RAG Engine** (RAG) | Migration is *more* work than the stub implied — a real Firestore→Postgres DAL port (H), not a `pg_dump`. |
| "Firestore (if used) — prefer not to" | Firestore *is* the app DB | The ADR-005 lean was not followed (v0.1 speed). The cost lands here. |
| (no row) | **Vertex Agent Engine** — sessions + memory | Two new migration items; memory has no drop-in OSS equivalent (H). |
| (no row) | **BigQuery + Log Router sink**, **voice (TTS/STT)**, **MCP sandbox service**, **Firebase + anon-group auth split** | All missing from the stub's table; all in §1 above. |

> Per the execution-vs-scoping split, the *product* "why/when to migrate" stays in `self-hosting.qmd`; this repo owns the accurate component list. Action: update the `self-hosting.qmd` migration table to point at this doc as the live inventory (tracked in the handover package, SEQUENCE 3.1).

---

## 3. Model sizing — what UCPH would host (the open question)

Current production is "top-of-line cloud": `gemini-3.5-flash` (default) with Claude Sonnet 4.6 as cross-provider fallback, and Opus 4.7 / GPT-5.x available in the registry. The on-prem question is: *which open-weight models, on what hardware, clear the bar per task class?* ADR-003 already frames this as four tiers; this section sizes the candidates. **Final selection is eval-driven** — the [capability-floor eval](file:///Users/mark/Documents/clients/cph-uni/evaluation.qmd) decides per task class; these are the hardware envelopes to provision *for*.

### 3a. Per-task demand → candidate models

| Task class | Demands | Cloud model today | On-prem candidate(s) | Tier |
|---|---|---|---|---|
| Tutor chat (Socratic) | tool-calling, streaming, Danish, mid-context | Gemini 3.5 Flash | Qwen 3.5 27B / Gemma 4 31B (Tier 3); DeepSeek V4 Flash (Tier 2) | 2–3 |
| Multi-step reasoning / thinking | extended reasoning | Gemini 3.1 Pro / Opus 4.7 | DeepSeek V4 Pro (1.6T MoE) | 2 |
| Worksheet-photo / diagram understanding | vision, OCR, Danish | Gemini 3.5 Flash (multimodal) | Qwen-VL class / vision-capable open-weight | 2–3 |
| Structured extraction (JSON) | schema-constrained output | Gemini 3.5 Flash | Any Tier-3 with constrained decoding | 3 |
| Document parsing (13 formats) | none (deterministic) | AILANG Parse (no LLM) | AILANG Parse self-hosted | — |
| RAG embeddings | multilingual dense vectors | Vertex-managed | BGE-M3 / multilingual-e5-large | 3 |
| STT (classroom Danish/EN) | code-switch robust | Gemini STT | Whisper large-v3 | 3 |
| TTS (Danish read-aloud) | natural Danish voice | Cloud TTS Chirp3-HD | Piper / XTTS-v2 (quality risk) | 3 |
| Light/offline (summarise, format) | small, private | — | On-device (Apple Intelligence / Gemini Nano / WebLLM) | 4 |

### 3b. Hardware envelopes (provision for the tier you choose)

Figures are order-of-magnitude for planning; confirm against vendor specs at procurement time. ADR-003 is the authority on the model picks.

| Tier | Hardware | VRAM/RAM | Example models | Serves |
|---|---|---|---|---|
| **2 — GPU cluster** (full sovereignty, frontier-ish) | 4–8× H100/H200/B200, NVLink | ~280–800+ GB total | DeepSeek V4 Pro (1.6T MoE, 49B active, ~90% GPQA-Diamond); V4 Flash (284B MoE, 13B active) | All task classes incl. hard reasoning; whole-institution scale |
| **3 — single workstation/GPU** (departmental, dev, demo) | 1× H100/A100 80GB, or 128GB unified-memory Mac | ~30–60 GB | Qwen 3.5 27B (~85% GPQA-D @ Q6), Gemma 4 31B (~84%), Phi-4 14B | Tutor chat, extraction, smaller deployments; the **realistic v1 on-prem floor** |
| **3-aux — embeddings + speech** | 1× mid GPU (e.g. L4/A10 24GB), or CPU for embeddings | ~8–24 GB | BGE-M3, Whisper large-v3, Piper | RAG + voice; can co-locate or be its own small node |
| **4 — on-device** | Student device | n/a | Apple Intelligence (~3B), Gemini Nano (3.25B), WebLLM | Offline/light tasks; gold-standard privacy |

**Two concrete recommendations for IT to cost:**
- **Minimum viable on-prem** (covers the realistic v1 task mix, cloud API fallback for frontier reasoning): **1× H100 80GB** (Tier-3 chat/extraction) **+ 1× L4/A10 24GB** (embeddings + Whisper STT). Hybrid: hard-reasoning + Danish-TTS-quality stay cloud API until the eval clears local.
- **Comfortable / full sovereignty**: a **Tier-2 cluster (4–8× H100/H200)** running DeepSeek V4 Pro for everything, with the 3-aux node for speech/embeddings. No external model egress.

> The migration is **eval-gated**: ADR-003 + `self-hosting.qmd` set the trigger at ~70–80% local-readiness per task class. Provision the tier you intend to *grow into*; route traffic cloud→local per class as the eval clears each one.

---

## 4. Hybrid topologies

UCPH does not have to choose "all cloud" or "all on-prem." Four points on the spectrum, with decision drivers:

| | A. Full cloud (today) | B. Inference on-prem, control-plane cloud | C. App + data on-prem, frontier via API | D. Full on-prem / air-gapped |
|---|---|---|---|---|
| **Models** | All Vertex/cloud | UCPH GPUs serve Tier 2/3; cloud for overflow | UCPH serves Tier 3 + embeddings/speech; cloud API only for Tier-1 frontier tasks the eval hasn't cleared | All UCPH GPUs (Tier 2 cluster) |
| **App + DB + storage** | GCP | GCP | **UCPH** (Postgres + MinIO + k8s) | UCPH |
| **Student data egress** | EU GCP | EU GCP (+ inference local) | **Stays at UCPH** except frontier-API prompts | **None** |
| **GPU capex** | none | high | medium (1× H100 class) | high (cluster) |
| **Sovereignty story** | EU residency | mixed | strong (data never leaves; only some prompts do) | maximal |
| **Effort** | — | M (inference endpoint swap only) | H (DB + RAG + sessions port) | H (same as C; no memory-bank build — dropped per §7) |

**Recommendation:** **C is the realistic handover target**, with **B as a stepping stone** if GPUs land before the DB port. C keeps *student data* fully at UCPH (the GDPR win) while permitting cloud API for the narrow set of frontier-reasoning tasks local models can't yet match — exactly ADR-003's tier-fallback model. D is the end-state once the Tier-2 cluster exists and the eval clears the hard task classes. A remains correct until UCPH IT confirms hosting + the eval threshold is met (`self-hosting.qmd` "when to trigger").

---

## 5. The costable resource list for UCPH IT

A procurement-ready checklist. Quantities depend on the chosen topology (§4); ranges given for C (recommended) vs D (full sovereignty).

**Compute (app, stateless):**
- Container orchestration: Kubernetes namespace **or** 1–2 VMs with `docker compose`. ~4 vCPU / 8 GB RAM total for frontend + backend + sandbox + the self-hosted **AILANG Parse** service (small CPU container, no GPU) at pilot scale (10 teachers, classroom bursts).
- Container registry (Harbor/GitLab/Nexus) + a CI runner (GitHub Actions self-hosted runner or GitLab CI).

**GPU (inference):**
- **C:** 1× H100 80GB (Tier-3 LLM) + 1× L4/A10 24GB (embeddings + Whisper STT). ~104 GB VRAM.
- **D:** 4–8× H100/H200 (Tier-2 DeepSeek class) + the 24GB aux node. NVLink for the cluster.
- Inference server: vLLM (preferred, OpenAI-compatible) or Ollama.

**Database + storage + auth + realtime (recommended: one Supabase deployment — §1b):**
- **Supabase, self-hosted** (Apache-2.0) gives Postgres + `pgvector` + S3-compatible object storage + GoTrue auth (teacher SSO broker) + Realtime in one stack — the single most important shared resource. ~10 containers; an HA Postgres pair underneath at scale.
- **Minimal-footprint fallback:** **PostgreSQL 15+ with `pgvector`** (app DB + RAG vectors + ADK sessions + analytics) + **MinIO/NFS** (S3-compatible object store) + **Keycloak** (OIDC/SAML broker for teacher SSO). Storage is ~tens of GB at pilot scale; audio dominates (consent-gated).
- Student auth needs **no IdP either way** (anon-group JWT, just a signing secret).

**Secrets:** Vault / k8s Secrets / sops.

**Observability:** OTEL Collector + Grafana stack (Tempo traces, Loki logs, Prometheus metrics) or ELK. Must preserve trace coverage (Axiom 8).

**Networking:** Ingress + TLS (cert-manager / UCPH certs); egress policy decision for hybrid (which model APIs, if any, may be called out).

**Governance (for IT/legal, not hardware):** confirmation that on-prem student-facing services clear UCPH data-protection review; the anon-group design (ADR-001) makes the personal-data category empty by construction, which should simplify this materially.

---

## 6. The Terraform deliverable

The user's framing: *deliver Terraform that can be easily migrated to what they need, or used as scoping for their own deployments.* Strategy is a **two-layer, shared-variable** design so the same logical resources are expressed against either GCP or UCPH primitives.

**Layer 1 — GCP modules (exist / in flight).** [`infrastructure/modules/`](../../../../infrastructure/modules/) (chat-logs, curriculum-rag, voice, cloud-run-channel) + the consolidation planned in [aipla-cloud-bootstrap.md](../v1.0.0-pilot/aipla-cloud-bootstrap.md). This is the GCP target and the source-of-truth inventory of *what logical resources exist*.

**Layer 2 — on-prem reference stack (this workstream delivers).** A parallel module set / Helm chart mirroring the same logical resources against UCPH primitives:
- `supabase` (recommended) — **one module** covering app DB + `pgvector` + ADK sessions + object storage + teacher SSO + realtime, replacing Firestore + Vertex RAG + Agent Engine sessions + GCS + Firebase + `onSnapshot` (see §1b). Minimal-footprint fallback: split into `postgres` (DB + pgvector + sessions) + `object-store` (MinIO) + `auth` (Keycloak broker) if the full Supabase stack isn't wanted.
- `inference` (vLLM/Ollama Deployment + model pull) — replaces Vertex/Gemini
- `app` (Helm chart: frontend + backend + sandbox) — replaces Cloud Run
- `observability` (OTEL collector + Grafana) — replaces Cloud Logging/Trace

Modules share variable names (`project`/`env`/`region` → `cluster`/`namespace`) so reading one explains the other. **It doubles as scoping**: even if UCPH never runs `terraform apply`, the module inputs *are* the resource list, annotated.

> **Known Terraform gotcha (from [infra-terraform-lessons.md](../../v6.0.0/implemented/infra-terraform-lessons.md)):** the google provider is pinned `<6.0.0`, so Agent Engine is bootstrapped via Python SDK, not Terraform. The on-prem layer sidesteps this entirely (no Agent Engine), which is one fewer moving part on-prem.

**Phasing:**
- **Phase 0 (now):** this doc + the accurate inventory. *Satisfies the contracted "notes good enough to estimate."*
- **Phase 1 (~2d):** portability-seam audit — enumerate every GCP-bound code path (`db/firestore.py`, `VertexAiSessionService`, `VertexAiRagRetrieval`, `Gemini`, `firebase_auth.py`, GCS clients) and the exact swap each needs. `LOCAL_MODE` already proves most seams exist; this audit grades each "in-memory stub exists" vs "production adapter needed." **Firestore slice delivered 2026-06-17** ([firestore-portability-seam.md](firestore-portability-seam.md)): audited, re-rated H→M, leaks closed, `FirestoreClient` Protocol formalised, latent `LOCAL_MODE` crash fixed. Remaining: the session-service / RAG / auth / GCS seams.
- **Phase 2 (~3–4d, stretch/over-deliver):** the Layer-2 reference stack + a one-command local bring-up (`docker compose` mirror of the on-prem topology) so UCPH can *see it run* before committing hardware.

---

## 7. What is genuinely hard (honest call-outs)

So the estimate is real, not optimistic:

1. **Firestore → Postgres DAL port — re-rated H→M (2026-06-17), and the seam is now hardened so the eventual port is S.** ~10 collections, document→relational/JSONB. Investigation ([firestore-portability-seam.md](firestore-portability-seam.md)) found the coupling ~85% clean already (single `get_client()` factory, in-memory drop-in the app runs on, **zero reliance on Firestore-only features** — no transactions, realtime, collection-group, TTL, or security-rule-based auth). The seam-hardening work (close the two DAL leaks, formalise the `FirestoreClient` Protocol, fix a latent `LOCAL_MODE` crash) shipped, converting the future swap from H to a bounded checklist. **There is no remaining "H" item in the migration.** The chosen course: *defer the migration* (it's eval- and UCPH-hosting-gated, likely post-contract; a mid-pilot DB swap is needless risk), having paid the ~1-day "keep it cheap" insurance now.
2. ~~Agent Engine Memory Bank (H)~~ — **resolved by scoping (2026-06-17); no longer a hard part.** Cross-session semantic recall is foreclosed by anonymous group IDs (ADR-001) and is not populated today (no `add_session_to_memory` write path). Dropped — on-prem's default `InMemoryMemoryService` is a no-op, zero behaviour change. This removes the only other H item.
3. **Danish multimodal + TTS quality (M, but eval-gated).** Cloud Gemini multimodal and Cloud TTS Danish are strong; open-weight equivalents need validation against the capability-floor eval before they replace cloud on student-facing surfaces (Axiom 11 — don't ship a worse student experience).
4. **Everything else is L–M** and largely a config/abstraction swap, because the app already abstracts model/session/voice/DB behind registries and a `LOCAL_MODE`.

---

## Implementation Plan

### Phase 0: Inventory + this doc (done on landing)
- [x] Accurate component inventory (§1)
- [x] Hybrid topologies + recommendation (§4)
- [x] Model sizing tied to ADR-003 + hardware (§3)
- [x] Costable resource list (§5)
- [ ] Refresh `self-hosting.qmd` stub to point here (cross-repo; §2)

### Phase 1: Portability-seam audit (~2d)
- [ ] Enumerate GCP-bound code paths; grade each (stub-exists vs adapter-needed)
- [ ] Spec the Firestore→Postgres schema mapping (the H item)
- [ ] Spec the pgvector retrieval tool behind the ADK retrieval interface
- [x] ~~Decide the memory-bank approach~~ — **decided 2026-06-17: drop** (foreclosed by ADR-001 anonymity + not populated today; see §7). Optionally remove the dormant memory tools from the agent toolset as a standalone cleanup.

### Phase 2: On-prem reference Terraform/Helm (~3–4d, stretch)
- [ ] Layer-2 modules (postgres, object-store, inference, app, observability, auth)
- [ ] `docker compose` local mirror for "see it run"
- [ ] Mapping doc: GCP module ↔ on-prem module, shared variables

---

## Migration & Rollout

- **Trigger:** only when UCPH IT confirms hosting **and** the capability-floor eval clears the chosen task classes (`self-hosting.qmd` "when to trigger"). Until then GCP EU is correct.
- **Order:** stand up Postgres + MinIO + inference → run `LOCAL_MODE`-style against them → fill production adapters → cut over per topology (B→C→D).
- **Rollback:** the GCP stack stays live during bring-up; on-prem runs in parallel until validated. No destructive cutover.
- **Co-owners:** P2 (when hired) + UCPH IT, from a Week-6 runbook v0 (timeline.qmd handover fan-out).

---

## Testing Strategy

- **Backend (pytest):** the existing `LOCAL_MODE` + in-memory suites already validate the DB/session/model abstractions without GCP — extend to run against a real local Postgres/MinIO/vLLM (testcontainers).
- **Eval (ADK):** the capability-floor eval is the acceptance gate for any cloud→local model swap. No model goes to a student-facing surface until it clears its floor.
- **Manual:** end-to-end join → tutor turn → RAG-grounded answer → session resume → teacher report, run entirely on the on-prem stack.

## Security Considerations

- On-prem **strengthens** the trust boundary: student data never leaves UCPH (topologies C/D). The anon-group JWT carries no PII by construction (ADR-001), so even logs/exports are non-identifying.
- Hybrid (B/C) egress: any cloud model API call is the only data leaving UCPH — must be an explicit, documented egress decision (Axiom 9), prompt-only, EU endpoints, DPA-covered.
- Secrets move from Secret Manager to Vault/k8s — same deny-by-default posture.

## Success Criteria

- [ ] UCPH IT can cost hardware from §5 + a chosen topology without further questions
- [ ] Every §1 row has an equivalent + effort rating + portability note
- [ ] Model sizing gives min-viable + comfortable GPU specs with named models (§3)
- [ ] Terraform deliverable shares variables across GCP/on-prem layers (§6)
- [ ] `self-hosting.qmd` stub updated to reference this doc
- [ ] The five outstanding questions (below) are sent to UCPH IT

## Open Questions — for UCPH IT (refined from self-hosting.qmd)

1. **GPU hosting?** Cluster (Tier-2 DeepSeek class) or single high-end GPU (Tier-3)? Spec + availability + timeline?
2. **Container + DB story?** Kubernetes or VMs? Appetite to run the **Supabase** self-host stack (~10 containers, gets DB + pgvector + storage + SSO + realtime in one), or prefer plain managed Postgres with `pgvector` + separate object store? Either way, S3-compatible object storage available?
3. **Teacher SSO?** OIDC or SAML from the UCPH IdP? Can we broker via Keycloak?
4. **Data-protection precedent?** An existing student-facing service pattern already cleared for review we can piggyback on (vs green-fielding the DPIA)?
5. **Hybrid egress policy?** In topology B/C, is *any* external model API (EU, prompt-only, DPA-covered) acceptable, or must it be fully air-gapped (forces D + the Tier-2 cluster + the memory-bank build)?

## Open Questions — internal

1. ~~Memory Bank on-prem: build or degrade?~~ **Resolved 2026-06-17: drop** (see §7). Cross-session recall is foreclosed by anonymous group IDs and isn't populated today; on-prem's default no-op memory service is zero behaviour-change.
2. Do we invest Phase 2 (reference stack) effort, or stop at Phase 1 (audit) per the contracted minimum? Trades against remaining v1.1 feature work.
3. State backend for the on-prem Terraform layer (local + bucket vs hosted) — likely local, mirroring the GCP layer's decision (aipla-cloud-bootstrap open Q1).
4. **Supabase platform vs plain Postgres + pgvector** (§1b). Supabase consolidates DB + RAG + sessions + storage + teacher SSO + realtime into one stack and gives a non-specialist UCPH ops team a friendly admin UI; plain Postgres is a smaller footprint but leaves realtime + SSO + object storage as separate components. Lean is Supabase for the consolidation, decided with UCPH IT once their ops appetite (Q2/Q3 below) is known.

## Related Documents

- [firestore-portability-seam.md](firestore-portability-seam.md) — the Firestore→Postgres seam audit + hardening (Phase-1 slice; re-rates the DB port H→M)
- [aipla-cloud-bootstrap.md](../v1.0.0-pilot/aipla-cloud-bootstrap.md) — the GCP-side Terraform consolidation (Layer 1)
- [terraform-consolidation.md](../v1.0.0-pilot/terraform-consolidation.md) — **completes Layer 1** (2026-07-27): folds dev into Terraform (single source of truth), finishes increment 2, and shapes the capability-module boundary so this doc's Layer 2 mirrors it 1:1 (see its §3 GCP↔on-prem mapping table, which realises §6 here)
- [infra-terraform-lessons.md](../../v6.0.0/implemented/infra-terraform-lessons.md) — Terraform gotchas (provider pin, Agent Engine via SDK)
- [`infrastructure/modules/`](../../../../infrastructure/modules/) — existing GCP modules
- Scoping site: [`self-hosting.qmd`](file:///Users/mark/Documents/clients/cph-uni/self-hosting.qmd) (the stub this supersedes for execution detail), [`architecture.qmd`](file:///Users/mark/Documents/clients/cph-uni/architecture.qmd) (ADR-003/005/006/007/010/012/017), [`evaluation.qmd`](file:///Users/mark/Documents/clients/cph-uni/evaluation.qmd) (capability-floor eval — the migration gate), [`timeline.qmd`](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd) (handover fan-out)
- [SEQUENCE.md](./SEQUENCE.md) (this workstream) and [../SEQUENCE.md](../SEQUENCE.md) Phase 3 row 3.2
