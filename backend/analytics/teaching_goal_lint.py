"""Authoring-time lint: which lines of a teaching goal tell the tutor HOW to teach?
(1.1.141 M2 + M3.)

A teaching goal is meant to say what the students should learn and do. Teachers
— and the co-pilot drafting with them — routinely write pedagogy and persona into
it as well: *"be encouraging, give hints freely"*, *"act as a friendly guide"*,
*"if they are stuck, show the method"*. When the class's tutor runs a teaching
approach, those lines compete with it (``adk/teaching_precedence`` says which
wins at runtime; this module tells the teacher at authoring time, which is the
lever — per-turn detection is out of scope, too costly and too late).

**One analysis-model call per distinct text.** ``config.models.analysis_model``
— this is after-the-fact work nobody waits on in a lesson. Results are cached by
a hash of (text, framework, criteria edition, prompt version), so saving the
same goal twice costs one call, and nothing here ever runs per turn.

**The approach's constructs come from the fidelity judge's own criteria**
(``analytics.framework_fidelity.criteria_block``) — the generated text the judge
scores sessions against. A second, hand-written description of each approach
would drift from the one that instructs the tutor; this cannot.

**Abstain over fabricate.** A returned span must be a VERBATIM substring of the
goal or it is dropped — M3 moves spans by cutting them out of the text, so a
paraphrase would cut nothing (or the wrong thing). Any failure (model error,
timeout, malformed JSON, a non-Gemini analysis model) degrades to *no warning*:
the save has already succeeded and a lint is advice, never a gate.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from collections import OrderedDict
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

log = logging.getLogger(__name__)

PROMPT_VERSION = "goal-lint-r1"

SpanKind = Literal["tone", "hint_policy", "character", "answer_policy"]
SPAN_KINDS: tuple[str, ...] = ("tone", "hint_policy", "character", "answer_policy")

#: A goal is capped at 2,000 chars; more spans than this is a model listing
#: sentences, not finding pedagogy.
MAX_SPANS = 8
#: An authoring call; a save must never wait on a hung model.
LINT_TIMEOUT_S = 25.0
#: Bounded in-process cache — distinct goal texts per instance are few.
_CACHE_MAX = 512
_CACHE: OrderedDict[str, GoalLint] = OrderedDict()


class PedagogySpan(BaseModel):
    """One line of the goal that tells the tutor how to teach, not what."""

    text: str
    kind: SpanKind
    #: Construct keys of the assigned approach this line conflicts with
    #: (``framework_fidelity._construct_key`` ids). Empty with no approach.
    conflicts_with: list[str] = Field(default_factory=list, alias="conflictsWith")
    why: str = ""

    model_config = ConfigDict(populate_by_name=True)


class GoalLint(BaseModel):
    """The lint result for one teaching goal. ``spans == []`` is the quiet case."""

    spans: list[PedagogySpan] = Field(default_factory=list)
    framework_id: str | None = Field(default=None, alias="frameworkId")
    framework_label: str | None = Field(default=None, alias="frameworkLabel")
    tutor_name: str | None = Field(default=None, alias="tutorName")
    text_hash: str = Field(default="", alias="textHash")
    model: str = ""
    prompt_version: str = Field(default=PROMPT_VERSION, alias="promptVersion")
    #: True when the lint could not run — the UI shows no warning either way;
    #: the flag is for logs and tests, never for a teacher-facing error.
    #: Construct key -> its name, for the keys a span may cite — so the editor
    #: can say WHICH part of the approach a line competes with.
    construct_names: dict[str, str] = Field(default_factory=dict, alias="constructNames")
    degraded: bool = False
    cached: bool = False

    model_config = ConfigDict(populate_by_name=True)


def text_hash(text: str, framework_id: str | None, criteria_ver: str) -> str:
    """The cache key: the goal, the approach it is checked against, and which
    edition of that approach's criteria — a criteria edit is a new lint."""
    raw = "\x1f".join([PROMPT_VERSION, framework_id or "", criteria_ver, text.strip()])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_get(key: str) -> GoalLint | None:
    hit = _CACHE.get(key)
    if hit is not None:
        _CACHE.move_to_end(key)
    return hit


