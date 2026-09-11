# Content localisation — the Danish sweep, the locale layer, and the rule that stops it getting harder

**Status:** **P1 — OPEN (design) 2026-09-11.** M0 is scheduled (extension plan, workstream C). M1–M2 follow M0 and are sized. M3 is a **decision for JB/AR**, not scheduled work. M4 is a standing rule, in force from today.
**Priority:** **P1** — a researcher's first-contact reaction to the product was *the Danish is confusing*, and the two people whose reactions most shape the programme's view of the platform (SH, and Aswin before her — [1.1.7x](tutor-register-citation-and-language.md)) have both now hit the language layer first. Below the discipline layer (D) because it is finish, not capability; above the rest of C because every later string we write without this in place is one more to extract.
**Estimated:** M0 sweep-as-extraction ~2–2.5d (absorbs the ~1.5–2d "Danish sweep" already on C **and** the deferred ~2–3d M3 of 1.1.7x, because they are the same files read twice) · M1 locale resolution ~0.5d · M2 teacher surface ~2–3d (**gated**) · M3 `/project` in Danish ~1d plumbing + translation (**decision**) · M4 rule + guard ~0.25d (**do first**).
**Scope:** `frontend/src/components/{workspace,chat,teacher,site}`, `frontend/src/app/{lessons,chat,teacher}` — the string surface; `frontend/content/project/` + `frontend/src/lib/projectContent.ts` — the public site; `backend/skills/templates/*/SKILL.md` + `backend/frameworks/*.yaml` — prompt prose; `infrastructure/mcp-sandbox/artefacts/` + `frontend/src/_sim-template/` — sims; `.eslintrc.json` / `scripts/` — the guard.
**Dependencies:** [1.1.7x tutor-register-citation-and-language](tutor-register-citation-and-language.md) (**M1+M2 shipped**, `activity.language` drives the tutor; **M3 deferred — this doc absorbs it**); [1.1.38 activity-elements-palette](activity-elements-palette.md) (**shipped** — the student components to localise); `docs/guides/` `.da.qmd` twins (**shipped** — the one content surface that already does this right, and the pattern M3 copies); [1.1.91 researcher-configurable-tutors](researcher-configurable-tutors.md) (the frameworks YAML is a new prose surface — M4 applies to it).
**Source:** SH (researcher; granted prod access 2026-09-11) — *the Danish is confusing*. M, same day: *"lets make sure we are not making this more difficult as we go on."* Prior: Aswin 2026-08-06, *"When using English in the setup, the language is still in Danish in students' interface."*
**Created:** 2026-09-11 (M)
**Last Updated:** 2026-09-11 (M)

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
| **Guides** | `docs/guides/<slug>.qmd` + `<slug>.da.qmd` | Twin files, shared screenshots | **Yes.** The reference pattern |

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
- **The guides pipeline already renders `.da.qmd` twins** — M3's content
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

### M1 — Locale resolution (~0.5d)

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
| **M0** sweep-as-extraction (student surfaces) | ~2–2.5d | Oct, with AD if timing allows | SH call first |
| **M1** locale resolution | ~0.5d | with M0 | none |
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
- [ ] M0: student surfaces render from `messages/`, guard green in CI, native read signed off
- [ ] M1: `language: en` activity → English product end to end, incl. read-aloud voice
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
- `docs/guides/README.md` — the `.da.qmd` twin convention this copies
- [Extension plan, workstream C](../v2.1.0-extension/plan-2026-09-to-2027-04.md) — where M0 is scheduled
- Memory: `feedback-content-must-be-translatable`; KineBot language decision: memory `project-kinebot-language-audience`
