# Runbook — UCloud AI (SDU, Denmark) as a model provider

**Sovereign, OpenAI-compatible inference: every token computed in Denmark, never
used for training.** Run by SDU eScience inside UCloud, the national research
platform. KU staff and students log in with their university ID. Public page:
<https://ai.escience.sdu.dk/> · docs: <https://docs.cloud.sdu.dk/inference/ai-access.html>.

This is ADR-003's national / self-hosted tier, reached over HTTPS instead of on a
GPU we run ourselves.

## Status (2026-10-26)

| | |
|---|---|
| Login | ✅ works with a KU ID |
| Credits | ⏳ being applied for, 2026-10-26. **No API key can be generated without them** |
| Code | ✅ `ucloud/` route in `resolve_model` (tutor turns) and `llm.generate` (every other call, by purpose); registry entries, prices, hidden picker group, smoke test |
| Verified | ✅ the whole path (raw stream + one ADK turn with a tool call) against `glm-5.3-flash` served by a *different* OpenAI-compatible host (local Ollama). **Not yet against SDU itself** |
| Deploys | ❌ no env has the secret mounted. Steps 4–5 below |

## How it is wired

A model whose api_name starts `ucloud/` is sent to UCloud. Everything after the
prefix goes unchanged into the OpenAI `model` field (`backend/config/ucloud.py`,
`backend/adk/agent.py::resolve_model`).

| Variable | What | Where it lives |
|---|---|---|
| `UCLOUD_AI_API_KEY` | the key — **secret** | Secret Manager `UCLOUD_AI_API_KEY` (per env), `backend/.env` locally |
| `UCLOUD_AI_BASE_URL` | the "server address" shown with the key | `DEFAULT_BASE_URL` in `config/ucloud.py` once known (it is not secret and it is the same on every env); the env var overrides it |

Unset, or still the Terraform placeholder → the provider is **off**:
`/api/models` hides its models (the picker shows no UCloud group) and
`resolve_model` raises, naming the missing variable.

## 1. Get the key (once credits land)

1. In UCloud, switch to the **AIPLA project**, not *My workspace*. A key under a
   personal workspace leaves with that person.
2. Open the inference hub → a model card (GLM 5.3-Flash) → **Generate API key**.
3. ⚠️ **Copy the server address AND the key immediately — they are shown once.**
   Put both in 1Password as well as `backend/.env`.

## 2. Smoke it from the laptop

```bash
# backend/.env
UCLOUD_AI_BASE_URL=<server address>
UCLOUD_AI_API_KEY=<key>

make ucloud-smoke                       # every registered ucloud model the server serves
make ucloud-smoke MODEL=ucloud/glm-5.3  # one
```

It checks, in order: the key and base URL (`/models`; it tells you if `/v1` is
missing), **whether the served names match `models.yaml`**, a raw streamed
completion in Danish (first-answer-token time), and one ADK turn with a function
tool through the real `resolve_model`.