def _cache_put(key: str, value: GoalLint) -> None:
    _CACHE[key] = value
    _CACHE.move_to_end(key)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)


def _reset_cache_for_testing() -> None:
    _CACHE.clear()


_INSTRUCTIONS = """You read a teacher's description of a physics activity for an AI tutor.
Find the passages that tell the tutor HOW TO TEACH rather than WHAT the students
should learn or do. Exactly four kinds count:
- tone: how the tutor should sound or feel (encouraging, strict, friendly, brief, playful).
- hint_policy: how much to hint, explain, scaffold or wait before helping.
- character: a role, character, name or identity the tutor should take on.
- answer_policy: whether or when to give answers, solutions, or the method.

Do NOT flag: learning goals, physics content, the task the students do, the
materials, what counts as success, or the order of the content.

Copy each passage EXACTLY as it appears in the text — same characters, same
case, same punctuation — as a whole sentence or clause. Never paraphrase,
translate or shorten. The text may be in any language; answer about it as written.
"""

_APPROACH_PREAMBLE = """The tutor teaching this activity follows a teaching approach with the
criteria below. For each passage you flag, list in "conflictsWith" the criterion
keys (the ### headings) whose moves it would contradict or crowd out. Leave the
list empty when it conflicts with none.

{criteria}
"""

_OUTPUT = """Return JSON only, in this shape:
{"spans": [{"text": "<exact passage>", "kind": "tone|hint_policy|character|answer_policy",
"conflictsWith": ["<criterion key>"], "why": "<one short sentence>"}]}
Return {"spans": []} when nothing in the text tells the tutor how to teach.

TEXT:
<<<
{text}
>>>
"""


def build_lint_prompt(text: str, framework: Any | None) -> tuple[str, list[str]]:
    """The lint prompt, and the construct keys it lets the model name.

    ``framework`` is a ``TeachingFramework`` or None. Its criteria are the
    fidelity judge's (``criteria_block``) — one description of the approach.
    """
    parts = [_INSTRUCTIONS]
    keys: list[str] = []
    if framework is not None:
        from analytics.framework_fidelity import criteria_block

        block, keys = criteria_block(framework)
        if block:
            parts.append(_APPROACH_PREAMBLE.format(criteria=block))
    parts.append(_OUTPUT.replace("{text}", text))
    return "\n".join(parts), keys


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _locate(span: str, text: str) -> str | None:
    """The exact substring of ``text`` the model quoted, or None.

    Exact first; then a whitespace-tolerant match (a model that reflowed a line
    break) mapped back to the original characters, so a move cuts the real text.
    """
    span = span.strip().strip("\"'“”„")
    if not span:
        return None
    if span in text:
        return span
    pattern = r"\s+".join(re.escape(tok) for tok in span.split())
    m = re.search(pattern, text)
    return m.group(0) if m else None


def parse_lint(raw: str, text: str, keys: list[str]) -> list[PedagogySpan]:
    """Parse the model's JSON into verified spans. Never raises on content."""
    body = (raw or "").strip()
    match = re.search(r"\{.*\}", body, re.DOTALL)
    if match:
        body = match.group(0)
    data = json.loads(body)
    items = data.get("spans") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    known = set(keys)
    out: list[PedagogySpan] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        if kind not in SPAN_KINDS:
            continue
        exact = _locate(str(item.get("text") or ""), text)
        if exact is None:
            log.info("goal-lint: dropped a non-verbatim span (%d chars)", len(str(item.get("text") or "")))
            continue
        if _norm_ws(exact) in seen:
            continue
        seen.add(_norm_ws(exact))
        conflicts = [str(k) for k in (item.get("conflictsWith") or []) if str(k) in known]
        out.append(
            PedagogySpan(
                text=exact,
                kind=kind,  # type: ignore[arg-type]
                conflictsWith=list(dict.fromkeys(conflicts)),
                why=str(item.get("why") or "").strip()[:300],
            )
        )
        if len(out) >= MAX_SPANS:
            break
    return out


