# Content localisation — the Danish sweep, the locale layer, and the rule that stops it getting harder

**Status:** **P1 — IN PROGRESS 2026-09-28.** Audited against the tree 2026-09-28 (see [Audit](#audit-2026-09-28) — six corrections, one reordering). M0's engineering half + M1 started 2026-09-28, **decoupled from the SH call**: `da.json` lands byte-identical to today's Danish, and the language fixes follow as a reviewable diff to that one file. M2 follows and is sized. M3 is a **decision for JB/AR**, not scheduled work. M4 is a standing rule, in force since 2026-09-11.
**Priority:** **P1** — a researcher's first-contact reaction to the product was *the Danish is confusing*, and the two people whose reactions most shape the programme's view of the platform (SH, and Aswin before her — [1.1.7x](tutor-register-citation-and-language.md)) have both now hit the language layer first. Below the discipline layer (D) because it is finish, not capability; above the rest of C because every later string we write without this in place is one more to extract.
**Estimated:** M0 sweep-as-extraction ~2–2.5d (absorbs the ~1.5–2d "Danish sweep" already on C **and** the deferred ~2–3d M3 of 1.1.7x, because they are the same files read twice) · M1 locale resolution ~0.5d · M2 teacher surface ~2–3d (**gated**) · M3 `/project` in Danish ~1d plumbing + translation (**decision**) · M4 rule + guard ~0.25d (**do first**).
**Scope:** `frontend/src/components/{workspace,chat,teacher,site}`, `frontend/src/app/{lessons,chat,teacher}` — the string surface; `frontend/content/project/` + `frontend/src/lib/projectContent.ts` — the public site; `backend/skills/templates/*/SKILL.md` + `backend/frameworks/*.yaml` — prompt prose; `infrastructure/mcp-sandbox/artefacts/` + `frontend/src/_sim-template/` — sims; `.eslintrc.json` / `scripts/` — the guard.
**Dependencies:** [1.1.7x tutor-register-citation-and-language](tutor-register-citation-and-language.md) (**M1+M2 shipped**, `activity.language` drives the tutor; **M3 deferred — this doc absorbs it**); [1.1.38 activity-elements-palette](activity-elements-palette.md) (**shipped** — the student components to localise); `frontend/content/guides/` `.da.md` twins (**shipped** — the one content surface that already does this right, and the pattern M3 copies); [1.1.91 researcher-configurable-tutors](researcher-configurable-tutors.md) (the frameworks YAML is a new prose surface — M4 applies to it).
**Source:** SH (researcher; granted prod access 2026-09-11) — *the Danish is confusing*. M, same day: *"lets make sure we are not making this more difficult as we go on."* Prior: Aswin 2026-08-06, *"When using English in the setup, the language is still in Danish in students' interface."*
**Created:** 2026-09-11 (M)
**Last Updated:** 2026-09-28 (audit + start of M0/M1)

## Problem Statement

The product speaks two languages and has no idea which one it is speaking.

Language lives in **five layers**, each solved differently, none of them
connected:

| Layer | Where the text lives | How language is chosen today | Swap-ready? |
|---|---|---|---|
| **Tutor turns** | model output, steered by `backend/adk/teacher_focus.py` | `activity.language` (`"da" \| "en"`, default `da`) — **shipped 1.1.7x M2** | **Yes.** Data-driven, per activity |
| **Tutor prompts** | `backend/skills/templates/*/SKILL.md`, `backend/frameworks/*.yaml` | Prose is English *or* Danish by author habit; a "reply in the user's language" line in some | **Half.** The directive is data; the prose is not |
| **App UI** — student surfaces | ~109 Danish literals inline in JSX across `components/workspace`, `app/lessons`, `app/chat`, `components/chat` | Hardcoded Danish. `<html lang="en">` | **No.** An English activity gets an English tutor and Danish buttons (Aswin's report, still true) |
| **App UI** — teacher surfaces | ~104 Danish literals in `components/teacher`, `app/teacher`; the shared co-pilot shell defaults English with Danish overrides per surface | Hardcoded, mixed | **No.** And the mix is itself the confusion — a teacher sees *New class* beside *Anvend* |
| **Public site** `/project` | 15 Markdown pages in `frontend/content/project/` with frontmatter | English only | **Nearly.** Design and text are already separated; the loader just has no locale axis |
| **Sims** | Boldkast, LED Planck (Danish), KineBot (English **by design**) | Hardcoded per artefact | **No**, and partly shouldn't be — see M4 |
| **Guides** | `frontend/content/guides/<slug>.md` + `<slug>.da.md` (Quarto until 1.1.116) | Twin files, shared screenshots | **Yes.** The reference pattern |

Two consequences, both observed rather than predicted:

1. **The Danish is uneven.** It was written by a non-native speaker, one string
   at a time, over four months, on whichever surface was being built that day.
   Register drifts between formal and informal; some labels are literal
   translations of English UI idiom; the co-pilot is Danish inside an English
   frame. SH's reaction is the expected result. **The sweep cannot start until
   someone asks her *which* Danish** — the five layers above are different
   fixes, and "the Danish is confusing" locates none of them.
2. **Every string added since August has made the deferred M3 bigger.** 1.1.7x
   deferred student-UI i18n at ~2–3d in August with the note *"this is the
   milestone that will be under-estimated."* Since then the palette grew
   (table, calculator, checklist, argumentation), the tutor picker shipped, the
   co-pilot shell was migrated — all with inline Danish, because nothing said
   not to. The estimate has not moved only because the same two people write
   most of the strings. When AD starts, that stops being true.

The second consequence is the one M asked about. **This doc's most important
deliverable is not the sweep; it is M4 — the rule and the guard that make the
next string cheap to translate instead of one more to extract.**

## Audit (2026-09-28)

Checked every claim above against the tree seventeen days after writing. The
design holds — activity language as the source, one message layer, twin
content files, a crude guard. Six things did not, and one ordering changes.

1. **The scope was sized by the wrong half.** "~109 Danish literals" counts
   `[æøå]`, i.e. *what an English activity must lose*. It does not count the
   English that a **Danish** activity shows today — the lesson picker's
   *Available activities*, most element chrome, the chat composer. The student
   surface is mixed in **both** directions, so the real job is every visible
   string on it: ~60 files, ~200+ strings, not ~109. The ~2–2.5d estimate
   survives only because most are short labels. The success metric gains a
   twin: the `da` render must contain none of the `en` message values (zero
   `[æøå]` in `en` proves one direction only).
2. **Two student surfaces have no activity yet.** The join page
   (`app/(site)/group`) and the lesson picker (`app/lessons`) render before a
   single activity is chosen, and today they are deliberately bilingual
   (*"Indlæser… / Loading…"*). `my-activities` does not carry `language`.
   **Decision:** the picker takes the class's language when every assigned
   activity shares one (`language` added to `StudentActivitySummary`) and stays
   bilingual when they are mixed; the join page stays bilingual — no class is
   known yet, and rule 3 forbids guessing from the browser.
3. **The locale is resolved on the client, not server-side.** Axiom 1's note
   was wrong: the chat page learns the language from
   `GET /api/activity-configs/active/{id}` after mount, and `<html lang>` is
   written by the server root layout. So: `NextIntlClientProvider` with an
   explicit `locale` (not next-intl's per-request `i18n/request.ts` mode, which
   has no activity to read), both message files bundled (a few KB), and
   `document.documentElement.lang` set on the client when the locale resolves.
4. **The student directory list was incomplete.** Add `app/(site)/group` (the
   join page), `components/protocols` and `components/doc-browser` — all three
   are student-reachable.
5. **The guides reference is stale.** Since 1.1.116 the guides are
   `frontend/content/guides/<slug>.md` + `<slug>.da.md`, not `docs/guides/*.qmd`.
   `r1-researcher-onboarding` and `r2-propose-a-simulation` are English-only
   **without** the rule-2 comment — researcher-facing, so en-only is defensible,
   but it has to be said on purpose.
6. **The sim supply gap is still open.** `GenericArtefactFrame` still passes no
   `hostContext`, so no sim receives `locale`. It moves into M1 proper.
7. **`teacher_prefs.locale` defaulting to `da` would flip the teacher UI.**
   Teacher surfaces are predominantly English today; an absent pref meaning
   `da` turns every existing teacher's product Danish on the day M2 lands.
   Decide the default at M2 with that in view (open question 3 widens).

**Reordering:** M0 no longer waits on the SH call. The call routes *which
Danish to fix*; it does not change the plumbing, and the plumbing makes the fix
cheap — once every student string sits in `messages/da.json`, the native read is
a review of one file, not of sixty components. So: extract with `da.json`
**byte-identical** to today (the snapshot proves nothing moved), author
`en.json`, turn the guard on — then the sweep lands as a diff to `da.json`.

## Goals

**Primary:** a student in an English activity sees an English product; a Danish
speaker reads Danish that a Danish speaker wrote or checked; and **from today,
no new user-facing text is added in a form that a translator cannot reach
without a code change.**

**Secondary:** the public site can carry a Danish edition if KU wants one, at
translation cost rather than engineering cost.

**Non-goals:** a third language (there is no audience — the Indian cohort is
English, which KineBot already is); translating the tutor *theories* in
`backend/frameworks/*.yaml` (they are cited to English-language papers and are
researcher-facing); making Danish the `/project` default.

**Success metrics:**
- SH, or another native reader, reads every student screen in Danish and flags
  nothing she would rephrase. (The acceptance test 1.1.7x named; it has not changed.)
- An activity with `language: en` renders **zero** Danish strings on the
  student surface — asserted by a Vitest render, not a human.
- The guard fails CI on a Danish literal added to a student-surface component
  after M0 lands. Measured the honest way: it was run against the tree *before*
  extraction and failed, then passed after.
- Six months on, the count of hardcoded literals on localised surfaces is still
  zero. That is the metric M actually asked for.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Messages ship in the bundle, resolved server-side per activity. No extra fetch. |
| 2 | EARNED TRUST | +1 | A product that switches language mid-screen reads as unfinished; consistency is a trust signal, and the researcher noticed it first. |
| 3 | SKILLS, NOT FEATURES | 0 | Cross-cutting; no skill changes shape. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Zero LLM involvement. Language stays deterministic config (1.1.7x M2's decision, kept). |
| 5 | GRACEFUL DEGRADATION | +1 | Missing key → Danish fallback, never a raw key. Missing `/project` Danish page → English page with a one-line notice, never a 404. |
| 6 | PROTOCOL OVER CUSTOM | +1 | `next-intl` for UI strings; twin-file convention for content, already proven by the guides. The one bespoke piece (a per-component `copy` object as the *interim* form before extraction) is justified in M4 — it is an extraction-friendly convention, not a lookup system. |
| 7 | API FIRST | 0 | No new endpoints. `activity.language` already rides `ActivityConfig`; a teacher locale preference rides `teacher_prefs`. |
| 8 | OBSERVABLE BY DEFAULT | 0 | — |
| 9 | SECURE BY CONSTRUCTION | 0 | No new data access. Message files are static. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Strings are legitimately client-side; the *choice* stays on server-side config. |
| 11 | USABLE BY DESIGN | +1 | This is the axiom the report is about. |
| | **Net Score** | **+5** | Threshold: >= +4 |

## Standards Compliance Check

**UI strings: `next-intl`, as 1.1.7x already decided.** Verify the current
App Router recommendation at
`https://nextjs.org/docs/app/building-your-application/routing/internationalization`
and the package's Next 15 support on npm before wiring it. **Do not** use
path-prefixed locales (`/da/lessons/...`) — the student's locale is the
*activity's*, not the URL's, and a join link must not change shape (the group
code footgun in CLAUDE.md is about exactly that kind of link).
`next-intl` supports locale-without-routing; that is the mode.

**Content: twin files, as the guides already do.** `<slug>.md` (English,
default) + `<slug>.da.md`, same frontmatter contract, same
`check:project-content` validation. No frontmatter `translations:` block, no
Markdown-in-JSON — the guides' shape is proven and a translator can work in it
with a text editor.

**Not a counter-example:** `voice-pronunciation/units.da.ts` is TTS
pronunciation data, not UI copy. It stays.

## Framework-Native Capability Check

- **`activity.language` already exists** and is already resolved through the
  student's verified group binding (1.1.7x). M1 reads it in one more place.
- **`teacher_prefs` already exists** as a per-teacher settings store; a
  `locale` field is one more key, not a new store.
- **`projectContent.ts` is already a filesystem reader over frontmatter** —
  M3 is a locale parameter and a fallback branch, not a new loader.
- **The guides pipeline already renders `.da.md` twins** — M3's content
  convention copies it rather than inventing one.
- **`_sim-template/` + `aiplatform sim scaffold`** already generate every new
  sim's frontend wiring — M4's sim rule lands in the scaffold, so a new sim
  gets it for free.

## Design

### M4 — The rule (in force from 2026-09-11, before any code)

This is listed first because it is the deliverable M asked for and the only one
with no dependency. Everything below can slip; this cannot.

**Language is data. Text is content. Neither is code.**

1. **UI copy on a localised surface goes through the message layer.** After M0
   lands, that is `t("key")` from `next-intl`. **Before** M0 lands — and on any
   surface M0 has not reached yet — new strings go in one `const copy = { ... }`
   object at the top of the component, **never inline in JSX**. A `copy` object
   extracts into `da.json` with a script; inline JSX extracts by hand. This is
   the interim form; it is not a lookup system and it needs no justification
   beyond that.
2. **Every new content surface has a locale axis on day one.** Markdown,
   guides, seeded corpus, help text: `<slug>.md` + `<slug>.da.md`, English the
   default and the fallback. A surface that ships single-language ships with a
   `// locale: en-only, by decision <ref>` comment or it is a bug.
3. **Language is never inferred from the browser.** Student surfaces resolve
   from `activity.language`; teacher surfaces from `teacher_prefs.locale`;
   `/project` from the URL edition. `navigator.language` is not read anywhere.
   (A Danish student in an English activity sees English — the teacher decided.)
4. **Prompt prose does not bake in a language.** A SKILL.md or framework YAML
   says *what* the tutor does; `compose_teacher_focus` says *in which language*,
   from `activity.language`. A new tutor that writes *"svar altid på dansk"*
   into its instruction body has re-created the 1.1.7x bug.
5. **A sim carries its strings in one object and takes `lang` from the
   bridge.** The `_sim-template` scaffold gets a `strings` map and a `lang`
   param; Boldkast and LED Planck are retrofitted only when next touched.
   KineBot stays English — a decision, not an omission, and rule 2's comment
   form records it.

   > ⚠️ **The supply side does not exist yet (found 2026-09-14, building the
   > first two conforming sims).** `GenericArtefactFrame` — the single mount
   > every catalogued sim renders through — never passes `hostContext` to
   > `StaticArtefactFrame`, so `AIPLA_BRIDGE.hostContext()` carries no `locale`
   > for any sim in the product today. A rule-5 sim therefore falls back to its
   > default language and the toggle is the only way to change it. Closing it is
   > two edits plus a decision: thread `activity.language` from the workspace
   > into the frame's `hostContext`, and settle whether a student-facing toggle
   > survives rule 3 (it is an explicit choice, not browser inference, so it
   > should — but say so on purpose). A second, smaller gap: the guest bridge
   > exposes no "host context arrived" callback, so `kettle-efficiency` and
   > `phase-change` poll `hostContext()` for ~2s after `init()`. Both are M1
   > work, not per-sim work.
6. **The words are the product's, not the codebase's.** UI copy names things
   the way a teacher does, never the way the wire does. `mint_group_codes` is a
   fine tool name and "Mint 3 join-codes" is not a sentence any teacher has ever
   said — M asked about this one directly on 2026-09-11. The wire identifier and
   the teacher-facing words are allowed to differ, and where they do, the
   component says so in a comment so the next reader does not "fix" the
   mismatch. Nothing internal reaches a user-facing string: no script names, no
   file paths, no `CSP`/`namespace`/`payload`/`seed`/`artefact`. Swept once on
   2026-09-11 (see below); the rule is what stops it coming back.
7. **The guard.** `scripts/check-i18n-literals.sh` (`make check-i18n`): fails
   on a Danish character (`[æøåÆØÅ]`) inside a JSX text node or string literal
   in a localised surface directory, outside `messages/` and test files. Crude
   on purpose — it catches the case that actually happens (someone types
   Danish into JSX) and it is the same shape as every other guard in this repo
   (`check-brand-literals`, `audit-trust-cards`). Scope starts at the four
   student directories after M0 and widens per surface as M2 lands. Added to
   the CI `local-mode-safety` job and the CLAUDE.md footgun table.

Where it is written down so it survives this session: the CLAUDE.md footgun
table (the machine-facing home), the agent memory
`feedback-content-must-be-translatable` (the session-facing home), and the
`mcp-app-artefact` + `workbench-element-builder` skills (the places new
surfaces are actually built from).

### M0 — The Danish sweep as extraction (~2–2.5d)

1. **Ask SH which Danish.** Twenty minutes, before anything. The answer routes
   the work: UI copy → this milestone; tutor turns → a prompt/framework edit
   and probably half a day; sims → M4 rule 5, retrofit on the spot.
2. **Wire `next-intl`** in locale-without-routing mode; `messages/da.json`,
   `messages/en.json`; provider at the student-surface layout, locale from
   `activity.language` (M1 is really step 3 of this).
3. **Extract the ~109 student-surface literals** into `da.json`, fixing each
   as it goes past. Fix means: consistent register (the guides' register is the
   reference — they were read by a native speaker), no literal-from-English
   idiom, **no engineer's vocabulary** (rule 6 — if the English says "mint" or
   "seed" or "artefact", the Danish inherits the problem and translating it
   just launders it), `aria-label`s included, interpolations as ICU messages
   not string
   concatenation.
4. **Author `en.json`.** English is the second language here, not a fallback —
   the Indian cohort reads it.
5. **Native read.** SH, or AR/JB, reads every student screen in Danish. Not
   optional; it is the acceptance test.
6. **Turn the guard on** for the four student directories. Run it against the
   pre-extraction tree first and confirm it fails.

**Why this is not the ~1.5–2d "sweep" + the ~2–3d "M3" the two rows said:**
both are a full read of the same ~109 strings in the same files. Doing them
as one pass costs the extraction plumbing (~0.5d) on top of the sweep and
saves the second read entirely.

### M0a — The plain-language sweep (DONE 2026-09-11, ~0.25d)

Done ahead of M0 because M asked for it directly and because it is cheaper
before extraction than after: a jargon string extracted is a jargon string in
two languages.

Teacher-facing prose only. **Every identifier was left alone** —
`mint_group_codes` is still the tool the model calls and `mint_codes` is still
the proposal kind the parser keys on, because renaming those is a breaking
change and not a copy fix.

| Was | Now | Where |
|---|---|---|
| "Mint 3 join-codes for 1.b" | "Create 3 group codes for 1.b" | the card a teacher clicks **Apply** on |
| "Minting…" / "Mint failed" | "Creating…" / "Could not create the group code" | class page button + error — its own success toast already said *created* |
| "start minting group codes" | "make group codes for students to join" | classes empty state |
| "mint codes" ×2 | "make group codes" | class co-pilot placeholder + empty text |
| "It needs to be seeded by an admin (`scripts/seed-platform-skills.sh`)" | "Ask an administrator to add it" | new-activity panel — **a shell script name in front of a teacher** |
| "artefact source (HTML/JS) … CSP + size validators … per-teacher artefact namespace" | "build your own simulations with AI help, without writing code" | activity roadmap banner |
| "The defaults above only seed those" | "are only a starting point for those" | teacher settings |
| ~10 uses of *mint* in `manage-class/SKILL.md` prose | *create group codes* | the co-pilot's own prompt — otherwise the AI says it back |

One naming inconsistency found and **not** resolved: the same object is called
*group code* (19), *join code* (2) and *group ID* (1). Standardised on **group
code** here, since it is both the majority and the accurate domain term (a class
holds groups; a student joins a group). ⚠️ Whether a teacher finds *group code*
or *class code* clearer is a product question, not a copy one — open for SH.

⚠️ `manage-class/SKILL.md` changed, so this needs a **seed** to reach a deployed
environment (`make seed ENV=…`), not just a deploy.

### M0a — Extraction, as built (2026-09-28)

**The layer.** `frontend/src/i18n/` — `useT("Namespace")` returns a typed
translator (keys typed from `messages/da/*.json`; a typo is a compile error),
`t.rich()` for a sentence with markup in it, `LocaleProvider` for a subtree.
next-intl's `createTranslator` does the ICU work; the locale comes from **our**
context rather than next-intl's provider, so a component rendered with no
provider (a unit test, an embedded preview) renders Danish instead of throwing,
and a key missing at runtime falls back to the Danish string, never a raw key.
Messages live in `frontend/messages/{da,en}/<area>.json` — one file per surface
area (`chat`, `chat-page`, `workspace`, `lessons`, `join`), top-level keys are
component-named namespaces. `messages.test.ts` fails on a key or namespace in
one locale and not the other, on two areas claiming one namespace, on
mismatched ICU placeholders, and on any æøå in the English catalogue.

**Where the locale comes from** (M1, done in the same pass):

| Surface | Locale |
|---|---|
| Chat + workspace | `activity.language` from `GET /api/activity-configs/active/{id}` (now carried — same field as the tutor's directive). No activity → the skill/class voice language → Danish. `<html lang>` follows |
| Lesson picker | the class's language when every assigned activity agrees (`language` now on `StudentActivitySummary`), else bilingual |
| Join page | both, Danish leading, English dimmed beneath — no class is known yet |
| Teacher's live preview | the draft's `language`, so the teacher sees what the student will get. `<html lang>` untouched |
| Sims | `GenericArtefactFrame` now passes `hostContext.locale` — the rule-5 supply gap is closed |

**Scale:** ~260 keys across ~50 student components + three pages. Guard
`make check-i18n` in CI: 62 hits on the pre-extraction tree, 0 after.
Every English value is new or unchanged; every Danish value that was Danish
before is byte-identical, **except** the deliberate changes below.

**Deliberate changes to what a student sees:**
- Strings that were **English in a Danish activity** now have Danish — as
  *first drafts* (list below). The biggest visible change: the chat composer,
  error banner, document viewer and documents panel speak Danish.
- Stacked-bilingual lines inside an activity (`SimLauncher`'s narrow-screen
  note, `ResumeWelcomeBanner`) now show only the activity's language.
- Numbers get locale grouping ("1.234 ord", not "1234 ord").
- `StreamError` gained a `code`; the banner translates by code, and the budget
  branch still shows the backend's own sentence.
- "Skill not found" → "This activity could not be found." (rule 6 — *skill* is
  our word, not the student's).

**For the native read (M0b) — first-draft Danish, written by a non-native
speaker, one pass:**
- `chat.json`: HumanToolUseCard (you/pending/confirmed/failed), ResumeWelcomeBanner.dismiss,
  AutoReadToggle.manual, ReadAloudButton (read/stop), LangToggle (all),
  ImageComposer (attachmentAlt/imageFallback/remove), ChatMessageList (earlier/emptyPrompt),
  ContextBanner.analyzing, TypingIndicator.using, ThinkingPanel (all), ToolCallChip (all),
  MessageBubble.attachmentAlt, ZoomableImage (all), PDFCard (open/pages),
  LessonRecordingPanel (all), VoiceComposerControls (all), ArtefactRefused.appeal
- `chat-page.json`: every key except tabsLabel/tabWork (which were Danish)
- `workspace.json`: DocumentsPanel (all 15), DocumentViewer (all 11),
  ProblemStatementCard.label, ProgressChecklist.label, StaticArtefactFrame.defaultTitle,
  WorkbenchChart.plotLabel, WorkbenchNote.untitled, WorkbenchTabs.label,
  WorkspaceShell (collapsedLabel/label)
- `lessons.json`: gridLabel · `join.json`: the four error sentences
- One inconsistency kept byte-identical for the reader to rule on: a trust card
  says *vejlederen* where the rest of the product says *tutoren*.

**Stragglers, closed 2026-09-29.** Four student-visible sources sat outside the
message layer because their text was authored somewhere other than the
component that shows it. The fix is the same shape each time — **the source
emits a code, the renderer translates it**, and any English sentence stays as
the fallback for a client that predates the code:
- **Budget banner** — `BudgetDecision.reason` (`paused` · `class_monthly` ·
  `programme_daily` · `unavailable` · `period_exhausted`) rides the RUN_ERROR;
  the countdown uses ICU plurals. An unknown reason shows the backend sentence.
- **Typing-indicator stage** — `STAGE_PROGRESS` now carries `key` + `params`
  (`thinking` · `callingTool{tool}` · `readingDocuments{count}`) beside `label`.
- **Image notices** — `useImageAttachments().notice` is a code; the privacy
  screen (`personGuardrail`) returns one beside its English message.
- **Chart fallback notes** — `resolveChartBinding` returns `tableGone` /
  `columnGone` instead of a Danish sentence.

The guard now covers `components/budget` and the individual `lib/` + `hooks/`
files whose text reaches a student. `lib/` as a whole is NOT in scope:
`activityTemplates.ts` (~380 lines) and `activityElements.ts` labels are
teacher-facing template data — M2's.

**Cold-start flash, fixed 2026-09-29.** Verified on deployed dev: an English
activity could paint Danish for several seconds, because before the config
fetch landed the page fell back to the voice config fetched *without* the
activity (`da`). The lesson picker now leaves each activity's language in
`sessionStorage` (`rememberActivityLanguages`) and the chat page seeds its first
paint from it; the config fetch still overwrites it.

**Not a student surface:** `ArtefactReviewer` (researcher review of a
submitted sim) and the doc-browser (`showDocumentUI =
!isAnonymousGroupAuthMode()` — teacher/dev only).

**Verified on deployed dev 2026-09-29** (headless Chromium, as a student, fresh
codes on the test teacher's classes): the English class's picker and chat were
English end to end (`<html lang="en">`, no æøå on the page); the Danish class
Danish; Boldkast received `hostContext.locale: "da"` read from inside its
iframe. An English sim was not checked on dev — no English activity there
carries one.

### M1 — Locale resolution (~0.5d)

> **Done with M0a, 2026-09-28** — see the table above. The teacher half
> (`teacher_prefs.locale`) moves to M2, where it is needed.

- Student surfaces: `activity.language` → `next-intl` locale → `<html lang>`.
  The workspace already fetches the activity config; this reads one field.
- Teacher surfaces: `teacher_prefs.locale`, default `da`, a toggle in the
  existing preferences UI. `<html lang>` follows.
- `/project`: the URL edition (M3) — until M3, `en`.
- The chat's read-aloud voice (1.1.7x M4) resolves from the same value, so the
  Danish-voice-reads-English-numbers bug closes with it.

### M2 — Teacher surface extraction (~2–3d, gated)

Same recipe as M0 over `components/teacher` + `app/teacher` (~104 literals)
and the co-pilot shell's per-surface overrides, which become message keys
instead of prop objects. **Gate:** only after M0 has been through a native read
and the guard has held for a month on student surfaces — if the convention
does not hold there, widening it is waste. Also gated on AD being present: it is
the best possible pairing task, being bounded, touching every teacher surface,
and needing no classroom.

### M3 — `/project` in Danish (decision for JB/AR, then ~1d + translation)

The plumbing is small: `projectContent.ts` takes a locale, looks for
`<slug>.da.md`, falls back to `<slug>.md` with a *"This page is in English"*
line; `check:project-content` validates both; `<link rel="alternate"
hreflang>` on each page; a language switch in the site chrome. **The cost is
fifteen translated pages, each with an owner, a reviewed date and a review
deadline, forever.** That is a content-ownership commitment KU has to want.
Ask JB/AR whether a Danish public face is wanted at all before anyone
translates a page; if the answer is "some pages", the fallback branch makes a
partial edition honest rather than broken.

### Third language

Direction only. The mechanism after M0–M3 is: a `messages/<lang>.json`, a
`<slug>.<lang>.md` set, a `Language` literal widened by one value, a sim
`strings` entry, and prompt directives that already take any language string.
No work is scheduled and none should be until there is an audience.

## Implementation Plan

| Milestone | Est | Order | Gate |
|---|---|---|---|
| **M4** rule + CLAUDE.md + skills + memory (guard script ships with M0) | ~0.25d | **first — done 2026-09-11** | none |
| **M0a** extraction + guard (student surfaces), `da.json` byte-identical | ~2d | **started 2026-09-28** | none (audit reordering) |
| **M0b** the Danish sweep, as a diff to `da.json` + native read | ~0.5–1d | after M0a | SH call routes it |
| **M1** locale resolution (incl. sim `hostContext`, picker language) | ~0.5d | with M0a | none |
| **M2** teacher surfaces | ~2–3d | Nov–Dec | M0's guard has held a month; AD present |
| **M3** `/project` Danish | ~1d + translation | unscheduled | JB/AR say yes and name owners |

## Migration & Rollout

- M0 is a pure refactor of rendered output for `language: da` activities —
  every existing activity is Danish (the `Language` default), so the Danish
  message file must render byte-identical strings *except* where the sweep
  deliberately changed them. The Vitest snapshot before/after is the diff SH
  reviews.
- No data migration. `teacher_prefs.locale` is absent → `da`.
- Ships to dev on push, test on the next tag, prod on the next promote —
  nothing per-env, so no `cloudbuild.promote.yaml` twin is needed.

## Testing Strategy

- **Vitest:** render the workspace, lesson picker and join flow under `da` and
  `en`; assert zero `[æøåÆØÅ]` in the `en` render and zero message-key leakage
  (`/^[a-z]+\.[a-z]+/`) in either.
- **Guard self-test:** `check-i18n-literals.sh` run against a fixture
  component with an inline Danish literal must exit non-zero.
- **`check:project-content`** (M3): a `.da.md` without a valid frontmatter
  fails exactly as its English twin would.
- **Manual:** one native read per surface per milestone. Recorded in this doc's
  status line with a date and initials, like every other acceptance in this tree.

## Security Considerations

None new. Message files are static bundle assets; content files are already
validated Markdown; no user input reaches the locale choice except through the
existing activity config write path, which is teacher-authenticated.

## Success Criteria

- [x] M4: CLAUDE.md footgun row, memory, skill notes — **done 2026-09-11**. The guard script (`make check-i18n`) lands **with M0**: scoped to nothing it guards nothing, and scoped to the student surfaces it fails on every current file, which is the point of running it before extraction, not before
- [ ] M0: SH call held; which layer recorded here
- [x] M0a: student surfaces render from `messages/`, guard green in CI (62 → 0) — 2026-09-28
- [ ] M0b: native read signed off (list under "M0a — as built")
- [x] M1: `language: en` activity → English student UI, sims receive `locale` — 2026-09-28. Read-aloud voice already followed `activity.language` (1.1.63 M4). ⚠️ Not yet verified on a deployed env in a browser
- [ ] M2: teacher surfaces render from `messages/`
- [ ] M3: decision recorded (yes/no/some); if yes, owners named per page

## Open Questions

1. **Which Danish?** (SH — blocks M0's routing, not its scheduling.)
2. **Does KU want a Danish `/project`?** (JB/AR — blocks M3 entirely.)
3. **Teacher locale: per teacher, or per class?** Per teacher is the simple
   answer and the one proposed; per class would let one teacher run a Danish
   and an English class in their own language for each. Decide at M2.
4. **Should the frameworks YAML carry a Danish `label`/`summary`** so
   `/project/tutors` can render Danish? Only if M3 is yes — and then it is
   generated-doc plumbing (`make tutor-docs`), not hand edits.

## Related Documents

- [1.1.7x tutor-register-citation-and-language](tutor-register-citation-and-language.md) — M2 shipped the mechanism; M3 deferred, absorbed here
- [activity-copilot-shared-shell-migration](activity-copilot-shared-shell-migration.md) — where the English-shell/Danish-override split came from
- [1.1.91 researcher-configurable-tutors](researcher-configurable-tutors.md) — the frameworks YAML as a prose surface
- `frontend/content/guides/` — the `.da.md` twin convention this copies
- [Extension plan, workstream C](../v2.1.0-extension/plan-2026-09-to-2027-04.md) — where M0 is scheduled
- Memory: `feedback-content-must-be-translatable`; KineBot language decision: memory `project-kinebot-language-audience`
