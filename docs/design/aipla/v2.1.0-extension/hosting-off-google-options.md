# Hosting off Google — what crosses Google today, four options, and the questions for legal

**Status:** **Design (OPEN), a decision document** — **1.1.158**. Nothing is built. The first step is M0, which is forwarding the [questions for legal](#questions-to-send-to-legal); the engineering milestones follow only once M picks an option
**Priority:** **P1** — *"DPA for Google is blocking. We want to collect data now — this is moving up the schedule."* (notes 2026-10-22). Student trials have been gated on a Google data-processing agreement since at least 2026-09-01
**Estimated:** Legal questions ~0.25d. The recommended self-contained deployment is **~12d of engineering**, roughly 5 weeks at 2.5 d/week. The full off-Google stack is ~20d, roughly 8 weeks. Neither figure includes hardware or hosting procurement
**Scope:** A decision for M, plus questions for KU legal. If option C is chosen, the backend changes are `adk/agent.py` (`resolve_model`), `config/models.yaml` (`tutor_chain`), `observability/chat_log.py`, `db/firestore.py` (a Postgres client behind the existing Protocol), `adk/session.py`, the GCS paths in `tools/documents/`, and a new compose profile. Public copy in `frontend/content/project/` and the privacy page changes **only after** a move happens, never ahead of it
**Dependencies:** [self-hosting-and-terraform-handover.md](../v2.0.0-handover/self-hosting-and-terraform-handover.md) (the component inventory and effort grades; this doc does not repeat them and builds on them); [firestore-portability-seam.md](../v2.0.0-handover/firestore-portability-seam.md) (**shipped**: the `FirestoreClient` Protocol); [1.1.143 local-model-test-plan](../v1.1.0-feedback/local-model-test-plan.md) (**open**: the tutor-quality and latency measurement that every local-model option depends on); [ku-ai-office-alignment.md](../v2.0.0-handover/ku-ai-office-alignment.md) (KU IT's local-model plans, **unverified**); [`research/stx-bench/results-2026-10.md`](../../../../research/stx-bench/results-2026-10.md); ADR-003, ADR-006 and ADR-007 in the [snapshot](../_scoping-snapshot/architecture.qmd)
**Created:** 2026-10-22
**Source:** [notes-2026-10-22.md](../../../notes-2026-10-22.md) — *"DPA for Google is blocking. we want to collect data now - this is moving up the schedule. need to prioritise local running off google cloud. can we send to legal EU cloud solutions - skoleGPT uses danish library centre servers."* Earlier context: [notes-2026-09-01.md](../../../notes-2026-09-01.md) (*"Trials are prevented with students until we have a data management agreement with Google"*) and the [09-29 meeting summary](../../../09-29_Meeting_AI_Tutoring_Platform_Simulation_UI_Model_Testing_and_Research_Planning-Summary.md) (JB waiting on Legal/DPO about using the existing Firebase agreement as an interim DPA; a fallback plan is needed if that is refused)

## Problem Statement

Student data collection is blocked until there is a data-processing agreement covering
Google. The research calendar has also moved earlier: a November school visit with 5–10
students, teacher training around Christmas or January, and teaching in the platform in
March. The question is which route unblocks collection soonest, at what engineering cost,
and with what loss of tutor quality.

The [self-hosting handover](../v2.0.0-handover/self-hosting-and-terraform-handover.md)
answered *"what would UCPH IT need to host AIPLA"* as a costing exercise with a slow
trigger (an evaluation gate, then UCPH hosting). This document answers a different and
more urgent question: **what is the shortest legal path to recording student sessions?**
It reaches a conclusion the handover doc did not need to state:

> **Moving off Google does not remove the need for a data-processing agreement. It
> changes who the agreement is with.** The only option with no new external hosting
> processor is one where KU runs the infrastructure itself, and even then Sunholo
> remains a processor if Sunholo operates the deployment. Legal has to answer this
> before any engineering choice makes sense.

## Findings

Every finding below is **verified against code** on 2026-10-22 unless it is marked
otherwise. No production data was read.

### F1. Every store on the student data path is a Google service, and the privacy page already says so

`frontend/src/app/(site)/privacy/page.tsx:44-53` publishes the data-location table that
students and teachers see. It is the most accurate public inventory, and the code agrees
with it:

| Dependency | What crosses it | Where | Code |
|---|---|---|---|
| **Gemini on Vertex AI** (tutor, sub-agents, report and assessment judges, STT) | everything a student types, image uploads, the composed prompt, transcribed speech | Vertex `eu` multi-region | `backend/app.py:34-38`; `cloudbuild.yaml:340-353`; `adk/agent.py:111-134` |
| **Vertex RAG Engine** (curriculum) | teacher documents as text, and student queries during retrieval | europe-west1 | `adk/curriculum_retrieval.py:33`; `cloudbuild.yaml:317-324` |
| **Vertex Agent Engine** (sessions) | the full conversation history of every group | europe-west1 | `adk/session.py:604-614`; `cloudbuild.yaml:303-310,354-360` |
| **Firestore** | classes, activities, group bindings, workbench state, writing, progress | europe-north1 | `db/firestore.py:44-52` |
| **Cloud Logging → BigQuery** (`chat_logs`) | **the research record**: every turn and workbench event, keyed by group | europe-north1 | `observability/chat_log.py:1-24`; 8 BigQuery reader modules (`analytics/*`, `reports/session_summary.py`) |
| **GCS** | uploads, ADK artifacts, lesson audio (consent-gated), TTS cache | europe-north1 | `cloudbuild.yaml:361-370` |
| **Cloud TTS** | tutor text read aloud | EU endpoint | `cloudbuild.yaml:410-422` |
| **Firebase Auth** | **teacher** identities (email). Students never use it | Google's global service | `auth/firebase_auth.py:231`; privacy page row 8 |
| **Cloud Run** | all of the above in memory, while serving | europe-north1 | `cloudbuild.yaml` deploy step |
| **AILANG Parse (hosted)** | teacher and student documents, which it reads from GCS | Belgium, operated by **Sunholo** | `tools/documents/ailang_parse.py:161,217`; `teacher-faq.md:150` |

The model row is the hardest to replace. Every other row stores data at Google, so
for the DPA question **all ten rows weigh the same**. Moving only the models, or only
the stores, does not take Google off the student data path.

### F2. `LOCAL_MODE` does not mean "off Google", and it cannot collect research data

It is tempting to say "we already have local running". What `LOCAL_MODE` actually does:

- **Models are still Google.** `scripts/dev-local.sh:15-18` requires either a
  `GEMINI_API_KEY` or Vertex ADC, and `Makefile:691` runs LOCAL_MODE with
  `GOOGLE_GENAI_USE_VERTEXAI=True GOOGLE_CLOUD_PROJECT=aipla-dev-2026`. Every student
  turn would still go to Gemini.
- **It writes no research record.** `observability/chat_log.py:100-101` returns
  `None` (no emit) when `is_local_mode()`. A LOCAL_MODE classroom session leaves **no
  `chat_turns` row at all**, so it would collect exactly the data the DPA question is
  about, and then lose it.
- **State is in memory.** `db/firestore.py:48-52` uses `InMemoryFirestoreClient`, and
  persistence to disk happens only on shutdown, behind `LOCAL_MODE_PERSIST`
  (`config/local_mode.py:44-50`). A crash loses the class.
- **It refuses to be deployed, by design.** `config/local_mode.py:53-74` raises if
  any deployment marker is set, because it injects a stub teacher identity. That guard is
  right and must stay.

So LOCAL_MODE is a workshop and development tool. **A data-collection deployment off
Google is a new profile, not a flag.** It can reuse LOCAL_MODE's seams (the in-memory
Firestore proves the `FirestoreClient` Protocol is complete), but none of its shortcuts.

### F3. The model router has no route to a local model

`adk/agent.py:111-134`: `gemini-*` → `ResilientLlm` over Vertex, `claude-*` →
`Claude` (also on Vertex), and `gpt-*`/`o3*` → `LiteLlm("openai/…")`. Anything else
raises `ValueError`. There is no `ollama/` prefix and no OpenAI-compatible `base_url`
route. On top of that, `config/models.yaml:131-141` requires every `tutor_chain` member to
be a registered Google model.

The harnesses already reach local models: stx-bench routes `ollama/<model>` through
`OLLAMA_HOST`, and 1.1.143 M1 adds an endpoint adapter to the BENCH-2 harness. The
**app** cannot. LiteLLM is already a dependency, so the route itself is small. What is
not small is the next finding.

### F4. Some tutor features exist only on Gemini

- Curriculum grounding is `VertexAiRagRetrieval` (`adk/curriculum_retrieval.py:33`),
  a Gemini built-in. A local model cannot call it.
- `code_execution` uses `BuiltInCodeExecutor` (`adk/agent.py:34`), and
  `ai_search`/`google_search` are "model-aware" Gemini built-ins (`adk/tools.py:203`).
- STT is Gemini (`cloudbuild.yaml:423-428`).

All of these have to be **turned off cleanly** for a non-Gemini model, never left to
fail per turn. ⚠️ **This bears on the maths/calculator tool designed the same day.** If
that tool is built on `BuiltInCodeExecutor`, it will not survive a move off Gemini. It
should be a plain `FunctionTool`, which is portable across every option below.

### F5. On published exam accuracy, the open models are good enough. On speed they are not yet, and on pedagogy they are unmeasured

From `research/stx-bench/results-2026-10.md` (run through OpenRouter, so on the
providers' hardware, not ours):

- **Accuracy is not the blocker.** Qwen 3.8-27B scores 95 on text and 95 on figures, and
  Gemma 4 31B scores 95 and 90. Both clear the 80% bar on both modalities at a size that
  fits one GPU. The tutor's current default, Gemini 3.5 Flash-Lite, scores 87 and 93.
- **Latency is the cost.** Median and p90 seconds per answer, text: flash-lite 2 (3),
  gemma-4-31b 11 (25), qwen3.8-27b 29 (137). That is **5–15× slower at the median**,
  and Qwen ran in its default reasoning mode. Today's notes report a consensus for a
  model that is *"smarter, not fast"*, and say the stream arrives *"as one big blob"*.
  That softens the cost but does not cancel it, because a 25 s p90 on a turn a student
  is waiting for is beyond what 1.1.143 would accept.
- **Unmeasured on our hardware**, and **unmeasured as a tutor**: approach
  discrimination, tone, Danish register and image turns. These are exactly 1.1.143's
  thresholds. **No option that uses a local model can promise tutor quality until
  1.1.143 M2 has run.**

### F6. What the public pages say today

These claims are true now. They become stale if hosting moves, and each must change in
the same release as the move, not before it:

| Where | Claim |
|---|---|
| `frontend/content/project/data-and-hosting.md:44` | *"hosted in Google Cloud in European regions"* |
| `data-and-hosting.md:46` | *"The tutor currently uses Google's Gemini models through Vertex AI … EU multi-region endpoint"* |
| `frontend/content/project/teacher-faq.md:139` (+ `.da.md`) | *"Local models are not in use today. The tutor uses Google's Gemini models …"* |
| `teacher-faq.md:150` (+ `.da.md`) | AILANG Parse operated by Sunholo in Belgium; text indexed in Belgium; files in Finland |
| `teacher-faq.md:178` (+ `.da.md:178`) | *"Where: in the EU … Finland … Belgium … Google's EU region. Only teacher sign-in uses Google's global service."* |
| `teacher-faq.md:180` (+ `.da.md:180`) | *"the University of Copenhagen is the data controller, and Google Cloud and Sunholo are processors"* |
| `teacher-faq.da.md:196` | broader student trials *"afhænger af de nødvendige databehandleraftaler"* |
| `src/app/(site)/privacy/page.tsx:33-53` | the DA and EN location tables (every row) |

`data-and-hosting.md` is marked `reviewBy: 2026-11-05`, so it comes up for review
during this decision either way.

## Options

The options are combinations of two separate choices: **where the stores live** (rows
2–10 of F1) and **where the models run** (row 1). An option that moves only one of the
two leaves Google on the path (F1).

| | **A. KU on-prem** | **B. EU / Danish cloud host** | **C. Self-contained deployment, host-agnostic** (recommended) | **D. Stay on Google, pending DPA** |
|---|---|---|---|---|
| **Stores** | KU servers | the EU host's managed Postgres + object storage | Postgres + disk/S3 in one compose stack, on whichever host legal accepts (KU or EU) | Google, unchanged |
| **Models** | KU GPU (open-weight) | KU GPU, or the host's open-weight inference if it offers any | a local open-weight model on one GPU, behind the router | Gemini |
| **Hosting processor** | **KU itself**, plus Sunholo if Sunholo operates it | **the new host**: a new agreement replaces Google's | follows the host choice | Google + Sunholo |
| **Unblocks collection when** | KU IT provides a host and a GPU. **Timeline unknown**, and KU IT's plans are known from one newspaper interview ([ku-ai-office-alignment.md](../v2.0.0-handover/ku-ai-office-alignment.md)) | an agreement with that host exists or is signed. **Only faster than D if KU already has one** (legal question) | engineering ~12d (~5 weeks) **plus** a host from A or B | legal says yes to Google, or to the interim Firebase agreement (pending since 09-29) |
| **Engineering** | ≈ C, plus KU's ops integration | ≈ C (Firestore, Vertex and BigQuery are Google-only, so **any** non-Google host needs the same code work; a managed host saves ops, not code) | ~12d minimal, ~20d full | **0** |
| **Model-quality cost** | F5: same accuracy, 5–15× slower, tutor quality unmeasured | same as A, or an EU provider's model (its quality unmeasured) | same as A | none |
| **What students lose** (minimal version) | curriculum RAG, voice in/out, Gemini built-ins (F4) until each is ported | same | same | nothing |
| **Can make the November visit** | no | only if the host and agreement already exist | **no**: ready early December at best | **yes, if legal answers in time** |

**SkoleGPT** is a comparison point **as reported in the notes only**: it *"uses Danish
library-centre servers"*. Nothing else about its hosting, models or agreements has been
checked here, and nothing in this document depends on it. What it suggests is a
**legal question**: is there a Danish education-sector host that KU or Danish schools
already have an agreement with? If there is, B becomes much faster.

Two combinations are **not** options, and they are listed so nobody spends time on them:

- **Stores on Google, models local.** Google stays processor for the research record,
  the conversations and the uploads, so this unblocks nothing.
- **Stores off Google, models still Gemini.** This only helps if legal treats inference
  differently from storage. That is legal question 4, so it should not be built before the
  answer.
- **Model routing through OpenRouter** (which the benchmarks use) sends requests to
  providers outside the project's control. It is **not considered for student data**.

## Recommendation

**Do D and C in parallel.** D costs nothing and is the only route that can make the
November visit, so the legal questions go this week. C is the insurance: one
self-contained deployment whose engineering is **the same whichever host legal
accepts** (KU on-prem or an EU host), so code work can start before the host is known.
The target is the **teacher training (Christmas/January) and the March teaching
period**, not November.

C keeps students on the existing anonymous group-code design (ADR-001, already portable:
`auth/group_id_auth.py` needs only a signing secret). It does not try to make the cloud
deployment portable at the same time. **Prod stays on Google** for everything legal
already permits, such as teachers authoring activities.

**What C costs the extension plan.** About 12d is ~16% of the extension's ~75 days, and
the full version (~20d) is ~27%. The extension plan affords roughly two substantial
workstreams. If C goes ahead, it **is** one of them, and something in the discipline
layer moves. M should make that trade explicitly rather than let it happen.

## Milestones (option C)

The estimates are engineering days. Each milestone ships on its own and does not change
production.

- **M0 — Legal questions out; host and model decision (~0.25d, M).** Forward the
  [questions below](#questions-to-send-to-legal). If D clears, stop after M1–M2 and park
  the rest.
- **M1 — A local model behind the router (~1.5d).** Add an `ollama/`/OpenAI-compatible
  route to `resolve_model` (`adk/agent.py:111-134`) and an off-by-default
  `tutor_chain` exception for a non-Google head (`config/models.yaml:131-141`). The
  Gemini-only built-ins (F4) are turned off **once at agent build**, never per turn.
  Acceptance: a tutor turn through a local endpoint with tools, on the real composed
  prompt. **Gate:** 1.1.143 M2 has run, so the quality cost is known before anything
  ships to students.
- **M2 — A research record without Google (~1.5d).** `observability/chat_log.py`
  gains a sink selected by config: Postgres rows with the **same columns as the
  BigQuery views** (`infrastructure/modules/chat-logs/views.tf`), plus a dry-run-by-default
  export script. The BigQuery readers are **not** ported in this milestone, so teacher
  reports and research views do not work in the box yet. Collection is what is blocked,
  and analysis can run on the export.
- **M3 — A durable app store and sessions (~3.5d).** A `PostgresFirestoreClient`
  implementing the existing Protocol (the seam was hardened in
  [firestore-portability-seam.md](../v2.0.0-handover/firestore-portability-seam.md),
  with the mechanical mappings already listed there), and ADK `DatabaseSessionService` on
  the same Postgres (`adk/session.py:604-614` selects it).
- **M4 — Files without GCS (~2d).** Uploads and ADK artifacts go to disk or S3. The
  deterministic AILANG Parse path runs locally instead of reading `gs://` URLs
  (`tools/documents/ailang_parse.py:161,217`). The AI OCR fallback is off.
- **M5 — A production-safe profile (~2.5d).** A new compose profile (app + sandbox +
  Postgres + model endpoint) that is **not LOCAL_MODE**: no stub identity, and it refuses
  to start without a real signing secret. Teacher sign-in depends on legal question 5:
  keep Firebase (0d) or switch to an OIDC broker to KU SSO (+2–3d, not counted). Voice
  and curriculum RAG are off, and the UI says so in words rather than failing silently.
  Includes a nightly Postgres backup.
- **M6 — The no-egress witness and a dry run (~1d).** Run the stack with outbound
  traffic to `*.googleapis.com` and `*.google.com` **blocked**, then run a full scripted
  session: join, turns, a workbench event, an upload, and the export. **This is the only
  proof that nothing still goes to Google.** A config review cannot show it, for the same
  reason the `deploy-status` footgun exists. Use non-student data only.

**Deferred** (the ~8d gap between minimal and full): curriculum RAG on pgvector with
a local multilingual embedder (~2–3d); porting the 8 BigQuery reader modules
(`analytics/*`, `reports/session_summary.py`) to Postgres SQL (~2–3d); Whisper and
Piper voice (~2d, with Danish quality to validate); OTEL to a local collector (~0.5d).

## Questions to send to legal

Written so M can forward them as they are. They contain no internal shorthand.

1. **Is a data-processing agreement with Google Cloud required for student sessions,
   and is one available?** Specifically: is there an existing KU agreement that covers
   Google Cloud (not only Google Workspace) for the projects and billing account AIPLA
   uses, or would Google's standard Cloud data-processing terms be acceptable to KU for
   them?
2. **The interim Firebase agreement (raised with Legal/DPO in late September).** Has it
   been decided? If it is accepted, does it cover all of the services listed in AIPLA's
   privacy notice (application hosting, database, file storage, the research log,
   conversation history, document search, the AI models, text-to-speech), or only
   teacher sign-in?
3. **If AIPLA moves to another EU or Danish host, what does KU need from that host?** Is
   there a host that KU, or Danish schools generally, already has a data-processing
   agreement with, such as the servers that SkoleGPT is reported to use? How long does
   a new agreement normally take?
4. **Does KU treat AI-model processing differently from data storage?** For example,
   would stored data at a non-Google host with the AI model provided by Google's
   EU service be acceptable, or must both move?
5. **Teacher sign-in.** Teachers sign in through Google's Firebase service, which
   processes their email address. Students do not; they use an anonymous group code. Is
   teacher sign-in acceptable on its own while the student data path moves?
6. **If KU itself hosts AIPLA on university servers,** is an agreement still needed
   with Sunholo, which develops and operates the platform? Is one already in place?
7. **Data already collected.** Sessions with students have taken place on the
   current platform (the 2026-08-21 pilot, the 2026-10-05 teacher seminar, and sessions
   since). What covers that data while it is stored, and should it stay where it is, be
   moved, or be deleted?
8. **The November school visit (5–10 students, ages 15+, informed consent).** What has
   to be in place before it, and is a session that records only consented, anonymous
   group data under a different rule from general classroom use?

## Testing Strategy

- **M1:** a unit test that a non-Gemini model builds an agent with **no** Gemini built-in
  tool, and an integration test against a local endpoint (marked `integration`).
- **M2:** a column-parity test between the Postgres sink's schema and
  `chat-logs/views.tf`, so the export and the BigQuery views cannot drift apart without
  anyone noticing.
- **M3:** run the existing Firestore-backed test suites against the Postgres client, in
  the same way the in-memory client is already exercised.
- **M6:** the no-egress run is the acceptance test for the whole option. It must fail
  when a Google client is reintroduced, so before trusting it, check it with one
  deliberate Google call.

## Security Considerations

- The new profile must not inherit LOCAL_MODE's stub identity (F2). Keep
  `assert_safe_local_mode` (`config/local_mode.py:53-74`) unchanged, and refuse to start
  the new profile with LOCAL_MODE set.
- The model endpoint is reachable only from the app container, never publicly.
- Backups of a box holding student data need their own retention rule, matching the
  365-day research log the FAQ promises (`teacher-faq.md:179`).
- ADR-013's sandbox origin rule still applies. The sandbox needs its own origin even on
  one host.

## Open Questions

**For M:**

1. **Which machine?** 1.1.143 names "the UCPH GPU host", and stx-bench names the
   studio GPU, which is shared. A box holding student data on a Sunholo machine makes
   Sunholo the host as well as the developer (legal question 6). Is a KU-owned GPU
   available before December?
2. **Is C one of the extension's two workstreams?** At ~12–20d it displaces part of the
   discipline-layer work. Which part?
3. **If D does not clear in time for November,** does the school visit run without the
   platform, or move?

**Internal:**

4. Is the 1.1.143 latency threshold (first token ≤1.5× flash-lite) still right, given
   today's *"smarter, not fast"* consensus? If it is relaxed, gemma-4-31b's median of
   11 s may pass. If not, nothing measured so far does.
5. Does the box need the teacher dashboards (the BigQuery readers) for the March teaching
   period, or is an export enough until April's reflection?
6. Do the public pages need a section describing the box once it holds student data?
   This is a content decision, but it is due in the same release as the move (F6).

## Related Documents

- [self-hosting-and-terraform-handover.md](../v2.0.0-handover/self-hosting-and-terraform-handover.md) — the full inventory, effort grades, hybrid topologies and hardware sizing
- [ucph-it-hosting-requirements.qmd](../v2.0.0-handover/ucph-it-hosting-requirements.qmd) — the same inventory written for UCPH IT
- [firestore-portability-seam.md](../v2.0.0-handover/firestore-portability-seam.md) — the Protocol M3 implements
- [local-model-test-plan.md](../v1.1.0-feedback/local-model-test-plan.md) (1.1.143) — the gate on M1
- [ku-ai-office-alignment.md](../v2.0.0-handover/ku-ai-office-alignment.md) — KU IT's plans (unverified)
- [plan-2026-09-to-2027-04.md](plan-2026-09-to-2027-04.md) — the capacity this competes for
- [`/project/data-and-hosting`](https://aipla.ku.dk/project/data-and-hosting) — the public posture (F6)
