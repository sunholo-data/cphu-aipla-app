# ku-ai-office-alignment — positioning AIPLA against KU's central AI push

**Status**: **Scoping (OPEN)** — a positioning decision, not a build plan. No milestone is committed until KU IT and the AI office have been talked to.
**Priority**: **P1, time-boxed.** The value decays: a new office's architecture and model catalogue are decided in its first months, and after that the position is inherited rather than chosen. The work itself is small (conversations + two documents, both now drafted).
**Estimated**: Documents ~1d (done). The rest is meetings, not engineering. Any resulting integration work is scoped separately.
**Scope**: Positioning + external comms. Touches no runtime code. Feeds [self-hosting-and-terraform-handover.md](self-hosting-and-terraform-handover.md) and the two outward-facing documents below.
**Dependencies**: ADR-003 (four model tiers), ADR-001 (anonymous student identity), ADR-006/007 (EU hosting), the capability-floor eval (scoping site `evaluation.qmd`).
**Created**: 2026-08-27
**Last Updated**: 2026-08-27

---

## Problem Statement

Three things changed at roughly the same time, and together they invalidate the
framing every other handover document was written against.

1. **KU committed 110M DKK over three years to AI, starting 2026-09-01.** A first
   vice-rector for AI (Morten Axel Pedersen — professor of anthropology and
   social data science, ex-lead of SODAS, chief researcher at CAISA) takes office
   on that date, reporting directly to the rector, on a three-year post
   explicitly designed to dissolve once AI is integrated into the faculties. The
   money funds an AI office, a cross-faculty taskforce, AI-labs, and a
   significant strengthening of KU IT.
2. **KU IT is already building internal infrastructure with locally hosted
   models**, aimed at a KU-wide platform where staff and students sign in with
   KU credentials and pick a model per task.
3. **M's engagement was extended to at least April 2027 at 2.5 days/week.**

Each alone is a minor update. Together they move the whole workstream: the
counterparty for the self-hosting work now exists, is funded, is building
something overlapping, and M is present for the entire period in which its
architecture gets decided.

**Impact if ignored.** The default outcome is Option 3 below (parallel systems)
reached by inertia rather than by decision — AIPLA continues to carry its own
spend governance, logging, document handling and sign-on while KU builds the
same things centrally, and by the time anyone compares them the KU platform's
architecture is fixed. The reverse risk is also real: a central "sign in and
pick a model" platform straightforwardly *absorbs* AIPLA's generic chat shell,
and if we have spent the extension polishing that shell rather than the
discipline-specific layer, we spent it badly.

---

## The evidence base, and its limits

