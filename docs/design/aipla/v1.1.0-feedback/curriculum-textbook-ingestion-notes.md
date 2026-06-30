# Curriculum textbook ingestion — mathematicus.dk free-to-use textbooks

**Status:** ✅ **DONE (2026-06-30)** — ingested into the dev shared corpus as **12 split parts, all RAG-grounded** (citable + tutor-groundable). The single-file approach below **failed Vertex RAG indexing** (too large); see *Outcome*.
**Date:** 2026-06-29 (prep) · 2026-06-30 (ingested)

## Outcome (2026-06-30)

The single-file ingest of each full book **failed at the Vertex RAG indexing step** —
`WARNING db.rag_corpus: RAG upload error … ('Failed in indexing the RagFile due to: ', {'code': 13})`
(gRPC INTERNAL). The Firestore docs were created but with `docArtifactId=""` (not grounded). Cause:
**file size** — the books are 430k–962k chars, while every physics læreplan/vejledning that indexes
fine is ≤114k. Probed that a **200k-char part indexes cleanly**.

Fix: split each book into ~200k-char parts (`/tmp/split_md.py`, paragraph-boundary split of the staged
markdown) and ingest each part as its own shared doc:

Titled `"<Book> (Mathematicus) — del N/M"`, `--level B`, subject in `--topic` (interim, → SEQUENCE 2.6).
Removed the failed full-book docs + a `[PROBE]` doc via the **new `DELETE /api/curriculum/{id}` endpoint**
(commit `136238f`; the reason that endpoint now exists).

**Retrieval-quality pass (chunk cleanup).** The first cut used docparse's **default `pdftotext` backend**,
which for these LaTeX-generated books produced noisy chunks — TOC dot-leaders (131 lines), running
page-headers + bare page numbers, hard line-breaks mid-sentence (paragraphs not joined), and **no heading
structure**. Re-parsed with **`docparse --pdf-backend liteparse`** (font-size heading detection): **422
headings**, TOC dot-leaders → 3, paragraphs joined into flowing prose, 33% smaller. A light post-process
(`/tmp/clean_split.py`) strips residual page-number `## N` headings + running headers + leaked
`[text:Normal]` tags, then splits at `##` headings into ~200k parts. Re-ingested → **9 cleaned parts**
(Atomer 3, Integralregning 2, Differentialregning 4). Retrieval now returns clean prose
(e.g. "Figur 1.8 viser fordelingen af de 13 elektroner i et aluminium-atom…") vs the earlier fragmented
output. **Final shared corpus = 15 docs, all grounded** (6 physics + 9 textbook parts).

- **Known limitation (→ docparse feedback sent via AILANG):** the **maths** books are 2-column with margin
  notes; both pdftotext and liteparse **interleave columns + formulas** in formula-dense sections (prose is
  fine, formulas garbled). The `ai` (multimodal) backend would handle layout+math better at token cost.
  Math super/subscripts also flatten (r² → "r 2"). Full feedback in the AILANG inbox.

> **Deploy gotcha hit here:** the delete endpoint sat un-deployed because a **stale frontend test was
> failing cloudbuild's CI gate, aborting every dev deploy** since the analytics co-pilot landed (last good
> revision 00515, 2026-06-29). Fixed in `1f56534`; deploy 00516 then carried the delete endpoint + the
> group-auth fix. If a push doesn't produce a new Cloud Run revision, check `gh run list` for a red CI.

---

### Original single-file plan (superseded — failed indexing; kept for the record)

**Source feedback:** [june-29-feedback.md](june-29-feedback.md) (Danish-textbook decision + follow-up thread)
**Owner doc:** [curriculum-library.md](curriculum-library.md) (1.1.25 — the shared corpus this writes into)

> **Why this file exists.** Per the *record-side-effects* working rule, every write to a deployed
> environment (here: 3 documents into the dev Vertex AI RAG corpus + Firestore `curriculum_docs`)
> is recorded with the exact reproducible commands, so the same ingestion can be re-run for
> test/prod and folded into a future seed script. This is also the runbook M can execute, since the
> auto-mode classifier (correctly) gated the live dev write.

## Licence record

