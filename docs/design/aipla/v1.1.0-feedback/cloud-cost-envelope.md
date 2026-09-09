# The 100,000 DKK envelope — what it affords, and what is watching it

**Status**: **Analysis (OPEN)** — **1.1.106**. Arithmetic, not a build. The one *build*-shaped item is M2, and it is Terraform already written
**Priority**: **P1** — not because the envelope is tight (it is not), but because **nothing currently reports spend against it**, and the finding that produced this doc is that three of the four controls are sized without reference to the number they are meant to protect
**Estimated**: ~0.5d analysis (M0) · ~0.5d to turn the alerts on (M2) · M1 and M3 are decisions, not work
**Scope**: No application code. A reconciliation of the shipped spend controls against the actual budget, plus enabling the billing budget that is committed but disabled
**Dependencies**: [1.1.75 public-access-tiers-and-spend-control](public-access-tiers-and-spend-control.md) (**SHIPPED** — the per-payer cap and the Vertex ceiling); [1.1.76 delegated-programme-administration](delegated-programme-administration.md) (**M3 SHIPPED 2026-09-03** — the programme-wide daily budget); [1.1.9 cost-dashboard](cost-dashboard.md) (**SHIPPED** — `/teacher/insights/cost`); `infrastructure/env/spend_ceiling.tf` (**committed, disabled on every env**)
**Created**: 2026-09-09
**Source**: [notes-2026-09-09.md](../../../notes-2026-09-09.md) items 7 + 8, resolved by M the same day: ***"We have 100,000 [DKK] for cloud costs for the project."*** Supersedes the triage's *"whether this is a budget, a cap, a grant or a forecast is not stated"*

## The number

**100,000 DKK is a project budget for cloud costs.** Not a cap, not a forecast.

The **DKK is pegged to the euro** at 7.46 (ERM II, ±2.25%), so unlike a USD
conversion this one is stable and can be relied on:

| | |
|---|---|
| **100,000 DKK** | **≈ €13,400** (peg, ±2.25%) |
| ≈ USD | **~$14,000–15,500** — floating, so treat as a range, never a planning figure |

⚠️ **The period is not stated and it matters 4.5×.** Two readings:

| Reading | Monthly |
|---|---|
| The **engagement** (2026-09 → 2027-04, 8 months) | **≈ €1,675 / month** |
| The **3-year research programme** | **≈ €372 / month** |

**The conclusion below is the same under both**, which is worth saying plainly —
this analysis does not need the answer to proceed. But the *alert threshold* in
M2 does, so ask.

## What the controls permit — and none of them was set against this number

Four controls exist. Three are sized generously against *abuse*, which was the
right question when they were written and is not the same question as *does this
fit in 100,000 DKK*.

| Control | Where | Permits | vs €1,675/mo |
|---|---|---|---|
| **Vertex daily input-token ceiling** — the only thing that actually *stops* spend | `scripts/spend-ceiling.sh`, 50M/day/model | Its own comment: *"~$90/day, ~$2,700/month, INPUT ONLY"* | **~€2,500/mo — above the whole monthly envelope** |
| **Programme-wide daily budget ceiling** | `db/programme_budget.py`, `DEFAULT_MAX_DAILY_BUDGET_USD = 500.0` | $500/day | **~€14,000/mo — the entire envelope in under a month** |
| **Per-payer monthly cap** | `db/teacher_access.py`, `DEFAULT_MONTHLY_CAP_USD = 25.0`; programme admins may grant up to `PROGRAMME_ADMIN_MAX_CAP_USD = 50` | 12 pilot teachers × $25 = $300/mo | **~€275/mo — comfortably inside.** This is the one that fits |
| **Billing budget + 50/90/100% alerts** | `infrastructure/env/spend_ceiling.tf`, default `monthly_budget_eur = 200` | — | **⚠️ Not enabled on any environment** |

**The last row is the finding.** `spend_ceiling_enabled` defaults to `false` and
**appears in none of `dev.tfvars`, `test.tfvars` or `prod.tfvars`**. Its own
header explains why it is opt-in — the billing budget needs
`roles/billing.costsManager` on the *billing account*, a scope above what
`aipla-terraform@` holds, and turning it on without that grant reds every apply.
That was a correct decision when it was made. **Its consequence is that the only
control that sees Anthropic, OpenAI, Cloud TTS/STT and Vertex RAG in one number
is off**, so nothing today would tell anyone that the envelope was being spent.

This is the [repo's own footgun](../../../../CLAUDE.md) in its budget form: **a
control that reports success having done nothing**. The Terraform applies
cleanly, `plan` says no changes, and there is no alert.

⚠️ **And the Vertex ceiling needs verifying, not assuming.** It is applied by a
script rather than by Terraform, and that script exists *because* a quota
override with a wrong `base_model` dimension applies to nothing and still exits
0. **Run `make check-spend-ceiling ENV=prod` before believing the first row.**

## What a turn actually costs

From the repo's own rate card (`observability/llm_metrics.py`, USD per 1M
tokens) and the repo's own prompt budgets — every input figure below is
re-sent **every turn**, which is the thing that makes prompt size a cost
question and not only a latency one:

| | Input | Output |
|---|---|---|
| `gemini-3.5-flash-lite` (**platform default**) | $0.30 | $2.50 |
| `gemini-3.7-flash` (smart tier) | $0.75 | $3.75 |
| `claude-sonnet` | $3.00 | $15.00 |

