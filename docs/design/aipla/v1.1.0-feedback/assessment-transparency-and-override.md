# Assessment transparency and researcher override — what a cited turn is, why the band, and how a researcher corrects it

**Status:** Implemented M1–M5 on branch (2026-10-05), not yet deployed — **1.1.148**. Gated on M: open questions 3–5, the Terraform sink-filter apply. See "Implementation notes"
**Priority:** **P1** for M0–M2 (a researcher-visible defect: the cited turn numbers do not match the transcript's numbers) · **P2** for M3–M5
**Estimated:** ~5d phased (M0 prod evidence ~0.25d, M's queries · M1 one turn identity ~1d · M2 transparent construct detail ~1d · M3 turn references in the transcript ~0.5d · M4 researcher review, append-only ~1.5d · M5 criteria version on every run ~0.75d). At 2.5 days/week, **~2 weeks of calendar**
**Scope:** Backend: `analytics/framework_fidelity.py`, `reports/session_summary.py` (`SessionTurn`), `analytics/rubric_runs.py`, a new `db/rubric_reviews.py`, `protocols/reports_routes.py` (or `research_lens_routes.py`), `observability/chat_log.py`, `infrastructure/modules/chat-logs/variables.tf` (sink filter). Frontend: `components/teacher/TeachingApproachSection.tsx`, `components/teacher/research/ChatLogTranscript.tsx`, `app/teacher/reports/groups/[groupId]/page.tsx`, `lib/teacherApi.ts`, `messages/{da,en}/teacher-classes.json`
**Dependencies:** [1.1.107 framework-fit-profile](framework-fit-profile.md) (**shipped**, the fidelity judge this explains); [BENCH-1/2](tutor-discrimination-benchmark-sprint.md) (**shipped**, `fidelity-r2`: move ids, the banding rule); [RUBRIC-2](rubric-2-sprint.md) (**shipped**, the run store reused here); [1.1.91 tutors](tutors-handover-2026-09-10.md) (**shipped**, researcher-editable framework structure); [1.1.136](meeting-2026-09-29-followups.md) (the report timeline). **Not** [1.1.144 concept-assessment](../v2.1.0-extension/concept-assessment.md), which owns the per-concept level and its teacher override; see "Boundary" below
**Created:** 2026-10-05
**Source:** Teacher seminar 2026-10-05, [notes-2026-10-05.md](../../../notes-2026-10-05.md)

## Problem Statement

M ran a teacher seminar on prod on 2026-10-05. Verbatim notes:

> *"In the construct detail assessments we have turns. Eg 19.43.47. — how are these calculated? Can we have them appear in the actual chat history more. How are judging criteria (partial, strong etc) — bit more transparency on how this is calculated — can we edit and fix these as researchers?"* and separately *"43 appears too often."*

Four questions: (1) what the turn numbers are, (2) how a band is decided, (3) whether a
researcher can see the cited turn in the chat, and (4) whether a researcher can edit the
criteria or correct a judgement. Plus one anomaly (43) to explain before building.

## Findings

Verified against code on 2026-10-05 (no prod data read). **V** = verified in code; **H** = hypothesis, to be settled by M0.

### What "19.43.47" is

- **V.** "Construct detail (research instrument — fidelity, not quality)" is the researcher-only
  `<details>` table in `frontend/src/components/teacher/TeachingApproachSection.tsx:78-124`,
  rendered on the group report (`app/teacher/reports/groups/[groupId]/page.tsx:350`) only when the
  payload carries `constructs` (`:71`). The backend adds them for `user.is_researcher` alone
  (`backend/protocols/reports_routes.py:108-115`). Its "Turns" column is
  `c.evidence.join(", ")` (`TeachingApproachSection.tsx:102`).
- **V.** `evidence` is **not computed**. It is the list of turn ids the **judge model** chose to cite
  (`backend/analytics/framework_fidelity.py:277`, "evidence": [<turn ids>]; `:283-284` "every band other
  than absent must cite at least one turn id"). The parser only coerces to integers
  (`:392`) — no check that the id exists, lies in the scored window, or is a tutor turn.
- **V.** The id is the turn's **0-based position in the report's conversation list**, not a
  timestamp: `dialogue_units` numbers `offset + i` over `summary.conversation` (`:136-150`) and the
  prompt prints `[<index>] TUTOR: …` (`:248`). Empty-content turns are skipped but keep their number.
- **Reading (H, high confidence).** "19.43.47" is three cited turns, **19, 43, 47**, rendered
  "19, 43, 47". It is not a clock time: this table shows no times, and the report's times are
  `HH:MM` (`page.tsx:98`). (A `da-DK` time would read `19.43.47`, which is why the misreading is
  natural; ask M if it was copied off a different screen.)

### The turn numbers do not match the transcript — the actual defect

- **V.** Two numbering schemes are in play:
  1. **Judge id = dense position** in `summary.conversation`. `summarize_session_bq` reads
     `turn_index` but throws it away: `SessionTurn` has only `timestamp, role, content`
     (`backend/reports/session_summary.py:41-48`, `:274-283`).
  2. **Transcript `#N` = BigQuery `turn_index`**, which the emitter sets to the **ADK event index**
     (`backend/adk/callbacks/session.py:150-188`, `turn_index=idx` over `enumerate(events)`, which counts
     function-call / function-response / tool events that carry no text). It is therefore **sparse**
     (0, 1, 3, 6, …). The report's transcript renders `#{turn.turn_index}`
     (`ChatLogTranscript.tsx:346-347`) from the server timeline (`page.tsx:187-196`,
     `research_logs.session_transcript`, `analytics/research_logs.py:275-292`).
- **V.** Only in the fallback (no BigQuery timeline) does the transcript number by dense position
  (`ChatLogTranscript.tsx:125-145`, `turn_index: i`). So in the normal, BigQuery-backed case **"turn 43" in
  the construct table and "#43" in the transcript are different turns**, and in a tool-heavy session
  (sims, checkpoints, `record_assessment`) they drift further apart as the session grows. A researcher who
  follows a citation lands on the wrong message. This is the reason "can we have them appear in the
  actual chat history" cannot be answered by the UI as it stands.

### How a band is produced

- **V.** Bands are an LLM judgement on the analysis model (`framework_fidelity.py:87-96`), prompt
  `fidelity-r2` (`:71`). The **criteria** are rendered from the framework's own constructs:
  summary, numbered moves `[<key>.<n>]`, "Counts against it" (`avoid`), and the evaluation hint
  (`criteria_block`, `:181-211`). The **banding rule** is a code constant (`BANDING_RULE`, `:226-241`):
  *strong* = a move distinctive of this construct, cited by id; *partial* = only generic good tutoring,
  an incomplete distinctive move, or one undercut by an `avoid`; *absent* = neither.
- **V.** Two deterministic post-rules: a *strong* citing no valid move id of its own construct is
  downgraded to *partial* and marked `downgraded` (`:395-397`); score is the fixed map
  absent=0 / partial=1 / strong=2 (`:80`). The **overall band is the model's own**, not derived from the
  construct bands (`:409`). `assessedIn: unit` constructs are not asked and are listed in `notAssessed`
  (`:165-178`).
- **V.** None of the transparency already in the payload reaches the screen: `moves`, `downgraded`,
  `notAssessed` and `promptVersion` are returned (`:308-316`, `researcher_view` `:333-334`) but the table
  renders only band, rationale and evidence (`TeachingApproachSection.tsx:95-104`). The criterion text is
  not shown at all.

### Can researchers edit the criteria or correct a judgement?

- **V, criteria: yes, indirectly.** A researcher can edit constructs, moves, `avoid` and
  `evaluationHint` in the framework structure editor (`/teacher/research/frameworks`,
  `FrameworkStructureEditor.tsx:309-322`), stored in `framework_overrides` with `version` incremented on
  every save (`backend/db/framework_overrides.py:74-100`) and read back by `effective_framework`
  (`:103-150`), which the judge uses (`framework_fidelity.py:423`). **By design the same text also
  instructs the tutor** (module docstring `:21-26`); an edit changes both. The banding rule is not editable.
- **V, versioning gap.** The run id is `session__fidelity:<fw>__fidelity-r2`
  (`analytics/rubric_runs.py:37-40`). It carries **no framework version**, so (a) after a criteria edit the
  cached read is still served (`_cached`, `framework_fidelity.py:505-510`, re-scored only when the message
  count grows, `:520`), and (b) a stored run cannot say which criteria it was judged against.
- **V, override: no.** There is no route, store or control to correct a band. Worse for evidence:
  `record_rubric_run` **overwrites** the Firestore run doc in place on every re-score (`rubric_runs.py:51-76`,
  `set_document` on a deterministic id), and the report re-scores whenever the session grows. The
  BigQuery mirror (`aipla_rubric_run`, `:78-103`) is append-only and is the only history today.

### Why "43 appears too often" — candidate readings

| | Reading | Mechanism | Status |
|---|---|---|---|
| **A (leading)** | One turn cited by **several constructs** of the same session | Nothing in the prompt discourages reuse; a judge anchors every construct on the single richest exchange, so one id fills the Turns column | H — M0 Q2 |
| B | 43 recurs in the **"N tutor / M student turns"** line across sessions | The dialogue window is capped at 80 turns (`MAX_TURNS`, `:84`); every long session is scored on an 80-turn window, so tutor counts cluster (proactive sim turns make tutor > student, e.g. 43/37) | H — M0 Q5 |
| C | The judge prefers **the last tutor turn** | Sessions of similar length (a seminar, same activity) put the final tutor turn near the same position | H — M0 Q3 |
| D | Ids the judge **invented** | No range check (`:392`); an id ≥ the session length would be a hallucination | H — M0 Q3 (`out_of_range`) |
| E | Not the judge at all: M looked up `#43` in the transcript | Index-space mismatch above; the same `#43` row is what a reader lands on whatever is cited | V that the mismatch exists; H that it explains the remark |


## M0 results — prod, read 2026-10-05 evening

**"19.43.47" located.** It is the `data` construct of the toulmin run on session `f1c333c9…`
(`woody-beetle-71`, *Den hoppende bold*), latest emission 11:47 CEST: `"evidence": [19, 43, 47]`.
That run's other constructs cite `claim [7, 13, 27]`, `warrant [27]`, `backing [35]`,
`qualifier [43]`, `rebuttal [41, 43, 47]` — **43 is cited by three of six constructs**, which is
*"43 appears too often"* (reading A). Across all prod runs, 43 is not unusual (11th most cited).

**Why turn 43 "wasn't in the list" (verified):** the judge's 43 is the **0-based position in the
list of student + tutor messages**; the transcript the researcher reads labels turns by ADK
`turn_index`. Position 43 is transcript **#98** (*"Det er en skarp observation — ud fra dette
specifikke forsøg…"*), 19 is #50, 47 is #106. Every cited position is **odd**, i.e. a tutor
turn — correct for a fidelity rubric, but nowhere stated. The free-text `drift` field uses a
**third** numbering (*"Turns 1-17"*, *"Turn 37"*, *"Turns 44-55"*).

**Why it reads as confusing (M, 2026-10-05: *"what is it actually assessing — was it all
three?"*):**
- The run judges **the tutor's fidelity to Toulmin**, not the student's argument. The page does
  not say so; a researcher reading "Data: partial, 19 · 43 · 47" naturally reads it as the
  student's data-use, scored from three student turns.
- "Evidence" lists the turns the judge drew on for that construct, not three turns that each
  scored "partial". The band is one judgement per construct.
- The session was **judged three times in ~60 s** (11:46, 11:46, 11:47, model
  `gemini-3.8-flash`, prompt `fidelity-r2`), with very different evidence — one emission cited
  almost nothing. Firestore keeps only the last; nothing shows that runs differ.

**UI requirements this adds to M2 (show the working):** a one-line header per run — *"Judges
the tutor's moves against Toulmin. Student turns are context, not scored."*; cited turns shown
as the **transcript's own numbers** and as quoted snippets, clickable, never bare integers;
"band = one judgement per construct, evidence = the tutor turns it rests on" in the legend;
and when a session has more than one run, say so and let the researcher compare them.

## Implementation notes (2026-10-05)

Built M1–M5 plus the M0-results UI requirements. Not deployed; nothing read or written on any env.

- **M1 — one turn identity (`fidelity-r3`).** `SessionTurn.turnIndex` carries the emitter's ADK event index on
  both paths (BQ `turn_index`; live `enumerate(session.events)`). `dialogue_units` cites it when every turn has a
  unique one, else falls back to position for the whole session and says so (`evidenceSummary.idScheme`; covers the
  Q4 duplicate hazard). Prompt asks for `{"turn", "quote"}` per citation, adds "one turn per construct unless it
  holds a move of each" (M0 confirmed reading A) and asks drift lines to name turns as `#<id>`. The parser rejects
  ids outside the scored window (`rejectedEvidence`) and marks each quote `verified` (whitespace/case-normalised
  substring; an elision splits it and the fragments must appear in order). r1/r2 runs are translated at read time
  (`present_constructs`, `idScheme: "position-translated"`); no stored run is rewritten.
- **M2/M3 — show the working.** New `FidelityConstructDetail.tsx`: header *"Judges the tutor's moves against X.
  Student turns are context, not scored."*, legend (band = one judgement per construct; turns = what it rests on),
  the banding rule in plain words, prompt/criteria/model/when and "judged on N of M messages", the criterion per
  construct with cited moves marked, `downgraded`, `notAssessed`. Each citation is `#N` (the transcript's number)
  + the judge's quote (or a snippet for older runs) + an "unverified" marker; clicking opens the transcript and
  scrolls to/highlights `id="turn-N"`. Researcher transcript rows carry a "cited by: …" badge. Teachers get none of
  it — the payload gate is unchanged (`teacher_view`).
- **Several runs visible.** `GET /api/research/sessions/{id}/fidelity-runs` returns the run store's rows AND the
  BigQuery mirror's full history, with `emissionsStatus: "unreadable"` kept apart from "no runs"; the UI's
  "Compare every run" table shows each judgement as a column. Root cause of the three-in-a-minute judging: the
  12 s live poll re-judged on every message-count increase. Fixed with the narrative's 5-minute debounce
  (`RESCORE_MIN_INTERVAL_S`; Refresh still forces) and single-flight for concurrent reads.
- **M4 — reviews.** `db/rubric_reviews.py` (create + list only), routes `POST|GET
  /api/research/rubric-runs/{run_id}/reviews` in the new `protocols/rubric_review_routes.py`, BQ mirror
  `aipla_rubric_review` (reviewer by uid only), explicit Firestore deny rule, sink filter extended in
  `infrastructure/modules/chat-logs/variables.tf` and `scripts/bootstrap-aipla-dev.sh`. UI: "Correct this" per row,
  AI's read and the correction side by side, history, "reviewed against an earlier judgement".
- **M5 — criteria version.** `rubric_version = fidelity-r3+fw<version|yaml>` (`db.framework_overrides.criteria_version`,
  custom approaches use their own row version); `_cached` looks up the current version, so an edit yields a new run
  beside the old one. The report says which criteria it was judged against and flags `criteriaChanged`.

**Deviations / not done:**
- No "re-score against vM" button: the cache now misses on its own after a criteria edit, so the next report read
  re-judges against the current criteria; a stale-criteria run is only reachable in the run history.
- Criterion text is served from the framework *as it stands now* (no snapshot per version); the UI flags when the
  run's version differs. Reverting an override and editing again restarts its `version` at 1, so `fw1` can name two
  editions — a hash would not, but the doc asked for the editor's version number.
- Researcher routes use the `auth` dispatcher + `assert_researcher` (the "Do not" list), so a real group token gets
  **403**, not the 401 the Tests section mentions.
- **Needs M:** `make tf-plan`/`tf-apply` per env for the sink filter (until then reviews reach Firestore but not
  BigQuery); Firestore rules reach prod only via the dev/test deploy path (footgun table); open questions 3–5
  (implemented as annotation-only, shared visibility among researchers, `MAX_TURNS` unchanged).

## Decision

### Options

1. **UI-only:** show criterion text, moves and quotes; leave numbering. Cheap, but the links still land on
   the wrong turn. **Rejected** — it would make a wrong citation look more authoritative.
2. **Translate on the client:** map dense position → `turn_index` in the browser. Works only when both
   lists are the same list, and silently breaks on the fallback path or any filter difference. **Rejected.**
3. **One turn identity end to end (recommended).** The judge cites the emitter's `turn_index` — the `#N`
   researchers already see — carried on `SessionTurn`. New prompt version `fidelity-r3`; stored r2 runs are
   translated server-side once (position p → `conversation[p].turn_index`, deterministic because the
   conversation is append-only and BigQuery-ordered). The judge also returns a short **verbatim quote** per
   cited turn, verified server-side as a substring of that turn.
4. **Overrides:** (a) mutate the run doc — **rejected**, it destroys research evidence and is overwritten on
   the next re-score anyway; (b) store a review as another rubric run — **rejected**, run ids are
   deterministic and overwrite, which is the opposite of append-only; (c) **an append-only review
   collection keyed to the run id (recommended)**, the shape `concept_progress` already uses (append-only
   records, derived status, teacher precedence — see 1.1.144). The run store stays the judge's record; the
   review store is the human's.
5. **Criteria versioning:** reuse the RUBRIC-2 pattern (`{lens}-r{n}` bumped on edit,
   `research_lens_routes.py:148-181`): the run's `rubric_version` becomes
   `fidelity-r3+fw<framework version>` (YAML-only frameworks: `+fwyaml`). A criteria edit then yields a new
   run beside the old one, and the cache misses honestly. **Do not** split judge criteria from tutor
   instruction; one source is the stated property of 1.1.91.

**Recommendation:** options 3, 4c and 5, in milestone order below. M0 first: if reading A or D is
confirmed, M1's quote check and a "one turn per construct unless the same move" prompt line follow from it.

## Milestones

### M0 — Evidence from prod (~0.25d, **M runs these; agents do not read prod**)

All read-only. `chat_turns` is the view; the raw tables mirror `summarize_session_bq` exactly. Q2, Q3 and Q5 reuse the `runs` and `cites` CTEs from Q1 (prepend them).

```sql
-- Q1: which turn ids the judge cites, latest emission per run
WITH runs AS (
  SELECT jsonPayload.run_id AS run_id, jsonPayload.session_id AS session_id,
         jsonPayload.rubric_version AS v, jsonPayload.profile_json AS p
  FROM `aipla-prod-2026.chat_logs.aipla_rubric_run`
  WHERE STARTS_WITH(jsonPayload.rubric_id, 'fidelity:')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY jsonPayload.run_id ORDER BY timestamp DESC) = 1),
cites AS (
  SELECT run_id, session_id, SAFE_CAST(TRIM(x) AS INT64) AS pos
  FROM runs, UNNEST(REGEXP_EXTRACT_ALL(p, r'"evidence": \[([^\]]*)\]')) AS lst, UNNEST(SPLIT(lst, ',')) AS x
  WHERE TRIM(x) != '')
SELECT pos, COUNT(*) AS cites, COUNT(DISTINCT session_id) AS sessions
FROM cites GROUP BY pos ORDER BY cites DESC LIMIT 25;

-- Q2 (reading A): how often one turn is cited by >1 construct in the same run
-- reuse `cites` above, but keep the construct: REGEXP_EXTRACT_ALL(p, r'"([a-z0-9_]+)": \{"band"[^}]*"evidence": \[([^\]]*)\]')
-- then: SELECT run_id, pos, COUNT(*) n_constructs ... HAVING n_constructs > 1

-- Q3 (C, D): cited position vs session length, and the turn it really points at
WITH pos AS (
  SELECT jsonPayload.session_id AS session_id, CAST(jsonPayload.turn_index AS INT64) AS turn_index,
         jsonPayload.role AS role, SUBSTR(jsonPayload.content, 1, 120) AS snippet,
         ROW_NUMBER() OVER (PARTITION BY jsonPayload.session_id ORDER BY CAST(jsonPayload.turn_index AS INT64)) - 1 AS position,
         COUNT(*) OVER (PARTITION BY jsonPayload.session_id) AS n
  FROM `aipla-prod-2026.chat_logs.aipla_chat_turn`)
SELECT c.session_id, c.pos, p.n, c.pos >= p.n AS out_of_range, c.pos >= p.n - 2 AS near_end,
       p.turn_index AS transcript_hash_n, p.role, p.snippet
FROM cites c LEFT JOIN pos p ON p.session_id = c.session_id AND p.position = c.pos
WHERE c.pos = 43;

-- Q4 (ordering hazard): duplicate turn_index rows would shift every position after them
SELECT jsonPayload.session_id, jsonPayload.turn_index, COUNT(*) FROM `aipla-prod-2026.chat_logs.aipla_chat_turn`
GROUP BY 1, 2 HAVING COUNT(*) > 1 LIMIT 50;

-- Q5 (reading B): the tutor/student counts shown on the Overall row
SELECT JSON_VALUE(p, '$.evidenceSummary.tutor') AS tutor, JSON_VALUE(p, '$.evidenceSummary.student') AS student,
       JSON_VALUE(p, '$.evidenceSummary.truncated_from') AS truncated_from, COUNT(*) AS runs
FROM runs GROUP BY 1, 2, 3 ORDER BY runs DESC;
```

Record results in this doc under "M0 results". Firestore `rubric_runs` holds only the latest emission per
run, so BigQuery is the source for any history.

### M1 — One turn identity (~1d, P1)

- `SessionTurn` gains `turn_index: int | None` (alias `turnIndex`); `summarize_session_bq` keeps it;
  `summarize_session` (live fallback) sets it to the `enumerate(session.events)` index — the same
  definition the emitter uses (`callbacks/session.py:150`).
- `DialogueUnit.index` becomes that `turn_index` (falling back to position only when null, flagged in
  `evidenceSummary.idScheme = "position"`). `PROMPT_VERSION = "fidelity-r3"`.
- Prompt asks, per construct, for `"evidence": [{"turn": <id>, "quote": "<≤25 words verbatim>"}]`.
  The parser keeps only ids present in the dialogue window (others go to `rejectedEvidence`), and marks each
  quote `verified` iff it is a whitespace-normalised substring of that turn's content.
- r2 runs: a read-time translator maps position → `turn_index` using the summary's conversation, and labels
  them `idScheme: "position-translated"`. No stored run is rewritten.
- Payload shape (researcher view): `constructs[k].evidence: {turn, quote, verified}[]`; the frontend type
  in `lib/teacherApi.ts:310-324` follows.

### M2 — Transparent construct detail (~1d, P1)

In `ConstructDetail`: per row, an expandable **criterion** (the construct's summary, its numbered moves with
the cited ones marked, `avoid`, evaluation hint — served from `effective_framework` with the run's framework
version), the **quote** (with an "unverified" marker), `downgraded` when present, and each turn as a link
`#<turn_index>`. A footer states the banding rule in plain language, the prompt version, judge model, and
`notAssessed` constructs with their reason. Copy in `messages/{da,en}/teacher-classes.json`.

### M3 — Turn references in the chat history (~0.5d, P2)

`ChatLogTranscript` rows get `id="turn-<turn_index>"`; clicking a citation opens the transcript
(`page.tsx:121-135`), scrolls to and highlights the row. For a researcher, each cited turn carries a small
badge listing the constructs that cite it ("cited by: recognise, use"), so the chat reads as evidence, not
only the table. Teachers see neither (fit is not quality, 1.1.65 R1).

### M4 — Researcher review, append-only (~1.5d, P2)

- `db/rubric_reviews.py`, Firestore `rubric_reviews/{auto-id}`, **create-only** (no update, no delete
  route): `run_id`, `rubric_version`, `construct_key` (or `overall`), `judged` = snapshot of the judge's
  band/evidence/rationale at review time, `band` (researcher's), `evidence` (turn ids), `reason`
  (required, ≥ 10 chars), `reviewer_uid`, `reviewer_email`, `created_at`, `supersedes` (optional review id).
  The effective band is the latest review for that run+construct, else the judge's; both are always shown.
- Mirror to BigQuery as `aipla_rubric_review` via `observability/chat_log.py`; add it to the sink filter in
  `infrastructure/modules/chat-logs/variables.tf:43` (Terraform: `make tf-plan`/`tf-apply` per env).
- Routes, `assert_researcher`: `POST /api/research/rubric-runs/{run_id}/reviews`,
  `GET …/reviews`. Firestore rules: deny client access to the collection.
- UI: per construct row, "Correct this" (band select, turn ids, reason) and a review history. A judge
  re-score after review shows "reviewed against an earlier judgement" when the snapshot differs.

### M5 — Criteria version on every run (~0.75d, P2)

`rubric_version = f"{PROMPT_VERSION}+fw{version or 'yaml'}"`, framework version also stored on the result;
`_cached` computes the current version before lookup; the report shows "judged against criteria vN" and,
when the live framework is newer, a researcher-only "re-score against vM" action (`force=True`). The
banding rule stays code (changes bump the prompt version, as today).

## Acceptance criteria

- [x] For a session with tool events between messages, every cited id in the construct table equals a `#N`
      visible in the report transcript, and clicking it scrolls to that exact message.
- [x] A cited id not in the scored window never renders as a link; it is listed as rejected.
- [x] Each cited turn shows a quote; a quote not found in that turn is marked unverified.
- [x] The construct row shows the criterion text the judge was given, including move ids, and `downgraded`.
- [x] A researcher can record a corrected band with a reason; the judge's original stays visible and
      unchanged in `rubric_runs` and BigQuery; there is no route that edits or deletes a review.
- [x] A teacher (non-researcher) receives neither bands, quotes, citations nor reviews (payload, not just UI).
- [x] After a framework structure edit, the next report read produces a new run with a new
      `rubric_version`; the old run is still listable.
- [x] r2 runs render with translated ids, labelled as such.
- [x] `make check-client-api` passes with **no** new allowlist entry.

## Tests

- `tests/unit/analytics/test_framework_fidelity.py`: ids are `turn_index` with sparse fixtures
  (0, 1, 3, 6); out-of-window ids rejected; quote verification (match, whitespace, miss); r2 translation;
  version string includes framework version.
- `tests/unit/test_session_summary.py`: `turn_index` survives both BQ and live paths and equals the
  emitter's index for the same event list (one fixture fed to both `callbacks/session` logic and
  `summarize_session`).
- `tests/unit/test_rubric_reviews.py`: create-only; snapshot recorded; effective-band precedence;
  researcher-only (403 for teacher, 401 for a group token through the real dispatcher, per
  `test_dual_auth_rejection`).
- Frontend: `TeachingApproachSection.test.tsx` (criterion, quote, unverified marker, link target ids);
  `ChatLogTranscript` anchors and "cited by" badges; review form posts the complete payload.
- **End-to-end** (`tests/api_tests/test_assessment_citation_reaches_the_transcript.py`): seed one session
  with interleaved tool events, a stubbed judge citing a real `turn_index`; call the group report route **and**
  the timeline route against one store; assert the cited id resolves to the same message content in both.
  Then POST a review and re-read: judge band unchanged, review present. This is the two-ended wiring test the
  footgun table asks for; unit tests on either half alone passed while this bug shipped.

## Handover to a cloud agent

- **Read first:** `backend/analytics/framework_fidelity.py`, `backend/reports/session_summary.py`,
  `backend/adk/callbacks/session.py:130-200`, `backend/analytics/rubric_runs.py`,
  `backend/db/framework_overrides.py`, `frontend/src/components/teacher/TeachingApproachSection.tsx`,
  `frontend/src/components/teacher/research/ChatLogTranscript.tsx`, `app/teacher/reports/groups/[groupId]/page.tsx`.
- **Commands:** `cd backend && make lint && make test-fast`; `cd frontend && npm run quality:check`;
  `make check-client-api`, `make check-auth-dispatcher`, `make check-i18n`, `make check-routes-tracked`;
  `make test-frontend-ci-node` if the transcript remembers state in `localStorage`. After pushing, check the dev
  build (`gcloud builds list --project=aipla-dev-2026 --region=europe-north1`).
- **Mounted UI is required.** Every new client function (`postRubricReview`, `listRubricReviews`) must have a
  call site in a page a researcher reaches. *"A whole stack ships with the control unmounted"* has fired five
  times; `make check-client-api` enforces it, and a test is not a call site.
- **Do not:** mutate or delete any `rubric_runs` doc or BigQuery row; add an edit/delete route for reviews;
  rewrite stored r2 runs; split judge criteria from the tutor instruction; expose bands or citations to a
  teacher; import `get_current_user` from `auth.firebase_auth` (use `auth`); read prod data; hand-edit the
  generated `docs/design/aipla/tutors/*.md`; change `MAX_TURNS` without a prompt-version bump.
- Sink filter change in Terraform needs `make tf-plan ENV=test|prod`; it is not covered by `cloudbuild.promote.yaml`.

## Boundary with 1.1.144

1.1.144 owns the **tutor's** per-concept level (`assess_concept`) and its teacher override in
`concept_progress`. This doc owns the **after-the-fact fidelity judge** of the tutor's approach. They share
the principle (append-only human records, model judgement preserved) and should share UI vocabulary
("the AI's read" / "your correction"), not a store.

## Open questions for M

1. Was "19.43.47" read off the construct table's Turns column (rendered "19, 43, 47"), or another screen?
2. "43 appears too often": within one session's table (A), on the overall-row turn counts (B), or across groups?
3. Should a researcher's correction feed back into anything (e.g. a calibration set for the judge, BENCH-3), or
   stay annotation only? This doc assumes annotation only.
4. Should corrections be visible to other researchers by default (shared adjudication), or per reviewer with
   inter-rater agreement computed later?
5. Is the judge's 80-turn window acceptable for seminar-length sessions, or should long sessions be scored in
   segments (which would change what "overall" means)?
