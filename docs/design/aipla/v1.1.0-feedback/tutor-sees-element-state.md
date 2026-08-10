# The tutor sees element STATE, not just existence

**Status:** Design (OPEN) — **P0.** Written 2026-08-10 from Aswin's 2026-08-10 feedback. Direct follow-on to [1.1.62](workbench-element-awareness.md), and a consequence of a decision made there.
**Priority:** **P0** — the pilot is live-adjacent (teacher pilot 2026-08-14). A tutor that marks a learning outcome on a student's unverifiable *"done"* is worse than one that never marks: it produces confident, wrong assessment data, and 1.1.62 M3 just made marking automatic.
**Estimated:** ~1.5–2d (M1 element-state block ~0.75d · M2 empty-state signal at session start ~0.5d · M3 tool-side verification ~0.5d)
**Scope:** Backend — a state block beside [`adk/element_manifest.py`](../../../../backend/adk/element_manifest.py), read from the same `mcp_app_context` the iframe-context push already writes; a session-start reconcile so untouched elements report *empty* rather than *absent*; and a check in `mark_checklist_item` for steps that name a fillable element.
**Dependencies:** [1.1.62 workbench-element-awareness](workbench-element-awareness.md) (**SHIPPED** — the manifest this extends, and the tool whose marking this constrains); [1.1.38 activity-elements-palette](activity-elements-palette.md) (**SHIPPED** — `useSimSnapshotPush`, the wire); [progress-conversation-lifetime](progress-conversation-lifetime.md) (1.1.70 — the sibling regression from the same report)
**Source:** Aswin, 2026-08-10 — *"I also noticed although the chat now recognizes the tables and other stuff in the workbench, but it did not know if the data exist. When it told me to fill out and I said 'done' without filling out the data, but it did not recognize the data empty and continued chatting."*
**Created:** 2026-08-10 (M)
**Last Updated:** 2026-08-10 (M)

## Problem Statement

**1.1.62 told the tutor what exists. Nothing tells it what is filled in.**

The element manifest says, verbatim:

> *The student's current entries are not shown here; you receive them as they work.*

That was a deliberate choice and the reasoning still holds: the manifest is composed **once per session**, so baking values into it would go stale within a turn. Values were to arrive live instead, over the `iframe-context` push.

The gap is that the push is **interaction-triggered**. `useSimSnapshotPush` fires when a student edits a cell. If they never touch the table, `mcp_app_context.table.state` is never written — so the tutor does not see an empty table, it sees **nothing at all**, which is indistinguishable from "no table" and from "not yet loaded".

Confirmed in the dev logs for Aswin's session (`sweet-bison-13`, 2026-08-07 10:56–11:01): every `iframe_context: write` in that window is `server=progress` — the checklist. **Not one `server=table`.** He never touched it, so the tutor had no state to check, believed *"done"*, and moved on.

### Why this is now urgent rather than cosmetic

Before 1.1.62 M3 the consequence was a tutor that could not scaffold well. Now the tutor **marks the teacher's ILOs automatically**, and its own instruction says:

> *Do NOT tick a step just because the student says "done"; tick it when you have seen the substance.*

For any step whose substance lives in a table, that instruction is **unfollowable** — we ask the model to verify something we never show it. The tool then records an evidence sentence that sounds authoritative (*"Student confirmed the measurements are complete"*) and it becomes assessment data the teacher reads.

**A confidently-wrong mark is the failure mode here, and we built the confidence.**

## Goals

**Primary:** The tutor knows whether a fillable element is empty, partially filled, or complete — from the first turn, without the student having touched it.

**Success metrics:**

- A student who says *"done"* with an empty table is asked to fill it, not congratulated.
- `mark_checklist_item` refuses (or downgrades) a mark on a step whose element is demonstrably empty.
- An untouched element reports **empty**, distinct from **unknown**.
- No stale values: the tutor's picture is never older than the last turn.

**Non-goals:**

- Ground-truth checking of the *values* (are these good measurements?) — that is [1.1.24 offline-lab](offline-lab-workbench.md).
- Streaming per-keystroke state. Turn granularity is enough.
- Blocking a student from claiming done. The tutor asks; it does not police.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | One extra read of state already in the session; no new round-trip on the student's path. |
| 2 | EARNED TRUST | **+1** | The headline. A mark the tutor cannot justify is a trust violation dressed as a feature — the student sees an authoritative-sounding evidence sentence about work they did not do. |
| 3 | SKILLS, NOT FEATURES | 0 | Extends the skill's own context. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Fill-state is computed deterministically (count non-empty cells); zero LLM. The model judges meaning, not emptiness. |
| 5 | GRACEFUL DEGRADATION | +1 | No state → reports "unknown", explicitly, rather than implying empty. Unknown and empty must never collapse: that conflation is the bug. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reads the shipped `mcp_app_context` written by the existing iframe-context route. No second channel. |
| 7 | API FIRST | 0 | No new endpoint. |
| 8 | OBSERVABLE BY DEFAULT | +1 | A refused mark logs why — the counterfactual is currently invisible. |
| 9 | SECURE BY CONSTRUCTION | 0 | Same session state, same group scoping. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Fill-state derived server-side from state the client already sends. |
| 11 | USABLE BY DESIGN | +1 | Closes the loop a teacher assumes exists the moment they author a table and a matching checklist step. |
| | **Net Score** | **+7** | Threshold: >= +4 |

## Framework-Native Capability Check

