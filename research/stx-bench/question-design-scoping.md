# Scoping: the benchmark as an exam-design + question-generation instrument

*Exploratory — captured 2026-07-16 from the STX benchmark work. Not committed
scope; a direction for later consideration with AR / JB. No exam content here
(archetypes only), so this note is safe to version.*

## The core symmetry

We built a grader to **test models with questions**. The same machinery can
**test questions with models**. That flips the benchmark from "which model is
good" into two further uses: critiquing existing exam items, and validating
newly-generated ones. Both reuse the calibration gate already built (top-tier
model agreement → provisional answer key).

## 1. Model failures are exam-design signal — two distinct kinds

When strong models miss an item, it's one of two opposite things, and telling
them apart requires **inspecting the model's reasoning, not just the verdict**:

- **Flawed-item / ambiguous-key signal.** Models fail with *defensible* working
  because the item is under-specified or the marking scheme is contestable.
  *Archetype seen in our run:* a redshift-distance item whose official answer
  depends on a physical constant the key itself says "varies by source" — a
  careful student using a different legitimate value is marked wrong. That's a
  defect in the item, surfaced automatically.
- **Good-discrimination signal.** Models fail because the item is genuinely hard
  and well-posed. *Archetype:* a multi-step energy-balance problem that *all*
  frontier models missed by mis-partitioning the energy. That's a *discriminating*
  item — the kind that separates strong from weak students, i.e. a good exam question.

**Reframe:** a panel of models of varying ability = **synthetic test-takers** for
*item field-testing*. You get difficulty estimates and flawed-item flags **before**
students sit the paper — human field-testing is slow and expensive. This is a
credible standalone contribution (item pre-testing / distractor analysis territory).

Discriminator rule of thumb:
- many strong models wrong + sound method + convergent wrong answer → suspect the **item/key**.
- models wrong with divergent genuine slips → likely a **hard-but-fair** item.

## 2. Generating similar questions — feasible, on-strategy

Aligns with the app's anchor-pack direction (real problems + marking emphases as
seeds) and AR's artefact-generation pattern. The corpus provides templates, a
topic taxonomy, and the marking-scheme structure. Prompting for variants
(same physics, new numbers/context) or novel items per learning objective is the
*easy* part. The hard part is validation (§3).

## 3. Fact-checking generated questions — reuse the calibration engine

A generated item must be **well-posed, correctly keyed, at the right level, and
novel (not a copyright copy)**. Proposed layered validator, cheapest first:

1. **Consensus solve.** A *diverse* model panel solves the new item cold (never
   shown the generator's answer). Tight convergence on one value + zero abstentions
   ⇒ strong evidence it's well-posed and the key is right. Divergence / abstention
   ⇒ auto-flag for human review. (This *is* the "top-tier agreement → provisional
   key" gate, aimed at questions.)
2. **Unit / dimensional check.** The grader already normalises units + applies
   tolerance; a dimensional-consistency pass catches arithmetic and unit errors in
   the proposed key cheaply. (Possible AILANG-contracts angle.)
3. **Adversarial critique.** A separate red-team pass hunts ambiguity, missing
   data, multiple valid readings, unrealistic numbers — the step that catches an
   ambiguous-constant flaw *at generation time*.
4. **Novelty / copyright check.** Ensure the item isn't a near-duplicate of a
   source exam problem (the source corpus is copyright-protected).
5. **Human sign-off on a sample.** AI layers pre-filter so a teacher reviews only
   consensus-passed items — same shape as the planned human-calibration step.

### The honest limit (must not skip)

**Consensus ≠ truth.** If models share a misconception they agree on a *wrong*
answer — our run proved they *can* share a blind spot (the energy-balance item all
frontier models missed). So panel agreement is **necessary, not sufficient**:
- keep **human sign-off** on a sample;
- use **diverse model families** (not five of one lineage) to break correlated error;
- a human still steers **learning objectives** — generated items skew toward "what
  models find natural," which may not be what teachers want to assess.

## Proposed proof-of-concept

Generate ~10 variant items → run the consensus + critique validator → count
pass-clean vs. flagged → have AR eyeball the flagged ones to check the validator's
judgement against a physicist's. This tests whether the questions-checking
machinery actually works before building on it. Reuses `runmodel.ail` +
`grader.ail` + the calibration logic wholesale.

## Related threads

Ties into the app's content-generation + review architecture (anchor-pack M1),
AR's artefact-generation pattern, the R1 analytics/PER corpus work, and DK's
KineBot (curriculum question generation). Breadth-over-depth steer makes this a
natural exploratory strand rather than a scaling commitment.
