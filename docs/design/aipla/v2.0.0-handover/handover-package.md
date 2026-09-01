# The handover package — what is owed on 2026-09-15, and what exists

**Status**: **OPEN — inventory taken 2026-09-01**, 14 days before the milestone. This doc is item **3.1** in the [v2.0.0-handover SEQUENCE](SEQUENCE.md), previously "Planned" with no content.
**Priority**: **P0 for the milestone** — it is the index the package is read through, and taking it is what surfaces the gaps early enough to act on
**Owner**: M. Several rows are owned by JB or by KU and are marked as such — those need a *chase*, not a build
**Scope**: Documentation and inventory only. Touches no runtime code
**Created**: 2026-09-01
**Source**: the Week-17 "definition of done" in the scoping site [`timeline.qmd`](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd), the top-level [SEQUENCE.md](../SEQUENCE.md) v2.0.0 row, and the P4 items of [handover-maintainability-audit.md](../v1.1.0-feedback/handover-maintainability-audit.md)

> **2026-09-15 is a milestone, not the finish line.** The engagement was extended
> in August to at least **April 2027 at 2.5 days/week**
> ([ku-ai-office-alignment.md](ku-ai-office-alignment.md)). The package is
> delivered *with its author still in the room*. That changes what "handover"
> has to mean: the bar is no longer "a successor can survive without M", it is
> **"a co-owner can operate this artefact today, with M available to ask"**.
> Anything below that reads as farewell-note framing was written against the old
> boundary.

## Bottom line

**The build is not the problem. The index is.**

Every product and infrastructure commitment in the Week-17 definition of done is
met or substantially met, and each has real evidence behind it — a deployed
service, a dated pilot session, a published PDF. Three environments are level at
`v0.1.32` as of 2026-08-31, verified by `make deploy-status` rather than inferred
from git refs.

What is missing falls into four buckets, and only one of them is engineering:

1. **Two laptop-bound dependencies.** 63 design docs cite ADRs through
   `file:///Users/mark/Documents/...` links that resolve on exactly one machine,
   and `firestore.rules:25` hardcodes a single person's email as the only admin.
   Both are small. Both make the package undeliverable *as written* to anyone
   else. → P4.2, P4.4.
2. **One writing job with a near date and its raw material already collected.**
   The Strand C scoping note is due **2026-09-09** (week 16) and does not exist —
   but C1, C2 and C3 each have substantial shipped prior art in this repo. It is
   a write-up, not a research project. → §Strand C below.
3. **One thing that is not ours and has no artefact.** GDPR / consent. JB owns
   it; there is **no DPIA or consent-form artefact in this repo or the scoping
   site**. It may well exist in email or a KU system. This needs a *question to
   JB*, asked now, because it has the longest turnaround of anything on the list.
4. **The criterion with the least evidence is the human one.** "All artefacts
   have a named co-owner who has demonstrated they can operate them." The fan-out
   table's inheritors are partly stale — **P2 was never hired** (every doc still
   says "P2, when hired"), while student helpers who were not in the original
   table now exist. See §Co-owners.

## The bar — Week-17 definition of done

Seven criteria, verbatim from `timeline.qmd`, each against what is actually in
the repo. **Verdicts are evidence-based; where I could not verify something I say
so rather than assuming it passed.**

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Strand A pilot deployed and used by ≥3 teachers (weeks 13–17) | ✅ **Met, exceeded** | 2026-08-21 prod session: **12 teachers, 22 groups, 334 turns, 30-of-30 clean joins**. Record: [pilot-session-2026-08-21-followups.md](../v1.1.0-feedback/pilot-session-2026-08-21-followups.md) (log half) + [teacher-feedback-2026-08-21-triage.md](../v1.1.0-feedback/teacher-feedback-2026-08-21-triage.md) (human half, 28 items) |
| 2 | Capability-floor report v1 published | ✅ **Met** | [capability-floor-for-ku-ai-office.qmd](capability-floor-for-ku-ai-office.qmd) + rendered `.pdf`/`.html` (2026-08-27). Method and panel in the scoping site's `evaluation.qmd` |
| 3 | Strand B prototype demonstrable | ✅ **Met** | Three sims live on `aipla-v01-sandbox` across all three envs: Boldkast, LED Planck, KineBot. Path documented in the `mcp-app-artefact` skill; portable-MCP-App exposure shipped (EXT-MCP) |
| 4 | Strand C scoping note delivered | ❌ **Not started** — due **2026-09-09** | No note exists. Raw material does — see §Strand C |
| 5 | All artefacts have a named co-owner who has demonstrated they can operate them | ⚠️ **Partly, and the table is stale** | See §Co-owners. This is the weakest row |
| 6 | UCPH self-host migration notes complete enough for IT to estimate effort | ✅ **Met** (contracted bar) | [ucph-it-hosting-requirements.qmd](ucph-it-hosting-requirements.qmd) + `.pdf`; [self-hosting-and-terraform-handover.md](self-hosting-and-terraform-handover.md) Phase 0 + Phase 1's Firestore slice ([firestore-portability-seam.md](firestore-portability-seam.md), implemented 2026-06-17). Phase 2 (reference Terraform/Helm) was always stretch |
| 7 | Final handover session run with P2 + AR + DS + ZL | ❓ **Unscheduled as of 2026-09-01** | Nothing in the repo records a booked session. P2 does not exist to attend one |

