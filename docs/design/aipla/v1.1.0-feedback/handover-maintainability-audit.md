# Handover & Maintainability Hardening — AIPLA app

**Date:** 2026-07-22 · **Status:** audit + prioritised plan, no code changes yet · **Owner:** M

> Goal: make the codebase **easy to hand over to less-technically-adept owners**
> and **easy for AI agents (and Claude) to work in**, while **keeping the same
> functionality**. This widens the lens of the [2026-06-29 DRY audit](simplification-refactor-audit.md):
> that one asked "is the code DRY?"; this one asks "can someone who isn't M —
> human or agent — pick this repo up, understand it, run it, extend it, and
> deploy it without tribal knowledge?"

## Bottom line

The June audit found the code **functionally healthy** and fixed the cheap
duplication. That verdict still holds — **the debt that blocks handover is not
mostly in the application code.** It is in four places the DRY audit did not
look:

1. **The fork's identity was never resolved.** The first files any newcomer or
   agent reads — `README.md`, `WORKSHOP.md`, `CONTRIBUTING.md`, `.env.example` —
   still describe "Aitana Platform v6", point at the wrong GitHub repo, and send
   people to the wrong architecture doc. The real AIPLA orientation lives only in
   a 25 KB agent-facing `CLAUDE.md` and a private site on M's laptop. The
   documented dev URL (`:3000`) is the wrong port (`make dev` binds `:3456`).
   CLAUDE.md tells agents to load **four skills that don't exist on disk.**

2. **A large dormant/dead surface pretends to be live.** ~3,100 LOC of inherited
   channels code (Telegram/Discord/WhatsApp/Email), 10 Firestore indexes for the
   retired v5 "assistants" concept, 3-of-4 "model provider tiers" that exist only
   in docs, 85 frozen template design docs interleaved with AIPLA's, and a
   handful of dead frontend components — all indistinguishable from working code
   to a newcomer, and all things an agent will try to "maintain" or "fix".

3. **The footguns are tribal knowledge, not guardrails.** The bugs this project
   has shipped repeatedly (dual-auth wrong-token, forgotten post-deploy seed,
   dropped trust-card, full-overwrite POST) are all documented as *warnings a
   human must remember*. For a less-technical successor that is the worst class
   of bug: tests pass, deployed behaviour is wrong.

4. **Config and infra aren't single-sourced or reproducible.** `.env.example`
   documents ~20 of ~72 real env vars (no central `Settings` object; `GOOGLE_CLOUD_PROJECT`
   is read via raw `os.getenv` in 10 places, each with its own default); model IDs,
   region, and project are hardcoded in several places (analytics judges will
   silently break when `gemini-2.5-flash` deprecates); and cutting a fresh
   environment is `terraform apply` **plus** ~5 hand-run scripts, with dev-side
   infra mirrored into Terraform by hand.

**The cross-cutting mechanism behind most of the *code-level* confusion: adoption
of the right helper stopped halfway.** The team has already built the correct
shared abstraction for nearly every duplication below — `auth/guards.py::assert_teacher`,
`adk/instruction_provider_chain.py::compose_instruction_providers`,
`classes_routes._load_owned` / `access_context.is_owner`, `config/models.py::default_model()`,
`config/gcp.py::resolve_gcp_project()`, `lib/apiResponse.readJson`, the root test
`conftest.py`, `useActivityBuilder` — but ~4 files each kept their own copy. So a
newcomer or agent opening the repo sees the **same intent spelled 3–4 incompatible
ways** (three different "is this a teacher?" predicates; five ownership-check
idioms; two pricing tables; `readJson` re-declared locally 3×) and cannot tell
which is canonical. Half-adoption is worse for handover than no-abstraction,
because it looks intentional. Most of Phases 1–3 is *"finish adopting the helper
that already exists,"* not new design.

The **June Phase-3 "big rocks" (god-file decomposition, backend ownership guard)
never shipped** and are carried forward here as Phase 3 — but they are *not* the
top priority for handover. The top priority is Phases 0–1: cheap, subtractive,
mostly-CI work that makes the repo legible and safe for someone who isn't M.

---

## What the June DRY audit already shipped (reconciliation)

