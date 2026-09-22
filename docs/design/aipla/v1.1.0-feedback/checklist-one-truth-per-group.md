# Checklist: one truth per group, and a stated rule for who ticks

**Status:** Design (OPEN) — **1.1.128**
**Priority:** **P1** for M0–M1 (state bugs that make ticks vanish on a shared group), **P2** for M2–M3 (marking policy, needs JB)
**Estimated:** ~1.5–2d (M0 store + refetch ~0.5d · M1 prompt sees one checklist ~0.3d · M2 tap-on-AI-tick ~0.3d · M3 marking policy + teacher control ~0.5–0.75d)
**Scope:** Backend — `db/checklist_progress.py`, `adk/checklist_tools.py`, `adk/iframe_context.py`, `adk/element_manifest.py`, `db/models/activity_config.py`. Frontend — `components/workspace/ProgressChecklist.tsx`, `app/chat/[...path]/page.tsx`
**Dependencies:** [workbench-element-awareness](workbench-element-awareness.md) (**shipped** — `mark_checklist_item` / `list_checklist`); [tutor-sees-element-state](tutor-sees-element-state.md) (**shipped** — empty-element refusal, "the store is the authority"); [progress-conversation-lifetime](progress-conversation-lifetime.md) (**shipped** — inherited-progress block); [1.1.79 pilot follow-ups](pilot-session-2026-08-21-followups.md) defect C (the anti-fabrication guard crash, **fixed**). **Un-gated** for M0–M2
**Created:** 2026-09-22
**Source:** [classroom-session-2026-09-22-followups.md](classroom-session-2026-09-22-followups.md), finding 5

## Problem Statement

Three observations from the 22 September session (5-step checklist:
*START · Tegneserie uploadet og revideret · Målinger indtastet · Film · Oprydning*):

1. **The tutor ticked a compound step on half the evidence.** `tilted-guppy-64`,
   14:24: *"Jeg har nu markeret 'Tegneserie uploadet og revideret' som færdiggjort"* —
   and in the same reply, that the drawing did not yet show the hypothesis. It
   was uploaded, not revised.
2. **The tutor contradicts itself about who ticks.** Other groups were told
   *"I kan markere trinnet … som færdigt"* (you can mark it).
3. **Ticks flip-flop in the log.** `fuzzy-bison-57` within one minute:
   `['step-1'] → [] → ['step-2'] → []`. `shy-mouse-65`:
   `['step-1'] → [] … ['step-2'] → [] → ['step-1']`. A done list with step-2 but
   not step-1 appears repeatedly.

(3) is *consistent with* the bugs below; with anonymous groups sharing one code we
cannot prove from the log how many devices each group used.

### Mechanism (verified 2026-09-22)

The checklist is not single-select; each tap POSTs one `{itemId, done}`. But
there are four ways a group's ticks diverge:

**A. Each device holds its own stale view.** The chat page refetches
`checklist-progress` only when *this device's* `isLoading` changes
(`page.tsx:577-593`, deps `[isLoading, activeChecklist.length, progressActivityId]`).
A groupmate's turn, the AI tick made during it, or a groupmate's tap does not
refresh it. `ProgressChecklist.toggle` then pushes a **full replacement**
snapshot built from that stale view (`ProgressChecklist.tsx:183`) — device B,
which never saw step-1, pushes `done=['step-2']` over A's `['step-1']`.

**B. Tapping an AI tick deletes it.** The docs say a tap "hands the step back to
the student"; the code does `becomingDone = !doneFor(id)` → `done=false`. The
evidence lives in a tooltip, so a curious tap on *"markeret af AI"* un-ticks it.

**C. Lost update in the store.** `record_item_state`
(`db/checklist_progress.py:74-104`) reads the whole `itemStates` map, changes one
key, and writes the whole map back with `merge=True` — no transaction. A tutor
mark racing a student POST (or two devices) re-writes the other item's stale value.

**D. The prompt sees two checklists.** The tutor's tool writes only the store;
the client snapshot (`mcp_app_context.progress`) is still rendered into every
prompt by `render_instruction_with_iframe_context` (`iframe_context.py:107-120`).
`element_state.py:82-87` already excludes that mirror *because* it contradicts
the store after an AI tick — but the iframe block does not. Straight after an AI
tick the model reads "step-2 done by AI" and `progress.done=[]` in one prompt.
Add that the manifest lists labels without ids (`element_manifest.py:62-65`) and
the generic block calls ticked items *"what the user has SET"*, and the "I
marked it / you can mark it" inconsistency is the prompt's, not the model's.

**On (1):** the tool's docstring already says mark only on real evidence. Upload
steps map to `NoFillChannel` elements, so the empty-element guard never fires, and
nothing reads a compound label ("uploadet **og** revideret") as two conditions.

## Goals

1. Every device in a group, and the tutor, see the same checklist within one turn.
2. No tick is lost to a race or removed by a curious tap.
3. The prompt has one checklist, from the store.
4. The rule for who ticks is stated — in the tool, the prompt and the footer — and
   is a teacher's choice.

## Design

### M0 — one store, fresh everywhere (~0.5d) · P1

- `record_item_state`: `update({f"itemStates.{item_id}": entry, "updatedAt": now})`
  (field-path write), or a transaction. Test: two concurrent writes to different
  items both survive.
- Refetch on `groupRevision` change and at the end of any group turn (add to the
  deps at `page.tsx:593`); use the POST response's `itemStates` directly.
- The snapshot push becomes a **delta** event for the log and the proactive
  `step_advance` trigger, not a replacement of shared state.

### M1 — one checklist in the prompt (~0.3d) · P1

Skip `mcp_app_context.progress.*` in `render_instruction_with_iframe_context`; the
inherited-progress block (from the store) is the checklist. Put item ids in the
element manifest so the tool is callable without a `list_checklist` round-trip.

### M2 — a tap on an AI tick shows why (~0.3d) · P1

First tap on an AI tick opens the evidence with two actions: *Bekræft* (flips
`by` to `student`, keeps `done`) and *Fjern*. Copy in a `copy` object (content-localisation M4).

### M3 — the marking rule, and a teacher control (~0.5–0.75d) · P2, needs JB

`ActivityConfig.checklist_marking ∈ { "ai" | "ai_suggests" | "student" }`:

| Mode | Tutor | Footer copy |
|---|---|---|
| `ai` (today) | may tick with evidence | "AI'en kan markere trin…" |
| `ai_suggests` | proposes a tick as a card; a student confirms | "AI'en foreslår — I bekræfter" |
| `student` | never ticks; may say "I kan krydse af" | "I krydser selv af" |

`build_checklist_tools` is gated on it. In every mode the docstring gains:
*a step whose label joins conditions ("uploadet og revideret") is done only when
each is met; never tick in a reply that says a condition is unmet.*
Optional soft order check: warn when earlier steps are open.

**Default for new activities:** leave it `ai` until JB answers the open question —
the 2026-08-06 decision ("the AI helps auto-grade") stands until revisited.

## Open questions

1. **For JB:** with 1st-years, should the tutor tick at all? Today's session
   suggests students treat the tick as the tutor's verdict — which is the point
   of `ai`, and the risk of it.
2. Is the checklist a group artefact (one per group, as the store assumes) or
   per device? M0 assumes group; confirm with how teachers run groups on
   multiple laptops.
