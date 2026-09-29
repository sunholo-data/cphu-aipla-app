# Sprint Plan: CLASSVISIT-1 — no frozen class, no crash across a deploy, the work beside the words, a class list that stays local

## Summary

The first sprint from the [week-of-22-Sep class-visit triage](class-visit-2026-09-feedback-triage.md).
It takes every **un-gated** milestone of the four docs that does not wait on data
or on JB. It is run as **four parallel lanes with disjoint file sets**, each built
in its own worktree and merged into `dev`, so a lane can land or slip on its own.

**Status:** 🚧 IN PROGRESS — started 2026-09-29
**Duration:** ~5–6d of work, run in parallel · **Scope:** Fullstack + ops
**Design docs:** [1.1.131](insights-off-the-event-loop.md) M2–M4 · [1.1.138](no-crash-across-a-deploy.md) M0–M2 · [1.1.137](class-list-on-the-teacher-device.md) M0–M2 · [1.1.136](review-work-beside-the-transcript.md) M0, M1, M3

## Decisions taken in planning

- **Lanes are cut by file ownership, not by doc.** Each lane owns its files
  outright (listed below). A lane that finds it needs another lane's file stops
  and records it in its report rather than editing it. This keeps the four merges
  conflict-free.
- **1.1.137 writes a real `.xlsx` with no new dependency.** An xlsx is a ZIP of
  a few XML files. A *stored* (uncompressed) ZIP writer plus CRC-32 is ~100 lines
  and testable, which avoids adding a library to the `make security-check` surface
  for a write-only feature. If it turns out harder than that, the lane falls
  back to CSV-with-BOM (M0) and records why.
- **1.1.137 teacher copy stays in a `copy` object.** The i18n guard covers
  student surfaces only, so lane A alone touches `messages/{da,en}/`.
- **1.1.131 M4's alert is committed as Terraform, not applied.** Applying is
  `make tf-apply ENV=prod GO=1`, a deliberate human step.
- **1.1.136 M2 (final-state panel) and M4 (rubric evidence) go to the next
  sprint.** M2 is where the shared miniature renderers get built, and it should
  be sequenced with 1.1.99 rather than squeezed in beside it. **1.1.138 M3/M4
  are gated on M0's data** by design.

## Lanes

### Lane A — LOOP · 1.1.131 M2–M4 · ~1d
Owns: `backend/protocols/reports_routes.py`, `backend/reports/session_summary.py`
(+ wherever `find_latest_session_id_for_group_bq` lives), `backend/tests/**` for
these, `frontend/src/hooks/useSkillAgent.ts` + the chat surface that renders
its status, `frontend/messages/{da,en}/`, a **new** Terraform file for the alert.
- [ ] M3: offload every synchronous BigQuery call on the group-report path;
      add the route to `test_blocking_queries_off_the_loop.py`.
- [ ] M2: watchdog after `RUN_STARTED`, 15 s → a quiet "slow" line, 45 s → retry offer (no double-send).
- [ ] M4: log-based metric + alert on `run_query on the event loop`, prod.

### Lane B — DEPLOY · 1.1.138 M0–M2 · ~1d
Owns: `frontend/src/lib/staleDeployReload.ts`, `components/GlobalErrorReporter.tsx`,
`app/error.tsx`, `app/global-error.tsx`, the backend client-error route,
`frontend/next.config.*`, `scripts/promote-env.sh`, `docs/ops/runbooks/deploy.md`.
- [ ] M0: client errors carry `buildId`, server build, `autoReloaded`; a `recovered` event after a successful reload.
- [ ] M1: prod promote refuses Mon–Fri 08–16 Europe/Copenhagen without `FORCE=1`.
- [ ] M2: `deploymentId` from the build SHA.

### Lane C — CLASSLIST · 1.1.137 M0–M2 · ~1–1.25d
Owns: `frontend/src/lib/download.ts` (+ a new `lib/xlsx.ts`), `app/teacher/classes/[id]/page.tsx`,
new `app/teacher/classes/[id]/_ClassListSheet.tsx`, their tests.
- [ ] M0: BOM on `downloadCsv`; minimal xlsx writer.
- [ ] M1: browser-only class list, names in `localStorage` only, a test that no request carries a name.
- [ ] M2: import back from xlsx/CSV, parsed in the browser.

### Lane D — REVIEW · 1.1.136 M0, M1, M3 · ~2.5d
Owns: `backend/observability/chat_log.py`, `backend/protocols/iframe_context_routes.py`,
`infrastructure/modules/chat-logs/views.tf`, the workbench element components'
push calls, `scripts/audit-trust-cards.sh`, `backend/protocols/{table,writing,checklist,concept}_progress_routes.py`,
`backend/analytics/research_logs.py`, `backend/protocols/research_logs_routes.py`,
`frontend/src/components/teacher/research/ChatLogTranscript.tsx`, `app/teacher/reports/groups/[groupId]/page.tsx`,
`app/teacher/insights/conversations/page.tsx`.
- [ ] M0: `activity_id`, `class_id`, `label` on workbench events; elements send their label; CI fails on an unlabelled push.
- [ ] M1: `session_timeline` interleaving turns and work; inline cards in the researcher lens and the teacher group report (retiring the 80-char list).
- [ ] M3: researchers can read table/writing progress (`assert_can_read_class`), with a dual-audience test.

## Integration

Merged into `dev` lane by lane, then once on the combined tree:
`cd backend && make lint && make test-fast` · `cd frontend && npm run quality:check` ·
`make audit-trust-cards check-cloudbuild check-i18n check-client-api check-routes-tracked`.

## Acceptance

Each design doc's acceptance section for the milestones above. The sprint is
done when all four lanes are merged and the combined CI-parity run is green.

## Out of scope

1.1.136 M2/M4 · 1.1.138 M3/M4 · 1.1.131 "Later" (workers/separate service) ·
anything needing JB (photo retention, a server-side class list).
