# ERRVIS-1 — sprint plan for client error reporting (1.1.96 M-1)

**Design doc**: [teacher-ui-friction-telemetry.md](teacher-ui-friction-telemetry.md) — milestone **M-1**
**Sprint id**: `ERRVIS-1`
**Created**: 2026-09-02
**Status**: **SHIPPED 2026-09-02** — all four steps. 37 new backend tests, 32 new frontend tests, `make lint` + `npm run quality:check` green.
**Target**: land on `dev` standalone. M-1 is the one milestone of 1.1.96 with **no gate at all** — no legal blocker, no "tell teachers" decision, no dependency on M0's event enum.
**Velocity basis**: last 7 days — 44 commits, 339 files, ~18k insertions. A single-milestone fullstack slice of this shape (one emitter + one route + one lib + two components + tests) has landed inside a day repeatedly (1.1.29 signals, 1.1.45 M5 doc-events).

## Sprint goal

**A JavaScript exception in a teacher's browser stops being invisible.**

It was completely invisible. Verified 2026-09-02 in this worktree, before the build:

- `frontend/package.json` has no error-reporting dependency. No Sentry, no PostHog.
- The only `ErrorBoundary` in the codebase is `MarkdownErrorBoundary` (`components/workspace/MarkdownBody.tsx`), scoped to one markdown render.
- `grep -rn "window.onerror\|unhandledrejection" frontend/src` → **zero hits**.
- **There is no `error.tsx` and no `global-error.tsx` anywhere under `src/app/`.** So a render throw on any route was not merely unreported — it is Next's bare built-in "Application error: a client-side exception has occurred", with no recovery affordance and no way for the teacher to tell us what they saw.

That last point was not in the design doc. It upgrades M-1 slightly: the same change that gives *us* visibility should give the *teacher* a page that says something and offers a reload, because the audience for this milestone is a professional whose lesson just broke.

## Recon findings that shape the build

1. **The backend and the frontend ship in the same container.** The FastAPI backend runs as a sidecar *inside* `aipla-v01-frontend` (`BACKEND_URL=127.0.0.1:1956`). So the server-side `_version_fields()` in `observability/chat_log.py` (`K_REVISION` + `APP_VERSION`) describes **the same build that served the broken JS**. We do not need the client to report its own version — stamping it server-side is both simpler and unspoofable, and it makes the A/B revision key work for errors for free.

2. **The BigQuery sink is an allowlist, so a new log id is inert.** `infrastructure/modules/chat-logs/variables.tf` filters `logName=~"/logs/aipla_(chat_turn|workbench_event|voice_cost|rubric_run)$"`. A new `aipla_client_error` log id therefore lands in Cloud Logging and **does not** reach BigQuery — which is exactly right for M-1 (the design doc scopes M-1 to Cloud Logging) and means no Terraform in this sprint. Routing it to BQ is a deliberate later decision, not an accident of naming.

3. **The endpoint has to be unauthenticated, and that is a real design commitment.** An error reporter that requires a token cannot report the errors that matter most: a throw during auth bootstrap, a broken public `/project` page, a crash before the group token is minted. It also cannot report a failure *of the token mint itself*. So `POST /api/client-errors` takes no auth dependency — and therefore has to be shaped defensively: closed enum, hard length caps, per-IP token bucket, always-204.

4. **`TokenBucketRateLimiter` already exists** (`auth/group_rate_limit.py`, per-IP, injectable clock, written for the group-join endpoint). Reuse it rather than writing a second limiter.

5. **The reporter cannot use `fetchWithAuth` or `fetchWithTeacherAuth`** — both mint tokens, both can themselves throw, and the eslint surface fences (`frontend/.eslintrc.json`) exist to stop the wrong one being used on the wrong surface. A global reporter belongs to *no* surface. It uses bare `fetch` with `keepalive`. This must be commented at the call site or a future reader will "fix" it.

## Privacy posture

M-1 carries **no identity**. Not a uid, not an email, not a group code.

