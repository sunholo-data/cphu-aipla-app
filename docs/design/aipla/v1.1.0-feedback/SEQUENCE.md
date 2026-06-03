# v1.1.0-feedback Build Sequence

**Source brief:** [`june-03-feedback-sprint-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md) — 3 June 2026 teacher check-in
**Target window:** post-v1.0 / pilot-iteration (2026-06-04 → pilot start 2026-08-14, with continued iteration through 2026-09-15 handover)
**Parent roadmap:** [../SEQUENCE.md](../SEQUENCE.md)

This is the per-version sequence file for the **v1.1.0-feedback** batch — nine items distilled from the 3 June teacher check-in, in scoping-site priority order. The brief is the source of pedagogical / product truth; the docs here add the repo-specific technical execution layer (file paths, wire shapes, ADR alignment, acceptance gates).

> **v1.1, not v1.0.** Brief tags these as v1.1 priorities; they refine v1.0 surfaces rather than ship new strands. Many can land before the 2026-08-14 pilot, which is good — every item the pilot sees with confidence is one less thing the post-pilot iteration window has to absorb.

## Ordering

Brief priority is preserved; cross-cutting / blocking-dep ordering is noted in the dependency column.

| Order | Doc | Priority | Estimate | Dependencies / Gate | Notes |
|---|---|---|---|---|---|
| 1.1.1 | [tutor-verbosity-fix.md](tutor-verbosity-fix.md) | **P0 IMMEDIATE** | ~2h | None | System-prompt-only delta across Boldkast, LED Planck, KineBot SKILL.md preambles. ≤3 sentences per turn unless explicitly asked; end every turn with a question. AR sign-off on the rewritten prompt block |
| 1.1.2 | [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) | **P1** | ~1d | [proactive-tutor.md](../v1.0.0-pilot/proactive-tutor.md) Phase A shipped (it has); workbench-event stream from MCPAPP-SPEC | **Promotes / reshapes** the existing proactive-tutor Phase B (idle heartbeat → sim-event-reactive). Trigger on meaningful workbench events (sim run, step change, measurement commit) not slider drag. 90s cooldown, max 2 per session, short observation + question. Per-skill config |
| 1.1.3 | [student-consent-prompt.md](student-consent-prompt.md) | P1 | 0.5d FE + 0.5d BE | **JB sign-off on wording** (same approval gate as [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md)) | One-shot opt-in at session start. `consent_given: bool` on the session Firestore doc; declines → chat turns NOT written to BigQuery; teacher report shows `No research consent` badge. No change to ADR-001 anonymous-group auth |
| 1.1.4 | [session-report-summary-primary.md](session-report-summary-primary.md) | P1 | ~1d | None (teacher-insights-dashboard shipped) | Flip the session-report layout: AI summary primary; full transcript collapsed by default; CSV download for researcher use. Summary-generation prompt updated to produce 3-5 sentence narrative + concept/parameter/checklist bullets + "what next" line. Also the privacy strategy for eventual audio inclusion (summary has lower privacy profile than verbatim) |
| 1.1.5 | [researcher-role.md](researcher-role.md) | P1 | ~1d | [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A shipped) | New `role:researcher` Firebase custom claim; bypasses class-tag namespace; `--all-classes` flag on `aiplatform logs`; "Research view" toggle in teacher UI. Set manually by admin for JB, AR, M |
| 1.1.6 | [group-code-school-year-ttl.md](group-code-school-year-ttl.md) | P1 | ~2h | [session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) (1.F shipped) | Extend default group-code + session TTL from 30d to 300d (~Danish school year). Soft archival on expiry (BQ chat/workbench rows retained; Firestore doc flagged `archived: true`). Prerequisite for the portfolio-download feature (deferred to year-end) |
| 1.1.7 | [student-multimodal-upload.md](student-multimodal-upload.md) | P1 | ~2d | ADR-008 (Gemini multimodal via AILANG Parse — ready); JB confirm on image-retention posture | **Was originally planned as 1.10** `multimodal-ingestion-via-ailang-parse.md` in the parent SEQUENCE — this doc supersedes that planned row. Most-requested student-facing item from 3 June. Paperclip upload, JPG/PNG/HEIC/PDF, image thumbnail in chat, Gemini multimodal call with image attached. Tutor handles handwritten diagrams, experimental-setup photos, draft answers per skill prompt |
| 1.1.8 | [exit-ticket.md](exit-ticket.md) | P1 | ~1d | **JB/AR providing the question set** | End-of-session modal with confidence emoji rating + free-text. Stored in Firestore session doc + BigQuery (`exit_ticket_rating`, `exit_ticket_text`, `exit_ticket_skipped`). Teacher session report shows the rating; researcher view aggregates |
| 1.1.9 | [cost-dashboard.md](cost-dashboard.md) | P1 | ~1d | [chat-log-pipeline.md](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (1.2 shipped — token counts already in BQ via OTel) | **Supersedes the originally-planned 1.12** `budget-dashboard.md`. Teacher class-detail "Budget" panel: this-month spend, per-activity / per-group breakdown, projected monthly. Researcher cross-class spend. Priority lifted by DK's Indian cohort scaling to ~100s of students |

## What's gated on human input

Tee these up first — engineering can't unblock them:

1. **JB sign-off on consent prompt wording** ([1.1.3](student-consent-prompt.md)) — gates the chat-log opt-in shipping
2. **JB/AR question set for the exit ticket** ([1.1.8](exit-ticket.md)) — gates the modal shipping
3. **AR sign-off on the verbosity-trimmed system prompt** ([1.1.1](tutor-verbosity-fix.md)) — gates the prompt change merge
4. **JB confirm on image-retention posture** ([1.1.7](student-multimodal-upload.md)) — gates multimodal upload; brief states "images sent to Gemini, not retained in BQ" but needs explicit JB OK

Items **1, 2, 4, 5, 6** have **no human dependency** and can start immediately.

## Items that can ship in parallel

The dependency graph is shallow — most of these are independent surfaces:

```
Independent (start any time, in any order):
  1.1.1 verbosity         (2h)   ───┐
  1.1.2 sim-reactive      (1d)   ───┤
  1.1.4 summary primary   (1d)   ───┼─► no blockers; parallelisable
  1.1.5 researcher role   (1d)   ───┤
  1.1.6 TTL extension     (2h)   ───┘

Human-gated:
  1.1.3 consent prompt    (1d)    ◄── JB wording approval
  1.1.8 exit ticket       (1d)    ◄── JB/AR question set

Larger / more cross-cutting:
  1.1.7 multimodal upload (2d)    ◄── ADR-008 ready; JB image-retention confirm
  1.1.9 cost dashboard    (1d)    ◄── 1.2 BQ tables shipped; uses existing OTel
```

## Items the brief explicitly excluded (future)

From the brief's "Not in this brief" section — captured here so they don't get lost:

| Item | Why not now | Where it goes |
|---|---|---|
| Bidirectional voice (student speaks → STT → tutor responds) | Significant UX change; needs a research angle baked in | Separate post-v1.1 sprint; partly overlaps [audio-capture-and-tts.md](../v1.0.0-pilot/audio-capture-and-tts.md) |
| Teacher activity creation from scratch (Parameters tab scope expansion) | Significant feature — beyond bounded knobs | Separate design doc; overlaps [post-pilot/teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md) |
| Activity branching / marketplace | Needs ≥10 activities to be useful | Separate sprint, post-pilot |
| Oral exam prep skill | New skill brief — DRA map per topic + voice mode | New skill brief in scoping site |
| Student note-taking skill | New skill brief | New skill brief in scoping site |
| Portfolio download | Depends on [1.1.6](group-code-school-year-ttl.md) school-year TTL shipping first | Small follow-up sprint after 1.1.6 |

## Total estimate

| Bucket | Engineering days |
|---|---|
| Quick wins (1.1.1, 1.1.6) | ~0.5d |
| Standard (1.1.2, 1.1.3, 1.1.4, 1.1.5, 1.1.8, 1.1.9) | ~6d |
| Larger (1.1.7) | ~2d |
| **Total** | **~8.5d** |

Comfortably fits in the post-3-June → pilot-start window (2026-06-04 → 2026-08-14, ~10 weeks minus the 2026-06-29 → 07-05 holiday freeze). Several items can be live in time to be exercised *by* the pilot, not absorbed *after* the pilot.

## Timeline anchors

- **2026-06-03** — Brief delivered (3 June teacher check-in)
- **2026-06-04** — v1.1 design docs landed (this commit)
- **2026-06-26** — Mid-point review; quick wins (1.1.1, 1.1.6) and at least one larger item should be in flight
- **2026-06-29 → 07-05** — Holiday freeze
- **2026-07-06 → 08-14** — v1.1 build window (post-freeze, pre-pilot)
- **2026-08-14** — Pilot starts; ideally 1.1.1–1.1.6 + 1.1.9 live
- **2026-08-14 → 09-15** — Pilot iteration window for remaining items + portfolio-download follow-up

## Cross-version updates

When these ship, mark them in this file's `Sprint status` section (mirroring the v1.0 pattern) and move docs into a sibling `implemented/` directory.
