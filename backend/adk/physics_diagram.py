"""Physics diagrams whose geometry is COMPUTED, not drawn by a language model.

Why this exists. The main criticism of the tutors' SVG diagrams was never the
styling — it was the physics: a trajectory leaving the ground at a different
angle from the velocity vector drawn on it, a normal force not perpendicular to
the slope, force arrows whose lengths say nothing about their sizes, forces on a
block "at rest" that do not balance. Rendering the SVG and letting the model look
(``adk/svg_preview.py``) fixes layout, but a model eyeballing a picture cannot
tell 40° from 57°. The first live illustrator run proved it: its v₀ arrow was at
39.8°, its trajectory left the ground at 57.5°, and the visual check passed it.

So the drawing agent describes the PHYSICS — an incline of 30°, a block at rest
on it, v₀ = 15 m/s at 40°, forces as expressions like ``m*g*cos(30)`` — and this
module computes every coordinate from it (the principle the ``anatomy`` skill is
built on: every number the figure shows comes from the same model that places its
parts):

- one uniform world→SVG scale, so angles on screen ARE the physical angles;
- a trajectory is sampled from the kinematics, so its launch tangent is the v₀
  direction by construction;
- one scale per vector kind (force, velocity, acceleration), so lengths are
  proportional to magnitudes within a kind;
- normals and "along the slope" are derived from the incline, gravity is "down";
- ``checks: [{"equilibrium": "<body>"}]`` sums the forces on a body and reports a
  non-zero net force as a problem — which catches the model's PHYSICS, not just
  its drawing.

The SVG it produces then goes through the same render → look → repair loop as a
freehand one (layout: label collisions, crowding), via ``svg_preview``.

Spec reference: the ``draw_physics_diagram`` docstring and the svg-illustrator
SKILL.md. World units are metres (or any consistent unit), y up, angles in degrees
counter-clockwise from +x.
"""

from __future__ import annotations

import ast
import itertools
import json
import math
import operator
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from adk import svg_preview

TOOL_NAME = "draw_physics_diagram"

COLOURS = {
    "force": "#dc2626",
    "velocity": "#1e40af",
    "acceleration": "#7c3aed",
    "other": "#0f172a",
    "component": "#16a34a",
    "structure": "#78716c",
    "body": "#334155",
}

#: Longest arrow of each kind, as a fraction of the scene's size.
_ARROW_SHARE = 0.38
_FONT = 11
_HEAD_LEN = 7.0
_HEAD_HALF = 3.5


class SpecError(ValueError):
    """A spec the drawer cannot honour; the message is shown to the model."""


# --- safe arithmetic for magnitudes ------------------------------------------

_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Pow: pow}
_FUNCS = {
    "sin": lambda d: math.sin(math.radians(d)),
    "cos": lambda d: math.cos(math.radians(d)),
    "tan": lambda d: math.tan(math.radians(d)),
    "sqrt": math.sqrt,
    "abs": abs,
}


def evaluate(expr: Any, params: dict[str, float]) -> float:
    """A number, or an arithmetic expression over ``params`` (trig in DEGREES)."""
    if isinstance(expr, bool):
        raise SpecError(f"{expr!r} is not a number")
    if isinstance(expr, (int, float)):
        return float(expr)
    if not isinstance(expr, str):
        raise SpecError(f"{expr!r} is not a number or an expression")

    def ev(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id in params:
                return float(params[node.id])
            if node.id == "pi":
                return math.pi
            raise SpecError(f"unknown name {node.id!r} in {expr!r}; define it in params")
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            return float(_BIN[type(node.op)](ev(node.left), ev(node.right)))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            value = ev(node.operand)
            return -value if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS:
            if len(node.args) != 1 or node.keywords:
                raise SpecError(f"{node.func.id}() takes one argument")
            return float(_FUNCS[node.func.id](ev(node.args[0])))
        raise SpecError(f"unsupported expression {expr!r}")

    try:
        return ev(ast.parse(expr, mode="eval"))
    except SyntaxError as exc:
        raise SpecError(f"cannot read expression {expr!r}") from exc


# --- the scene ----------------------------------------------------------------

Vec = tuple[float, float]


def _add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1])


