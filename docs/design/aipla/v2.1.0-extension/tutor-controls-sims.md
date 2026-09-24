# The tutor can act on the simulation — commands as tool calls, not text

**Status**: **Design (OPEN)** 2026-09-24 — **1.1.133**. Taken for the next sprint (M, 2026-09-24)
**Priority**: **P2** — no sim needs it to work; the first author-supplied sim was designed around it, and it is the one capability every sim so far has lacked
**Estimated**: **~3–3.5d for M0–M3** (catalogue command surface ~0.5d · the control tool + browser routing + student card ~1.5d · per-tutor control policy ~0.5d · assessment tool ~0.5–0.75d). M4 (in-turn results via AG-UI frontend tools) is a **~0.5d spike**, decided after M1 is in use
**Scope**: Backend — `db/models/artefact.py` (a `commands` field), a new `adk/sim_control_tools.py`, `adk/stream_redaction.py` (allow-list), `adk/agent.py` (tool wiring), the tutor framework YAML (policy), chat-log stamp. Frontend — `GenericArtefactFrame.tsx`, `MessageBubble.tsx`, one small client bus. Sims — each sim that opts in declares its commands; `sol-jord-maane` already answers them
**Dependencies**: [shared-mcp-app-bridge](../v1.1.0-feedback/shared-mcp-app-bridge.md) (**shipped** — `onHostNotification`, the channel commands ride); [1.1.41 teacher-sim-resources](../v1.1.0-feedback/teacher-sim-resources.md) (**shipped** — `ArtefactMeta`); [1.1.62 workbench-element-awareness](../v1.1.0-feedback/workbench-element-awareness.md) (**shipped** — the server-tool → client-card pattern `mark_checklist_item` uses); [1.1.101](../v1.1.0-feedback/SEQUENCE.md) (the deny-by-default stream filter). **Un-gated**
**Related**: [1.1.104 simulation-import-pipeline](../v1.1.0-feedback/simulation-import-pipeline.md) (in-app import — a submitted sim's commands are reviewed there) · [1.1.115 sim-verify-mcp](sim-verify-mcp.md) · the tutor layer, [tutors-handover-2026-09-10](../v1.1.0-feedback/tutors-handover-2026-09-10.md) (where the policy lives)
**Created**: 2026-09-24
**Source**: the `sol-jord-maane` import (`951e7087`). Author I's package (`docs/design/mockups/INTEGRATION.md`, `aktivitetsmodul.md`) has the tutor steer the sim and record assessments by writing tagged lines in its reply. M, on reading the import notes: *"we dont do that in other sims yet right? … is this the first sim where it also controls it? … does it use the existing AGUI protocols? are we sticking to protocol first architecture?"*

## Where we are

**The tutor can read every sim and drive none of them.** Traffic today:

| Direction | What travels | Channel | Since |
|---|---|---|---|
| sim → tutor | the student's actions and the sim's state | SEP-1865 `ui/update-model-context` → `POST /api/sessions/{id}/iframe-context` → `mcp_app_context.<id>.state` in the prompt (`adk/iframe_context.py`) | every catalogued sim |
| host → sim | "commit what is pending, a message is being sent" | `ui/notifications/chat-flush` via `StaticArtefactFrame.sendNotification` (`GenericArtefactFrame.tsx:129`) | every catalogued sim |
| host → sim | **anything the tutor decided** | — | **nothing** |

Verified 2026-09-24: no frontend code sends any `<id>.set-*` or `<id>.cmd-*`
notification, and no agent tool targets a sim.

`sol-jord-maane` is the first sim with a **receiving** end. Its port registers
every command in the author's spec as the host notification
`sol-jord-maane.cmd-<command>`, verified through the real
`sandbox.html` double iframe (`cmd-jump {event: "solform"}` moved the sim to the
6 Feb 2027 annular eclipse). The sending end is this document.

## What the author proposed, and why we are not building it

```
<sim>{"command": "setView", "args": {"id": "surface", "target": "sun"}}</sim>
<vurdering>{"mission": "M2", "niveau": 4, "faenomen": "aarstider", …}</vurdering>
```

The tutor writes these lines inside its reply. The platform strips them before
the student sees the text, and either forwards them to the sim or stores them.
It is a reasonable design for a standalone harness. Here it fails four ways:

1. **Streaming.** Replies arrive as token deltas. A half-written `<sim>{"comm`
   is on the student's screen before the closing tag exists. Stripping needs a
   buffering parser inside the AG-UI text stream, which is exactly the component
   1.1.122 had to add for `[rag-source-N]` markers, and it leaked to TTS first.
2. **No schema.** The model can malform the JSON, invent a command, or put the
   line mid-sentence. Nothing validates it before it acts.
3. **Invisible to everything we have built.** A text span is not a tool call, so
   the stream filter, the chat-log tool rows, the trust cards and the researcher
   lens all miss it. For `<vurdering>` this is disqualifying: assessment evidence
   must be a structured, attributable record, not a regex over prose.
4. **A second wire format.** The porting guide's first anti-pattern. We already
   have a transport for "the agent did something with arguments": the tool call.

## Protocol-first mapping

Every hop already exists; what is missing is the tool and the routing between
two components that do not currently talk.

```
tutor (ADK)
  │  function call  control_sim(command, args)            ← ADK tool, schema-checked
  ▼
AG-UI stream      TOOL_CALL_START / ARGS / END / RESULT   ← existing transport (ag_ui_adk)
  ▼
browser           MessageBubble sees the call  ─► SimCommandCard ("Tutoren …")
  │               simCommandBus.dispatch(toolCallId, …)   ← NEW, ~40 lines
  ▼
GenericArtefactFrame.sendNotification("<id>.cmd-<command>", args)   ← existing
  ▼
SEP-1865 postMessage → sandbox proxy → sim's onHostNotification     ← existing
  ▼
sim changes; its state reaches the tutor on the next commit/flush   ← existing
```

Layer check against the platform's stack: **Layer 3 (AG-UI)** carries the
decision; **Layer 4 (MCP Apps)** carries it into the view. No layer is bypassed,
and no new protocol is introduced.

## Design

### M0 — a sim declares what may be done to it (~0.5d)

`ArtefactMeta` gains `commands`, validated like every other catalogue field:

```yaml
commands:
  - name: jump
    description: "Move the sim's time to the next astronomical event."
    args:
      type: object
      properties:
        event: { enum: [nymaane, foerste, fuldmaane, sidste, foraar, sommer, efteraar, vinter, perihel, aphel, middag, midnat, solform, maaneform] }
      required: [event]
    effect: "Hoppede til {event}"        # student-facing card text, Danish, templated
    power: view                          # view | scaffold | restrict — see M2
```

- A sim with no `commands` cannot be controlled, and the tool is not offered.
  **Default-deny, per sim.**
- `commands` is **public** (`ArtefactMeta.public()` keeps it): a teacher should
  be able to see what the tutor may do in the sim they attach.
- The descriptions and arg schemas feed the tool's own schema (M1), so the model
  sees exactly one sim's commands, typed.
- `test_artefact_catalogue.py`: every declared command name must be registered
  by the artefact's HTML (`onHostNotification(… + '.cmd-' + name`) — a grep, the
  same shape as the broadcast floor.

`sol-jord-maane` declares the author's list minus `snapshot` / `getState`
(`getState` needs a reply channel, see M4; `snapshot` returns an image, which
has no channel at all).

### M1 — the control tool, the routing, the card (~1.5d)

**Backend.** `adk/sim_control_tools.py` builds **one** tool per session, only
when the activity's artefact declares commands:

```python
def control_sim(command: str, args: dict) -> dict:
    """Change what the student's simulation shows. … (generated from the catalogue)"""
```

- Validates `command` ∈ declared, `args` against its schema; unknown → an error
  the model can read, nothing reaches the browser.
- **Fire-and-forget:** returns `{"sent": command, "effect": "<rendered card text>"}`
  immediately. The sim's resulting state arrives through the existing sim → tutor
  path on the next commit or chat send. This is the `mark_checklist_item`
  pattern (1.1.62): a server tool whose streamed result the client renders.
- Added to `_CLIENT_RENDER_TOOLS` (`adk/stream_redaction.py`) with a reason line.
  **This is the 1.1.101 footgun**; `make check-stream-allowlist` must go red
  without it, and the test for this milestone asserts it does.
- Rate limit: at most 3 control calls per tutor turn (a tutor that "tries
  things" in a loop is a sim flickering under the student's cursor).
- Logged on the chat-log row as a tool call (research: which tutor moved the
  sim, when, to what).

**Frontend.**

- `simCommandBus` — a tiny context owned by `StudentWorkspace`. MessageBubble
  publishes `{toolCallId, artefactId, command, args}`; `GenericArtefactFrame`
  subscribes and calls `sendNotification`.
- **Apply live events only, exactly once.** The bus remembers applied
  `toolCallId`s, and **history hydration never dispatches**. Otherwise reopening
  a chat replays every jump the tutor ever made and the sim ends somewhere
  arbitrary. This is the easiest bug in the design to ship.
- `SimCommandCard` in the chat, in the trust-card family (the mirror image:
  "shared with the AI" becomes "the tutor changed your simulation"): the effect
  text plus an **Undo** that is only offered where the command has an inverse
  (`setShow`, `setScale`, `setView` store the prior value; `jump` stores the
  prior time). The student is never left unable to get back.

**The sim side (a rule, stated in the skill).** A command handler **must not**
emit a labelled event. Otherwise tutor command → labelled emit → proactive
turn → tutor command is a loop. `sol-jord-maane` already obeys this, because its
`command()` calls setters with no `source`, and those emit nothing.

### M2 — how much control each tutor has (~0.5d)

The author is explicit that this depends on the teaching approach (*"Hvor meget
du selv styrer simulationen, afhænger af din tilgang"*), and the tutor layer
(1.1.91) is where approach lives. Each command carries a `power`:

| `power` | Examples | Meaning |
|---|---|---|
| `view` | `setView`, `look`, `setShow`, `jump`, `setTime` | changes what is shown; the student can change it straight back |
| `scaffold` | `setTask`, `startMission`, `openQuiz`, `toast` | puts tutor-authored text or structure on the student's screen |
| `restrict` | `lock`, `configure` | removes an ability from the student |

A tutor framework YAML gains `sim_control: none | view | scaffold | restrict`
(cumulative). Default is **`view`**. POE-style tutors, which lock time until a
prediction is in, need `restrict`, and asking for it is an explicit decision in
the framework file, visible at `/project/tutors`. The tool is built with only the
commands the tutor's level admits; a disallowed command is not in the schema at
all, so the model never sees it.

`scaffold` commands put **model-generated text** inside the sim. That text goes
through the same language directive as the reply (it is the tutor speaking), and
the card shows it verbatim.

### M3 — assessment as a tool, not a tag (~0.5–0.75d)

`<vurdering>` becomes `record_assessment(phenomenon, level, evidence, misconception?, mission?)`:

- **Hidden from the student**: NOT in `_CLIENT_RENDER_TOOLS`, and its result is
  redacted from the stream. The module's rule "never show the student a level"
  becomes structural, not a prompt instruction. The `record_checkpoint`
  (CONCEPT-1) precedent is the same shape with the opposite visibility.
- The level scale and phenomenon vocabulary come from the sim's catalogue entry
  (a new optional `assessment:` block: `phenomena: [doegn, aarstider, faser,
  formoerkelser, skala]`, `levels: 0–6`), so the tool is only offered on sims
  that define a construct map, and its enum is that map.
- Written to the chat-log row (BigQuery) with `revision`, tutor id and
  framework, so the researcher lens can compare tutors on one scale, which is
  the author's stated purpose (*"så den kan sammenlignes mellem instruktører"*).
- "A guess or 'don't know' is level 0, not a low level" stays in the tutorBlock;
  the eval (below) checks it.

This feeds the extension's **rubric-scored logs as assessment evidence**
workstream directly. It is the first time a sim contributes a scale.

### M4 — spike: results inside the turn (~0.5d, after M1 is in use)

M1 is fire-and-forget: the tutor learns what a command did on the *next* flush.
When that is not enough ("jump to the eclipse and tell me the obscuration"), the
protocol-native answer is **AG-UI frontend tools**: the browser declares
`control_sim` in `RunAgentInput.tools`, the agent calls it, the browser executes
and returns the sim's new state as the tool result. `ag_ui_adk` supports this
(`ClientProxyToolset` / `ClientProxyTool`). AIPLA has never used it.

The spike answers one question. `ClientProxyTool` wraps
`LongRunningFunctionTool`: the run **pauses** and resumes when the client
submits the result in a new run. Does that survive our session
persistence, the proactive-turn machinery and the student typing in between? If
it does, M1's server tool is replaced by the frontend tool and the sim gains a
reply path (`<id>.cmd-result`). If not, fire-and-forget stays.

The same spike should note the **MCP Apps** equivalent for external hosts: a
tool bound to the sim's `ui://` resource receives `ui/notifications/tool-input`
in the view, which would make sim control portable to Claude/ChatGPT via `/mcp`.
Not in scope; recorded so the in-app design does not paint over it.

## Non-goals

- **The tutor seeing the sim.** Images (`snapshot`) need a channel
  `ui/update-model-context`'s 4 KB JSON cap cannot carry. Separate item.
- **Per-activity sim configuration** (teacher sets `struktur=poe` for one
  class). It rides the same `cmd-configure` notification but is sent by the
  *activity* at mount, not the tutor. Small, and worth doing in the same sprint
  if there is room (~0.25d), but not required for this one.
- **Retrofitting commands into Boldkast / LED Planck / KineBot.** Opt-in per sim;
  add when a lesson asks for it.

## Acceptance

1. A sim with no `commands` → the tutor's tool list for that activity contains
   no `control_sim` (unit, over the real agent builder).
2. `control_sim("jump", {"event": "solform"})` on `sol-jord-maane` → the card
   renders, the sim's clock reads 6 Feb 2027, the next flush carries
   `formoerkelse.sol: "annular"` (browser, real sandbox path, the harness used
   for the import: a host page + `serve.ts` + Playwright).
3. Reload the chat → the sim does **not** jump again (history never dispatches).
4. Remove `control_sim` from `_CLIENT_RENDER_TOOLS` → `make check-stream-allowlist` fails.
5. A `view`-level tutor's tool schema has no `lock`; a `restrict`-level tutor's does.
6. `record_assessment` never appears in the student's stream (unit on the
   redaction filter) and does appear on the chat-log row (integration).
7. **Eval**: for an `answer-commit` of "ved ikke", the tutor records level 0 for
   that phenomenon, not level 1.
8. A command handler in a conforming sim emits no labelled event
   (`verify_sim.mjs` gains a `--commands` pass: fire each declared command, assert
   zero labelled emits).

## Risks

| Risk | Mitigation |
|---|---|
| History replay re-applies commands | apply-once by `toolCallId`; live-only dispatch; acceptance 3 |
| Command → labelled emit → proactive turn → command | sim rule + `verify_sim --commands`; server rate limit |
| Tutor moves the sim while the student is mid-interaction | `view` commands are undoable; card names the change; rate limit. Watch it in the first classroom session |
| Allow-list forgotten (1.1.101) | acceptance 4 is the test that would have caught it |
| Assessment leaks to the student | not allow-listed + redacted; acceptance 6 |
| Two sources of truth for commands (catalogue vs. sim HTML) | catalogue test cross-checks registration (M0) |

## Open decisions for the sprint

1. **Default `sim_control` level.** Proposed `view`. The alternative, `none`
   (opt-in per tutor), is safer and makes the first classroom use deliberate.
2. **Where the card sits** — in the chat stream (proposed; it is the tutor's
   act) or as a toast inside the sim frame.
3. **Does `record_assessment` wait for M4**, or ship in the same sprint as M1?
   It does not depend on M1 at all, and it is the half that serves research.
