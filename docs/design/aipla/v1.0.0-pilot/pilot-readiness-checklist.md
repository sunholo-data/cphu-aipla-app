# v1.0.0 Pilot Readiness Checklist

**Pilot start:** 2026-08-14  
**Release-candidate target:** 2026-08-07  
**Status date:** 2026-07-24  
**Owner:** M coordinates; named domain owners sign their gates  
**Scope:** release readiness, not feature development

This is the single operational checklist for the AIPLA teacher pilot. It
supersedes roadmap prose as the source of truth for whether the pilot release is
ready. A box is checked only when its evidence is linked or recorded beside it.

## Current position

- AIPLA dev is live in `aipla-dev-2026`.
- AIPLA test and prod are not yet cut; see
  [deployed URLs](../../../ops/deployed-urls.md).
- The automatic `SKILL.md` → Firestore Cloud Run seed job shipped on
  2026-07-23, but its first deployed run still needs verification.
- Product breadth is sufficient for the pilot. Until a release candidate is
  running in test, reliability, privacy, promotion, rehearsal, and operations
  take priority over new features.

## Release policy

1. Cut one immutable release candidate from `dev`.
2. Test that candidate in the AIPLA test environment.
3. Fix only release-blocking defects on the candidate.
4. Promote the tested candidate to prod using the
   [build-once promotion path](build-once-artifact-promotion.md).
5. Record the commit/tag, image digests, smoke output, approver, and rollback
   target below.

No new activity type, workbench type, broad refactor, or optional integration is
a pilot blocker unless a golden journey below cannot complete without it.

## Gate 0 — Scope and ownership

- [ ] M names the release owner and incident lead.
- [ ] JB/AR identify the pilot-critical activities and pedagogical sign-off
      owner for each.
- [ ] The release-candidate tag and cut-off time are recorded.
- [ ] Feature work is frozen for the candidate; only blocker fixes may enter.
- [ ] A shared go/no-go review is scheduled no later than 2026-08-07.

**Evidence**

- Release owner:
- Incident lead:
- Candidate tag / commit:
- Feature-freeze time:
- Go/no-go meeting:

## Gate 1 — Dev deployment is trustworthy

- [ ] The `aipla-dev-deploy` build for the candidate is green.
- [ ] The first deployed `aipla-seed-skills` Cloud Run job exists, completes
      successfully, and its execution ID is recorded.
- [ ] `force-seed-demo` refreshes an existing teacher's Demo class without
      duplicating or losing unrelated data.
- [ ] The deployed skill/activity catalogue matches the candidate templates.
- [ ] `./scripts/smoke-deployed.sh dev all` passes.
- [ ] `REQUIRE_SIMS=1 ./scripts/smoke-deployed-mcp.sh dev` passes.
- [ ] Frontend CI parity and backend lint/test-fast are green for the candidate.

**Evidence**

- Cloud Build:
- Seed-job execution:
- Smoke output:
- CI run:

## Gate 2 — Test environment exists and matches the design

Follow [environment promotion](env-promotion-dev-test-prod.md); do not add
one-off manual IAM grants to make test pass.

- [ ] `aipla-test-2026` is provisioned from committed Terraform.
- [ ] Firebase Auth, Firestore rules/indexes, Secret Manager, Agent Engine,
      Vertex/RAG, BigQuery, Cloud Run, and the MCP sandbox are configured.
- [ ] The test release trigger and required cross-project Artifact Registry
      permissions exist.
- [ ] Environment drift is empty or explicitly allow-listed.
- [ ] `verify_rules.py --env test` passes.
- [ ] `whoami_smoke.py --env test` passes.
- [ ] `./scripts/smoke-deployed.sh test all` passes.
- [ ] `REQUIRE_SIMS=1 ./scripts/smoke-deployed-mcp.sh test` passes.
- [ ] Test remains healthy for at least 24 hours after the last blocker fix.

**Evidence**

- Terraform plan/apply:
- Drift audit:
- Test URLs:
- Smoke output:
- Soak start/end:

## Gate 3 — Privacy, consent, and data handling

Unchecked institutional decisions disable the affected optional capture mode;
they do not silently inherit a permissive default.

- [ ] JB approves the student research-consent wording.
- [ ] The consent decline path is tested: the student can still learn while
      research capture follows the approved policy.
