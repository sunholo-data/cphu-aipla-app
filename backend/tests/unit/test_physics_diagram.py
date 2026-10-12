"""draw_physics_diagram: the physics in a tutor's diagram is computed, not guessed.

The main criticism of the tutors' SVGs was wrong physics. Each test here measures
a physical property ON THE DRAWN SVG (angles in px, arrow lengths, perpendiculars)
rather than trusting the spec, because the failure being guarded is "the picture
disagrees with the physics" — the first live illustrator run drew v₀ at 39.8° and
its trajectory launching at 57.5°.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import xml.etree.ElementTree as ET
from types import SimpleNamespace

import pytest

from adk.physics_diagram import SpecError, build_physics_svg, draw_physics_diagram, evaluate
from adk.svg_preview import LAST_GOOD_KEY, PREVIEW_STATE_KEY, lint_svg, scoped
from adk.tools import TOOL_REGISTRY

NS = "{http://www.w3.org/2000/svg}"

THROW = {
    "params": {"v0": 15, "theta": 40},
    "elements": [
        {"type": "ground"},
        {"type": "trajectory", "id": "path", "from": [0, 0], "v0": "v0", "angle_deg": "theta"},
        {
            "type": "vector",
            "id": "v",
            "from": "path.start",
            "magnitude": "v0",
            "direction": {"tangent": "path"},
            "kind": "velocity",
            "label": "v₀",
        },
        {"type": "components", "of": "v", "labels": ["vₓ", "vᵧ"]},
        {"type": "angle", "between": ["horizontal", "v"], "label": "40°"},
    ],
}

INCLINE = {
    "params": {"m": 2, "g": 9.82, "theta": 30},
    "elements": [
        {"type": "incline", "id": "ramp", "angle_deg": "theta", "length": 4},
        {"type": "block", "id": "box", "on": "ramp", "at": 0.55, "size": 0.6},
        {"type": "vector", "id": "G", "from": "box", "magnitude": "m*g", "direction": "down", "label": "Fg"},
        {
            "type": "vector",
            "id": "N",
            "from": "box",
            "magnitude": "m*g*cos(theta)",
            "direction": {"normal": "ramp"},
            "label": "Fₙ",
        },
        {
            "type": "vector",
            "id": "f",
            "from": "box",
            "magnitude": "m*g*sin(theta)",
            "direction": {"along": "ramp", "sense": "up"},
            "label": "Fₛ",
        },
    ],
    "checks": [{"equilibrium": "box"}],
}


def _lines(svg: str) -> list[dict]:
    root = ET.fromstring(svg)
    return [el.attrib for el in root.iter(f"{NS}line")]


def _screen_angle(line: dict) -> float:
    """Angle CCW from +x, in degrees, as the student SEES it (SVG y is down)."""
    dx = float(line["x2"]) - float(line["x1"])
    dy = float(line["y1"]) - float(line["y2"])
    return math.degrees(math.atan2(dy, dx))


def _length(line: dict) -> float:
    return math.hypot(float(line["x2"]) - float(line["x1"]), float(line["y2"]) - float(line["y1"]))


def _arrows(svg: str, colour: str) -> list[dict]:
    return [ln for ln in _lines(svg) if ln.get("stroke") == colour and ln.get("stroke-width") == "2"]


# --- the physics is in the picture ---


def test_the_trajectory_leaves_along_the_velocity_vector():
    """The exact fault of the first live run, made impossible by construction."""
    svg, problems, _ = build_physics_svg(THROW)
    assert problems == []
    (v,) = [ln for ln in _arrows(svg, "#1e40af") if "stroke-dasharray" not in ln]
    assert _screen_angle(v) == pytest.approx(40, abs=0.6)
    pts = re.search(r'<polyline points="([^"]+)"[^>]*stroke="#1e40af"', svg).group(1).split()
    (x0, y0), (x1, y1) = (tuple(map(float, p.split(","))) for p in pts[:2])
    launch = math.degrees(math.atan2(y0 - y1, x1 - x0))
    assert launch == pytest.approx(40, abs=1.5), "the path must launch at θ, not wherever a model put a control point"


def test_components_close_the_parallelogram():
    svg, _, report = build_physics_svg(THROW)
    vx, vy = report["vectors"]["v.x"], report["vectors"]["v.y"]
    assert vx["magnitude"] == pytest.approx(15 * math.cos(math.radians(40)), rel=1e-3)
    assert vy["magnitude"] == pytest.approx(15 * math.sin(math.radians(40)), rel=1e-3)
    green = _arrows(svg, "#16a34a")
    angles = sorted(round(_screen_angle(g)) for g in green)
    assert angles == [0, 90]


def test_normal_is_perpendicular_to_the_slope_and_gravity_is_straight_down():
    svg, _, _ = build_physics_svg(INCLINE)
    red = {round(_screen_angle(a)): a for a in _arrows(svg, "#dc2626")}
    assert set(red) == {-90, 120, 30}, "gravity down, normal at 30°+90°, friction up the 30° slope"


def test_arrow_lengths_are_proportional_to_the_forces():
    svg, _, _ = build_physics_svg(INCLINE)
    by_angle = {round(_screen_angle(a)): _length(a) for a in _arrows(svg, "#dc2626")}
    # Shaft lengths exclude the head (7 px), so compare shaft + head.
    gravity, normal, friction = (by_angle[a] + 7 for a in (-90, 120, 30))
    assert normal / gravity == pytest.approx(math.cos(math.radians(30)), rel=0.03)
    assert friction / gravity == pytest.approx(math.sin(math.radians(30)), rel=0.03)


def test_balanced_forces_pass_the_equilibrium_check():
    _, problems, report = build_physics_svg(INCLINE)
    assert problems == []
    assert report["net_force"]["box"]["magnitude"] == pytest.approx(0, abs=1e-9)


def test_wrong_physics_is_reported_not_drawn_quietly():
    """sin and cos swapped on the normal force — the model's physics error, caught."""
    spec = json.loads(json.dumps(INCLINE))
    spec["elements"][3]["magnitude"] = "m*g*sin(theta)"
    _, problems, _ = build_physics_svg(spec)
    assert len(problems) == 1 and "do not balance" in problems[0]