async def _call_lint_model(prompt: str, model: str) -> str:
    """The one model call. A seam: tests replace it; nothing else calls a model."""
    from analytics.session_rubric import _call_judge_model

    return await _call_judge_model(prompt, model)


def _load_framework(framework_id: str | None) -> tuple[Any | None, str]:
    """(framework or None, criteria edition) — sync Firestore, run off the loop."""
    if not framework_id:
        return None, "yaml"
    from db.framework_overrides import criteria_version, effective_framework

    fw = effective_framework(framework_id)
    if fw is None or getattr(fw, "is_placeholder", False):
        return None, "yaml"
    return fw, criteria_version(framework_id)


async def lint_teaching_goal(
    text: str,
    *,
    framework_id: str | None = None,
    tutor_name: str | None = None,
    model: str | None = None,
) -> GoalLint:
    """Lint one teaching goal. ONE analysis-model call per distinct text; cached.

    Never raises: every failure is ``GoalLint(spans=[], degraded=True)``.
    """
    goal = (text or "").strip()
    try:
        fw, cv = await asyncio.to_thread(_load_framework, framework_id)
    except Exception as exc:  # an approach we cannot read is "no approach", not an error
        log.warning("goal-lint: framework %s unreadable: %s", framework_id, exc)
        fw, cv = None, "yaml"
    fw_id = fw.id if fw is not None else None
    fw_label = fw.label if fw is not None else None
    key = text_hash(goal, fw_id, cv)
    names: dict[str, str] = {}
    if fw is not None:
        from analytics.framework_fidelity import criteria_detail

        names = {k: v["name"] for k, v in criteria_detail(fw).items()}
    base = {
        "frameworkId": fw_id,
        "frameworkLabel": fw_label,
        "tutorName": tutor_name,
        "textHash": key,
        "constructNames": names,
    }
    if not goal:
        return GoalLint(**base)

    hit = _cache_get(key)
    if hit is not None:
        return hit.model_copy(update={"tutor_name": tutor_name, "cached": True})

    try:
        from config.models import analysis_model, provider_for_api_name

        lint_model = model or analysis_model()
        if provider_for_api_name(lint_model) not in (None, "google"):
            log.info("goal-lint: analysis model %s is not Gemini — no lint", lint_model)
            return GoalLint(**base, model=lint_model, degraded=True)
        prompt, keys = build_lint_prompt(goal, fw)
        raw = await asyncio.wait_for(_call_lint_model(prompt, lint_model), timeout=LINT_TIMEOUT_S)
        spans = parse_lint(raw, goal, keys)
    except Exception as exc:
        log.warning("goal-lint: degraded to no warning (%s: %s)", type(exc).__name__, exc)
        return GoalLint(**base, degraded=True)

    result = GoalLint(**base, spans=spans, model=lint_model)
    _cache_put(key, result)
    log.info("goal-lint: %d span(s) framework=%s chars=%d", len(spans), fw_id or "-", len(goal))
    return result


# --- M3: the clean move -------------------------------------------------------------


def _tidy(text: str) -> str:
    """Whitespace left behind by a cut: no double spaces, no 3+ newlines, no
    space before punctuation, no leading/trailing blank."""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" +([,.;:!?])", r"\1", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"^[ \t]*[,;:][ \t]*", "", text, flags=re.MULTILINE)
    return text.strip()


