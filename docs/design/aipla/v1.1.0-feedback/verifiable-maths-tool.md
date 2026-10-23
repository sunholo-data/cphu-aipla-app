# A verifiable maths tool: the tutor calculates with code, writes the equation, and the log can prove both

**Status:** **Proposed** (2026-10-22). Nothing has been built yet. **1.1.152**
**Priority:** **P1**. The class session on 2026-10-22 raised possible maths errors and physics answered in heavy prose, and M decided the same day: *"we should make a verifiable maths/calculator tool"*. The data collection that has been moved up the schedule will be read for exactly this. Un-gated
**Estimated:** ~6d phased (M0 evidence ~0.25d, M runs the SQL · M1 record which tools each turn called ~0.75d, plus ~0.5d for the `tool_calls` table · M2 the `calculate` engine and tool ~1.5d · M3 the when-to-calculate rule and equation-first replies ~0.5d · M4 `show_calculation`, the student-visible card ~0.75d · M5 counters in the bench and in prod SQL ~1d · M6 the enforcement decision ~0.5d · M7 release + re-measure ~0.25d)
**Scope:** Backend: a new `backend/maths/` package (parser, engine, formatter), a new `adk/calc_tools.py` (two FunctionTools), `adk/agent.py` (attach the tools to student tutors; one more block in the instruction chain), `skills/preambles/math_notation.md` (the *when* rules), `adk/stream_redaction.py` (`show_calculation` in `_CLIENT_RENDER_TOOLS`), `adk/callbacks/session.py` + `observability/chat_log.py` (tool names on the tutor row, `emit_tool_call`), `analytics/research_logs.py` (projection), a new `analytics/calc_audit.py`, `scripts/bench-tutor-discrimination.py`. Infra: `infrastructure/modules/chat-logs/{variables,views}.tf` (one log id, one view). Frontend: one new `CalculationCard` and its i18n strings. Dependencies: `pint`, and in M2b `sympy`, both pure Python and offline
**Dependencies:** the [maths-notation preamble](../../../notes-2026-08-21-teacher-feedback.md) (`adk/math_notation.py`, **shipped**, the house-style block that M3 extends); [1.1.147 seminar-chat-surface-fixes](seminar-chat-surface-fixes.md) (**implemented**, so rendering is not the problem); [1.1.101 tool-result visibility](tool-result-visibility-invariant.md) (**shipped**, deny-unless-declared, which M4 must respect); [1.1.133 tutor-controls-sims](../v2.1.0-extension/tutor-controls-sims.md) (**shipped**, the precedent for a conditional tutor tool with a card); [1.1.149 tutor-directs-to-workbench](tutor-directs-to-workbench.md) (implemented, unreleased; its shared matcher / bench section / prod SQL triple is the pattern M5 copies); [1.1.148 assessment-transparency](assessment-transparency-and-override.md) (`turn_index` counts tool events, so turn numbering is relevant to M1); [student-notation-strip](../v2.1.0-extension/student-notation-strip.md) (1.1.118, **shipped**); the workbench calculator element (`WorkbenchCalculator.tsx`, 1.1.38 M3, **shipped**); the tutor layer, [tutors-handover-2026-09-10](tutors-handover-2026-09-10.md) (the passthrough guarantee); [1.1.158 hosting-off-google-options](../v2.1.0-extension/hosting-off-google-options.md) (**proposed**). Its F4 is a hard constraint on this doc: no Gemini built-in may carry a capability the platform depends on. See F2
**Created:** 2026-10-22
**Source:** [notes-2026-10-22.md](../../../notes-2026-10-22.md). M's notes as written: *"maths errors?"*, *"the chat does not output equations?"*, *"use a smarter model? or enforce use of a tool for mathematics and physics and stop it using training?"*, *"we need to check if the maths tool (if it exists) is being called - and we can surface in logs what tools are used."* M clarified the same day: *"it was more that the equations weren't used, but heavy text instead — the AI didn't use equations. We should make a verifiable maths/calculator tool."*

## Problem Statement

Three complaints arrive as one:

1. **The tutor may get the maths wrong.** No session or turn has been identified yet, which is what M0 is for.
2. **The tutor explains physics in prose where an equation would do the work.** A student
   asking about a kettle gets three sentences about power and time when the answer is
   $E = P \cdot t$.
