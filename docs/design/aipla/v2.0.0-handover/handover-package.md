# The handover package — what is owed on 2026-09-15, and what exists

**Status**: **OPEN — inventory taken 2026-09-01**, 14 days before the milestone. This doc is item **3.1** in the [v2.0.0-handover SEQUENCE](SEQUENCE.md), previously "Planned" with no content.
**Priority**: **P0 for the milestone** — it is the index the package is read through, and taking it is what surfaces the gaps early enough to act on
**Owner**: M. Several rows are owned by JB or by KU and are marked as such — those need a *chase*, not a build
**Scope**: Documentation and inventory only. Touches no runtime code
**Created**: 2026-09-01
**Source**: the Week-17 "definition of done" in the scoping site [`timeline.qmd`](https://www.sunholo.com/aipla/timeline.html), the top-level [SEQUENCE.md](../SEQUENCE.md) v2.0.0 row, and the P4 items of [handover-maintainability-audit.md](../v1.1.0-feedback/handover-maintainability-audit.md)

> **2026-09-15 is a milestone, not the finish line** — but that does not lower
> the bar as much as it first appears. The engagement was extended in August to
> at least **April 2027 at 2.5 days/week**
> ([ku-ai-office-alignment.md](ku-ai-office-alignment.md)), so the package is
> delivered with its author still reachable.
>
> **The exception is the one that matters.** The scoping site's
> `outputs/handover/README.md` names the two inheritors: **AR** (co-PI, present
> now) and **AD**, who *"starts ~1 Oct; **no in-person overlap with M**, so these
> documents carry the handover."* For AR the bar really is "can operate it with M
> available to ask". For AD it is the original, harder one: **the documents are
> the handover, and they are what AD will have instead of M.** Every runbook
> below whose named reader is AD should be written to that standard.

## Bottom line

**The build is not the problem. The index is.**

Every product and infrastructure commitment in the Week-17 definition of done is
met or substantially met, and each has real evidence behind it — a deployed
service, a dated pilot session, a published PDF. Three environments are level at
`v0.1.32` as of 2026-08-31, verified by `make deploy-status` rather than inferred
from git refs.

What is missing falls into four buckets, and only one of them is engineering:

1. **Two laptop-bound dependencies.** 63 design docs cite ADRs through
   ``...` (local path on M's machine)` links that resolve on exactly one machine,
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
   have a named co-owner who has demonstrated they can operate them." The
   `timeline.qmd` fan-out table is stale in both directions: the "P2 (when
   hired)" it still names has resolved into **AD, starting ~1 Oct**, and student
   helpers who appear in no row now exist. Nothing records a *demonstration* by
   anyone. See §Co-owners.

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
| 8 | Runbooks | ⚠️ **Outlined, unwritten** — all 5 exist in the scoping site's `outputs/handover/`, all 5 are stubs | See §Runbooks |
| 9 | Eval automation | ⚠️ **Partly** | `make eval`, 4 evalsets, `eval_config.json`, an authoring rubric judge and two smoke evals under `backend/tests/eval/`. **Nothing runs them in CI** — `.github/workflows/ci.yml` has no eval job. So the eval exists and is runnable by hand; it is not automated |
| 10 | DPIA / consent | ❌ **No artefact here** — JB-owned | Nothing matching `*dpia*` in this repo or `~/dev/sunholo-data/aipla/`. `timeline.qmd` risk marker: *"GDPR / consent forms — JB owns these but they gate any teacher-facing deployment. Confirm by early August at latest."* That confirmation is not recorded anywhere I can see. **Ask JB.** |

## Runbooks

**Correction to the first draft of this doc.** I originally recorded two of the
five promised runbooks as missing, having looked only in this repo. They are not
here — they are in the **scoping site**, under `outputs/handover/`, and there
are five of them, started 2026-07-10 with a stated target of *"complete before
the contract ends 2026-09-15"*.

**All five exist. All five are stubs.** Each is a one-page outline: a named
reader, a "Status: stub — fill from the execution repo" line, and a "To cover"
list. None has content.

| Runbook (scoping site `outputs/handover/`) | Reader | State |
|---|---|---|
| `runbook-add-bot-configuration.md` | AR | stub — 18 lines of outline |
| `runbook-onboard-teacher-class.md` | AR + AD | stub — 19 lines |
| `runbook-capability-floor-eval.md` | AR | stub — 17 lines; its own note says it was *"blocked on the eval dataset + runner existing"* |
| `runbook-add-model-routing.md` | AD | stub — 17 lines |
| `runbook-incident-playbook.md` | AD (AR first responder in teaching hours) | stub — 18 lines |

This is a **better** position than "two missing" in structure and a **worse** one
in substance: the outlines are good, the readers are named, and every one of them
says *"fill from the execution repo"* — which is the repo this doc is in. The
material exists; the writing has not happened.

### What already covers part of this, in this repo

Not all of the ground is bare. Where a runbook's subject is already documented
here, the writing job is assembly, not authorship:

