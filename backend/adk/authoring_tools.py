"""Authoring write-tools for the activity-authoring co-pilot (COPILOT-1 M1;
design 1.1.39 "The agent's tools").

Each tool is owner-scoped and **proposes** — it returns an editable suggestion the
teacher Applies on the frontend; it NEVER persists. The actual write rides the
shipped, owner-checked ``PATCH /api/activities`` when the teacher clicks Apply
(EARNED TRUST: nothing changes without a teacher action). Tools are declarative —
they emit structured field deltas, never code/HTML.

Registered into ``adk/tools.py::TOOL_REGISTRY`` so the
``activity-authoring-assistant`` SKILL.md ``tools:`` frontmatter can name them.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from google.adk.tools import ToolContext

# The non-raising identity resolver — propose-only tools return a denial dict
# rather than let a PermissionError abort the turn. Single source of truth
# shared with analytics-chat + manage-class (analytics.auth.caller_uid).
from analytics.auth import caller_uid_or_none as _caller_uid

# save_activity is imported (not called) so tests can guard that the proposal
# path never persists; get_activity is the owner-scoped read.
from db.activities import get_activity, save_activity  # noqa: F401  (save_activity: guard-only)
from db.models.activity_config import (
    ELEMENT_REGISTRY,
    CalcInput,
    CalculatorElement,
    ChartElement,
    TableColumn,
    TableElement,
)

logger = logging.getLogger(__name__)

# Math names a calculator formula may use besides its input ids (the real safe
# evaluator is frontend safeFormula.ts; this is an authoring coherence check that
# catches the LLM referencing an undefined variable).
_FORMULA_MATH_NAMES = frozenset(
    {
        "sqrt",
        "abs",
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "log",
        "ln",
        "log10",
        "exp",
        "pi",
        "e",
        "min",
        "max",
        "pow",
        "floor",
        "ceil",
        "round",
    }
)
_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

# Matches ActivityUpsert.teaching_goal (activity_routes.py) so an Applied
# proposal never 422s on length.
MAX_GOAL_LEN = 2000

# Palette element kinds the co-pilot can assemble (COPILOT-2). Text-authored
# kinds — the teacher writes a note body / solution prompt / document prompt; the
# student does the drawing/upload at runtime. table / chart / calculator carry
# richer structured specs and remain a follow-on.
_TEXT_ELEMENT_KINDS = {"note", "solution", "document"}
_STRUCTURED_ELEMENT_KINDS = {"table", "chart", "calculator"}
_SUPPORTED_ELEMENT_KINDS = {"checklist"} | _TEXT_ELEMENT_KINDS | _STRUCTURED_ELEMENT_KINDS
# Caps mirror the element models (activity_config.py) so an Applied element never 422s.
MAX_CHECKLIST_ITEMS = ELEMENT_REGISTRY["checklist"].max_items
MAX_NOTE_TITLE = 120
MAX_NOTE_BODY = 4000
MAX_PROMPT_LEN = 2000  # solution / document prompt

# Byte-identical denial for missing AND not-owned, so the tool can't be used to
# enumerate other teachers' activities (mirrors activity_routes._load_for_modify).
_DENY = {"ok": False, "error": "activity not found"}


def set_lesson_prompt(
    text: str,
    activity_id: str,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose a Socratic lesson prompt (the teaching goal) for an activity.

    Owner-scoped: only proposes for the caller's OWN activity. Returns a proposal
    the teacher Applies on the frontend — it does NOT persist.

    Args:
        text: The proposed Socratic lesson prompt / teaching goal.
        activity_id: The activity being authored (the teacher owns it).

    Returns:
        ``{"ok": True, "proposal": {"field": "teachingGoal", "activityId": ...,
        "value": ...}}`` on success, or ``{"ok": False, "error": ...}`` if the
        caller can't author this activity or the text is empty/too long.
    """
    uid = _caller_uid(tool_context)
    if not uid:
        return dict(_DENY)

    goal = (text or "").strip()
    if not goal:
        return {"ok": False, "error": "the lesson prompt is empty"}
    if len(goal) > MAX_GOAL_LEN:
        return {"ok": False, "error": f"the lesson prompt is too long (max {MAX_GOAL_LEN} characters)"}

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != uid:
        return dict(_DENY)

    logger.info("authoring: set_lesson_prompt proposal for activity=%s by uid=%s", activity_id, uid)
    return {
        "ok": True,
        "proposal": {
            "kind": "set_lesson_prompt",
            "field": "teachingGoal",
            "activityId": activity_id,
            "value": goal,
        },
    }