3. **Nobody can tell what the tutor did.** "Is the maths tool being called?" cannot be
   answered. No maths tool exists, and if one did, no log records which tools a turn
   called.

The fix is a tool whose results can be **re-checked by anyone after the fact**, a rule
for **when** the tutor must use it, a reply style where **the equation comes first**,
and a **count** of both in the bench and in prod, so that the effect is measured
rather than asserted. That last part is 1.1.149's lesson, applied here.

## Findings

Every finding below is **verified against code** on 2026-10-22 unless marked
*hypothesis*. None is verified against the 2026-10-22 session's data. That is what M0 is for.

### F1. There is no maths tool. The tutor computes in its head, on the fastest model with thinking off

- No student-facing tutor declares a calculation tool. `concept-dialogue` has
  `tools: []` and one agent tool, `svg-illustrator`
  (`skills/templates/concept-dialogue/SKILL.md:74-77`). `problem-set-hints` has the
  same. `TOOL_REGISTRY` (`adk/tools.py:142-205`) has no arithmetic tool.
- The tutor runs on **`gemini-3.5-flash-lite`** (`SKILL.md:74`), chosen on 2026-09-11 for
  time-to-first-token (0.61s versus 4.8s for the smart tier, `SKILL.md:63-72`), with
  **thinking off** by default (`adk/agent.py:229`, `_resolve_thinking_budget`, *"default
  0 = thinking off"*). The decision text says: *"Revisit with an eval rather than an
  assumption if a tutor turn ever needs more capability than flash-lite has."* Multi-step
  arithmetic with units is that case. The notes' *"we have consensus if the model is
  smarter not fast"* is the same point from the classroom.
- `pint` and `sympy` are **not** dependencies (`backend/pyproject.toml`, `uv.lock`).
- Two deterministic evaluators already exist, and **they disagree on trigonometry**:
  - `adk/physics_diagram.py:75-117` `evaluate()` uses a Python-AST whitelist with trig
    in **degrees** (`:77-79`).
  - `frontend/src/lib/safeFormula.ts`, the workbench calculator's evaluator, has trig
    in **radians** (`sin: Math.sin`, `:11`).

  Neither handles units. `physics_diagram.evaluate` also passes `ast.Pow` straight to
  `pow` (`:75`), so `9**9**9` is an exponent bomb. That is acceptable for a
  diagram spec, but not for a tool every turn can call.

### F2. Built-in code execution exists and is the wrong tool

`code_execution` is a "model-aware" tool (`adk/tools.py:208`). On Gemini it attaches
`BuiltInCodeExecutor` (`adk/agent.py:351-371`). That is not verifiable in the sense this
doc means. The code runs in Google's sandbox, the platform logs neither the program
nor its output, it ties the capability to one provider, and that runs against
the 2026-10-22 decision to **prioritise running off Google Cloud**. It also executes
arbitrary model-written code, where what the tutor needs is a closed grammar. **Rejected.**

**Decision (2026-10-22, with [1.1.158](../v2.1.0-extension/hosting-off-google-options.md)
F4):** the maths tool is a **plain ADK `FunctionTool` running in our own process**
(whitelisted AST + `pint`, and `sympy` in M2b), and **never** Gemini's
`BuiltInCodeExecutor` (imported at `adk/agent.py:34`, attached at `:351-371`). A
Gemini built-in does not survive a move off Google, and with the DPA blocking
Google that move is likely. A `FunctionTool` is plain Python that the ADK passes to
whichever model is configured. It goes through the same `LiteLlm` / `Claude` adapters
`agent.py:35-36` already imports, so it moves with the platform unchanged.

**Does it work under local models? The tool does, unconditionally.** It has no network
call, no cloud dependency and no model-specific code, so the same function returns
the same `calc_id` on Gemini, on a self-hosted model, or offline. **Whether a
local model *calls* it is that model's capability:** it has to support function
calling through the ADK's `LiteLlm` path (Ollama / vLLM) reliably enough to follow
the must-calculate rule. That is unverified for any local model today. It is an
open question for the local-model test plan (O4). Until a local tier passes it, a
local tutor that skips the tool computes in its head, and M5's unverified-numeric
counter shows exactly that.

### F3. The notation preamble says *how* to write maths, never *when*, and one carve-out pushes sim activities towards prose

`skills/preambles/math_notation.md` is applied unconditionally to every agent
(`adk/agent.py:987`, `build_math_notation_block()`). Everything in it is about form:
`\cdot`, units, decimal comma, wrapping. Nothing says *write the relationship as an
equation*. Two passages lean the other way:

- `:25-27`: *"This does not apply to a count, an index, a trial number, or a number in
  ordinary prose."* That is correct, but it is the only "when" guidance the file
  gives, and it is an exemption.
- `:29-36`: *"A simulation's own controls and readings are not mathematics … write it
  the way the simulation shows it, in plain text … **Typeset only when** you are building
  or manipulating a relationship."* In a sim activity such as the Elkedel, almost every
  quantity the student has is a sim reading (Effekt 2000 W, time), so the instruction
  the model actually acts on is "plain text". *Hypothesis:* this, together with
  `concept-dialogue`'s *"Maximum 3 sentences … Every response must end with a
  question"* (`SKILL.md:136`), is what produces prose answers. M0 counts it.

### F4. No log records which tools a turn called. Two partial signals exist, and both undercount

- **`chat_turns` rows carry no tool information.** `emit_chat_turn`'s payload
  (`observability/chat_log.py:120-187`) has no tool field. The caller
  (`adk/callbacks/session.py:69-211`) **skips every event without text**
  (`:156-160`, `if not parts: continue` … `if not text: continue`). A `function_call`
  or `function_response` event has no text part, so tool calls are dropped before
  emission. The projection (`analytics/research_logs.py:96-123`) and the view
  (`infrastructure/modules/chat-logs/views.tf`) have no tool column either. The quick
  grep in the notes was right.
- **The `ttft` structured log line carries `tools_invoked_count`**
  (`observability/timing.py:294`), but the counter is incremented only inside
  `if not first_model_token_seen` (`adk/agui.py:270-278`). **A tool called after the
  first text token is not counted.** The per-call stage marks
  (`tool_call_started_<n>_ms`, `adk/callbacks/permission.py:51-58`) carry the tool
  **name** only in the user-facing label ("Calling X…"), which is not part of the logged
  payload (`timing.py:288-296`). So today's prod logs can tell you that *some* tool ran before
  the first token, but never *which* one.
- The student's history replay drops tool events entirely
  (`protocols/sessions_route.py:142`, cited in `adk/stream_redaction.py`'s docstring),
  so a researcher reading a transcript cannot see tool use either.

So the notes' "check if the maths tool is being called" has two parts. The tool does
not exist, and if it did, its calls would not be counted. **M1 is worth shipping on
its own**, before any maths, because it answers "what did the tutor do" for every tool
(`control_sim`, `svg_illustrator`, `record_checkpoint` …) and not only for this one.

### F5. Showing a tool result to a student is name-based and closed by default

`adk/stream_redaction.py` redacts every tool result for a student stream unless the
name is in `_CLIENT_RENDER_TOOLS` (`:90-129`) or is declared at run time
(`:162-167`). `scripts/check-stream-render-allowlist.sh` fails CI on a client that
parses a name the list does not hold. The list works **per name, not per call**.
So one tool cannot be shown on some calls and hidden on others. A calculation
the tutor runs to *check a student's answer* must not reach the student. A worked
example the tutor *chooses to show* should reach them. **That needs two tools, not
one tool with a flag.** The chip still shows the tool name for a redacted call
(`ToolCallChip.tsx`; "Bruger {tool}…", `frontend/messages/da/chat-page.json:36`). That
is fine for a neutral name like `calculate`, and it is one reason not to name the tool
`check_answer`.

### F6. The student's calculator and the tutor's tool are different instruments

`WorkbenchCalculator.tsx` evaluates a **teacher-authored formula** over the
**student's** inputs through `safeFormula.ts` (never `eval`, `:94`) and pushes the
inputs, units and result to the tutor as `mcp_app_context.calculator.state`, with a
trust card (`:27-60`). It is the student's tool, and the tutor already *receives* its
result deterministically. The new tool belongs to the tutor. The two share an
idea (a closed grammar) but not code, because one runs in the browser and the other on
the server. This doc does **not** change the student calculator. It does fix the
degrees/radians disagreement *for the tutor tool* by making angle units explicit
(`30 deg`), and it leaves the question of aligning `safeFormula.ts` open (O5).

`SymbolStrip.tsx` (1.1.118) lets a student type Δ, ρ, ² back. Equation-first
replies (M3) make it more useful rather than less, because the student is answering
in the same notation. No change is needed.

### F7. The tutor-layer passthrough guarantee is not at risk, if this lives where the notation block lives

The guarantee (`tutors-handover-2026-09-10.md:18-21`) is that an activity or class with
**no tutor** composes byte-identically to before the tutor layer existed. The notation
and praise blocks are **platform house style**, applied unconditionally in both
paths (`adk/agent.py:976-993`). A when-to-calculate rule added there changes
every prompt **equally**, with or without a tutor. That is the same class of change as
the 2026-08-21 notation block, and it does not break the guarantee. What *would*
break it is a new **framework** field with a non-null default. The design below adds
none in M1–M5. If AR/JB later want an approach to say something about calculation
(a POE tutor that withholds numbers until the prediction is in), that is an optional
field resolving to `None` = platform default, the `workbench_use` precedent
(`db/models/teaching_framework.py:283`).

## Design

### The tool pair

**`calculate`**: private to the tutor. Its result is redacted on the student stream by the existing default.

```text
calculate(
  expression: str,                  # "P * t", "m * c * dT", "sqrt(2*g*h)"
  quantities: {symbol: "value unit"},  # {"P": "2000 W", "t": "3 min"}
  result_unit: str | None,          # "kJ" — convert, and refuse if dimensions differ
  check: str | None,                # optional: an equation to dimension-check, "E = P / t"
) -> {
  ok, error?,                       # error is written for the model: "dimensions differ: W/s is not J"
  expression, quantities_si,        # the inputs as parsed, in SI
  result: {value, unit, si_value, si_unit},
  latex,                            # ready to paste: "$E = P \cdot t = 2000\,\text{W} \cdot 180\,\text{s} = 360{,}0\,\text{kJ}$"
  dimension_check?,                 # for `check`: "consistent" | "inconsistent: [J] ≠ [W·s⁻¹]"
  calc_id,                          # sha256 of the canonical inputs + engine version
  engine,                           # "aipla-calc 1 / pint 0.24"
}
```

**`show_calculation`**: the same inputs and the same engine, **re-evaluated**. The tutor
cannot paste a result in. Its result renders as a `CalculationCard`: the equation, the
substituted values with units, and the result, in KaTeX. It goes in
`_CLIENT_RENDER_TOOLS` with the same "card-safe by construction" comment the other
entries carry. It is card-safe because it shows only what the tutor asked to show, and the
number on the card is the engine's, never the model's.

**What "verifiable" means here, concretely.** Every call is a pure function of
`(expression, quantities, result_unit, engine version)`. `calc_id` hashes exactly that.
Every call is logged (M1b), so a researcher, or a nightly job, can **re-run every
calculation the tutor ever did** and diff the results (`analytics/calc_audit.py`). The
tutor's *reply* can also be checked against its calculations. A number with a unit in a
tutor turn that no `calculate` result in that invocation produced, and that the student
or the sim did not supply, is an **unverified numeric**. That probe is deterministic
and is the M5 metric.

### The engine (`backend/maths/`)

- **Parse with a whitelisted AST, never `sympify` or `parse_expr`.** Both call `eval`.
  This is the `physics_diagram.evaluate` shape (`:85-117`) extended with: an
  expression-length cap; an exponent cap (`|exponent| ≤ 10`, integer or simple
  fraction); a node-count cap; no attribute access, subscripts or comprehensions; a function
  allowlist (`sqrt sin cos tan asin acos atan exp ln log abs`); a constant allowlist
  (`pi`, `g` = 9,82 m/s² **only if quantities do not define g**, `c`, `e` charge … each
  named in the result so the student can see which value was used).
- **Units with `pint`** (offline, pure Python, about 3 MB). Angles are units (`30 deg`,
  `0.5 rad`). A bare number in a trig function is an **error**, not a silent
  radians-versus-degrees guess. That resolves F1's disagreement for this tool. Danish input is
  accepted in `quantities` (`"9,82 m/s^2"`) through the existing decimal-comma parse
  rule, and output formatting follows the notation preamble (`{,}`, `\cdot`, unit
  after a thin space) **in the activity's language**.
- **M2b, `sympy` for rearrangement only** (`solve_for: "t"`): built from the
  whitelisted AST, never from a string. It is deferred to its own milestone because it is
  the part most likely to do the student's algebra for them (see Pedagogy).
- Runs in-process, with a wall-clock timeout. No network, no cloud, so it is identical
  under every model tier, including the on-prem tiers ADR-003 describes. **Tool calling
  on a local model is that model's capability, not this tool's** (O4).

### When the tutor must calculate, and when it must not (M3, in `math_notation.md`)

Added to the preamble as house style, so it covers every tutor on the same "no
per-skill flag to forget" reasoning as the original block (`adk/math_notation.py:23-33`):

- **Must call `calculate`** before stating any number that the tutor *derived*: a
  product, a quotient, a unit conversion, a rearranged value, an order of magnitude
  it presents as a result. **Must** call it before telling a student their number is
  right or wrong.
- **Need not** call it for a number the student, the activity text or the sim already
  supplied, used as given (*"you set 2000 W"*), or for counts and ordinary prose
  (the existing exemption, `:25-27`).
- **Never says a calculated number it did not calculate.** If the tool errors, the
  tutor says what the error means in the student's terms (*"the units don't
  match — what is t measured in?"*). That is often the better teaching move anyway.

### Equation-first replies (M3)

The preamble gains a **when**, which it has never had (F3):

- **When the point of the reply is a relationship between quantities, the equation
  comes first, and the sentence explains it, not the other way round.**
  `$E = P \cdot t$`: the energy is the power multiplied by the time.
- An equation **counts as one of the three sentences** `concept-dialogue` allows
  (`SKILL.md:136`), so the length rule stops penalising it. This edits a SKILL.md, so it
  **needs a seed** (auto on deploy since P1.3), whereas the preamble needs a deploy. Both
  ship in one release.
- The sim carve-out (`:29-36`) is narrowed, not removed. A *reading* stays plain text
  ("Effekt 2000 W"). The moment two readings are related, the relationship is written as
  an equation with the readings substituted: `$E = 2000\,\text{W} \cdot 180\,\text{s}$`.

### Pedagogy: a checking instrument, not an answer machine

The danger M did not name but the platform's whole design guards against: a tutor
with a perfect calculator becomes a faster ChatGPT. The rules:

1. **`calculate` is how the tutor *checks*.** Its result goes to the model only.
   Redaction is the default (F5), so this needs no new code to be safe.
2. **`show_calculation` is for the tutor's own examples**, never the student's assigned
   task. The tutor composes the example with different numbers from the task. The same
   discipline the hint skills already state (`problem-set-hints/SKILL.md:302`, *"point at
   the right equation — but…"*), now with a tool that makes the example's numbers right.
3. **Checking a student's answer is reported as a direction, not a value.** "Your
   energy is a factor of 60 off: look at the unit of t", not "it should be 360 kJ".
   The tool's `dimension_check` and the ratio to the student's value make that move
   cheap for the model.
4. **No rearrangement for the student** (M2b's `solve_for`): the tutor may use it to
   check that the student's rearrangement is *equivalent*, never to produce one. Whether
   even that is too much is AR/JB's call (O2).

### Recording tool use (M1)

- **M1a, on the tutor row, with no infra.** `_emit_new_turns` already walks every event of
  the invocation (`session.py:146-160`). Before the text filter, collect the
  `function_call` parts' names (and whether the matching `function_response` errored).
  Stamp each tutor row of that invocation with `tools_called` (a comma-joined STRING,
  **not** an array: the "Array specified for non-repeated field" sink failure the
  workbench emitter already guards against, `chat_log.py`'s `emit_workbench_event`
  docstring) and `tool_call_count` (INT). Add both to `_turns_cte`
  (`research_logs.py:96-123`) and `views.tf` in lockstep, and
  `test_projection_matches_view` holds you to it. Null on every older row, and that
  means *not recorded*, never *no tools* (the TUTOR-5 rule, `research_logs.py:26-33`).
- **M1b, a `tool_calls` table.** It needs one log id, `aipla_tool_call`, added to the sink filter
  (`infrastructure/modules/chat-logs/variables.tf:44`, the `rubric_review` precedent),
  and one view. One row per call: `session_id, group_id, turn_index, tool, ok, error`,
  and for **`calculate` / `show_calculation` only**, `args` and `result` (model-authored
  numbers. No other tool's args are logged, because e.g. an illustrator request can quote
  the student). Dev has no infra trigger for views (`research_logs.py:9-16`), so readers
  use the inlined-CTE technique.
- Fix the TTFT counter's undercount (F4), or rename the field `tools_before_first_token`
  so it stops answering a question it cannot. Renaming is cheaper and more honest.
- **Transcript view:** the researcher's session view shows a quiet "🧮 calculated
  E = 360 kJ" line at the tool call's position, from the M1b rows. **Researchers only**,
  never the student replay.

## Milestones

Each is shippable on its own. M1 is valuable even if M2+ never ship.

### M0 — Evidence (~0.25d, read-only, **M runs it**)

Against `aipla-prod-2026` (and test, if the session ran there; open question in the notes).
`<since>` is the session's date. Use the inlined projection from
`analytics/research_logs.py:_turns_cte` if the view is absent.

```sql
-- Q1. Equation use: share of tutor turns that typeset a relationship.
SELECT skill_id, model, activity_id,
       COUNT(*) AS tutor_turns,
       COUNTIF(REGEXP_CONTAINS(content, r'\$[^$]*=[^$]*\$')) AS with_equation,
       COUNTIF(REGEXP_CONTAINS(content, r'\$')) AS with_any_math,
       ROUND(AVG(LENGTH(content))) AS mean_chars
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE role = 'tutor' AND DATE(ts) >= '<since>'
  AND NOT STARTS_WITH(IFNULL(group_id,''), 'teacher:')
  AND NOT STARTS_WITH(IFNULL(group_id,''), 'preview')
GROUP BY 1,2,3 ORDER BY tutor_turns DESC;

-- Q2. Numbers with units the tutor stated — the candidates for "maths errors".
SELECT session_id, turn_index, content
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE role = 'tutor' AND DATE(ts) = '<session date>'
  AND REGEXP_CONTAINS(content, r'\d[\d.,]*\s*(\\,|\\text\{)?\s*(J|kJ|W|kW|s|min|m/s|°C|K|kg|N|Pa|Hz|V|A|Ω)\b')
ORDER BY session_id, turn_index;

-- Q3. Tool use before first token (the only signal there is; undercounts — F4).
-- Cloud Logging, service aipla-v01-frontend:
--   jsonPayload.event="ttft" AND jsonPayload.tools_invoked_count>0
```

Read by hand: the Elkedel sessions from Q1, and every Q2 row, against the physics. The
output is a short table in this doc: **how many maths errors were actually found, of
which kind** (arithmetic, unit, wrong relationship, rounding). If Q2 finds no errors,
the tool is still justified by equation use and auditability, but M6's enforcement
question then has its answer: do not enforce.

### M1 — Record which tools each turn called (~0.75d + ~0.5d for M1b)

M1a, M1b and the counter rename, as in *Recording tool use*. **Acceptance:** a real
student turn that calls `control_sim` on dev produces a tutor row with
`tools_called = "control_sim"`, and a `tool_calls` row. A test drives `_emit_new_turns`
with an invocation whose tool call has no text and asserts that the name is not dropped,
which is the F4 bug written as a test.

### M2 — The `calculate` engine and tool (~1.5d; M2b `solve_for` +0.5d, separately)

`backend/maths/` + `adk/calc_tools.py`. It is attached to **every student-facing tutor**
in `create_agent` beside `build_sim_control_tools`, not via SKILL.md `tools:` lists
(a list per skill is the registration site the notation block's docstring warns
against). **Acceptance:** a table-driven test of 40+ physics cases (the Elkedel's
$E = P t$, $Q = m c \Delta T$, kinematics, unit conversions, a dimension mismatch, a
bare-number trig error). An adversarial-input test (exponent bomb, attribute access,
a 10 kB expression, `__import__`). `calc_id` stable across runs. Danish and English
`latex` output asserted against the notation preamble's rules.

### M3 — When to calculate, equation-first replies (~0.5d)

The preamble additions, the `concept-dialogue` sentence-count clarification, and the
narrowed sim carve-out. **Acceptance:** the existing notation-preamble wiring tests,
plus a test that the new text reaches a no-tutor activity and a tutor activity
identically (the F7 argument, asserted). Only M5's eval can show that the model complies. The
module docstring says the same of the original block (`math_notation.py:45-47`).

### M4 — `show_calculation` and the CalculationCard (~0.75d)

The tool, the `_CLIENT_RENDER_TOOLS` entry with its reason, the `CalculationCard`
component (KaTeX, strings in `frontend/messages/{da,en}/`, `make check-i18n`), and
`make check-stream-allowlist` green. **Acceptance:** a student stream test that
`calculate`'s result is the redaction sentinel and `show_calculation`'s is not. The card
renders the engine's number when the model's call args contain a different one.

### M5 — Count it: bench and prod (~1d)

One shared module, `analytics/calc_usage.py`, used by both the bench and the SQL (the 1.1.149
shape): **equation rate** (tutor turns with a typeset relationship), **calculation
rate** (turns with `calculate`), and **unverified-numeric rate** (F-design probe:
numbers with units in a tutor turn that no calculation, student message or sim state in
that invocation produced). The bench adds a scenario set
`research/maths-tool/scenarios.yaml` (a kettle question, a student with a factor-60
unit error, a student asking for the answer outright) run through the **real
`create_agent`** path (`compose_activity_turn`, as the 1.1.149 workbench scenarios do).
The `tutor_preview` path composes instructions only and would not carry the tools.
*Verify before relying on it:* that bench transcripts record tool calls at all. If
not, that is part of this milestone.
**Targets (proposed, for M to set):** equation rate ≥ 60% on relationship scenarios;
calculation before every derived number ≥ 90%; unverified-numeric rate ≤ 5%; the
"asks for the answer" scenario never gets the task's number on a card.

### M6 — Enforcement, decided by M5's numbers (~0.5d)

The notes asked to *"enforce use of a tool … and stop it using training"*. Three
levels, cheapest first. **Pick by data, not up front:**

1. **Prompt only** (M3), if M5 meets target.
2. **Next-turn nudge**: the unverified-numeric probe runs after each tutor turn, and
   a hit adds one line to the *next* turn's instruction (*"your last reply stated 360 kJ
   without calculating it; check it"*). This is the 1.1.149 nudge mechanism, with no added latency.
3. **Hard gate**: an `after_model_callback` that rejects a reply with an unverified
   numeric and re-asks with the tool forced. It adds a model round-trip (~0.6s on
   flash-lite) to exactly those turns. Only if 2 fails, and only for turns the probe flags.

Forcing tool use globally (Gemini `function_calling_config` mode `ANY`) is **not** an
option. It makes every model step call a tool, including the turn that should just talk.

Separately, if M0 shows *wrong relationships* rather than wrong arithmetic, no
calculator fixes that. The tool calculates whatever relationship it is given. That is the
"use a smarter model?" question, and it is answered by running the M5 scenarios on the
smart tier and comparing (O3), not by this tool.

### M7 — Release and re-measure (~0.25d)

Promote, then re-run M0's Q1/Q2 and M5's prod SQL on the next class session, and
record before/after in this doc.

## Open questions

- **O1 (M).** What did M0 find? Were the 2026-10-22 errors **arithmetic/units**, which the tool fixes,
  or **wrong physics**, which the tool cannot fix? The answer decides M6 and whether the
  smart-tier question (O3) comes first.
- **O2 (AR/JB).** Is the tutor allowed to use `solve_for` even to *check* a student's
  rearrangement, and may `show_calculation` ever show the student's own numbers? Both are
  pedagogical claims about the platform, not engineering defaults.
- **O3 (M).** A tool call adds a model round-trip to the turns that use it. Is that
  acceptable against the <1s first-token target, given the notes' "smarter not fast"
  consensus? And should the M5 scenarios also be run on the smart tier, to separate
  "needs a tool" from "needs a better model"?
- **O4.** Which local models (ADR-003 tiers) do reliable tool calling through the
  ADK's `LiteLlm` path? The tool itself runs identically under any model (F2's
  decision), but a local tutor that will not call it falls back to computing in its
  head. This feeds 1.1.158's choice of local tier. Add a calculation scenario to the local-model test plan
  ([local-model-test-plan.md](local-model-test-plan.md)).
- **O5.** Should `safeFormula.ts` (radians) and `physics_diagram.evaluate` (degrees)
  converge on the explicit-angle-unit rule this tool introduces? Out of scope here. The
  student calculator is a teacher-authored formula, and changing its trig convention
  silently would break existing activities.
- **O6.** Does `g` default to 9,82 m/s² (the Danish stx convention) or to the SI 9,81?
  Teachers will notice.

*Found while writing (out of scope):* the TTFT log's `tools_invoked_count` has
undercounted every tool called after the first token since it was written (F4). Any
earlier analysis that read it as a tool count was wrong in the same direction.
