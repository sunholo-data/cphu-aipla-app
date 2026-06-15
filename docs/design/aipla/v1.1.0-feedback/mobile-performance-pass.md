# Mobile performance pass — profile the student app on a shared phone

**Status:** Planned (P1) — **investigation → targeted fixes**, not a feature. Report findings before committing fixes.
**Last Updated:** 2026-06-15
**Priority:** **P1** — teachers flagged mobile *performance* [M, 15 June], distinct from the mobile *layout* already shipped. Students share a single phone, so load/response time on mobile is a usability gate, not a nice-to-have.
**Estimated:** ~1d profile + a per-bottleneck fix proposal; targeted fixes scoped after the profiling note.
**Scope:** Frontend-led — `frontend/` bundle/loading + workbench iframe mount + chat first-render; light backend touch only if TTFT is implicated. Plus the perf tooling that doesn't exist yet (bundle analysis, web-vitals).
**Dependencies:** none to start profiling. Couples to [bidirectional-voice-brief.md](bidirectional-voice-brief.md) (1.1.23) — mobile is the worst case for the voice latency budget; measure both on the same device.
**Source brief:** [`notes/2026-06-15-teacher-feedback.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-06-15-teacher-feedback.md) "Mobile performance" + [june-15-feedback.md](june-15-feedback.md)

> **Investigation-first, by design.** This is not "ship mobile fixes" — it's "find the top-3 mobile
> bottlenecks on a representative device, then propose a fix for each". We commit to fixes *after*
> the profiling note, because the fixes depend on what the profile actually shows. Guessing the
> bottleneck is how perf work wastes a day on the wrong thing.

## Why this exists

The student app runs on a **single shared low-mid Android phone** in many classrooms (the
no-laptop / shared-tablet reality that drove voice-in and on-device guardrails). Two things matter
on that device that don't show on a dev laptop: **first-load time** (cold open of the chat URL after
joining a group) and **time-to-interactive once a workbench is involved** (the MCP-App iframes —
Boldkast / LED Planck / KineBot). 15 June's "mobile performance" is about *those*, not layout.

## What exists today (the baseline — verified 2026-06-15)

No perf tooling is in place. That is itself a finding:

| Surface | State today |
|---|---|
| Bundle-size CI check | **None.** [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) runs lint + typecheck + vitest + `next build`, no size budget. |
| Bundle analyzer | **None.** [`frontend/next.config.mjs`](../../../../frontend/next.config.mjs) sets `output: 'standalone'` + avatar cache headers; no `@next/bundle-analyzer`. |
| Lighthouse / web-vitals | **None.** No `.lighthouserc`, no `web-vitals` reporting, no perf-observer. |
| TTFT instrumentation | **Referenced, not built** — `ttft-instrumentation.md M2` is cited in the chat page but no first-token timing is captured client-side. |
| Workbench code-splitting | **Not split** — `BoldkastWorkbench` / `LedPlanckWorkbench` / `KineBotWorkbench` are conditional renders, **loaded upfront** in the student bundle (not via `next/dynamic`). Prime suspect for first-load weight. |

So step one is partly "build the ruler": there's nothing measuring mobile perf today.

## Plan

### Phase 0 — profile (the deliverable that gates everything else)

On a **representative low-mid Android phone** (pick one with M; ~mid-2022 budget Android is the
target, not a flagship), over a throttled "fast 3G / slow 4G" classroom-Wi-Fi profile:

1. **Cold first-load** of the student chat URL after joining a group — measure TTI, LCP, total JS transferred, main-thread blocking time. Chrome DevTools (via the `aitana-frontend-verify` skill / chrome-devtools MCP) + a one-off Lighthouse run.
2. **Time-to-first-token render** — join → first tutor turn visible. Where does the time go (network vs hydration vs first SSE chunk)?
3. **Workbench iframe load** — open a Boldkast / LED Planck / KineBot activity; measure iframe mount → interactive. This is the `aipla-v01-sandbox` cold-start + iframe JS weight.
4. **Voice round-trip latency on this device** (coordinate with 1.1.23's latency budget) — utterance-end → first audio of reply, on mobile.

**Output: a profiling note** — the top-3 bottlenecks ranked by measured impact, each with a fix
proposal + rough effort. That note is the acceptance for this doc. (Append it to this file under a
*Findings* section, or as `mobile-performance-findings.md` if it's large.)

### Phase 1 — targeted fixes (scoped after Phase 0)

Likely candidates (hypotheses, to confirm/refute by the profile — **don't pre-commit**):

- **Code-split the workbench components** via `next/dynamic` so the student bundle doesn't carry all three sims upfront (today they're static imports). High-probability win if first-load JS is the bottleneck.
- **Add `@next/bundle-analyzer`** + an `npm run analyze` script to see what's actually in the student bundle; lazy-load heavy deps (image-resize, voice libs) behind the controls that use them.
- **Add a CI bundle-size budget** (the missing guard) so mobile perf can't silently regress — fits the "no silent caps / measurable" posture and the security-pipeline precedent (1.1.16).
- **web-vitals → BigQuery** (Axiom 8) — report LCP/INP/TTFB from real student devices through the existing OTel/BQ sink, so we measure *real* mobile perf at pilot scale, not just one profiling device.
- **Iframe lazy-mount** — defer the workbench iframe until the activity surface is actually opened; warm the `aipla-v01-sandbox` if cold-start dominates.
- **Defer/skeleton first paint** — if hydration blocks, ship a lighter above-the-fold chat shell.

Each fix lands only if the profile says it's in the top-3. Report-then-fix.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | **The whole point** — first-load and TTFT on the device students actually use. The platform's own speed bar (first token <1s without tools) only matters if it holds on a shared phone. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Not a model-tier question; perf is transport/bundle. Neutral. |
| 5 | GRACEFUL DEGRADATION | +1 | A faster, lighter first paint *is* degradation-friendly — skeletons + lazy mount keep the app usable on weak networks. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Adds the missing perf ruler — web-vitals → BQ + a CI bundle budget make mobile perf measurable and regression-guarded, not anecdotal. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new attack surface; web-vitals carry no PII (group-keyed, ADR-001). Neutral. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Code-splitting + lazy mount keep the client thin — the heavy sim code loads only when its surface opens. |
| 11 | USABLE BY DESIGN | +1 | The shared-phone target device is named in the acceptance; perf is treated as a usability gate, profiled on the real form factor. |
| | **Net Score** | **+5** | Threshold: ≥ +4. (Unscored axioms are neutral for a perf investigation.) |

## Acceptance

- [ ] A **profiling note** exists with the **top-3 mobile bottlenecks** (measured, ranked) and a **fix proposal for each** — on a representative low-mid Android over a throttled network.
- [ ] The voice round-trip latency on that device is captured (shared measurement with the 1.1.23 latency budget).
- [ ] (Phase 1, after the note) Each shipped fix cites the measurement it addresses; a before/after number is recorded.
- [ ] If a CI bundle-size budget lands, it documents what threshold it guards and why.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Fixing the wrong thing (optimising by intuition) | Medium | Report-then-fix; the profiling note gates Phase 1. |
| Workbench code-split breaks the in-chat sim mount | Medium | The dual-surface wiring (in-chat `MCPAppToolCallRouter` + workspace `useSimSnapshotPush`) must both still work — regression-test both paths (the dual-surface gotcha is documented). |
| Profiling device not representative | Low | Pick the device with M against the actual pilot-school hardware. |
| Perf work expands without bound | Medium | Bounded to top-3; anything beyond is a follow-up row, not this pass. |

## Related documents

- [bidirectional-voice-brief.md](bidirectional-voice-brief.md) — the voice latency budget; mobile is its worst case (1.1.23)
- [call-teacher.md](call-teacher.md) — the other new 15-June build item (1.1.29)
- [june-15-feedback.md](june-15-feedback.md) — the 15-June item→disposition map
- `aitana-frontend-verify` skill — the chrome-devtools MCP harness for the profiling runs
