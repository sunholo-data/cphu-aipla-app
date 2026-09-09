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

* ``table`` — yes, and since 2026-09-09 it is read from the DURABLE GROUP STORE
  (``db/table_progress.py``), not from the client's pushed mirror. 1.1.88 made
  that store the source of truth for the student's grid and migrated the client
  onto it, but left this reader on ``mcp_app_context.table.state`` — so the
  tutor's view of the table was still whatever some browser had last POSTed.
  Three ways that showed up in the 2026-09-09 pilot logs, all now closed:

  - **The commit race.** A cell pushes on blur. A student who types a reading
    into chat before tabbing out gets a tutor turn built from the state *before*
    the entry — visible in ``busy-garden-11`` on 7 Sep, where the tutor asked
    for values it already had ~13 s later.
  - **The unopened tab.** The catch-up push in ``WorkbenchTable`` fires on
    ``sessionId`` arrival, so it needs the component MOUNTED. A student who
    never opens the workbench tab this session leaves the mirror empty, and an
    empty mirror renders ``EMPTY`` — a false negative the ``_FOOTER`` then tells
    the tutor to act on, and which ``mark_checklist_item`` refuses against.
  - **No values, ever.** The mirror carried them but this block never did; only
    the raw ``iframe_context`` dump did, and only when a push had landed.

  The store is read fresh per turn, so none of the three depends on client
  timing any more. The mirror stays as the FALLBACK for a table the store has
  nothing for — pre-1.1.88 sessions, and any store read that fails — because
  over-reporting emptiness is the one error mode this module must not have.
* ``calculator`` — yes, still the pushed mirror: it has no server-side store to
  read (its inputs are session state, not group state). ``CalcSnapshot`` is
  ARRAY-shaped (every calculator in one push, matched by id), so a missing
  entry is a true EMPTY. It inherits the commit race the table no longer has;
  giving it a store is the same shape of work as 1.1.88 was for the table.
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

# This block's share of the per-turn prompt budget. It was 1,200 while a state
# line was "a title and two numbers"; table lines now carry the student's actual
# READINGS, which is the whole point of reading the store rather than a count of
# it — a tutor that knows 5 of 25 cells are full still cannot say "your third
# trial gives 91 cm". Five tables at the per-table preview cap below is the
# worst case and lands under this. See test_element_state_block_is_bounded.
ELEMENT_STATE_CHAR_CAP = 3000

# Per-table ceiling on the rendered values. A 50-row x 8-column table is 400
# cells and would eat the whole block on its own, starving every other element's
# line — ``_fit`` drops WHOLE lines, so one unbounded line is one element
# silently taking the budget from all the others. Truncation is per-row and
# announced ("+N more rows"), never silent.
TABLE_VALUES_CHAR_CAP = 400

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
    # The student's actual entered values, already formatted and capped by the
    # reader that produced them. Separate from ``detail`` so the refusal path
    # keeps reading counts ONLY: what a student wrote must never become an input
    # to whether their step gets marked, or the tutor is grading content through
    # a mechanism built to check presence.
    values: str = ""

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


@dataclass(frozen=True)
class FillSources:
    """Everything a reader may consult for one turn.

    ``state`` is the per-session client MIRROR (the ``mcp_app_context.*`` keys a
    browser POSTs). ``table_cells`` is the durable GROUP STORE
    (``table_progress/{group}:{activity}``), read fresh every turn and keyed
    ``{table_id}::{row}::{col_id}``.

    ``None`` and ``{}`` mean different things and the distinction is the whole
    safety property: ``None`` is "the store could not be consulted" (no group, a
    failed read) and falls back to the mirror; ``{}`` is "the store answered,
    nothing is entered" and is a real EMPTY. Collapsing them is the shape of the
    2026-08-13 ``deploy-status`` bug, where a read failure and a real value
    landed in the same bucket and the reassuring answer won.
    """

    state: dict[str, Any]
    table_cells: dict[str, str] | None = None


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