All three are by **Mike Vandal Auerbach** (mathematicus.dk), released under
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**
— in-document: *"Disse noter … må frit anvendes til ikke-kommercielle formål."*

- **NonCommercial** — UCPH research/education use is non-commercial → within licence.
- **Attribution** — carried in the `origin` field on each ingested doc (author + source + licence).
- **ShareAlike** — note for any future redistribution of derived material.

This is the "licence-terms check, not full copyright clearance" path flagged in the 29-June
disposition. Tracked in the `project-curriculum-clearance` memory.

## Sources (as downloaded vs. actual content)

The filenames M used do **not** match the document titles — metadata below uses the real titles:

| Downloaded file | Real title | Subject | stx level |
|---|---|---|---|
| `FysikB.pdf` | **Atomer** (atomic physics) | Physics | A/B |
| `matAMathematicus.pdf` | **Integralregning** (integral calculus) | Maths | A/B |
| `matBMathematicus.pdf` | **Differentialregning** (differential calculus) | Maths | A/B |

## Prep already done (local, reversible)

- Parsed each PDF → markdown with `docparse` (deterministic `pdftotext`, no LLM/token cost).
- Staged the markdown in `CURRICULUM_SRC_DIR` (`~/Documents/clients/cph-uni/sources/curriculum/`,
  the convention — large binaries are kept out of the exec repo):
  - `atomer_mathematicus_stx_da.md`
  - `integralregning_mathematicus_stx_da.md`
  - `differentialregning_mathematicus_stx_da.md`
- Kept the upstream PDFs for provenance under `…/sources/curriculum/mathematicus-pdf-source/`.

## Ingest commands (dev — run to complete)

`level` must be set for shared cleared docs; the schema has **no `subject` field**, so subject is
carried in `topic` as an interim stop-gap (see [SEQUENCE 2.6](SEQUENCE.md)). Uploading the **markdown**
(not the PDF) keeps extraction deterministic and avoids Gemini OCR cost.

```bash
cd /Users/mark/dev/sunholo/cphu-aipla-app
export AIPLATFORM_ID_TOKEN="$(scripts/mint-test-teacher-token.sh | tail -1)"
SRC=~/Documents/clients/cph-uni/sources/curriculum
ORIGIN="mathematicus.dk · Mike Vandal Auerbach · CC BY-NC-SA 4.0"

aiplatform --env dev curriculum ingest "$SRC/atomer_mathematicus_stx_da.md" \
  --level B --title "Atomer — Mathematicus (Mike Vandal Auerbach)" \
  --origin "$ORIGIN" --topic "fysik – atomfysik" --shared --copyright cleared

aiplatform --env dev curriculum ingest "$SRC/integralregning_mathematicus_stx_da.md" \
  --level B --title "Integralregning — Mathematicus (Mike Vandal Auerbach)" \
  --origin "$ORIGIN" --topic "matematik – integralregning" --shared --copyright cleared

aiplatform --env dev curriculum ingest "$SRC/differentialregning_mathematicus_stx_da.md" \
  --level B --title "Differentialregning — Mathematicus (Mike Vandal Auerbach)" \
  --origin "$ORIGIN" --topic "matematik – differentialregning" --shared --copyright cleared
```

### Verify

```bash
# Should list the 3 new shared docs alongside the 6 physics læreplan/vejledning docs
aiplatform --env dev curriculum browse --scope shared    # or: GET /api/curriculum?scope=shared
```

Then, in the activity builder → **Materials** picker, the three titles should appear as citable
shared materials (filter the picker `topic` by `matematik` to confirm the maths ones surface).

## Open follow-ups

- **Level overloading.** These are A/B materials but the schema allows a single `level`; ingested as
  **B**. When [2.6 multi-subject schema](SEQUENCE.md) lands, revisit level + add `subject`.
- **Re-seed reproducibility.** `scripts/seed-curriculum.sh` is hard-coded to the 6 physics
  læreplan/vejledning files — it will **not** re-ingest these textbooks. Re-running a clean seed needs
  either these commands re-run manually or the script extended (do that with the 2.6 work, not during
  the freeze).
- **Migrate the `topic` stop-gap** to a real `subject` field once 2.6 ships.
