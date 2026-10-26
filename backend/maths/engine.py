r"""Parse, evaluate and format one calculation. Never ``eval``, never ``sympify``.

The grammar (design, "The engine"):

- numbers, names, ``+ - * / **`` (``^`` ``·`` ``×`` ``÷`` ``−`` are accepted and
  normalised), unary ``-``/``+``, and one-argument calls to the functions in
  ``_FUNCS``. Nothing else parses: no attributes, subscripts, comprehensions,
  lambdas or keywords, so ``__import__`` and friends are not names this
  grammar can reach.
- an exponent is a numeric literal (or a literal fraction such as ``1/2``) with
  ``|exponent| <= 10``. ``9**9**9`` is refused before anything is computed,
  which is the bound ``physics_diagram.evaluate`` lacks.
- caps on expression length, node count and quantity-string length. Together
  with the exponent cap they bound the work, which is why there is no thread
  timer: every accepted expression finishes in microseconds.

Angles are units. ``sin(30 deg)`` and ``sin(0.5 rad)`` work. ``sin(30)`` is an
ERROR, not a guess, because the two evaluators already in the repo disagree
on whether a bare number is degrees or radians (design F1).

A temperature in °C is an offset unit and cannot be multiplied. A
temperature *difference* is given in K. The error says so, rather than
silently treating 80 °C as 353 K inside ``m * c * dT``.
"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import re
from functools import lru_cache
from typing import Any

ENGINE_VERSION = "1"

MAX_EXPRESSION_CHARS = 300
MAX_NODES = 120
MAX_QUANTITIES = 20
MAX_QUANTITY_CHARS = 64
MAX_EXPONENT = 10

#: Constants a model may use without passing them. Each one used is named in
#: the result, so the student can be told which value was assumed. ``g`` is the
#: Danish stx value (open question O6); a ``g`` in ``quantities`` wins.
_CONSTANTS: dict[str, str] = {
    "g": "9.82 m/s**2",
    "c": "299792458 m/s",
}

_ANGLE_UNIT_NAMES = ("degree", "radian", "arcminute", "arcsecond", "turn")


class CalcError(ValueError):
    """A calculation the engine refuses. The message is written for the model."""


@lru_cache(maxsize=1)
def _ureg() -> Any:
    import pint

    return pint.UnitRegistry()


def _pint_version() -> str:
    import pint

    return getattr(pint, "__version__", "?")


def engine_label() -> str:
    return f"aipla-calc {ENGINE_VERSION} / pint {_pint_version()}"


# --- input normalisation -----------------------------------------------------

_DECIMAL_COMMA = re.compile(r"(?<=\d),(?=\d)")
_DOT_THOUSANDS = re.compile(r"^\s*-?\d{1,3}(\.\d{3})+(\s|$)")


def _normalise_expression(expression: str) -> str:
    s = expression.strip()
    for a, b in (("^", "**"), ("·", "*"), ("×", "*"), ("÷", "/"), ("−", "-"), ("⋅", "*")):
        s = s.replace(a, b)
    return _DECIMAL_COMMA.sub(".", s)


def _parse_quantity_value(raw: str) -> Any:
    """``"2000 W"``, ``"9,82 m/s^2"``, ``"3 min"`` → a pint Quantity."""
    text = str(raw).strip()
    if not text:
        raise CalcError("empty quantity value")
    if len(text) > MAX_QUANTITY_CHARS:
        raise CalcError(f"quantity value too long ({len(text)} chars, max {MAX_QUANTITY_CHARS})")
    if _DOT_THOUSANDS.match(text):
        raise CalcError(
            f"{text!r} is ambiguous: a dot can be a Danish thousands separator. Write 2000, not 2.000, or 2,0 for two."
        )
    text = _DECIMAL_COMMA.sub(".", text).replace("^", "**").replace("·", "*").replace("−", "-")
    ureg = _ureg()
    try:
        q = ureg.Quantity(text)
    except Exception as exc:  # pint raises several unrelated types for a bad string
        raise CalcError(f"cannot read the quantity {raw!r} ({type(exc).__name__}); write it like '2000 W'") from exc
    if not isinstance(q, ureg.Quantity):
        q = ureg.Quantity(q)
    mag = q.magnitude
    if isinstance(mag, bool) or not isinstance(mag, (int, float)) or not math.isfinite(float(mag)):
        raise CalcError(f"{raw!r} is not a finite number with a unit")
    return q


def _parse_quantities(quantities: Any) -> dict[str, str]:
    """Accept ``["P = 2000 W", ...]`` (the tool's declared shape) or a mapping."""
    if quantities is None:
        return {}
    pairs: list[tuple[str, str]] = []
    if isinstance(quantities, dict):
        pairs = [(str(k), str(v)) for k, v in quantities.items()]
    elif isinstance(quantities, (list, tuple)):
        for item in quantities:
            if not isinstance(item, str) or "=" not in item:
                raise CalcError(f"each quantity is 'symbol = value unit', got {item!r}")
            name, _, value = item.partition("=")
            pairs.append((name.strip(), value.strip()))
    elif isinstance(quantities, str):
        return _parse_quantities([p for p in re.split(r"[;\n]", quantities) if p.strip()])
    else:
        raise CalcError("quantities must be a list like ['P = 2000 W', 't = 3 min']")
    if len(pairs) > MAX_QUANTITIES:
        raise CalcError(f"too many quantities ({len(pairs)}, max {MAX_QUANTITIES})")
    out: dict[str, str] = {}
    for name, value in pairs:
        if not name.isidentifier():
            raise CalcError(f"{name!r} is not a usable symbol; use letters, digits and _ (e.g. v_0, dT, ρ)")
        if name in out:
            raise CalcError(f"{name!r} is given twice")
        out[name] = value
    return out


# --- the grammar -------------------------------------------------------------

_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)


