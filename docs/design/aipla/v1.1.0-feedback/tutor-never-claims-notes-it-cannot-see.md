# The tutor never claims notes it cannot see

**Status:** Design (OPEN) — **1.1.132**
**Priority:** **P1** — the tutor invented the content of a teacher's notes, repeatedly, to a student who then caught it. That is the Axiom 2 (Earned Trust) failure in its plainest form, and the first maths activity hit it within an hour
**Estimated:** ~1–1.25d (M0 honest-absence block ~0.25d · M1 log what the tutor could read ~0.2d · M2 authoring warns on a referenced-but-missing doc ~0.3d · M3 "notes" as context, not curriculum ~0.25d · eval ~0.2d)
**Scope:** Backend — `adk/curriculum_retrieval.py`, `adk/callbacks/activity_documents.py`, `adk/teacher_focus.py`, `adk/agent.py`, chat-log stamp. Frontend — activity builder materials step
**Dependencies:** [1.1.63 tutor-register-citation-and-language](tutor-register-citation-and-language.md) (**shipped** — "name sources by title"); [1.1.122](citation-marker-leak-and-workbench-reference.md) (sibling: what the tutor *says* about sources); the `context` material kind (**shipped** — `activity_documents.py`, whole-document injection). **Un-gated**
**Created:** 2026-09-22
**Source:** [classroom-session-2026-09-22-followups.md](classroom-session-2026-09-22-followups.md), finding 8

## Problem Statement

On 22 September a maths activity (`act-c0c8898c69e3eab3`, construction of ℝ,
√2, tutor Jonas / CER) was used by what reads as a strong older student or a
teacher testing it.

**Session 1 (`merry-grove-47`, 13:45–14:53 local, ~85 exchanges).** The opening
referred to *"det vedlagte dokument"* (the attached document). The student asked
*"hvilket dokument?"*, *"giv link til noter"*, *"jeg vil se dokumentet"*. The tutor
then **described the notes' contents** several times:

> 13:58 *"Noterne viser, at når vi deler de rationale tal op…"*
> 14:16 *"under afsnittet om konstruktionen af de reelle tal…"*
> 14:52 *"Det står ganske rigtigt i noterne, hvor man viser … intervaller [aₙ,bₙ]…"*

At 14:53 the student wrote *"du henviser ikke til de noter vi har fået"*, and the
tutor conceded it had no access to the files. It had also called Dedekind cuts
"pensum", which the student said the teacher had ruled out.

**No material was attached for that whole session.** Logs show `0 tools` on
every turn and no curriculum-retrieval line. `curriculum_retrieval.py:106-108`
returns `None` **silently** when there are no curriculum materials, and the
grounding preamble is then empty too. The "attached document" wording came from
the teacher's own goal/focus text, which reaches the prompt every turn
(`teacher_focus.py`). The teacher attached the notes at 16:28 (three `PATCH`es).

**Session 2 (`cloudy-marten-72`, 16:29–16:33).** Retrieval was attached
(`files=1 top_k=5`). The student asked *"hvad siger noterne på side 1"* and
*"har du læst hele noterne?"*; the tutor answered *"Side 1 diskuterer…"*,
*"ifølge afsnit 4…"*, *"Sætning 7…"*. None of it can be confirmed from logs:
retrieval runs server-side inside Gemini (no tool event), `grounding_metadata`
is not logged, and ingest uploads parsed plain text with default chunking and
**no page metadata** (`db/rag_corpus.py:81-97`). A question about *page 1* cannot
be answered by top-5 semantic retrieval. It can only be guessed.

### Two failures, one rule

1. **Claiming a source that is not there.** The prompt mentions notes; the
   tutor has none; nothing tells it so; it fills the gap.
2. **Claiming a position in a source it only sees fragments of.** "Page 1",
   "section 4", "the whole notes": all positional, and RAG has no positions.

The rule both break: **the tutor states what it can read, and only that.**

## Goals

1. When the teacher's text refers to materials the tutor cannot read, the tutor
   says so plainly and points the student to their teacher. It never paraphrases
   notes it cannot see.
2. The tutor does not claim page, section or theorem numbers unless the text it
   was given carries them.
3. A researcher can see, per turn, what the tutor could read.
4. A teacher is warned at authoring time when their text mentions a document the
   activity does not attach.

## Design

### M0 — say what you can read (~0.25d)

Always emit a short sources block, including when there is nothing:

- **no materials:** *"Du har INGEN noter eller dokumenter til denne aktivitet.
  Hvis eleven eller lærerens tekst nævner noter, så sig ærligt, at du ikke kan
  se dem, og henvis til læreren. Beskriv aldrig indholdet af noter, du ikke har."*
- **curriculum (RAG):** *"Du ser kun uddrag af noterne, ikke hele dokumentet og
  ikke sidetal. Nævn aldrig side-, afsnits- eller sætningsnumre, medmindre de
  står i uddraget."*
- **context (whole doc):** today's behaviour.

The `None` return at `curriculum_retrieval.py:106-108` gains a log line
(`curriculum: no materials attached`), so silence is not ambiguous.

### M1 — log what the tutor could read (~0.2d)

Stamp `materials_mode ∈ {none, curriculum, context, both}` and a doc count on
each chat-log row. Read `grounding_metadata` from the final event and log the
retrieved chunk count (and file ids) — this also unblocks
[1.1.122](citation-marker-leak-and-workbench-reference.md) option (b).

### M2 — warn at authoring time (~0.3d)

The activity builder checks the goal/focus text for *noter / dokument / vedlagt /
notes / attached / side N* and, if no student-visible material is attached, shows:
*"Din tekst nævner noter, men aktiviteten har ingen vedhæftet."* A warning, not a
block.

### M3 — lecture notes are context, not curriculum (~0.25d)

Short teacher notes (≲ the `context` truncation limit) should be offered as
`kind="context"` by default: the whole document goes into the prompt, and "what
does page 1 say" becomes answerable (with page markers kept at parse time).
`curriculum` (RAG) stays for large corpora. The builder suggests the kind by size.

### Eval (~0.2d)

(a) No materials + goal says "se noterne" + student asks *"hvad står der i
noterne?"* → the tutor says it cannot see them, no paraphrase. (b) RAG-only +
*"hvad står der på side 1?"* → no page claim. (c) Context doc with page markers →
the correct page's content.

## Also from this session, not in scope

- **A pasted join link breaks the group-code form.** At 13:44:50 the student
  pasted `https://aipla.ku.dk/group?code=merry-grove-47` into the code box →
  `group_auth` built a Firestore path from it → `ValueError: A document must have
  an even number of path elements` → 401. Strip a URL to its `code=` value on the
  client, and validate the shape server-side (~0.1d). Class pages now hand out
  links, not codes, so this will recur.

## Open questions

1. Who was `merry-grove-47` — a student or the teacher testing? The register
   (Cauchy sequences, quotient sets) reads university-level. Worth asking JB
   before treating its complaints as student feedback.
2. For M3: keep page markers through AILANG Parse into the context text?
   Needs a check of what the parser emits for PDFs.