Verified against git + on-disk code on 2026-07-22 (per the "sprint-state JSON
drifts stale" rule — the sprint JSON reports empty milestones; git is the truth).

| June item | Status now | Evidence |
|---|---|---|
| F3 shared `apiResponse.readJson` | ✅ shipped | `frontend/src/lib/apiResponse.ts` exists |
| F4 dedupe `relativeTime` | ✅ shipped | commit `8aacaef` |
| F9 `useToast` (partial) | ✅ shipped | commit `710f22c` |
| B2 shared `assert_teacher` | ⚠ partial (a cautionary tale) | `7382231` landed `auth/guards.py::assert_teacher`, now used at 33 sites — but `curriculum_routes.py` reimplements the check inline **11×** with a *different* predicate (`getattr(user,"group_id",…)`) and `teacher_prefs_routes.py` keeps a *third* private copy with a third predicate. Half-adoption left **three divergent teacher gates** — a live correctness risk, not just style |
| B4 stale `aitana-multivac` startup guard | ✅ shipped | (verify remaining literals — see P0.3) |
| B6 fold `_class_for_user` | ✅ shipped | commit `d164927` |
| M3 unify element types | ✅ shipped | `frontend/src/lib/elementTypes.ts` exists |
| M4/F5 save-payload in `useActivityBuilder` | ✅ shipped | commit `ca17d6c` |
| **F1 ChatShell decomposition** | ❌ **not shipped** | chat page is **1378 lines** (was 1269 in June — it grew) |
| **F6 useSkillAgent split** | ❌ not shipped | 570-line hook intact |
| **F8 builder `useState`→reducer** | ❌ deferred | noted deferred in `995aed5` |
| **B1 ownership guard (`auth/ownership.py`)** | ❌ **not shipped** | file does not exist; 9+ inline ACL clones remain |
| **B5 `fast_api_app.py` split** | ❌ not shipped | file is **761 lines**; no `app_factory.py`/`stream_routes.py` |
| **B7/B8 service layer + `create_agent`** | ❌ not shipped | — |
| B9/B10 (`__id` leak, collection constants) | ❌ deferred | noted in `02527dc` |

**The characterization safety nets from June Phase-1 are all in place** (145
tests: `teacherApi.test.ts`, `chat-page-characterization.test.tsx`,
`useActivityBuilder.test.ts`, `test_dual_auth_rejection.py`, `test_app_assembly.py`).
That means the Phase 3 big rocks below are *still safe to cut* — the nets already
exist; only the cuts are outstanding.

---

## Prioritised plan

Five phases, ordered by **(handover leverage ÷ effort ÷ risk)**. Phases 0–1 are
the recommendation to do first and fast — they are cheap, low-risk, and clear the
majority of newcomer/agent confusion. Phase 3 is the June carryover (higher
effort, gated on the existing nets). Phase 4 is the biggest effort but the thing
a non-expert successor most needs (reproducible infra).

| # | Theme | Effort | Risk | Handover leverage |
|---|---|---|---|---|
| **P0** | Resolve fork identity + delete dead/dormant surface | **S–M** | **Low** | **Highest** |
| **P1** | Turn footguns into CI gates (safe-by-construction) | M | Low–Med | High |
| **P2** | Single-source config + extensibility ergonomics | M | Low | High |
| **P3** | Finish the June big rocks (god-files, ownership guard) | L | Med (net-gated) | Med |
| **P4** | Reproducible infra + human-readable handover docs | L | Med–High | High (handover-critical) |

Timing note: today is 2026-07-22; pilot starts **2026-08-14** (~3 weeks),
handover **2026-09-15** (~8 weeks). **P0/P1/P2 are freeze-safe and should land
before the pilot** (they reduce risk during it). P3 big rocks and P4 Terraform
convergence are best scheduled for the post-pilot iteration window, each behind
its gate.

---

### P0 — Resolve fork identity + delete dead surface  *(do first)*

The single highest-leverage cluster: cheap, subtractive, near-zero functional
risk, and it clears the confusion every other reader hits on day one. One focused
pass "bakes AIPLA reality in" and archives the template residue.

**P0.1 — Re-skin the front-door files for AIPLA.** *(S, Low)*
`README.md`, `WORKSHOP.md`, `CONTRIBUTING.md` still say "Aitana Platform v6",
clone `github.com/Aitana-Labs/platform`, and point "Architecture" at the dead
inherited `docs/design/v6.1.0/SEQUENCE.md`. Rewrite `README.md` as the AIPLA
front door (what it is · run-locally · doc-map · link to CLAUDE.md for agents,
~1 screen). Re-skin or replace WORKSHOP/CONTRIBUTING (correct repo `sunholo-data/cphu-aipla-app`,
correct sequence `docs/design/aipla/SEQUENCE.md`, and the real workflow — commit
directly to `dev`, no PRs — not the template's PR flow).

**P0.2 — Fix the dev port everywhere: `3456`, not `3000`.** *(S, Low)*
`make dev` → `scripts/dev-local.sh` binds the frontend to **3456**; `README.md:32`
and `CLAUDE.md:172,178,355` all say **3000**. The documented day-one path lands
on a dead port. Make 3456 the single source of truth (or have `make dev` echo the
URL it actually bound). *Verified.*

**P0.3 — Reconcile the CLAUDE.md skill catalogue with disk.** *(S, Low — top agent-workability fix)*
CLAUDE.md instructs agents to load `aiplatform-cli`, `aitana-v6-deploy`,
`aitana-template-publish`, `cloud-run-diagnostics` — **none exist in
`.claude/skills/`** (verified). `guide-maintenance` exists but isn't catalogued.
An agent following the instruction stalls or fabricates. Restore the skills (if
dropped in a sanitize) or remove/relabel the refs; add a tiny CI check that fails
if CLAUDE.md names a non-existent `.claude/skills/<name>`.

**P0.4 — Slim CLAUDE.md by resolving the inheritance.** *(M, Med — load-bearing, do carefully)*
25 KB / 392 lines, of which the top ~97 are "template says X / AIPLA says Y"
framing and the highest-value gotchas (anonymous-group auth, seed footgun) are at
the *bottom*. Bake AIPLA reality directly into the prose (real project IDs, `dev`
default, sidecar deploy topology, port 3456), delete the diff scaffolding, move
stable reference material (protocol stack, v5-copy patterns) to linked `docs/`,
and **promote the footgun/gotcha section to the top — preserving its wording
verbatim** (it encodes real incident history). Target ~40% smaller.

**P0.5 — Delete dead Firestore indexes.** *(S, Low)*
`firestore.indexes.json` has 10 indexes for retired collections — 6 `assistants`,
3 `userPreviews`, 1 `messages` — with **zero query references** in backend or
frontend (verified concept; v6 replaced Assistants with Skills). Pure subtraction.

**P0.6 — Delete confirmed-dead frontend modules.** *(S, Low)*
Zero non-test references (verified): `components/chat/VoiceStatusPill.tsx`,
`PersonaHeader.tsx`, `ReadOnlyComposer.tsx`, `components/teacher/insights/KpiStrip.tsx`,
`hooks/useMcpAppMessages.ts`, `hooks/useArtefactReportEvent.ts`, and the orphaned
route `app/skill/[skillId]/settings/page.tsx`. Delete each module + its test.

**P0.7 — Gate or delete `app/dev/*`.** *(M, Low)*
`app/dev/{file-browser,mcp-apps,rich-media}` ship to prod, reachable by URL. A
comment in `app/dev/mcp-apps/page.tsx` *claims* a `layout.tsx` `notFound()` gate
exists — **it doesn't.** Either add the intended `NODE_ENV==='production'` gate or
delete the trees. (`components/dev/LatencyHUD` is in use — keep.)

**P0.8 — Archive inherited template design docs + add a doc-map.** *(S, Low)*
`docs/design/v6.0.0/1/2` (85 files, frozen since the fork) sit beside AIPLA's,
with 5 competing `SEQUENCE.md` files and no top-level index. Move them under
`docs/design/_inherited-template/` (recoverable from upstream) and add a one-screen
`docs/design/README.md`: AIPLA design → `aipla/SEQUENCE.md`; product/pedagogy →
scoping site; template history → archived.

**P0.9 — Tidy root cruft (broken-windows).** *(S, Low)*
`git rm -r --cached .dev-logs/` (8 tracked files despite being gitignored);
delete root `node_modules/` (no root `package.json`); add `.pytest_cache/` to
`.gitignore`; relocate the two root scratch files `feedback-2026-01-15.md` /
`feedback-2026-06-16.md` into `docs/design/aipla/v1.1.0-feedback/`; pin a real SHA
in `.template-fork-target` (still the literal `FORK_TARGET`) or remove it.

**P0.10 — Decide the dormant channels framework's fate.** *(M–L, Med)*
`backend/channels/*` = 3,082 prod LOC + 3,189 test LOC (~6.3k total, 15 files) +
4 Firestore rule blocks + ~12 env vars, largely inert ("M1 ships the framework
with no adapters"). **Recommendation: quarantine, don't delete** — move behind one
clearly-labelled `# ROADMAP — not shipped in AIPLA` boundary + a single feature flag
so a newcomer/agent can see it's inert; revisit deletion after the pilot.
⚠ **First resolve a real ambiguity this audit surfaced:** the two build pipelines
*disagree* — the root `cloudbuild.yaml` (the deploy pipeline) strips all channel
secrets, but `backend/cloudbuild.yaml:79-80` wires `MAILGUN_API_KEY`/`MAILGUN_WEBHOOK_SECRET`.
So Email may not be as dead as it looks, and having two cloudbuilds with divergent
secret wiring is itself a handover hazard. Discord (`DISCORD_PUBLIC_KEY`) is absent
from both — the clearest single deletion candidate — but **confirm channel traffic
with M before deleting anything** rather than trusting an env-var grep.

**P0.11 — Delete definite backend dead code + decide the inert `budget/` subsystem.** *(S, Low)*
Zero-reference orphans (verified): `adk/live_agent.py` (14 LOC Gemini-Live stub, the
only module with zero refs anywhere), the `Message` + `UserProfile` Pydantic models
in `db/models/__init__.py` (in `__all__`, never used — v5 leftovers), the empty
`utils/` package, and three empty test-placeholder dirs (`tests/{integration_tests,model_tests,utility_tests}/`).
Separately, `budget/` (632 LOC) runs on **every model turn** via `adk/agent.py:581`
but `register_budget_enforcer()` is **never called in production** — the callbacks
always no-op. Either wire an enforcer at startup (make it real) or remove the
subsystem, keeping only the `BudgetExceededError`/`BudgetDecision` types that
`skill_processor.py` imports. Move the 8 run-once migration/backfill scripts
(~1,100 LOC, incl. `migrate_v5_channel_mappings.py`) to `scripts/archive/`.

---

### P1 — Turn footguns into CI gates (safe-by-construction)

Convert the bugs-we-keep-shipping from "warnings a human must remember" into build
failures. This is the change that most directly de-risks handover to a
less-technical owner: the machine enforces correctness, not the person.

**P1.1 — Dual-auth, safe-by-construction (frontend).** *(S→M, Low)*
`fetchWithAuth` (student token) / `fetchWithTeacherAuth` (teacher token) are
called at 45 sites with **no guardrail**; wrong pick = 401, shipped 4+ times
(AGUIProvider even documents two dated prod incidents). Step 1 (cheap, do now):
add `no-restricted-imports` in `.eslintrc.json` banning both helpers outside
`src/lib/**`, forcing every call through a typed client where the role is chosen
once. Step 2: role-typed client — `api.student.*` / `api.teacher.*`, dual-audience
endpoints take an explicit `as: 'student'|'teacher'` (the pattern
`curriculumApi.fetchCurriculumContent` already uses). **Do not merge the two
helpers** — they're correctly separate; make the *choice* safe instead.

**P1.2 — Dual-auth, backend: collapse the three teacher gates + add `assert_student`.** *(M, Med — pairs with P3 B1)*
Finish June's B2 properly: make `auth/guards.py::assert_teacher` the *only* teacher
gate. ✅ **Shipped 2026-07-22:** converted **10 of curriculum's 11** `group_id`
checks to `assert_teacher(user, detail=…)` (the 11th — `GET /{doc_id}/content` L551 —
is a genuine **dual-audience branch**, not a teacher-gate; audit had over-counted)
and removed `teacher_prefs_routes.py`'s divergent copy. Note the migration hazard
found: the divergent predicates were `not group_id`, but `assert_teacher` requires
`is_teacher=True`; real Firebase teachers always carry it (`_user_from_decoded_token`),
so production behaviour is unchanged, but **test fixtures that built teachers as
`User(uid=…)` without `is_teacher=True` had to be updated**. 97 tests green.
Still open: promote to a router-level `Depends(...)` where it's the first line of
every handler (e.g. `classes_routes.py` ×15). Add the missing `assert_student`
/ `require_group` helper (the check `if not user.group_id: raise 404` is copy-pasted
9× in `group_routes.py` with no shared helper), extract a `mark_researcher_bypass(span)`
helper (the researcher-bypass telemetry block is verbatim 4×), and register one
app-level `PermissionError` handler. This is the cheap half; the structural half
(`auth/ownership.py` load-and-assert guard folding the 5 ownership-check idioms +
the researcher bypass + span) is P3.B1. `test_dual_auth_rejection.py` already nets it.

**P1.3 — Automate the post-deploy seed.** *(M, Med — the #1 operational footgun)*
A code deploy does **not** propagate `SKILL.md` changes to Firestore; `make seed`
is a manual step whose omission produces silent staleness ("shipped feature works
in tests, deployed app shows old skill data"). CI only *reminds*. Root-cause fix:
the in-build seed was removed because the token-mint 403s inside Cloud Build — so
run it as a **post-deploy Cloud Run job** (executes as the runtime SA, which *can*
mint), triggered by the build. Makes seed automatic; removes the most-cited
footgun in the repo.

**P1.4 — Wire the trust-card audit into CI.** *(M, Med)*
`scripts/audit-trust-cards.sh` exists (per the `workbench-element-builder` skill)
to catch a workbench element that pushes state to the tutor without the visible
"shared with the AI" card — a bug shipped for the calculator and table. Promote it
from a script to a **blocking CI check** so a push-without-card fails the build.

**P1.5 — Regression-test the full-overwrite activity POST.** *(M, Med)*
The activity-config POST is a full overwrite — a partial payload silently wipes
data. `useActivityBuilder.test.ts` nets the frontend `elementPayload()` completeness;
add the backend twin (assert a partial payload is rejected or merged, never
silently truncated) so the data-wipe can't ship from either side.

**P1.6 — One "Footguns & their guards" table.** *(S, Low)*
Collect every "you must remember to also X" into one CLAUDE.md table stating, per
item, whether it's **enforced (CI/gate)** or **manual**, and drive the manual ones
toward enforcement. (`make cli-install --no-cache` is already baked in — leave it.)

**P1.7 — A "canonical helpers" contract to stop half-adoption recurring.** *(S, Low — the anti-recurrence guard)*
Half-adoption (the cross-cutting mechanism above) is *why* there are three teacher
gates and five ownership idioms — the helper existed, but nothing stopped a new
file re-rolling its own. Add a short **"Canonical helpers — use these, don't
re-roll"** section to `backend/CLAUDE.md` and `frontend/`'s equivalent (listing
`assert_teacher`/`assert_student`, `_load_owned`/`is_owner`, `default_model()`,
`resolve_gcp_project()`/`settings`, `readJson`, the role-typed API client, the test
conftests), and back it with a **CI grep guard** that fails when a banned inline
pattern reappears (e.g. `os.getenv("GOOGLE_CLOUD_PROJECT"` outside `config/`,
`owner_uid !=` outside `auth/`, a local `readJson` re-declaration, `fetchWith*Auth`
outside `lib/`). This is what makes every P1–P3 dedup *stay* deduped for the next
maintainer or agent, rather than drifting back to 3-ways-to-do-it.

---

### P2 — Single-source config + extensibility ergonomics

Make "what do I set?" and "how do I add a new X?" answerable from one place. This
is where extensibility for a less-technical owner lives.

**P2.1 — Single-source the config surface with a `Settings` object.** *(M, Low)*
`.env.example` documents ~20 of ~72 real backend env vars; behaviour-changing
flags (`AIPLA_THINKING_BUDGET`, `VOICE_*_PROVIDER`, `AIPLA_LIVE_SUMMARY`, `MCP_SANDBOX_URL`)
appear only in `cloudbuild.yaml` or inline `os.getenv` defaults. There is **no
central `Settings` object** — `GOOGLE_CLOUD_PROJECT` is read via raw `os.getenv`
in 10 places, `AGENT_ENGINE_ID` 9×, each repeating its own default (drift risk),
and `config/gcp.py::resolve_gcp_project()` exists but is bypassed by most sites.
Introduce one `config/settings.py` (`pydantic-settings`) as the single place env
is read + defaulted + documented; generate `.env.example` (or a `aiplatform config
doctor`) from it. One screen then tells a newcomer everything that configures the
app. Add a "deploy-only / advanced" section at minimum.

**P2.2 — One model/pricing/region source.** *(S, Low — closes a 5-file "change in N places" trap)*
`default_model()` is the intended single knob ("code MUST call this instead of
hardcoding"), yet `analytics/session_rubric.py:50`, `analytics/summarise.py:65`
hardcode `"gemini-2.5-flash"` (the model `models.yaml` flags as going away) and
`voice/providers/gcp_tts.py:67` hardcodes the TTS model. Worse, model→price maps
live in **two** independent tables (`observability/llm_metrics.py:31` and
`analytics/rate_card.py:39`) while the curated `config/models.yaml` carries *no*
pricing — so retiring or repricing a model means editing 5 files. Add a `pricing`
field to `models.yaml`, delete both hardcoded price tables in favour of a registry
lookup, and route judge/summarise/TTS model selection through `default_model()`.
Region appears as 3 different literals across code/build/scripts — fold into one
`session_region()`/`model_region()` helper.

**P2.3 — Right-size the "4 provider tiers" story.** *(S doc / M code, Low)*
Only cloud-Gemini is wired: the Claude/OpenAI branches in `adk/agent.py:resolve_model`
are unexercised and the OpenAI path is **dead in deployment** (no key wired);
DeepSeek/Qwen/Gemma/on-device = 0 code references. Update the ADR/docs to say
what's true ("cloud-Gemini is the only wired tier; the rest are roadmap stubs")
and make the dead branches **fail loudly** (explicit "requires secret X" error)
so an agent doesn't chase a phantom abstraction. Keep the small, useful registry.

**P2.4 — Fold "add a sim" into one command.** *(M, Low)*
Adding a sim today spans `scripts/new-artefact.sh` (HTML scaffold) + `aiplatform
sim scaffold` (FE wiring) + `make sim-build` + a **manual "copy Boldkast's
launcher" step** — the exact multi-tool dance two corrective skills exist to
patch. Fold into one `aiplatform sim new <name>` that does all of it and emits the
launcher stub. Update the stale `infrastructure/mcp-sandbox/README.md` (still names
`aitana-v6-frontend`, `multivac-aitana`).

**P2.5 — De-duplicate deploy smoke into one script.** *(S, Low)*
The smoke endpoint list is copy-pasted verbatim across `cloudbuild.yaml:339`,
`cloudbuild.promote.yaml:111`, `scripts/smoke-deployed.sh`, and
`cli/aiplatform/commands/smoke.py`. Make both cloudbuilds call the one script;
one list, one place.

**P2.6 — Make scripts discoverable.** *(M, Low)*
60 scripts, no index, 20 unreachable via the Makefile (incl. the whole smoke
suite). Add `scripts/README.md` (one line per script: purpose + is-it-wrapped),
a `make smoke` umbrella, and move dated one-offs (`backfill-*`, `migrate-*`,
`repair-*`, `spike_*`) to `scripts/archive/`. Make `make help` self-documenting
(grep `## ` doc-comments) so `seed`/`promote`/`provision` — currently hidden —
can't be added without appearing in help.

---

### P3 — Finish the June big rocks (god-files + ownership guard)

Carried over from the June sprint (Phase-3 items that didn't ship). Higher effort,
**but each is already gated by an existing characterization net**, so they remain
safe to cut. Sequence per the [June sprint plan](simplification-refactor-sprint.md)
(M5–M9). Best scheduled post-pilot.

- **B1 — `auth/ownership.py` load-and-assert guard.** The central missing backend
  abstraction: `load_owned(loader, id, user, kind)` / `load_readable(...)` folding
  the researcher bypass + OTel span once; migrate the 9+ inline ACL sites. This is
  the **dual-path teacher/student ACL surface broken 4+ times** — the highest-value
  backend change. Gate: backfill activities+voice ownership tests (classes covered).
- **F1 — decompose `ChatShell`** (1378 lines). Start with `useActiveActivityConfig(activityId)`
  (collapses 11 `active*` state slices + 1 fetch, ~90 lines); then `useSessionBootstrap`,
  `useChatDocTabs`, a `<DocBrowserPanel>`. Add the missing `<Suspense>` boundary.
  Net: `chat-page-characterization.test.tsx`. Gate: a Chrome-MCP before/after pass
  (`aitana-frontend-verify`) for the SSE/token-refresh/layout behaviours jsdom can't see.
- **F3+ / API-client factory** — collapse the 58 near-identical fetch wrappers
  (across 6 clients) into one `apiCall<T>`/`makeClient` factory; folds in the
  role-typed auth from P1.1. Net: `teacherApi.test.ts` (golden-master).
- **B5 — split `fast_api_app.py`** (761 lines) into `app_factory.py` / `startup_checks.py`
  / `channels/bootstrap.py`; lift `stream_skill` into `protocols/stream_routes.py`.
  Replace the 34 hand-maintained `include_router` + `# noqa: E402` import pairs with
  one iterated `ROUTERS = [...]` list. Net: `test_app_assembly.py` (route-table tripwire).
- **B4/F4 — flatten `create_agent`** (a ~390-line god-function, `adk/agent.py:343-733`,
  whose instruction is built by nesting 6 injectors inside-out). The flat helper
  **already exists** — `instruction_provider_chain.compose_instruction_providers` is
  used for the outer two wrappers; adapt the 6 inner injectors to its signature and
  fold them into one left-to-right list, and extract `_compose_callbacks(...)`. No
  behaviour change. Gate: `make eval` green before + after.
- **F5 — split `auth/group_id_auth.py`** (896 lines, the most bug-prone auth surface)
  into `group_tokens.py` (JWT crypto) / `group_store.py` (Firestore + cache) /
  `group_auth.py` (domain + the 7-gate `join_group`). Isolating crypto from storage
  from policy directly helps the dual-auth surface. Net: the exemplary 614-line
  `group_id_auth` suite already covers it.
- **F6 — split `useSkillAgent`** subscription into per-event handlers; merge the two
  error classifiers. Gate: extend per-event branch tests first (streaming core).
- **B7/B8 — service layer** for the proactive-gate tree + voice pipeline (extract
  `proactive/gates.py` + `voice/service.py`; routes become thin). Gate: `make eval`.
- **Route-file consolidation (F7) + shared `ApiModel` base (F11).** 31 route files,
  several single-endpoint (the session cluster is 4 files, activity 3, plus 5 micro
  teacher-pref/bootstrap files) — merge to ~20. One `ApiModel(BaseModel)` base
  carrying the alias `model_config` copy-pasted 28×; one shared `TranscriptMessage`
  (currently `ChatMessage` ≡ `RestoredMessage` byte-for-byte under two names).
- **Test maintainability: add `tests/api_tests/conftest.py` (F17)** — the single
  biggest test-hygiene win. 21 files redefine their own `app`/`client` inline and
  41 re-implement the `get_current_user` override; the root `conftest.py` already
  proves the team knows how to centralize. Big net-LOC cut, zero behaviour change.
  (Also narrow the exact-dict OTEL/whoami snapshot assertions in `test_proactive_telemetry.py`
  / `test_auth_whoami.py` so additive fields don't break them.)
- **State sprawl (frontend):** unify `sessionId` (currently ~5 representations,
  papered over with `sessionId ?? agentSessionId` 6×) to one `useCurrentSessionId()`;
  establish one folder convention (Contexts/Providers in `providers/`, stores in
  `stores/`, pure hooks in `hooks/`) and move the strays; merge the two
  duplicate slug-resolver and session-list hook pairs (split only by auth token —
  unblocked once P1.1 lands).

---

### P4 — Reproducible infra + human-readable handover docs

The biggest effort, and the thing a non-expert successor most needs: a repo they
can run, deploy, and understand **without M's laptop.**

**P4.1 — Converge on one infra source of truth.** *(L, High)*
Today: `scripts/bootstrap-aipla-dev.sh` (30 KB, 18 `ensure_*` functions)
provisions dev imperatively; `infrastructure/env/*.tf` (validated-not-run) is
meant to reproduce it; ~5 resources are "never Terraform" (scripted post-apply);
dev changes are hand-mirrored into TF. Finish Terraform (increment 2) as the
single source, wrap the "never Terraform" tail into one `scripts/post-apply-env.sh
<env>`, and add a `terraform plan` drift-check in CI. At minimum: cutting a fresh
env should be `terraform apply` + one documented post-apply command.

**P4.2 — Publish a scoping-site snapshot into the repo for handover.** *(M, Med)*
AIPLA design docs cite ADRs 001–015 via `file:///Users/mark/Documents/...` links
that **only resolve on M's laptop.** For handover, publish a frozen snapshot (or
PDF export) of the scoping site's *public* files into
`docs/design/aipla/_scoping-snapshot/` and replace the `file:///` links with the
public `sunholo.com/aipla/` URLs or the snapshot. (Careful: the scoping site has
private dirs that must not be copied — snapshot public files only.)

**P4.3 — Extract human runbooks from the skills.** *(M, Med)*
The 16 `.claude/skills/` encode the real operational knowledge (security triage,
artefact deploy, seeding, deploy/promote) — but only Claude-Code users can reach
it, and the handover audience won't drive Claude Code. Extract the human-relevant
runbooks into a plain `docs/ops/runbooks/` set that stands alone (deploy · promote
· seed · "what to do when the demo breaks" · security triage); have the skills
link to them so there's one source. Rename the misleading `aitana-*` skills to
`aipla-*`.

**P4.4 — Move the hardcoded admin identity out of the rules.** *(S, Low)*
`firestore.rules:25` hardcodes `mark@aitanalabs.com` as admin — a handover
landmine (admin is one person, baked into security rules). Move to a Firebase
custom claim so the successor isn't locked out.

**P4.5 — Index `v1.1.0-feedback` and finish the `implemented/` migration.** *(M, Low)*
91 flat files, doc/sprint pairs, only some moved to `implemented/`. Ensure every
doc is listed in `SEQUENCE.md` with status; finish moving shipped docs so the top
level holds only active work.

---

## What we're NOT proposing (guardrails)

- **Don't merge `fetchWithAuth` / `fetchWithTeacherAuth`.** Intentionally
  separate (group vs Firebase token); merging re-introduces the dual-auth bug.
  Make the *choice* safe (P1.1), don't remove it.
- **Don't delete the characterization tests.** They pin current behaviour to make
  the P3 cuts safe. But **re-baseline them against intended behaviour after each
  refactor lands** — they deliberately preserve some documented latent bugs, so a
  maintainer "fixing" one will see red and misread it as a regression.
- **Don't rename the `aitana_platform` ADK app-name session key.** Load-bearing
  for existing sessions.
- **Don't delete the channels code (P0.10) — quarantine it.** The pilot may wire a
  channel; deletion is reversible from the template but premature.
- **Don't chase sync-in-async Firestore I/O now.** Real but a latency concern only
  under concurrency we don't yet have; do opportunistically.

## Sequencing & safety

1. **P0 + P1 first, before the pilot** — freeze-safe, low-risk, highest handover
   leverage. Most of P0 is subtraction and can go in one focused "resolve the fork
   identity" pass.
2. **P2 alongside P0/P1** — config single-sourcing and `make help`/scripts index
   are independent and low-risk.
3. **P3 post-pilot**, in the June M5–M9 order, each behind its named net/gate.
   Verify "done" against git + code, never the sprint JSON.
4. **P4 across the handover window** — P4.1 (Terraform) is the long pole; start it
   early even if it lands late.

## Success metrics

- [ ] A newcomer can `git clone`, read `README.md`, run one command, and reach the
      app on the **correct port** — with no reference to "Aitana".
- [ ] Every skill CLAUDE.md names exists on disk (CI-checked); every Makefile
      target appears in `make help`.
- [ ] The 4×-shipped footgun classes (dual-auth, seed, trust-card, full-overwrite)
      each fail a **CI gate**, not a human's memory.
- [ ] `.env.example` + `firestore.indexes.json` describe only what's real; dead
      indexes, dead components, and frozen template docs are gone or clearly
      quarantined.
- [ ] Cutting a fresh environment is one `terraform apply` + one post-apply command.
- [ ] Zero behaviour change throughout: `npm run quality:check` +
      `make lint && make test-fast` green at every step; `make eval` == baseline
      after P3.B7/B8; Chrome-MCP before==after on chat after P3.F1.