def _mul(a: Vec, k: float) -> Vec:
    return (a[0] * k, a[1] * k)


def _unit(angle_deg: float) -> Vec:
    r = math.radians(angle_deg)
    return (math.cos(r), math.sin(r))


def _angle_of(v: Vec) -> float:
    return math.degrees(math.atan2(v[1], v[0]))


@dataclass
class _Vector:
    id: str
    origin: Vec
    direction: float  # degrees
    magnitude: float
    kind: str
    label: str
    body: str | None
    dashed: bool = False
    colour: str | None = None


@dataclass
class _Scene:
    params: dict[str, float]
    points: dict[str, Vec] = field(default_factory=dict)  # named world points
    directions: dict[str, float] = field(default_factory=dict)  # named directions
    bodies: dict[str, Vec] = field(default_factory=dict)  # body id -> centre
    inclines: dict[str, dict] = field(default_factory=dict)
    polylines: list[tuple[list[Vec], str, bool]] = field(default_factory=list)  # world polylines: pts, colour, dashed
    polygons: list[tuple[list[Vec], str]] = field(default_factory=list)  # filled-outline world polygons
    balls: list[tuple[Vec, str]] = field(default_factory=list)
    vectors: list[_Vector] = field(default_factory=list)
    angles: list[dict] = field(default_factory=list)
    labels: list[dict] = field(default_factory=list)
    ground: bool = False

    def point(self, ref: Any) -> Vec:
        if isinstance(ref, (list, tuple)) and len(ref) == 2:
            return (evaluate(ref[0], self.params), evaluate(ref[1], self.params))
        if isinstance(ref, str) and ref in self.points:
            return self.points[ref]
        if isinstance(ref, str) and ref in self.bodies:
            return self.bodies[ref]
        raise SpecError(f"unknown point {ref!r}; use [x, y] or the id of an earlier element")

    def direction(self, ref: Any) -> float:
        """Degrees, CCW from +x."""
        named = {"right": 0.0, "horizontal": 0.0, "up": 90.0, "vertical": 90.0, "left": 180.0, "down": -90.0}
        if isinstance(ref, (int, float, str)) and not isinstance(ref, bool):
            if isinstance(ref, str) and ref in named:
                return named[ref]
            if isinstance(ref, str) and ref in self.directions:
                return self.directions[ref]
            if isinstance(ref, str) and ref in self.inclines:
                return self.inclines[ref]["uphill"]
            return evaluate(ref, self.params)
        if isinstance(ref, dict):
            # {"down": 1} — a named direction written as a one-key object (live runs).
            if len(ref) == 1 and next(iter(ref)) in named:
                return named[next(iter(ref))]
            if "angle_deg" in ref:
                return evaluate(ref["angle_deg"], self.params)
            if "normal" in ref:
                return self._incline(ref["normal"])["normal"]
            if "along" in ref:
                inc = self._incline(ref["along"])
                return inc["uphill"] if ref.get("sense", "up") == "up" else inc["uphill"] + 180.0
            if "tangent" in ref:
                key = f"{ref['tangent']}.start"
                if key not in self.directions:
                    raise SpecError(f"{ref['tangent']!r} is not a trajectory")
                return self.directions[key]
        raise SpecError(
            f"unknown direction {ref!r}; use an angle, up/down/left/right, an incline id, "
            '{"normal": id}, {"along": id, "sense": "up"|"down"}, {"tangent": trajectory id} or a vector id'
        )

    def _incline(self, ref: str) -> dict:
        if ref not in self.inclines:
            raise SpecError(f"unknown incline {ref!r}")
        return self.inclines[ref]