The design doc's non-negotiable posture (pseudonymous uid, closed enum, no keystrokes, no field contents, no student data) applies to M0's *friction events*. M-1 is deliberately weaker than that: it sends a `role` hint (`teacher` / `student` / `anon`) which is a three-valued enum and identifies nobody, plus the error message, stack, and `location.pathname`.

Three consequences:

- **`pathname` only.** Query strings and hash fragments are stripped client-side *and again* server-side. A join link is `…/group?code=XXXX`; a naive URL capture would put live class join codes in the log.
- **Redaction of the message and stack**, because an exception message can quote data. JWTs, `Bearer …` tokens, email addresses, and any query string embedded in text are replaced with `[redacted]` before the request leaves the browser, and the same pass runs server-side as defence in depth.
- **No consent gate.** This is why M-1 is gate-free where M0 is not: there is nothing here to consent to. If M-1 ever grows a uid it inherits M0's "tell teachers" decision, and that should be written down at the moment it does.

## Milestones

One milestone, four steps. They are ordered so each is independently testable.

| Step | Title | Scope | Est. |
|---|---|---|---|
| **S1** | Sink + endpoint | BE | ~0.2d |
| **S2** | Reporter lib | FE | ~0.1d |
| **S3** | Global handlers + the two Next boundaries | FE | ~0.15d |
| **S4** | Docs, status, query runbook | Docs | ~0.05d |

**Total ~0.5d**, matching the design doc's estimate.

---

### S1 — Sink + endpoint (BE, ~0.2d)

**Files:** **new** `backend/observability/client_error.py`, **new** `backend/protocols/client_error_routes.py`, `backend/fast_api_app.py`, **new** `backend/tests/api_tests/test_client_error_routes.py`, **new** `backend/tests/unit/test_client_error_emit.py`

**Tasks**
- `emit_client_error(...)` → named Cloud Logging logger `aipla_client_error`, reusing `chat_log._get_logger` and `_version_fields`. **Never raises**; no-op in LOCAL_MODE or without creds, exactly like the other emitters.
- It also writes one redacted stdlib `logger.warning` line unconditionally. That is not redundancy: in LOCAL_MODE and in `make dev` there is no named logger, so without it a client error is *still* invisible to the developer who just caused it.
- `POST /api/client-errors` → **204**, no auth dependency, per-IP `TokenBucketRateLimiter` (30 per 5 min), Pydantic model with hard caps: `kind` a closed enum, `message` ≤ 500, `stack` ≤ 4000, `url` ≤ 300, `role` a closed enum.
- Over budget → **429 with `Retry-After`**. Deliberately not a silent 204: a limiter that reports success is the "checker answers when it could not read its subject" footgun, and the frontend needs a signal to stop reporting.
- Register the router.

**Acceptance**
- [x] Unauthenticated POST returns 204 and emits.
- [x] Over-long `message`/`stack` are truncated, not rejected — a truncated report beats no report.
- [x] `url` with a query string is stored path-only.
- [x] A JWT/email/Bearer token in the message is `[redacted]` server-side even if the client failed to redact.
- [x] An emitter failure still returns 204 (telemetry never 500s).
- [x] The 31st request from one IP inside the window → 429 with `Retry-After`.

---

### S2 — Reporter lib (FE, ~0.1d)

**Files:** **new** `frontend/src/lib/clientErrorReporting.ts`, **new** `frontend/src/lib/__tests__/clientErrorReporting.test.ts`

**Tasks**
- `reportClientError({ kind, message, stack, componentStack })` — redact, truncate, `location.pathname` only, derive `role` from the auth mode, POST with `keepalive: true`.
- **Fingerprint dedupe** (`kind|message|first stack line`) and a **hard cap of 10 reports per page load**. A render loop must not turn one bug into a DoS on our own log budget.
- Stop permanently for the page on any non-2xx (the 429 contract from S1).
- No-ops in LOCAL_MODE and under SSR. Swallows everything — a throw inside the error reporter is the worst possible bug.

**Acceptance**
- [x] JWT / `Bearer` / email / query-string in message or stack → `[redacted]`.
- [x] The same error twice reports once.
- [x] The 11th distinct error in a page load does not report.
- [x] A rejecting `fetch` does not throw out of `reportClientError`.
- [x] LOCAL_MODE sends nothing.

