# Importing a simulation somebody already built — the missing middle rung

**Status**: **Design (OPEN)** — **1.1.104**
**Priority**: **P2** — not urgent, but it is the third request for "more simulations" and the first one that arrives **with the simulation already written**
**Estimated**: ~3–4d (M0 mechanical gate ~1d · M1 submit + review queue ~1.5d · M2 promote to catalogue ~0.5d · M3 provenance ~0.5d)
**Scope**: Backend/CI — a checker that runs the ADR-013 gates on a candidate artefact, a submission store, and a promote step that writes into the existing artefact layout; frontend — a minimal researcher/admin review surface. **No new runtime**: the approved output is the artefact directory the sandbox already serves
**Dependencies**: [`mcp-app-artefact` skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) (the artefact path + the gates, **documented and in use**); [1.1.41 teacher-sim-resources](teacher-sim-resources.md) (**SHIPPED** — the artefact/activity decoupling and `ArtefactMeta`); [sim-catalogue-admin](sim-catalogue-admin.md) (the metadata CMS this sits **below**); [2.4 teacher-artefact-authoring](../post-pilot/teacher-artefact-authoring.md) (the in-product authoring tier this sits **above**); ADR-013 (artefact safety — the gates are not new, only their automation is)
**Created**: 2026-09-09
**Source**: [notes-2026-09-09.md](../../../notes-2026-09-09.md) item 4 — *"Aswin has a simulation HTML he has made in the Claude website already — want to point at this and say make this a simulation we can import into the app (his example was a kettle simulation)"*. **Decision D6** in the [triage](meeting-2026-09-09-triage.md)

## Problem Statement

**Somebody produced a working physics simulation in a chat window and there is
no way to get it into the product.**

The three tiers of artefact control that exist on paper have a hole in the
middle:

| Tier | What it does | State |
|---|---|---|
| **Top** — [2.4 teacher-artefact-authoring](../post-pilot/teacher-artefact-authoring.md) | Write artefact code **inside** the product, with AI assist | Roadmap signal, not committed |
| **Bottom** — [sim-catalogue-admin](sim-catalogue-admin.md) | Edit metadata and `tutorBlock` for a sim **whose code is already deployed** | Planned, post-pilot |
| **Missing** | **Bring code that already exists into the catalogue** | ← this doc |

The bottom tier assumes the code got there somehow. The top tier is about
writing code from nothing. **The case that actually keeps happening is neither:
a physicist has working HTML and wants it served.**

### The evidence that the current path does not work

Today the route is: clone the repo, add
`infrastructure/mcp-sandbox/artefacts/<name>/v<version>/`, open a PR, wait for
review, wait for the deploy trigger. In this meeting M *"directed him to GitHub
and using Claude Code directly"*, and — the load-bearing detail — **also handed
over a repo zip so he could get his document materials out**. A researcher
downloading a zip of the application repository is not a workflow; it is the
absence of one.

**And the supply is about to increase.** Item 21 of the same meeting asks
teachers to contribute examples; [1.1.81 teacher-authored-workbench-apps](teacher-authored-workbench-apps.md)
records *"teachers need agency to create applications"* as the most persistent
ask in the feedback record. A model that writes a passable single-file
simulation is now ordinary. **The scarce thing stopped being the code and became
the route in.**

## Decision — D6: a reviewed pipeline, not an upload button

An artefact arrives as a file. The ADR-013 gates run **mechanically**. A human
approves. Only then is it served.

**Self-serve publish was rejected.** ADR-013's gates — the 200 KB cap, no
external fetches, sandboxed iframe, CSP — were written against exactly the
material this path invites, and an artefact runs in an iframe in front of a
classroom. Nothing about automating the *checks* argues for removing the
*approval*.

**Doing nothing was also rejected**, and it is the option with the better
disguise: the git path technically works, so the gap reads as a preference
rather than a defect until you notice who it excludes — everyone on the project
except M.