def _check_tree(tree: ast.Expression, expression: str) -> None:
    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_NODES:
        raise CalcError(f"expression too complex ({len(nodes)} parts, max {MAX_NODES})")
    for node in nodes:
        if isinstance(node, (ast.Expression, ast.Load, *_BINOPS, ast.USub, ast.UAdd)):
            continue
        if isinstance(node, ast.BinOp) and isinstance(node.op, _BINOPS):
            continue
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            continue
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            continue
        if isinstance(node, ast.Name):
            continue
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCS:
                name = node.func.id if isinstance(node.func, ast.Name) else "that"
                raise CalcError(f"{name}() is not available; functions: {', '.join(sorted(_FUNCS))}")
            if len(node.args) != 1 or node.keywords:
                raise CalcError(f"{node.func.id}() takes exactly one argument")
            continue
        if isinstance(node, ast.Tuple):
            raise CalcError("a comma separates nothing here; for a decimal write 2,5 or 2.5 next to the digits")
        raise CalcError(f"{type(node).__name__} is not part of the calculator's grammar in {expression!r}")


def _literal_exponent(node: ast.AST) -> float:
    """The exponent of ``**``: a literal, a negated literal, or a literal fraction."""
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        value = float(node.value)
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        inner = _literal_exponent(node.operand)
        value = -inner if isinstance(node.op, ast.USub) else inner
    elif (
        isinstance(node, ast.BinOp)
        and isinstance(node.op, ast.Div)
        and all(isinstance(n, ast.Constant) and type(n.value) is int for n in (node.left, node.right))
        and node.right.value != 0
    ):
        value = node.left.value / node.right.value
    else:
        raise CalcError("an exponent must be a plain number such as 2, -1 or 1/2; use sqrt() for roots")
    if abs(value) > MAX_EXPONENT:
        raise CalcError(f"exponent {value:g} is too large (max {MAX_EXPONENT})")
    return value


