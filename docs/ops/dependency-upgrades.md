# Dependency upgrade notes

## Security-only production candidate — 2026-10-26

The compatible Zod and OpenTelemetry backports, dependency patch versions,
verification evidence and production hold are recorded in
[security-2026-10-26.md](security-2026-10-26.md). The production-only candidate
retains ADK 1.31.1 and does not promote the ADK 2 migration described below.

## OpenTelemetry security fix — 2026-10-23

`opentelemetry-api` 1.38.0 was affected by
[CVE-2026-114603](https://github.com/open-telemetry/opentelemetry-python/security/advisories/GHSA-xcq7-p3pf-p88h):
quadratic parsing of an inbound `tracestate` header could block a worker.
The first patched release is 1.45.1.

ADK 1.x cannot simply take that patch: its telemetry setup imports the Events
API removed by OpenTelemetry 1.44. The compatible stack uses:

- `google-adk[gcp,db,a2a]` 2.12.0, with the same version range for evals.
  The extras retain integrations that ADK 2 made optional.
- `ag-ui-adk` 0.10.0 and its required `a2ui-agent-sdk` 0.2.2. A2UI 0.2.3
  and 0.2.4 reference an unimported `models` name during module import;
  0.9 changes the SDK interface used by this application.
- OpenTelemetry API and SDK 1.45.1 together. uv resolves the matching
  instrumentation, semantic conventions and OTLP exporter packages.

ADK 2.12 still declares an OpenTelemetry ceiling of 1.42.1. The two explicit
`tool.uv.override-dependencies` entries bypass the declared API/SDK bounds;
other telemetry packages retain their normal constraints. Remove these overrides when ADK's
published constraints permit 1.45.1 or newer. Revalidate the telemetry imports,
stream lifecycle, backend suite and live agent evals when changing this stack.

The newer chat bridge keeps a ContextVar token across stream yields. Heartbeat
and progress polling now iterate and close each upstream generator in one
producer task, with a bounded queue for backpressure. Creating a task for every
`anext` caused token-reset errors when a student stream finished.

Regression coverage checks real oversized-header rejection, normal trace
propagation, cloud telemetry imports, and stream cleanup on completion,
disconnect and failure. The dependency audit retains its existing policy;
no exception was added for this vulnerability.

ADK 2 sends cloud telemetry through `telemetry.googleapis.com`. The API was
already enabled in dev and test on 2026-10-23; it is now also declared in the
environment API list and bootstrap script. The existing Cloud Trace Agent role
includes `telemetry.traces.write`. No IAM grants were changed.

## Pre-production review — browser Origin and upstream status

The original `v0.1.102` smoke checks omitted browser Origin headers. A real
browser write to the public frontend was therefore rejected by ADK's sidecar
Origin middleware even though CLI chat and history checks passed.

The fix originated in
[Aitana-Labs/platform](https://github.com/Aitana-Labs/platform/commit/1dd05369047a40aace13d6f3f02dcef7a603c9ae).
Its shared-source port,
[platform-source#76](https://github.com/sunholo-data/platform-source/pull/76),
was still open on 2026-10-23. It was not present in the AIPLA proxy.
The shared proxy now drops the browser Origin on the server-to-sidecar hop
and preserves Authorization. Real-HTTP regression tests cover all four write
methods. Branch deployments, production promotions and the standalone smoke
script now require a browser-shaped anonymous write to reach auth (401),
rather than fail the sidecar's Origin check (403).

Upstream's current default branch is `dev`, at `9f6a2088` when reviewed. It
still pins ADK 1.39.1 and has a separate ADK 2 migration project; this fork's
OpenTelemetry fix is not a merged upstream upgrade. The routing script now
reads `UPSTREAM_BRANCH` from `.template-fork-target`, which was still pointing
to the retired `main` branch. The last full reconciliation pin is unchanged.

Additional pre-production evidence on 2026-10-23:

- The production-built frontend, connected locally to the upgraded test
  backend, passed browser-Origin authentication and a real tutor turn through
  the installed `@ag-ui/client` 0.0.52. The client parsed the terminal event
  and the resulting assistant message; session history was readable afterward.
  This verifies the exercised chat path without assuming that backend and
  frontend package version numbers must match.
- An isolated environment using production's `v0.1.99` lockfile and ADK 1.31.1
  successfully read four events, including user and model content, from that
  ADK 2 test session via the real Vertex session service. This proves history
  read compatibility; it does not constitute a full application rollback drill.

The deeper contract review found two further ADK 2 issues before promotion:

- Protocol 1.0 models JSON Patch operations. Omitting all `None` fields also
  omitted the required `value` of a null-valued add/replace/test operation.
  The event serializer now preserves the complete delta while omitting null
  optional envelope fields. Regression tests cover add, replace, test and
  remove; the installed frontend client successfully applies the backend's
  serialized null replacement.
- ADK 2 infers `parameters_json_schema` for FunctionTool. The catalogue-based
  `control_sim` tool also set `parameters`, producing a declaration with both
  mutually exclusive fields. A real request to the configured evaluation
  model rejected that declaration with HTTP 400 and accepted the corrected
  single-schema declaration. Tests cover view, scaffold and restrict levels.

The `v0.1.103` app builds were cancelled before deployment so that candidate
could not overwrite the complete correction. `v0.1.104` replaces it and
includes the Origin fix and both additional protocol/schema corrections.
The completed local backend gate passed 5,004 tests, and all six live lesson
opening evaluations passed again with the existing models.

## Dev migration gate — 2026-10-23

The researched plan is upstream's
[ADK 2 upgrade hub](https://github.com/sunholo-data/platform-source/blob/dev/docs/design/template/template-adk-2-upgrade.md),
especially its blocking
[Phase 0 regression gate](https://github.com/sunholo-data/platform-source/blob/dev/docs/design/template/template-adk-2-regression-gate.md).
AIPLA's security-driven jump skipped that staged sequence. Passing the initial
unit suite and opening evals did not satisfy the plan. This review restores
the relevant gates on dev; it does **not** authorize a production promotion.
Do not create a release tag for this work: tags also deploy the production sandbox.

Additional defects reproduced and corrected during this review:

- The patched A2UI React SDK changed the Basic catalog URL. Backend and saved
  surfaces still use the original URL. Register both names against the same
  installed components and patched functions. Real SDK render tests failed
  before the fix and pass for inline chat, workspace state and button actions.
  This adapts the compatibility fix in
  [upstream PR 83](https://github.com/sunholo-data/platform-source/pull/83).
- Large tool responses returned artifact pointers without awaiting the save.
  Real Runner + artifact-service tests reproduced the missing content. The
  save and callback composition now await completion before returning a pointer.
  This was a latent defect missed by the synchronous mock tests.
- A content-free model error became a successful empty chat turn. Port the
  upstream empty-run guard and enforce exactly one terminal event, last on
  the wire. Queued progress must follow RUN_STARTED and precede the terminal.
- Repeated real simulation turns exposed Gemini's soft
  `MALFORMED_FUNCTION_CALL` response. It is not an HTTP request-validation
  error and previously bypassed exception-based retry. Allow one regeneration
  on the **same** model before visible output, with a request-local schema
  correction hint. Preserve the original/shared instruction config. Never
  retry after text or a tool call, and never execute a tool twice. Persistent
  failures become a visible error. Existing HTTP 400 behavior is unchanged.
  Ten successive live simulation commands passed with the corrected path.
- The public MCP smoke resolved an unbounded SDK and accidentally installed
  MCP 2, whose transport alias had changed. Bound it to the deployed MCP 1
  major; MCP 2 remains a separate upgrade as the plan requires.

| Plan seam | AIPLA evidence / applicability |
|---|---|
| Real Runner contracts | `make adk-conformance`: callback ContextVar isolation, parallel calls, model-error finality, unknown-tool recovery, instruction literals, replacement usage/stream flags, create-before-append, cancellation, artifact saves, real compaction, telemetry, JSON Patch nulls and simulation schemas. All also run in normal CI. |
| Instruction/metadata changes | Accept ADK 2's literal `${var}` and `\{var}` behavior, and preservation of usage/stream flags on replacement. The agent factory uses callable instruction providers; no skill/model defaults changed. |
| Unknown tool callback balance | ADK 2 calls before-tool and on-error, without after-tool for a missing tool. AIPLA's before hook sets labels/span attributes, not an open paired span. The real bridge test proves recovery with text and one terminal event; no after-hook resource is required for a tool that never ran. |
| Transfers / greeter / confirmation | The template's greeter handoff architecture is absent here. AIPLA uses per-activity tutors and AgentTool specialists; their existing API/tool tests remain part of the full gate. A live specialist/authoring journey still needs separate sign-off before promotion. |
| Real deployed journeys | `scripts/check-adk-dev.mjs` uses the installed client, browser Origin headers and a synthetic teacher-owned class. It checks concurrent joins, separate activity sessions, workspace state, repeated tutor/simulation turns, terminal order, persisted history and reload/restore. It fails on an unverified command or empty response. Run again against the new dev revision; this is an HTTP/client gate, not a visual browser pass. |
| Cross-version sessions | `backend/scripts/adk_session_roundtrip.py`: production-lock ADK **1.31.1** creates three tool turns, state and GCS artifacts on **dev** (12 events); **2.12.0** reads everything and appends (16 events); **1.31.1** reads the new data and continues again (20 events). Passed in both directions. This proves the exercised storage/tool continuation, not a full old-container application rollback. |
| Compaction | A real App/Runner forces compaction with our FidelityEventSummarizer, persists the summary, and continues with a tool finding retained. Threshold/config/isolation tests also remain green. A production-scale long-session soak is still required. |
| Teaching behavior | Live document/task grounding, named-paper disambiguation, workbench referral, non-answer/checklist guard, concept boundaries and verbosity exercised with dev model credentials. One concept-boundary lexical check failed then passed on rerun; record that variability rather than claiming a stable comparative baseline. The verbosity harness needed a real artifact service and ADC fixture. |
| Browser and authoring | CUA reported no browser available in this session. Real React render/action checks pass; teacher editor, student workbench, diagram/sim authoring and visual responsive checks remain release gates. |
| Telemetry | Real trace propagation, hostile tracestate deadline, ADK cloud-telemetry import and dev TTFT logs checked. Full dashboard/metric and old-vs-new latency/token baselines remain to be compared; the OpenTelemetry override still needs monitoring. |

Reproduce the storage drill by running the script's `seed`, `upgrade`, then
`rollback` phases with one private `--fixture` file. `seed`/`rollback` enforce
ADK 1.31.1 and `upgrade` enforces ADK 2; resource selection is hard-coded to dev.
The two old-SDK phases use an isolated environment resolved from the production
lockfile, never an in-place dependency downgrade of this checkout.

Local validation for this change passed backend lint/format and **5,016 fast
tests** (4 skipped, 8 slow deselected), the frontend quality gate (**2,679
tests** and production build), the focused real-Runner contracts, and ten
successive live simulation commands with the unchanged configured model.

For deployed journeys, mint the existing **dev** test teacher token to a private
file using `scripts/mint-test-teacher-token.sh dev`, then run:

```sh
AIPLA_DEV_TEACHER_TOKEN_FILE=/private/path/token \
  node scripts/check-adk-dev.mjs /private/path/synthetic-fixture.json
```

The fixture contains synthetic resource IDs and run evidence, not tokens.
Retain it for post-deploy comparison; soft-delete only those synthetic activities
and their class when the migration review is complete. A failed check remains a
failed check: the initial v0.1.104 deployed simulation sequence produced a
canonical `MALFORMED_FUNCTION_CALL` and blocked the live gate.

**Production hold:** complete the remaining live/visual/specialist checks,
comparative behavioral/telemetry baseline and soak; review this evidence with
the owner before any release tag or promotion. The security backport upstream
is a separate draft PR, not proof that upstream has completed ADK 2 adoption.
