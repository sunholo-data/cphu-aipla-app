# Event vocabulary

What a sim tells the rest of the product. Verified against the live artefacts
and the host code on 2026-09-14.

## The shape

```js
emit("<verb>", { ...payload });   // local wrapper → AIPLA_BRIDGE.emit("<id>.<verb>", …)
```

becomes a SEP-1865 `ui/update-model-context` notification whose
`structuredContent` is `{ kind: "<id>.<verb>", ...payload }`.

**Hard limit: 4096 bytes** of serialised `structuredContent`
(`_MAX_STRUCTURED_CONTENT_BYTES`, `backend/protocols/iframe_context_routes.py`).
Over that the push returns **413** and the tutor sees nothing. So send a *summary*,
not a log: a count of marked points, not the array of them.

## What the host does with a kind

Three independent consumers read the same payload. Getting a name wrong fails
one of them silently.

### 1. The trust card — driven by `label`

`GenericArtefactFrame.cardLabel()`:

- `structuredContent.label` present and non-empty → that string becomes the card
- no `label` → falls back to a generic `key=value` summary of `state`
- neither → **no card**, the push is silent

A labelled emit also fires ChatGPT's `sendFollowUpMessage` when the sim runs in
an external host. So:

> **Label the deliberate commits. Leave passive and continuous events
> unlabelled.** Every interactive sim needs at least one labelled emit —
> `scripts/check-artefact-broadcast.mjs` (in `make sim-build-check`) fails a sim
> that emits but never labels. A genuinely display-only artefact opts out with
> `<!-- @aipla-no-broadcast: <reason> -->`.

Write the label in the sim's own language and symbols — it is the student's
receipt, not a log line: `"Registrerede aflæsning: 33,6 °C efter 44,0 s"`.

### 2. The tutor's view of sim state

The payload is POSTed to `/api/sessions/{id}/iframe-context` with
`serverId` = the artefact id, and surfaces in the agent prompt as
`mcp_app_context.<id>.state` (`backend/adk/iframe_context.py`).

Carry a **`state`** object holding the sim's current configuration and
readings. Keep the key names something a tutor can read aloud (`power_W`,
`temperature_C`), because they end up in a prompt.

`GenericArtefactFrame` drops kinds ending `.pause`, `.reset`, `-error` or
`.sync` before this step — housekeeping never reaches the tutor.

### 3. The proactive gate — driven by the verb

`frontend/src/lib/proactiveEventCheck.ts` takes the kind's **last dot-segment**,
splits it on `-` and `_`, and matches **any** token against:

| Category | Tokens |
|---|---|
| `sim_run` | `play` `run` `simulate` `afspil` |
| `step_advance` | `step` `next` `advance` `placed` `calibrated` |
| `measurement_commit` | `measure` `record` `commit` `show_value` `reading` `fit` `spectrum` |

A match can trigger an unprompted tutor turn. No match → null, which is correct
for `open`, `stop`, `pause`, `reset`, `state-change`.

Because it tokenizes, `phase-change.run` works (last segment is `run`) and so
does `led-planck.auto-run`. Because it is a fixed list, `captured` or `snapshot`
or `logged` map to nothing at all, with no error anywhere. **Pick from the list,
or extend the list in that file plus a case in
`frontend/src/lib/__tests__/proactiveEventCheck.test.ts`.**

## The live vocabulary

Every kind the five artefacts emit today.

| Artefact | Kinds | Proactive category |
|---|---|---|
| `boldkast` | `play` | sim_run |
| | `show_value` | measurement_commit |
| | `open` `pause` `reset` `state-change` | — |
| `led-planck` | `auto-run` | sim_run |
| | `step-change` `component-placed` `calibrated` | step_advance |
| | `reading` `fit` `spectrum` | measurement_commit |
| | `state-change` `led-polarity-error` `reset` | — |
| `kinebot` | `sim-run` `run` | sim_run |
| | `next` | step_advance |
| | `record` | measurement_commit |
| | `set-topic` `state-change` | — |
| `kettle-efficiency` | `run` | sim_run |
| | `reading` | measurement_commit |
| | `open` `stop` `reset` `state-change` | — |
| `phase-change` | `run` | sim_run |
| | `reading` | measurement_commit |
| | `open` `pause` `reset` `state-change` | — |

## Worked payloads

From `kettle-efficiency`, which is the shape to copy for a measurement sim.

```jsonc
// Opened. Silent: there is nothing the student did yet.
{ "kind": "kettle-efficiency.open",
  "state": { "power_W": 2000, "volume_L": 1.4, "temperature_C": 20, … } }

// Settings committed. Silent, but the tutor sees the new configuration.
// `changed` names what moved since the last commit; `state` is always whole.
{ "kind": "kettle-efficiency.state-change",
  "changed": ["power_W", "volume_L"],
  "state": { … },
  "triggeredBy": "run" }          // or "chat-submit"

// A deliberate action → labelled → trust card + proactive turn.
{ "kind": "kettle-efficiency.run",
  "state": { … },
  "label": "Tændte kedlen: 1500 W, 1,0 L" }

// A committed measurement → labelled. The payload carries the reading itself,
// because this is the thing the tutor will ask about.
{ "kind": "kettle-efficiency.reading",
  "reading": { "power_W": 1500, "mass_kg": 1.0, "t_start_C": 20,
               "t_end_C": 33.6, "duration_s": 44.0, "meter_kWh": 0.0183 },
  "state": { … },
  "label": "Registrerede aflæsning: 33,6 °C efter 44,0 s" }
```

## Rules

1. **Namespace every kind with the artefact id.** The local `emit()` wrapper
   does it; never post a bare `state-change`.
2. **`state` is always the full current snapshot**, small enough to send every
   time. If it is not small, you are sending a log — send a summary instead.
3. **Label deliberate commits only.** Slider drags, navigation and repeated
   passive readings stay unlabelled or the chat fills with cards.
4. **Never emit the answer.** Values the student is meant to derive belong in
   the catalogue's `tutorBlock`, which never reaches the browser.
5. **Do not echo a host push.** When the host sends `<id>.set-<thing>` and the
   sim re-renders, do not emit that value back — the host already knows it. A
   *derived* value computed from it may come back as normal telemetry.
6. **`triggeredBy`, not `source`.** A top-level `source` key collides with the
   namespace the host filters on.
