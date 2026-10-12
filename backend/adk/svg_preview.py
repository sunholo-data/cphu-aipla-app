"""SVG preview — let a drawing agent SEE the diagram it wrote, then repair it.

Why this exists. The tutors can draw (chat renders ```svg fences through
DOMPurify, ``frontend/src/components/chat/media/SVGBlock.tsx``), and the
diagrams kept coming out wrong: labels on top of lines, arrows pointing the
wrong way, text smeared by an inherited stroke, shapes outside the viewBox. The
model writes SVG source blind — it never sees the picture — so it cannot notice,
let alone fix, any of that.

``render_svg_preview`` closes the loop for the ``svg-illustrator`` skill (an
ADK app skill in ``backend/skills/templates/``, reached by tutors through
``agentTools``):

1. **Lint** the source against what the chat sanitiser will strip and against
   the faults that have actually shipped (:func:`lint_svg`).
2. **Render** it to PNG with resvg (:func:`render_svg_png`) — no browser, no
   system libraries; the backend image ships ``fonts-dejavu-core`` so ``<text>``
   renders at all.
3. **Show** the PNG to the model. The tool cannot return an image itself (ADK
   function results are JSON), so it parks the PNG in temp state and
   :func:`attach_svg_preview` — called from ``create_agent``'s composed
   before-model callback — puts it INSIDE the function response as a
   ``FunctionResponsePart`` (Gemini 3 multimodal function responses).

   Verified live 2026-10-12 on ``gemini-3.5-flash-lite`` / ``eu``: the model
   described an image it had only ever seen as pixels. The obvious alternative —
   appending an image ``Part`` beside the function response in the same
   ``Content`` — is rejected by Gemini with ``400 Requests ending with a model
   turn are not supported``, so do not "simplify" this to that.

The image lives only in the outgoing request, never in session history: each
model call sees the LATEST render and nothing older, which is what a repair loop
wants and keeps the token cost to one image per call.
"""

from __future__ import annotations

import base64
import itertools
import logging
import re
import xml.etree.ElementTree as ET
from typing import Any

logger = logging.getLogger(__name__)

#: Temp-state key the tool parks the rendered PNG under (base64 text, so the
#: state delta stays JSON-serialisable). ``temp:`` keys never persist.
PREVIEW_STATE_KEY = "temp:svg_preview_png"

TOOL_NAME = "render_svg_preview"
#: Every tool whose function response the parked preview may be attached to —
#: ``draw_physics_diagram`` (adk/physics_diagram.py) renders through this module.
PREVIEW_TOOLS = frozenset({TOOL_NAME, "draw_physics_diagram"})

#: Render width in px. Wide enough to read 11px labels, small enough to keep the
#: image cheap (~one image's worth of tokens per repair round).
RENDER_WIDTH = 480

#: Over this the source is a sign of a runaway path, not a diagram.
MAX_SVG_BYTES = 24_000

_SVG_NS = "http://www.w3.org/2000/svg"

# Mirrors frontend SVGBlock.tsx PURIFY_CONFIG (FORBID_TAGS script/use;
# FORBID_ATTR href/xlink:href) plus what the svg profile drops anyway.
_STRIPPED_TAGS = {"script", "use", "foreignObject", "image", "iframe", "style"}
_STRIPPED_ATTRS = {"href"}

#: LaTeX that reaches a <text> label: $…$, \command, x^2, v_0 / v_{x}.
_LATEX = re.compile(r"\$|\\[A-Za-z]+|\^|_[{0-9A-Za-z]")


def _local(name: str) -> str:
    """``{ns}tag`` → ``tag``."""
    return name.rsplit("}", 1)[-1]


def _style_value(el: ET.Element, prop: str) -> str | None:
    """The value of ``prop`` from an attribute or the inline ``style``."""
    style = el.get("style") or ""
    m = re.search(rf"(?:^|;)\s*{prop}\s*:\s*([^;]+)", style)
    if m:
        return m.group(1).strip()
    return el.get(prop)


