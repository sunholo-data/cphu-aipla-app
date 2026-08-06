# Tutor register — citation voice and activity language

**Status:** Design (OPEN) — **P0, pre-pilot.** Written 2026-08-06 from Aswin's 2026-08-06 trial feedback.
**Priority:** **P0** — both halves are things a teacher notices in the first minute. M1 is a prompt string and lands in an afternoon; M2/M3 are the real work.
**Estimated:** M1 citation voice ~0.25d · M2 tutor language ~0.5d · M3 student UI locale ~2–3d (the long pole; it is an i18n project, not a fix)
**Scope:** M1/M2 backend — [`backend/adk/curriculum_retrieval.py`](../../../../backend/adk/curriculum_retrieval.py) + [`backend/adk/teacher_focus.py`](../../../../backend/adk/teacher_focus.py). M3 frontend — a locale layer over the student-facing components, currently hardcoded Danish.
**Dependencies:** [1.1.25 curriculum-library](curriculum-library.md) (**SHIPPED** — the retrieval path whose preamble M1 rewrites); [1.1.38 activity-elements-palette](activity-elements-palette.md) (**SHIPPED** — the student components M3 must localise); [workbench-element-awareness](workbench-element-awareness.md) (1.1.62 — shares the `compose_teacher_focus` edit surface; land that first or resolve the conflict)
**Source:** Aswin, 2026-08-06 — *"The chat keeps referring to the documents title when generating text which always start with According to mathematicus.dk…, or According to uvm.dk…"* (+ his follow-up: *"it does not sound natural if the text keeps referring the sources"*) and *"When using English in the setup, the language is still in Danish in students' interface."*
**Created:** 2026-08-06 (M)
**Last Updated:** 2026-08-06 (M)

## Problem Statement

Two unrelated defects that share a theme — **the tutor's surface register is not
what the teacher configured** — and are cheap enough to ship together.

### 1. The citation phrasing is our own prompt, quoted back

