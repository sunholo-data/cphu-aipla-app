"""Element FILL-STATE — tell the tutor what is *in* the student's tools (1.1.69 M1+M2).

**The bug this fixes.** ``element_manifest.describe_elements`` told the tutor
that a data table exists. Nothing told it whether the table has anything in it.
The manifest says so in as many words:

    The student's current entries are not shown here; you receive them as they work.

That was correct reasoning — the manifest is composed once per agent build and
baking values in would go stale — but the "as they work" half only fires on
*interaction*. ``useSimSnapshotPush`` POSTs to ``/api/sessions/{id}/iframe-context``
when a student edits a cell. A student who never touches the table writes no
``mcp_app_context.table.state`` at all, so the tutor does not observe an empty
table: it observes **nothing**, which is indistinguishable from *there is no
table*.

Aswin, 2026-08-10: *"When it told me to fill out and I said 'done' without
filling out the data, it did not recognize the data empty and continued
chatting."* Confirmed in the dev logs for ``sweet-bison-13`` — every
``iframe_context: write`` in that window is ``server=progress``; not one
``server=table``.

**The core decision: absence is reported positively.** Three states, where the
tutor previously saw two of them collapsed into one:

===================  ==========================  ===============================
                     Before                      After
===================  ==========================  ===============================
Element untouched    *(nothing in context)*      ``EMPTY (0 of 15 cells)``
Element part-filled  live snapshot               ``PARTIAL — 3 of 15 cells``
No such element      *(nothing in context)*      *(nothing — correct)*
===================  ==========================  ===============================

The synthesis is **server-side** (option (2) in the design doc): the block walks
the authored ``ActivityConfig`` and reports ``EMPTY`` for any fillable element
with no state entry. Client-side seeding was the alternative and loses to a
student who never opens the workbench tab.

**Registry-driven, and every kind makes a positive decision.** Like the
manifest, this iterates ``ELEMENT_REGISTRY`` rather than an ``if cfg.table:``
chain — four element kinds went invisible for six weeks the last time a per-kind
chain was the mechanism. But *unlike* the manifest, the safe default here is
**silence, not a generic line**: a fabricated ``EMPTY`` for a kind whose fill
state we cannot observe is worse than saying nothing, because it re-creates the
exact unknown/empty conflation this module exists to remove. So every registered
kind must appear in ``_READERS`` as either a reader or an explicit
``NoFillChannel(reason=...)``, and ``test_every_element_kind_declares_a_fill_reader``
fails on a kind that appears as neither.

**Which kinds have an observable fill channel** (checked against the frontend on
2026-08-10, answering the design doc's Open Question 2 — whose guess was *"almost
certainly [the same gap]"* and is wrong):

* ``table``, ``calculator`` — yes. Both push ``mcp_app_context.{kind}.state``
  through ``useSimSnapshotPush`` with a shape carrying the filled counts.
* ``checklist`` — has state, but its authority is the Firestore store
  (``db/checklist_progress.py``), read fresh by ``list_checklist()`` and by the
  inherited-progress block (1.1.70 M1). The ``mcp_app_context.progress.state``
  entry is a client MIRROR of that store, and a third view of the same facts is
  a contradiction waiting for the first AI tick that lands before the client
  re-pushes. Deliberately not read here.
* ``solution``, ``document`` — **no fill channel, and no gap either.** A
  solution is submitted as a multimodal chat turn
  (``SolutionElementMount`` → ``onProactiveTrigger``) and an uploaded document
  reaches the tutor through the artifact loader/injector. The tutor sees both in
  the conversation. Synthesising ``EMPTY`` for them would be *false* the moment
  a student submits — the conflation inverted.
* ``chart``, ``note``, ``conceptMap`` — not student-fillable. A chart derives
  from the table, a note is reference text, and concept-map progress is the
  checkpoint store.

**Per TURN, not per build.** ``describe_element_state`` is applied by
``make_element_state_wrapper`` as an ADK ``InstructionProvider``, so it is
recomposed against the live session state on every turn. Composing it once and
baking the string would reintroduce precisely the staleness the manifest
deliberately avoided by omitting values — see
``test_the_block_changes_between_turns``.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from google.adk.agents.readonly_context import ReadonlyContext

from db.models.activity_config import ELEMENT_REGISTRY, ActivityConfig, ElementSpec

log = logging.getLogger(__name__)

# This block's share of the per-turn prompt budget. Smaller than the manifest's
# 2,000 because it is strictly *narrower*: the manifest carries column labels,
# units and task prompts, while a state line is a title and two numbers. Five
# tables and five calculators — the model's maximum — compose ~600 chars.
# See test_element_state_block_is_bounded.
ELEMENT_STATE_CHAR_CAP = 1200

# The namespace the iframe-context route writes under. Must match
# ``adk/iframe_context.py::_NAMESPACE_PREFIX``; anchored separately here so a
# rename fails the test rather than silently reporting everything EMPTY.
_NAMESPACE_PREFIX = "mcp_app_context."

# Default tool name in ``useSimSnapshotPush(sessionId, serverId, toolName="state")``.
_DEFAULT_TOOL = "state"

_HEADER = (
    "Workbench state right now — computed on the server from what the student has actually "
    "entered, refreshed every turn:"
)

_FOOTER = (
    "This is evidence, not a guess: an element marked EMPTY here has nothing in it. If a student "
    "says they have finished something that is EMPTY above, they have not done it yet — ask them "
    "to fill it in rather than agreeing, and do not mark the step done."
)


@dataclass(frozen=True)
class NoFillChannel:
    """A registered element kind that deliberately reports no fill state.

    ``reason`` is required and is read by humans, not the model: it is the
    positive decision that keeps a new element kind from defaulting into silence
    without anyone noticing.
    """

    reason: str


@dataclass(frozen=True)
class ElementFill:
    """One element's observed fill state.

    The single source of truth for "how full is this?" — the prompt block below
    formats it, and ``mark_checklist_item`` (1.1.69 M3) refuses against it. Two
    ways of counting the same cells would diverge, and the half that drifted
    would be the one deciding whether a student's work gets marked.
    """

    kind: str
    element_id: str
    title: str
    filled: int
    total: int
    # One short trailing clause a reader may add when the element carries a
    # fact beyond its counts (a calculator's computed result). Never load-bearing
    # for the refusal in M3 — that reads counts only.
    detail: str = ""

    @property
    def status(self) -> str:
        if self.total <= 0:
            return "UNKNOWN"
        if self.filled <= 0:
            return "EMPTY"
        if self.filled >= self.total:
            return "COMPLETE"
        return "PARTIAL"

    @property
    def is_demonstrably_empty(self) -> bool:
        """True only when we positively observed nothing in a real element.

        ``total <= 0`` is a mis-authored element (no rows, no inputs) and reads
        UNKNOWN, never empty — refusing a mark on it would punish a student for
        the teacher's typo.
        """
        return self.total > 0 and self.filled <= 0


def _entry(state: dict[str, Any], server: str, tool: str = _DEFAULT_TOOL) -> dict[str, Any] | None:
    """The structured content pushed under ``mcp_app_context.{server}.{tool}``.

    The route stores ``{"structuredContent": {...}, "_pushedAt": ...}``; older
    rows (and tests that write the state directly) may hold the content itself.
    Accept both rather than reporting a filled element as EMPTY on a shape
    mismatch — an over-report of emptiness is the one error mode this module
    must not have.
    """
    raw = state.get(f"{_NAMESPACE_PREFIX}{server}.{tool}")
    if not isinstance(raw, dict):
        return None
    inner = raw.get("structuredContent")
    if isinstance(inner, dict):
        return inner
    return raw


def _read_table(items: list, spec: ElementSpec, state: dict[str, Any]) -> list[ElementFill]:
    """One reading per authored table: filled cells against the authored capacity.

    ``TableSnapshot`` (frontend ``WorkbenchTable.tsx``) carries ``tableId``,
    ``filledCells`` and the ``data`` grid. Only ONE table's snapshot can be live
    at a time — every table pushes to the same ``table.state`` key, which is the
    stable-id problem 1.1.71 exists to fix. Until then a snapshot is matched by
    ``tableId`` and any *other* authored table reports EMPTY, which is right far
    more often than it is wrong: a student working a second table has by
    definition touched it, so its snapshot is the live one.
    """
    snap = _entry(state, "table")
    fills = []
    for tbl in items:
        columns = getattr(tbl, "columns", []) or []
        total = int(getattr(tbl, "rows", 0) or 0) * len(columns)
        filled = 0
        if snap is not None and str(snap.get("tableId") or "") == str(getattr(tbl, "id", "")):
            raw = snap.get("filledCells")
            if isinstance(raw, int):
                filled = raw
            else:
                # Fall back to counting the grid — the snapshot is authoritative
                # about its own contents even when the count field is missing.
                filled = sum(
                    1
                    for row in (snap.get("data") or [])
                    if isinstance(row, dict)
                    for v in row.values()
                    if str(v).strip()
                )
        fills.append(
            ElementFill(
                kind="table",
                element_id=str(getattr(tbl, "id", "")),
                title=getattr(tbl, "title", "") or "untitled",
                filled=filled,
                total=total,
            )
        )
    return fills


def _read_calculator(items: list, spec: ElementSpec, state: dict[str, Any]) -> list[ElementFill]:
    """One reading per authored calculator: how many inputs the student entered.

    ``CalcSnapshot`` (frontend ``WorkbenchCalculator.tsx``) pushes EVERY
    calculator on the activity in one array, so — unlike the table — each is
    matched by its own id and a missing entry is a true EMPTY.
    """
    snap = _entry(state, "calculator")
    by_id: dict[str, dict[str, Any]] = {}
    if snap is not None:
        for c in snap.get("calculators") or []:
            if isinstance(c, dict) and c.get("id"):
                by_id[str(c["id"])] = c
    fills = []
    for calc in items:
        inputs = getattr(calc, "inputs", []) or []
        pushed = by_id.get(str(getattr(calc, "id", "")))
        filled = 0
        result = None
        if pushed is not None:
            filled = sum(1 for i in pushed.get("inputs") or [] if str(i.get("value", "")).strip())
            result = pushed.get("result")
        fills.append(
            ElementFill(
                kind="calculator",
                element_id=str(getattr(calc, "id", "")),
                title=getattr(calc, "title", "") or "untitled",
                filled=filled,
                total=len(inputs),
                detail=f"result {result}" if result not in (None, "") else "",
            )
        )
    return fills


def _read_writing(items: list, spec: ElementSpec, state: dict[str, Any]) -> list[ElementFill]:
    """One reading per authored writing surface: how much the student has written.

    ``WritingSnapshot`` (frontend ``WorkbenchWriting.tsx``) is deliberately
    shaped like ``CalcSnapshot`` and NOT like ``TableSnapshot``: every writing
    element on the activity is pushed in ONE array under ``writing.state``, each
    matched by its own id, so a missing entry is a true EMPTY. The table's
    one-snapshot-per-key shape is the defect 1.1.71 exists to fix, and the cap
    here is 3 from day one — copying it would have shipped the same bug twice.

    **The total is a word target, not a capacity.** An element with no
    ``min_words`` has no natural denominator, and ``total <= 0`` renders UNKNOWN
    ("nothing authored to fill in") — which would mean the M3 refusal never
    fires on precisely the element where "I've written it" is the most tempting
    untrue claim. So an untargeted surface gets a nominal total of 1: zero words
    is then demonstrably EMPTY, and any writing at all reads COMPLETE. ``_line``
    formats writing separately so the prose never says "0 of 1 words".

    A student returning in a NEW session has no push yet — the client's
    ``writing.sync`` catch-up fires on session bootstrap and self-heals it on the
    first turn, the same way the table does.
    """
    snap = _entry(state, "writing")
    by_id: dict[str, dict[str, Any]] = {}
    if snap is not None:
        for d in snap.get("docs") or []:
            if isinstance(d, dict) and d.get("id"):
                by_id[str(d["id"])] = d
    fills = []
    for w in items:
        target = int(getattr(w, "min_words", 0) or 0)
        pushed = by_id.get(str(getattr(w, "id", "")))
        words = 0
        if pushed is not None:
            raw = pushed.get("words")
            words = raw if isinstance(raw, int) else 0
        fills.append(
            ElementFill(
                kind="writing",
                element_id=str(getattr(w, "id", "")),
                title=getattr(w, "title", "") or "untitled",
                filled=words,
                total=target or 1,
                detail=f"target {target} words" if target else "",
            )
        )
    return fills


# Every kind in ``ELEMENT_REGISTRY`` must appear here: a reader, or an explicit
# NoFillChannel saying why silence is correct for it. See the module docstring
# for how each of these was checked against the frontend.
_READERS: dict[str, Callable[[list, ElementSpec, dict[str, Any]], list[ElementFill]] | NoFillChannel] = {
    "table": _read_table,
    "calculator": _read_calculator,
    "writing": _read_writing,
    "checklist": NoFillChannel(
        reason=(
            "authoritative state is the checklist_progress store, surfaced by list_checklist() "
            "and the inherited-progress block (1.1.70 M1). mcp_app_context.progress.state is a "
            "client mirror of it and would contradict the store after an AI tick."
        )
    ),
    "solution": NoFillChannel(
        reason=(
            "submitted as a multimodal chat turn (SolutionElementMount -> onProactiveTrigger), "
            "so the tutor sees the work in the conversation. There is no mcp_app_context entry to "
            "read, and synthesising EMPTY would be FALSE the moment a student submits."
        )
    ),
    "document": NoFillChannel(
        reason=(
            "uploaded files reach the tutor through the artifact loader/injector and document_ids, "
            "not iframe-context. Same false-EMPTY risk as solution."
        )
    ),
    "chart": NoFillChannel(reason="derived from the data table; the table's own line already reports the fill state"),
    "note": NoFillChannel(reason="teacher-authored reference text — the student does not fill it in"),
    "conceptMap": NoFillChannel(reason="progress is the concept_progress checkpoint store, not a fillable surface"),
}


def read_element_fills(cfg: ActivityConfig | None, state: dict[str, Any] | None) -> list[ElementFill]:
    """Every authored element with an observable fill channel, with its counts.

    The shared primitive: ``describe_element_state`` formats these for the
    prompt and ``mark_checklist_item`` refuses against them.
    """
    if cfg is None:
        return []

    state = state or {}
    fills: list[ElementFill] = []

    for kind, spec in ELEMENT_REGISTRY.items():
        items = getattr(cfg, spec.field, None) or []
        if not items:
            continue
        reader = _READERS.get(kind)
        if reader is None or isinstance(reader, NoFillChannel):
            # Unregistered kinds land here too. Silence is the safe default —
            # see the module docstring; the registry test is what catches it.
            continue
        try:
            fills.extend(reader(items, spec, state))
        except Exception:  # pragma: no cover — a reader must never break a turn
            log.exception("element fill reader failed for kind=%s — omitting its state", kind)

    return fills


_NOUNS = {"table": "Data table", "calculator": "Calculator", "writing": "Writing surface"}
_UNITS = {"table": "cells filled", "calculator": "inputs entered"}


def _line(fill: ElementFill) -> str:
    noun = _NOUNS.get(fill.kind, fill.kind)
    if fill.kind == "writing":
        # Writing counts words against a TARGET, not cells against a capacity,
        # and an untargeted surface carries a nominal total of 1 (see
        # _read_writing). Rendering it through the generic "N of M" would print
        # "0 of 1 words", which is technically true and useless. The status word
        # is unchanged, so the M3 refusal reads this line the same way.
        if fill.filled <= 0:
            return f'{noun} "{fill.title}": EMPTY — the student has written nothing'
        body = f"{fill.filled} words written"
        if fill.detail:
            body += f" ({fill.detail})"
        return f'{noun} "{fill.title}": {fill.status} — {body}'
    if fill.total <= 0:
        return f'{noun} "{fill.title}": UNKNOWN — nothing authored to fill in'
    body = f"{fill.filled} of {fill.total} {_UNITS.get(fill.kind, 'filled')}"
    if fill.detail:
        body += f", {fill.detail}"
    return f'{noun} "{fill.title}": {fill.status} — {body}'


def describe_element_state(cfg: ActivityConfig | None, state: dict[str, Any] | None) -> str:
    """Compose the per-turn fill-state block.

    Args:
        cfg: the resolved activity. ``None`` (chat-only, or nothing authored)
            composes exactly as before this module existed.
        state: the ADK session state, read for ``mcp_app_context.*`` entries.
            An empty dict is the *normal* first-turn case and is what produces
            the ``EMPTY`` synthesis — it must never be treated as "unknown".

    Returns:
        The block, or ``""`` when the activity authors no element with an
        observable fill channel.
    """
    lines = [_line(f) for f in read_element_fills(cfg, state)]
    if not lines:
        return ""

    body, dropped = _fit(lines, budget=ELEMENT_STATE_CHAR_CAP - len(_HEADER) - len(_FOOTER) - 4)
    if dropped:
        body.append(f"(+{dropped} more)")

    return "\n".join([_HEADER, *body, "", _FOOTER])


def _fit(lines: list[str], *, budget: int) -> tuple[list[str], int]:
    """Take as many whole lines as fit; report how many were dropped.

    Item-wise, like the manifest: the header and footer are always kept, because
    a list of counts with no instruction about what to do with them is the
    feature silently failing on exactly the largest activities.
    """
    kept: list[str] = []
    used = 0
    for i, line in enumerate(lines):
        cost = len(line) + 1
        if used + cost > budget:
            return kept, len(lines) - i
        kept.append(line)
        used += cost
    return kept, 0


# --- Step -> element association (1.1.69 M3) ------------------------------
#
# The design doc left this open between (a) infer from the step label, (b) an
# explicit ``elementId`` on ``ChecklistItem``, and (c) let the model say which
# element it checked. (b) is the right long-term answer and needs an authoring
# UI; (c) hands the model the ability to talk its own way past the check, which
# defeats the point. So: (a), and (b) later without re-authoring anything.
#
# **This inference FAILS OPEN by construction.** No confident association means
# the mark is allowed. A refusal the student cannot understand or act on — "you
# didn't fill in the table" when the step was never about a table — is worse
# than the status quo it replaces, because the student has no way to proceed.

# Kind nouns that are unambiguous enough to associate on when the activity has
# exactly ONE element of that kind. Danish first — the pilot is Danish.
#
# Deliberately NOT here: "beregn" / "udregn" for the calculator. Those are the
# ordinary Danish verbs for "calculate", so "Beregn gennemsnittet" is a TASK
# and not a reference to the calculator element — and a wrong match there
# refuses a mark for work the student may well have done on paper. Calculators
# associate by title only.
_KIND_NOUNS: dict[str, tuple[str, ...]] = {
    "table": ("tabel", "table", "datatabel"),
}


def _normalise(text: str) -> str:
    return " ".join((text or "").lower().split())


def find_empty_element_for_step(
    cfg: ActivityConfig | None,
    step_label: str,
    state: dict[str, Any] | None,
) -> ElementFill | None:
    """The element a step is about, when it is confidently associated AND empty.

    Returns ``None`` — allow the mark — for every uncertain case: no elements,
    no association, an element that has data, or one whose capacity we cannot
    read.
    """
    fills = read_element_fills(cfg, state)
    if not fills:
        return None

    label = _normalise(step_label)
    if not label:
        return None

    # 1. The step names the element. Strongest signal, and the only one that
    #    works when an activity has several elements of the same kind.
    #    Two-character titles ("A", "T1") match far too much prose to trust.
    for fill in fills:
        title = _normalise(fill.title)
        if len(title) >= 3 and title in label:
            return fill if fill.is_demonstrably_empty else None

    # 2. The step names the KIND and the activity has exactly one of them, so
    #    "Udfyld tabellen" can only mean that table.
    by_kind: dict[str, list[ElementFill]] = {}
    for fill in fills:
        by_kind.setdefault(fill.kind, []).append(fill)
    for kind, nouns in _KIND_NOUNS.items():
        candidates = by_kind.get(kind, [])
        if len(candidates) != 1:
            continue
        if any(noun in label for noun in nouns):
            return candidates[0] if candidates[0].is_demonstrably_empty else None

    return None


def refusal_for(fill: ElementFill) -> str:
    """The correctable reason handed back to the model on a refused mark.

    States the observation, what to do instead, and why — the same posture as
    the empty-evidence refusal already shipped. A bare "refused" leaves the
    model to guess, and it guesses by trying again.
    """
    noun = "data table" if fill.kind == "table" else fill.kind
    unit = _UNITS.get(fill.kind, "entries")
    return (
        f'the {noun} "{fill.title}" is empty — the student has {fill.filled} of {fill.total} {unit}. '
        "Ask them to fill it in and tell you what they found, then mark the step once you have seen "
        "the substance. Do not mark it on their say-so alone."
    )


def make_element_state_wrapper(
    cfg: ActivityConfig | None,
) -> Callable[[str | Callable[[ReadonlyContext], Awaitable[str]]], Callable[[ReadonlyContext], Awaitable[str]]]:
    """An ``InstructionProvider`` wrapper for ``compose_instruction_providers``.

    Captures the resolved activity (fixed for the session) and reads the session
    state fresh on every turn — the whole point of being a provider rather than
    a build-time string.

    Returns a wrapper accepting either a base string or an upstream provider, so
    it chains beside ``wrap_with_iframe_context`` without re-ordering anything.
    """

    def _wrapper(
        base: str | Callable[[ReadonlyContext], Awaitable[str]],
    ) -> Callable[[ReadonlyContext], Awaitable[str]]:
        async def _provider(ctx: ReadonlyContext) -> str:
            base_text = await base(ctx) if callable(base) else base
            block = describe_element_state(cfg, dict(ctx.state) if ctx.state else {})
            if not block:
                return base_text
            return f"{base_text.rstrip()}\n\n{block}"

        return _provider

    return _wrapper


__all__ = [
    "ELEMENT_STATE_CHAR_CAP",
    "ElementFill",
    "NoFillChannel",
    "describe_element_state",
    "find_empty_element_for_step",
    "make_element_state_wrapper",
    "read_element_fills",
    "refusal_for",
]