def test_the_computed_diagram_passes_its_own_layout_lint():
    """The placer and the lint share one box model; a computed diagram must not
    hand the model a layout problem it did not cause."""
    for spec in (THROW, INCLINE):
        svg, _, _ = build_physics_svg(spec)
        assert lint_svg(svg) == []


# --- spec handling ---


def test_expressions_are_arithmetic_only():
    assert evaluate("m*g*cos(60)", {"m": 2, "g": 10}) == pytest.approx(10)
    assert evaluate("sqrt(16) + 2**3", {}) == pytest.approx(12)
    for bad in ("__import__('os')", "m.__class__", "open('x')", "[1][0]"):
        with pytest.raises(SpecError):
            evaluate(bad, {"m": 1})


def test_a_bad_spec_comes_back_as_a_problem_the_model_can_fix():
    result = asyncio.run(draw_physics_diagram('{"elements": [{"type": "spring"}]}'))
    assert result["rendered"] is False
    assert "unknown element type 'spring'" in result["problems"][0]
    result = asyncio.run(draw_physics_diagram("not json"))
    assert "not valid JSON" in result["problems"][0]


def test_the_tool_returns_the_svg_and_parks_the_preview():
    ctx = SimpleNamespace(state={})
    result = asyncio.run(draw_physics_diagram(json.dumps(INCLINE), tool_context=ctx))
    assert result["rendered"] is True
    assert result["svg"].startswith("<svg")
    assert result["physics"]["net_force"]["box"]["magnitude"] == pytest.approx(0, abs=1e-9)
    assert ctx.state[scoped(PREVIEW_STATE_KEY, ctx)]
    assert ctx.state[scoped(LAST_GOOD_KEY, ctx)] == result["svg"]


def test_the_tool_is_registered():
    assert "draw_physics_diagram" in TOOL_REGISTRY


