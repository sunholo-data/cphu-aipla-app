# Frontend client logs — the browser reports its own failures

**Status**: **Design (OPEN)** — **1.1.119**
**Priority**: **P1** — a live prod report (Aswin, 2026-09-15) could not be diagnosed *at all* because the failure never left the browser; two wrong theories were shipped against it before anyone could say "we don't know". Every silent client-side failure so far has been found by a human noticing, never by a log.
**Estimated**: ~2.5–3d (M0 ingest route ~0.5d · M1 `logger.ts` ~0.5d · M2 wiring ~0.75d · M3 ops: Terraform metric+alert, verify script, cloudbuild twins, runbook ~0.5d · M4 CLI reader ~0.25d). At the extension's 2.5 days/week, about one calendar week.
**Scope**: Backend — one new route + a structured re-emit; frontend — a logger module, two Next.js error files, and instrumentation at ~6 call sites; infra — a log-based metric and alert policy per env; CLI — one subcommand; ops — a verify script and a runbook.
**Dependencies**: none blocking. **Reuses**: the stdout-JSON → `jsonPayload` emit idiom already live for `event:"ttft"` (`backend/observability/timing.py`, verified in prod today); the dual-auth dispatcher (`auth.get_current_user`); `fetchWithAuth` / `fetchWithTeacherAuth`.
**Upstream**: the *consumer* half of this exists in `platform-source` (`cli/aiplatform/commands/logs.py` `logs client`, its tests, `docs/ops/frontend-logs.md`) and is the wire contract this doc implements. The *producer* half does not exist there — see "What upstream actually has". Once shipped here this is a **port-up candidate**: generic, no AIPLA markers, and upstream's CLI is already waiting for it.
**Created**: 2026-09-15
**Source**: this session — "*ok — just say you don't know. no logs exist. we need logs to exist.*"

## Problem Statement

> ⚠️ **Correction, 2026-09-16.** The motivating example below is **wrong in its
> load-bearing claim.** The upload *did* leave the browser: prod logs show
> `POST /api/proxy/api/documents/upload` → 200 in 4.3 s for `Doc4_compressed.pdf`
> at 12:22:58 on 2026-09-15, and the parsed row sits in prod Firestore. The
> "zero requests" finding came from a log query filtered on the group, a field
> the access-log line does not carry. The real cause was server-side and fully
> visible to anyone reading the *unfiltered* log and the Firestore row:
> `skill_id` read as a query parameter, so every upload was stored with
> `skillId=""` and the workbench could not list it (1.1.121, SEQUENCE.md). What
> *would* have been invisible to a client logger too: the request succeeded.
>
> The argument for this doc survives in a weaker form — a hung promise fires
> neither `onerror` nor `unhandledrejection`, so ERRVIS-1 (shipped the same day)
> saw nothing during the 16 Sept demo, and that class is still unlogged — but
> the **P1 was set on a false premise and should be re-decided.** The rest of
> this section is left as written, as the record of the reasoning.


A student in `busy-garden-11` tried to upload a 65 KB PDF — an allowed type,
well under any limit — into the document workbench, and nothing happened. No
error on screen. And on the server: **nothing**. Fourteen days of prod logs
show zero requests from that group ever reaching `/api/documents/upload`. The
request never left the browser.

That is not a gap in *this* feature's logging. It is structural: **the backend
can only log what reaches it, and the class of failure where the request never
fires is exactly the class it cannot see.** A JavaScript exception in a click
handler, an unhandled promise rejection, a render throw inside a workspace
surface, a stream that closes without a terminal event, a fetch the browser
refused — every one of these is invisible from Cloud Logging by construction.

The cost is not abstract. Today's triage went: image-rejection theory (wrong,
design doc written against it) → large-file theory (wrong, a size cap shipped
against it) → "we don't know". Each step was a plausible inference from the
*absence* of server-side evidence, which is a coin with only one side. The
2026-09-09 notes have the same shape: *"Aswin had session where no chat
history was persisted — `busy-garden-11`"*; the table-visibility defect was
only tracable because it happened to reach a backend log line. And the
CLAUDE.md footgun table already names this family — *"A checker answers when
it could not read its subject"* — from the server side. This is the client
side of the same rule: **a healthy-looking absence of logs must be
distinguishable from a logger that never ran.**

