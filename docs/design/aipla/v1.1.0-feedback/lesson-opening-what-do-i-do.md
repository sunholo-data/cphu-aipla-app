# "What do I do?" — a lesson opening the teacher owns and the tutor defaults

**Status:** **M1–M5 implemented locally, unreleased (2026-10-23)** — **1.1.153**. M6 product guide drafted; pedagogical review, browser QA, M0 and M7 remain open.
**Priority:** **P1**. In the session behind the 2026-10-22 notes, *every* student's first question was "What do I do?". That is the first thing a student meets in every activity, and the November school visit and the March teaching block both depend on it. Un-gated
**Estimated:** ~4–4.5d phased (M0 evidence ~0.25d, M runs the SQL · M1 remove the prompt rules that forbid orientation ~0.5d · M2 the activity's own "How to get started" panel ~1d · M3 teacher-authored opening + tutor self-introduction ~1d · M4 customisable starter prompts ~0.75d · M5 co-pilot proposes both ~0.5d · M6 teacher guide "Introducing the tutor to your class" ~0.5d + JB review · M7 release + re-measure ~0.25d)
**Scope:** Backend: `adk/proactive_greet.py`, `skills/templates/concept-dialogue/SKILL.md` (`initialMessage`, `openingTemplate`), `db/models/activity.py` + `db/models/activity_config.py` (two optional fields, mirrored), `protocols/activity_routes.py` (`ActivityUpsert`), `protocols/activity_config_routes.py` (`GET /active/{activity_id}` returns an `opening` block), `adk/authoring_tools.py` + `adk/tools.py` (two proposal tools). Frontend: `components/chat/PinnedWelcome.tsx`, `components/chat/ChatMessageList.tsx`, `hooks/useActivityBuilder.ts`, the activity builder page, `app/teacher/activities/applyCopilotProposal.ts` + `_AuthoringCopilot.tsx`, `messages/{da,en}/chat.json`. Content: a new `frontend/content/guides/t5-introduce-the-tutor.md` + `.da.md`
**Dependencies:** [1.1.149 tutor-directs-to-workbench](tutor-directs-to-workbench.md) (**implemented M1–M5, unreleased**. Its per-turn affordances block and rule (b) "when the student is stuck … send them to the item" are the *mid-lesson* half of this problem, and this doc does not duplicate them); 1.1.72 ([pilot-week-tutor-fidelity-sprint.md](pilot-week-tutor-fidelity-sprint.md), the activity facts in the opening) / [1.1.127 opening-guidance-only-on-the-opening-turn](opening-guidance-only-on-the-opening-turn.md) (the opening block's per-turn scoping, which M1 edits); [1.1.126 tutor-knows-its-own-name](tutor-knows-its-own-name.md) (**shipped**, the identity block the self-introduction reads); [1.1.108 content-localisation](content-localisation.md) (copy in `messages/{da,en}`, language from `activity.language`); [1.1.124 teacher-onboarding-scaffold](../v2.1.0-extension/teacher-onboarding-scaffold.md) (**shipped**. It onboards the *teacher* to the platform, while this doc onboards the *student* to a lesson); the full-overwrite activity PATCH (CLAUDE.md footguns)
**Created:** 2026-10-22
**Source:** [notes-2026-10-22.md](../../../notes-2026-10-22.md), M, verbatim: *"no scaffolding for the lessons, students dont know what o do, no introductions, walk through etc."* · *"everyones first question is 'What do I do?' - should the teachers design in the activites. do we take agency away from the teachers"* · *"the drop down prompt shoudl be customisaable"* · *"how to equip the teachers to introduce the AI tutor well. tutor should introduce itself though, be more proactive. the teacher points a finger to explain."*

## Implementation progress — 2026-10-23

**M1–M5 are implemented locally.** The greeting names the tutor as an AI that
helps students think, combines the activity and first action, and closes with
one question. The first-message fallback explicitly allows an answer to “What
do I do?” All four student tutor templates carry self-introduction guidance.
Models and reasoning settings are unchanged.

The active-config response supplies an `opening` block only for a resolved
activity. The structured `firstItem` comes from the same selector as the greet;
the teaching goal remains private. The panel shows teacher Markdown verbatim
when present; otherwise it renders the activity title, first item, checklist
steps and tutor-help line from the locale catalogue. Starter questions send
real student turns, with the sim's pending state flushed first; there is no
trust card for sending a message. Standalone chats retain the skill welcome.
Collapse state is per activity, and the privacy notice remains visible when
collapsed.

The builder has a live opening preview, `studentOpening`, `starterPrompts`
(up to four, 120 characters each) and `openingByTeacher`. All three fields
survive hydration, unrelated saves and the Activity → ActivityConfig adapter.
The classroom-introduction option keeps the tutor's self-introduction and
skips its walkthrough. Teacher text enters the greeting as bounded, quoted
context, not instructions. The two co-pilot tools are owner-scoped proposals:
the teacher edits and Applies them, then saves. They never persist directly.

**M6 is drafted, not signed off.** T5 is a bilingual, provisional guide to the
product controls, linked from T2. Its classroom advice awaits JB/teacher
review. The onboarding checklist includes a student-opening preview reminder;
S1 and the help tutor describe the changed opening. Screenshots, printable
PDFs and guide-corpus seeding await browser QA and release. Changed skill
templates need seeding when released (automatic on deploy).

Validation: **4,985 backend fast tests and 2,671 frontend tests passed**.
Backend lint/format, frontend lint/typecheck/content checks, localisation,
client-API and stream-allowlist gates, and the production frontend build passed.
Tests cover a real signed group token through the real auth dispatcher,
full-overwrite survival, all greeting handoff quadrants, mounted builder
controls, editable co-pilot proposals and exact starter-question sends. A
synthetic activity also round-tripped through the running local frontend proxy.
**Visual browser verification remains pending:** the computer-use connection
could not access a browser window.

`make eval-lesson-opening` checks the real `create_agent` factory with the
existing template model on default, teacher-authored and classroom handoff
openings. Each variant covers `[session_start]` and “What do I do?” without a
greeting. All six passed in the final live run (2026-10-23). It uses synthetic in-memory data and checks the saved eval results
because ADK's CLI can exit zero on failed criteria; generated history is ignored.
No classroom or production data was read. M0's production baseline still
belongs to M. No deploy, production query or seed has been run; M7 release and
classroom re-measurement remain open.

## Problem Statement

A student opens an activity and does not know what to do. Nothing on the screen
says it, and the tutor's first turn does not say it either. They ask, and every
student asks the same question. The notes frame the fix as a choice between
*the tutor does more* and *the teacher designs it in*, and they name the risk
on the tutor side: **taking agency away from the teacher**.

This doc establishes from the code that the gap is **designed in**. Every layer
that could orient the student is explicitly told to be brief, generic or silent.
It then proposes a split that keeps the teacher in charge: **the teacher can
author the opening, and when they don't, the platform supplies a concrete,
activity-specific default instead of a generic one.**

## Findings

Every finding is **verified against code** on 2026-10-22 unless marked
*hypothesis*. None is verified against the session's data, which is what M0 is
for.

### F1. The "How to get started" panel is the skill's, not the activity's, and it describes the wrong kind of lesson

The collapsible panel above every student chat is `PinnedWelcome`, headed
**"Sådan kommer du i gang" / "How to get started"** (`messages/da/chat.json:42`,
`components/chat/PinnedWelcome.tsx:91`). Its body is the **skill's**
`initialMessage` (`ChatMessageList.tsx:351-352`, fed from `useSkillMeta(skillId)`,
`app/chat/[...path]/page.tsx:463`). It is not the activity's.

Every teacher-built activity runs `concept-dialogue` (1.1.149 F1), so every
teacher-built activity shows the same panel (`concept-dialogue/SKILL.md:24-34`):

> **Hej!** Jeg er din samtale-tutor. Vi skal *udforske et fysik-begreb sammen* —
> **ikke regne en bestemt opgave.** … Du kan fx skrive: **"Hvad betyder
> energibevarelse egentlig?"** … Hvad vil du gerne forstå bedre? 👇

That is wrong in three ways for a teacher's lesson:

- It tells the student the lesson is open-ended ("explore a concept, not a
  specific task") when the teacher set a specific one, with a sim and a table.
  This is the same contradiction 1.1.149 removed from the *prompt*, still
  present on the *screen*.
- It names neither the activity, nor the sim, nor any element, nor the tutor's
  persona name ("din samtale-tutor", where the student sees Sofie's avatar
  beside it).
- **It is Danish whatever `activity.language` says**, and its last line
  promises *"I will match the language you write in"* (`:33`). That is the
  browser-style inference that 1.1.108 M4 rules out: language is chosen, never
  inferred.

There is **no teacher-editable field** for it. `teachingGoal` is tutor-facing
only: it does not reach any student surface (grep of `frontend/src` outside
`teacher/` finds it only in the builder hook and the API client).

**This is almost certainly the "drop-down prompt"** in the notes. It is the only
collapsible, drop-down-shaped element on the student chat (the only `<select>`
or menu elsewhere is in `DocumentsPanel.tsx`), it carries the starter prompts,
and its heading is literally "How to get started". **Confidence: medium-high.**
Confirm with M (O1).

### F2. The greeting is capped at two sentences and told not to orient

When the skill opts in (`proactiveGreet: true`, `concept-dialogue/SKILL.md:36`),
the tutor speaks first. Three layers shape that turn, and all three restrict it:

- The skill's `openingTemplate` (`:41-52`): *"Greet them briefly (one short
  sentence), then ASK a single open question … Keep your first turn under three
  short sentences. Do NOT lecture … your job is to lower the barrier to saying
  something."* The Boldkast, KineBot and LED Planck templates say the same.
- The 1.1.72 activity block (`adk/proactive_greet.py:71-81`): *"Open by naming
  what the activity is about and pointing at the first thing to do … **Two
  sentences at most, then one specific question.**"*
- The skill body (`concept-dialogue/SKILL.md:136`): *"Maximum 3 sentences … Every
  response must end with a question."*

So the best possible opening is one sentence of greeting plus one sentence
naming the activity, followed by a question. **No layer asks the tutor to say who
it is, that it is an AI, what it can help with, or what the steps of the lesson
are.** "Lower the barrier to saying something" was the right goal for a
free-form concept chat (the design these templates were written for). It is the
wrong goal for a lesson that has steps, and it produces exactly the student who
does not know what to do and whose only move is to ask.

### F3. When there was no greeting, the first-message block forbids the answer to "What do I do?"

If the greet did not fire (an error, a resumed tab, or a shared group session
where another student opened first), the student's own first message gets the
1.1.127 block (`adk/proactive_greet.py:233-240`):

> *"…answer what they actually asked. **Do not introduce the activity or the
> workbench at length.**"*

When what they actually asked is *"What do I do?"*, the two sentences pull
against each other, and the second is the specific one. *Hypothesis:* this is
why students who asked were not given a clear first step. M0 Q3 checks it.

### F4. A teacher who wants to set the opening has nowhere to do it, short of misusing other fields

The teacher's available levers are: `title`, `teachingGoal` (tutor-only, F1), a
`note` element (`activity_config.py:231-233`, body ≤4,000; it sits *on the
workbench*, beside the chat rather than above it), and the checklist (the steps,
but `_first_element` deliberately names it only when nothing else is on the
bench, `proactive_greet.py:123-158`). A teacher who writes "Start by heating
100 g of water" into the teaching goal is speaking to the tutor, not the student.
No route offers a student-facing introduction.

### F5. The teacher-side material says nothing about introducing the tutor

The guides cover the class, the first activity, materials and the co-pilot
(`frontend/content/guides/t1`–`t4`). None covers **the first lesson with
students**: what to say before they open laptops, what the tutor will and won't
do, and what to do when a student says "it won't tell me the answer". The student
guide `s1-join-and-use-your-tutor.md` exists but **no student surface links to
it** (no reference in `frontend/src`). The notes' "how to equip the teachers to
introduce the AI tutor well" and "some teachers would like a written manual"
point at this gap.

## Goals

**Primary:** a student who opens any activity can see **what the activity is, who
the tutor is, and the first concrete thing to do** without asking, in the
activity's language. The first sentence of the lesson is the **teacher's** when
they wrote one.

**Secondary:** "What do I do?" stops being the modal first student message (M0
baseline, then M7 re-measure). When it is still asked, the answer names a
concrete next step.

**Non-goals:** a guided tour or coach-marks overlay (the "point a finger" item
is a separate doc); changing any framework's moves; the mid-lesson "stuck"
referral (1.1.149 owns it); the tutor operating the workbench for the student.

## Decision

### Options

| | Option | For | Against |
|---|---|---|---|
| A | **Tutor only:** lengthen the greeting into a full self-introduction and walkthrough | One prompt change, no schema | Takes the teacher's lesson opening away from them, which is the agency concern in the notes; the same words for every activity; a long first turn is a wall of text (the notes' "one big blob") |
| B | **Teacher only:** a student-facing introduction field, shown when written | Full agency | Most activities will leave it empty, and an empty field changes nothing for those students. The default is what most students see |
| **C** | **Layered:** the teacher's opening wins wherever it is written; where it is not, a **concrete default generated from the activity's own facts** (not the skill's generic text); and the tutor introduces itself in one line and then hands over to the first step | Agency where the teacher uses it, a real floor where they don't, and one source of truth for what the student is told | Two fields, a co-pilot tool each, and a guide |

**Recommend C.** The teacher's text is never overridden, rewritten or
paraphrased by the tutor. The tutor's default self-introduction says only what
the tutor knows to be true (its name, that it is an AI tutor, the activity
title, the first item).

### The split

| Surface | Teacher wrote an opening | Teacher wrote nothing |
|---|---|---|
| **"How to get started" panel** (above chat, collapsible) | The teacher's opening (Markdown, verbatim) + the starter prompts | A **deterministic** default from the activity's facts: title · "Start with: {first item}" · the checklist labels as numbered steps, if any · "Stuck? Ask {tutor name}" · the starter prompts. No LLM. Copy from `messages/{da,en}/chat.json`, language from `activity.language` |
| **Tutor's first turn** (greet) | One-line self-introduction, then *"{teacher's opening is on screen above}"*-aware: point at the first step, and do not restate the teacher's text | One-line self-introduction (*name, an AI tutor, here to help you think rather than give answers*), then the first step by name, then one specific question |
| **Teacher chose "I'll introduce it in class"** (`openingByTeacher: true`) | The panel shows the teacher's opening if any, and the default otherwise | The greet keeps the self-introduction but **skips the orientation** and asks one question about the activity. The teacher is presumed to have done the orientation, which is their call |

**The panel is built from structured data, not prose from the server.**
`GET /api/activity-configs/active/{activity_id}` gains an
`opening: {text, source: "teacher"|"default", firstItem, steps[], starterPrompts[], byTeacher}`
block. The frontend renders the default's sentences from `messages/{da,en}`, so
no Danish or English string is assembled in Python. That follows the 1.1.108 M4
rule *language is data, text is content, neither is code*. `firstItem` reuses
`_first_element` (`proactive_greet.py:123`) so the panel and the greet cannot
name different first steps.

### Data model

Two optional fields, on **both** `Activity` (`db/models/activity.py`) and
`ActivityConfig` (`db/models/activity_config.py`). The former mirrors the latter
verbatim, so a field added to only one is dropped silently:

- `studentOpening: str = ""` (max 1,500, Markdown, written in `activity.language`)
- `starterPrompts: list[str] = []` (max 4 items, each 1–120 chars)
- `openingByTeacher: bool = False`

⚠️ **Full-overwrite PATCH.** `PATCH /api/activities/{id}` replaces the editable
content with the body (`activity_routes.py:404-437`). All three fields must be in
`ActivityUpsert`, in `useActivityBuilder`'s state, in `toSavePayload()`
(`useActivityBuilder.ts:428-440`) and in the hand-maintained `useMemo` deps list
(`:526-`; that list has already eaten 1.1.61's facets once). A client that omits
them wipes them. M3's tests must include *save an unrelated edit and the opening
survives*.

## Milestones

### M0 — evidence (M runs; ~0.25d)

Read-only, against `aipla-prod-2026.chat_logs.chat_turns` (`role` is `'tutor'` /
`'student'`; a `'assistant'` filter returns zero rows silently, per 1.1.149 M0).
**Set `d` to the date of the 2026-10-22 session**; the notes do not record it.
Paste the result tables into this doc under *M0 results*.

```sql
DECLARE d DATE DEFAULT '2026-10-22';  -- confirm the session date
-- "What do I do?" and close variants, DA + EN. Deliberately broad; Q2 shows the hits.
DECLARE wdid STRING DEFAULT r'(?i)(hvad skal (jeg|vi)( gøre| lave)?|hvad går (det|opgaven) ud på|hvor (skal jeg|starter jeg|begynder jeg)|hvordan (starter|begynder) (jeg|vi)|what (do|should) (i|we) do|where do i start|what am i (supposed|meant) to do|how do i (start|begin))';

-- Q1 per activity: share of sessions whose FIRST real student message is an orientation question
WITH s AS (
  SELECT session_id, activity_id, app_version, content,
         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY turn_index, ts) k
  FROM `aipla-prod-2026.chat_logs.chat_turns`
  WHERE DATE(ts, 'Europe/Copenhagen') = d AND role = 'student'
    AND NOT STARTS_WITH(content, '[')                      -- synthetic sentinels
    AND NOT REGEXP_CONTAINS(group_id, r'^(teacher:|preview)'))
SELECT activity_id, app_version, COUNT(*) sessions,
       COUNTIF(REGEXP_CONTAINS(content, wdid)) first_msg_is_wdid
FROM s WHERE k = 1 GROUP BY 1, 2 ORDER BY sessions DESC;

-- Q2 the first student messages themselves (eyeball the regex; it will miss phrasings)
-- same CTE; SELECT activity_id, content FROM s WHERE k = 1 ORDER BY activity_id;

-- Q3 did the tutor speak first? And what did it answer to an orientation question?
WITH t AS (
  SELECT session_id, activity_id, role, content, turn_index, ts,
         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY turn_index, ts) k
  FROM `aipla-prod-2026.chat_logs.chat_turns`
  WHERE DATE(ts, 'Europe/Copenhagen') = d AND NOT STARTS_WITH(content, '['))
SELECT a.activity_id, a.role AS first_speaker, a.content AS first_turn,
       b.content AS student_q, c.content AS tutor_answer
FROM t a
LEFT JOIN t b ON b.session_id = a.session_id AND b.role = 'student'
             AND REGEXP_CONTAINS(b.content, wdid)
LEFT JOIN t c ON c.session_id = b.session_id AND c.k = b.k + 1 AND c.role = 'tutor'
WHERE a.k = 1 ORDER BY a.activity_id LIMIT 200;
```

Q3's `first_speaker` answers *did the greet fire* (F3). A `student` first speaker
on a `proactiveGreet` skill means the student met the 1.1.127 first-message block.
Also record the `app_version` the students were on, and whether 1.1.149 was in
it.

### M1 — stop forbidding orientation (~0.5d; prompt-only, ships alone)

- `concept-dialogue/SKILL.md` `openingTemplate`: replace "lower the barrier to
  saying something / under three short sentences" with: *introduce yourself in
  one line by the name your instructions give you, say you are an AI tutor who
  helps the student think rather than gives answers, then name the activity and
  its first concrete step, then one question.* Keep the "do not lecture" rule. The
  three sim skills get the same self-introduction line; their walkthroughs are
  already sim-specific.
- `proactive_greet.py:81`: "Two sentences at most" → "Three short sentences at
  most: who you are, the first step, one question."
- `proactive_greet.py:237-239` (F3): keep "keep the greeting to a few words", and
  replace "Do not introduce the activity or the workbench at length" with *"If
  they are asking what to do, tell them the first concrete step on the workbench
  by name. Otherwise do not introduce the activity at length."*
- Remove the *"I will match the language you write in"* line from
  `initialMessage` (`:33`); the panel is replaced in M2 in any case.
- **Tests:** extend the opening-block tests with the self-introduction, the
  three-sentence cap, and the F3 sentence; `test_the_language_directive_precedes_the_opening`
  must still pass.

### M2 — the activity's own panel (~1d)

- `GET /active/{activity_id}` returns the `opening` block (the structured
  default; `source: "default"` until M3 adds the teacher field). `firstItem` is
  from `_first_element`, refactored to return `{kind, title}` rather than an
  English phrase, with the greet's phrase built from the same value.
- `PinnedWelcome` renders `opening` when the session is activity-bound and falls
  back to the skill's `initialMessage` otherwise (the marketplace, the sim skills
  without an activity), so existing behaviour is unchanged where there is no
  activity.
- Copy in `messages/{da,en}/chat.json` (`PinnedWelcome.startWith`,
  `.steps`, `.askTutor`, …), read via `useT()`; `make check-i18n` passes.
- Link the student guide `s1` from the panel ("Sådan bruger du AIPLA") (F5).
- **Tests:** a component test per state (default with sim, default with checklist
  only, no elements, English activity); a route test with a real group token
  through the real dispatcher (the dual-auth footgun).

### M3 — the teacher's opening and the tutor's hand-off (~1d)

- Add `studentOpening` and `openingByTeacher` (data model above). In the builder,
  add a **"What students see first"** section under the teaching goal: a Markdown
  textarea with a live preview of the panel showing the default it replaces, and
  the checkbox *"I'll introduce this activity in class myself"*.
- The greet reads both. With `studentOpening` set, the opening block tells the
  tutor the teacher's text is on screen, and that it should point at the first
  step without restating it. With `openingByTeacher`, the orientation clause is
  dropped and the self-introduction kept.
- The teacher's text never enters the prompt as an instruction: it is quoted as
  *"what the student has been shown"*, inside the existing delimited block, and
  clipped like every other contributor.
- **Tests:** the full-overwrite survival test (above); greet composition per
  quadrant of the split table; `make check-client-api` (the new builder control
  is mounted, not just its client function).

### M4 — customisable starter prompts (~0.75d)

- `starterPrompts` in the builder (up to four, each one line), rendered in the
  panel as tap-to-send chips. A chip **sends a real turn**, so by the
  workbench-element-builder rule there is no trust card.
- Default when empty: three per-language prompts from `messages/{da,en}`.
  *"Hvad skal jeg starte med?"* is deliberately one of them: if everyone asks it,
  the cheapest fix is to make it one tap and make sure it is answered well (M1's
  F3 change).
- **Tests:** chip → `sendMessage` with the exact text; empty list → defaults in
  the activity's language.

### M5 — the co-pilot proposes both (~0.5d)

- `set_student_opening(text)` and `set_starter_prompts(prompts)` in
  `adk/authoring_tools.py`, the same owner-scoped proposal shape as
  `set_lesson_prompt` (`:112-153`); registered in `adk/tools.py`, listed in the
  `activity-authoring-assistant` SKILL.md, and handled in
  `applyCopilotProposal.ts` and `_AuthoringCopilot.tsx` (editable before Apply).
- If proposal results render client-side by tool name, add them to
  `_CLIENT_RENDER_TOOLS` (`adk/stream_redaction.py:90`;
  `make check-stream-allowlist`).
- The co-pilot drafts *from the teacher's goal and elements*; it never applies.

### M6 — "Introducing the tutor to your class" (~0.5d + JB review)

- New guide `t5-introduce-the-tutor.md` + `.da.md` (`guide-maintenance` skill:
  front matter, screenshots on dev, `make check-guides`, PDF via
  `make guides-pdf`, which partly answers *"some teachers would like a written
  manual"*). Outline: what students will see first (the panel and the greeting,
  with screenshots); setting the opening and starter prompts; the five-minute
  classroom introduction (who the tutor is, that it is an AI, that it asks rather
  than tells, the privacy notice, *"if you're stuck, ask it"*); using "Try as
  student" to see the opening before the lesson.
- **The classroom advice is pedagogy, and JB (or the teachers) should write or
  approve it.** An agent drafts the structure and the product facts, not the
  advice.
- Add a step to the 1.1.124 onboarding checklist: *"Preview what your students
  see first"*.

### M7 — release + re-measure (~0.25d)

Promote; at the next classroom session re-run M0 Q1/Q3 and paste the results
beside the baseline. **Success:** "What do I do?" as the first student message
falls from the M0 baseline to under a quarter of sessions, and every tutor answer
to it in Q3 names a workbench item.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A longer opening reads as a wall of text when it streams in fast (the notes' "one big blob") | Medium | Three-sentence cap; the steps live in the panel, not the greeting. Pacing is a sibling doc |
| The default panel names an element title the teacher left blank | Medium | `_first_element` already falls back to the kind ("the table"); render the kind label from `messages` |
| Teachers write the opening as instructions to the tutor ("Make sure they…") | Medium | The builder preview shows it as the student will see it, and the field's hint says "students read this" |
| Old clients wipe the new fields on save | Low after M3 | Full-overwrite survival test |
| A group's shared session (1.1.145) greets once for several students | Low | Out of scope here; the panel is per-student and covers it |

## Open questions

- **O1.** Is "the drop-down prompt" the "How to get started" panel (F1)? If it
  is the input's suggestion list or something else, M4 changes target.
- **O2.** Default for `openingByTeacher`: is the tutor orientation on unless the
  teacher turns it off (recommended, because the floor matters most for teachers
  who do nothing), or off unless they turn it on?
- **O3.** Should the self-introduction say *AI* explicitly in every activity?
  Recommended yes, for transparency with 16-year-olds. Check whether KU legal's
  10-05 privacy request already implies it.
- **O4.** Does the teacher's opening appear in the session report / research log
  as part of what the student was shown? (Recommended yes: it is part of the
  intervention, and Aswin's epistemic-orientation study will want it.)
- **O5.** The three sim skills (Boldkast, KineBot, LED Planck) have hand-written,
  sim-specific `initialMessage` text. When they are hosted by an activity, does
  the activity panel replace it (consistent) or sit beside it (keeps tested copy)?