| Promised runbook | Existing material to draw on |
|---|---|
| Onboard a teacher / class | [runbooks/access-requests.md](../../../ops/runbooks/access-requests.md), plus **four teacher guides in EN + DA** under `docs/guides/` (`t1` class · `t2` first activity · `t3` materials · `t4` co-pilot) and the student guide `s1`. In-product and screenshot-backed |
| What to do when X breaks | [deploy.md](../../../ops/runbooks/deploy.md), [prod-cut.md](../../../ops/runbooks/prod-cut.md), two written post-mortems in `docs/ops/incidents/`, and the `aipla-security-checkup` skill. **No general triage runbook** — the Cloud Run diagnostics knowledge is still only in `cli/README.md` and agent skills (P4.3) |
| Add a bot configuration | `docs/ops/platform-skills.md` + the `SKILL.md` template/seed path |
| Add a model to the routing layer | The registry is already single-sourced — `config/models.py`, `default_model()` / `fast_model()` (P2 work, 2026-07-22). Nobody has written the steps down |
| Run the capability-floor eval | `make eval`, 4 evalsets, `eval_config.json`, `backend/tests/eval/`. The scoping site's `strand-c-scoping/stx-bench/` holds the AILANG benchmark harness. **The join between running it and updating the report is the undocumented part** |

**New, and added by this pass:** [runbooks/admin-identity.md](../../../ops/runbooks/admin-identity.md)
— who is a platform admin and how to change it. Written because P4.4 made admin
a grantable claim, and a security-rules change nobody knows how to exercise is
not an improvement.

## Strand C — the one real writing job

Due **2026-09-09**, 5–10pp, covering C1/C2/C3 with a recommendation and rough
effort estimates. Nothing written. **But this is not a research task from
zero** — each of the three questions has shipped or designed prior art:

| Question | Prior art already in hand |
|---|---|
| **C1 — beyond LLMs** (VLMs, world models) | The capability-floor work already ran a **VL model tier** and produced a finding that generalises: *a self-host tier needs a text model **and** a VL model*. → [capability-floor-for-ku-ai-office.qmd](capability-floor-for-ku-ai-office.qmd). Behind it sits **`strand-c-scoping/stx-bench/`** in the scoping site — a benchmark harness written in AILANG against Danish stx Fysik A exam problems, calibration-then-tier-descent. Largely answerable by extraction |
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

| Artefact | `timeline.qmd` says | Actual, 2026-09-01 |
|---|---|---|
| Capability-floor eval | AR (domain) + student helper (ops) | AR engaged. **AR's runbook is a stub**, and its own status line says it was blocked on a runner that now exists |
| Pedagogical rubrics / LLM-judge prompts | AR | Rubrics shipped (1.1.57, rubric-1/rubric-2 sprints). No demonstration recorded |
| Production architecture (Strand A) | DS + **P2**, ZL day-to-day | **"P2 (when hired)" has resolved: AD starts ~1 Oct.** Every doc in this repo still says "when hired" |
| Cloud infra / GCP | **P2** + UCPH IT | Same — AD. And UCPH IT is now a *live, funded* counterparty via the KU AI office (from 2026-09-01), a better position than the table assumed |
| Day-to-day operations | Student helpers + P2 | **Student helpers exist and appear in no row** — the 2026-08-25 notes introduce Sophie (coordinating), Aswin (teacher side), Atul (student side) |
| Strand B | ZL, with DS | Not verified here |
| Strand C note | JB (audience), AR (input) | Note not written |

**The honest read:** the inheritor picture is *better* than the table records —
the P2-shaped hole is being filled by AD, student helpers arrived, and the KU AI
office became real and funded. But **no row anywhere records someone other than
M actually operating an artefact**, which is what criterion 5 asks for. Naming an
inheritor is not the same as demonstrating one.

**And the AD row changes the writing standard**, not just the names. AD arrives
after M's presence stops being continuous and never overlaps in person. The two
runbooks whose named reader is AD — model routing and the incident playbook —
are the ones that must survive with no author to ask.

## Gaps, owners, dates

Ordered by lead time, not by size. The top two are chases, not builds.

| # | Gap | Owner | Action | Lead time |
|---|---|---|---|---|
| 1 | **DPIA / consent artefact** | **JB** | Ask now whether it exists and where. If it does, link it from this doc. If it does not, it gates nothing retroactively but must be named as a known open item at handover | **Longest — ask today** |
| 2 | **Final handover session** | M + JB | Book it. Attendees per the *corrected* co-owner table, not `timeline.qmd`'s | Needs calendars ≥1wk out |
| 3 | **Strand C scoping note** | M | Write as findings, from the prior art above | Due 2026-09-09 · ~1–1.5d |
| 4 | **Fill the five runbook stubs** | M | Each says *"fill from the execution repo"* — this repo. Prioritise AD's two (model routing, incident playbook): AD has no author to ask | ~2–3d for all five |
| 5 | **Rewrite the co-owner fan-out table** | M + JB | Against who exists: AD rather than "P2 when hired", plus the student helpers. Feeds #2 | ~1h |
| 6 | **Eval in CI** | M | Optional for the milestone. `make eval` is real and runnable by hand; "automation" is the stated word, and a nightly job would satisfy it | ~0.5d, defer if crowded |
| — | ~~P4.2 — scoping-site links~~ | M | **DONE 2026-09-01.** 138 links rewritten, snapshot pinned to `c361ca0`, `make check-local-path-links` guards it in CI | — |
| — | ~~P4.4 — admin identity~~ | M | **DONE 2026-09-01.** `admin:true` claim, `users grant-admin`, and a [runbook](../../../ops/runbooks/admin-identity.md). *Removing the email fallback is still open — checklist in the runbook* | — |

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