- **The transport exists.** `mcp_app_context.{server}.{tool}` is written by
  [`iframe_context_routes.py`](../../../../backend/protocols/iframe_context_routes.py)
  and injected into every prompt by `wrap_with_iframe_context`. Nothing new is
  needed to *carry* state — only to make its **absence** meaningful.
- **The snapshot already carries shape.** `ProgressSnapshot` sends ids, labels
  and totals, not just values, precisely so the agent's prompt is
  self-describing. The table snapshot should be read the same way.
- **No new store.** Fill-state is derived, never persisted — persisting it would
  create a second source of truth to drift against the session state.

## Design

### The core decision: absence must be positively reported

The fix is not "push more often". It is that **the tutor's context must
distinguish three states**, where today it sees two collapsed into one:

| | Today | After |
|---|---|---|
| Element untouched | *(nothing in context)* | `empty — the student has not entered anything` |
| Element partly filled | live snapshot | `partial — 3 of 15 cells` |
| No such element | *(nothing in context)* | *(nothing — correct)* |

Untouched and no-such-element are currently the same observation. That is the
whole bug: the tutor cannot tell "they haven't started" from "there is nothing
to start".

### M1 — Element state block

A companion to `describe_elements()` that reads `mcp_app_context` and emits a
compact per-element fill summary, refreshed **every turn** (unlike the manifest,
which is composed once — this block must be an instruction *provider*, not a
baked string, or it goes stale exactly as the manifest would have):

```
Workbench state right now:
- Data table "Faldforsøg": EMPTY (0 of 15 cells filled)
- Checklist: 2 of 5 steps ticked
```

Deterministic, no LLM. The counting lives beside the describers so a new element
kind gets a fill-state reader in the same place it gets a describer — the
registry-completeness test extends to cover it.

### M2 — Untouched means empty, not unknown

At session start, seed `mcp_app_context` for every fillable authored element with
an explicit empty snapshot, so the tutor's first turn already reports `EMPTY`
rather than silence. Two candidate mechanisms — pick at build time:

1. **Client-side:** the workspace pushes an initial snapshot on mount (one POST,
   reuses the existing `progress.sync` silent path, no trust card).
2. **Server-side:** the state block synthesises `EMPTY` for any authored element
   with no `mcp_app_context` entry.

(2) is preferred: it cannot be defeated by a student who never opens the
workbench tab, and it needs no frontend change. (1) is a fallback if the
server cannot enumerate expected element ids reliably.

### M3 — The tool stops accepting unverifiable marks

`mark_checklist_item` gains a check: when the step is associated with a fillable
element that is **demonstrably empty**, refuse and tell the model why.

```
{"ok": false,
 "error": "the data table \"Faldforsøg\" is empty — ask the student to fill it in
           before marking this step; do not mark on their say-so alone"}
```

Refusal rather than a silent downgrade, matching the empty-evidence refusal
already shipped: the model gets a correctable reason and the student gets the
right question instead of a wrong congratulation.

**Open: how is a step associated with an element?** Three options, in
increasing cost — (a) infer from the step label mentioning the element title
(cheap, fuzzy); (b) an optional `elementId` on `ChecklistItem` the teacher sets
(explicit, needs authoring UI); (c) let the tutor pass which element it checked
(model-controlled, weakest). **Proposed: (b), defaulting to (a)** when unset, so
existing activities benefit with no re-authoring. Settle before M3.

## Implementation Plan

- **M1** element-state block + per-kind fill readers + registry test (~0.75d)
- **M2** untouched → `EMPTY` (server-side synthesis preferred) (~0.5d)
- **M3** `mark_checklist_item` empty-element refusal + step↔element association (~0.5d)

## Testing Strategy

- **Backend:** untouched element renders `EMPTY`, never absent; absent element
  renders nothing; partial counts correctly; block is regenerated per turn (not
  cached from session start); `mark_checklist_item` refuses on an empty
  associated element and still succeeds when the element has data.
- **The regression test:** compose a session with a table and a checklist step,
  push **no** table state, and assert the tutor's context contains `EMPTY`.
  That is Aswin's exact case.
- **Eval:** student says *"done"* with an empty table → the tutor asks them to
  fill it in and does **not** call `mark_checklist_item`.

## Success Criteria

- [ ] An untouched table reports `EMPTY` in the tutor's context on turn one
- [ ] "Done" on an empty table is challenged, not accepted
- [ ] `mark_checklist_item` refuses on a demonstrably empty associated element
- [ ] Unknown and empty are never conflated
- [ ] State is at most one turn stale
- [ ] A new element kind needs a fill reader in the same place as its describer

## Open Questions

1. **Step↔element association** — (a)/(b)/(c) above. Blocks M3, not M1/M2.
2. **Does the same gap apply to the solution editor and document upload?**
   Almost certainly — both are "student produces something" surfaces with the
   same interaction-triggered push. Worth confirming and covering in M1 rather
   than fixing twice.
3. **Should an empty element suppress the tutor's *own* wrap-up?** A tutor
   offering to summarise while three tables are empty is the same error one
   level up. Probably yes; needs AR/JB input on tone.

## Related Documents

- [workbench-element-awareness.md](workbench-element-awareness.md) — 1.1.62, which told the tutor elements exist
- [progress-conversation-lifetime.md](progress-conversation-lifetime.md) — 1.1.70, the sibling regression from the same report
- [offline-lab-workbench.md](offline-lab-workbench.md) — 1.1.24, ground-truth *values* (out of scope here)
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's feedback