Plus the two the top-level SEQUENCE names that `timeline.qmd` does not spell out:

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 8 | Runbooks | ⚠️ **Partly** — 3 of 5 named topics covered, none under their promised names | See §Runbooks |
| 9 | Eval automation | ⚠️ **Partly** | `make eval`, 4 evalsets, `eval_config.json`, an authoring rubric judge and two smoke evals under `backend/tests/eval/`. **Nothing runs them in CI** — `.github/workflows/ci.yml` has no eval job. So the eval exists and is runnable by hand; it is not automated |
| 10 | DPIA / consent | ❌ **No artefact here** — JB-owned | Nothing matching `*dpia*` in this repo or `~/dev/sunholo-data/aipla/`. `timeline.qmd` risk marker: *"GDPR / consent forms — JB owns these but they gate any teacher-facing deployment. Confirm by early August at latest."* That confirmation is not recorded anywhere I can see. **Ask JB.** |

## Runbooks

`timeline.qmd` promised five task-oriented runbooks *"written for successors, not
for posterity"*. Three exist under other names; two do not exist.

| Promised runbook | State | Where it actually lives |
|---|---|---|
| "How to onboard a new teacher / class" | ✅ **Covered, well** | [docs/ops/runbooks/access-requests.md](../../../ops/runbooks/access-requests.md) for the access half, plus **four teacher guides in EN + DA** under `docs/guides/` (`t1` set up a class · `t2` first activity · `t3` curriculum materials · `t4` author with the co-pilot) and a student guide (`s1`) — these are better than a runbook and are in-product |
| "What to do when X breaks" | ⚠️ **Partial** | [deploy.md](../../../ops/runbooks/deploy.md) + [prod-cut.md](../../../ops/runbooks/prod-cut.md) cover deploy/promote/rollback; two written incident post-mortems under `docs/ops/incidents/`. **No general triage runbook.** The Cloud Run diagnostics knowledge is still only in `cli/README.md` and agent skills (P4.3) |
| "How to add a new bot configuration" | ⚠️ **Partial** | The mechanism is documented for agents (`SKILL.md` templates + seed) and partly for teachers (`t4` guide), but there is no human runbook for adding a *skill*. `docs/ops/platform-skills.md` is the closest |
| "How to run the capability-floor eval and update the report" | ❌ **Missing** | The eval runs (`make eval`); the report exists; **the join between them is undocumented.** This is the runbook AR most needs — it is their named artefact in the fan-out table |
| "How to add a new model to the routing layer" | ❌ **Missing** | The registry exists (`config/models.py`, `default_model()` / `fast_model()`), single-sourced by P2 work on 2026-07-22. Nobody has written down the steps |

**Assessment:** the two missing ones are exactly the two owned by people who are
*not* M — AR (eval) and whoever inherits infra (models). That is the wrong two to
be missing, and both are short.

## Strand C — the one real writing job

Due **2026-09-09**, 5–10pp, covering C1/C2/C3 with a recommendation and rough
effort estimates. Nothing written. **But this is not a research task from
zero** — each of the three questions has shipped or designed prior art:

| Question | Prior art already in hand |
|---|---|
| **C1 — beyond LLMs** (VLMs, world models) | The capability-floor work already ran a **VL model tier** and produced a finding that generalises: *a self-host tier needs a text model **and** a VL model*. → [capability-floor-for-ku-ai-office.qmd](capability-floor-for-ku-ai-office.qmd). Largely answerable by extraction |
| **C2 — beyond chat** (voice, branching, concept-map, the Plaud-like recorder) | The Plaud-like prototype **was built and hit real classroom scale**, and its failure mode is documented: [research-audio-capture-quality.md](../v1.1.0-feedback/research-audio-capture-quality.md) (*"near-unusable transcripts at the first real classroom scale"*). Voice shipped (TTS, personas, pronunciation config). Concept-map interface shipped (CONCEPT-1). This is the strongest-evidenced of the three and the only one with a *negative* result worth reporting honestly |
| **C3 — student models** (concept network vs reference model) | [living-concept-map.md](../v1.1.0-feedback/living-concept-map.md) — **shipped to dev** (element, graph view, co-pilot proposals, in-session checkpoints, per-group `concept_progress`). The uncommitted extension is designed: [knowledge-graph-and-student-matching.md](../post-pilot/knowledge-graph-and-student-matching.md). The open item the doc itself names is the honest one: **LLM-judge calibration is the long pole**, not the extraction |

