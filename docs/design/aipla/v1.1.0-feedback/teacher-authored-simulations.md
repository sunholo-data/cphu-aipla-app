# Teacher-authored simulations — scoping the path from developer-only to teacher-reachable

**Status:** **Scoping (OPEN)** — deliberately a decision document, not a build plan. No milestone is committed until an option is chosen.
**Priority:** **P2 for the pilot; P1 for handover.** No teacher path can be built and hardened before 2026-08-14, and the pilot works without one (three curated sims + the element palette). It matters at **handover (2026-09-15)**: a platform where only M can add a simulation has a bus factor of one.
**Estimated:** Option A ~2–3d · Option B ~4–5d + ongoing review load · Option C ~2–3w and a standing security commitment. **The decision is the deliverable here**, not an estimate.
**Scope:** Would touch `infrastructure/mcp-sandbox/`, the `backend/artefacts/` catalogue, the sandbox Cloud Build pipeline, the activity builder, and ADR-013's security envelope. Nothing is scoped until an option is picked.
**Dependencies:** ADR-013 (artefact safety — the binding constraint); [1.1.41 unified-sim-rendering](unified-sim-rendering.md) (**SHIPPED** — `GenericArtefactFrame`, the one mount every sim renders through); the `mcp-app-artefact` skill (the current developer recipe); [external-host-mcp-apps](external-host-mcp-apps.md) (the MCP-Apps portability work — relevant to Option B)
**Source:** Aswin, 2026-08-06 — *"If the teachers want to add their own simulation in students' workbench, how would they do that?"* M's reply: *"Currently that goes through the backend code (e.g. me) but the skill is set up to make it easy, but need to think about how best to implement."*
**Created:** 2026-08-06 (M)
**Last Updated:** 2026-08-06 (M)

## Problem Statement

**Adding a simulation requires a developer, a commit and a deploy.**

The shipped path, encoded in the `mcp-app-artefact` skill:

1. Static files land in `infrastructure/mcp-sandbox/artefacts/<name>/v<version>/`
   (scaffolded from `_template` / `aiplatform sim scaffold <name>`)
2. A catalogue entry in `backend/artefacts/<name>.yaml` — id, version, display
   name, topics, levels, `eventVocabulary`, `tutorBlock`, status
3. Push to `dev` → the `aipla-mcp-sandbox-deploy` trigger bakes the artefact into
   the `aipla-v01-sandbox` image
4. ADR-013 gates: 200 KB cap, no external fetches, sandboxed iframe + CSP,
   library-bypass review

This is a good pipeline. Three sims (Boldkast, LED Planck, KineBot) live on it,
the scaffold is real, and the security posture is coherent. **It just has a
developer in the middle of it**, and — per the `tutorBlock` in
[`boldkast.yaml`](../../../../backend/artefacts/boldkast.yaml), still marked
`PLACEHOLDER — AR to refine` — even the *pedagogical* half of a catalogue entry
currently routes through a repo commit.

Two consequences:

- **For the pilot:** a teacher with a specific simulation in mind cannot use it.
  Survivable — the palette covers a lot, and three sims plus tables/charts/
  calculators is a real activity space.
- **For handover:** genuinely serious. If "add a simulation" means "ask M", the
  platform is not handed over in any meaningful sense.

### Why this is hard, and not a UI problem

A simulation is **arbitrary executable code shown to minors in a school**. The
existing pipeline's safety comes from a human reading the code before it ships.
Any teacher-facing path must replace that review with something, and the honest
options are: constrain what can be authored, keep a human in the loop, or accept
a weaker guarantee. There is no fourth option, and a design that pretends
otherwise is the failure mode to avoid here.

Secondary but real: a sim is not just an iframe. Its **`eventVocabulary` and
`tutorBlock`** are what let the tutor interpret what the student did. A sim
added without them renders and is pedagogically inert — the exact failure
[1.1.62](workbench-element-awareness.md) documents for workbench elements. Any
option must produce those two fields, from someone competent to write them.

## Goals

**Primary (this doc):** Choose an option, with its security posture and
handover implications stated, so the build can be scoped afterwards.

**Requirements any option must meet:**

- No path by which teacher-supplied content executes outside the sandboxed
  iframe + CSP envelope of ADR-013.