def _build(spec: dict) -> tuple[_Scene, list[str], dict]:
    if not isinstance(spec, dict) or not isinstance(spec.get("elements"), list) or not spec["elements"]:
        raise SpecError('the spec needs an "elements" list')
    params = {}
    for name, value in (spec.get("params") or {}).items():
        params[name] = evaluate(value, params)
    scene = _Scene(params=params)
    pending_components: list[dict] = []
    launches: dict[str, _Vector] = {}  # trajectory id -> its launch velocity (not drawn)

    for i, el in enumerate(spec["elements"]):
        if isinstance(el, dict) and "type" not in el:
            # Live runs left "type" off otherwise-correct elements. Infer it only
            # where one element type could be meant.
            if "magnitude" in el and "direction" in el:
                el = {**el, "type": "vector"}
            elif "v0" in el and "angle_deg" in el:
                el = {**el, "type": "trajectory"}
            elif "between" in el:
                el = {**el, "type": "angle"}
        if not isinstance(el, dict) or "type" not in el:
            raise SpecError(f"element {i} needs a type: {json.dumps(el, ensure_ascii=False)[:200]}")
        kind, eid = el["type"], el.get("id") or f"{el['type']}{i}"
        if kind == "ground":
            scene.ground = True
        elif kind == "incline":
            theta = evaluate(el["angle_deg"], params)
            length = evaluate(el.get("length", 4), params)
            a = scene.point(el.get("at", [0, 0]))
            rises_right = el.get("rises", "right") == "right"
            uphill = theta if rises_right else 180.0 - theta
            top = _add(a, _mul(_unit(uphill), length))
            foot = (top[0], a[1])
            scene.polygons.append(([a, foot, top], COLOURS["structure"]))
            normal = uphill + 90.0 if rises_right else uphill - 90.0
            scene.inclines[eid] = {"angle": theta, "uphill": uphill, "normal": normal, "start": a, "length": length}
            scene.points[f"{eid}.bottom"], scene.points[f"{eid}.top"], scene.points[f"{eid}.corner"] = a, top, foot
            scene.directions[eid] = uphill
            scene.ground = True
        elif kind == "block":
            size = evaluate(el.get("size", 0.6), params)
            if "on" in el:
                inc = scene._incline(el["on"])
                t = evaluate(el.get("at", 0.5), params)
                contact = _add(inc["start"], _mul(_unit(inc["uphill"]), t * inc["length"]))
                u, n = _unit(inc["uphill"]), _unit(inc["normal"])
            else:
                contact = scene.point(el.get("at", [0, 0]))
                u, n = (1.0, 0.0), (0.0, 1.0)
            half = _mul(u, size / 2)
            up = _mul(n, size)
            corners = [_add(contact, _mul(half, -1)), _add(contact, half)]
            corners += [_add(corners[1], up), _add(corners[0], up)]
            scene.polygons.append((corners, COLOURS["body"]))
            scene.bodies[eid] = _add(contact, _mul(n, size / 2))
            scene.points[f"{eid}.contact"] = contact
        elif kind == "ball":
            p = scene.point(el.get("at", [0, 0]))
            scene.balls.append((p, COLOURS["velocity"]))
            scene.bodies[eid] = p
        elif kind == "trajectory":
            start = scene.point(el.get("from", [0, 0]))
            v0, theta = evaluate(el["v0"], params), evaluate(el["angle_deg"], params)
            g = evaluate(el.get("g", 9.82), params)
            if v0 <= 0 or g <= 0:
                raise SpecError("a trajectory needs v0 > 0 and g > 0")
            vx, vy = v0 * math.cos(math.radians(theta)), v0 * math.sin(math.radians(theta))
            land_y = 0.0 if el.get("until", "ground") == "ground" else start[1]
            # time to come back down to land_y: start_y + vy t - g t²/2 = land_y
            disc = vy * vy + 2 * g * (start[1] - land_y)
            if disc < 0:
                raise SpecError("that trajectory never reaches the landing height")
            t_end = (vy + math.sqrt(disc)) / g
            if el.get("show") == "to_apex":
                t_end = min(t_end, max(vy / g, 0.0))
            n = 48
            pts = [
                (start[0] + vx * t_end * k / n, start[1] + vy * t_end * k / n - g * (t_end * k / n) ** 2 / 2)
                for k in range(n + 1)
            ]
            scene.polylines.append((pts, COLOURS["velocity"], bool(el.get("dashed", True))))
            scene.points[f"{eid}.start"], scene.points[f"{eid}.end"] = pts[0], pts[-1]
            scene.points[f"{eid}.apex"] = max(pts, key=lambda p: p[1])
            scene.directions[f"{eid}.start"] = theta
            scene.directions[eid] = theta
            launches[eid] = _Vector(f"{eid}.v0", pts[0], theta, v0, "velocity", "", None)
        elif kind == "vector":
            frm = el.get("from", [0, 0])
            origin = scene.point(frm)
            body = frm.split(".")[0] if isinstance(frm, str) and frm.split(".")[0] in scene.bodies else None
            magnitude = evaluate(el["magnitude"], params)
            direction = scene.direction(el["direction"])
            if magnitude < 0:
                magnitude, direction = -magnitude, direction + 180.0
            vkind = el.get("kind", "force")
            if vkind not in ("force", "velocity", "acceleration", "other"):
                raise SpecError(f"vector kind {vkind!r} must be force, velocity, acceleration or other")
            vec = _Vector(eid, origin, direction, magnitude, vkind, str(el.get("label", "")), body)
            scene.vectors.append(vec)
            scene.directions[eid] = direction
        elif kind == "components":
            pending_components.append(el)
        elif kind == "angle":
            scene.angles.append(el)
        elif kind == "label":
            scene.labels.append(el)
        elif kind == "point":
            scene.points[eid] = scene.point(el["at"])
        else:
            raise SpecError(
                f"unknown element type {kind!r}; use ground, incline, block, ball, trajectory, vector, "
                "components, angle, label or point"
            )

    by_id = {v.id: v for v in scene.vectors}
    for el in pending_components:
        src = by_id.get(el.get("of"))
        if src is None and el.get("of") in launches:
            # "components of the trajectory" (live run) can only mean of its v0.
            src = next(
                (v for v in scene.vectors if v.kind == "velocity" and v.origin == launches[el["of"]].origin), None
            )
            src = src or launches[el["of"]]
        if src is None:
            raise SpecError(f"components: {el.get('of')!r} is not a vector or trajectory id")
        basis = el.get("basis", "xy")
        base = 0.0 if basis == "xy" else scene.direction(basis.get("incline") if isinstance(basis, dict) else basis)
        names = [*list(el.get("labels") or ["", ""]), "", ""]
        for k, axis in enumerate((base, base + 90.0)):
            proj = src.magnitude * math.cos(math.radians(src.direction - axis))
            comp = _Vector(f"{src.id}.{'xy'[k]}", src.origin, axis, proj, src.kind, names[k], None, dashed=True)
            comp.colour = COLOURS["component"]
            if comp.magnitude < 0:
                comp.magnitude, comp.direction = -comp.magnitude, comp.direction + 180.0
            if comp.magnitude > 1e-9:
                scene.vectors.append(comp)
                scene.directions[comp.id] = comp.direction

    problems: list[str] = []
    report: dict[str, Any] = {"vectors": {}}
    for v in scene.vectors:
        report["vectors"][v.id] = {"magnitude": round(v.magnitude, 4), "direction_deg": round(v.direction % 360, 2)}
    for check in spec.get("checks") or []:
        body = check.get("equilibrium") if isinstance(check, dict) else None
        if body is None:
            raise SpecError('a check must be {"equilibrium": "<body id>"}')
        forces = [v for v in scene.vectors if v.body == body and v.kind == "force" and not v.dashed]
        if not forces:
            problems.append(f'Equilibrium check: no forces are drawn from "{body}".')
            continue
        net = (0.0, 0.0)
        for f in forces:
            net = _add(net, _mul(_unit(f.direction), f.magnitude))
        size = math.hypot(*net)
        biggest = max(f.magnitude for f in forces)
        report.setdefault("net_force", {})[body] = {
            "magnitude": round(size, 4),
            "direction_deg": round(_angle_of(net) % 360, 2),
        }
        if size > 0.02 * biggest:
            problems.append(
                f'"{body}" is meant to be in equilibrium, but the forces drawn on it do not balance: the net force '
                f"is {size:.3g} at {_angle_of(net) % 360:.0f}° (largest force {biggest:.3g}). Check each magnitude "
                "and direction — the physics is wrong, not the drawing."
            )
    return scene, problems, report