def _is_angle(q: Any) -> bool:
    if not q.dimensionless:
        return False
    return any(name in str(q.units) for name in _ANGLE_UNIT_NAMES)


def _plain(q: Any, fname: str) -> float:
    """A dimensionless, non-angle quantity's value, for exp/ln/log/asin…"""
    if not q.dimensionless or _is_angle(q):
        raise CalcError(f"{fname}() needs a dimensionless number, got {q.units:~P}")
    return float(q.to("dimensionless").magnitude)


def _trig(fn: Any, fname: str) -> Any:
    def apply(q: Any) -> Any:
        if not _is_angle(q):
            raise CalcError(
                f"{fname}() needs an angle with its unit, e.g. {fname}(30 deg) or {fname}(0.5 rad); "
                "a bare number is not read as either"
            )
        return _ureg().Quantity(fn(float(q.to("radian").magnitude)), "dimensionless")

    return apply


def _inverse_trig(fn: Any, fname: str) -> Any:
    def apply(q: Any) -> Any:
        x = _plain(q, fname)
        try:
            return _ureg().Quantity(fn(x), "radian")
        except ValueError as exc:
            raise CalcError(f"{fname}({x:g}) is undefined") from exc

    return apply


def _logfn(fn: Any, fname: str) -> Any:
    def apply(q: Any) -> Any:
        x = _plain(q, fname)
        if x <= 0:
            raise CalcError(f"{fname}() of {x:g} is undefined")
        return _ureg().Quantity(fn(x), "dimensionless")

    return apply


def _sqrt(q: Any) -> Any:
    if q.magnitude < 0:
        raise CalcError("sqrt() of a negative number")
    return q**0.5


def _exp(q: Any) -> Any:
    x = _plain(q, "exp")
    if x > 700:
        raise CalcError("exp() argument too large")
    return _ureg().Quantity(math.exp(x), "dimensionless")


_FUNCS: dict[str, Any] = {
    "sqrt": _sqrt,
    "sin": _trig(math.sin, "sin"),
    "cos": _trig(math.cos, "cos"),
    "tan": _trig(math.tan, "tan"),
    "asin": _inverse_trig(math.asin, "asin"),
    "acos": _inverse_trig(math.acos, "acos"),
    "atan": _inverse_trig(math.atan, "atan"),
    "exp": _exp,
    "ln": _logfn(math.log, "ln"),
    "log": _logfn(math.log10, "log"),
    "abs": abs,
}


def _evaluate(tree: ast.Expression, values: dict[str, Any], constants_used: dict[str, str]) -> Any:
    import pint

    ureg = _ureg()

    def ev(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant):
            return ureg.Quantity(float(node.value), "dimensionless")
        if isinstance(node, ast.Name):
            if node.id in values:
                return values[node.id]
            if node.id == "pi" or node.id == "π":
                return ureg.Quantity(math.pi, "dimensionless")
            if node.id in _CONSTANTS:
                constants_used[node.id] = _CONSTANTS[node.id].replace("**", "^")
                return _parse_quantity_value(_CONSTANTS[node.id])
            raise CalcError(f"unknown symbol {node.id!r}: give it in quantities, e.g. '{node.id} = 2 m'")
        if isinstance(node, ast.UnaryOp):
            value = ev(node.operand)
            return -value if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.BinOp):
            if isinstance(node.op, ast.Pow):
                return ev(node.left) ** _literal_exponent(node.right)
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if right.magnitude == 0:
                raise CalcError("division by zero")
            return left / right
        if isinstance(node, ast.Call):
            return _FUNCS[node.func.id](ev(node.args[0]))
        raise CalcError(f"{type(node).__name__} is not part of the grammar")  # unreachable after _check_tree

    try:
        result = ev(tree)
    except CalcError:
        raise
    except pint.errors.OffsetUnitCalculusError as exc:
        raise CalcError(
            "°C is an offset unit and cannot be multiplied; give a temperature DIFFERENCE in K (an 80 °C rise = 80 K)"
        ) from exc
    except pint.errors.DimensionalityError as exc:
        raise CalcError(
            f"dimensions differ: cannot combine {exc.units1} and {exc.units2} ({exc.dim1} vs {exc.dim2})"
        ) from exc
    except (OverflowError, ZeroDivisionError) as exc:
        raise CalcError(f"the numbers are out of range ({type(exc).__name__})") from exc
    if not isinstance(result, ureg.Quantity):
        result = ureg.Quantity(result)
    if not math.isfinite(float(result.magnitude)):
        raise CalcError("the result is not a finite number")
    return result


