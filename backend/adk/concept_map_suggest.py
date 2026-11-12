"""A concept map suggested from a teaching goal (new-activity wizard, step 1).

The teacher writes what the students should learn; this asks a model, once, for
the handful of concepts a stx physics student must grasp for that goal, which
builds on which, and one sentence per concept saying what counts as having got
it. The teacher then uses it, edits it, or asks for another.

It is a SUGGESTION: nothing is persisted here. The map only becomes part of an
activity when the teacher uses it and saves the activity.

The rules for a valid map are NOT restated here. The model's answer is turned
into a diff on an empty map and run through
``adk.authoring_tools.apply_concept_map_diff`` — the same function the
co-pilot's ``propose_concept_map`` uses (id minting, label aliases, the DAG
cycle-guard, size bounds). An answer that fails it is refused whole: the
teacher sees "try again", never half a map.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Literal

from adk.authoring_tools import apply_concept_map_diff
from llm import generate

log = logging.getLogger(__name__)

#: The model is asked for 3 to 7 concepts. A little slack either side, so a
#: narrow goal that honestly has two concepts is not refused — but a map of
#: one concept is not a map, and more than ten is not "the core concepts".
MIN_NODES = 2
MAX_NODES = 10

#: The teacher is waiting on step 1; a stuck call must not hang the card.
SUGGEST_TIMEOUT_S = 45.0

PURPOSE = "concept_map_suggest"

_LANGUAGE_NAME = {"da": "Danish", "en": "English"}


def build_prompt(goal: str, language: Literal["da", "en"], title: str | None = None) -> str:
    """The one prompt. Labels are short so they fit a chip; ``done_when`` is a
    bar a teacher would recognise, not a question."""
    lang = _LANGUAGE_NAME[language]
    name = f'Activity name: "{title.strip()}"\n' if title and title.strip() else ""
    return f"""You help a Danish upper-secondary (stx) physics teacher plan an activity.

{name}What the students should learn (the teacher's words):
\"\"\"{goal.strip()}\"\"\"

List the 3 to 7 concepts a stx physics student must grasp to reach this goal, and
which concept builds on which (prerequisites). Write everything in {lang}.

Rules:
- "label": the concept in 1 to 4 words, as a teacher would name it (max 60 characters).
- "done_when": ONE plain sentence saying what a student can do or explain once they
  have understood the concept. Not a question. Max 180 characters.
- "edges": prerequisite links. "from" is the concept that must come first, "to" the
  concept that builds on it. Use the exact labels. No cycles. A concept may have
  no prerequisites.
- Order the concepts from foundational to advanced.
- Only concepts from this goal; no general study skills.

Answer with JSON only, in exactly this shape:
{{"title": "<short title for the map>",
  "nodes": [{{"label": "...", "done_when": "..."}}],
  "edges": [{{"from": "<label>", "to": "<label>"}}]}}"""


_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


def parse_answer(raw: str) -> dict[str, Any] | None:
    """The JSON object in a model answer, tolerating code fences and prose
    around it. ``None`` when there is no object to be had."""
    text = _FENCE.sub("", (raw or "").strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _ref(value: Any) -> str:
    return str(value or "").strip()


def to_map(data: dict[str, Any]) -> dict[str, Any]:
    """Validate a parsed answer into the wire map, or say why it is refused.

    Returns ``{"ok": True, "map": {...}}`` or ``{"ok": False, "error": ...}``.
    """
    raw_nodes = data.get("nodes")
    raw_edges = data.get("edges") or []
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        return {"ok": False, "error": "the answer has no list of concepts"}
    if not all(isinstance(n, dict) for n in raw_nodes) or not all(isinstance(e, dict) for e in raw_edges):
        return {"ok": False, "error": "the answer's concepts are malformed"}
    if not MIN_NODES <= len(raw_nodes) <= MAX_NODES:
        return {"ok": False, "error": f"expected {MIN_NODES} to {MAX_NODES} concepts, got {len(raw_nodes)}"}

    # A model may give its nodes ids and point its edges at them. Ids are minted
    # here (from the label), so translate any such reference to its label —
    # the validator resolves labels.
    id_to_label = {_ref(n.get("id")): _ref(n.get("label")) for n in raw_nodes if _ref(n.get("id"))}
    add_nodes = [
        {"label": _ref(n.get("label")), "done_when": _ref(n.get("done_when") or n.get("doneWhen"))} for n in raw_nodes
    ]
    add_edges = [
        {
            "from": id_to_label.get(_ref(e.get("from")), _ref(e.get("from"))),
            "to": id_to_label.get(_ref(e.get("to")), _ref(e.get("to"))),
        }
        for e in raw_edges
    ]
    title = data.get("title")
    applied = apply_concept_map_diff(
        [],
        [],
        "",
        title=title[:120] if isinstance(title, str) else "",
        add_nodes=add_nodes,
        add_edges=add_edges,
    )
    if not applied["ok"]:
        return {"ok": False, "error": applied["error"]}
    element = applied["result"].model_dump(by_alias=True)
    return {
        "ok": True,
        "map": {
            "title": element["title"],
            "nodes": [
                {
                    "id": n["id"],
                    "label": n["label"],
                    "doneWhen": n["doneWhen"],
                    "checkQuestions": n["checkQuestions"],
                }
                for n in element["nodes"]
            ],
            "edges": [{"from": e["from"], "to": e["to"]} for e in element["edges"]],
        },
    }


async def suggest_concept_map(goal: str, language: Literal["da", "en"], title: str | None = None) -> dict[str, Any]:
    """One model call → a validated map, or ``{"ok": False, "error": ...}``.

    Never raises: a failed call, an unparseable answer and an invalid map all
    come back as ``ok: False`` with a reason for the log, so the wizard can
    offer "try again" and the teacher can carry on without one.
    """
    try:
        gen = await asyncio.wait_for(
            generate(build_prompt(goal, language, title), purpose=PURPOSE, json=True, temperature=0.3),
            timeout=SUGGEST_TIMEOUT_S,
        )
    except Exception as exc:
        log.warning("concept-map suggest: model call failed (%s: %s)", type(exc).__name__, exc)
        return {"ok": False, "error": "the suggestion could not be made"}

    data = parse_answer(gen.text)
    if data is None:
        log.warning("concept-map suggest: answer was not JSON (%d chars)", len(gen.text or ""))
        return {"ok": False, "error": "the suggestion could not be read"}
    out = to_map(data)
    if not out["ok"]:
        log.warning("concept-map suggest: refused invalid map: %s", out["error"])
        return out
    log.info(
        "concept-map suggest: %d concepts, %d links (model=%s, lang=%s)",
        len(out["map"]["nodes"]),
        len(out["map"]["edges"]),
        gen.model,
        language,
    )
    return out