# --- projection and SVG -------------------------------------------------------


def _segments_of(points: list[tuple[float, float]]) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    return list(itertools.pairwise(points))


def _seg_hits_rect(a, b, rect) -> bool:
    x0, y0, x1, y1 = rect
    if max(a[0], b[0]) < x0 or min(a[0], b[0]) > x1 or max(a[1], b[1]) < y0 or min(a[1], b[1]) > y1:
        return False
    # sample — cheap and adequate at diagram scale
    for k in range(11):
        t = k / 10
        x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        if x0 <= x <= x1 and y0 <= y <= y1:
            return True
    return False


def _render(scene: _Scene, width: float, height: float) -> str:
    # 1. Geometry extent (world), excluding arrows, which are sized from it.
    pts: list[Vec] = [p for poly, _ in scene.polygons for p in poly]
    pts += [p for line, _, _ in scene.polylines for p in line]
    pts += [p for p, _ in scene.balls] + list(scene.bodies.values()) + [v.origin for v in scene.vectors]
    xs, ys = [p[0] for p in pts] or [0.0], [p[1] for p in pts] or [0.0]
    scene_size = max(max(xs) - min(xs), max(ys) - min(ys), 1e-9)
    if scene_size < 1e-6:
        scene_size = 1.0
    # 2. One scale per vector kind: the longest arrow of a kind is _ARROW_SHARE of the scene.
    longest: dict[str, float] = {}
    for v in scene.vectors:
        longest[v.kind] = max(longest.get(v.kind, 0.0), v.magnitude)
    scale = {k: (_ARROW_SHARE * scene_size / m if m > 0 else 0.0) for k, m in longest.items()}
    tips: dict[str, Vec] = {}
    for v in scene.vectors:
        tips[v.id] = _add(v.origin, _mul(_unit(v.direction), v.magnitude * scale[v.kind]))
        pts.append(tips[v.id])
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    if scene.ground:
        miny = min(miny, 0.0)
    # 3. Uniform world→px scale (angles stay true), with room for labels.
    pad = 26.0
    span_x, span_y = max(maxx - minx, 1e-9), max(maxy - miny, 1e-9)
    k = min((width - 2 * pad) / span_x, (height - 2 * pad) / span_y)
    ox = pad + ((width - 2 * pad) - span_x * k) / 2
    oy = pad + ((height - 2 * pad) - span_y * k) / 2

    def px(p: Vec) -> tuple[float, float]:
        return (ox + (p[0] - minx) * k, height - (oy + (p[1] - miny) * k))

    def f(n: float) -> str:
        return f"{n:.1f}".rstrip("0").rstrip(".")

    out: list[str] = []
    occupied: list[tuple[tuple[float, float], tuple[float, float]]] = []  # px segments for label avoidance
    if scene.ground:
        gy = px((0.0, 0.0))[1]
        out.append(
            f'<line x1="8" y1="{f(gy)}" x2="{f(width - 8)}" y2="{f(gy)}" stroke="{COLOURS["structure"]}" '
            'stroke-width="1.5"/>'
        )
        occupied.append(((8, gy), (width - 8, gy)))
    for poly, colour in scene.polygons:
        p = [px(q) for q in poly]
        out.append(
            f'<polygon points="{" ".join(f"{f(x)},{f(y)}" for x, y in p)}" fill="none" stroke="{colour}" '
            'stroke-width="1.5" stroke-linejoin="round"/>'
        )
        occupied += _segments_of(p + p[:1])
    for line, colour, dashed in scene.polylines:
        p = [px(q) for q in line]
        dash = ' stroke-dasharray="4 3"' if dashed else ""
        out.append(
            f'<polyline points="{" ".join(f"{f(x)},{f(y)}" for x, y in p)}" fill="none" stroke="{colour}" '
            f'stroke-width="1.5"{dash}/>'
        )
        occupied += _segments_of(p)
    for p, colour in scene.balls:
        x, y = px(p)
        out.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="4" fill="{colour}" stroke="none"/>')
    by_id = {v.id: v for v in scene.vectors}
    for v in scene.vectors:
        a, b = px(v.origin), px(tips[v.id])
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length < 1:
            continue
        colour = v.colour or COLOURS[v.kind]
        ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        head = min(_HEAD_LEN, length * 0.6)
        shaft_end = (b[0] - ux * head, b[1] - uy * head)
        dash = ' stroke-dasharray="4 2"' if v.dashed else ""
        out.append(
            f'<line x1="{f(a[0])}" y1="{f(a[1])}" x2="{f(shaft_end[0])}" y2="{f(shaft_end[1])}" '
            f'stroke="{colour}" stroke-width="2"{dash}/>'
        )
        left = (shaft_end[0] - uy * _HEAD_HALF, shaft_end[1] + ux * _HEAD_HALF)
        right = (shaft_end[0] + uy * _HEAD_HALF, shaft_end[1] - ux * _HEAD_HALF)
        out.append(
            f'<polygon points="{f(b[0])},{f(b[1])} {f(left[0])},{f(left[1])} {f(right[0])},{f(right[1])}" '
            f'fill="{colour}" stroke="none"/>'
        )
        occupied.append((a, b))
        if v.dashed and "." in v.id:  # a component: dotted projection from the parent's tip
            parent = by_id.get(v.id.rsplit(".", 1)[0])
            if parent is not None:
                pt = px(tips[parent.id])
                out.append(
                    f'<line x1="{f(pt[0])}" y1="{f(pt[1])}" x2="{f(b[0])}" y2="{f(b[1])}" '
                    f'stroke="{COLOURS["structure"]}" stroke-width="0.8" stroke-dasharray="2 2"/>'
                )

    placed: list[tuple[float, float, float, float]] = []

    def put_label(text: str, anchor: tuple[float, float], prefer: float | None, colour: str) -> None:
        """Place a label clear of every drawn line and label.

        Scored with the SAME ink-box model ``svg_preview.lint_svg`` checks
        (start-anchored, 0.55·size per glyph, 0.7·size tall above the baseline),
        plus a margin, so the placer and the lint cannot disagree."""
        if not text:
            return
        markup, glyphs = _label_markup(_plain(text))
        w, h, margin = 0.55 * _FONT * glyphs, 0.7 * _FONT, 2.5
        angles = ([prefer] if prefer is not None else []) + list(range(0, 360, 30))
        best, best_score = None, math.inf
        order = 0
        for ang in angles:
            for dist in (6.0, 11.0, 17.0):
                # centre of the ink box, pushed out from the anchor along `ang`
                cx = anchor[0] + math.cos(math.radians(ang)) * (dist + w / 2)
                cy = anchor[1] - math.sin(math.radians(ang)) * (dist + h / 2)
                rect = (cx - w / 2 - margin, cy - h / 2 - margin, cx + w / 2 + margin, cy + h / 2 + margin)
                score = sum(3 for seg in occupied if _seg_hits_rect(seg[0], seg[1], rect))
                score += sum(
                    10 for r in placed if not (rect[2] < r[0] or rect[0] > r[2] or rect[3] < r[1] or rect[1] > r[3])
                )
                if rect[0] < 2 or rect[1] < 2 or rect[2] > width - 2 or rect[3] > height - 2:
                    score += 20
                score += order * 0.001  # stable preference for earlier (preferred) candidates
                order += 1
                if score < best_score:
                    best, best_score = (cx, cy, rect), score
        cx, cy, rect = best
        placed.append(rect)
        x, baseline = cx - w / 2, cy + h / 2
        out.append(
            f'<text x="{f(x)}" y="{f(baseline)}" font-size="{_FONT}" fill="{colour}" stroke="none">{markup}</text>'
        )

    for el in scene.angles:
        between = el.get("between") or [el[k] for k in ("from", "to") if k in el]
        if len(between) != 2:
            raise SpecError('an angle needs "between": [direction, direction]')
        d1, d2 = scene.direction(between[0]), scene.direction(between[1])
        if "at" in el:
            centre = scene.point(el["at"])
        elif isinstance(between[1], str) and between[1] in by_id:
            centre = by_id[between[1]].origin
        elif isinstance(between[0], str) and between[0] in by_id:
            centre = by_id[between[0]].origin
        elif any(isinstance(b, str) and b in scene.inclines for b in between):
            # the incline's angle sits at its foot (live run omitted "at")
            centre = scene.inclines[next(b for b in between if isinstance(b, str) and b in scene.inclines)]["start"]
        elif any(isinstance(b, str) and f"{b}.start" in scene.points for b in between):
            centre = scene.points[
                next(f"{b}.start" for b in between if isinstance(b, str) and f"{b}.start" in scene.points)
            ]
        else:
            raise SpecError('an angle needs "at" unless one side is a vector, incline or trajectory id')
        sweep = (d2 - d1 + 540.0) % 360.0 - 180.0  # signed, shortest way
        c = px(centre)
        r = 20.0
        n = max(6, int(abs(sweep) / 6))
        arc = [
            (
                c[0] + r * math.cos(math.radians(d1 + sweep * i / n)),
                c[1] - r * math.sin(math.radians(d1 + sweep * i / n)),
            )
            for i in range(n + 1)
        ]
        out.append(
            f'<polyline points="{" ".join(f"{f(x)},{f(y)}" for x, y in arc)}" fill="none" '
            f'stroke="{COLOURS["structure"]}" stroke-width="1"/>'
        )
        occupied += _segments_of(arc)
        mid = d1 + sweep / 2
        put_label(
            str(el.get("label", "")),
            (c[0] + (r - 6) * math.cos(math.radians(mid)), c[1] - (r - 6) * math.sin(math.radians(mid))),
            mid,
            COLOURS["structure"],
        )

    for v in scene.vectors:
        put_label(v.label, px(tips[v.id]), v.direction, v.colour or COLOURS[v.kind])
    for el in scene.labels:
        put_label(str(el.get("text", "")), px(scene.point(el["at"])), None, COLOURS["other"])

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(width)} {f(height)}">\n  '
        + "\n  ".join(out)
        + "\n</svg>"
    )


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