def _grids_by_id(snap: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Every pushed table grid, keyed by ``tableId``.

    Accepts BOTH shapes, on purpose:

    * ``{"tables": [ {...}, {...} ]}`` — the shape since 1.1.88 M2, matching the
      calculator and writing elements ("EVERY element in one array, matched by
      id"). Every authored table reports its own fill.
    * ``{"tableId": ..., "filledCells": ..., "data": [...]}`` — the single-slot
      shape before it. Every table shared one ``table.state`` key, so any table
      the student was not currently editing reported EMPTY. Sessions that were
      live at deploy time still hold this in their state and must keep reading
      correctly rather than going blank mid-lesson; a new push replaces it.
    """
    if not isinstance(snap, dict):
        return {}
    tables = snap.get("tables")
    if isinstance(tables, list):
        return {str(g.get("tableId") or ""): g for g in tables if isinstance(g, dict)}
    if snap.get("tableId") is not None:
        return {str(snap.get("tableId") or ""): snap}
    return {}


def _cells_from_grid(grid: dict[str, Any] | None) -> dict[tuple[int, str], str]:
    """The client mirror's grid as ``{(row, col_id): value}``, blanks dropped."""
    out: dict[tuple[int, str], str] = {}
    if not isinstance(grid, dict):
        return out
    for r, row in enumerate(grid.get("data") or []):
        if not isinstance(row, dict):
            continue
        for col_id, value in row.items():
            text = str(value).strip()
            if text:
                out[(r, str(col_id))] = text
    return out


def _cells_from_store(cells: dict[str, str] | None, table_id: str) -> dict[tuple[int, str], str]:
    """One table's slice of the group store, keyed the same as the mirror.

    Store keys are ``{table_id}::{row}::{col_id}`` — the addressing the client
    has always used, unchanged by 1.1.88. A key that does not parse is skipped
    rather than guessed at: a mis-keyed cell counted into the wrong table is a
    wrong number in a prompt, which is worse than one missing cell.
    """
    out: dict[tuple[int, str], str] = {}
    if not cells or not table_id:
        return out
    prefix = f"{table_id}::"
    for key, value in cells.items():
        if not key.startswith(prefix):
            continue
        row_s, sep, col_id = key[len(prefix) :].partition("::")
        if not sep or not col_id:
            continue
        try:
            row = int(row_s)
        except ValueError:
            continue
        text = str(value).strip()
        if text:
            out[(row, col_id)] = text
    return out


def _format_table_values(
    cells: dict[tuple[int, str], str],
    columns: list,
) -> str:
    """The entered readings as prose the tutor can quote back, row by row.

    Column LABELS and units, not ids: ``Forsøg 1=92 cm`` is quotable to a student
    and ``col-k3=92`` is not. Rows are 1-based here for the same reason — the
    student is looking at a grid whose first row is row 1.
    """
    if not cells:
        return ""
    labels = {
        str(getattr(c, "id", "")): (
            f"{getattr(c, 'label', '') or getattr(c, 'id', '')}"
            + (f" ({getattr(c, 'unit', '')})" if getattr(c, "unit", "") else "")
        )
        for c in columns
    }
    order = {str(getattr(c, "id", "")): i for i, c in enumerate(columns)}
    by_row: dict[int, list[tuple[int, str, str]]] = {}
    for (row, col_id), value in cells.items():
        by_row.setdefault(row, []).append((order.get(col_id, 99), labels.get(col_id, col_id), value))

    rendered: list[str] = []
    used = 0
    for row in sorted(by_row):
        pairs = ", ".join(f"{label}={value}" for _, label, value in sorted(by_row[row]))
        line = f"row {row + 1}: {pairs}"
        if used + len(line) + 2 > TABLE_VALUES_CHAR_CAP:
            return "; ".join([*rendered, f"+{len(by_row) - len(rendered)} more rows"])
        rendered.append(line)
        used += len(line) + 2
    return "; ".join(rendered)


def _read_table(items: list, spec: ElementSpec, src: FillSources) -> list[ElementFill]:
    """One reading per authored table: what the group has entered, and how much.

    **Reads the durable group store, falls back to the client mirror.** See the
    module docstring for the three failures the mirror-only read produced. The
    store is authoritative when it holds anything for this table — ``record_cells``
    DELETES a cleared cell rather than storing ``""``, so "the store has cells for
    this table" and "these are all of them" are the same statement. When it holds
    nothing, the mirror still answers: a live pre-1.1.88 session, or a store read
    that failed, must not read as EMPTY.

    Each mirror grid (frontend ``WorkbenchTable.tsx``) carries ``tableId``,
    ``filledCells`` and the ``data`` grid, and since 1.1.88 M2 they arrive as an
    ARRAY covering every table on the activity — so a second table is no longer
    reported EMPTY merely because the student is editing the first. That was the
    stable-id problem 1.1.71 named, and it is fixed here rather than deferred:
    the shared slot was session state, never stored student data, so there was no
    migration behind it.
    """
    state = src.state
    grids = _grids_by_id(_entry(state, "table"))
    # 1.1.71 — with several tables authored, the title is the only thing that
    # tells them apart in the tutor's block, and an untitled one falls back to
    # "untitled". Three of those produce three identical lines
    # (`Data table "untitled": EMPTY`), which is worse than useless: the tutor
    # cannot say which table it means and neither can the student reading its
    # reply. Disambiguate by position when a title is missing or shared.
    raw_titles = [(getattr(t, "title", "") or "").strip() for t in items]
    seen: dict[str, int] = {}
    for t in raw_titles:
        seen[t] = seen.get(t, 0) + 1
    titles = [
        t if (t and seen[t] == 1) else (f"{t} ({i + 1})" if t else f"untitled ({i + 1})")
        for i, t in enumerate(raw_titles)
    ]
    fills = []
    for idx, tbl in enumerate(items):
        table_id = str(getattr(tbl, "id", ""))
        columns = getattr(tbl, "columns", []) or []
        total = int(getattr(tbl, "rows", 0) or 0) * len(columns)

        stored = _cells_from_store(src.table_cells, table_id)
        cells = stored or _cells_from_grid(grids.get(table_id))
        filled = len(cells)

        # The mirror's own ``filledCells`` is the client's count of the same
        # grid. Trust it only when we are reading the mirror AND could not count
        # the grid ourselves (a snapshot carrying the count but not the data),
        # never over a store answer.
        if not stored and not cells:
            raw = (grids.get(table_id) or {}).get("filledCells")
            if isinstance(raw, int):
                filled = raw

        fills.append(
            ElementFill(
                kind="table",
                element_id=table_id,
                title=titles[idx],
                filled=filled,
                total=total,
                values=_format_table_values(cells, columns),
            )
        )
    return fills


def _read_calculator(items: list, spec: ElementSpec, src: FillSources) -> list[ElementFill]:
    """One reading per authored calculator: how many inputs the student entered.

    ``CalcSnapshot`` (frontend ``WorkbenchCalculator.tsx``) pushes EVERY
    calculator on the activity in one array, so — unlike the table — each is
    matched by its own id and a missing entry is a true EMPTY.
    """
    snap = _entry(src.state, "calculator")
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


def _read_writing(items: list, spec: ElementSpec, src: FillSources) -> list[ElementFill]:
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
    snap = _entry(src.state, "writing")
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
_READERS: dict[str, Callable[[list, ElementSpec, FillSources], list[ElementFill]] | NoFillChannel] = {
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


def read_element_fills(
    cfg: ActivityConfig | None,
    state: dict[str, Any] | None,
    *,
    table_cells: dict[str, str] | None = None,
) -> list[ElementFill]:
    """Every authored element with an observable fill channel, with its counts.

    The shared primitive: ``describe_element_state`` formats these for the
    prompt and ``mark_checklist_item`` refuses against them.

    ``table_cells`` is the group's durable table store. Both callers must pass
    it or they disagree about the same table: the prompt block would report the
    stored readings while the refusal read an empty mirror and blocked the mark
    for work the student had done. Defaulting it to ``None`` keeps every
    existing test honest — they exercise the mirror path, which is still live.
    """
    if cfg is None:
        return []

    src = FillSources(state=state or {}, table_cells=table_cells)
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
            fills.extend(reader(items, spec, src))
        except Exception:  # pragma: no cover — a reader must never break a turn
            log.exception("element fill reader failed for kind=%s — omitting its state", kind)

    return fills


_VALUES_OMITTED = "element(s) above show counts only — their entries did not fit this block"

_NOUNS = {"table": "Data table", "calculator": "Calculator", "writing": "Writing surface"}
_UNITS = {"table": "cells filled", "calculator": "inputs entered"}


def _line(fill: ElementFill, *, with_values: bool = True) -> str:
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
    # The readings themselves, when the reader could produce them. Last, and
    # after the counts, so a truncated line still ends having said how full the
    # element is — the half the refusal and the footer both depend on.
    if with_values and fill.values:
        body += f" — {fill.values}"
    return f'{noun} "{fill.title}": {fill.status} — {body}'


def describe_element_state(
    cfg: ActivityConfig | None,
    state: dict[str, Any] | None,
    *,
    table_cells: dict[str, str] | None = None,
) -> str:
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
    fills = read_element_fills(cfg, state, table_cells=table_cells)
    if not fills:
        return ""

    budget = ELEMENT_STATE_CHAR_CAP - len(_HEADER) - len(_FOOTER) - 4
    # Reserve room for the omission notice so adding it can never be what pushes
    # the block over the cap. Charged only when there are values to omit.
    if any(f.values for f in fills):
        budget -= len(_VALUES_OMITTED) + 8

    # Pass 1 — the COUNTS for every element, before any element gets its values.
    # Item-wise like the manifest. Dropping an element's line entirely loses its
    # EMPTY, which is the signal ``_FOOTER`` and ``mark_checklist_item`` act on;
    # dropping its values loses detail the tutor would like. Those are not the
    # same loss, so they are not competing for the same bytes: one long table's
    # readings must never cost another table its line.
    body, dropped = _fit([_line(f, with_values=False) for f in fills], budget=budget)
    used = sum(len(line) + 1 for line in body)

    # Pass 2 — spend what is left upgrading lines to carry the actual readings,
    # in authored order.
    omitted = 0
    for i, fill in enumerate(fills[: len(body)]):
        if not fill.values:
            continue
        rich = _line(fill)
        extra = len(rich) - len(body[i])
        if used + extra > budget:
            omitted += 1
            continue
        body[i] = rich
        used += extra

    if dropped:
        body.append(f"(+{dropped} more)")
    if omitted:
        # Said out loud: a tutor that quotes "your readings" from a line whose
        # values were silently dropped would be inventing them.
        body.append(f"({omitted} {_VALUES_OMITTED})")

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
    *,
    table_cells: dict[str, str] | None = None,
) -> ElementFill | None:
    """The element a step is about, when it is confidently associated AND empty.

    Returns ``None`` — allow the mark — for every uncertain case: no elements,
    no association, an element that has data, or one whose capacity we cannot
    read.
    """
    fills = read_element_fills(cfg, state, table_cells=table_cells)
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


def read_table_cells(group_id: str | None, activity_id: str | None) -> dict[str, str] | None:
    """The group's stored table cells, or ``None`` when the store cannot answer.

    The ``None``-vs-``{}`` distinction is load-bearing — see ``FillSources``. A
    missing group or activity id, or a Firestore read that raises, must NOT read
    as "the table is empty": that is the false EMPTY the store was wired in to
    remove, and it would arrive with the ``_FOOTER``'s instruction to act on it.

    Imported lazily so ``element_state`` stays importable without a Firestore
    client — the pure formatting half of this module is unit-tested that way.
    """
    if not group_id or not activity_id:
        return None
    try:
        from db.table_progress import get_cells

        return get_cells(group_id, activity_id)
    except Exception:
        log.exception(
            "table store unreadable for group=%s activity=%s — falling back to the client "
            "mirror rather than reporting the table EMPTY",
            group_id,
            activity_id,
        )
        return None


def make_element_state_wrapper(
    cfg: ActivityConfig | None,
    *,
    group_id: str | None = None,
    activity_id: str | None = None,
) -> Callable[[str | Callable[[ReadonlyContext], Awaitable[str]]], Callable[[ReadonlyContext], Awaitable[str]]]:
    """An ``InstructionProvider`` wrapper for ``compose_instruction_providers``.

    Captures the resolved activity (fixed for the session) and reads the session
    state fresh on every turn — the whole point of being a provider rather than
    a build-time string. Since 2026-09-09 it also re-reads the group's TABLE
    STORE per turn, for the same reason: a value the student entered eight
    seconds ago has to be in this turn's prompt, not the next one's.

    ``group_id``/``activity_id`` default to ``None`` so a caller that has no
    group (local mode, tests) degrades to the mirror-only behaviour rather than
    to a table that reads empty.

    Returns a wrapper accepting either a base string or an upstream provider, so
    it chains beside ``wrap_with_iframe_context`` without re-ordering anything.
    """

    def _wrapper(
        base: str | Callable[[ReadonlyContext], Awaitable[str]],
    ) -> Callable[[ReadonlyContext], Awaitable[str]]:
        async def _provider(ctx: ReadonlyContext) -> str:
            base_text = await base(ctx) if callable(base) else base
            block = describe_element_state(
                cfg,
                dict(ctx.state) if ctx.state else {},
                table_cells=read_table_cells(group_id, activity_id),
            )
            if not block:
                return base_text
            return f"{base_text.rstrip()}\n\n{block}"

        return _provider

    return _wrapper


__all__ = [
    "ELEMENT_STATE_CHAR_CAP",
    "TABLE_VALUES_CHAR_CAP",
    "ElementFill",
    "FillSources",
    "NoFillChannel",
    "describe_element_state",
    "find_empty_element_for_step",
    "make_element_state_wrapper",
    "read_element_fills",
    "read_table_cells",
    "refusal_for",
]