**The likeliest first failure is the name check.** The registry's `glm-5.3` /
`glm-5.3-flash` were guessed from the catalogue page. If the server lists e.g.
`zai-org/GLM-5.3-Flash`, change the api_name in `backend/config/models.yaml` to
`ucloud/<that exact id>`. Then add matching keys in **both** price tables
(`analytics/rate_card.py`, keyed by the registry name, and
`observability/llm_metrics.py`, keyed by a substring of the served name, because
the spend gate sees LiteLLM's `openai/<served>` and not `ucloud/<served>`).
`test_every_registered_model_is_priced` fails if you forget.

Then set `DEFAULT_BASE_URL` in `config/ucloud.py` to the server address, so a
deploy needs only the secret.

## 3. Measure before any student uses it

The smoke test proves the plumbing, not the teaching. Before pinning a
student-facing skill, run the capability-floor harness (`research/stx-bench/`)
against it, Danish and tool use especially. The harness has no
custom-endpoint route yet, so that is a small addition there.

What we know already, from GLM 5.3-Flash served elsewhere:

- **It reasons by default.** The reasoning arrives as ADK thought parts, so
  AG-UI streams it as REASONING events, which the student chat renders as
  "thinking". It is **not** mixed into the answer, but a student will see it
  where a Gemini tutor (thinking off) shows nothing. First answer token was
  ~1.7 s with reasoning on. Whether SDU lets us turn reasoning down (their chat
  UI offers low / high / max) is a question for the first real run.
- **Tool calling works** through ADK + LiteLLM (it called `multiply` and used the
  result).

## 4. Put the key on an env

**test / prod** (Terraform owns the secret shell, a placeholder version and the
runtime SA's accessor grant: `infrastructure/env/secrets.tf`):

```bash
make tf-plan ENV=test   # expect: +UCLOUD_AI_API_KEY secret, version, accessor binding
make tf-apply ENV=test GO=1
printf '%s' "$UCLOUD_AI_API_KEY" | gcloud secrets versions add UCLOUD_AI_API_KEY \
  --data-file=- --project=aipla-test-2026
```

**dev** has no Terraform layer. Create it the way `scripts/bootstrap-aipla-dev.sh`
creates the DOCPARSE secret:

```bash
printf '%s' "$UCLOUD_AI_API_KEY" | gcloud secrets create UCLOUD_AI_API_KEY \
  --data-file=- --replication-policy=automatic --project=aipla-dev-2026
gcloud secrets add-iam-policy-binding UCLOUD_AI_API_KEY --project=aipla-dev-2026 \
  --member=serviceAccount:aipla-v6@aipla-dev-2026.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

`printf … --data-file=-` keeps the key out of shell history and `ps`.

## 5. Mount it — ⚠️ only after step 4 on dev AND test

Add to **both** pipelines, or prod never gets it (the "promote twin" footgun in
`CLAUDE.md`):

- `cloudbuild.yaml` deploy step: `- '--set-secrets=UCLOUD_AI_API_KEY=UCLOUD_AI_API_KEY:latest'`
- `cloudbuild.promote.yaml`: extend the existing `--update-secrets=` with `,UCLOUD_AI_API_KEY=UCLOUD_AI_API_KEY:latest`

**A `--set-secrets` naming a secret that does not exist fails the deploy.**
`cloudbuild.yaml` builds dev on every push and test on every tag, so the secret
must exist in both before the line lands, and in prod before the next promote.
(The placeholder is enough: it reads as "not configured".)

## 6. Use it

Pin **one test skill on dev** to `ucloud/glm-5.3-flash` (skill settings → model
picker → "UCloud AI (Denmark)"). Leave student tutors alone until step 3 is
done and the permitted-use question below has an answer.

There is **no retry / fail-over** on this provider: `ResilientLlm` wraps Gemini
only, and the tutor fail-over chain is Gemini-only by design. A UCloud outage or
429 is a failed turn.

## 7. Move the other calls (one line each)

Everything the platform asks a model **outside** a tutor turn goes through
`llm.generate(purpose=...)` (`backend/llm/`). Which model each purpose uses is
`purposes:` in `backend/config/models.yaml`, and the provider comes from that
model's registry entry. Moving a purpose to Denmark is a one-line edit there,
or per deploy, an env var:

```bash
CHAT_TITLE_MODEL=ucloud/glm-5.3-flash      # <PURPOSE>_MODEL, an id or api_name
```

| Purpose | What | Student text? | Notes for UCloud |
|---|---|---|---|
| `chat_title` | title of every new chat, from its first messages | **yes, every chat** | the first one to move |
| `compaction` | summary replacing the start of a long chat | yes, long chats | feeds later answers. Check quality before moving |
| `chat_summary` | themes across chat excerpts (analytics chat) | yes, after the lesson | |
| `analysis` | rubric scoring, report narrative, fidelity, goal lint | yes, after the lesson | also `ANALYSIS_MODEL` |
| `live_summary` | teacher's live class overview | no, group signals only | |
| `document_extract` | text from an uploaded PDF or image | yes, student uploads | ⚠️ **must stay on a model that reads PDFs**. The OpenAI-compatible route takes images only and refuses a PDF |
| `curriculum_summary` | summary stored with a curriculum document | no | |
| `structured_extract` | JSON from parsed document blocks | depends on the document | |

The tutor turn itself is chosen per skill (step 6), through `resolve_model`.
`make check-model-calls` (CI) fails on a `genai.Client` call anywhere else,
so the table above is the whole list.

On the OpenAI-compatible route, `llm.generate` adds 4096 tokens to any
`max_output_tokens` because GLM reasons first and the reasoning counts against
the cap. A title's 32 tokens would otherwise be spent before the answer starts.

## ⚠️ What still leaves Denmark, with every purpose moved

- **Curriculum retrieval** (Vertex RAG, europe-west1). On Gemini it runs as a
  built-in retrieval tool. On a UCloud tutor, ADK is expected to turn it into an
  ordinary tool call that still queries Vertex (not verified yet). So the
  student's question goes to Google and the retrieved chunks go to SDU. Moving
  it needs our own embeddings and our own search index in Denmark. Ask SDU
  whether they serve an embedding model.
- **Diagram check** (`svg-illustrator`). The rendered picture is handed back to
  the model inside a function response, which is a Gemini feature. On GLM
  expect it to fail rather than leak. Untested.
- **Scanned PDFs** in `document_extract` (see the table above).
- **Voice** (speech to text, text to speech). Stays on Google by decision.

The web/enterprise search and code-execution sub-agents are **not** in use: no
skill on any environment enables them (checked 2026-10-26).

## Questions for SDU (ask when the credits come through)

1. **Permitted use.** UCloud AI is for "researchers and students at Denmark's
   eight universities". AIPLA's student users are upper-secondary pupils using a
   KU research platform. Does serving them through our app fit, and is a
   data-processing agreement needed?
2. **What a credit costs.** Both price tables assume 1 credit = 1 EUR/USD, which
   is deliberately high so the spend gate cannot under-count. Replace with the
   real rate.
3. **Concurrency / rate limits** for a class of ~30 students in one lesson.
4. Prompt **logging and retention** on their side.
5. Can **reasoning** be turned off or down per request (`reasoning_effort`)?
6. Availability: any SLA, and is there a status page?