- [ ] Image/document retention and deletion behavior is approved and tested.
- [ ] Audio recording/transcription is either institutionally approved with
      retention documented, or disabled for the pilot.
- [ ] BigQuery access is least-privilege and researcher-role access is tested.
- [ ] The DPIA scaffold records group-code data, chat logs, images/documents,
      audio if enabled, retention periods, and deletion/withdrawal handling.
- [ ] Pilot-facing copy accurately describes what is recorded and why.

**Evidence**

- Consent approval:
- Retention decision:
- Audio decision:
- DPIA location:

## Gate 4 — Golden journeys in test

Run on representative school hardware and network conditions. Record browser,
device, group code, tester, timestamp, and result for every journey.

- [ ] Teacher signs in, creates or opens a class, selects activities, and mints
      group codes.
- [ ] Two students join the same group from separate devices.
- [ ] Students complete a chat-only activity and receive the intended tutor
      style/persona.
- [ ] Students complete a simulation activity; committed workbench actions
      reach the tutor and produce visible trust cards.
- [ ] Students use curriculum material and the tutor cites/uses the selected
      material.
- [ ] Refresh and rejoin restore chat and activity state.
- [ ] Shared-session turn locking/synchronisation behaves acceptably with two
      devices.
- [ ] Teacher sees the session/class analytics expected for the pilot.
- [ ] Researcher access works across the intended cohort and rejects
      unauthorized users.
- [ ] Revoked, expired, malformed, and cross-class group codes fail safely.
- [ ] Model/tool failure produces an understandable degraded state rather than
      a broken page.

**Evidence**

- Journey log:
- Blockers found:
- Blockers closed:

## Gate 5 — Cost and operational controls

- [ ] Pilot model pricing is current and the cost dashboard agrees with the
      configured model registry.
- [ ] Per-class budgets or the agreed pilot guardrail are enabled and tested.
- [ ] Budget, error-rate, latency, and failed-deployment alerts have an owner.
- [ ] Pre-created teacher/researcher accounts and pilot classes are verified.
- [ ] Pilot group-code distribution does not expose administrative credentials.
- [ ] The support path and response expectation are shared with teachers.
- [ ] The incident lead can inspect Cloud Build, Cloud Run, logs/traces,
      BigQuery ingestion, and seed-job executions.

**Evidence**

- Budget configuration:
- Alert owners:
- Account/class verification:
- Support contact:

## Gate 6 — Production promotion and rollback

- [ ] Prod is provisioned from committed Terraform with no manual IAM drift.
- [ ] The candidate that passed test is promoted using
      `aiplatform deploy promote` / `scripts/promote-env.sh`.
- [ ] Test and prod report the same backend image digest.
- [ ] Prod Firestore rules/indexes and platform seeds are verified.
- [ ] `./scripts/smoke-deployed.sh prod all` passes.
- [ ] `REQUIRE_SIMS=1 ./scripts/smoke-deployed-mcp.sh prod` passes.
- [ ] A production golden-journey smoke passes using non-pilot test accounts.
- [ ] The previous known-good digest and rollback command are recorded.
- [ ] One rollback rehearsal has succeeded before the go/no-go review.

**Evidence**

- Promotion build:
- Test/prod digests:
- Prod URLs:
- Smoke output:
- Previous digest:
- Rollback rehearsal:

## Gate 7 — Pilot-day rehearsal and go/no-go

- [ ] A timed dress rehearsal runs the complete teacher → student → analytics
      path with the people who will support the pilot.
- [ ] The team rehearses login failure, model outage, simulation failure,
      analytics delay, and accidental bad seed.
- [ ] A concise pilot-day runbook lists dashboards, commands, contacts,
      escalation order, rollback, and the useful degraded mode for each failure.
- [ ] Known non-blocking defects and workarounds are shared with pilot staff.
- [ ] M, the pedagogical owner, the privacy/data owner, and the release owner
      record go/no-go.

**Evidence**

- Dress-rehearsal record:
- Pilot-day runbook:
- Known-issues list:
- Go/no-go decision:

## Go/no-go rule

The pilot is **GO** only when Gates 1–7 are complete or every unchecked item has
an explicitly named owner, an accepted workaround/disablement, and written
approval from the relevant domain owner. Test/prod absence, an unverified
automatic seed, missing consent/retention decisions for enabled capture, a
failed golden journey, or an untested rollback are release blockers.