[`curriculum_retrieval.py:53-58`](../../../../backend/adk/curriculum_retrieval.py#L53)
builds the grounding preamble:

```
This activity cites the following curriculum sources:
...
When answering physics questions, prefer content from these sources over your
own knowledge. Cite which source you used, e.g. "According to [source name]..."
or "From [source name]:...".
```

Aswin's complaint quotes that instruction verbatim. The model is complying
exactly. A second instruction at
[line 118](../../../../backend/adk/curriculum_retrieval.py#L118) reinforces it:
*"Always cite the source in your answer."*

The intent was right — grounding must be attributable, and Axiom 2 (EARNED
TRUST) demands a student can see where a claim came from. The execution is
wrong in three ways:

- **Every turn**, including turns that use no retrieved content at all.
- **Sentence-initially**, which is the most intrusive possible position.
- **By filename/domain** (`mathematicus.dk`, `uvm.dk`), which is meaningless to
  a 16-year-old and reads as a URL, not a source.

The result is a tutor that sounds like a search engine. For a Socratic physics
tutor whose whole value is conversational register, this is not cosmetic.

### 2. `activity.language` is a dead field

`ActivityConfig.language` defaults to `"da"` and the teacher sets it in the
builder. It is read into the config adapter at
[`teacher_focus.py:70`](../../../../backend/adk/teacher_focus.py#L70) — and then
**never used anywhere**. A repo-wide search for consumers of `cfg.language`
returns that single assignment. It is written and never read.

So the tutor's language is whatever the model infers, biased by Danish skill
templates and Danish curriculum documents. The single nearest thing to a
language instruction is
[`teacher_focus.py:176`](../../../../backend/adk/teacher_focus.py#L176) —
*"Match the student's language"* — which is a per-turn heuristic buried in an
unrelated block, not the teacher's setting.

Separately and more expensively, **the student UI chrome is hardcoded Danish**.
[`ChartEditor.tsx:20-24`](../../../../frontend/src/components/teacher/ChartEditor.tsx#L20)
is representative:

```ts
{ value: "scatter", label: "Punktdiagram (scatter)" },
```

There is no locale layer. Aswin set the activity to English and got an English
tutor sometimes, and Danish buttons always. Both halves need fixing and they
are **not the same size** — hence separate milestones, and an explicit warning
below against pretending M3 is small.

## Goals

**Primary:** The tutor cites like a teacher, not a search engine; and an
activity set to English is English everywhere the student looks.

**Success metrics:**

- Retrieved content is attributed **when it is load-bearing**, in natural
  position, by human-readable title — not by domain, not sentence-initially,
  not on every turn.
- A student can still always ask "where does that come from?" and get a
  specific, correct answer.
- An activity with `language: "en"` produces an English tutor deterministically,
  not by inference.
- Student-facing chrome follows the activity language.

**Non-goals:**

- Removing attribution. Axiom 2 is not negotiable; this is about *how*.
- Localising the **teacher** surfaces (builder, analytics). Teachers are Danish;
  the student surface is what a teacher may set to English.
- Machine-translating curriculum content.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Prompt-string changes; M3 ships strings in the bundle, no extra fetch. |
| 2 | EARNED TRUST | +1 | Attribution is **kept and improved** — human-readable titles the student can actually find, rather than a bare domain. Cited when load-bearing rather than ritually, so the citation means something when it appears. |
| 3 | SKILLS, NOT FEATURES | 0 | Register of an existing skill. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Zero added LLM calls; language becomes deterministic config instead of per-turn inference. |
| 5 | GRACEFUL DEGRADATION | +1 | A document with no readable title falls back to its filename (today's behaviour). A missing translation key falls back to Danish rather than rendering a key. |
| 6 | PROTOCOL OVER CUSTOM | 0 | M3 adopts an existing i18n library rather than a bespoke string map — see Standards Check. |
| 7 | API FIRST | 0 | No new endpoints; `language` already rides `ActivityConfig`. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Existing instrumentation. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new data access. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Locale strings are legitimately client-side; the *choice* stays server-side on the config. |
| 11 | USABLE BY DESIGN | +1 | Fixes two things that make the product feel unfinished on first contact. |
| | **Net Score** | **+5** | Threshold: >= +4 |

## Standards Compliance Check

**M3 must not hand-roll a string map.** Next.js 15 App Router has an established
i18n approach and `next-intl` is the conventional library for it. Before
implementing, verify the current App Router recommendation against
`https://nextjs.org/docs/app/building-your-application/routing/internationalization`
and confirm the package version on npm. Inventing a bespoke `strings.da.ts` /
`strings.en.ts` lookup would score **-1 on Axiom 6** and needs written
justification.

Note the existing [`voice-pronunciation/units.da.ts`](../../../../frontend/src/lib/voice-pronunciation/units.da.ts)
is **not** a counter-example — it is locale-specific *pronunciation* data for
TTS, not UI copy, and should stay where it is.

## Framework-Native Capability Check

- **The prompt layer already exists.** M2 needs no new plumbing: `{teacher_focus}`
  substitution is the shipped mechanism and `compose_teacher_focus` is where a
  language directive belongs. No new callback, no side-channel.
- **`ActivityConfig.language` already exists** and is already resolved through
  the student's verified group binding. The bug is a missing *read*, not a
  missing field — so nothing is added to the model.
- **RAG metadata already carries titles.** `_build_source_preamble`
  ([line 144](../../../../backend/adk/curriculum_retrieval.py#L144)) composes the
  source list from data the retrieval path already returns. M1 changes how that
  string is phrased, not where it comes from.

## Design

### M1 — Citation voice

Replace the two directives with a **when/how** contract:

```
Curriculum material for this activity:
- "Kastebevægelse — noter" (mathematicus.dk)
- "Fysik B læreplan" (uvm.dk)

Prefer these over your own knowledge for physics content. Name a source when it
carries the answer — a specific number, definition, formula or claim the student
could not otherwise check — and name it by its TITLE, mid-sentence or after the
point, in your own voice. Do not open a reply with an attribution, do not cite
on turns that use no retrieved content, and never cite by domain or filename.
If the student asks where something came from, say precisely.
```

Before / after:

| | |
|---|---|
| Now | *"According to mathematicus.dk, the horizontal velocity stays constant. According to mathematicus.dk, the vertical…"* |
| After | *"The horizontal velocity stays constant — that's the key idea in the Kastebevægelse notes. So what happens to the vertical component?"* |

The parallel instruction at line 118 ("Always cite the source in your answer")
is rewritten to match; leaving it is the likeliest way for this fix to appear
not to work.

**Title, not domain.** `_build_source_preamble` should emit the document's
human title with the domain parenthesised as provenance. Where no title exists,
fall back to the filename — today's behaviour, no regression.

### M2 — Tutor language

`compose_teacher_focus` gains a language directive when `cfg.language` is set,
emitted **first** so it frames everything after it:

```python
_LANGUAGE_NAMES = {"da": "Danish", "en": "English"}

if cfg is not None and cfg.language:
    name = _LANGUAGE_NAMES.get(cfg.language, cfg.language)
    blocks.append(
        f"Speak {name} with the student, in every turn, including your first. "
        f"Curriculum material may be in another language — read it in whatever "
        f"language it is written and answer in {name}. Physics terms and units "
        f"keep their conventional form."
    )
```

Two subtleties the wording handles deliberately:

- **Reading ≠ speaking.** The A-level curriculum is Danish and stays Danish. An
  English-language activity must still ground in it. Conflating the two would
  break grounding for every English activity.
- The heuristic at `teacher_focus.py:176` ("Match the student's language") now
  **conflicts** with an explicit setting. It is scoped to a specific sub-block;
  it must be narrowed to apply only when `cfg.language` is unset, or removed.
  Leaving both in is a coin-flip.

### M3 — Student UI locale

Scope: the student-facing surface only —
`components/workspace/*`, `app/lessons/*`, `app/chat/*`, and the join flow.
Teacher surfaces stay Danish.

1. Adopt `next-intl` (pending the Standards Check).
2. Extract Danish strings from student components into `da.json`; author `en.json`.
3. Resolve locale from `activity.language` (the config the workspace already
   fetches), **not** from `navigator.language` — the teacher's setting is the
   authority, and a Danish student in an English activity should see English.
4. Fall back to Danish on a missing key.

> **This is the milestone that will be under-estimated.** It is not a find-and-
> replace: strings are inline in JSX across dozens of components, some interpolate
> values, some are in `aria-label`s, and the acceptance test is a human reading
> every student screen in both languages. Two to three days is honest. If the
> pilot window is tight, **ship M1 + M2 and defer M3** — a correct English tutor
> with Danish buttons is materially better than today, and is a defensible
> half-step to tell Aswin about. Shipping a half-done M3 is not.

### CLI Surface

Extend the `aiplatform activity manifest` command proposed in
[1.1.62](workbench-element-awareness.md) to print the resolved language
directive and the source preamble. Both bugs here were invisible precisely
because nothing rendered the composed prompt; one command covers both docs.

## Implementation Plan

### M1 — Citation voice (~0.25d)
- Rewrite the preamble at `curriculum_retrieval.py:53-58` and the line-118 twin
- `_build_source_preamble` emits title-first with domain as provenance
- Eval: assert no reply opens with an attribution; assert a direct "where did
  that come from?" still yields a specific source

### M2 — Tutor language (~0.5d)
- Language directive in `compose_teacher_focus`, emitted first
- Narrow or remove the `teacher_focus.py:176` heuristic
- Test: `language="en"` → English opening turn while citing a Danish source

### M3 — Student UI locale (~2–3d)
- `next-intl` wiring, `da.json` / `en.json`
- Extract student-surface strings; resolve from `activity.language`
- Vitest render of the workspace under both locales
- CI guard: fail on a literal Danish string added to a student-surface component
  (an eslint rule or a `check:i18n` script in the same PR — without it the
  extraction decays within a month, exactly as the mock-data guard was needed)

## Migration & Rollout

M1/M2 are prompt changes — no schema, no backfill, live on next session.
**Both require a seed** (`make seed ENV=dev`) if any wording moves into a
`SKILL.md`; if it stays in Python it ships with the deploy. Getting this wrong
is the "works in tests, deployed app shows old behaviour" footgun.

M3 ships behind `NEXT_PUBLIC_STUDENT_I18N`, default off until every student
screen is reviewed in both languages.

## Testing Strategy

### Backend (pytest)
- `test_curriculum_retrieval.py` — preamble contains no "According to" template;
  sources render title-first; empty source list → no preamble (unchanged)
- `test_teacher_focus.py` — language directive present and first for `en` and
  `da`; absent when unset; does not instruct the model to *translate* curriculum

### Eval (ADK)
- English activity + Danish curriculum doc → English answer grounded in the
  Danish source
- 10-turn Socratic dialogue → **no** turn opens with an attribution, and at
  least one turn attributes a specific retrieved claim
- Direct provenance question → specific source named

### Frontend (Vitest + RTL)
- Workspace renders under `en` and `da`; missing key falls back to Danish
- `npm run quality:check` (full, not `:fast` — the pre-push footgun)

### Manual
Author one activity in English, join as a student, and read every student
screen. This one genuinely needs a human.

## Security Considerations

None new. Source titles were already exposed to the student — this changes their
phrasing, not their visibility. Locale files contain no user data. Confirm
titles are HTML-escaped where rendered.

## Success Criteria

- [ ] No tutor reply opens with "According to \<domain\>"
- [ ] A load-bearing retrieved claim is still attributed, by title, in natural position
- [ ] "Where did that come from?" still answers specifically
- [ ] `language: "en"` → English tutor, deterministically, from turn one
- [ ] English activity still grounds correctly in Danish curriculum material
- [ ] (M3) Student surfaces render English under `language: "en"`
- [ ] (M3) A hardcoded Danish string in a student component fails CI

## Open Questions

1. **Is "when it carries the answer" reliable enough as a judgement?** It asks
   the model to decide load-bearingness. If evals show it citing too rarely, the
   fallback is structural: a `Kilder:` footer on turns that used retrieval —
   attributed, but out of the conversational register.
2. **Language beyond `da`/`en`.** `Language` is a `Literal`; other UCPH-relevant
   languages are a config change plus a locale file. Not now.
3. **Should the join/consent flow follow activity language?** A student picks a
   language before any activity is resolved. Proposed: join flow stays Danish;
   locale applies from the workspace onward.

## Related Documents

- [workbench-element-awareness.md](workbench-element-awareness.md) — 1.1.62, same feedback round, overlapping edit surface
- [curriculum-library.md](curriculum-library.md) — 1.1.25, the retrieval path
- [tutor-verbosity-fix.md](implemented/tutor-verbosity-fix.md) — 1.1.1, the prior "tutor register is wrong" fix; same class of problem
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's raw feedback
