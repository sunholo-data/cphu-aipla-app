# 1.1.110 — One editor, custom approaches, and a citation you can check

**Status:** SHIPPED (dev) 2026-09-11 · **Owner:** M · **Reviewed:** 2026-09-11
**Decided by:** M, 2026-09-11, in conversation.
**Parent:** [researcher-configurable-tutors.md](researcher-configurable-tutors.md) (1.1.91) — this is M1's teacher tier, arrived at from a different direction.

## The decision

Three changes that are one idea: **a prompt should either be traceable to a
source, or say that it isn't.**

1. **"Edit wording" is gone.** It let a researcher overwrite a derived tutor
   prompt with free text while the badge still said *generated* — the only path
   in the system capable of producing an instruction no reader could check.
2. **Custom approaches replace it.** Free text, authored in the app, rendered
   under *"## Teaching approach:"* with no constructs and no citations, because
   it has neither.
3. **The literature is in a RAG corpus**, so a citation can show its passage
   instead of asking to be trusted.

## Why removing the editor cost nothing — and why the timing mattered

```
framework_overrides:  dev 0 · test 0 · prod 0
```

Nobody had ever used either editor. No migration, no stranded work. The moment
AR/JB start editing, that stops being true — which is why this was done the day
it was decided rather than queued.

A legacy text row is still **read**, and warns loudly when it is. Not defensive
habit: during a deploy the old and new revisions serve side by side, so a row
could be written seconds before the new one reads it. Honouring it is right — a
researcher's saved work must not silently stop being used — but such a row now
has no editor, so it must not be quiet either.

## Custom approaches are the same capability with an honest label

A custom approach *is* free-text authoring. The difference is entirely in what it
claims:

| | removed editor | custom approach |
|---|---|---|
| Renders as | `## Teaching framework: ESRU` | `## Teaching approach: Warm coach` |
| Badge said | "Generated from the theory" | authored, by name |
| Provenance | ESRU's citations, still attached | none, because it has none |
| Preface | "work through its moves in order" | omitted — there are no moves |

That last row is not cosmetic. Telling a model to work through moves that do not
exist invites it to invent some.

## Two tiers, and where this departs from M1

|                                     | Researcher | Teacher |
|-------------------------------------|:----------:|:-------:|
| Edit the seven published frameworks | ✅ | ❌ |
| Create a custom approach            | ✅ | ✅ |
| Edit / delete **their own**         | ✅ | ✅ |
| Edit / delete **anyone's**          | ✅ | ❌ |
| Search the source literature        | ✅ | ❌ |

M1 said *teachers get variants, not blank frameworks*, reasoning that "a tutor
with a theory field and no theory in it is worse than no theory field: it makes
an unfounded claim look founded". **That reasoning is about the claim, not the
free text** — and a custom approach makes no such claim. So the danger it guarded
against is absent here, and teachers get the one editable thing on this screen.

Consequences worth knowing:

- `canEdit` is computed **server-side per row**. A UI deriving it would be a
  second copy of an access rule, and the two disagree the first time one changes
  — the shape of the money-gate join footgun.
- A researcher editing a teacher's approach does **not** inherit authorship. The
  register of who wrote what has to stay true.
- The Approaches destination is **no longer researcher-gated**, because a teacher
  now owns something on it. Renamed from "Frameworks": a teacher writing one in
  their own words is not authoring a framework.

## The literature corpus — a second corpus, deliberately

AIPLA now has two RAG corpora with opposite audiences:

| | curriculum | literature |
|---|---|---|
| Holds | classroom materials | the seven papers the frameworks are drafted from |
| Reachable from a student session | **yes**, scoped per activity | **never** |
| Entry point | `build_curriculum_retrieval_tool` (an ADK tool) | `query_literature` (a plain async call) |

The separation is **structural, not policy**: `db/literature_corpus.py` exposes
no tool builder, so there is nothing for an agent to be handed.
`scripts/check-literature-corpus-isolation.sh` (CI-gated) fails the build if it
is ever imported from the agent path, and also if the module ever grows a tool
builder — which would make the import check moot.

**Why not ground the tutor in it?** Retrieval makes the prompt differ turn to
turn, and the reviewability this whole layer exists for — hold the prompt against
the paper and check it — requires the prompt to be the same thing every time.
The literature belongs where a human is reading it.

**The citation is not stored in the corpus.** It lives in the framework YAML's
`provenance`, which is its one source of truth; the corpus holds only the words,
named `<framework_id>.txt`. The endpoint joins them at read time.

⚠️ **Copyright.** Copyrighted journal PDFs, gitignored, kept as private working
references. Ingesting the parsed text into the project's own private corpus was
approved by M on 2026-09-11. The corpus must never be public and no
student-facing surface may cite from it.

## Verified, and not

**Verified:** all seven papers ingested on **dev**
(`projects/aipla-dev-2026/.../ragCorpora/4611686018427387904`), and retrieval
returns real passages correctly tagged — a query for *"dimensions of scientific
inquiry are used only in the eliciting phase"* returns the ESRU paper's own
discussion, including the Duschl (2003) secondary the README flags. Backend 3491
passed; the isolation guard was tested by deliberately breaking it.

**Not verified / not done — the feature is inert until these land:**

1. `LITERATURE_RAG_CORPUS_NAME` is **not injected into Cloud Run anywhere**, so
   passage search reports `configured: false` on every environment including
   dev. It needs the Secret Manager + env treatment `CURRICULUM_RAG_CORPUS_NAME`
   has.
2. **test and prod have no corpus at all.** A RagCorpus is per-project and does
   not promote with an artifact — re-run the ingest per environment.
3. **Deletion is not reference-checked.** Nothing asks whether a class still uses
   an approach. Framework resolution is None-tolerant by design (Axiom 5), so a
   dangling reference is a *silent loss of pedagogy*, not an outage. The UI warns;
   the server does not stop you. Surfacing usage before deletion is the obvious
   next increment.
4. **The tutor co-pilot (1.1.91 M2) is still open** — `query_literature` was
   built to be what grounds its proposals, and nothing calls it yet apart from
   the researcher's own search.

## Open questions for a human

- **May a custom approach be assigned to a live class?** M said yes on
  2026-09-11, and it is implemented that way. Worth revisiting if a teacher's
  approach ever ends up as an arm in a published comparison, where "what taught
  this?" would answer with unreviewed prose.
- **Should the seven stay editable after AR/JB sign them off?** An edit after
  sign-off silently changes what a name means, and 1.1.92 attributes scored
  sessions to that name.

## Files

| Path | What |
|---|---|
| `backend/db/authored_frameworks.py` | the custom-approach store + the tier rules |
| `backend/db/literature_corpus.py` | authoring-time passage lookup, no tool builder |
| `backend/scripts/ingest_literature.py` | idempotent per-environment ingest |
| `scripts/check-literature-corpus-isolation.sh` | the structural guarantee, CI-gated |
| `frontend/src/components/teacher/research/CustomApproachPanel.tsx` | the teacher-editable tier |