def _parse(expression: str) -> ast.Expression:
    if not expression or not expression.strip():
        raise CalcError("empty expression")
    if len(expression) > MAX_EXPRESSION_CHARS:
        raise CalcError(f"expression too long ({len(expression)} chars, max {MAX_EXPRESSION_CHARS})")
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise CalcError(f"cannot read the expression {expression!r}; write it like 'm * c * dT'") from exc
    _check_tree(tree, expression)
    return tree


# --- choosing the result's unit ----------------------------------------------

#: The SI unit a result is reported in when the caller names none, keyed by
#: dimensionality. Anything not listed is reported in SI base units.
_PREFERRED: tuple[tuple[str, bool], ...] = (
    ("J", True),
    ("W", True),
    ("N", True),
    ("Pa", True),
    ("V", True),
    ("ohm", True),
    ("C", True),
    ("m/s", False),
    ("m/s**2", False),
    ("kg*m/s", False),
    ("kg/m**3", False),
    ("J/(kg*K)", False),
    ("m", True),
    ("kg", False),
    ("s", False),
    ("K", False),
    ("A", False),
)


def _report_unit(q: Any, *, prefixes: bool = True) -> Any:
    """``q`` in its preferred SI unit; with ``prefixes``, scaled to kJ, mN, …"""
    ureg = _ureg()
    if _is_angle(q):
        return q.to("degree")
    if q.dimensionless:
        return q.to("dimensionless")
    for unit, compact in _PREFERRED:
        if q.dimensionality == ureg.Quantity(1, unit).dimensionality:
            converted = q.to(unit)
            return converted.to_compact() if (compact and prefixes) else converted
    return q.to_base_units()


def _clean(x: float) -> float:
    """Drop float noise (0.49999999999999994 -> 0.5) without changing the value."""
    return float(f"{x:.12g}")


# --- formatting --------------------------------------------------------------

_GREEK = {
    "α": r"\alpha",
    "β": r"\beta",
    "γ": r"\gamma",
    "δ": r"\delta",
    "Δ": r"\Delta",
    "ε": r"\varepsilon",
    "η": r"\eta",
    "θ": r"\theta",
    "λ": r"\lambda",
    "μ": r"\mu",
    "ν": r"\nu",
    "π": r"\pi",
    "ρ": r"\rho",
    "σ": r"\sigma",
    "τ": r"\tau",
    "φ": r"\varphi",
    "ω": r"\omega",
    "Ω": r"\Omega",
}


def format_number(value: float, language: str) -> str:
    """4 significant figures, a ``\\cdot 10^{n}`` form outside 1e-3..1e6, ``{,}`` in Danish."""
    if value == 0:
        return "0"
    text = f"{value:.4g}"
    if "e" in text:
        mantissa, exp = text.split("e")
        mantissa = mantissa.rstrip("0").rstrip(".") if "." in mantissa else mantissa
        body = f"{mantissa} \\cdot 10^{{{int(exp)}}}"
    else:
        body = text
    return body.replace(".", "{,}") if language == "da" else body


