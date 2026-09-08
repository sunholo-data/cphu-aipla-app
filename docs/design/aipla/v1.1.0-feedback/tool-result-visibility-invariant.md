# A tool result is privileged until something says otherwise

**Status**: **Design (OPEN)** — **1.1.101**
**Priority**: **P1** — small, and it closes a default that grows more wrong with every teacher-authored artefact. Needs only the existing deployment
**Estimated**: ~1–1.5d (M0 invert the default ~0.5d · M1 declare the render-safe set ~0.5d · M2 the empty-name edge + tests ~0.25d)
**Scope**: Backend — `adk/stream_redaction.py` inverted from a name registry to a declared property; the MCP render path given an explicit declaration instead of an implicit pass
**Dependencies**: `adk/stream_redaction.py` (**shipped** STRIP-1, 2026-07-11 — this rebuilds its decision rule, not its plumbing); [shared-mcp-app-bridge](shared-mcp-app-bridge.md) (**shipped** — the `ui://` path that made the current default necessary); [teacher-authored-workbench-apps](teacher-authored-workbench-apps.md), [teacher-authored-simulations](teacher-authored-simulations.md), [sim-catalogue-admin](sim-catalogue-admin.md) (the reason the default stops being safe)
**Created**: 2026-09-08
**Source**: [upstream-capability-triage](../v2.1.0-extension/upstream-capability-triage.md) — upstream's `adk/stream_invariants.py`, whose docstring credits *"AIPLA #39"*: they built this **from our own bug report** and we never collected it

## Problem Statement

**We solved this in July. We solved it with a list, and the list is the part that ages.**

STRIP-1 (`adk/stream_redaction.py`, 2026-07-11) closed a real hole: AG-UI mirrors
`TOOL_CALL_RESULT` onto the SSE stream, so `run_checkpoint` returning the
teacher's expected answers was readable by any student with devtools open. The
fix redacts server-only tool results for anonymous-group sessions, and its
plumbing is sound — it tracks `TOOL_CALL_START` to recover the tool name, since
AG-UI's result event carries only a `toolCallId`.

The decision rule is where it differs from upstream, and the difference is the
direction of the default:

```python
def should_redact_tool(tool_name: str) -> bool:
    if tool_name in _CLIENT_RENDER_TOOLS:
        return False
    return tool_name in _platform_tool_names()   # ← membership, not property
```

A tool is redacted **because it is in the registry**. Its own docstring is
explicit about the consequence, and treats it as intended:

> unknown names are MCP-server tools — the interactive-iframe render path —
> and pass through.

**That was correct in July and is becoming incorrect now.** It was safe while
every MCP tool in the system was hand-written by one person who knew this rule.
The roadmap deliberately ends that: [teacher-authored-workbench-apps](teacher-authored-workbench-apps.md),
[teacher-authored-simulations](teacher-authored-simulations.md) and
[sim-catalogue-admin](sim-catalogue-admin.md) all describe artefacts authored by
someone who has never read `stream_redaction.py`. The moment a teacher's MCP tool
returns anything it should not — a worked solution, a marking scheme, another
group's answer — it reaches the student stream **by default, silently, with no
review step that would catch it.**

The failure has the property this repo keeps writing down: nothing errors,
nothing logs, and the reassuring state is indistinguishable from the correct one.

### The narrower bug, found while writing this

The redaction loop comments itself as failing closed:

```python
# Fail CLOSED: an unmatched result (start never seen) is redacted.
name = names_by_call_id.get(event.get("toolCallId") or "")
if name is None or should_redact_tool(name):
```

It does fail closed when the START event never arrived. But the START handler
stores `event.get("toolCallName") or ""` — so a START that arrives **without a
name** stores an empty string, which is not `None`, and:

```
should_redact_tool('')  →  False        # verified 2026-09-08
```

An empty tool name therefore **passes the result through**. Narrow, and not
known to be reachable today, but it is the same class as the thing being fixed:
the guard's stated invariant and its actual behaviour disagree, and the
disagreement is in the permissive direction.

## Approach

Invert the rule. Upstream states it as one sentence — *a tool result is
privileged until something says otherwise* — and that sentence, not their code,
is what is worth taking.

### M0 — Invert the default (~0.5d)

`should_redact_tool` becomes: redact **unless** the tool declares itself
client-renderable. An unrecognised name is redacted, because an unrecognised
tool is precisely the one nobody has reviewed.

The event still flows and the `ToolCallChip` keeps its ✓ — that behaviour is
already right and should not change. Only `content` is replaced.

### M1 — Give the MCP path an explicit declaration (~0.5d)

The current pass-through exists for a real reason: MCP-server results carry the
`ui://` references the iframe render path needs. That need is legitimate and
must survive the inversion — but as a **declaration**, not as a gap.

Two candidate shapes, and M should pick:

1. **Declare at registration.** An artefact registered through the sandbox
   catalogue is marked client-renderable there, so the property travels with the
   artefact and a teacher-authored one defaults to redacted until reviewed.
2. **Declare in the envelope.** The result itself carries a visibility marker,
   so a tool can return a renderable reference and a privileged payload in one
   call without being all-or-nothing.

**Recommend (1)** — it puts the decision at the point where a human is already
approving an artefact ([safe-to-publish-vetting](safe-to-publish-vetting.md) is
the natural neighbour), rather than trusting the tool to mark its own output.
(2) is more expressive and can follow if a real tool needs it.

### M2 — Close the empty-name edge and test the invariant (~0.25d)

Treat an empty or missing `toolCallName` as unknown, i.e. redact. Then test the
*property*, not the list: a tool name that appears nowhere in any allow-list must
not reach a student stream. That test keeps passing when someone adds a tool and
forgets this file — which is the whole point.

## What this is not

- **Not a change to teacher streams.** They pass through untouched; the
  co-pilot's proposal cards *are* tool results. Unchanged.
- **Not a redesign of STRIP-1's plumbing.** The `TOOL_CALL_START` → name
  tracking is correct and stays.
- **Not a copy of `stream_invariants.py`.** Their module carries an
  event-sink and notability machinery we do not have. The invariant is the
  import; the code is not.

## Acceptance

- A tool name absent from every allow-list is redacted on a student stream —
  asserted as a property, with a deliberately unregistered name.
- A `TOOL_CALL_START` carrying no name results in a redacted result.
- MCP-app artefacts still render: the `ui://` path works end-to-end for a
  declared artefact (smoke: an existing sim through the workspace surface).
- A teacher-authored artefact that has not been declared renderable is redacted
  — the default a new author gets is the safe one.
- Teacher streams are byte-identical to today.