### Why not just wrap the upload in a try/catch that logs?

Because the next one will not be the upload. The A2UI surface that fails to
render, the sim iframe whose `postMessage` bridge throws, the AG-UI stream that
ends mid-turn on a proxy cut — none of them share a call site. One general
pipeline with a fixed event vocabulary is the fix; per-feature logging is the
anti-pattern the design-doc discipline warns about ("v2: bug! add special case
for B").

## Goals

1. Any error the browser catches — boundary, unhandled rejection, stream
   terminal failure, a failed workbench call — reaches Cloud Logging as a
   structured line joined to the same `uid` / `sessionId` the backend's own
   lines carry, so one `--session` query tells the whole story from both ends.
2. `ERROR`-severity events group by stack in Error Reporting and alert on a
   rate, so a regression on a shipped fix pages someone before a teacher
   writes in.
3. A one-command way to prove the pipeline is alive on an environment,
   because *"no events for this user"* must never be mistaken for *"the logger
   is running and nothing failed"*.
4. The wire contract matches upstream's already-built reader byte for byte, so
   the CLI ports without adaptation and the work ports up without a rewrite.

## Non-goals

- Replacing the research telemetry path (`reportDocumentEvent` →
  `/api/sessions/{id}/doc-event`). That is *evidence* for researchers, captured
  for records, never a tutor input, with its own retention rules. This is
  *ops* for on-call. Different audience, different retention, deliberately
  separate — the doc-event path stays exactly as it is.
- Session replay, RUM, or performance timing from the browser. `ttft` is
  measured server-side already; this ships failures only.
- Logging on healthy sessions. The client ships `WARN`/`ERROR` only. A quiet
  session produces zero lines — by design, and the verify script exists
  precisely because of that.

## What upstream actually has — verified, not assumed

Checked against a fresh `git fetch upstream` (`platform-source`, branch `dev`,
2026-09-15). Every claim below is a `git show` / `git grep` result:

| Artefact | Upstream `dev` | Notes |
|---|---|---|
| `cli/aiplatform/commands/logs.py` — `logs client` reader + `--emit` probe | **present** | The wire contract lives here: paths, body shape, response shape, filter fields |
| `cli/tests/test_cli_logs_client.py` | **present** | Pins the 50-event cap → `413`, the `{accepted, dropped, droppedFields}` response, the forge-uid negative probe |
| `docs/ops/frontend-logs.md` — runbook | **present** | Event vocabulary, volume caps, kill switch, "what the logs cannot tell you" |
| `frontend/src/lib/logger.ts` | **absent** | `git ls-tree` — no `lib/logger.ts` anywhere |
| `POST /api/client-logs` backend route | **absent** | `git grep "api/client-logs"` hits only the CLI, its test, and the runbook |
| `docs/design/v6.41.0/frontend-observability.md` | **absent** | The runbook links it; `git show` — path does not exist |
| `scripts/verify-client-logs.sh` | **absent** | Same |

The runbook says the pipeline has been *"live on dev, test and prod as of
2026-09-05."* On the evidence, the reader shipped and the producer did not —
or shipped on a branch that never reached `dev`. Either way: **there is
nothing to port down.** This doc builds the producer to the contract the
reader already encodes, which is a better starting point than a blank page and
the reason the estimate is days, not a week.

## Wire contract (from upstream's reader — this is what the route must accept)

```
POST /api/client-logs            Authorization: Bearer <group JWT | Firebase ID token>
{
  "events": [
    {
      "timestamp":    "2026-09-15T13:26:29.456Z",      ISO 8601
      "severityText": "ERROR",                          DEBUG | INFO | WARN | ERROR
      "body":         "upload_failed",                  short string; the event name for INFO/WARN
      "attributes": {
        "event":        "upload_failed",                required — the vocabulary key
        "route":        "/chat/ee367959-…",             window.location.pathname
        "skillId":      "ee367959-…",
        "sessionId":    "fd8defd7-…",                   the chat session — joins to backend lines
        "threadId":     "…",
        "errorName":    "TypeError",
        "errorMessage": "Failed to fetch",
        "stack":        "TypeError: Failed to fetch\n    at …",
        "componentStack": "…",                          boundary catches only
        "attempt":      2,
        "droppedCount": 17                              logger_dropped only
      }
    }
  ]
}

200 {"accepted": 1, "dropped": 0, "droppedFields": 0}
413 "batch has 51 events; max is 50"                    refused WHOLE, not truncated
429 when a uid exceeds 100 events / minute
```

Rules the reader's tests pin, which the route must honour:

- **The token's `uid` is logged. The body's `uid` / `userId` are dropped and
  counted in `droppedFields`.** (`--forge-uid` negative probe.) A client cannot
  write another user's — or another group's — line.
- **Unknown attribute keys are dropped and counted**, never passed through.
  The allow-list above is the privacy guard: there is no key under which a
  request body, a chat message, or a document's text can ride along.
- **`INFO` never reaches Error Reporting.** Only `ERROR` carries the Error
  Reporting envelope; `WARN` is a plain structured line.
- Cloud Logging's severity word is `WARNING`; the client's is `WARN`. The
  route maps.

## Solution Design

### M0 — Backend: `POST /api/client-logs` (`backend/protocols/client_log_routes.py`)

Follows the `*_routes.py` convention beside `activity_image_routes.py` and
`recording_routes.py`.

- **Auth**: `from auth import User, get_current_user` — the dispatcher, so a
  group JWT and a Firebase token both authenticate. This is the CLAUDE.md #1
  footgun and `scripts/check-auth-dispatcher.sh` enforces it in CI. It matters
  more here than anywhere: the surfaces where failures go unseen are the
  *student* ones, and a teacher-only route would `401` every student and log
  nothing — reproducing the exact blindness this doc exists to end.
- **Validation** (Pydantic): ≤ 50 events per batch else `413` with upstream's
  exact message; per-event `severityText ∈ {DEBUG, INFO, WARN, ERROR}`;
  attribute allow-list applied per event, unknown keys counted into
  `droppedFields`; `stack` / `errorMessage` truncated at 8 KB / 2 KB; total
  body ≤ 64 KB (Cloud Run's default is far larger — this is our cap, not the
  platform's).
- **Rate limit**: 100 events / minute / uid, in-process token bucket keyed by
  `user.uid`. Over-limit → `429` and the events are dropped (counted in the
  response). In-process is deliberate: the goal is to stop one broken tab from
  flooding, not to be exact across instances. *(Same shape as the spend gate's
  reasoning in 1.1.94: a limiter that has to consult Firestore to say no is a
  limiter that fails open on a blip.)*
- **Re-emit**: one single-line JSON object on stdout per accepted event —
  **the `timing.py` idiom, not `logger.info(extra=…)`.** `timing.py`'s comment
  records why: this app runs a plain text formatter (OTEL owns the root
  handler), so `extra={"json_fields": …}` is *dropped at the formatter*, and
  30 days of prod `ttft` rows lost their per-stage marks that way until
  2026-09-08. Cloud Run parses a stdout JSON line into `jsonPayload` honouring
  `severity` and `message`. Verified live in prod today: `jsonPayload.event="ttft"`
  on container `sidecar`. Each line carries:

  ```
  source:"browser"  severity  message  event  uid  email  sessionId  threadId
  skillId  route  errorName  errorMessage  stack  componentStack  attempt
  droppedCount  clientTimestamp  serviceContext:{service:"browser", version}
  ```

  `message` is the event name for `INFO`/`WARN`; for `ERROR` it is the
  **stack** (with `errorName: errorMessage` as its first line) — that is what
  Error Reporting groups on, and why the `--emit` probe puts the nonce in the
  stack. `serviceContext.version` is stamped **by the backend from its own
  `APP_VERSION`** (already set per env by `cloudbuild.yaml` and re-stamped by
  promote) — the sidecar and the UI ship in one revision, so the backend's
  version is the browser's, and nothing new has to reach the bundle.
- **Tests**: `tests/api_tests/test_client_logs.py` — cap, allow-list,
  forge-uid, severity mapping, `INFO` carries no `serviceContext`. **Plus one
  case in `tests/api_tests/test_dual_auth_rejection.py`**: a *real* minted
  group token through the *real* dispatcher. The footgun table is explicit
  that a route test which `dependency_overrides` the auth symbol passes in
  lockstep with the wrong-import bug; only the real token witnesses it.

### M1 — Frontend: `frontend/src/lib/logger.ts`

A module-level singleton, no React dependency, importable from anywhere
(hooks, boundaries, plain event handlers).

- `logger.warn(event, attrs)` / `logger.error(event, error, attrs)`. Nothing
  below `WARN` is shipped; `logger.info` exists for symmetry but is
  console-only.
- **Queue**: in-memory, max 200; when full, drop the oldest and enqueue one
  `logger_dropped { droppedCount }` in its place (so the loss is itself
  visible — upstream's vocabulary).
- **Flush**: every 5 s if non-empty, immediately on the first `ERROR`, on
  `visibilitychange → hidden` and on `pagehide`. Batches of ≤ 20 events /
  ≤ 48 KB per POST (the server cap is 50; the client stays well under it so a
  burst never trips a whole-batch refusal).
- **Transport: `fetch(…, { keepalive: true })`, not `navigator.sendBeacon`.**
  `sendBeacon` cannot set `Authorization`, and the route is authenticated —
  so it would `401` on every unload flush. `keepalive` fetch carries headers
  and survives page unload (64 KB body ceiling, which is why the batch cap is
  48 KB). Verified: no existing `keepalive` fetch in the tree, so this is the
  first — note it in `apiClient.ts`.
- **Token**: the logger needs the *right* token for the surface, and it lives
  in `lib/` outside both eslint `no-restricted-imports` fences. It therefore
  does not import either helper. Instead the two auth providers each register
  a token getter on mount (`logger.setTokenSource(() => getIdToken())` in the
  group context, `logger.setTokenSource(() => firebaseUser.getIdToken())` in
  the teacher context); whichever is mounted wins. No token registered → the
  event is held (up to the 200 cap), and dropped on unload with a
  `console.warn`. **Known gap**: a failure on the join page, *before* a group
  token exists, is still invisible. Recorded as open question 1 — it is the
  surface behind the "group code on the wrong environment" footgun that cost
  a teacher two hours, so it is not academic.
- **Kill switch**: `NEXT_PUBLIC_CLIENT_LOGGING=off` degrades to console-only.
  Build arg `_CLIENT_LOGGING` in **both** `cloudbuild.yaml` and
  `cloudbuild.promote.yaml` — the footgun table's "needs a promote twin" row,
  bitten three ways already.
- **Global hooks** installed once from the root layout: `window.onerror`,
  `window.onunhandledrejection`. Both de-duplicated (same `errorName` +
  first stack frame within 10 s → one event with `attempt` incremented) so a
  render loop cannot produce 200 identical lines.
- **Tests**: `lib/__tests__/logger.test.ts` — queue cap + `logger_dropped`,
  batch splitting at 20 / 48 KB, flush triggers, `keepalive: true` on the
  unload path, token-source precedence, kill switch, de-dup window.

### M2 — Wiring: where the events come from

AIPLA's vocabulary, adapted from upstream's. Each row is one call site and
one test.

| Event | Severity | Where | Why this one |
|---|---|---|---|
| `app_error` / `app_global_error` | ERROR | **new** `app/error.tsx` / `app/global-error.tsx` — ⚠️ **update 2026-09-16: both now exist** (1.1.96 M-1 landed via `90057bd3`, reporting through the unauthenticated `POST /api/client-errors` → `aipla_client_error`). This doc's plan should **build on them, not re-create them**: either re-point the boundary reporting at the dual-auth logger, or keep M-1's path for the pre-auth window and route post-auth render throws through the logger — decide at implementation, but there is exactly one reporter per surface | A render throw anywhere in the tree currently logs via M-1's reporter; what is still missing is the uid join, the BigQuery/Error-Reporting routing and the alert. `digest` joins to the server log for a Server Component error. The boundary does **not** print `error.message` on screen (it may quote a student's document or message); the log has it |
| `workbench_call_failed` | ERROR | `StudentDocumentWorkbench.tsx` — the `catch` in `onPickFile` / `onDelete` / `refresh`, and `documentApi.ts` on a non-ok response | **The trigger.** `attrs: { op: "upload"\|"list"\|"delete", status, fileSize, fileType }` — never the filename (a student may name a file after themselves) |
| `stream_run_failed` / `stream_error` / `stream_truncated_no_terminal` | ERROR | `useSkillAgent.ts` — the AG-UI run's terminal handling | A stream that ends without `RUN_FINISHED`/`RUN_ERROR` is the "tutor just stopped" report with nothing behind it. `attrs: { kind, status, retryable }` |
| `surface_render_failed` / `surface_process_messages_failed` | ERROR | the A2UI surface boundary (`MarkdownErrorBoundary` in `MarkdownBody.tsx` is the existing shape — extend it to report, and add the same around the A2UI registry) | The recurring "workspace stayed empty" class; `componentStack` names the component |
| `sim_bridge_failed` | ERROR | `useSimSnapshotPush.ts` and the `GenericArtefactFrame` `postMessage` handler | **AIPLA-specific** — upstream has no sims. A bridge message that throws is "the tutor can't see what I did in the sim", which the `workbench-element-builder` skill exists because of |
| `auth_token_missing` | WARN | `fetchWithAuth` / `fetchWithTeacherAuth` when about to send with a null token | The dual-auth footgun's signature (*a student calls a teacher helper → null token → 401*). Today it surfaces as a 401 on the server with no hint which helper was wrong; this names the helper and the route |
| `logger_dropped` | WARN | the logger itself | Loss made visible |
| `verify_probe` | any | `scripts/verify-client-logs.sh` / `aiplatform logs client --emit` | Synthetic; exclude from real counts |

### M3 — Ops: metric, alert, verify, runbook

- **Terraform** (`infrastructure/env/`, per env, via `make tf-apply`): a
  log-based metric `aipla_browser_client_errors` (filter
  `jsonPayload.source="browser" AND severity>=ERROR AND NOT jsonPayload.event="verify_probe"`,
  labelled by `event`) and an alert policy on it — threshold 5 in 5 min,
  notification rate-limited to one per 5 min, to the existing on-call channel.
  **The 1.1.106 lesson applies in full**: the billing budget was *"committed
  in Terraform and enabled on no environment."* Committing this is not
  deploying it; `verify-client-logs.sh` asserts the metric exists on the env
  it runs against, so the alert cannot silently be missing.
- **`scripts/verify-client-logs.sh <env>`** (+ `make verify-client-logs ENV=`):
  mints a token via `scripts/aiplatform-admin.sh`, then through
  `aiplatform logs client --emit`: one `ERROR` probe → found by nonce in Cloud
  Logging within 60 s, on container `sidecar`, `source="browser"`, uid = the
  token's; `--severity INFO` probe → found, *without* `serviceContext`;
  `--forge-uid` probe → logged uid is the token's; `--count 51` → `413`;
  metric exists. Upstream's runbook says 16 checks; ours will be whatever
  count these come to, stated in the script.
- **`docs/ops/frontend-logs.md`** — upstream's runbook ported with AIPLA
  names (`aipla-{env}-2026`, `aipla-v01-frontend`, `sidecar`, the AIPLA event
  rows above) and its triage ladder kept intact: *start from the person* →
  join on `sessionId` → how widespread → prove the pipeline before blaming
  the app. Add a "Kill switch" section and the AIPLA-specific "what the logs
  cannot tell you" (pre-join failures).
- **Cloud Build**: `_CLIENT_LOGGING` build arg on **both** pipelines
  (`make check-cloudbuild` runs in CI and will not catch a *missing* twin —
  only a malformed one — so this is a review item, listed in the PR
  checklist).

### M4 — CLI: `aiplatform logs client`

This fork's `logs` is a plain click group (`tail` / `session` / `schema` /
`verify` — the chat-log pipeline) with no bare invocation, so `client` slots
in without collision. Port upstream's `logs_client` command + `_build_browser_filter`
+ `_probe_events` and their tests; adapt the target resolver to this CLI's
existing `project = f"aipla-{env}-2026"` (`cli/aiplatform/http.py`), service
`aipla-v01-frontend`, container `sidecar`. Upstream's `cli/config.yaml`
`logging:` block does not exist here and is not needed.

## Privacy — what can and cannot ride on this path

- `uid` for a student is the group-synthetic `anon-<groupId>` (ADR-001) —
  group-level, never a person. Same as every other backend line.
- The attribute allow-list is the guard. There is no key for a body, a chat
  message, or document text; `stack` and `errorMessage` are truncated; the
  boundaries never print `error.message` on screen. `workbench_call_failed`
  carries `fileSize` / `fileType`, **not** the filename.
- Retention: Cloud Logging `_Default` bucket, 30 days — the same as every
  other line, no new store, nothing for [1.1.80 group-erasure-cascade](group-erasure-cascade.md)
  to cover beyond what it already does for backend logs.
- Nothing here is a tutor input. The route writes to stdout and returns; it
  touches no session state, no Firestore, no artifact. (The literature-corpus
  isolation guard is the model: structural, not a policy.)

## Conflict Surface

| Touches | Existing behaviour | Decision |
|---|---|---|
| `auth.get_current_user` | Dual-audience dispatcher | **reuse** — import from `auth`, CI-enforced |
| stdout JSON → `jsonPayload` | `timing.py` writes `ttft` lines this way behind `_STRUCTURED_LOG` | **reuse the idiom**, extract a tiny `observability/structured.py: emit_json_line(payload)` and have `timing.py` call it too — one emitter, not two. If `_STRUCTURED_LOG` is off, fall back to `logger.warning` so the line still exists as text |
| `apiClient.ts` `fetchWithAuth` / `fetchWithTeacherAuth` | Each surface's helper mints its token | **reuse via registered token source**; do not import either from `lib/logger.ts` (would breach the eslint fence). Add the `auth_token_missing` WARN inside the helpers themselves |
| `MarkdownErrorBoundary` (`MarkdownBody.tsx`) | Catches a markdown render throw, shows a fallback | **extend** — report from `componentDidCatch`; keep the fallback UI unchanged |
| `reportDocumentEvent` (`documentApi.ts`) | Research telemetry, best-effort, swallows its own failures | **untouched, and explicitly separate** — see Non-goals |
| Next.js `app/error.tsx` / `global-error.tsx` | **now present** (1.1.96 M-1, 2026-09-16 — were absent when this doc was written; its problem-statement examples remain valid) | **extend, don't re-create**: M-1's boundaries report through the unauthenticated `/api/client-errors`; re-point them at the dual-auth logger once it exists (global-error keeps the unauthenticated path — it renders without providers, so it has no token to mint) |
| `cloudbuild.yaml` build args | `_AIPLA_HELP`, `_AUTHORING_COPILOT`, `_CONCEPT_MAP` each have a promote twin | **add `_CLIENT_LOGGING` to both** |
| `make deploy-status` / smoke | `smoke-deployed.sh` drives a real group-token upload | **add** one `logs client --emit` + read-back to the smoke, so a deploy with a dead pipeline reds the build |
| Cloud Run request logs | The `httpRequest` access line is already there for every request that *arrives* | unchanged — this pipeline covers what never arrives |

**Programs that must still work**: every existing `fetchWithAuth` call
(unchanged signature); `ttft` lines (same emitter, same fields); the
`test_dual_auth_rejection.py` suite (gains a case, loses none).

## Files to modify

- `backend/protocols/client_log_routes.py` (new) — route, validation,
  allow-list, rate limit, re-emit. ~180 LOC.
- `backend/observability/structured.py` (new) — `emit_json_line`, extracted
  from `timing.py`. ~30 LOC. `timing.py` −15.
- `backend/fast_api_app.py` — mount the router. ~3 LOC.
- `backend/tests/api_tests/test_client_logs.py` (new) ~150 LOC;
  `test_dual_auth_rejection.py` +1 case.
- `frontend/src/lib/logger.ts` (new) ~200 LOC; `lib/__tests__/logger.test.ts`
  (new) ~150 LOC.
- `frontend/src/app/error.tsx`, `frontend/src/app/global-error.tsx` (new)
  ~30 LOC each; `route-chrome-coverage.test.ts` may need to know they are not
  pages.
- `frontend/src/app/layout.tsx` — install global hooks. ~5 LOC.
- `frontend/src/lib/apiClient.ts` — `auth_token_missing` in both helpers. ~10 LOC.
- `frontend/src/contexts/*` (group + teacher auth providers) — register the
  token source. ~4 LOC each.
- `frontend/src/components/workspace/StudentDocumentWorkbench.tsx`,
  `lib/documentApi.ts`, `hooks/useSkillAgent.ts`, `hooks/useSimSnapshotPush.ts`,
  `components/workspace/MarkdownBody.tsx`, the A2UI registry — one `logger.error`
  each. ~5 LOC per site.
- `infrastructure/env/observability.tf` (new) — metric + alert. ~60 LOC.
- `scripts/verify-client-logs.sh` (new) ~120 LOC; `Makefile` +1 target;
  `scripts/smoke-deployed.sh` +1 check.
- `cloudbuild.yaml`, `cloudbuild.promote.yaml` — `_CLIENT_LOGGING`. ~4 LOC each.
- `cli/aiplatform/commands/logs.py` +`client` subcommand ~120 LOC;
  `cli/tests/test_cli_logs_client.py` (ported) ~100 LOC.
- `docs/ops/frontend-logs.md` (new, ported). CLAUDE.md: one row in the
  footgun table (*"A client-side failure never reaches the server"* →
  **enforced** by the smoke's emit-and-read-back).

## Success criteria

- [ ] `aiplatform --env dev logs client --emit` then `logs client -g <nonce>`
      finds the probe within 60 s, uid = the token's, container `sidecar`.
- [ ] The same with a **group** token (via `scripts/aiplatform-admin.sh` on
      a demo code) — the student path, not only the teacher path.
- [ ] Re-running the exact 2026-09-15 scenario with `fetch` stubbed to throw
      in `StudentDocumentWorkbench` produces one `workbench_call_failed`
      line carrying `op:"upload"`, `sessionId`, `fileSize`, `fileType` and
      the stack — and **no filename**.
- [ ] A thrown render in a workspace element produces one
      `surface_render_failed` with `componentStack`, and the chat survives.
- [ ] Killing the stream mid-turn (proxy restart) produces
      `stream_truncated_no_terminal`.
- [ ] `--count 51` → `413`; `--forge-uid` → token's uid logged; `--severity INFO`
      → no `serviceContext`.
- [ ] Error Reporting shows service `browser` grouping by stack on dev.
- [ ] The alert policy exists on dev, test **and** prod (`verify-client-logs.sh`
      asserts it) and fires once on a deliberate 6-error burst.
- [ ] `NEXT_PUBLIC_CLIENT_LOGGING=off` build → zero POSTs, console output only.
- [ ] `make check-auth-dispatcher`, `make check-cloudbuild`, backend + frontend
      CI-parity suites green.
- [ ] `docs/ops/frontend-logs.md` published; CLAUDE.md footgun row added.
- [ ] `make check-upstream-routing` classes the new files as template
      candidates (bucket A/C, no AIPLA markers except `sim_bridge_failed`,
      which is documented as the one fork-specific event).

## Open questions

1. **Pre-authentication failures.** A join-page error has no token and is
   dropped. Options: (a) accept it (v1); (b) an unauthenticated lane with a
   tight IP-based limit (10/min) and `uid:"anonymous"`, `ERROR` only; (c)
   mint a short-lived visitor token on page load. **Recommend (a) for v1 with
   (b) as the first follow-on** — the join surface is where the
   wrong-environment footgun lives, so it should not stay dark for long, but
   an unauthenticated write path deserves its own review.
2. **Alert routing.** Upstream emails "the on-call channel". AIPLA's on-call
   is M until AD starts (~2026-10-01) and then the two of them. Confirm the
   channel with M before the Terraform lands — a policy that notifies nobody
   is the billing-budget failure again.
3. **De-dup window.** 10 s / same `errorName` + first frame is a guess at
   "one render loop = one line". Tune after a week of dev data.
4. **Port-up timing.** Upstream's reader and runbook are waiting for exactly
   this producer. After a week live on AIPLA prod, `make port-up` the
   generic files (everything except `sim_bridge_failed` and the Terraform)
   and update `UPSTREAM_PINNED`. That closes upstream's own half-shipped gap
   and is the reason to keep `sim_bridge_failed` in its own clearly-marked
   block.

## Related

- [student-image-in-document-workbench.md](student-image-in-document-workbench.md)
  (1.1.117) — the design that was written against the wrong theory of the
  same report; its Problem Statement records the sequence.
- [security-monitoring-pipeline.md](implemented/security-monitoring-pipeline.md) — the
  other "make the invisible visible" pipeline in this batch; same shape
  (metric → alert → runbook → verify), different subject.
- [cloud-cost-envelope.md](cloud-cost-envelope.md) (1.1.106) — the
  "committed in Terraform, enabled nowhere" precedent that shapes M3.
- CLAUDE.md → *Footguns & their guards* → "A checker answers when it could
  not read its subject" — this doc is that rule's client-side half.