- Every sim reaching a student has an `eventVocabulary` and a `tutorBlock`, or
  is explicitly marked pedagogically inert.
- A named person is accountable for what students see.
- **Someone other than M can operate it** — the handover test.

**Non-goals:**

- Shipping before the pilot.
- Replacing the developer pipeline. Whatever is chosen sits *beside* it; the
  curated path stays for high-value sims.
- Teacher-authored *arbitrary* JavaScript with no review under any option.

## The options

### Option A — Parameterise the sims we have

A sim declares teacher-tunable parameters in its catalogue YAML; the teacher
configures rather than authors.

```yaml
parameters:
  - id: gravity
    label: Tyngdeacceleration
    kind: number
    default: 9.82
    min: 1.0
    max: 25.0
  - id: show_trajectory
    label: Vis baneline
    kind: boolean
    default: true
```

The builder renders a parameter form; values ride the activity config and reach
the artefact through the existing iframe-context channel.

**Security:** unchanged. No new code is executed — parameters are bounded,
typed, validated server-side against the declared schema.

**What it gives:** the same sim as several pedagogically distinct activities —
Boldkast on the Moon, Boldkast without the trajectory line so students predict
it first. That is a genuine multiplier on three sims.

**What it does not:** a teacher who wants a *pendulum* still cannot have one.
This does not answer Aswin's question; it reduces how often it is asked.

**Handover:** good. Fully teacher-operable, nothing to review.

### Option B — Teacher-requested sims with a curation queue

A teacher describes the sim they want (or supplies a URL to an existing one, e.g.
PhET); it enters a queue; a reviewer authors or vets it and publishes it to the
catalogue.

Two sub-cases with different risk:

- **B1, request → we build.** Honest about the constraint: the queue is a
  request tracker. Turnaround measured in days.
- **B2, teacher supplies a URL.** Tempting — PhET has hundreds of good physics
  sims — and much more dangerous than it looks. A third-party origin in an
  iframe means no `eventVocabulary` (the tutor sees nothing the student does),
  no 200 KB guarantee, no CSP guarantee, an external network dependency in a
  classroom, and a live third-party page whose content can change after review.
  It breaks the `tutorBlock` contract by construction.

**Security:** B1 keeps human review, so the posture is today's. B2 substantially
weakens it and would need its own ADR — the `external-host-mcp-apps` work is
about *us* being embeddable elsewhere, which is the opposite direction and does
not transfer.

**Handover:** B1 is only as good as who staffs the queue. That is a
**staffing** answer to a technical question, which may be the right answer for a
research programme with a curriculum owner — but it must be said out loud, not
smuggled in as a feature.

### Option C — AI-generated sims from a teacher description

The teacher describes a simulation; a model generates HTML/JS against the
`_template` scaffold; it is auto-checked (size, no external fetches, CSP
compliance, no disallowed APIs) and sandboxed.

**Security:** the hardest. Automated checks can enforce ADR-013's *mechanical*
constraints — that is real and worth having. They cannot establish that the
physics is **correct**. A generated projectile sim with a sign error is a
perfectly compliant artefact that teaches the wrong thing, and it will be
subtle. In a physics-education research programme, a plausible-looking sim with
wrong physics is worse than no sim: it contaminates the data as well as the
learning.

**Handover:** superficially the best (nobody in the loop) and possibly the
worst — an unreviewed generation path with no physics gate, handed to a team
without the person who understands its limits.

**Not "no", but not now.** With a teacher-preview-and-approve step and an
AR/JB physics check before a sim reaches students, C becomes a defensible
*accelerator for B1* rather than a replacement for review. That framing is worth
revisiting after the pilot, with pilot evidence about what teachers actually ask
for.

## Recommendation

**A now, B1 alongside it, C as a post-pilot question.**

- **A** is buildable, changes nothing about the security posture, is fully
  teacher-operable at handover, and multiplies three sims into many activities.
  It is the only option that is unambiguously net-positive.
- **B1** is honest about the constraint and is what actually answers Aswin. Its
  cost is a named reviewer, which is a programme decision (AR? JB?) rather than
  an engineering one — and the [`boldkast.yaml`](../../../../backend/artefacts/boldkast.yaml)
  `tutorBlock` still sitting at `PLACEHOLDER — AR to refine` is evidence that
  this queue **already exists informally and is already under-staffed**. Making
  it explicit is an improvement over the status quo regardless.
