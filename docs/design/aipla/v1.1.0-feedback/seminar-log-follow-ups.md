# Seminar log follow-ups — what the 2026-10-05 prod logs showed that the notes did not

**Status:** Design (OPEN) — **1.1.151** · F3 **SHIPPED** 2026-10-05
**Priority:** **P1** for F1 (a teacher's document silently never reached the tutor) and F2 (English tutor for a Danish class) · **P2** for the rest
**Estimated:** ~3.5d phased (F1 ~1.25d · F2 ~0.5d · F4 ~0.5d · F5 ~0.25d · F6 ~0.5d · F7–F9 recorded, not built)
**Scope:** Backend `db/rag_corpus.py`, `protocols/curriculum_routes.py`, `auth/group_routes.py`, `auth/group_id_auth.py`, `adk/teacher_focus.py` / preambles; frontend `components/teacher/MaterialsSection.tsx`, the curriculum library, `components/teacher/ActivityBuilderBody.tsx`, `app/group/page.tsx`; `messages/{da,en}/`.
**Dependencies:** none blocking. Sits beside the six seminar docs (1.1.145–1.1.150), which were each updated with their own *M0 results* the same evening.
**Created:** 2026-10-05
**Source:** the seminar's prod data, read 2026-10-05 evening (`chat_logs.chat_turns`, `workbench_events`, `aipla_rubric_run`, Cloud Logging in `aipla-logs-eu`, Firestore), and M's replies to that read-out the same evening.

## Problem Statement

The seminar notes listed what teachers *said*. The logs show what students *did*: ~250 student
turns in one class (*Fysik C – Energi*, nine group codes, seven activities, tutor *amina* /
Toulmin, `gemini-3.5-flash-lite`). Most of what they hit is covered by 1.1.145–1.1.150. The items
below are not, or were found only in the data.

No 5xx errors and one client error in the seminar window: **the platform stayed up**. Everything
here is a correctness or experience defect that left no error behind, which is why nobody saw it.

## F1 — A teacher's document failed to ingest, and everything said it had succeeded (P1)

### What happened (verified)

*Prompt for Energi.pdf* (teacher upload, `curriculum_docs/b594d415…`, 2026-09-07 11:07 UTC)
describes how to run *"en parret elevsamtale om energibevarelse"* — the teacher's own pedagogy for
the activity. Its RAG upload failed:

```
11:07:49 WARNING db.rag_corpus: RAG upload failed for b594d415…: Expecting value: line 1 column 1 (char 0)
11:07:49 WARNING db.rag_corpus: RAG upload error for b594d415… (returning None)
11:07:50 INFO    protocols.curriculum_routes: Curriculum doc ingested: b594d415… shared=False rag=False
```

`rag_corpus` swallowed the error and returned `None`; the route logged **"ingested"** and returned
200; the document has `docArtifactId: ''` to this day. It is attached to *Den hoppende bold*, so
for **four weeks** every tutor turn on that activity logged
`Cited curriculum doc … has no RAG file yet (pending ingest) — skipping` — **143 times on
2026-10-05 alone**, once per turn. The tutor ran the seminar's busiest activity without the
document the teacher wrote for it, and the word "pending" in that log line is false: nothing will
ever retry.

1 of 44 uploads failed in 30 days on prod. Rare, but silent and permanent. This is CLAUDE.md's
*"a checker answers when it could not read its subject"* in a new place: a failed write reported
as a success.

### Change

- **F1a — the failure is a state, not a log line.** `curriculum_docs` gains `ragStatus:
  "pending" | "ready" | "failed"`, `ragError` (short, no stack), `ragAttempts`, `ragUpdatedAt`.
  The upload route sets `failed` when `rag_corpus` returns `None`, and the route's log line says
  `rag_failed`, not `ingested`. Existing rows: `ready` where `docArtifactId` is set, else `failed`
  (a one-off backfill; dry-run default, `GO=1`).
- **F1b — retry.** `POST /api/curriculum/{id}/reingest` (owner or researcher) re-runs the RAG
  upload from the stored content. Also an automatic single retry with backoff at upload time —
  `Expecting value` is a non-JSON response from the RAG API, the transient shape. Check whether
  `make backfill-curriculum-content` already covers re-upload before writing a new path.
- **F1c — show it (M, 2026-10-05: *"a UI to show it's definitely been ingested"*).** Every place a
  teacher sees a document — the materials list in the builder, the curriculum library — shows its
  state in words: **"Klar — tutoren kan læse den"** / **"Behandles…"** / **"Fejlede — tutoren kan
  ikke læse den · Prøv igen"**. A failed document attached to an activity also shows a warning on
  the activity card and in the class view: the teacher must find out *before* the lesson.
- **F1d — the turn says it too.** `curriculum_retrieval` logs `failed` docs at WARNING once per
  session (not per turn) with the activity id, so a log-based alert can fire.

### Fix the one that exists

After F1b ships: re-ingest `b594d415…` on prod and tell its owner (AR) the activity ran without it
until then. Not before — a manual re-upload now would hide the evidence the backfill needs.

### Tests

`test_curriculum_upload_rag_failure_is_failed_not_ingested` — the RAG client raising
`JSONDecodeError` leaves `ragStatus == "failed"`, the response says so, and the log line does not
say "ingested". `test_reingest_moves_failed_to_ready`. Frontend: the three states render with
their copy in both locales; *Prøv igen* calls the reingest client (and `make check-client-api`
then sees a call site).

## F2 — An English tutor for a Danish class (P1)

### What happened (verified)

Two of the class's activities — *Termisk og kemisk energi* and *Termisk og kemisk energi med
simulering* — have `language: "en"`; the other five are `da`. Titles, table labels (*Målte
værdier*, *Vandets masse*) and students are Danish. Students wrote Danish (*"isen smelter"*,
*"det er svært at se i simuleringen…"*) and the tutor answered in English every turn, as the
language directive (`teacher_focus.language_directive`) instructs: the activity's language wins
unless the student *asks* or uses the DA | EN switch. The code did what it was told; the
configuration was wrong, and nothing in the builder made the wrong value visible.

### Change

- **F2a — fix the two activities.** Set `language: "da"` on `act-bf1d2172007afd30` and
  `act-f3bd4f92a9d089ee` through the builder, **as or with the owner (AR)**. Prod data —
  **not done in the design session; awaiting M's go-ahead.**
- **F2b — make the value visible.** The activity card and the builder header show the students'
  language as a badge (*"Elever: dansk"* / *"Students: English"*). The builder's language field
  sits next to the title, not in a lower section.
- **F2c — say when it looks wrong.** A soft, non-blocking hint in the builder when the activity's
  language is `en` but its title, goal and element labels contain æ/ø/å (or the reverse is
  plainly true): *"Titlen er på dansk, men eleverne får en engelsk tutor. Er det meningen?"* A
  hint, not a guard: KineBot is English for Danish students on purpose (memory: KineBot language).
- **Not changed:** the 1.1.63 decision that the activity's language outranks the language a
  student happens to write in. A student who writes Danish to an English activity may be
  practising English.

## F3 — "untitled" in the tutor's mouth — SHIPPED 2026-10-05

The tutor told students to look at *"datatabellen 'untitled (1)' på din arbejdsbænk"*
(*Effekt og nyttevirkning*, whose table has an empty title — the student's screen shows **no
heading** for it). The element manifest and element-state readers fell back to the English word
`"untitled"` and quoted it as if it were a title.

Fixed: `adk/element_manifest.py::name_element` — a titled element is quoted; an untitled one is
named `Data table no. 1 (no heading on the student's screen — refer to it by what it holds,
never as "untitled")`. Used by every describer in the manifest and by `element_state` (lines,
checklist refusal). Test: `test_an_untitled_element_is_never_given_an_invented_english_name`.

## F4 — "Did you mean …?" for a mistyped join code (P2, ~0.5d)

M, 2026-10-05: *"for mistyped join codes can we do a 'do you mean…?' — if easy?"* Two `401`s on
`/group/join` during the seminar; the typed code is not logged, so the shape of the typo is
unknown.

**It is easy, if the suggestion never searches the code space.** Codes are
`adjective-noun-NN` from two public 100-word lists (`auth/group_id_wordlist.py`); the space is
10⁶ and a join answers "exists / does not" already, rate-limited per IP. A suggestion is safe
exactly when it is **one deterministic correction** of what was typed — then it gives a guesser
nothing a second guess would not.

- **Normalise silently** (no suggestion needed): case, surrounding spaces, spaces/underscores/dots
  for hyphens, a missing hyphen between a known word and the digits, letter O for zero.
  `normalise_code` already lower-cases and strips (`group_id_auth.py:288`); extend it.
- **Snap each word to the word list**: if a word is not in its list and exactly one list word is
  within edit distance 1 (or 2 for words ≥ 6 letters), substitute it. Digits are **never**
  corrected — any other two digits is just a different code.
- **Try the corrected code.** If it joins, the client shows *"Mente du **kind-kettle-86**?"* with
  a *Ja, deltag* button; it does **not** auto-join (a near-miss could be another class's code).
- **Never** search neighbours by digits, never suggest more than one, and a revoked code is
  indistinguishable from unknown (the endpoint's existing privacy rule). Each suggestion attempt
  counts against the same per-IP join rate limit.

Test: `test_join_suggests_one_word_correction`, `test_join_never_corrects_digits`,
`test_suggestion_respects_rate_limit`, `test_revoked_code_not_suggested`.

## F5 — The tutor answered questions about the class it cannot know (P2, ~0.25d)

*"har vi snart fri?"* → *"Vi er næsten igennem"*; *"har vi så fri bagefter?"* → *"Ja, når vi er
helt færdige her, har I fri!"*; *"altså må vi tage hjem?"* → *"Ja, lige om lidt"* — until the
student wrote *"men min lærer siger at vi ikke må tage hjem"*. Also a lost ball, *"nu kan jeg ikke
finde bolden"* → a helpful search. Harmless here; in a real class, a tutor granting permission the
teacher did not is a trust problem.

Change: one line in the shared tutor preamble — *"You do not know the class schedule or the
teacher's rules. Questions about breaks, leaving, deadlines or grades: say the teacher decides,
and return to the task."* Reaches prod by deploy. Add a scenario to the tutor-discrimination
bench (`research/tutor-discrimination/scenarios.yaml`).

## F6 — Things students asked for that do not exist (P2, record + decide)

From the transcripts, verbatim:

| Ask | Today | Proposal |
|---|---|---|
| *"Kan vi nulstille samtalen her?"* | Only a teacher can reset a group session (`reset_group_session`). The tutor said *"Det kan vi sagtens"* and changed nothing | Tutor preamble: say a restart is the teacher's; **decide** whether students get "start forfra" (it splits a group's log — JB) |
| *"kan du opsummere vores snak så jeg kan gemme dem som noter"* | The tutor summarised in chat; nowhere to keep it | A *"Gem som noter"* action into the student's writing surface — fits the 1.1.73 writing element. Decide |
| *"jeg vil gerne samarbejde med de andre. Hvordan kan vi det?"* / *"Hvor kan jeg se det som de andre har lavet?"* | Each device sees its own workbench view; chat is shared but not shown (1.1.145) | 1.1.145 M2 covers the chat; a shared workbench is a separate decision |
| *"hvordan stopper jeg simuleringen"* | The tutor guessed *"stop-knappen i selve simulatoren"* | Check the kettle sim has a visible stop/reset; if it does, the `tutorBlock` should name its controls |
| *"can you make a stimulation for me"* / *"can you change the simulation for this"* | Correctly declined | None — but note students want it (the sim-authoring prompt is teacher-facing) |

## F7 — Possible phase-change sim display defect (P2, verify)

Two groups, independently, on *Termisk og kemisk energi med simulering* (`phase-change`):
*"simuleringen viser også vand sammen med isen der er -20 grader"* and *"der er stadig vand
selvom det hele er fordampet?"*. Either the sim draws liquid water below 0 °C and after full
evaporation, or its picture is ambiguous. **Verify in the browser** (`mcp-app-artefact` skill) at
−20 °C start and after the boiling plateau before changing anything.

## F8 — Tutor language quality on flash-lite (P2, record)

Non-words and Norwegianisms in Danish replies: *kolonoler*, *enhet* (a student corrected it:
*"Enhed er stavet med 'd'"*), *forsvåres*, *aht*, *starttippet*, *arbejdsbenk*, *energikold*,
*hvoppet*. And arithmetic/reading slips: *"170 divideret med 3 giver omkring 56,7, hvilket jo
passer med det, der stod i tabellen før"* (the table said 64); a column read as drop height
giving a bounce over 100 % (1.1.147 M2). All on `gemini-3.5-flash-lite` with no thinking. Input
for the October capability-floor panel (`research/stx-bench/`), not a code change: a Danish
spelling and "compute from the student's table" probe belongs in it.

## F9 — Builder: flag duplicate column labels (P2, ~0.25d)

*"hvorfor står der forsøg to gange under slip A?"* — the table had "Forsøg 1" twice (1.1.147 M2).
On save, the builder warns on duplicate column labels within a table and on an empty table title
when the activity has more than one table. Deterministic; no spellchecking.

## Acceptance criteria

1. A failed RAG upload leaves `ragStatus: "failed"`, is shown as failed wherever the teacher sees
   the document, and can be retried from there; no log line calls it "ingested".
2. A Danish-titled activity set to English shows a visible hint in the builder; the students'
   language is shown on the activity card.
3. A one-word typo of a live code yields exactly one *"Mente du …?"*; a digit typo yields none.
4. The tutor never grants a break, leaving, or a deadline change (bench scenario passes).
5. `make check-i18n`, `make check-client-api`, `cd backend && make lint && make test-fast`,
   `cd frontend && npm run quality:check` pass.

## Handover to a cloud agent

**Read first:** `CLAUDE.md` (footguns: *"A checker answers when it could not read its subject"*,
*"A whole stack ships with the control unmounted"*, the i18n rule), then
`backend/db/rag_corpus.py`, `backend/protocols/curriculum_routes.py`,
`backend/adk/curriculum_retrieval.py`, `backend/auth/group_id_auth.py:280-300`,
`backend/auth/group_id_wordlist.py`.

**Order:** F1 → F4 → F2b/F2c → F5 → F9. F2a, F6, F7 need M.

**Do not:** read or write prod (`aipla-prod-2026`) — F1's re-ingest and F2a are M's; change the
activity-language precedence (1.1.63); auto-join a suggested code; correct digits.

## Open questions for M

1. F2a — change the two activities' language on prod now (as AR's activities), or ask AR?
2. F6 — should students be able to restart a conversation, and save a summary as notes?
3. F1 — alert on `ragStatus: failed` (log-based alert to whom?), or is the UI enough?
4. Was it Tabitha or AR who revoked the codes on 30 Sept (1.1.146 M0)? Same login?