**Everything we know about KU IT's plans comes from one newspaper interview**
(Uniavisen, Aug 2026 — *"KU satser 110 millioner på AI: Her er manden, der skal
vise vejen"*). That is journalism, not a specification. It is a vice-rector
describing intentions before taking office, filtered through an interviewer.

Treat every claim in this doc about the KU platform as **unverified**. In
particular we do not know: whether the platform will expose inference to other
applications at all; whether KU IT has already committed to a vendor or an
architecture; who owns the decision; whether procurement rules constrain what
they can adopt; or whether any of this is welcome. **The first action below is
to find out, and nothing should be built on the newspaper's account.**

What we can take as reasonably firm, because it is a matter of public record
rather than intention: the money, the post, the start date, the office and
taskforce and AI-labs, and the two stated tracks ("AI at KU" and "KU with AI").

---

## Three possible relationships

Written for the external audience in
[ucph-it-hosting-requirements.qmd](ucph-it-hosting-requirements.qmd) §4b. This
is the internal version, with the parts we would not put in a document addressed
to KU IT.

### Option 1 — tenant

AIPLA consumes KU inference + KU OIDC; keeps everything else.

Cheap and almost certainly correct regardless of what else is decided. The model
router already dispatches across Gemini, Claude and any OpenAI-compatible
endpoint via LiteLLM (`backend/adk/agent.py:resolve_model`), and vLLM and Ollama
both serve OpenAI-compatible APIs, so a KU endpoint is a provider entry rather
than a project. The teacher side needs an OIDC swap; the student side needs
nothing, because ADR-001 students have no institutional identity to federate.

**Do this whatever happens.** It is also the cheapest way to find out whether
KU IT is a workable counterparty, which is worth more than the integration.

### Option 2 — template

The KU platform is built from AIPLA's application layer; AIPLA becomes the
physics instance.

**Why this is not absurd.** This repo is a fork of a domain-neutral template
(`sunholo-data/ai-protocol-platform`) with a physics configuration layer on top.
The platform/instance separation is how the code is organised, and the fork is
the proof it separates. The things a central university platform needs that are
hardest to retrofit — **per-user spend governance enforced at request time**
(`auth/spend_authority.py`, `auth/access_tiers.py`, the register with caps,
tiers and expiries), **two identity modes** including a genuinely anonymous one,
and **configuration-by-document rather than by code** (`skills/templates/*/SKILL.md`,
seeded to Firestore on deploy) — already exist and are in live use with real
teachers.

**The governance argument is the strong one**, and it is not a technical
argument. The vice-rector's stated method is devolution: *"every subject has to
work out what AI means for them — I shouldn't be the one drawing the line; it
has to be found among the colleagues in each subject."* A platform whose unit of
configuration is a subject's own plain-text document is that policy expressed in
software. A platform that centralises prompt and policy decisions contradicts
it. We have a worked example of one subject doing it, with a pilot behind it.
Nobody else at KU is likely to have one for another year.

**Why it might fail, honestly:**

- **Scale.** Ten teachers, not forty thousand users. Nothing forbids scaling;
  nothing demonstrates it. Do not let the argument slide from "the architecture
  permits it" to "it does it".
- **Migration debt.** Firestore, Vertex RAG Engine, Vertex Agent Engine.
  Tolerable in a prototype; a liability in something others build on. §1 of
  [self-hosting-and-terraform-handover.md](self-hosting-and-terraform-handover.md)
  costs it honestly and that honesty is load-bearing here.
- **Bus factor of one.** Adopting it means resourcing it or knowingly accepting
  that.
- **Conflict of interest.** M maintains both AIPLA and its upstream. This must
  be stated first, in writing, every time — including in §4b, where it is. An
  unstated interest discovered later destroys the whole position.
- **Licensing and ownership of the upstream template are unsettled** and would
  have to be resolved before anyone could build on it. This is a real blocker,
  not a formality, and it is ours to fix.

### Option 3 — parallel

Legitimate, lowest-coordination, possibly forced by procurement or existing
commitments. Its cost is duplicated institutional plumbing. **The thing that
makes it bad is not choosing it; it is arriving at it by not asking.**

---

## Recommendation

**Option 1 now; Option 2 as a conversation, not a proposal.**

Pitch Option 2 as a question ("is this useful to you?") rather than an offer
("you should adopt this"). Given the conflict of interest, a proposal reads as
selling and a question reads as collaboration, and the second is both more
honest and more likely to work.

**Regardless of which option lands, spend the extension on the discipline layer,
not the shell.** Activity authoring, the sims/artefact surface, curriculum RAG on
cleared material, rubric-scored logs as assessment evidence. A central KU
platform absorbs a chat shell and cannot absorb any of those. This holds even
under Option 3 — arguably especially under Option 3.

---

## Actions

| # | Action | Owner | When | State |
|---|---|---|---|---|
| A1 | Verify the newspaper account with someone who knows. JB is the natural route to the AI office; the 2026-06-17 IT contacts are the route to KU IT's actual build. **Nothing else on this list should happen first.** | M + JB | Early Sept 2026 | Open |
| A2 | Send the revised [ucph-it-hosting-requirements.qmd](ucph-it-hosting-requirements.qmd) (now carrying §4b) to the 2026-06-17 KU IT contacts | M | After A1 | Drafted |
| A3 | Offer [capability-floor-for-ku-ai-office.qmd](capability-floor-for-ku-ai-office.qmd) to whoever is deciding the model catalogue | M | Sept–Oct 2026 | Drafted |
| A4 | Settle the licensing/ownership position of the upstream template, so Option 2 is answerable if asked | M | Before any Option-2 conversation gets concrete | Open |
| A5 | Re-decide the "do not execute the migration" non-goal once A1 returns | M | Oct 2026 | Open |
| A6 | Ask whether AIPLA should be an AI-labs case study — it is the shape of thing they describe supporting | JB | Q4 2026 | Open |

**Timing.** A1–A3 want to happen in September–November, while the taskforce is
forming and the catalogue is open. This is the whole reason the item is P1
despite being small: it is not urgent work, it is *perishable* work.

---

## Non-Goals

- Committing to build anything for KU. Nothing here is a deliverable to the AI
  office; AIPLA's obligations are to its own programme.
- Repositioning AIPLA as a platform vendor. If Option 2 happens it happens
  because KU IT wants it, on their initiative, with the conflict of interest on
  the table from the first conversation.
- Slowing AIPLA's own roadmap pending KU decisions. The pilot and the research
  programme are the job; this is opportunistic alignment around it.

---

## Open Questions

1. **Who actually decides?** Vice-rector, AI office, KU IT, or a faculty? The
   article implies the office coordinates and KU IT builds, which usually means
   the real decision sits with whoever holds the budget line. Unknown.
2. **Is AIPLA's Center for Digital Education host already represented on the
   cross-faculty taskforce?** If so, that is the cheapest route in and A1 is
   mostly answered. JB will know.
3. **Does the extension's remit cover this?** 2.5 days/week is committed to
   AIPLA's own programme. Institutional alignment work is defensible as serving
   the handover, but it is not free, and it should be visible to JB rather than
   absorbed silently.
4. **What happens at the three-year mark?** The vice-rector post dissolves in
   2029; AIPLA's programme runs on a similar horizon. If AIPLA is the exemplar of
   "integrated into a discipline", that is the argument that outlasts both — but
   only if somebody writes it down before then.