A mid-session turn carries roughly the `MAX_INSTRUCTIONS_CHARS` prompt (25,000
chars ≈ ~6.5k tokens) plus the per-turn activity budget (14,800 chars ≈ ~4k
tokens) plus history — call it **~12k input, ~300 output**:

| Model | ≈ per turn | The 2026-08-21 pilot (334 turns) | A 30-student lesson (~320 turns) |
|---|---|---|---|
| flash-lite | **~$0.004** | **~$1.50** | **~$1.40** |
| 3.7-flash | ~$0.010 | ~$3.40 | ~$3.20 |
| claude-sonnet | ~$0.041 | ~$13.70 | ~$13.10 |

**So the headline: at the tiers actually in use, inference is not what will
consume 100,000 DKK.** Twelve teachers running two lessons a week for a fifteen-
week term is ~360 lessons — **~€450–1,050 on the Flash tiers**, against an
envelope of €13,400. Even the whole envelope spent purely on flash-lite turns is
on the order of **three million turns**.

**Which relocates the question.** The envelope goes on:

1. **Standing infrastructure across three environments** — Cloud Run, Firestore,
   BigQuery, Artifact Registry, the load balancer, **Vertex RAG Engine** and
   **Agent Engine**, which bill whether or not a student logs in. In a project
   whose per-turn cost is fractions of a cent, **the always-on half is the
   likely majority of the bill**, and nothing in this repo has ever measured it.
2. **Model-tier drift.** The gap between flash-lite and claude-sonnet is **10×**.
   One skill pinned to an expensive model is worth more than the entire student
   population's Flash traffic.
3. **Multimodal and voice.** Images and TTS/STT bill on units this arithmetic
   does not model at all, and `cost-dashboard.md` already flags multimodal
   premiums as unverified in OTel.

**⚠️ Every number above is estimated from the repo's rate card, not read from a
bill.** The authoritative source is the billing export — and it cannot be
consulted, for the reason in M2.

## Milestones

### M0 — read the actual bill ~0.5d

Everything above is arithmetic on list prices. **One look at the billing console
replaces all of it**, and it is the only way to answer the question that
actually matters: *what fraction of spend to date is standing infrastructure
versus inference?* If it is mostly standing cost — which the per-turn figures
strongly suggest — then every conversation about model tiers and student caps is
optimising the small half.

**Split by service, not by total.** A single number cannot distinguish "we are
fine" from "we are fine this month".

### M2 — turn the alerts on ~0.5d

The Terraform is written and disabled. Three steps, already documented in
`spend_ceiling.tf`'s own header:

1. Grant `roles/billing.costsManager` on `billingAccounts/01A211-266D3F-D96890`
   to `aipla-terraform@<project>`.
2. Set `spend_ceiling_enabled = true`, `billing_account_id`,
   `monthly_budget_eur` and `spend_alert_emails` in each `<env>.tfvars`.
3. `make tf-apply ENV=<env> GO=1`, then **`make check-spend-ceiling ENV=<env>`** —
   the read-back is half the job, not a formality.

**The threshold is where the unanswered period bites.** `monthly_budget_eur`
defaults to **200**, which is below both readings of the envelope and would make
the alert either noise or meaningless. Set it from the answer: **~€1,675** for
the engagement reading, **~€372** for the programme one.

⚠️ **An alert does not stop spend.** The quota does, and it is currently set
*above* the monthly envelope. That is defensible — a hard stop should not take a
class down mid-lesson over a budget line — but it should be a decision someone
has taken, not an artefact of nobody having known the number.

### M1 — the per-seat question ~0 (decision)

The meeting asked for *"costs for a Claude-Code-lite per student vs teachers"*.
The arithmetic above answers the platform half: **a student-seat cost at Flash
tiers is fractions of a cent per turn and rounds to nothing against €13,400.**

**An agentic-coding entitlement is a different product on a different rate
card** and must not be estimated from these numbers — it is a per-seat licence,
its own vendor, and its own procurement. That is a purchasing question, not a
platform-cost one. Recorded so the two are not conflated: the answer to *"can we
afford it"* has nothing to do with this envelope's headroom.

### M3 — reconcile the caps against the envelope ~0 (decision)

Not "lower everything". The per-payer cap is the one control already sized
sensibly, and the other two are deliberately generous because their job is to
catch a runaway loop rather than to be the operative bound. **The decision is
whether that remains the right posture now that the number is known** — and if
it is, to say so in the Terraform rather than leaving three limits that happen
to sit above the budget with nobody having compared them.

## Open questions

1. **Over what period?** The one genuinely blocking answer, and only for M2's
   threshold.
2. **Does 100,000 DKK cover only GCP, or also non-Google model spend?**
   The billing budget sees Anthropic and OpenAI *through* Vertex; a direct
   vendor relationship would not appear in it at all.
3. **Who is alerted?** `spend_alert_emails` currently defaults to empty, meaning
   IAM billing admins only. With AD arriving in October, one name is a
   bus-factor of one — the same argument [1.1.76](delegated-programme-administration.md)
   was written on.
4. **Do the three environments need to be equally alive?** `test` exists to
   receive a tagged release. If standing cost turns out to dominate (M0), the
   cheapest available saving is an environment nobody is using between
   promotions.

## What this doc deliberately does not do

- **Lower a cap.** M3 is a decision to take, not a change to make.
- **Trust its own arithmetic over a bill.** M0 exists precisely to replace it.
- **Price an agentic-coding entitlement.** Different rate card, different
  procurement — see M1.