def split_tutor_notes(goal: str, spans: list[PedagogySpan]) -> tuple[str, str]:
    """Cut each span out of the goal; return ``(goal_without_spans, notes)``.

    Spans that no longer occur (the goal changed since the lint) are skipped, so
    a stale result can never cut the wrong text. Notes are one span per line,
    in the order they appeared in the goal.
    """
    remaining = goal
    moved: list[tuple[int, str]] = []
    for span in spans:
        at = remaining.find(span.text)
        if at < 0:
            continue
        moved.append((goal.find(span.text), span.text.strip()))
        remaining = remaining[:at] + remaining[at + len(span.text) :]
    moved.sort(key=lambda m: m[0])
    return _tidy(remaining), "\n".join(t for _, t in moved)


def merge_notes(existing: str, added: str, *, cap: int = 2000) -> str:
    """Append moved lines to existing notes without repeating a line."""
    lines = [ln for ln in (existing or "").splitlines() if ln.strip()]
    for ln in (added or "").splitlines():
        if ln.strip() and ln.strip() not in {x.strip() for x in lines}:
            lines.append(ln.strip())
    return "\n".join(lines)[:cap]


# --- Which approach would teach this activity? -------------------------------------


def authoring_teaching(class_id: str | None) -> tuple[str | None, str | None]:
    """(framework_id, tutor name) of the class's tutor — sync; call off the loop.

    The tutor is chosen per class (1.1.32 Q4), so an activity is checked against
    the class the teacher is editing it in. No class, no tutor, or a tutor with
    no approach → ``(None, name-or-None)``: the lint still finds pedagogy lines,
    with no construct to conflict with.
    """
    if not class_id:
        return None, None
    from adk.tutor_resolution import resolve_teaching
    from db.classes import get_class
    from db.models.tutor import resolve_tutor_persona

    cls = get_class(class_id)
    if cls is None:
        return None, None
    r = resolve_teaching(None, class_tutor_id=getattr(cls, "tutor_id", None))
    if r.tutor is None:
        return None, None
    name = r.tutor.display_name
    try:
        persona = resolve_tutor_persona(r.tutor)
        if persona is not None and (persona.name or "").strip():
            name = persona.name
    except Exception:  # a name is decoration; the approach is the point
        pass
    return r.framework_id, name


def activity_class_id(activity_id: str, owner_uid: str) -> str | None:
    """The first of the owner's classes that holds this activity — sync."""
    from db.classes import list_classes_for_owner

    for cls in list_classes_for_owner(owner_uid):
        if activity_id in (cls.activity_ids or []):
            return cls.class_id
    return None


async def clean_import(activity: Any) -> Any:
    """M3 — move detected pedagogy/persona spans from the goal into tutor notes.

    For a library copy or an adopt: the copy is unassigned, so it is linted with
    no approach (the spans are found either way; which approach would conflict
    is the warning's job, later, in the editor). Returns the activity unchanged
    when nothing is detected or the lint degraded — a copy never fails on this.
    """
    goal = (activity.teaching_goal or "").strip()
    if not goal:
        return activity
    lint = await lint_teaching_goal(goal)
    if not lint.spans:
        return activity
    new_goal, notes = split_tutor_notes(activity.teaching_goal, lint.spans)
    if not notes or not new_goal:
        # Never leave an activity with no goal at all: a goal made ENTIRELY of
        # pedagogy is left alone for the teacher to rewrite.
        return activity
    log.info("goal-lint: clean import moved %d span(s) into tutor notes", len(lint.spans))
    return activity.model_copy(
        update={"teaching_goal": new_goal, "tutor_notes": merge_notes(activity.tutor_notes, notes)}
    )


__all__ = [
    "LINT_TIMEOUT_S",
    "MAX_SPANS",
    "PROMPT_VERSION",
    "SPAN_KINDS",
    "GoalLint",
    "PedagogySpan",
    "activity_class_id",
    "authoring_teaching",
    "build_lint_prompt",
    "clean_import",
    "lint_teaching_goal",
    "merge_notes",
    "parse_lint",
    "split_tutor_notes",
    "text_hash",
]
