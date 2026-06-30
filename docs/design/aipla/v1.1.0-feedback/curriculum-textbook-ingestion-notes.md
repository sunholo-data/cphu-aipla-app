# Curriculum textbook ingestion — mathematicus.dk free-to-use textbooks

**Status:** Prep complete (parsed + staged); **dev shared-corpus write pending approval** (live dev mutation during the 2026-06-29 → 07-05 freeze)
**Date:** 2026-06-29
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
