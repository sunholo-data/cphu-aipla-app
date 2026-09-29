# No crash across a deploy — tell stale clients apart, and do not deploy into a lesson

**Status:** **M0–M2 shipped 2026-09-29** (CLASSVISIT-1 lane B, not yet deployed) · M3 gated on M0 data · M4 open — **1.1.138**
**Priority:** **P1** — the second cause behind *"the platform crashed, refreshing fixed it"*. Teachers and students both hit it, and every instance so far lines up with a school-hours prod deploy. **Un-gated**
**Estimated:** ~1.25–1.75d (M0 know what happened ~0.25d · M1 school-hours promote guard ~0.25d · M2 `deploymentId` ~0.5d · M3 service-worker fallback ~0.25–0.5d · M4 re-measure ~0.25d)
**Scope:** Frontend: `lib/staleDeployReload.ts`, `components/GlobalErrorReporter.tsx`, `app/error.tsx`, `next.config.*`, `public/sw.js`. Ops: `scripts/promote-env.sh`
**Dependencies:** `e529ccba` (**shipped** v0.1.65, 2026-09-25 — reload once on a stale-deploy signature); [1.1.131](insights-off-the-event-loop.md) (the *other* cause, fixed); MOBILE-1 service worker (**shipped** 2026-08-13). **Un-gated**
**Created:** 2026-09-29
**Source:** [class-visit-2026-09-feedback-triage.md](class-visit-2026-09-feedback-triage.md), item 1 — the *"I also had that experience"* half

## Problem Statement

The prod client-error log for 21–28 Sep holds **14 error-boundary crashes**
reading `Cannot read properties of undefined (reading 'call')` (or Firefox's
`e[o] is undefined`). They hit teachers on `/teacher/classes` and
`/teacher/activities/new`, visitors on `/`, and a student on `/lessons` and
`/chat`, on 21 Sep ×4, 23, 24 ×2, 26 ×3 and 28 ×3.

That is the signature of a page whose webpack module map no longer matches
the build it is talking to. **Prod was promoted during school hours on
21 Sep 14:42, 22 Sep 12:12 (mid-lesson), 24 Sep 13:36 and 25 Sep 12:09.**
No `/_next/static` 404s appeared in class hours, so the chunk requests
did not fail. The page asked for a module that its own build never had.

`e529ccba` (25 Sep) makes the error boundary reload once on this signature,
and that is the right first fix. **But 4 of the 14 came on revision `00061`,
1–3 days after its deploy, including a student on 28 Sep.** Two readings, and
the logs cannot tell them apart:

1. **The fix worked and these are recoveries.** `error.tsx` reports the error
   *"either way"* before reloading (by design, `keepalive`), so a successful
   auto-reload still lands in the log as a crash.
2. **Something besides an old tab produces the skew.** The suspect is
   `public/sw.js`. Navigations are network-first, but on a network failure it
   falls back to a **cached page**, and `CACHE_VERSION` is a fixed `"aipla-v1"`
   that no deploy bumps. A weak school Wi-Fi blip can therefore pair an old
   page with the current chunks. That is the *"classic PWA white screen"*
   the file's own comment warns about, reached through the offline fallback
   rather than the online path.

## Design

### M0 — Know which crash it was (~0.25d) · do first