---

### S3 — Global handlers + the two Next boundaries (FE, ~0.15d)

**Files:** **new** `frontend/src/components/GlobalErrorReporter.tsx`, **new** `frontend/src/app/error.tsx`, **new** `frontend/src/app/global-error.tsx`, `frontend/src/app/layout.tsx`, **new** `frontend/src/components/__tests__/GlobalErrorReporter.test.tsx`

Three sources, because they catch disjoint sets and any one alone leaves a hole:

| Source | Catches | Missed by the others |
|---|---|---|
| `window.onerror` | throws in event handlers, timers, non-React code | React boundaries never see these |
| `unhandledrejection` | a rejected promise nobody awaited — the shape of every failed `fetch` in this codebase | not an `error` event |
| `error.tsx` / `global-error.tsx` | React render throws | React swallows these into a boundary; `window.onerror` does **not** fire for them in production |

**Tasks**
- `GlobalErrorReporter` — `"use client"`, installs both window listeners in a `useEffect`, removes them on unmount, renders `null`. Mounted once in the root layout.
- `app/error.tsx` — reports, then a recoverable fallback with a `reset()` button.
- `app/global-error.tsx` — reports, renders its own `<html>/<body>` (Next replaces the root layout here), offers a reload.
- Both fallbacks are brand-token styled (`bg-background`/`text-foreground`/`bg-brand`), never a `red-*` literal — `make check-brand-literals` is a CI gate.

**Acceptance**
- [x] Dispatching `window.onerror` and an `unhandledrejection` each produce one report.
- [x] Listeners are removed on unmount (no leak across route changes).
- [x] A component that throws renders the fallback and reports exactly once.
- [x] `npm run quality:check` and `make check-brand-literals` green; `route-chrome-coverage.test.ts` still passes (boundaries are not `page.tsx`, so the footer gate must not fire on them).

---

### S4 — Docs, status, query runbook (~0.05d)

**Files:** `docs/design/aipla/v1.1.0-feedback/teacher-ui-friction-telemetry.md`, `docs/design/aipla/v1.1.0-feedback/SEQUENCE.md`, this file

**Tasks**
- Flip M-1 to shipped in the design doc + SEQUENCE row; the doc's Status header stays **OPEN** because M0–M2 remain.
- Record the two recon findings that amend the design: no `error.tsx` existed at all, and the version stamp is free because of the sidecar.
- Add the exact `gcloud logging read` incantation. An observability feature nobody can query is not shipped.

## What changed during the build

Two, both small, both recorded because a plan that silently diverges from what
shipped is worse than no plan.

1. **The query-string redaction was too greedy in the first cut.** `\?[^\s]*`
   matched a *bare* question mark, so *"Why did this fail? No idea."* became
   *"Why did this fail?[redacted]"* — mangling exactly the messages this
   milestone exists to read. Both the Python and the TypeScript pattern now
   require a `key=`, and both sides have a test asserting an ordinary question
   mark survives.

2. **A deployed smoke probe was added — deliberately as a 422, not a 204.**
   `scripts/smoke-deployed.sh` now POSTs an *invalid* body to
   `/api/proxy/api/client-errors` and expects 422. A valid POST would succeed and
   write a synthetic row into `aipla_client_error` on every deploy: a check that
   pollutes the signal it exists to protect. The 422 still proves the whole chain
   (Next catch-all proxy → sidecar → router → validation), which is the actual
   regression risk — a route that never mounted would 404. Not added to
   `cloudbuild.yaml`, so no `cloudbuild.promote.yaml` twin is owed.

## Out of scope, deliberately

- **M0's friction-event enum.** Different milestone, different gate (teachers must be told), different sink.
- **BigQuery routing.** One line of Terraform whenever it is wanted; not needed to answer "is anything on fire", and it commits us to a schema before we have seen a single row.
- **Session replay, GlitchTip, any vendor.** The design doc argues these deliberately and puts them after M-1 and M0.
- **Source maps / stack symbolication.** Minified stacks are worth less, but the message, the surface and the frequency are the triage signal, and uploading source maps is a build-pipeline change with its own decisions.
