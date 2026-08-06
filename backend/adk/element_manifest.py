"""Element manifest — tell the tutor what the student has in front of them (1.1.62 M1).

**The bug this fixes.** ``compose_teacher_focus`` stacked exactly four prompt
sources: the sim artefact's ``tutor_block``, the solution element, the concept
map, and the teaching goal. ``ELEMENT_REGISTRY`` has eight element kinds, and
``checklist`` / ``table`` / ``chart`` / ``calculator`` / ``note`` / ``document``
appeared in none of them. Nor did any student tutor template mention them —
``concept-dialogue/SKILL.md`` describes itself as the engine for
"teacher-authored no-workbench" activities.

The only path by which an element reached the tutor was ``useSimSnapshotPush``,
which POSTs to ``/api/sessions/{id}/iframe-context`` **when the student
interacts**. Before anyone touches anything, that state key is absent. So the
tutor could not invite a student to use a tool it had never been told about —
which is exactly what Aswin reported on 2026-08-06: *"The chat never asked me to
work on those tools."*

**The design decision: registry-driven, not per-kind.**

The manifest is built by iterating ``ELEMENT_REGISTRY`` and dispatching to a
per-kind describer, falling back to a generic line for a kind with no bespoke
describer. The obvious alternative — an ``if cfg.table: ... if cfg.chart: ...``
chain — is precisely what ``compose_teacher_focus`` did, and precisely why four
element kinds went silently invisible for six weeks when 1.1.38 added them.

Iterating the registry inverts the failure mode. A new element kind is visible
to the tutor **by default** and requires a positive decision to be hidden; the
worst case becomes a too-generic description rather than total invisibility.
``test_every_registered_element_kind_is_described`` enforces it.

**What the manifest does NOT contain.** Current student values. Those arrive
fresh over ``iframe-context`` on every turn, and this block is composed once per
session — baking them in would go stale. Same reasoning as living-concept-map,
which deliberately omits node statuses from its prompt block for this reason.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from db.models.activity_config import ELEMENT_REGISTRY, ActivityConfig, ElementSpec

log = logging.getLogger(__name__)

# The manifest's share of ``teacher_focus._TOTAL_FOCUS_CAP`` — the attention and
# per-turn cost budget for per-activity content. That budget is already shared by
# the sim tutor_block, the solution prompt, the concept map and the teaching goal
# (itself up to 2,000). 2,000 leaves the manifest a real voice without letting a
# 50-item checklist crowd out everything else.
MANIFEST_CHAR_CAP = 2000

_HEADER = (
    "This activity's workbench has the following tools. Refer to them by name and "
    "invite the student to use them when the conversation reaches them — do not wait "
    "to be asked."
)

_FOOTER = "The student's current entries are not shown here; you receive them as they work."


def _describe_checklist(items: list, spec: ElementSpec) -> list[str]:
    lines = ["Checklist — the steps the teacher set for this activity:"]
    lines.extend(f"  - {getattr(item, 'label', '')}" for item in items)
    return lines


def _describe_table(items: list, spec: ElementSpec) -> list[str]:
    lines = []
    for tbl in items:
        cols = ", ".join(
            f"{c.label} ({c.unit})" if getattr(c, "unit", "") else str(c.label) for c in getattr(tbl, "columns", [])
        )
        title = getattr(tbl, "title", "") or "untitled"
        rows = getattr(tbl, "rows", 0)
        lines.append(f'Data table "{title}" — columns: {cols}. {rows} empty rows for the student to fill in.')
    return lines


def _describe_chart(items: list, spec: ElementSpec) -> list[str]:
    # 1.1.64 adds optional per-chart axis binding; until then a chart auto-plots
    # the activity's data table. Read the axis fields defensively so this
    # describer keeps working either side of that change.
    lines = []
    for ch in items:
        title = getattr(ch, "title", "") or "untitled"
        kind = getattr(ch, "chart_kind", "scatter")
        x = getattr(ch, "x_column", None)
        y = getattr(ch, "y_column", None)
        if x and y:
            lines.append(f'Chart "{title}" ({kind}) — plots {x} against {y} from the data table.')
        else:
            lines.append(f'Chart "{title}" ({kind}) — plots the data table as the student fills it in.')
    return lines


def _describe_calculator(items: list, spec: ElementSpec) -> list[str]:
    lines = []
    for calc in items:
        inputs = ", ".join(
            f"{i.label} ({i.unit})" if getattr(i, "unit", "") else str(i.label) for i in getattr(calc, "inputs", [])
        )
        title = getattr(calc, "title", "") or "untitled"
        lines.append(f'Calculator "{title}" — inputs: {inputs}.')
    return lines


def _describe_note(items: list, spec: ElementSpec) -> list[str]:
    # Name it, never inline it: a note body runs to 4,000 characters and would
    # consume the whole manifest budget on its own.
    return [f'Note "{getattr(n, "title", "") or "untitled"}" — reference text the student can read.' for n in items]


def _describe_solution(items: list, spec: ElementSpec) -> list[str]:
    lines = []
    for sol in items:
        prompt = (getattr(sol, "prompt", "") or "").strip()
        lines.append(
            f"Solution editor — the student writes their answer here. Task: {prompt}"
            if prompt
            else "Solution editor — the student writes their worked answer here."
        )
    return lines


def _describe_document(items: list, spec: ElementSpec) -> list[str]:
    lines = []
    for doc in items:
        prompt = (getattr(doc, "prompt", "") or "").strip()
        lines.append(
            f"Document upload — the student uploads their own file. Task: {prompt}"
            if prompt
            else "Document upload — the student uploads their own file for you to read."
        )
    return lines


def _describe_concept_map(items: list, spec: ElementSpec) -> list[str]:
    # The concept map already has a dedicated, richer block in
    # compose_teacher_focus (nodes, prerequisites, the checkpoint contract).
    # One orienting line here keeps the registry complete without duplicating it.
    return [
        f'Concept map "{getattr(m, "title", "") or "untitled"}" — '
        f"{len(getattr(m, 'nodes', []))} concepts, described in detail below."
        for m in items
    ]


def _describe_generic(items: list, spec: ElementSpec) -> list[str]:
    """Fallback for an element kind with no bespoke describer.

    Deliberately vague but never silent: a new element kind announces itself to
    the tutor from the day it lands, and the too-generic wording is the nudge to
    write a real describer.
    """
    count = len(items)
    plural = "s" if count != 1 else ""
    return [f"{spec.kind} — {count} {spec.kind} element{plural} on the workbench."]


_DESCRIBERS: dict[str, Callable[[list, ElementSpec], list[str]]] = {
    "checklist": _describe_checklist,
    "table": _describe_table,
    "chart": _describe_chart,
    "calculator": _describe_calculator,
    "note": _describe_note,
    "solution": _describe_solution,
    "document": _describe_document,
    "conceptMap": _describe_concept_map,
}


def describe_elements(cfg: ActivityConfig | None) -> str:
    """Compose the prompt block naming every authored workbench element.

    Returns an empty string when the activity has no elements — a chat-only
    activity composes exactly as it did before this module existed.

    Truncation is **item-wise**: when the budget is exhausted, remaining lines
    are dropped and replaced with a ``(+N more)`` marker, and the behavioural
    header/footer are always kept. Dropping the header instead would leave the
    tutor with a list of tools and no instruction to use them, which is the
    feature silently failing on exactly the largest activities.
    """
    if cfg is None:
        return ""

    lines: list[str] = []
    counts: dict[str, int] = {}

    for kind, spec in ELEMENT_REGISTRY.items():
        items = getattr(cfg, spec.field, None) or []
        if not items:
            continue
        counts[kind] = len(items)
        describer = _DESCRIBERS.get(kind, _describe_generic)
        try:
            lines.extend(describer(items, spec))
        except Exception:  # pragma: no cover — a describer must never break a session
            log.exception("element describer failed for kind=%s — falling back to generic", kind)
            lines.extend(_describe_generic(items, spec))

    if not lines:
        return ""

    body, dropped = _fit(lines, budget=MANIFEST_CHAR_CAP - len(_HEADER) - len(_FOOTER) - 4)
    if dropped:
        body.append(f"(+{dropped} more)")

    log.debug("element manifest composed: kinds=%s dropped=%d", counts, dropped)
    return "\n".join([_HEADER, "", *body, "", _FOOTER])


def _fit(lines: list[str], *, budget: int) -> tuple[list[str], int]:
    """Take as many whole lines as fit; report how many were dropped."""
    kept: list[str] = []
    used = 0
    for i, line in enumerate(lines):
        cost = len(line) + 1
        if used + cost > budget:
            return kept, len(lines) - i
        kept.append(line)
        used += cost
    return kept, 0


__all__ = ["MANIFEST_CHAR_CAP", "describe_elements"]