def format_unit(units: Any) -> str:
    r"""``\,\text{kJ}`` / ``\,\text{m}/\text{s}^{2}`` / ``^\circ`` — the preamble's forms."""
    ureg = _ureg()
    items = list(units._units.items())  # UnitsContainer: name -> exponent
    if not items:
        return ""
    if items == [("degree", 1)]:
        return r"^\circ"
    if items == [("degree_Celsius", 1)]:
        return r"^\circ\text{C}"

    def part(name: str, exp: float) -> str:
        symbol = ureg.get_symbol(name)
        symbol = {"Ω": r"\Omega", "ohm": r"\Omega"}.get(symbol, symbol)
        token = symbol if symbol.startswith("\\") else rf"\text{{{symbol}}}"
        e = abs(exp)
        return token if e == 1 else f"{token}^{{{e:g}}}"

    num = [part(n, e) for n, e in items if e > 0]
    den = [part(n, e) for n, e in items if e < 0]
    top = r" \cdot ".join(num) if num else "1"
    body = top if not den else f"{top}/" + (den[0] if len(den) == 1 else "(" + r" \cdot ".join(den) + ")")
    return rf"\,{body}"


def format_quantity(q: Any, language: str) -> str:
    return format_number(float(q.magnitude), language) + format_unit(q.units)


#: Greek letters a model spells out (``theta``), rendered as the letter.
_GREEK_NAMES = {
    n: "\\" + n
    for n in ("alpha beta gamma delta Delta epsilon eta theta lambda mu nu rho sigma tau phi omega Omega").split()
}


def _latex_name(name: str) -> str:
    base, _, sub = name.partition("_")
    if base in _GREEK_NAMES:
        out = _GREEK_NAMES[base]
    else:
        out = "".join((_GREEK[ch] + " ") if ch in _GREEK else ch for ch in base).strip()
    if sub:
        sub_tex = "".join(_GREEK.get(ch, ch) for ch in sub)
        out += f"_{{{sub_tex}}}" if len(sub) == 1 else f"_{{\\text{{{sub}}}}}"
    return out


_PREC = {ast.Add: 1, ast.Sub: 1, ast.Mult: 2, ast.Div: 2, ast.Pow: 4}


def _to_latex(node: ast.AST, language: str, subs: dict[str, str] | None) -> tuple[str, int]:
    """LaTeX for ``node`` and its precedence. ``subs`` replaces names with values."""
    if isinstance(node, ast.Expression):
        return _to_latex(node.body, language, subs)
    if isinstance(node, ast.Constant):
        return format_number(float(node.value), language), 5
    if isinstance(node, ast.Name):
        if subs is not None and node.id in subs:
            return subs[node.id], 3  # a value with a unit: bracket it under ** and unary -
        return (r"\pi" if node.id == "pi" else _latex_name(node.id)), 5
    if isinstance(node, ast.UnaryOp):
        inner, prec = _to_latex(node.operand, language, subs)
        sign = "-" if isinstance(node.op, ast.USub) else "+"
        return (f"{sign}\\left({inner}\\right)" if prec < 4 else f"{sign}{inner}"), 3
    if isinstance(node, ast.Call):
        inner, _ = _to_latex(node.args[0], language, subs)
        fname = node.func.id
        if fname == "sqrt":
            return f"\\sqrt{{{inner}}}", 5
        if fname == "abs":
            return f"\\left|{inner}\\right|", 5
        macro = {"asin": r"\arcsin", "acos": r"\arccos", "atan": r"\arctan"}.get(fname, f"\\{fname}")
        return f"{macro}\\left({inner}\\right)", 5
    if isinstance(node, ast.BinOp):
        op = type(node.op)
        prec = _PREC[op]
        left, lp = _to_latex(node.left, language, subs)
        right, rp = _to_latex(node.right, language, subs)
        if op is ast.Div:
            return f"\\frac{{{left}}}{{{right}}}", 5
        if op is ast.Pow:
            base = f"\\left({left}\\right)" if lp < 5 else left
            return f"{base}^{{{right}}}", prec
        if lp < prec:
            left = f"\\left({left}\\right)"
        if rp < prec or (op is ast.Sub and rp == prec):
            right = f"\\left({right}\\right)"
        sym = {ast.Add: "+", ast.Sub: "-", ast.Mult: r"\cdot"}[op]
        return f"{left} {sym} {right}", prec
    return "?", 5