_SUB = re.compile(r"_(\{[^}]*\}|[0-9A-Za-z]+)")


#: LaTeX command -> the character it draws. Greek written by Unicode name so the
#: source stays unambiguous (ruff RUF001 flags the bare letters as look-alikes).
_LATEX_SYMBOLS = {
    "circ": "°",
    "degree": "°",
    "vec": "",
    "text": "",
    "mathrm": "",
    **{
        name: unicodedata.lookup(
            f"GREEK {'CAPITAL' if name[0].isupper() else 'SMALL'} LETTER {name.upper().replace('LAMBDA', 'LAMDA')}"
        )
        for name in (
            "theta",
            "alpha",
            "beta",
            "gamma",
            "phi",
            "omega",
            "Omega",
            "lambda",
            "mu",
            "Delta",
            "delta",
            "pi",
            "rho",
            "sigma",
            "tau",
        )
    },
}


def _plain(text: str) -> str:
    """Undo the LaTeX the maths-notation preamble pushes into every answer.

    Live runs labelled "40^\\circ", "$v_0$", "\\theta". In chat those render
    through KaTeX; in an SVG <text> they are raw characters, and the lint then
    costs a round trip. Only the common physics symbols — anything else is left
    for the lint to report."""
    text = text.replace("$", "")
    text = re.sub(r"\^\{?\\circ\}?", "°", text)
    text = re.sub(r"\\([A-Za-z]+)\s*", lambda m: _LATEX_SYMBOLS.get(m.group(1), m.group(0)), text)
    return text.replace("{", "").replace("}", "") if "_" not in text else text