Every client-error report gains: `buildId` (the client's), the server's
current build (from `GET /api/environment`, already runtime), and
`autoReloaded: true|false`. Also report a follow-up `recovered` event when the
reloaded page renders. This settles reading 1 vs 2 from data within a week
rather than by argument. Without M0, M2 and M3 are guesses.

### M1 — Do not promote into a lesson (~0.25d)

`scripts/promote-env.sh … TO=prod` refuses **Mon–Fri 08:00–16:00
Europe/Copenhagen** unless `FORCE=1`, and prints why. A hotfix still goes out,
deliberately. This costs nothing and would have prevented the mid-lesson
deploy on 22 Sep. Say it in [deploy.md](../../../ops/runbooks/deploy.md).
Dev and test are unaffected (no classes there).

### M2 — Stale clients reload on navigation (~0.5d)

Set Next's `deploymentId` from the build SHA. A client-side navigation from an
old build then does a full page load instead of fetching a module map it
cannot use. This covers the teacher case: a tab open all morning, then a click.
Verify on dev by deploying under an open tab.

### M3 — The service worker cannot serve an old page as current (~0.25–0.5d)

Gated on M0 showing reading 2. Either
(a) derive `CACHE_VERSION` from the build so an activate clears old pages, or
(b) make the navigation fallback go **only** to `/offline.html`, never to a
cached app page. (b) is simpler and loses little: an offline app page cannot
reach the tutor anyway. Recommend (b).

### M4 — Re-measure (~0.25d)

After one week of lessons on the new build: count `autoReloaded=false`
crashes. Target **zero** outside a real bug. Write the number here.

## What shipped — 2026-09-29

CLASSVISIT-1 lane B. Nothing is deployed yet; M0's data starts with the first
prod promote that carries it.

### M0 — every client report says which build and whether it reloaded

- **One build id per frontend build**, `frontend/build-id.mjs`, used for Next's
  `generateBuildId`, its `deploymentId` and `NEXT_PUBLIC_BUILD_ID` (verified on
  a local `next build`: `.next/BUILD_ID`, the client chunks, the server bundle
  and `required-server-files.json` all carry the same value). `AIPLA_BUILD_ID`
  wins when set; **nothing sets it today** — the image is built from
  `frontend/` with no `.git` and no SHA build-arg, and `APP_VERSION` is a
  *runtime* var (and just `dev` for every dev build). So the id is the UTC build
  time plus a random suffix, `b20260929125221-ge6l`: unique per build, which is
  all skew detection needs, and orderable against revision creation times.
- **The report body** (`lib/clientErrorReporting.ts`) gains `buildId`,
  `autoReloaded` (this crash started a reload), `afterAutoReload` (this page
  load is itself the product of one) and, on a recovery, `previousBuildId`.
- **`recovered`** is a new `kind`. `reloadIfStaleDeploy` leaves a one-shot
  sessionStorage marker naming the build the tab was on; `GlobalErrorReporter`
  (root layout) takes it after `RECOVERY_SETTLE_MS` (3 s) and reports
  `recovered`. If the reloaded page crashes first, the boundary takes the marker
  instead and its crash row says `afterAutoReload: true`, so one reload yields
  exactly one of the two. A marker older than the 60 s cooldown is ignored.
- **The server's build is not sent by the client.** The backend already stamps
  `revision` + `app_version` on every row, from its own environment, which the
  client cannot misreport. No fetch was added to the error path.
- **Backend** (`protocols/client_error_routes.py`, `observability/client_error.py`):
  the four fields are optional, so an old tab still reports; build ids that are
  not `[A-Za-z0-9._-]{1,64}` are dropped, not logged (the endpoint has no auth).
  Logged as `client_build_id`, `previous_build_id`, `auto_reloaded`,
  `after_auto_reload`.

**How to read it after a week (feeds M4).** In
`logName:"aipla_client_error"` on prod:

| Row | Reading |
|---|---|
| `kind="recovered"`, `previous_build_id != client_build_id` | reading 1 — a real stale tab, and the reload cured it |
| `kind="recovered"`, `previous_build_id == client_build_id` | the skew did not come from an old build — reading 2 (the service worker) or an ordinary bug the reload happened to clear |
| `kind="render"`, `after_auto_reload=true` | the reload did **not** cure it |
| `kind="render"`, `auto_reloaded=false`, stale signature | inside the 60 s cooldown, or storage blocked: the boundary was shown |

### M1 — no prod promote in school hours

`scripts/promote-env.sh` refuses `--to prod` Mon–Fri 08:00–16:00
Europe/Copenhagen unless `FORCE=1` (`make promote … FORCE=1`, which make passes
through to the script's environment) or `--force`, and says why. The dry-run is
never refused; it prints the plan plus a warning. An unreadable Copenhagen clock
(no tz database — `date` would silently answer in UTC) fails closed.
`PROMOTE_NOW=<epoch>` pins the clock for the 12 tests in
`backend/tests/unit/test_promote_school_hours.py`, which run the real script with
a fake `gcloud`. Documented in [deploy.md](../../../ops/runbooks/deploy.md).
**Route B is not covered**: approving the held `aipla-prod-promote-on-tag` build
in the console bypasses the script, and deploy.md says so.

### M2 — `deploymentId`, and what it does NOT do self-hosted

Set from the same build id. **A correction to the design above:** Next 15's app
router *already* does a full page load when an RSC response's build id differs
from the tab's (`fetch-server-response.js`: `getAppBuildId() !== response.b →
doMpaNavigation`), with or without `deploymentId`. What `deploymentId` adds,
self-hosted, is `?dpl=<id>` on every chunk and stylesheet URL and an
`x-deployment-id` header on RSC fetches. **The server does not reject a
mismatched header** — that is Vercel's skew protection, not Next's. So the
teacher case ("a tab open all morning, then a click") was probably already
covered by the build-id check, and the crashes in the log must be reaching the
module map by another path: a lazy chunk loaded without an RSC round-trip, or
the service worker's cached page (reading 2). That makes M0's data more
important, not less. `?dpl=` does mean two builds can never share an asset URL,
in the browser cache or in `sw.js`'s cache-first `/_next/static/` handler.

Not done: the "verify on dev by deploying under an open tab" step — deploying
was out of scope for this lane.

### Follow-ups

- Pass a real SHA/tag as `AIPLA_BUILD_ID`: a Dockerfile `ARG`/`ENV` plus a
  `--build-arg` in **both** `cloudbuild.yaml` and `cloudbuild.promote.yaml` (the
  twin rule). Nice for reading, not needed for correctness.
- M3 once M0 has a week of rows. M4 after that.

## Out of scope

- Running two revisions at once for A/B. Tagged revision URLs per class
  (deploy.md) already pin a class to one build, so they are not affected.
- `--workers 2` / separating the researcher load. That is 1.1.131's "Later".
