# A safe, powerful substrate for student/teacher-authored physics simulations (tldraw investigation → engine/scene architecture)

**Status:** Investigation / roadmap signal — **not committed to build**. Started as a tldraw wiring question; converged on the real goal (below).
**Target:** The trusted-engine substrate (§3″) is v1.1-buildable; the AI/GUI authoring layer is **v2 / Year-2**. *(Written as "outside the current contract window (2026-05-15 → 2026-09-15)". Revised 2026-08-27: the engagement runs to at least April 2027 at 2.5 days/week, so the authoring layer is reachable in-window if it earns the slot — re-rank on merit, not on the calendar.)*
**Audience:** M (architecture), JB/AR (pedagogy), Year-2 planning.
**Scope question (as it evolved over 2026-07-20):**
1. *"tldraw looks like a route for students to make their own physics apps via prompts — MCP App, embedded, or what?"* → §1–§7.
2. *"I built a balls-colliding sim in tldraw via a physics library — can we build that ourselves?"* → §3′ (yes: Boldkast + matter.js).
3. **The actual goal: *"a safe but powerful way for students and teachers to create physics simulations as they investigate questions — beyond what we hand-roll and prepare."*** → **§3″ is the answer.**
**Created:** 2026-07-20
**Last Updated:** 2026-07-20
**Related:**
[expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J — the `drawing-board` workbench type; **contains a licensing error this doc corrects**),
[teacher-artefact-authoring.md](teacher-artefact-authoring.md) (the *teacher* analog — "can a teacher build a sim themselves"),
[teacher-artefact-parameters.md](teacher-artefact-parameters.md),
the `mcp-app-artefact` skill (static-vs-dynamic decision tree, ADR-013 gates),
ADR-013 (artefact safety) + ADR-003 (model tiers) in the scoping site.

---

## TL;DR — the recommendation up front