def _num(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


def lint_svg(svg: str) -> list[str]:
    """Return human-readable problems with ``svg`` — empty when none found.

    Static checks only; the rendered picture is the real test. Each message says
    what the student would see, because that is what the drawing agent can act on.
    """
    problems: list[str] = []
    if len(svg.encode("utf-8")) > MAX_SVG_BYTES:
        problems.append(f"The SVG is over {MAX_SVG_BYTES // 1000} KB — simplify it; a chat diagram needs far less.")
    if re.search(r"<!(DOCTYPE|ENTITY)", svg, re.IGNORECASE):
        return [*problems, "Remove the <!DOCTYPE>/<!ENTITY> declaration — it is not allowed."]
    try:
        root = ET.fromstring(svg)
    except ET.ParseError as exc:
        return [*problems, f"The SVG is not well-formed XML ({exc}); nothing would render."]

    if _local(root.tag) != "svg":
        return [*problems, "The root element must be <svg>."]
    view_box = (root.get("viewBox") or "").replace(",", " ").split()
    if len(view_box) != 4 or any(_num(v) is None for v in view_box):
        problems.append('The root <svg> needs viewBox="0 0 W H" so the chat can scale it.')
        vb = None
    else:
        vb = [float(v) for v in view_box]

    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    labels: list[tuple[str, tuple[float, float, float, float]]] = []

    def walk(el: ET.Element, stroke: str | None, transformed: bool) -> None:
        tag = _local(el.tag)
        own_stroke = _style_value(el, "stroke")
        stroke_here = own_stroke if own_stroke is not None else stroke
        transformed = transformed or el.get("transform") is not None
        if tag in _STRIPPED_TAGS:
            problems.append(
                f"<{tag}> is stripped by the chat's sanitiser — it will not appear. Draw it with basic shapes."
            )
        for attr in el.attrib:
            name = _local(attr)
            if name in _STRIPPED_ATTRS:
                problems.append(f"The {name} attribute on <{tag}> is stripped by the chat's sanitiser.")
            elif name.lower().startswith("on"):
                problems.append(f"Event handler {name}= on <{tag}> is stripped; remove it.")
        if tag == "text":
            # The maths-notation preamble tells every agent to write LaTeX, and
            # it reaches the illustrator too: first live run drew "v_0" and
            # "40^\circ" as literal text. SVG text is plain text.
            text = "".join(el.itertext())
            if _LATEX.search(text):
                problems.append(
                    f'The label "{text.strip()[:20]}" is LaTeX, which SVG shows as raw characters. '
                    "Use Unicode instead (v₀, vₓ, 40°, Δt, λ), or for a subscript Unicode lacks, "
                    '<tspan baseline-shift="sub" font-size="8">g</tspan>.'
                )
            if stroke_here and stroke_here.lower() not in {"none", "transparent"} and own_stroke is None:
                problems.append(
                    f'A <text> label inherits stroke="{stroke_here}" from a parent, so it renders smeared and '
                    'bold. Put stroke="none" on every <text>.'
                )
            if vb and not transformed:
                x, y = _num(el.get("x")), _num(el.get("y"))
                label = "".join(el.itertext()).strip()[:20]
                if (
                    x is not None
                    and y is not None
                    and not (vb[0] <= x <= vb[0] + vb[2] and vb[1] <= y <= vb[1] + vb[3])
                ):
                    problems.append(f'The label "{label}" is placed outside the viewBox and will be cut off.')
        if not transformed:
            if tag == "text":
                box = _text_box(el)
                if box is not None:
                    labels.append(("".join(el.itertext()).strip()[:20], box))
            elif tag != "polygon" or (_style_value(el, "stroke") or "none") != "none":
                # a filled polygon with no stroke is an arrowhead/marker; its
                # line is what matters, and the label may sit beside the head
                segments.extend(_segments(el, tag))
        for child in el:
            walk(child, stroke_here, transformed)

    walk(root, None, False)
    # Labels on lines: a model looking at its render missed "40°" sitting on
    # the v0 arrow (first live run); geometry does not miss it.
    for text, box in labels:
        if any(_seg_hits_box(a, b, box) for a, b in segments):
            problems.append(f'The label "{text}" overlaps a line — move it clear by a few units.')
    for i, (t1, b1) in enumerate(labels):
        for t2, b2 in labels[i + 1 :]:
            if not (b1[2] < b2[0] or b2[2] < b1[0] or b1[3] < b2[1] or b2[3] < b1[1]):
                problems.append(f'The labels "{t1}" and "{t2}" overlap each other.')
    return problems


def _text_box(el: ET.Element) -> tuple[float, float, float, float] | None:
    """Approximate ink box of a <text> (start-anchored, alphabetic baseline).

    Shrunk by a unit on each side so a label merely near a line is not flagged."""
    x, y = _num(el.get("x")), _num(el.get("y"))
    text = "".join(el.itertext()).strip()
    if x is None or y is None or not text:
        return None
    size = _num((_style_value(el, "font-size") or "11").replace("px", "")) or 11.0
    width = 0.55 * size * len(text)
    anchor = _style_value(el, "text-anchor") or "start"
    x0 = x - width / 2 if anchor == "middle" else x - width if anchor == "end" else x
    return (x0 + 1, y - 0.7 * size + 1, x0 + width - 1, y - 1)


def _segments(el: ET.Element, tag: str) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Straight segments of line / polyline / polygon / rect (paths are skipped)."""
    if tag == "line":
        p = [_num(el.get(k)) for k in ("x1", "y1", "x2", "y2")]
        return [((p[0], p[1]), (p[2], p[3]))] if None not in p else []
    if tag in ("polyline", "polygon"):
        nums = [_num(v) for v in re.split(r"[\s,]+", (el.get("points") or "").strip()) if v]
        if None in nums or len(nums) < 4:
            return []
        pts = list(zip(nums[::2], nums[1::2], strict=False))
        if tag == "polygon":
            pts.append(pts[0])
        return list(itertools.pairwise(pts))
    if tag == "rect":
        x, y, w, h = (_num(el.get(k)) or 0.0 for k in ("x", "y", "width", "height"))
        c = [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]
        return list(itertools.pairwise(c))
    return []


def _seg_hits_box(a, b, box) -> bool:
    x0, y0, x1, y1 = box
    if max(a[0], b[0]) < x0 or min(a[0], b[0]) > x1 or max(a[1], b[1]) < y0 or min(a[1], b[1]) > y1:
        return False
    steps = 24
    return any(
        x0 <= a[0] + (b[0] - a[0]) * t / steps <= x1 and y0 <= a[1] + (b[1] - a[1]) * t / steps <= y1
        for t in range(steps + 1)
    )


def render_svg_png(svg: str, width: int = RENDER_WIDTH) -> bytes:
    """Rasterise ``svg`` to PNG on white. Raises ``ValueError`` if it cannot.

    ``currentColor`` resolves to black here; in the chat it is the text colour,
    which is close enough for checking geometry and legibility.
    """
    import resvg_py  # imported lazily: only the illustrator skill needs it

    if 'xmlns="' not in svg[:500]:
        # resvg (like any XML renderer) needs the namespace; browsers forgive its
        # absence inline, so models routinely omit it.
        svg = svg.replace("<svg", f'<svg xmlns="{_SVG_NS}"', 1)
    return bytes(resvg_py.svg_to_bytes(svg_string=svg, width=width, background="white"))


#: Temp-state counter of drawing attempts in this illustration, shared by both
#: drawing tools. The prompt asks for at most three; live, the model sometimes
#: took four or five (17 s), so the cap is code, not a request.
ATTEMPTS_KEY = "temp:svg_attempts"
MAX_ATTEMPTS = 3

#: The last diagram a tool produced AND passed: a physics diagram whose physics
#: checks passed, or a freehand SVG that was rendered. It, not the model's final
#: text, is what the illustrator returns (see :func:`make_final_svg_guard`).
LAST_GOOD_KEY = "temp:svg_last_good"


def scoped(key: str, ctx: Any) -> str:
    """``key`` for THIS illustration only.

    AgentTool copies the tutor's state into each illustrator run and copies the
    run's deltas back, so an unscoped counter or last-good diagram would leak
    into the next illustration of the same turn — starting it at the attempt cap,
    or handing it the previous diagram. Each AgentTool run has its own
    invocation id."""
    return f"{key}:{getattr(ctx, 'invocation_id', '') or ''}"


def remember_good(svg: str, tool_context: Any) -> None:
    if tool_context is not None:
        tool_context.state[scoped(LAST_GOOD_KEY, tool_context)] = svg


#: What the illustrator answers when nothing it drew passed: the tutor carries on
#: in words. A missing diagram is recoverable; a wrong one is taught.
NO_DIAGRAM = "No diagram: none of the attempts passed its checks. Explain it in words instead."


def make_final_svg_guard() -> Any:
    """after_model callback for an agent holding the drawing tools.

    Its final answer becomes the last diagram a tool produced and checked —
    never SVG the model wrote in its answer. Live runs showed why both halves
    matter: the model REWROTE a correct computed diagram in its final answer
    (components no longer dashed, geometry no longer computed), and after the
    attempt cap it hand-wrote a fresh diagram with the block floating off the
    slope and returned it unchecked."""

    async def _guard(callback_context: Any, llm_response: Any) -> None:
        content = getattr(llm_response, "content", None)
        if getattr(llm_response, "partial", False) or content is None or not content.parts:
            return
        if any(getattr(p, "function_call", None) for p in content.parts):
            return  # mid-loop: the model is still drawing
        if not any(getattr(p, "text", None) for p in content.parts):
            return
        from google.genai import types

        last = callback_context.state.get(scoped(LAST_GOOD_KEY, callback_context))
        content.parts = [types.Part(text=f"```svg\n{last}\n```" if last else NO_DIAGRAM)]

    return _guard


def spend_attempt(tool_context: Any) -> dict | None:
    """Count one drawing attempt; past the cap, return the refusal to send back."""
    if tool_context is None:
        return None
    key = scoped(ATTEMPTS_KEY, tool_context)
    used = int(tool_context.state.get(key) or 0) + 1
    tool_context.state[key] = used
    if used > MAX_ATTEMPTS:
        return {
            "rendered": False,
            "problems": [
                f"That was attempt {used}; the limit is {MAX_ATTEMPTS} because the student is waiting. "
                "Do not call a drawing tool again — answer now with your last rendered diagram."
            ],
        }
    return None


def preview(svg: str, tool_context: Any = None) -> dict:
    """Lint + render + park the PNG. Uncounted: the public tools count."""
    problems = lint_svg(svg)
    try:
        png = render_svg_png(svg)
    except Exception as exc:  # resvg raises ValueError; anything else is the same outcome
        logger.info("svg preview render failed: %s", exc)
        return {"rendered": False, "problems": [*problems, f"It could not be rendered: {exc}"]}
    if tool_context is not None:
        tool_context.state[scoped(PREVIEW_STATE_KEY, tool_context)] = base64.b64encode(png).decode("ascii")
    return {"rendered": True, "problems": problems}


async def render_svg_preview(svg: str, tool_context: Any = None) -> dict:
    """Render an SVG diagram and look at the result before anyone else sees it.

    Call this with every draft. The rendered picture is attached to this result —
    look at it carefully: are labels readable and clear of lines, do arrows point
    the right way, is everything inside the frame, does it show what was asked?
    Fix what is wrong and call again.

    Args:
        svg: The complete <svg>…</svg> source, exactly as you would send it.

    Returns:
        ``rendered`` (whether a picture is attached) and ``problems`` found by
        static checks — fix every one.
    """
    if (refusal := spend_attempt(tool_context)) is not None:
        return refusal
    result = preview(svg, tool_context)
    if result["rendered"]:
        # Freehand: rendered is the most that can be verified (no physics model).
        remember_good(svg, tool_context)
        result["note"] = "The rendered picture is attached. Check it against the brief before you answer."
    return result


async def attach_svg_preview(callback_context: Any, llm_request: Any) -> bool:
    """Put a parked preview PNG inside its function response; True if attached.

    No-op (and cheap) for every agent that never called the tool — the state
    key is simply absent. Must run BEFORE the image-part check that strips
    grounding tools, so a turn carrying a preview is treated as multimodal.
    """
    state = getattr(callback_context, "state", None)
    if state is None:
        return False
    key = scoped(PREVIEW_STATE_KEY, callback_context)
    encoded = state.get(key)
    if not encoded:
        return False
    state[key] = ""

    from google.genai import types

    contents = getattr(llm_request, "contents", None) or []
    if not contents:
        return False
    for part in reversed(contents[-1].parts or []):
        fr = getattr(part, "function_response", None)
        if fr is not None and fr.name in PREVIEW_TOOLS:
            fr.parts = [types.FunctionResponsePart.from_bytes(data=base64.b64decode(encoded), mime_type="image/png")]
            return True
    logger.warning("svg preview parked but no preview-tool function response in the request; dropped")
    return False