def _label_markup(text: str) -> tuple[str, int]:
    """Label → (SVG text content, visible glyph count).

    ``F_g`` / ``F_{net}`` become real subscripts (``<tspan>``, which the chat's
    sanitiser keeps). Unicode has no subscript g, n-ish letters are patchy, and
    the first live run showed the model stuck on ``F_g`` for every render: told
    "that is LaTeX", it had nothing else to write."""
    parts, last, glyphs = [], 0, 0
    for m in _SUB.finditer(text):
        before = text[last : m.start()]
        sub = m.group(1).strip("{}")
        parts.append(_esc(before))
        parts.append(f'<tspan baseline-shift="sub" font-size="{_FONT - 3}">{_esc(sub)}</tspan>')
        glyphs += len(before) + len(sub)
        last = m.end()
    parts.append(_esc(text[last:]))
    glyphs += len(text) - last
    return "".join(parts), glyphs


def build_physics_svg(spec: dict) -> tuple[str, list[str], dict]:
    """Spec → (svg, physics problems, physics report). Raises ``SpecError``."""
    size = spec.get("size") or [240, 160]
    try:
        width, height = float(size[0]), float(size[1])
    except (TypeError, ValueError, IndexError) as exc:
        raise SpecError('"size" must be [width, height]') from exc
    scene, problems, report = _build(spec)
    return _render(scene, width, height), problems, report