**The real ask (M's third framing): a safe *and* powerful way for students/teachers to *create* physics sims as they investigate — beyond what we hand-roll. The answer is not tldraw and not arbitrary AI-generated code. It's an *engine/scene split*: we hand-roll one trusted [matter.js](https://github.com/liabru/matter-js)-based *engine* (vet-once, correct physics); students/teachers/AI author *scenes* (validated JSON data, never code) that the engine runs. That gives safety (no arbitrary code; the engine — not the author — computes the dynamics, so wrong physics is impossible by construction) and power (any scene the engine can express, a space that dwarfs any fixed library and grows as we extend the engine). Three authoring on-ramps — GUI, natural-language→scene, remix — converge on one schema. This is the Algodoo/Falstad architecture, MIT/self-hostable, reusing AIPLA's existing artefact + authoring + tutor-wire plumbing. See §3″ — it's the spine of this doc.** The tldraw-specific points below (§1–§7) still stand and explain why tldraw is at most an authoring GUI, never the runtime.

1. **The tldraw thing we have installed is not the thing students would use.** The demo is **tldraw *Desktop*** — an offline Electron canvas with a local agent-scriptable HTTP server (that's what the `tldraw-offline` skill drives). That is an *authoring / developer* surface. What ships to a student in a browser is either the **tldraw *SDK*** (a heavy React canvas component) or a **static build** of it. Keep the three tldraws separate (§2) or the whole discussion gets confused.

2. **The valuable thing — an engine-backed physics simulation (balls colliding, pendulums, ramps) — we can build ourselves today, with no tldraw and no licence.** (Clarified with M, 2026-07-20: the interest is a *simulation* app built on a physics JS library, not a sketch board.) The deployable app is just **a physics-engine library + a render loop** — tldraw was only M's *authoring canvas*, not part of the runtime. **Boldkast already is this pattern** (a self-built physics app; it just hand-codes projectile motion instead of using a general engine). The only new ingredient is a general rigid-body/collision engine: **[matter.js](https://github.com/liabru/matter-js) — MIT, zero deps, pure JS, 83 KB minified (~26 KB gzipped)** — which inlines into a static artefact under ADR-013's 200 KB cap with **zero pipeline changes**. So "balls colliding" = "Boldkast with matter.js." See §3′.

3. **"MCP App vs embedded" is the wrong axis to decide on first.** The real fork is **what "make their own physics app" means** (§3):
   - **Reading A — a drawing board.** Student *sketches* a free-body diagram / circuit / graph; the tutor reads the sketch (multimodal) and Socratically responds. **This is already designed** as workbench **Type 2 (`drawing-board`)** and the current recommendation there is **Excalidraw, not tldraw.** (We essentially have this.)
   - **Reading A′ — an engine-backed simulation (the actual ask).** A physics sim (collisions, constraints, gravity) built on matter.js, rendered to canvas, shipped as a static artefact like Boldkast. **Buildable now, licence-clean, no tldraw.** The only open question is *who assembles it* (we / a canvas authoring tool / AI) — §3′.
   - **Reading B — a generative canvas.** Student *prompts* ("make a pendulum with an adjustable length") and an LLM **generates** the sim (matter.js config or "make real" HTML). tldraw's AI stack (`@tldraw/ai`, make-real, agent kit) is one way to *author* this; Excalidraw has no equivalent. This is the ambitious, Year-2 read — and it sits **on top of** A′ (the AI generates an A′-style sim). Gated on the physics-correctness spike (§6, §9).

4. **Where it renders, once you know which reading:**
   - Reading A′ (engine sim) → **static artefact in the existing mcp-sandbox iframe** — matter.js inlined, exactly like Boldkast. No tldraw, no host embedding, no new infra (§3′, §4a).
   - Reading A (sketch) → **static artefact** too, *if* we use Excalidraw; tldraw does **not** fit that path (§4, §5).
   - Reading B (AI-authored) → the *generation* happens server-side (existing backend + model tiers); the *editor*, if we use tldraw for authoring, is a **host-embedded React surface** (the SDK is a multi-MB, license-keyed React dependency that can't live in the static-artefact model); the *generated sim* renders back as a sandboxed static artefact (A′) or a **dynamic MCP server** `ui://` resource.

5. **Licensing is a real gate, and the existing doc gets it wrong.** [expanded-workbench-types.md:71](../v1.0.0-pilot/expanded-workbench-types.md) says *"tldraw (also MIT)."* **tldraw is not MIT.** The SDK requires a *"Made with tldraw"* watermark on the canvas or a **paid business license** to remove it, and **won't run in production (HTTPS, non-localhost) without a license key.** For UCPH on-prem (ADR self-hosting), that's a commercial dependency and a watermark on every student's canvas. **matter.js and Excalidraw are genuinely MIT**, watermark-free, license-key-free. That asymmetry, not "API surface," is the actual tldraw-vs-alternatives decision — and it's why the *runtime* wants matter.js, and tldraw only ever enters as an *authoring* option.

6. **Net:** the physics-sim capability (A′) is **buildable now on the Boldkast pipeline with matter.js** — do that whenever we want richer sims; it needs no tldraw and no decision from this doc. Reach for **tldraw only for authoring** — either a canvas where a student/teacher drops shapes that become physics bodies, or the generative "make real" loop (B) — accepting the licence cost, and (for B) only after a spike proves generated-physics correctness. **Recommend: (a) treat "matter.js sim artefact" as a normal `mcp-app-artefact` build, available immediately; (b) a ½–1d spike on the authoring/generative layer (§9) before committing to tldraw specifically.**

---

## 1. What was asked, and why it needs disambiguating

The prompt: *tldraw "seems like a good route for possibly adding within the app for students to make their own physics apps via prompts. Would it work best as an MCP App, embedded within, or what?"*

Three things are conflated in that sentence and each pulls a different way:

- **"tldraw"** — which tldraw? (the Desktop demo we installed, the React SDK, or the AI stack)
- **"make their own physics apps"** — sketch a diagram, or *generate* an interactive app?
- **"via prompts"** — the student types and *something is created*. That's the generative claim, and it's the load-bearing part.

This doc resolves each, then answers the hosting question, because the hosting answer is **downstream** of the other two.

## 2. The three tldraws (do not conflate)

| | What it is | Runs where | Role for AIPLA |
|---|---|---|---|
| **tldraw Desktop** (the demo we installed) | Offline Electron canvas app with a **local HTTP server** exposing docs/shapes/exec to an agent (the `tldraw-offline` skill drives it) | On a developer's / teacher's Mac | **Authoring / dev tool only.** Not deployable to students in a browser. Useful as a *teacher/us* authoring surface (see §4d), never as the student surface. |
| **tldraw SDK** (`tldraw` on npm) | An infinite-canvas **React component** — the actual embeddable library | In the browser, as part of a React app | The candidate student surface. Heavy (multi-MB), stateful, **needs a license key in production** (§5). |
| **tldraw AI stack** (`@tldraw/ai`, "make real", agent starter kit, tldraw *computer*) | Modules + patterns for **LLM ⇄ canvas**: read the canvas into a prompt, apply model output back as shapes / generated code | Browser SDK + your own model backend | The *only* reason to prefer tldraw over Excalidraw. This is "make their own app via prompts." |

**Consequence:** the installed demo being agent-scriptable is a red herring for the student use-case — that's the *Desktop* app's local server, not something a student in a Cloud Run frontend can touch. If it inspires anything, it's a **teacher/us authoring** workflow (§4d), not the student one.

## 3. Two readings of "make their own physics apps"

### Reading A — the drawing board (sketch → tutor reads it)

Student draws a free-body diagram, a ray diagram, a circuit, a v–t graph by hand; the Socratic tutor **reads the drawing** and asks about it. There is no code generation — the "app" is the canvas itself.

**This is already designed.** It is workbench **Type 2 (`drawing-board`)** in [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md):

- `workbench_type: drawing-board` on the activity/skill config.
- Served through `StaticArtefactFrame` like any other App; completes the `ui/initialize` handshake; emits `drawing-board.update` on share/idle.
- Agent side: the InstructionProvider converts the exported **SVG → text description via a multimodal model call**, and the tutor questions what it "sees."
- **Recommended implementation there: self-hosted Excalidraw** (MIT), tldraw only named as a fallback.

For Reading A, **tldraw buys us nothing over Excalidraw** and costs us the license (§5). If this is what's wanted, the answer is "build 1.J Type 2 with Excalidraw" and this investigation is done.

### Reading A′ — the engine-backed simulation (the actual ask; §3′ below)

Not a sketch and not (yet) AI-generated: a **running physics simulation** — balls colliding, a pendulum, a block on a ramp, an orbit — that the student can perturb and the tutor can read. This is what M built in tldraw. It's important enough to get its own section (§3′) because it changes the whole answer: **it needs no tldraw, no licence, and no new infrastructure — it's a Boldkast-class static artefact with a physics engine swapped in for hand-rolled equations.**

### Reading B — the generative canvas (prompt → app is generated)

Student types *"make a pendulum I can change the length of"* or *"show me projectile motion with a wind slider"*, and an **LLM generates an interactive artefact** — either as tldraw shapes/interactions on the canvas, or as a "make real"-style HTML mini-app previewed next to the sketch.

This is where tldraw is genuinely differentiated:
- **`@tldraw/ai`** — helpers to serialize canvas → prompt and apply model instructions → shape create/update/delete.
- **"make real"** — sketch-a-UI → model returns working HTML/JS → rendered live beside the drawing. Directly analogous to "student sketches a physics setup, model makes it interactive."
- **Agent starter kit / tldraw computer** — an agent that draws/operates the canvas while the student talks; visual node-graph pipelines.

Excalidraw has **no first-party equivalent**. If the ambition is genuinely *generative student-made apps*, tldraw (or a hand-rolled generate-to-artefact loop) is the only serious canvas option.

**But note:** Reading B substantially overlaps a capability AIPLA already has a home for — **teacher artefact authoring** ([teacher-artefact-authoring.md](teacher-artefact-authoring.md)) is *"can a *teacher* build a sim via AI assist."* Reading B is the *student* version of the same generate-an-interactive-artefact loop. Before building a tldraw-specific student path, decide whether this is one generation pipeline with two audiences, or two.

## 3′. The engine-backed physics sim — what "balls colliding" actually is, and why we already can build it

M built, in tldraw, a simulation of balls colliding driven by a physics JS library. The question was *"is that something we can build ourselves?"* — **yes, and we already ship the pattern.** Separating the pieces:

| Piece of what M made | What it actually is | Do we have it? |
|---|---|---|
| The canvas M drew shapes on | **tldraw Desktop — an authoring surface** | Yes, but irrelevant to the deployed sim (§2) — it's where *M* worked, not where a *student* runs the app |
| "Balls collide, bounce, fall" | A **2D rigid-body physics engine** stepping bodies each frame | Not yet as a *library*; **hand-rolled equivalents exist** (Boldkast) |
| The picture on screen | A **canvas/DOM render loop** (`requestAnimationFrame`) | Yes — Boldkast, KineBot, LED-Planck all do this |
| Sliders / reset / "share with tutor" | The **artefact ↔ tutor wire** (snapshot push + trust card) | Yes — shipped, shared across all artefacts |

So the *only* new ingredient is the general physics engine. And that's a solved, licence-clean, sandbox-sized dependency:

| Engine | Licence | Deps | Minified | Fits ADR-013 200 KB static artefact? |
|---|---|---|---|---|
| **matter.js** | **MIT** | none | **83 KB** (~26 KB gz) | **Yes** — inline it in `index.html` like any other artefact code |
| planck.js (Box2D port) | MIT | none | 297 KB | No (over cap) — would need host-embedding |
| rapier.js | Apache-2 | WASM | ~500 KB–1 MB | No — WASM load + over cap |

**matter.js is the sweet spot**: MIT (no watermark, no key, on-prem-clean), pure JS (no WASM fetch), no network, and it inlines under the cap. Verified against the npm registry + unpkg build (2026-07-20).

**Boldkast is the existence proof.** It is already a physics app we built ourselves — it just hand-codes one trajectory equation (`EARTH_G = 9.82`, velocity decomposition, `requestAnimationFrame` tick — no library). A collision sim is the *same artefact*, with matter.js supplying the rigid-body/collision math Boldkast doesn't need. Concretely, "balls colliding" ships as:

```
infrastructure/mcp-sandbox/artefacts/collision-lab/v1/index.html
  <style> … Boldkast's light-theme CSS vars …
  <script> /* matter.js 0.20.0, inlined, 83 KB */ </script>
  <script>
    // create engine + world, add walls + balls, Matter.Engine.update on each RAF tick,
    // render bodies to <canvas>, sliders → body.restitution / world.gravity,
    // on "share": postMessage the state (positions, KE, momentum) to the tutor
    //             + the "shared with the AI" trust card (workbench-element-builder skill)
  </script>
```

Everything but the `<script>matter.js</script>` line and the engine wiring is a copy of the Boldkast/`_template` artefact. This is a **normal `mcp-app-artefact` build** — no design decision required, no tldraw, no licence, no host embedding, no new Cloud Run service. It's available the moment we want richer sims than hand-rolled equations allow.

**What this does *not* answer — the genuinely new question: who assembles the sim?** Three levels, increasing ambition:

1. **We build a matter.js sim library** (collision lab, pendulum, ramp, orbit, momentum bench) as hand-authored artefacts. Cheapest; ships today; same as how Boldkast shipped. **This is the recommended near-term move** if the goal is "students have richer physics sims."
2. **A student/teacher *authors* a sim** — drops shapes on a canvas that become physics bodies, sets gravity/restitution, saves it. This is the tldraw-shaped surface. Build options: **(i)** a small bespoke matter.js editor (MIT stack, on-prem-clean, more work), or **(ii)** embed tldraw purely as the *authoring* canvas (its shapes → matter.js bodies), paying its licence (§5) for the editor UX. The *published* sim is still an A′ static artefact either way.
3. **AI generates the sim from a prompt** ("make a Newton's cradle") — the model emits a matter.js scene config (safer: fills slots in a vetted sim template) or make-real HTML. This is Reading B, and it's the layer that gates on the physics-correctness spike (§6, §9).

The insight: **levels 1 and the engine are free and immediate; the cost and risk live entirely in the *authoring* layer (2) and the *generation* layer (3).** tldraw is only ever a candidate for level 2's authoring canvas — never for the runtime.

## 3″. The real goal — a safe *and* powerful substrate for user-authored sims (the engine/scene split)

M's actual target (2026-07-20): *"a safe but powerful way for students and teachers to **create** physics simulations **as they investigate questions** — beyond what we hand-roll and prepare."* This is not a fixed library (that's exactly "what we prepare") and not a sketch board. It's an **authoring capability**, and it has one hard tension:

- **Powerful** wants arbitrary expressiveness — any sim a question demands.
- **Safe** wants the opposite — no arbitrary code execution, and (the harder one for a *tutoring* product) **no wrong physics**. A sim that runs perfectly but conserves momentum incorrectly is worse than no sim: it teaches a falsehood with the authority of a simulation.

### The resolving idea: separate the trusted **engine** (code) from the authored **scene** (data)

> **We hand-roll the *engine*, once, and vet it. Users and AI author *scenes*, infinitely, at investigation time. A scene is validated data, never executable code.**

That single split gives both properties:

| | The **engine** (the "player") | The **scene** (the "document") |
|---|---|---|
| What it is | A matter.js-based runtime + renderer + a domain model (bodies, forces, springs, constraints, later: fields, circuits) | A JSON document: *"two disks, m₁=2kg, m₂=1kg, v₀, restitution e=0.9, on a frictionless track"* |
| Who writes it | **Us**, once. Reviewed by JB/AR for physics correctness | **Students / teachers / the AI**, per investigation |
| Trust | Trusted code, in the repo, tested | **Untrusted data** — validated against a schema, cannot execute |
| Safety role | **Enforces the laws** — the only thing that computes dynamics | Can only *configure*, never *redefine*, the physics |

**Why this is genuinely safe.** Two independent guarantees:
1. **No arbitrary code.** A scene is JSON validated against a schema (Pydantic backend + JSON-schema in the engine). The AI/user emits *configurations*, not *behaviour*. The existing ADR-013 sandbox already contains *code* execution; here we go further — there is no user code to contain, only data. A malformed or hostile scene is *rejected at validation*, not sandboxed-and-hoped.
2. **No wrong physics.** Dynamics are computed *only* by the trusted engine. A student or the AI can set masses, positions, forces, restitution, spring constants — but **cannot make gravity repel, momentum not conserve, or energy appear**, because they never touch the integrator. The worst a bad scene produces is something *uninteresting* or *physically implausible* (silly parameters), not something *physically wrong*. That downgrades the scary failure ("teaches false physics") to a soft one ("teaches a boring example"), which the tutor can even catch and comment on.

**Why this is powerful.** The space of scenes the engine can run is enormous — every arrangement of bodies, forces, and constraints — which already dwarfs any library we'd hand-author. And the ceiling **rises deliberately** as we extend the engine's domain model (below), each extension vetted once and then available to every future scene. It is "beyond what we prepare" precisely because *we* stop preparing sims and start preparing *the medium sims are made of*.

This is the same architecture that makes [Falstad's circuit simulator](https://www.falstad.com/circuit/) education-grade — a **netlist (declarative scene)** fed to a **trusted solver** — and that gives [Algodoo](https://www.algodoo.com/) its "draw it and it comes alive" sandbox. Algodoo is the **north-star UX** (2D, playful, create-your-own); Falstad is the **proof the scene/engine split scales past mechanics** (circuits, waves). Both are the category [PhET](https://phet.colorado.edu/) deliberately *isn't* — PhET is the *prepared* end (fixed, curated, not authorable), i.e. what we already hand-roll and what M wants to go beyond. Neither Algodoo (proprietary, desktop) nor Falstad (GPL, single-author applet) is embeddable/self-hostable into AIPLA as-is, so we build the substrate — but we copy their proven shape.

### Three on-ramps, one scene schema

All three ways to *author* a scene converge on the **same validated JSON**, so safety is guaranteed once at the schema, not three times:

1. **Direct manipulation (Algodoo-style GUI).** Teacher/student drops bodies on a canvas, sets properties, connects springs. This is the [workbench-element-builder](../../../.claude/skills/workbench-element-builder) authoring path; it *emits* a scene. (This is the only place a canvas library — bespoke, or tldraw paying its licence for the editor UX — could enter, and only as the *editor*, never the runtime.)
2. **Natural language → scene (the "via prompts" ask).** Student/teacher: *"make a Newton's cradle with five balls"* → the model **emits scene JSON**, validated before it reaches the engine. This is the safe form of Reading B: the AI's output is *data conforming to a schema*, so a hallucinated or malformed scene fails validation instead of running. Prefer **template-slot** generation (fill parameters in a vetted scene skeleton) over free-form for the first cut.
3. **Remix / parameterise an existing scene.** Start from a scene (ours or a peer's), change values. This is [teacher-artefact-parameters.md](teacher-artefact-parameters.md) (2.3) generalised from "sliders on one fixed sim" to "any authored scene."

### How it maps onto AIPLA (almost entirely reuse)

- **One static artefact = the engine/player** (matter.js in the sandbox), *not* one artefact per sim. The scene arrives via the existing `ui/initialize` handshake / query param / `postMessage` — the artefact contract we already ship.
- **Scene authoring & storage** ride the activity-config + materials plumbing (a scene is just another authored document, like a `ChecklistItem` or `MaterialRef`).
- **AI generation** is a backend tool that returns a **validated scene** (Pydantic), plugged into the activity co-pilot / tutor exactly like the other authoring tools — never returning raw code to the client.
- **Tutor awareness** rides the existing snapshot-push + trust-card wire: the running scene's state (positions, KE, momentum) pushes to the tutor so it can discuss what the student is seeing.

### The domain-growth roadmap (how "powerful" scales safely)

Each tier is a bounded, vet-once extension of the engine's schema; scenes authored against it are then unlimited:

| Tier | Engine capability | Covers | Cost |
|---|---|---|---|
| 1 | matter.js rigid bodies + gravity + collisions + restitution | collisions, projectiles, ramps, momentum, pendulums | **v1.1-ready** (matter.js, §3′) |
| 2 | springs, constraints, motors, friction models | oscillators, coupled systems, simple machines | small — matter.js has these |
| 3 | field/particle model (E/B fields, charges, orbits) | electrostatics, gravitation, circular motion | new engine module |
| 4 | lumped-circuit solver (Falstad-style netlist) | DC/AC circuits, RC/RL | separate engine (or vendor Falstad, GPL — licence check) |
| 5 | 1-D wave / ODE evolver | waves, SHM fields, decay | new module |

### The honest ceiling

Some physics the engine simply can't express (quantum, relativistic, continuous EM fields) until/unless a tier is built. At that boundary the temptation returns to "just let the AI emit arbitrary sandboxed code." **Resist it for a tutoring product:** the ADR-013 sandbox makes arbitrary code *execution*-safe but not *physics*-safe — it can silently teach wrong dynamics, the one failure this whole design exists to prevent. At the ceiling, either grow the engine (vet-once) or fall back to a **hand-built curated sim** for that topic (Boldkast-style). Arbitrary-code generation stays off the table for student-facing physics.

**Net:** the answer to "safe *and* powerful, beyond what we prepare" is **a trusted matter.js-based engine that runs user/AI-authored *scenes* (data, not code)**, with three authoring on-ramps and a deliberate domain-growth ladder. tldraw is at most an *authoring GUI* option for on-ramp 1; the runtime and the safety both come from the engine/scene split, which is pure MIT/self-hostable and reuses AIPLA's existing artefact + authoring + tutor-wire plumbing.

## 4. Where would it render? The four hosting options, mapped to real AIPLA surfaces

AIPLA already has exactly these surfaces; the question is which one hosts a canvas.

### (a) Static artefact in the existing mcp-sandbox iframe — the Boldkast path

**What it is:** a single committed `index.html` under `infrastructure/mcp-sandbox/artefacts/<name>/v<version>/`, served by the shared `aipla-v01-sandbox` Cloud Run service, rendered via `StaticArtefactFrame` inside a locked-down cross-origin iframe (ADR-013: CSP, sandbox flags, **200 KB cap**, no external fetches). Boldkast, KineBot, LED-Planck live here.

**Fit:**
- **matter.js physics sim (Reading A′): yes — this is the recommended home.** matter.js (83 KB, MIT, no deps, no network) inlines under the cap exactly like Boldkast's hand-rolled physics. Self-contained, on-prem-clean, uses the artefact ↔ tutor wire we already ship. **No changes to the pipeline.** (§3′.)
- **Excalidraw sketch board (Reading A): yes.** Excalidraw has a static, embeddable build; MIT; no network needed; the SVG-export → `postMessage` wire matches the existing artefact contract. It's a big-ish bundle but self-contained. This is the path 1.J already assumes.
- **tldraw anything: no.** The tldraw SDK is multi-MB (blows the 200 KB cap by ~10×+), and — fatally — it performs a **runtime license check that treats HTTPS-non-localhost as production and refuses to run without a license key** (§5). A static artefact can't carry a licensed, network-suspicious, multi-MB React app cleanly. Reading B additionally needs to call a model — which the sandbox CSP forbids (no external fetches by design).

### (b) First-class React surface embedded in the frontend — the natural home for tldraw

**What it is:** a real React component in `frontend/src/components/workspace/` (a sibling of `GenericArtefactFrame`/`StaticArtefactFrame`), mounted directly in the host app rather than in a sandboxed iframe. This is where a heavy, stateful, licensed React library belongs.

**Fit:**
- Handles the SDK weight (code-split / lazy-loaded on the workspace route).
- License key lives in host frontend code (it's designed to be public/client-side — safe to ship).
- The AI loop (Reading B) can call the **backend** through the existing `/api/proxy` + AG-UI plumbing rather than fighting the sandbox CSP — the tutor agent already has the model tiers (ADR-003).
- **Cost:** we lose the ADR-013 isolation guarantee for *this* surface. tldraw is our code, not student-authored HTML, so that's defensible — but any *generated* HTML it produces (make-real output) must **not** render un-sandboxed here; it goes back through option (c).

This is the answer to the literal question "MCP App or embedded?": **for tldraw specifically, embedded** — because the SDK can't live in the static-artefact model, and putting our own trusted editor in-host is fine.

### (c) Dynamic MCP server — for the *generated output*, not the editor

**What it is:** a real MCP server (own Cloud Run service, per the `mcp-app-artefact` decision tree) that exposes tools returning `ui://` resources. AIPLA doesn't have one yet; the template ships the pattern (`mcp-ext-apps-map`).

**Fit:** if Reading B produces **HTML mini-apps** ("make real" style), that untrusted, model-generated HTML must be sandboxed. A dynamic MCP server that takes the student prompt + canvas, generates the app, and returns it as a **sandboxed `ui://` artefact** is the correct isolation boundary. The tldraw editor stays in (b); the *thing it generates* renders in the sandbox. This cleanly separates "trusted editor" from "untrusted generated app."

### (d) tldraw Desktop / its MCP — teacher/us authoring, never students

**What it is:** the installed demo. Agent-scriptable local canvas.

**Fit:** potentially a **teacher/author** workflow — we or a teacher build/lay-out a sim on the Desktop canvas with agent help, then export it into the static-artefact pipeline. This connects to [teacher-artefact-authoring.md](teacher-artefact-authoring.md), *not* to the student surface. Worth a separate note; out of scope for "students make their own."

### Summary table

| Option | Hosts what | Best fit | Verdict |
|---|---|---|---|
| (a) Static artefact (sandbox iframe) | Self-contained HTML sim | **matter.js sim (A′)** / Excalidraw sketch (A) | **The physics sim lives here — matter.js, no tldraw** |
| (b) Embedded React workspace surface | Heavy trusted React lib | tldraw SDK *as an authoring canvas* | Only if we adopt tldraw for authoring (level 2) — pays the licence |
| (c) Dynamic MCP server | Untrusted generated HTML | make-real *output* (B) | Generated apps sandbox here |
| (d) tldraw Desktop + MCP | Local authoring | teacher/us only | Authoring workflow, not students |

## 5. Licensing reality check (correction to 1.J)

[expanded-workbench-types.md:71](../v1.0.0-pilot/expanded-workbench-types.md) states, as the basis for naming tldraw a drop-in fallback: *"Fallback: tldraw (also MIT, similar API surface)."* **This is incorrect and should be fixed**, because it makes tldraw look free-of-consequence when it is not.

Verified against tldraw's current license docs (July 2026):

| | **tldraw SDK** | **Excalidraw** |
|---|---|---|
| License | Proprietary **"tldraw SDK license"** (not MIT/OSS) | **MIT** (genuinely OSS) |
| Watermark | **"Made with tldraw" watermark required** on canvas unless you buy a business license | None |
| Production gate | **Won't run without a license key**; HTTPS-non-localhost is treated as production (localhost/HTTP = dev) | None |
| Cost to remove watermark / go to prod | **Paid business license** (contact sales) | Free |
| Self-host / on-prem | License key is client-side/public, validates locally (no phone-home) — so it *works* offline, but you still must **have** a (paid, to remove watermark) key | Fully self-hostable, MIT, no key |
| AI story | **First-party** (`@tldraw/ai`, make-real, agent kit) — the differentiator | None first-party |

**Why this matters for AIPLA specifically:**
- **On-prem (UCPH):** a UCPH-hosted deployment is production HTTPS → **requires a license key**. Fine technically (validates locally), but it's a **commercial procurement item** and, without a business license, a **"Made with tldraw" watermark on every student's physics canvas** — awkward for an academic research context (cf. the no-emoticons / academic-tone steer).
- **The only thing that justifies paying that cost is the AI stack.** For a plain sketch board, we'd be buying a license to reproduce what Excalidraw gives free. So: **Excalidraw for Reading A; tldraw *only if* we commit to Reading B's generative canvas** and judge its AI output good enough to be worth the license.

**Action regardless of build decision:** fix the "(also MIT)" claim in 1.J to *"tldraw — proprietary SDK licence, watermark or paid business licence; choose only for its AI/agent capabilities, not as a license-equivalent Excalidraw swap."*

## 6. The physics-app-quality question (the real risk, not the plumbing)

The hosting question is answerable (§4). The **open risk** is pedagogical, not architectural: **does an LLM generate physics apps that are correct and useful?** "Make real" is impressive for UI mock-ups; a *physics* sim has to get the model right (units, equations, sensible ranges) or it teaches wrong physics — a direct EARNED-TRUST / do-no-harm problem for a tutoring product. This is the thing a spike must de-risk (§9), and it's why this is a roadmap signal, not a build ticket.

Mitigations to explore in the spike: constrain generation to a **parameterised template library** (the model fills slots in vetted physics sims rather than writing free-form physics from scratch) — which also connects to [teacher-artefact-parameters.md](teacher-artefact-parameters.md) and the existing Boldkast-style curated sims. That turns "generate any app" into "assemble from trusted parts," which is both safer and cheaper than full "make real."

## 7. Recommendation

Ordered by cost/risk — the substrate is cheap and safe; only the AI on-ramp needs a gate. Full step breakdown in §9.

- **Build the engine/scene substrate (§3″) — this is the real answer, and it's safe and buildable now.** Step 1: ship one matter.js sim (A′) as a `mcp-app-artefact` (MIT, 83 KB, fits the sandbox, reuses the tutor wire). Step 2: externalise its scene into a **validated JSON schema** so the *same* engine runs *any* authored scene. That already delivers "students/teachers author sims" (by editing scene data / a GUI) with safety by construction — no AI, no tldraw, no licence. **This is where the value is.**
- **Sketch board (Reading A), if wanted separately:** Excalidraw as a static artefact under 1.J Type 2. No licence, on-prem-clean. Independent of this doc.
- **AI authoring on-ramp (Step 3) — spike the *plausibility*, not the safety.** NL→scene is safe by construction (the model emits schema-validated data, never code — §3″). The ½–1d spike (§9) measures only whether the AI picks *pedagogically sensible* scenes, rated by JB/AR. A GUI on-ramp is where tldraw could enter — **only as the authoring editor**, paying its licence (§5), and only if direct manipulation is wanted alongside NL. The runtime stays pure MIT matter.js regardless.
- **Either way:** fix the licensing claim in 1.J (§5, done), and decide whether the generation layer is really a *second audience on the teacher-authoring pipeline* ([teacher-artefact-authoring.md](teacher-artefact-authoring.md)) rather than a net-new student-only build.
- **"MCP App vs embedded", answered directly:** the **sim itself is an MCP-App artefact** (matter.js in the sandbox — no tldraw). Only an *authoring canvas* would be **embedded** (tldraw SDK can't be a static artefact). Generated output goes back into a **sandboxed artefact / dynamic MCP server**. So the runtime is a sandboxed MCP App; embedding only enters if we build a tldraw authoring surface.

## 8. Axiom alignment

| # | Axiom | Score | Notes |
|---|---|---|---|
| 1 | INSTANT FEEL | 0 | tldraw SDK is a heavy lazy-loaded bundle; generation is a model round-trip. Neutral if code-split + streamed. |
| 2 | EARNED TRUST | **-1** | **Generated physics can be wrong** and mislead a learner (§6). Only mitigated by template-slot generation + review. This is the axiom to design against. |
| 3 | SKILLS, NOT FEATURES | 0 | Could be a workbench type behind a skill, not a bolt-on. Neutral. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Generation is a clear high-tier-model moment; sketch-reading is a multimodal moment. Fits ADR-003 tiers. |
| 5 | GRACEFUL DEGRADATION | 0 | Canvas should degrade to "sketch + tutor reads it" if generation fails. Neutral/positive if designed. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses MCP Apps (sandboxed `ui://`), AG-UI, and the existing artefact contract rather than inventing a canvas transport. |
| 7 | API FIRST | 0 | Generation loop goes through existing `/api/proxy` + backend. Neutral. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Generation calls trace like any model call. Neutral. |
| 9 | SECURE BY CONSTRUCTION | **-1** | Model-generated HTML is untrusted code; safe **only** if it stays in the sandbox (option c). Un-sandboxed rendering of generated output would be a hard fail — the design must forbid it. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | An embedded SDK editor is a *fat* client, but the intelligence stays server-side. Neutral. |
| 11 | USABLE BY DESIGN | +1 | A make-your-own canvas is highly motivating for students *if* the output is good — the whole point of the ambition. |

**Net: +1** — but read the two rows carefully, because the score is **for the naïve "AI generates arbitrary code" framing**, and the whole point of §3″ is that we don't build that.

**The engine/scene architecture (§3″) flips both -1s** — this is why it's the recommended design, not a roadmap-parked one:
- **Axiom 9 (SECURE BY CONSTRUCTION): -1 → +1.** There is no user/AI *code* — a scene is validated data. Nothing arbitrary executes; a bad scene is *rejected at the schema*, not sandboxed-and-hoped. That's stronger than "contain the code," it's "there is no code." The literal name of the axiom.
- **Axiom 2 (EARNED TRUST): -1 → 0/+1.** Dynamics are computed only by the vetted engine, so **wrong physics is impossible by construction** — the failure mode drops from "teaches false physics" to "an implausible-but-legal configuration," which the tutor can even flag. The residual is parameter-plausibility, not law-correctness.

So the naïve generative feature scores **+1 (park it)**; the **engine/scene substrate scores ~+5 (build it)**. The delta between those two numbers *is* the recommendation. The Excalidraw sketch board (Reading A) and the matter.js sim library (A′) both also score well and are buildable now.

### Conflict justifications (naïve framing only — resolved by §3″)
- **Axiom 2 (-1):** applies only to *free-form* AI-generated physics; the engine/scene split removes it (the author configures, the trusted engine computes).
- **Axiom 9 (-1):** applies only to rendering model-generated *code*; the engine/scene split removes it (scenes are validated data, not code). If free-form make-real is ever used instead, generated HTML must never render outside the ADR-013 sandbox.

## 9. The build path (three de-risked steps, each shippable)

The engine/scene architecture (§3″) turns "should we?" into "in what order?" Each step is independently valuable and de-risks the next.

**Step 1 — the engine as a fixed sim (½–1d, no decisions).** Build one matter.js artefact (a collision lab) via the `mcp-app-artefact` skill — this is A′, verified (MIT, 83 KB, fits the cap, Boldkast pipeline). Ship it. This *is* the trusted engine; it just runs a hard-coded scene for now. Proves the runtime end-to-end and gives students a real sim.

**Step 2 — externalise the scene (small).** Pull the hard-coded scene out into a **validated JSON schema** the engine loads via the existing `ui/initialize` handshake. Add the Pydantic model backend-side. Now the *same* artefact runs *any* conforming scene. Author 3–4 scenes by hand to prove the schema. This is the whole safety story (data-not-code) with zero AI yet — nothing to spike, it's just refactoring the engine to be scene-driven. Overlaps [teacher-artefact-parameters.md](teacher-artefact-parameters.md) (2.3).

**Step 3 — the authoring on-ramps (the only real spike, ½–1d).** Now that scenes are data, add ways to *produce* them:
1. **NL→scene (go/no-go):** wire the model tier to emit a **validated scene** for **5 real Danish stx scenarios** (collision/Newton's cradle, pendulum, ramp, projectile, orbit). Because output is schema-validated data, "safety" is already handled — the spike measures only **pedagogical quality**: does the AI pick *sensible* parameters? Have JB/AR rate plausibility/usefulness. Prefer template-slot (fill a vetted skeleton) over free-form.
2. **GUI authoring (Algodoo-style):** evaluate a small bespoke matter.js editor (MIT, on-prem-clean) vs embedding tldraw purely as the editor (licence cost, §5). Only if teacher/student *direct* authoring is wanted alongside NL.

**Decision gate:** Steps 1–2 are safe, cheap, and need no gate — they're the substrate. Step 3.1 is the only thing that gates on JB/AR sign-off, and it gates on *plausibility*, not *safety* (the schema already guarantees safety). If 3.1 disappoints, Steps 1–2 still stand as a real "author-a-sim-by-editing-JSON/GUI" capability.

## 10. What this does *not* do

- Does not gate Step 1 (A′) or Step 2 (scene schema). The **matter.js engine + validated-scene substrate is buildable now**, safely — that's the direct answer to "safe but powerful, beyond what we prepare" (yes: we prepare the *engine*, users author the *scenes*).
- Does not commit to the AI authoring on-ramp (Step 3). It shows that on-ramp is *safe by construction* (validated data, not code) and that the only open question is *pedagogical plausibility* — a JB/AR spike, not an architecture risk.
- Does not replace 1.J Type 2 — it corrects its licensing note and clarifies Excalidraw-vs-tldraw is an *AI-capability* choice, not a license-equivalent swap. tldraw enters at most as a Step-3.2 authoring GUI, never the runtime.
- Does not resolve whether the scene-authoring pipeline is shared with teacher-artefact authoring ([teacher-artefact-authoring.md](teacher-artefact-authoring.md)) — flagged as an open question for planning. It probably is: a teacher-authored scene and a student-authored scene are the same object.