**What is genuinely new here is small.** The gates are documented and already
applied by hand. This mostly makes a checklist executable and gives the result
somewhere to sit.

## Milestones

### M0 — the gates become a command ~1d

`aiplatform sim check <path>` — and the same code in CI. Every rule from
ADR-013 and the `mcp-app-artefact` skill, each pass/fail naming the rule:

- **Size** — the 200 KB cap, measured on what is served, not on the source.
- **No external fetches** — no off-origin `src`/`href`/`fetch`/`import`. This is
  the one a chat-authored file fails most often, because a model reaches for a
  CDN by habit. **The CSP would block it silently at runtime**, so the
  simulation would simply not work in front of a class with no error anyone
  sees — which is precisely the silent-failure class workstream F exists for.
- **Sandbox compatibility** — no top-level navigation, no storage assumptions,
  no parent-window access outside the documented bridge.
- **The bridge, if it claims to use it** — a sim that pushes state must speak the
  shipped snapshot contract, or the tutor gets nothing and
  [the trust card](../../../../.claude/skills/workbench-element-builder/SKILL.md)
  never appears.

**A check that cannot run must fail, not pass.** An unparseable file is
`UNKNOWN`, never `OK`.

⚠️ **M0 is useful entirely on its own** and should ship first regardless of the
rest. It turns today's hand-review into something a contributor can run before
asking, which is most of the value for a fraction of the cost.

### M1 — submit, and a queue ~1.5d

A submission is a file plus a title, a description and a claimed physics topic.
It lands in a store with `status: submitted`, M0's report attached. A
researcher/admin surface lists them, renders the candidate **in the real
sandbox** (not a preview iframe — the sandbox is the thing whose behaviour is in
question), and approves or rejects with a reason.

**Rejection reasons are the product.** *"Rejected"* teaches nobody anything;
*"loads a script from cdnjs, which the CSP blocks — inline it"* is a
contributor who succeeds on the second try.

### M2 — promote into the catalogue ~0.5d

Approval writes the artefact into the existing layout and the existing
`ArtefactMeta`. **No second serving path**, no runtime-uploaded code: the output
of this pipeline is byte-identical to what a PR produces today. That constraint
is what keeps this a 3–4 day item rather than a new security surface.

Whether promotion is a commit-and-deploy or a bucket write is the one real
implementation choice, and the commit path is the conservative default — it
keeps every served artefact in git history, reviewable after the fact.

### M3 — provenance ~0.5d

Who submitted it, when, what M0 said, who approved it, and **what made it** —
*"authored in claude.ai, imported 2026-09"*. Two reasons this is not
bookkeeping: a sim that turns out to teach something wrong needs its siblings
found, and a research programme publishing about AI-assisted content needs to
know which of its own materials were AI-assisted.

## Open questions

1. **Who approves?** Researcher claim, `programmeAdmin`, or M. The
   [1.1.76](delegated-programme-administration.md) precedent says: not M alone —
   that doc exists because one person could admit a teacher.
2. **Correctness is not covered and must be said out loud.** M0 checks *safe to
   serve*, not *physics is right*. [1.1.81](teacher-authored-workbench-apps.md)
   states the harder requirement plainly — *"a wrong simulation shown
   confidently to a class is worse than none"* — and nothing here addresses it.
   The reviewer is the only defence, and the review surface should say so rather
   than implying a green checklist means correct.
3. **Versioning.** The layout is already `v<version>`; the question is whether a
   revision supersedes or coexists. Coexist, probably — an activity pinned to a
   sim should not change under a class mid-term.
4. **Does this subsume `sim-catalogue-admin`?** They share a store and a
   surface. Possibly one doc; keep them separate until M1 is built and the
   overlap is visible rather than predicted.

## What this doc deliberately does not do

- **Let a teacher publish a sim unreviewed.** D6.
- **Open in-product code authoring.** That is 2.4 and it is a much larger
  question, including whether a non-programmer can verify what they have made.
- **Invent a second artefact-serving path.** The output is the artefact
  directory that ships today.
