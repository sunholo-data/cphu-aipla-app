# Thinking-budget configuration — bound and route Gemini's "thinking" so first-token latency is a choice, not an accident

**Status:** Partially implemented (env-level layer shipped 2026-06-24; per-skill / per-turn / persona layers Planned)
**Last Updated:** 2026-06-24
**Priority:** P1 — direct follow-up to the 23 June demo, where the tutor took 19–36s before the first visible token
**Estimated:** env layer ✅ done (~0.5d); per-skill ~0.5d; per-turn routing ~1d; persona "thinking depth" dimension ~1–2d (tracks the persona work)
**Scope:** Backend agent factory (`_planner_for` / `_resolve_thinking_budget`), one env var, cloudbuild wiring; roadmap for per-skill + per-turn + persona layers. Pairs with the TTFT logging fix that makes the impact measurable.
**Dependencies:** [tutor-personas.md](tutor-personas.md) + [voice-personas.md](voice-personas.md) (the persona system the "thinking depth" dimension extends); the TTFT instrumentation in [`backend/observability/timing.py`](../../../../backend/observability/timing.py) (already built; now actually emitting after the 2026-06-24 logging fix)
**Source:** [`# feedback 23rd June 2026.md`](# feedback 23rd June 2026.md) demo review — "we don't see the A2A interactions with the AI working as smoothly"; latency triage found 19–36s `/stream` turns

## Problem

The 23 June demo felt janky. Backend log triage (zero 5xx, zero ERROR) traced the AI's apparent unresponsiveness to **agent turns taking 19–36 seconds** on the AG-UI `/stream` endpoint — and the slow part is **dead air before the first token**, not slow streaming of a long answer.

Root cause: the default Gemini planner hard-coded an **unbounded dynamic thinking budget**:

```python
# backend/adk/agent.py (before)
BuiltInPlanner(thinking_config=ThinkingConfig(thinking_budget=-1))
```

`thinking_budget=-1` is Gemini's *dynamic* thinking — the model decides how much to reason per request, with no ceiling. On a hard physics prompt it can spend many seconds of invisible thinking tokens before emitting the first visible token. There was:

- **no per-environment knob** — dev demos and production were stuck with the same unbounded behaviour;
- **no per-skill knob** — a quick-hint skill and a deep-reasoning skill got identical treatment;
- **no per-turn adaptivity** — a trivial "hej" paid the same worst-case thinking cost as a multi-part exam question.

Critically, we were also **flying blind**: the TTFT instrumentation (`observability.timing.LatencyTracker`) was fully wired into the stream path but its `INFO` log line was being silently dropped in the deployed container (see [§TTFT measurement](#ttft-measurement-the-prerequisite)). So we could not even confirm *where* the 36s went.

This is squarely a RIGHT MODEL, RIGHT MOMENT problem: maximum reasoning is valuable on a hard problem and pure waste on a greeting — but only if the budget can actually vary.

## Goals

**Primary:** make the thinking budget a *deliberate, observable, per-context choice* rather than a single hard-coded constant, so first-token latency can be tuned to the task.

**Success metrics:**
- Median TTFT (`first_model_token_ms`) on a simple turn **< 3s** on dev with the budget dialled down (KPI from Axiom #1; baseline was up to ~20–36s total).
- The budget is changeable **without a code change or skill re-seed** for at least the environment layer (shipped).
- Every turn's TTFT breakdown is queryable in Cloud Logging (`event="ttft"`) and via `aiplatform skill probe` — so budget changes are decided on data, not inference.
- Default behaviour is **unchanged** (`-1`) when no override is set — this is a widening of options, not a forced regression.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | The entire point: bound the dead-air thinking time so first token lands inside the <3s KPI. |
| 2 | EARNED TRUST | 0 | Doesn't touch sources/citations. (Quality tradeoff of low budgets is handled by the measure-then-tune loop, not by hiding uncertainty.) |
| 3 | SKILLS, NOT FEATURES | 0 | Env/infra layer is invisible to end users; the planned persona "thinking depth" dimension moves this toward +1 (teacher-configurable in <60s). |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Textbook fit — deploy reasoning where it differentiates (hard turns), optimise ruthlessly elsewhere (greetings). The per-turn routing layer is this axiom made literal. |
| 5 | GRACEFUL DEGRADATION | +1 | `_resolve_thinking_budget()` fails open to `-1` (current behaviour) on unset/invalid config; no failure mode added. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses the framework-native `google.genai.types.ThinkingConfig.thinking_budget` via ADK `BuiltInPlanner` — no custom thinking mechanism invented. |
| 7 | API FIRST | 0 | One backend knob in the shared agent factory; applies to every channel uniformly, no channel-specific logic. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Ships with (and depends on) the TTFT log/Trace breakdown; the routing choice + model are recorded per turn via `LatencyTracker.set_model`. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new data access or egress; reads an env var. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Backend-only; the future persona UI is thin rendering over existing config. |
| 11 | USABLE BY DESIGN | 0 | No student-facing surface in the shipped layers. The persona "thinking depth" control is teacher-facing and MUST get an empty/loading/error + viewport pass when built (see Open Questions). |
| | **Net Score** | **+5** | Threshold: >= +4 ✅ |

**Conflict Justifications:** none (no axiom scored -1).

## Design

### Configuration layering (the spine)

The budget is resolved at agent-build time, with each layer overriding the one below. Ship the cheap layers first; each is independently useful.

| Layer | Granularity | Mechanism | Status |
|---|---|---|---|
| 0. Hard default | Global | `-1` (Gemini dynamic) — the historical behaviour, preserved as the fallback | ✅ |
| 1. Environment | Per Cloud Run env | `AIPLA_THINKING_BUDGET` env var | ✅ shipped 2026-06-24 |
| 2. Per-skill | Per skill | `SkillMetadata.thinkingBudget` in `SKILL.md` frontmatter | Planned |
| 3. Per-turn | Per message | difficulty-routed via the existing `_should_think()` heuristic | Planned |
| 4. Persona | Per persona/teacher choice | "thinking depth" dimension on personas (+ custom personas) | Planned (tracks persona work) |

Resolution precedence (highest wins): **per-turn → persona → per-skill → environment → hard default**.

### Layer 1 — environment (shipped)

[`backend/adk/agent.py`](../../../../backend/adk/agent.py) — `_resolve_thinking_budget()` reads `AIPLA_THINKING_BUDGET`, defaulting to `-1` and failing open to `-1` on a non-integer value:

```python
def _resolve_thinking_budget() -> int:
    raw = os.environ.get("AIPLA_THINKING_BUDGET")
    if raw is None or raw.strip() == "":
        return -1
    try:
        return int(raw)
    except ValueError:
        logger.warning("%s=%r is not an integer; falling back to -1 (dynamic)", THINKING_BUDGET_ENV, raw)
        return -1
```

`_planner_for()` then builds `BuiltInPlanner(ThinkingConfig(thinking_budget=_resolve_thinking_budget()))` for Gemini skills with no `thinkingModel` (the Tier-A path). Claude/OpenAI (Tier B) get no `BuiltInPlanner`; skills with `thinkingModel` set (Tier C) route in Python and are unaffected.

**Dev is set to `0`** in [`cloudbuild.yaml`](../../../../cloudbuild.yaml) (`--set-env-vars=AIPLA_THINKING_BUDGET=0`) — thinking off, fastest first token — because every dev skill is on a Flash model (which permits `0`). It is a plain env flip with **no re-seed**, so the value is trivially tunable once TTFT data shows the latency/quality sweet spot. Prod stays dynamic by omitting the var.

### `ThinkingConfig.thinking_budget` semantics

`thinking_budget` is a native field on `google.genai.types.ThinkingConfig` (verified in-tree: `from google.genai.types import ThinkingConfig`, and the value flows to Gemini via ADK `BuiltInPlanner`). Model-dependent ranges (**verify exact ceilings against current Gemini 2.5/3.5 thinking docs at build time**):

| Value | Effect | Notes |
|---|---|---|
| `-1` | Dynamic — model decides, unbounded | The old hard default; highest worst-case latency |
| `0` | Thinking off — fastest first token | Valid on **Flash** models (all current dev skills); **Pro models reject 0** (min ≈128) |
| `N > 0` | Cap thinking to ~N tokens | Bounded latency with some reasoning preserved |

> **Footgun:** `0` is invalid on Pro. If a Pro skill is ever added to an env running `AIPLA_THINKING_BUDGET=0`, agent build will fail. Mitigation options: (a) keep dev all-Flash (current state), or (b) clamp in `_resolve_thinking_budget`/`_planner_for` — raise a `0` budget to the model's minimum when the model is Pro. Deferred until a Pro skill is actually introduced; called out here so it isn't a surprise.

### Layer 2 — per-skill (planned)

Add `thinkingBudget: int | null` to `SkillMetadata` ([`backend/db/models/__init__.py`](../../../../backend/db/models/__init__.py)) alongside the existing `model` / `thinkingModel`. A skill author sets it in `SKILL.md` frontmatter; `_resolve_thinking_budget` prefers it over the env var. **Requires a re-seed** to reach already-registered skills (the standing `make seed ENV=dev` gotcha) — call that out in the sprint so it isn't forgotten.

### Layer 3 — per-turn difficulty routing (planned, the real "dynamic")

Reuse the heuristic that already exists for two-model routing — [`_should_think()`](../../../../backend/adk/agent.py) (message length / multiple question marks / physics keywords). Map difficulty → budget:

- trivial turn → `0` (instant);
- normal turn → a small cap (e.g. `512`);
- hard turn → higher cap or `-1` (dynamic).

This needs the budget to be selectable **per turn**, not just per agent-build. Two implementation options, to be chosen in the sprint:
1. extend the existing `_HeuristicRouter` (already picks a fast vs thinking *agent* per turn) to also carry a per-turn planner/budget; or
2. rebuild the planner per turn in the stream path from the routed difficulty.

This is the layer that turns "minimum for dev" into "the right amount, every turn."

### Layer 4 — persona "thinking depth" + custom personas (planned)

Surface the budget to teachers as a **persona dimension** rather than a number: a choice like *"quick replies ↔ deliberate (shows working)"* mapping to budget presets. This becomes a **4th persona resolution path** alongside avatar / voice / teaching-style — which already resolve separately and drift if not wired together, so all paths must be updated in lockstep (see [tutor-personas.md](tutor-personas.md)). "Custom persona" lets a teacher define the whole bundle (avatar + voice + teaching-style + thinking depth) instead of picking a preset. Presets for depth should be chosen from real TTFT data gathered in Layers 1–3.

### TTFT measurement (the prerequisite)

This whole feature is only tunable because we can now *see* the latency. The `LatencyTracker` ([`backend/observability/timing.py`](../../../../backend/observability/timing.py)) was already wired into the stream path (binds in `stream_skill`, `emit_log()` in the `finally`) but its `INFO` line was dropped in the deployed container: `setup_telemetry()` installs an OTEL root handler before `fast_api_app`'s `basicConfig(level=INFO)`, making that a no-op, so the root level stayed at WARNING. Fixed 2026-06-24 with an explicit `logging.getLogger().setLevel(INFO)` in [`backend/fast_api_app.py`](../../../../backend/fast_api_app.py) (not `basicConfig(force=True)` — that closes pytest's capture handlers under test). Now every turn emits `event="ttft"` with `first_model_token_ms` + `total_response_ms`, and the budget's effect is directly measurable.

### Measured results (2026-06-24, dev, `budget=0`)

First online measurement once the logging fix landed (`aiplatform skill probe` + Cloud Logging `event="ttft"`). **This reframes the problem: thinking budget is a real lever but was NOT the dominant cost.**

| Phase | Cold (transition, old `-1`) | Warm (`budget=0`) |
|---|---|---|
| session_index + agent_factory | ~0.1s | ~0.1s (agent factory itself ≈ 0ms) |
| **runner_setup** (ag_ui_adk wrap + ADK runner enter + plugins) | — | **~2.66s** |
| before_model | ~0.3s | ~0.3s |
| **model first token** | ~1.8s | **~0.85s** |
| **TTFT total** | **~14.7s** | **~4.0–5.0s** |

Findings:
- **`budget=0` works** — model first token dropped to **~0.85s**, and the `ttft` line now lands in Cloud Logging (logging fix confirmed end-to-end).
- **The dominant warm cost is ADK / `ag_ui_adk` runner setup (~2.66s/turn)** — framework re-init per turn, not thinking, not our code (the agent factory build is ~0ms). This is the same gap the `timing.py` comment flags as the TTFT-OPTIMIZATION target.
- **Cold start adds ~10s** (the first probe hit a deploying/cold instance) — which explains the demo's 19–36s worst cases (the demo scaled 1→3 instances, each cold-starting mid-session).
- **Implication:** hitting the <3s TTFT KPI is now primarily a **runner-setup + cold-start** problem, not a thinking-budget one. The budget knob stays valuable (it bounds worst-case reasoning latency and did cut the model portion), but a moderate value (e.g. `512`) likely yields near-identical TTFT with better answer quality — worth an A/B (one env flip + re-probe) before settling dev on `0`.

### CLI affordance (already exists)

`aiplatform skill probe <skill_id>` fires one `/stream?probe=1` turn and prints the per-stage TTFT breakdown from the `LATENCY_REPORT` event — the canonical way to A/B a budget value against a real turn without scraping logs. No new CLI work needed for Layer 1; document the recipe (join a group code → `AIPLATFORM_ID_TOKEN=<token> aiplatform --env dev skill probe …`). When Layer 2 lands, `aiplatform skill probe` already covers verification.

### Framework-native capability check (per skill §5b-ter)

The capability is **native**: `ThinkingConfig.thinking_budget` is a first-class field on `google.genai.types`, plumbed through ADK's `BuiltInPlanner`. No side-channel, custom store, or bespoke thinking mechanism is introduced — we only choose the value and where it's read from. The two-model alternative (`thinkingModel` + `_HeuristicRouter`) is also already built; per-turn routing reuses it rather than inventing new machinery.

## Acceptance

**Shipped (Layer 1, 2026-06-24):**
- [x] `AIPLA_THINKING_BUDGET` read by `_resolve_thinking_budget()`; default `-1`; invalid/blank → `-1`
- [x] `_planner_for` applies the resolved budget to the Tier-A Gemini planner
- [x] Dev set to `0` via cloudbuild; no re-seed required
- [x] TTFT `INFO` line now emits in the deployed container (logging fix)
- [x] Backend unit tests: budget resolve (default / int / invalid) + planner application; logging regression
- [x] `make lint` + `make test-fast` green (2146 passed)

**Next (Layer 2 — per-skill):**
- [ ] `SkillMetadata.thinkingBudget` field + frontmatter parse + materializer round-trip
- [ ] `_resolve_thinking_budget` prefers per-skill over env
- [ ] Re-seed run documented in the sprint; one pytest for precedence

**Next (Layer 3 — per-turn):**
- [ ] Difficulty → budget mapping wired through `_HeuristicRouter` or per-turn planner build
- [ ] `aiplatform skill probe` shows different `first_model_token_ms` for trivial vs hard prompts on the same skill

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `budget=0` gives fast-but-shallow physics answers (a fast wrong answer is also a bad demo) | Medium | Dev-only stopgap; measure with TTFT + spot-check answer quality, then dial to a non-zero cap (e.g. 512) — one env flip. Per-turn routing (Layer 3) removes the all-or-nothing tradeoff. |
| `0` sent to a Pro model → agent build error | Low (dev all-Flash) | Documented footgun; clamp-to-min in `_planner_for` when a Pro skill is added |
| Env / per-skill / per-turn precedence drifts or surprises | Low | Single resolver (`_resolve_thinking_budget`) owns precedence; unit-tested per layer |
| Persona "thinking depth" added to only one of the 3 resolution paths | Medium | Treat as the known persona-drift hazard; wire avatar/voice/teaching-style/depth together (tutor-personas.md) |
| Prod accidentally inherits a low budget | Low | Prod omits the var → `-1`; cloudbuild comment states dev-only intent |

## Open questions

1. **Default for prod** — leave `-1` (dynamic) or pick a bounded default once data exists? Decide after Layer 3 data.
2. **Per-turn vs per-skill ordering** — ship per-skill (Layer 2) first for control, or jump to per-turn (Layer 3) for the bigger UX win? Leaning per-skill first (cheaper, unblocks persona presets).
3. **Depth presets** — what budget values map to "quick" / "balanced" / "deliberate"? Derive from measured `first_model_token_ms`, don't guess.
4. **Persona UX** — slider vs labelled radio; Danish + English copy; this is a teacher-facing surface so it needs the USABLE BY DESIGN pass (empty/loading/error, target viewport) before build.
5. **Interaction with `thinkingModel` (Tier C)** — when both a thinking budget and a thinking model are set, which wins per turn? Define in the Layer 3 sprint.

## Files

| File | Purpose | Status |
|---|---|---|
| [`backend/adk/agent.py`](../../../../backend/adk/agent.py) | `_resolve_thinking_budget()` + `THINKING_BUDGET_ENV` + `_planner_for` wiring | ✅ |
| [`backend/fast_api_app.py`](../../../../backend/fast_api_app.py) | root `setLevel(INFO)` so the TTFT line emits | ✅ |
| [`cloudbuild.yaml`](../../../../cloudbuild.yaml) | `AIPLA_THINKING_BUDGET=0` for dev | ✅ |
| `backend/tests/unit/test_thinking_router.py` | budget resolve + planner application tests | ✅ |
| `backend/tests/unit/test_logging_config.py` | INFO-emit regression | ✅ |
| `backend/db/models/__init__.py` | `SkillMetadata.thinkingBudget` (Layer 2) | Planned |
| `backend/skills/skill_materializer.py` | frontmatter round-trip for `thinkingBudget` (Layer 2) | Planned |
| persona config + UI (Layer 4) | "thinking depth" dimension + custom persona | Planned |

## Out of scope

- Per-token cost accounting tied to budget (observability already logs token counts)
- Non-Gemini "thinking" controls (Claude extended thinking / OpenAI reasoning effort) — separate per-provider knobs if needed later
- Auto-tuning the budget from live latency telemetry (manual measure-then-tune for now)

## Related

- [tutor-personas.md](tutor-personas.md) / [voice-personas.md](voice-personas.md) — the persona system the depth dimension extends (and the 3-path drift hazard)
- [teacher-choice-ttl.md](teacher-choice-ttl.md) — sibling "expose a backend knob to teachers via presets+custom" shape; the persona depth control should follow the same preset-dropdown UX
- [`# feedback 23rd June 2026.md`](# feedback 23rd June 2026.md) — the demo that surfaced the latency
- Axiom #1 INSTANT FEEL, Axiom #4 RIGHT MODEL RIGHT MOMENT, Axiom #8 OBSERVABLE BY DEFAULT — the three this feature most directly serves