def test_the_shape_slips_seen_live_are_read_the_only_way_they_can_be():
    """Live runs sent correct physics with two shape slips — a vector without
    "type", and {"down": 1} for "down" — and each cost a round trip, then a
    fallback to freehand SVG that threw the computed physics away."""
    spec = json.loads(json.dumps(INCLINE))
    del spec["elements"][2]["type"]
    spec["elements"][2]["direction"] = {"down": 1}
    _, problems, report = build_physics_svg(spec)
    assert problems == []
    assert report["vectors"]["G"]["direction_deg"] == 270


def test_an_unreadable_element_is_quoted_back():
    with pytest.raises(SpecError, match='"colour": "red"'):
        build_physics_svg({"elements": [{"colour": "red"}]})


def test_more_shapes_seen_live():
    """A trajectory without "type", components "of" the trajectory (its v0), and
    an incline angle with no "at" (its foot) — each cost a live round trip."""
    throw = {
        "elements": [
            {"type": "ground"},
            {"id": "path", "from": [0, 0], "v0": 15, "angle_deg": 40},
            {"type": "components", "of": "path", "labels": ["v_{0x}", "v_{0y}"]},
            {"type": "angle", "between": ["horizontal", "path"], "label": "40°"},
        ]
    }
    _, problems, report = build_physics_svg(throw)
    assert problems == []
    assert report["vectors"]["path.v0.x"]["magnitude"] == pytest.approx(15 * math.cos(math.radians(40)), rel=1e-3)
    incline = json.loads(json.dumps(INCLINE))
    incline["elements"].append({"type": "angle", "between": ["horizontal", "ramp"], "label": "30°"})
    assert build_physics_svg(incline)[1] == []


def test_the_attempt_cap_is_code_not_a_request():
    """Live, the illustrator sometimes took 4 or 5 attempts (17 s). Both tools share
    one counter; past three, the tool tells it to answer and draws nothing."""
    ctx = SimpleNamespace(state={})
    from adk.svg_preview import render_svg_preview

    for _ in range(2):
        assert asyncio.run(draw_physics_diagram(json.dumps(INCLINE), tool_context=ctx))["rendered"] is True
    assert asyncio.run(render_svg_preview('<svg viewBox="0 0 9 9"/>', tool_context=ctx))["rendered"] is True
    refused = asyncio.run(draw_physics_diagram(json.dumps(INCLINE), tool_context=ctx))
    assert refused["rendered"] is False and "answer now" in refused["problems"][0]


@pytest.mark.parametrize(
    ("label", "shown"), [("40^\\circ", "40°"), ("$v_0$", "v0"), ("\\theta", "θ"), ("\\Delta t", "Δt")]
)
def test_latex_labels_are_drawn_as_plain_text(label, shown):
    """The maths-notation preamble pushes LaTeX into every answer, including the
    illustrator's labels; each one cost a live round trip."""
    from adk.svg_preview import lint_svg

    spec = {"elements": [{"type": "block", "id": "b", "at": [0, 0]},
                         {"type": "vector", "from": "b", "magnitude": 1, "direction": "up", "label": label}]}  # fmt: skip
    svg, _, _ = build_physics_svg(spec)
    assert lint_svg(svg) == []
    text = "".join(ET.fromstring(svg).find(f"{NS}text").itertext())
    assert text == shown


def test_an_angle_written_without_type_is_still_an_angle():
    incline = json.loads(json.dumps(INCLINE))
    incline["elements"].append({"label": "30°", "between": ["horizontal", "ramp"], "angle_deg": 30})
    assert build_physics_svg(incline)[1] == []


def test_a_diagram_with_wrong_physics_is_never_remembered_as_good():
    ctx = SimpleNamespace(state={})
    spec = json.loads(json.dumps(INCLINE))
    spec["elements"][3]["magnitude"] = "m*g*sin(theta)"
    result = asyncio.run(draw_physics_diagram(json.dumps(spec), tool_context=ctx))
    assert result["rendered"] is True  # the model still sees it, to fix it
    assert scoped(LAST_GOOD_KEY, ctx) not in ctx.state