**Recommendation:** write it as a *findings* note, not a *proposal* note. The
contract asked "which directions are worth pursuing" — and unusually, three
directions were partly built during the contract, so the note can report what
happened rather than speculate. C2's negative transcription result is the most
valuable single thing in it.

## Co-owners — the criterion with the least evidence

Criterion 5 requires a named co-owner *who has demonstrated they can operate*
each artefact. The `timeline.qmd` fan-out table is now partly stale:

| Artefact | Table says | Actual, 2026-09-01 |
|---|---|---|
| Capability-floor eval | AR (domain) + student helper (ops) | AR engaged. **The runbook AR would need does not exist** (see §Runbooks) |
| Pedagogical rubrics / LLM-judge prompts | AR | Rubrics shipped (1.1.57, rubric-1/rubric-2 sprints). Demonstration not recorded |
| Production architecture (Strand A) | DS + P2, ZL day-to-day | **P2 was never hired** — every doc still reads "P2 (when hired)" |
| Cloud infra / GCP | P2 + UCPH IT | Same gap. UCPH IT is now a *live* counterparty via the KU AI office (from 2026-09-01), which is a better position than the table assumed |
| Day-to-day operations | Student helpers + P2 | **Student helpers now exist and are not in the table** — the 2026-08-25 notes introduce Sophie (coordinating), Aswin (teacher side), Atul (student side) |
| Strand B | ZL, with DS | Not verified here |
| Strand C note | JB (audience), AR (input) | Note not written |

**The honest read:** the inheritor picture improved in a way the table never
recorded — a hired-P2-shaped hole was partly filled by student helpers and by the
KU AI office becoming real and funded. **The table should be rewritten against
who actually exists before the final session, not read as-is.** Two rows
(architecture, cloud infra) currently name a person who does not exist.

## Gaps, owners, dates

Ordered by lead time, not by size. The top two are chases, not builds.

| # | Gap | Owner | Action | Lead time |
|---|---|---|---|---|
| 1 | **DPIA / consent artefact** | **JB** | Ask now whether it exists and where. If it does, link it from this doc. If it does not, it gates nothing retroactively but must be named as a known open item at handover | **Longest — ask today** |
| 2 | **Final handover session** | M + JB | Book it. Attendees per the *corrected* co-owner table, not the stale one | Needs calendars ≥1wk out |
| 3 | **Strand C scoping note** | M | Write as findings, from the prior art above | Due 2026-09-09 · ~1–1.5d |
| 4 | **P4.2 — scoping snapshot + link rewrite** | M | 63 docs cite `file:///Users/mark/...`. Snapshot **public files only** | ~0.5d · *doing now* |
| 5 | **P4.4 — admin identity out of `firestore.rules`** | M | Hardcoded `mark@aitanalabs.com` → Firebase custom claim | ~1h · *doing now* |
| 6 | **Runbook: run the capability-floor eval + update the report** | M, for AR | Short; joins two things that both already work | ~0.5d |
| 7 | **Runbook: add a model to the routing layer** | M | Registry is already single-sourced; write the steps | ~0.5h |
| 8 | **Eval in CI** | M | Optional for the milestone. `make eval` is real and runnable; automation is the stated word, and a nightly job would satisfy it | ~0.5d, defer if crowded |
| 9 | **Rewrite the co-owner fan-out table** | M + JB | Against who exists. Feeds directly into #2 | ~1h |

## What this package deliberately does not include

- **Feature completion.** The 21-August feedback residue (1.1.84 M2, 1.1.85 M1/M3,
  1.1.86, 1.1.87 M3, 1.1.88 M3, 1.1.78) is **not** handover scope. It is ordinary
  post-pilot iteration and it continues after 09-15 under the extension.
- **The self-host cutover.** Phase 2 of [3.2](self-hosting-and-terraform-handover.md)
  was always stretch. The contracted bar is an estimate IT can cost, and that is met.
  Executing the tenancy half is a **2026-09 → 2027-04 candidate**, not a milestone item.
- **A farewell.** Per the header: M is present after this date. Artefacts should be
  written to be *operated with M available*, which is a lower and more honest bar
  than the original contract implied.

## Sign-off

| Deliverable | Signed off by | Date |
|---|---|---|
| *(to be filled at the final handover session)* | | |