# --- the public call -----------------------------------------------------------


def calc_id(expression: str, quantities: dict[str, str], result_unit: str | None, check: str | None) -> str:
    """Hash of exactly what decides the result, so a re-run can be matched to it."""
    canonical = json.dumps(
        {
            "engine": ENGINE_VERSION,
            "expression": expression,
            "quantities": dict(sorted(quantities.items())),
            "result_unit": result_unit or "",
            "check": check or "",
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return "calc_" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _dimension_check(check: str, values: dict[str, Any], result: Any) -> str:
    left_src, eq, right_src = check.partition("=")
    if not eq or "=" in right_src:
        raise CalcError("check must be one equation with a single '=', e.g. 'E = P * t'")
    sides = []
    for src in (left_src, right_src):
        src = _normalise_expression(src)
        tree = _parse(src)
        body = tree.body
        if isinstance(body, ast.Name) and body.id not in values and body.id not in _CONSTANTS and body.id != "pi":
            sides.append(result)  # the unknown side of the equation is the thing being calculated
        else:
            sides.append(_evaluate(tree, values, {}))
    left, right = sides
    if left.dimensionality == right.dimensionality:
        return "consistent"
    return f"inconsistent: {left.dimensionality} ≠ {right.dimensionality}"


def calculate(
    expression: str,
    quantities: Any = None,
    result_unit: str | None = None,
    check: str | None = None,
    language: str = "da",
) -> dict[str, Any]:
    """Evaluate one calculation. Never raises: a refusal is ``{"ok": False, "error": …}``."""
    language = "en" if language == "en" else "da"
    normalised = _normalise_expression(expression or "")
    try:
        given = _parse_quantities(quantities)
    except CalcError as exc:
        return {"ok": False, "error": str(exc), "expression": normalised, "engine": engine_label()}
    cid = calc_id(normalised, given, result_unit, check)
    base: dict[str, Any] = {"expression": normalised, "quantities": given, "calc_id": cid, "engine": engine_label()}
    try:
        tree = _parse(normalised)
        values = {name: _parse_quantity_value(raw) for name, raw in given.items()}
        constants_used: dict[str, str] = {}
        raw_result = _evaluate(tree, values, constants_used)

        if result_unit:
            try:
                shown = raw_result.to(_normalise_expression(result_unit))
            except Exception as exc:
                raise CalcError(
                    f"dimensions differ: the result is {_report_unit(raw_result).units:~P} "
                    f"({raw_result.dimensionality}), which cannot be expressed in {result_unit}"
                ) from exc
        else:
            shown = _report_unit(raw_result)
        si = _report_unit(raw_result, prefixes=False)

        subs = {name: format_quantity(q, language) for name, q in values.items()}
        subs.update(
            {name: format_quantity(_parse_quantity_value(_CONSTANTS[name]), language) for name in constants_used}
        )
        symbolic, _ = _to_latex(tree, language, None)
        substituted, _ = _to_latex(tree, language, subs)
        steps = [symbolic] + ([substituted] if substituted != symbolic else []) + [format_quantity(shown, language)]
        latex = "$" + " = ".join(steps) + "$"

        out = {
            **base,
            "ok": True,
            "quantities_si": {name: f"{q.to_base_units():~P}" for name, q in values.items()},
            "result": {
                "value": _clean(float(shown.magnitude)),
                "unit": f"{shown.units:~P}",
                "si_value": _clean(float(si.magnitude)),
                "si_unit": f"{si.units:~P}",
            },
            "latex": latex,
        }
        if constants_used:
            out["constants_used"] = constants_used
        if check:
            out["dimension_check"] = _dimension_check(check, values, raw_result)
        return out
    except CalcError as exc:
        return {**base, "ok": False, "error": str(exc)}