- **B2 is not recommended.** The `eventVocabulary` loss alone makes an
  externally-hosted sim pedagogically inert in our tutor loop, before the
  security objections.
- **C** is worth prototyping offline during the pilot to learn what the failure
  modes look like, with **no path to students** until there is a physics gate.

The handover risk is not eliminated by A+B1 — it is **converted** from "only M
can add a sim" to "only a named reviewer can approve one", which is a role a
successor can hold.

## Axiom Alignment (Option A, as the recommended buildable slice)

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Parameters ride the config already fetched at workspace mount. |
| 2 | EARNED TRUST | +1 | Non-default parameters are visible to the student ("this simulation uses g = 1.62 m/s²") — a silently altered physical constant is a trap. |
| 3 | SKILLS, NOT FEATURES | 0 | Artefact-layer configuration. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Zero LLM. |
| 5 | GRACEFUL DEGRADATION | +1 | No `parameters` block → today's behaviour. Unknown parameter ignored by the artefact, not fatal. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Extends the shipped catalogue YAML; reuses the iframe-context channel. |
| 7 | API FIRST | +1 | Parameters ride the activity contract; CLI parity for free. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Parameter values stamped on chat-log rows — otherwise two sessions of "Boldkast" are not comparable research data. |
| 9 | SECURE BY CONSTRUCTION | +1 | Bounded, typed, server-validated against the artefact's own declared schema. No new execution path. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Validation server-side; the client renders a form from the schema. |
| 11 | USABLE BY DESIGN | +1 | Turns three sims into a usable range without a developer. |
| | **Net Score** | **+8** | Threshold: >= +4 |

*Options B and C are not scored — scoring an unchosen option implies a
commitment this doc is explicitly avoiding.*

## Security Considerations

ADR-013 is the binding constraint and none of this relaxes it: sandboxed iframe,
CSP, 200 KB cap, no external fetches, library-bypass review.

- **Option A** introduces no new execution. Its one real risk is a parameter
  reaching the artefact **unvalidated** — bounds must be enforced server-side
  against the declared schema, never only in the form widget.
- **Option B2** would breach "no external fetches" as its central mechanism and
  needs its own ADR before any prototype, not after.
- **Option C** can satisfy ADR-013 mechanically and still ship wrong physics.
  Any future C work states its physics gate before its generation pipeline.

The sandbox is a separate Cloud Run service (`aipla-v01-sandbox`) on its own
origin, versioned independently of the app — that isolation is load-bearing for
every option and must not be eroded to make a teacher path convenient.

## Open Questions

1. **Who staffs the B1 queue?** The real blocker. Engineering cannot answer it.
   AR and JB are the candidates; the `PLACEHOLDER` `tutorBlock` suggests
   capacity is already the constraint.
2. **Which parameters do the three sims expose?** Needs AR/JB input per sim —
   a physically meaningful parameter set, not "every variable in the code".
3. **Is PhET worth a narrow exception?** A vetted allowlist of specific PhET
   URLs, reviewed once, is a much smaller ask than general B2 — though still
   with no `eventVocabulary`. Worth asking Aswin whether that would meet the
   need he actually has.
4. **What does a teacher actually want?** Aswin asked *how*, not *for what*.
   Before building anything, ask the pilot teachers which simulation they wanted
   and could not have. Three concrete answers may make B1 look like a two-week
   job rather than an open-ended commitment. **This question should go into the
   21 August teacher training.**

## Related Documents

- ADR-013 (artefact safety) — scoping site `architecture.qmd`
- `.claude/skills/mcp-app-artefact/SKILL.md` — the current developer recipe
- [unified-sim-rendering.md](unified-sim-rendering.md) — 1.1.41, `GenericArtefactFrame` + `tutorBlock` stacking
- [external-host-mcp-apps.md](external-host-mcp-apps.md) — us embeddable elsewhere; the opposite direction to B2
- [handover-maintainability-audit.md](handover-maintainability-audit.md) — the bus-factor framing
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's raw feedback