async def draw_physics_diagram(spec_json: str | dict, tool_context: Any = None) -> dict:
    """Draw a mechanics diagram whose geometry is COMPUTED from the physics you give.

    Prefer this to writing SVG by hand whenever the scene is mechanics: angles,
    vector directions and proportions, trajectories and perpendiculars come out
    exactly right because code places them, not you. The picture is attached to the
    result; check its layout (labels, crowding), and fix every item in problems.

    Args:
        spec_json: JSON. {"params": {...}, "elements": [...], "checks": [...]}.
            World units are metres, y up, angles in degrees counter-clockwise from
            +x. Magnitudes may be numbers or expressions over params (trig takes
            degrees), e.g. "m*g*cos(theta)". Elements, in order:
            {"type":"ground"} ·
            {"type":"incline","id":"ramp","angle_deg":30,"length":4,"rises":"right"} ·
            {"type":"block","id":"box","on":"ramp","at":0.5,"size":0.6} (or "at":[x,y]
            without "on") ·
            {"type":"ball","id":"b","at":[0,0]} ·
            {"type":"trajectory","id":"path","from":[0,0],"v0":15,"angle_deg":40,"g":9.82} ·
            {"type":"vector","id":"N","from":"box","magnitude":"m*g*cos(theta)",
             "direction":{"normal":"ramp"},"kind":"force","label":"N"} — direction may
            be an angle, "up"/"down"/"left"/"right", {"normal":"ramp"},
            {"along":"ramp","sense":"up"|"down"}, {"tangent":"path"}; kind is force,
            velocity, acceleration or other ·
            {"type":"components","of":"v0","basis":"xy" | {"incline":"ramp"},
             "labels":["vₓ","vᵧ"]} ·
            {"type":"angle","between":["horizontal","v0"],"label":"40°"} ·
            {"type":"label","at":[x,y] or an id,"text":"..."}.
            checks: [{"equilibrium":"box"}] reports forces on a body that do not
            balance.

    Returns:
        ``svg`` (return this exactly), ``rendered``, ``problems`` and ``physics``
        (the computed magnitudes and directions, for your checking only).
    """
    if (refusal := svg_preview.spend_attempt(tool_context)) is not None:
        return refusal
    try:
        # Gemini often sends the spec as an object although the parameter is a
        # string; refusing it cost a round trip on every live diagram.
        spec = spec_json if isinstance(spec_json, dict) else json.loads(spec_json)
        svg, physics_problems, report = build_physics_svg(spec)
    except json.JSONDecodeError as exc:
        return {"rendered": False, "problems": [f"spec_json is not valid JSON: {exc}"]}
    except (SpecError, KeyError, TypeError, ZeroDivisionError, OverflowError) as exc:
        message = f"missing field {exc}" if isinstance(exc, KeyError) else str(exc)
        return {"rendered": False, "problems": [f"The spec could not be drawn: {message}"]}
    preview = svg_preview.preview(svg, tool_context)
    if preview["rendered"] and not physics_problems:
        # Only a diagram whose physics passed may reach the student.
        svg_preview.remember_good(svg, tool_context)
    return {
        "svg": svg,
        "rendered": preview["rendered"],
        "problems": physics_problems + preview["problems"],
        "physics": report,
        "note": (
            "The rendered picture is attached. Check the layout; the geometry is computed from your spec. "
            "Your final answer is replaced by the last diagram whose checks passed."
        ),
    }
