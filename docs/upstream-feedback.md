# Upstream feedback for `sunholo-data/ai-protocol-platform`

Friction points found while forking this template into AIPLA. Each entry
notes what hurt, how we worked around it, and what the upstream fix
would look like. Intended to be opened as issues / PRs against the
public template repo at the end of the v0.1 sprint.

> Maintained continuously through every milestone. New entries get
> appended; resolved entries get a `~~strikethrough~~` and a note.

## 1. `seed_skills.py` hardcodes a closed-set DISPLAY_NAMES / TAGS / INITIAL_MESSAGES dict

**Where:** `backend/scripts/seed_skills.py` lines 43–65.

**What hurt:** Adding a new skill template (`problem-set-hints`) meant
the seeder silently dropped its display name, tags, and initial message
because those dicts only list the five inherited skills. The skill
still seeds, but with falsy defaults.

**Workaround on AIPLA:** None yet — `problem-set-hints` will be seeded
via the auto-iterating `backend/admin/platform_seed.py` admin endpoint
instead (which doesn't need the dict). But anyone using the
command-line seeder hits this.

**Upstream fix:** Read these three fields directly from the SKILL.md
frontmatter (e.g., `metadata.displayName`, `metadata.tags`,
`metadata.initialMessage`). The hardcoded dict is a translation layer
that doesn't pull its weight; deleting it makes new skill templates
plug-and-play.

## 2. `seed_skills.py` pins the GCP project to `aitana-multivac-dev`

**Where:** `backend/scripts/seed_skills.py` line 36 — `pin_project_for_env("dev")`.

**What hurt:** AIPLA needs to seed against `aipla-dev-2026`, not
`aitana-multivac-dev`. The pin is Aitana-specific.

**Workaround on AIPLA:** Use the admin endpoint flow only (auto-iterates
templates, no project pin needed). The CLI seeder is effectively
unusable in a downstream fork without monkey-patching.

**Upstream fix:** Drop the pin or make it consumer-overridable via an
env var like `PLATFORM_SEED_PROJECT`. Default behaviour should resolve
project from ADC / standard `GOOGLE_CLOUD_PROJECT`, not a hard-coded
Aitana value. Same comment applies to the `pin_project_for_env` helper
in `scripts/_env.py` if its only purpose is to override `GOOGLE_CLOUD_PROJECT`.

## 3. `PLATFORM_OWNER_EMAIL` defaults to `platform@aitanalabs.com`

**Where:** `backend/admin/platform_seed.py` line 31.

**What hurt:** A downstream fork that forgets to set
`PLATFORM_OWNER_EMAIL` ships skills owned by Aitana's platform identity.
The comment ("default stays Aitana so existing dev/test/prod behaviour
is unchanged") acknowledges the asymmetry: upstream user wins by
default, downstream fork must remember to override.

**Upstream fix:** Default should be derived from the project (e.g.,
`platform@${GOOGLE_CLOUD_PROJECT}`), or fail-loud at startup if unset
in non-LOCAL_MODE. Defaulting to a downstream-invalid value is worse
than failing fast.

## 4. CLI is hardcoded for Aitana (`cli/aiplatform/...`)

**Where:** `cli/aiplatform/__init__.py` line 4, `cli/aiplatform/http.py`
lines 21–26 (`_DEFAULT_URLS`), and `cli/aiplatform/cli.py`.

**What hurt:** The CLI package name (`aiplatform`), binary name
(`aiplatform`), and per-env default URLs all bake in Aitana. The
docstring explicitly says *"Brand and backend remain Aitana Labs /
aitana-multivac-*"*. A downstream fork either lives with `aiplatform`
as a misnomer or maintains their own CLI fork.

**Workaround on AIPLA:** Live with `aiplatform` as the CLI name for
v0.1. Real rebrand to `aipla` is deferred to v1.

**Upstream fix:** The CLI was already renamed once (`aitana` → `aiplatform`
on 2026-04-28). The current naming repeats the brand-anchoring mistake.
Options:
- Generic binary name (e.g., `apx` or `ag-platform-cli`) that
  downstream forks rename via `pyproject.toml`'s `[project.scripts]`.
- Move `_DEFAULT_URLS` to a config file that downstream forks override
  without code changes (already supported via `AIPLATFORM_API_URL_*`
  env vars, but the documented commitment to "Aitana Labs / aitana-multivac"
  signals downstream isn't first-class).

## 5. `cloudbuild.yaml` requires channel-specific secrets that aren't optional

**Where:** `cloudbuild.yaml` lines 143–148, 150, 155 (pre-M2).

**What hurt:** The template ships `--set-secrets` lines for
`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `MAILGUN_API_KEY`, `MAILGUN_WEBHOOK_SECRET`, and
`AGENT_ENGINE_ID`. If the target project doesn't have these secrets
in Secret Manager, the Cloud Run deploy step fails. A fresh fork
deploying for the first time hits all six failures.

**Workaround on AIPLA:** M2 stripped all six because AIPLA v0.1 doesn't
use any of these channels. Re-introduce per-channel when v1 wires
Telegram/Email/etc.

**Upstream fix:** Make secret references conditional on substitution
flags, or move channel-specific deploy steps into separate include
files referenced via Cloud Build's `include` directive. The default
deploy should boot with only the bare minimum (the backend itself,
nothing else), and channels opt in.

## 6. `cloudbuild.yaml` hardcodes `gs://multivac-deploy-aitana-logging-bucket`

**Where:** `cloudbuild.yaml` line 33 (pre-M2).

**What hurt:** A shared Aitana logs bucket. Downstream forks either
get permission errors (no access to multivac bucket) or quietly write
to it.

**Workaround on AIPLA:** M2 templated it to `gs://${_PROJECT_ID}-cloudbuild-logs`
and added bucket creation to the bootstrap script.

**Upstream fix:** The template should default to a project-local
bucket via substitution.

## 7. New GCP projects (post-2024) lack the legacy Cloud Build SA — triggers must specify `--service-account`

**Where:** Bootstrap-time gotcha; manifests as an opaque `INVALID_ARGUMENT`
from `gcloud beta builds triggers create github`.

**What hurt:** Spent ~20 minutes chasing an opaque error. The cause:
new projects no longer auto-provision the legacy CB SA, so trigger
creates without `--service-account` fail without a useful message.
Same generic 400 from `curl` direct to the REST API.

**Workaround on AIPLA:** `scripts/bootstrap-aipla-dev.sh` materialises
the Cloud Build service agent via `gcloud beta services identity create`,
grants it `iam.serviceAccountUser` on the runtime SA, and passes
`--service-account` on every trigger create.

**Upstream fix:** Either:
- Document this in `docs/gotchas/` so the next forker doesn't chase
  the opaque error.
- Improve the Cloud Build trigger create error message upstream (this
  is a GCP-side ask, not a template fix).
- Provide a `scripts/bootstrap-gcp-project.sh` in the template itself
  that handles this for every downstream fork.

## 8. Cloud Build v2 repository registration requires GitHub `admin` on the linked repo

**Where:** Discovered during M0 when `gcloud builds repositories create cphu-aipla-app`
failed with *"the authorized user doesn't have the admin permission to repo"*.

**What hurt:** The convention for the `sunholo-voight-kampff` bot account
in v5 is `push`-only on customer repos. Cloud Build v2 needs `admin`
because it sets up webhooks server-side. The error message helpfully
named the user, but doesn't say what permission is missing.

**Workaround on AIPLA:** Promoted `sunholo-voight-kampff` to `admin`
on `cphu-aipla-app` specifically.

**Upstream fix:** Document the `admin`-not-`push` requirement in the
template's `docs/gotchas/` for anyone setting up the GitHub OAuth
authoriser for a new connection. Mentioning the alternative (use a
bot account that has admin everywhere, e.g., a dedicated CI bot
separate from the deploy bot) would also help.

## 9. Firebase "Resource Location ID" is set by the first Firestore create, not by `firebase add`

**Where:** Observed during M0 — after `firebase projects:addfirebase`,
the project's "Resource Location ID" shows as `[Not specified]`. It's
silently populated by whatever Firestore region the next `gcloud
firestore databases create` call targets.

**What hurt:** Easy to deploy with the wrong implicit default if the
operator doesn't know about this. EU residency could be violated by
a stray `gcloud firestore databases create --location=us-central1` run
on a project that thinks of itself as European.

**Upstream fix:** Document in `docs/gotchas/`. Or in the template's
bootstrap script (when one exists), assert the project's resource
location matches the intended region before any Firestore operation.

## 10. Pre-existing test files use `/^join$/i` anchored regex on the inherited "Join" button

**Where:** `frontend/src/app/group/__tests__/page.test.tsx` line 183 (pre-M2).

**What hurt:** Any downstream rebrand of the button text (here:
bilingual "Tilslut / Join") breaks this single test with an opaque
`getByRole(button)` error.

**Workaround on AIPLA:** M2 updated the matcher to the new localised
text.

**Upstream fix:** Either use less-anchored matchers in the template
tests (`/join/i` instead of `/^join$/i`), or wrap the test in a fixture
that reads the button's label from a single source. The template's
own `branding.ts` could carry CTA strings too.

## 11. Inherited dev pages + protocol URIs still say "Aitana"

**Where:**
- `frontend/src/types/skill.ts:5` — doc comment
- `frontend/src/app/dev/mcp-apps/page.tsx:12` — page title
- `frontend/src/app/dev/rich-media/page.tsx:80,125,127` — fixture
  filename + display text
- `frontend/src/app/dev/mcp-apps/passive/page.tsx:43` — internal
  `__aitanaTransport` field name
- `frontend/src/app/skills/new/page.tsx:10` — `aitana skill create`
  CLI command example
- `frontend/src/components/chat/InlineCitation.tsx:9,62` — `aitana://`
  custom URI scheme

**What hurt:** None of these are user-facing in v0.1 — but they are
embedded protocol identifiers (`aitana://`) and dev tooling that a
downstream consumer can't easily rebrand without rewriting code.

**Workaround on AIPLA:** Tracked in M2 sprint notes as deferred to v1.

**Upstream fix:** The `aitana://` URI scheme is the load-bearing one.
Either:
- Move it to a configurable scheme name in `branding.ts`.
- Use a generic scheme like `inline-citation://` that doesn't carry a
  brand.

## 12. `_MCP_SANDBOX_URL` default in `cloudbuild.yaml` points at an Aitana-specific Cloud Run URL

**Where:** `cloudbuild.yaml` line 27 —
`_MCP_SANDBOX_URL: 'https://mcp-sandbox-66pa3y5xnq-ew.a.run.app/sandbox.html'`.

**What hurt:** Downstream forks deploy with a sandbox URL pointing at
Aitana's infra. Not load-bearing for v0.1 (we don't ship MCP Apps) but
the default is wrong-by-default.

**Workaround on AIPLA:** Will reset to AIPLA's own sandbox URL in 1.x
when MCP Apps are wired (per Resolved Decision in jutland-demo.md
about ADR-002 scope discipline — A2UI/MCP Apps are v1 not v0.1).

**Upstream fix:** Default should be `null` / `disabled`, not a specific
Aitana URL.

---

## 13. Cloud Build's `gcloud auth print-identity-token --audiences=` doesn't work under a user-managed SA

**Where:** `cloudbuild.yaml` step `seed-platform-skills`.

**What hurt:** The inherited template's seed step uses
`gcloud auth print-identity-token --audiences="$URL"` to mint an ID
token. Under a user-managed Cloud Build SA (which new projects post-2024
must use; see bump #7), this errors with *"No identity token can be
obtained from the current credentials."* The step has `set +e; exit 0`
so the failure is silent — the build goes green and the seed never
happens. Took multiple deploys to notice that the marketplace was
empty.

**Workaround on AIPLA:** Use the metadata-server endpoint directly:
`curl http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=$URL&include_email=true`.

**Upstream fix:** Either document the metadata-server pattern as the
canonical Cloud-Build-side identity-token approach, or remove the
`set +e; exit 0` so seed failures surface in the build status.
Probably both.

## 14. The minted identity token has no `email` claim by default — backend allowlist silently rejects

**Where:** Cross-cutting between `backend/admin/auth.py` (verifies
`claims["email"]` against allowlist) and any caller that mints an
ID token without `include_email=true` (metadata server) or
`--include-email` (gcloud impersonation).

**What hurt:** Even after fixing bump #13 to use the metadata server,
the seed step kept returning 403 *"Not authorized"*. Decoded the
impersonated token locally: only `aud`, `azp`, `exp`, `iat`, `iss`,
`sub` — no `email`. Backend's `_assert_caller_is_service_account`
calls `claims.get("email", "")` which returned empty string, never
matched any allowlist entry. Diagnosis was 20 minutes of confusion.

**Workaround on AIPLA:** Add `&include_email=true` to the metadata
server query, and `--include-email` to local gcloud impersonation
commands.

**Upstream fix:** Either:
- Make the backend's auth check fail with a more diagnostic message
  when `email` claim is empty (`"email claim absent from token — did
  you forget include_email=true?"` is fixable in one log line).
- Document `include_email=true` as required in `docs/ops/platform-skills.md`
  alongside the seed endpoint docs.
- Both. The combination of generic 403 + missing email + non-obvious
  curl flag is the kind of bug that wastes hours.

## 15. Skill-invoke endpoint path is not discoverable without reading source

**Where:** During M4/M5 of AIPLA v0.1, I (Claude) spent real time
guessing endpoint paths (`/api/skills/<name>/invoke`,
`/v6/skill/.../stream`, etc.) before the user pointed out that the
`aitana-adk-testing` project skill documents exactly which routes
exist. The right path is **`POST /api/skill/{skill_id}/stream`**
(production AG-UI streaming, requires auth). `/run` and `/run_sse`
are the bare-ADK paths but they fail with `Agent not found:
'aitana_platform'` because of the dev-UI quirk that skill calls
out (the `agents_dir` doesn't contain a matching subdirectory).

**What hurt:**

1. **Endpoint not in any user-facing docs.** README, WORKSHOP.md, and
   the CLAUDE.md backend section all skip the routing layer. The
   skill knew, but discovering the skill required either knowing it
   exists already or running through the full `.claude/skills/`
   inventory.
2. **OpenAPI exists but isn't surfaced.** Running
   `curl /openapi.json | jq '.paths | keys'` against a local backend
   would have given me 74 routes in one shot. There's no breadcrumb
   in README or CLAUDE.md pointing at `/docs` or `/openapi.json` as
   the discovery mechanism.
3. **`/list-apps` shows backend subdirs, not the actual `app_name`.**
   This is the dev-UI quirk that the `aitana-adk-testing` skill
   warns about — `app_name` is `aitana_platform` (constant in
   `backend/adk/agui.py`), not any of the names in `/list-apps`. A
   first-time forker following typical ADK docs will hit this and
   spend 20 minutes confused.
4. **`aiplatform-cli` skill was referenced in CLAUDE.md but did not
   fork into the AIPLA repo.** The `.claude/skills/` directory only
   has `aitana-adk-testing` + `aitana-frontend-verify` + ADK-meta
   skills + sprint-workflow skills. The CLAUDE.md mentions
   `aiplatform-cli` and `aitana-v6-deploy` and `cloud-run-diagnostics`
   — none of those are in this repo. Downstream forks lose those
   skills silently.

**Workaround on AIPLA:** Updated `cli/aiplatform/commands/smoke.py`
to use the correct path (`POST /api/skill/{id}/stream`) and added
support for the `local-mode-stub-token` literal as a bearer for
LOCAL_MODE testing. Smoke command can now be pointed at LOCAL_MODE
or the deployed URL with a real group token.

**Upstream fix:**
- **README** should have a "Where does the API live?" section that
  names `/docs`, `/openapi.json`, `/api/skill/{id}/stream` (prod
  flow), `/run` / `/run_sse` (bare ADK), and the `app_name=
  aitana_platform` constant. One paragraph saves a working day.
- **CLAUDE.md** should reference the `aitana-adk-testing` skill in
  the "ADK Development" section so forkers see "load this skill to
  learn the endpoints" right next to "use uv run".
- **`aiplatform-cli` skill** should be in the public template if
  CLAUDE.md is going to reference it. If it's customer-specific and
  shouldn't fork, CLAUDE.md should say so explicitly instead of
  linking.
- **`/list-apps` should return `aitana_platform`** (or whatever the
  product's `APP_NAME` constant resolves to) instead of leaking
  filesystem layout. This would fix the dev UI as well.
- **The skill-invoke API contract** (threadId + messages array
  shape) should be documented in OpenAPI properly — currently the
  request body is inferred from frontend source.

## 16. Anonymous-group state lives in process memory; the template ships a TODO that never landed

**Where:** `backend/auth/group_id_auth.py` line 25 of the module
docstring — *"The production InMemoryFirestoreClient / Firestore
wiring lands in M2 alongside the routes."* The routes shipped; the
Firestore wiring didn't.

**What hurt:** AIPLA v0.1 deploy needed a single shareable URL. Group
codes are minted into `_state.groups`, an in-memory dict scoped to
the Cloud Run container. Without Firestore-backing, the demo flow
required either:
- pinning `min-instances=1` (defeats serverless), OR
- pinning `max-instances=1` (defeats horizontal scaling), OR
- making JB run a separate `mint-group` step every time the
  container scaled to zero.

User pushback during the v0.1 sprint nailed it: *"err why
min-instances=1 necessary? we want it serverless — what is not being
persisted?"*

**Workaround on AIPLA:** Closed the TODO ourselves —
`_persist_group` / `_load_group_from_firestore` /
`_mark_revoked_in_firestore` write through to the `anon_groups`
collection. `get_group()` does in-memory cache hit + Firestore
fallback + cache-rehydrate. `delete_group()` writes a `revoked` flag
on the doc. 56/56 tests green; LOCAL_MODE's `InMemoryFirestoreClient`
turns the persistence layer into a no-op round trip.

**Upstream fix:** Land the same change in the public template. The
docstring TODO is a known gap; closing it lets every downstream fork
stay serverless instead of replicating the pinning workaround.

## 17. `/gcs_config` volume mount is wired in Dockerfile + cloudbuild but no Python reads it

**Where:** `backend/Dockerfile` (`ENV _CONFIG_FOLDER=/gcs_config`)
plus `backend/cloudbuild.yaml` and `cloudbuild.yaml`
(`--add-volume name=gcs_config,type=cloud-storage,...readonly=true`
and `--add-volume-mount volume=gcs_config,mount-path=/gcs_config`).

**What hurt:** User asked *"the skills should come via the gcs
storage bucket that is linked to the cloud run volume — are you
missing that?"* — a reasonable hypothesis given the mount exists.
Grep confirms: **zero Python code reads `_CONFIG_FOLDER` or
`/gcs_config`**. The bucket is created, mounted readonly, never
touched. Bootstrap scripts create `gs://<project>-config` because
the template requires it; nothing populates it; nothing reads it.

For AIPLA specifically: skills come from `backend/skills/templates/`
(baked into the image at build time) → seeded into Firestore via
`/api/admin/seed-platform-skills` → read from Firestore at runtime
by the marketplace API + skill invocation path. GCS mount is not in
that pipeline.

**Upstream fix:** Either delete the dead plumbing, or wire it up to
something real (e.g., let the seed step push template SKILL.md files
into the bucket so they're swappable at runtime without a redeploy —
the user's hypothesis is a legitimate feature for a downstream fork
to want). Whatever the answer, the current state — mounted, unread —
is confusing.

## Backlog (likely additions as v0.1 sprint continues)

- M5 may surface IAM bindings the bootstrap script should add
  (`roles/artifactregistry.writer`, `roles/run.admin`,
  `iam.serviceAccountUser` on self) — currently deferred to "add when
  needed".
- Whether the inherited `LOCAL_MODE` skill seeder picks up new
  templates auto-magically (so far it seeds a workshop user but the
  skill-seed path is unclear).

When the v0.1 sprint closes, this file is the source for an
issue / PR series against `sunholo-data/ai-protocol-platform`.
