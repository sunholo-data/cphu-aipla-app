# No crash across a deploy — tell stale clients apart, and do not deploy into a lesson

**Status:** Design (OPEN) — **1.1.138**
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

## Out of scope

- Running two revisions at once for A/B. Tagged revision URLs per class
  (deploy.md) already pin a class to one build, so they are not affected.
- `--workers 2` / separating the researcher load. That is 1.1.131's "Later".
