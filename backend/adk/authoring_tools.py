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
from db.curriculum import list_curriculum_for_teacher
from db.models.activity_config import (
    ELEMENT_REGISTRY,
    CalcInput,
    CalculatorElement,
    ChartElement,
    ConceptMapElement,
    TableColumn,
    TableElement,
)
from db.models.curriculum import CurriculumDoc

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


def _can_author(activity_id: str, uid: str) -> bool:
    """True if the caller may author this target.

    An empty ``activity_id`` is a **brand-new draft** (the teacher is authoring on
    /new — nothing is persisted yet, so there's no activity to own-check; the
    eventual Save is owner-scoped at the API). A given id must EXIST and be OWNED —
    a byte-identical denial for missing + not-owned (no enumeration)."""
    if not activity_id:
        return True
    activity = get_activity(activity_id)
    return activity is not None and activity.owner_uid == uid


def set_lesson_prompt(
    text: str,
    activity_id: str = "",
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

    if not _can_author(activity_id, uid):
        return dict(_DENY)

    logger.info("authoring: set_lesson_prompt proposal for activity=%s by uid=%s", activity_id or "(draft)", uid)
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
    activity_id: str = "",
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

    if not _can_author(activity_id, uid):
        return dict(_DENY)

    logger.info(
        "authoring: add_element(%s) proposal for activity=%s by uid=%s", element_kind, activity_id or "(draft)", uid
    )
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
    activity_id: str = "",
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

    if not _can_author(activity_id, uid):
        return dict(_DENY)

    logger.info(
        "authoring: set_artefact(%s) proposal for activity=%s by uid=%s", artefact_id, activity_id or "(draft)", uid
    )
    return {
        "ok": True,
        "proposal": {"kind": "set_artefact", "artefactId": artefact_id, "label": _artefact_label(meta)},
    }


_DANISH_TRANSLIT = str.maketrans({"æ": "ae", "ø": "oe", "å": "aa", "é": "e", "ü": "u"})


def _concept_slug(label: str, i: int) -> str:
    """Mint a stable node id from a (Danish) label — transliterated so
    ``Projektilbevægelse`` → ``projektilbevaegelse``, not ``projektilbev_gelse``."""
    return _slug(label.lower().translate(_DANISH_TRANSLIT), i)


def _questions_wire(questions: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    """Normalise check-question dicts to the camelCase wire shape, dropping
    entries without a prompt. Accepts either snake_case (the tool arg) or
    camelCase (an agent echoing a previous proposal)."""
    out = []
    for i, q in enumerate(questions or []):
        prompt = str(q.get("prompt", "")).strip()
        if not prompt:
            continue
        expected = str(q.get("expected_answer") or q.get("expectedAnswer") or "").strip()
        out.append({"id": f"q-{i + 1}", "prompt": prompt, "expectedAnswer": expected})
    return out


def _current_concept_map(activity_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    """The saved map as plain wire dicts ``(nodes, edges, title)`` — empty for a
    draft or an activity without one. Caller has already passed ``_can_author``."""
    if not activity_id:
        return [], [], ""
    activity = get_activity(activity_id)
    if activity is None or not activity.concept_map:
        return [], [], ""
    m = activity.concept_map[0].model_dump(by_alias=True)
    return m.get("nodes", []), m.get("edges", []), m.get("title", "")


def propose_concept_map(
    activity_id: str = "",
    title: str | None = None,
    add_nodes: list[dict[str, Any]] | None = None,
    add_edges: list[dict[str, Any]] | None = None,
    remove_nodes: list[str] | None = None,
    relabel: list[dict[str, Any]] | None = None,
    set_check_questions: list[dict[str, Any]] | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose a DIFF to the activity's living concept map (CONCEPT-1 M2).

    Co-authoring, not one-shot: the diff applies to the map's CURRENT state, so
    the map is built up over several conversational rounds. Owner-scoped +
    propose-only — the teacher Applies on the frontend; never persists. The
    RESULTING map is validated server-side (DAG cycle-guard, size bounds); an
    invalid diff returns the current node ids so you can retry.

    Args:
        activity_id: the activity being authored (the teacher owns it).
        title: optionally set the map's title.
        add_nodes: concepts to add — each ``{"label", "id"?, "check_questions"?:
            [{"prompt", "expected_answer"?}]}``. The id is minted from the label
            when omitted; check questions are what the tutor asks IN CHAT at a
            checkpoint, judged against the expected answer.
        add_edges: prerequisite links — each ``{"from": <prereq id>, "to": <id>}``.
        remove_nodes: node ids to remove (their edges go with them).
        relabel: label fixes — each ``{"id", "label"}``.
        set_check_questions: replace one node's questions — each ``{"node_id",
            "questions": [{"prompt", "expected_answer"?}]}``.

    Returns:
        ``{"ok": True, "proposal": {"kind": "propose_concept_map", "diff": ...,
        "result": <the validated resulting map>, "label": ...}}`` or
        ``{"ok": False, "error": ..., "nodes": [current ids]}``.
    """
    uid = _caller_uid(tool_context)
    if not uid:
        return dict(_DENY)
    if not any([title, add_nodes, add_edges, remove_nodes, relabel, set_check_questions]):
        return {"ok": False, "error": "empty diff — propose at least one change"}
    if not _can_author(activity_id, uid):
        return dict(_DENY)

    nodes, edges, current_title = _current_concept_map(activity_id)
    by_id = {n["id"]: n for n in nodes}
    current_ids = sorted(by_id)

    def _fail(msg: str) -> dict[str, Any]:
        return {"ok": False, "error": msg, "nodes": current_ids}

    # remove → relabel → set questions → add nodes → add edges → title.
    removed = set(remove_nodes or [])
    if unknown := removed - set(by_id):
        return _fail(f"unknown node ids to remove: {sorted(unknown)}")
    nodes = [n for n in nodes if n["id"] not in removed]
    edges = [e for e in edges if e["from"] not in removed and e["to"] not in removed]
    by_id = {n["id"]: n for n in nodes}

    for r in relabel or []:
        nid, label = str(r.get("id", "")), str(r.get("label", "")).strip()
        if nid not in by_id:
            return _fail(f"unknown node id to relabel: {nid!r}")
        if not label:
            return _fail(f"empty label for node {nid!r}")
        by_id[nid]["label"] = label

    for sq in set_check_questions or []:
        nid = str(sq.get("node_id") or sq.get("nodeId") or "")
        if nid not in by_id:
            return _fail(f"unknown node id for check questions: {nid!r}")
        by_id[nid]["checkQuestions"] = _questions_wire(sq.get("questions"))

    added_nodes = []
    for i, spec in enumerate(add_nodes or []):
        label = str(spec.get("label", "")).strip()
        if not label:
            return _fail("every added node needs a label")
        nid = str(spec.get("id") or "").strip() or _concept_slug(label, i)
        if nid in by_id:
            return _fail(f"node id {nid!r} already exists — relabel it or pick a new id")
        node = {"id": nid, "label": label, "checkQuestions": _questions_wire(spec.get("check_questions"))}
        by_id[nid] = node
        nodes.append(node)
        added_nodes.append(node)

    # Edge refs resolve by id OR by label (case-insensitive) — the agent can't
    # reliably predict a minted slug, so labels are an accepted alias.
    by_label = {n["label"].strip().lower(): n["id"] for n in nodes}

    def _resolve(ref: str) -> str | None:
        return ref if ref in by_id else by_label.get(ref.strip().lower())

    added_edges = []
    for e in add_edges or []:
        src = _resolve(str(e.get("from", "")))
        dst = _resolve(str(e.get("to", "")))
        if src is None or dst is None:
            return _fail(f"edge {e.get('from')!r}->{e.get('to')!r} references an unknown node")
        if any(x["from"] == src and x["to"] == dst for x in edges):
            continue  # idempotent — re-proposing an existing link is not an error
        edge = {"from": src, "to": dst}
        edges.append(edge)
        added_edges.append(edge)

    new_title = title.strip() if isinstance(title, str) else current_title
    try:
        result = ConceptMapElement.model_validate(
            {"id": "concept-map-1", "title": new_title, "nodes": nodes, "edges": edges}
        )
    except Exception as exc:
        return _fail(_first_error(exc))

    diff = {
        "title": title.strip() if isinstance(title, str) else None,
        "addNodes": added_nodes,
        "addEdges": added_edges,
        "removeNodes": sorted(removed),
        "relabel": [{"id": str(r["id"]), "label": str(r["label"]).strip()} for r in relabel or []],
        "setCheckQuestions": [
            {
                "nodeId": str(sq.get("node_id") or sq.get("nodeId") or ""),
                "questions": _questions_wire(sq.get("questions")),
            }
            for sq in set_check_questions or []
        ],
    }
    label = (
        f"{len(added_nodes)} nye begreber, {len(added_edges)} nye forbindelser"
        if added_nodes or added_edges
        else "opdatering af begrebskortet"
    )
    logger.info(
        "authoring: propose_concept_map(+%d nodes, +%d edges, -%d) for activity=%s by uid=%s",
        len(added_nodes),
        len(added_edges),
        len(removed),
        activity_id or "(draft)",
        uid,
    )
    return {
        "ok": True,
        "proposal": {
            "kind": "propose_concept_map",
            "activityId": activity_id,
            "diff": diff,
            "result": result.model_dump(by_alias=True),
            "label": label,
        },
    }


def _curriculum_choice(doc: CurriculumDoc) -> dict[str, str]:
    """A compact catalogue entry the agent picks a ``docId`` from. The ``summary``
    (1.1.52) is what lets it judge relevance without reading the doc."""
    return {
        "docId": doc.doc_id,
        "title": doc.title,
        "summary": doc.summary,
        "level": doc.level or "",
        "topic": doc.topic or "",
        "origin": doc.origin,
    }


def attach_material(
    doc_id: str = "",
    activity_id: str = "",
    level: str = "",
    topic: str = "",
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose attaching a curriculum reference document to an activity (COPILOT-2).

    Owner-scoped (the activity) + propose-only: returns a proposal the teacher
    Applies; never persists. The document is resolved against the teacher's
    curriculum library — the SHARED cleared corpus plus their own uploads — so a
    teacher can only attach a doc they may actually cite. An empty/unknown
    ``doc_id`` returns the available documents (optionally narrowed by ``level`` /
    ``topic``) so the agent can pick a valid one, exactly like ``set_artefact``.
    Applying it appends a ``curriculum`` material the tutor grounds its answers on
    (RAG retrieval).

    Args:
        doc_id: a curriculum document id from the teacher's library. Empty → list
            the available documents to choose from.
        activity_id: the activity being authored (the teacher owns it).
        level: optional A/B/C filter when listing (narrows the available set).
        topic: optional topic filter when listing.

    Returns:
        ``{"ok": True, "proposal": {"kind": "attach_material", "materialKind":
        "curriculum", "docId": ..., "origin": ..., "label": ...}}`` on success, or
        ``{"ok": False, "error": ..., "available": [...]}`` listing the documents
        the teacher may attach.
    """
    uid = _caller_uid(tool_context)
    if not uid:
        return dict(_DENY)

    # ACL-scoped to shared + the teacher's OWN docs — resolving the choice from
    # this allow-set (not a bare get_curriculum_doc) stops a teacher attaching
    # another teacher's private doc by guessing its id.
    available = list_curriculum_for_teacher(uid, level=level or None, topic=topic or None)  # type: ignore[arg-type]
    chosen = next((d for d in available if d.doc_id == doc_id), None) if doc_id else None
    if chosen is None:
        return {
            "ok": False,
            "error": f"unknown curriculum document {doc_id!r}" if doc_id else "give a docId from the available list",
            "available": [_curriculum_choice(d) for d in available],
        }

    if not _can_author(activity_id, uid):
        return dict(_DENY)

    logger.info(
        "authoring: attach_material(%s) proposal for activity=%s by uid=%s", doc_id, activity_id or "(draft)", uid
    )
    return {
        "ok": True,
        "proposal": {
            "kind": "attach_material",
            "materialKind": "curriculum",
            "docId": chosen.doc_id,
            "origin": chosen.origin,
            "label": chosen.title,
        },
    }