def add_element(
    element_kind: str,
    activity_id: str,
    items: list[str] | None = None,
    text: str | None = None,
    title: str | None = None,
    columns: list[dict[str, Any]] | None = None,
    rows: int = 5,
    chart_kind: str = "scatter",
    formula: str | None = None,
    inputs: list[dict[str, Any]] | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose adding a workspace element to an activity (COPILOT-2).

    Owner-scoped + propose-only: returns a proposal the teacher Applies; never
    persists. The kind is validated against the 1.1.38 ``ELEMENT_REGISTRY`` and
    the per-element model.

    Args:
        element_kind: the palette element kind. Use the matching inputs:
            ``checklist`` → ``items``; ``note``/``solution``/``document`` → ``text``
            (+ ``title`` for a note); ``table`` → ``columns`` (+ ``rows``);
            ``chart`` → ``chart_kind``; ``calculator`` → ``formula`` + ``inputs``.
        activity_id: the activity being authored (the teacher owns it).
        items: checklist step labels.
        text: a note's body, or the prompt above the student's solution
            (drawing/photo) / document-upload surface.
        title: optional title for note / table / chart / calculator.
        columns: table columns — each ``{"label", "unit"?, "kind": "number"|"text"}``.
        rows: number of table rows (1-50).
        chart_kind: ``scatter`` | ``line`` | ``bar`` (the chart auto-plots the table).
        formula: calculator expression over the input ids (e.g. ``"s / t"``).
        inputs: calculator inputs — each ``{"id", "label", "unit"?}``; the
            ``id`` is the variable name used in ``formula``.

    Returns:
        ``{"ok": True, "proposal": {"kind": "add_element", "element_kind": ...,
        "spec": {...}, "label": ...}}`` or ``{"ok": False, "error": ...}``.
    """
    uid = _caller_uid(tool_context)
    if not uid:
        return dict(_DENY)

    # Input validation first — activity-independent, so no enumeration risk.
    if element_kind not in ELEMENT_REGISTRY:
        return {"ok": False, "error": f"unknown element kind {element_kind!r}"}
    if element_kind not in _SUPPORTED_ELEMENT_KINDS:
        return {"ok": False, "error": f"the co-pilot can't assemble a {element_kind!r} element yet"}

    spec, label = _build_element_spec(
        element_kind,
        items=items,
        text=text,
        title=title,
        columns=columns,
        rows=rows,
        chart_kind=chart_kind,
        formula=formula,
        inputs=inputs,
    )
    if spec is None:
        return {"ok": False, "error": label}  # label carries the validation error

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != uid:
        return dict(_DENY)

    logger.info("authoring: add_element(%s) proposal for activity=%s by uid=%s", element_kind, activity_id, uid)
    return {"ok": True, "proposal": {"kind": "add_element", "element_kind": element_kind, "spec": spec, "label": label}}


def _first_error(exc: Exception) -> str:
    errs = getattr(exc, "errors", None)
    if callable(errs):
        try:
            return str(errs()[0].get("msg", exc))
        except (IndexError, KeyError, TypeError):
            pass
    return str(exc)


def _slug(label: str, i: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", (label or "").lower()).strip("_")
    return base or f"col_{i + 1}"


def _build_element_spec(
    element_kind: str,
    *,
    items: list[str] | None = None,
    text: str | None = None,
    title: str | None = None,
    columns: list[dict[str, Any]] | None = None,
    rows: int = 5,
    chart_kind: str = "scatter",
    formula: str | None = None,
    inputs: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any] | None, str]:
    """Validate + build the (spec, label) for an element kind, or (None, error).

    The spec is shaped for the FRONTEND editor value (what the Apply card writes
    into the builder); validation rides the backend Pydantic element models."""
    if element_kind == "checklist":
        clean = [s.strip() for s in (items or []) if isinstance(s, str) and s.strip()][:MAX_CHECKLIST_ITEMS]
        if not clean:
            return None, "the checklist has no steps"
        return {"items": clean}, f"Tjekliste ({len(clean)} trin)"

    if element_kind in _TEXT_ELEMENT_KINDS:
        body = (text or "").strip()
        if not body:
            return None, f"the {element_kind} has no text"
        if element_kind == "note":
            clean_title = (title or "").strip()[:MAX_NOTE_TITLE]
            return {"title": clean_title, "body": body[:MAX_NOTE_BODY]}, f"Note: {clean_title or body[:30]}"
        label = "Løsningsfelt (elevens løsning)" if element_kind == "solution" else "Dokument-upload (elevens fil)"
        return {"prompt": body[:MAX_PROMPT_LEN]}, label

    # --- structured kinds: validate by building the Pydantic model ---
    clean_title = (title or "").strip()
    if element_kind == "table":
        if not columns:
            return None, "the table has no columns"
        try:
            model = TableElement(
                id="table-1",
                title=clean_title,
                columns=[
                    TableColumn(
                        id=_slug(c.get("label", ""), i),
                        label=c.get("label", ""),
                        unit=c.get("unit", ""),
                        kind=c.get("kind", "number"),
                    )
                    for i, c in enumerate(columns)
                ],
                rows=int(rows),
            )
        except Exception as e:
            return None, f"invalid table: {_first_error(e)}"
        spec = {
            "title": model.title,
            "columns": [{"label": col.label, "unit": col.unit, "kind": col.kind} for col in model.columns],
            "rows": model.rows,
        }
        return spec, f"Tabel ({len(model.columns)} kolonner)"

    if element_kind == "chart":
        try:
            model = ChartElement(id="chart-1", title=clean_title, chartKind=chart_kind)
        except Exception:
            return None, f"invalid chart kind {chart_kind!r} (use scatter, line or bar)"
        return {"title": model.title, "chartKind": model.chart_kind}, f"Graf ({model.chart_kind})"

    # calculator
    if not formula or not inputs:
        return None, "the calculator needs a formula and at least one input"
    try:
        model = CalculatorElement(
            id="calc-1",
            title=clean_title,
            formula=formula,
            inputs=[CalcInput(id=i["id"], label=i.get("label", i["id"]), unit=i.get("unit", "")) for i in inputs],
        )
    except Exception as e:
        return None, f"invalid calculator: {_first_error(e)}"
    allowed = {i.id for i in model.inputs} | _FORMULA_MATH_NAMES
    unknown = sorted({m.group(0) for m in _IDENT_RE.finditer(model.formula)} - allowed)
    if unknown:
        return (
            None,
            f"the formula uses unknown name(s): {', '.join(unknown)} — use only the input ids or math functions",
        )
    spec = {
        "title": model.title,
        "formula": model.formula,
        "inputs": [{"id": i.id, "label": i.label, "unit": i.unit} for i in model.inputs],
    }
    return spec, "Lommeregner"


def _artefact_label(meta: Any) -> str:
    return getattr(meta, "name", None) or getattr(meta, "id", "")


def set_artefact(
    artefact_id: str,
    activity_id: str,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose a vetted sim for an activity (COPILOT-2 M2).

    Owner-scoped + propose-only. The sim is validated against the artefact
    catalogue; an unknown/empty id returns the available sims so the agent can
    retry with a valid one. Applying it sets ``artefactId`` (which derives
    ``workbenchType=app`` — the workbench *type* is never chosen directly).

    Args:
        artefact_id: a catalogued sim id (e.g. ``boldkast``).
        activity_id: the activity being authored (the teacher owns it).
    """
    from artefacts.loader import load_artefact, load_artefacts

    uid = _caller_uid(tool_context)
    if not uid:
        return dict(_DENY)

    meta = load_artefact(artefact_id) if artefact_id else None
    if meta is None:
        return {
            "ok": False,
            "error": f"unknown sim {artefact_id!r}",
            "available": [{"id": a.id, "label": _artefact_label(a)} for a in load_artefacts()],
        }

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != uid:
        return dict(_DENY)

    logger.info("authoring: set_artefact(%s) proposal for activity=%s by uid=%s", artefact_id, activity_id, uid)
    return {
        "ok": True,
        "proposal": {"kind": "set_artefact", "artefactId": artefact_id, "label": _artefact_label(meta)},
    }
