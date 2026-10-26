"""The calculator's engine (1.1.152 M2): physics it must get right, input it must refuse.

Design: docs/design/aipla/v1.1.0-feedback/verifiable-maths-tool.md (M2 acceptance:
40+ physics cases, adversarial input, a stable calc_id, Danish/English LaTeX).
"""

from __future__ import annotations

import math

import pytest

from maths import ENGINE_VERSION, calculate
from maths.engine import MAX_EXPRESSION_CHARS, format_number

# (expression, quantities, result_unit, expected value, expected unit)
PHYSICS = [
    # Energy and power: the Elkedel (kettle) relationships first.
    ("P * t", ["P = 2000 W", "t = 3 min"], "kJ", 360.0, "kJ"),
    ("P * t", ["P = 2000 W", "t = 180 s"], None, 360.0, "kJ"),
    ("P * t", ["P = 2,2 kW", "t = 4 min"], "kWh", 0.14666666666666667, "kWh"),
    ("m * c * ΔT", ["m = 1,4 kg", "c = 4186 J/(kg*K)", "ΔT = 80 K"], "kJ", 468.832, "kJ"),
    ("m * c * dT", ["m = 1 kg", "c = 4186 J/(kg*K)", "dT = 80 K"], "J", 334880.0, "J"),
    ("E / t", ["E = 360 kJ", "t = 3 min"], "W", 2000.0, "W"),
    ("Q / P", ["Q = 334880 J", "P = 2000 W"], "s", 167.44, "s"),
    ("E_nyttig / E_tilfoert", ["E_nyttig = 335 kJ", "E_tilfoert = 400 kJ"], None, 0.8375, ""),
    ("U * I", ["U = 230 V", "I = 8,7 A"], "W", 2001.0, "W"),
    ("U / I", ["U = 230 V", "I = 2 A"], "ohm", 115.0, "Ω"),
    ("U**2 / R", ["U = 230 V", "R = 26,45 ohm"], "W", 2000.0, "W"),
    ("I * t", ["I = 2 A", "t = 1 min"], "C", 120.0, "C"),
    # Kinematics.
    ("s / t", ["s = 100 m", "t = 9,58 s"], "m/s", 10.438413361169102, "m/s"),
    ("s / t", ["s = 100 m", "t = 9,58 s"], "km/h", 37.578288100208766, "km/h"),
    ("v_0 * t + 0.5 * a * t**2", ["v_0 = 2 m/s", "a = 3 m/s^2", "t = 4 s"], "m", 32.0, "m"),
    ("v_0 + a * t", ["v_0 = 0 m/s", "a = 9,82 m/s^2", "t = 2 s"], "m/s", 19.64, "m/s"),
    ("sqrt(2 * g * h)", ["h = 1,5 m"], "m/s", 5.427706698044765, "m/s"),
    ("sqrt(2 * g * h)", ["h = 1.5 m", "g = 9.81 m/s^2"], "m/s", 5.424942396007538, "m/s"),
    ("(v - v_0) / t", ["v = 30 m/s", "v_0 = 10 m/s", "t = 5 s"], "m/s^2", 4.0, "m/s²"),
    ("0.5 * g * t^2", ["t = 3 s"], "m", 44.19, "m"),
    ("v**2 / (2 * a)", ["v = 20 m/s", "a = 5 m/s^2"], "m", 40.0, "m"),
    # Projectile (Boldkast): angles are units.
    ("v_0 * cos(θ)", ["v_0 = 15 m/s", "θ = 40 deg"], "m/s", 15 * math.cos(math.radians(40)), "m/s"),
    ("v_0 * sin(theta)", ["v_0 = 15 m/s", "theta = 40 deg"], "m/s", 15 * math.sin(math.radians(40)), "m/s"),
    ("v_0**2 * sin(2 * θ) / g", ["v_0 = 15 m/s", "θ = 45 deg"], "m", 225 / 9.82, "m"),
    ("sin(x)", ["x = 0.5 rad"], None, math.sin(0.5), ""),
    ("atan(y / x)", ["y = 1 m", "x = 1 m"], "deg", 45.0, "deg"),
    ("asin(r)", ["r = 0.5"], "deg", 30.0, "deg"),
    # Dynamics, energy, momentum.
    ("m * a", ["m = 1200 kg", "a = 2,5 m/s^2"], "N", 3000.0, "N"),
    ("m * g", ["m = 70 kg"], "N", 687.4, "N"),
    ("m * g * h", ["m = 2 kg", "h = 10 m"], "J", 196.4, "J"),
    ("0.5 * m * v**2", ["m = 2 kg", "v = 3 m/s"], "J", 9.0, "J"),
    ("m * v", ["m = 0,15 kg", "v = 40 m/s"], None, 6.0, "kg·m/s"),
    ("F / A", ["F = 500 N", "A = 0,25 m^2"], "Pa", 2000.0, "Pa"),
    ("m / V", ["m = 1 kg", "V = 1 L"], "kg/m^3", 1000.0, "kg/m³"),
    ("ρ * g * h", ["ρ = 1000 kg/m^3", "h = 10 m"], "kPa", 98.2, "kPa"),
    # Waves and light (LED Planck, wave sims).
    ("v / f", ["v = 343 m/s", "f = 440 Hz"], "m", 0.7795454545454545, "m"),
    ("λ * f", ["λ = 0,5 m", "f = 2 Hz"], "m/s", 1.0, "m/s"),
    ("c / λ", ["λ = 500 nm"], "THz", 599.584916, "THz"),
    ("h_P * c / λ", ["h_P = 6.626e-34 J*s", "λ = 620 nm"], "eV", 2.0, "eV"),
    ("e_q * U", ["e_q = 1.602e-19 C", "U = 2 V"], "J", 3.204e-19, "J"),
    # Plain arithmetic and conversions.
    ("t", ["t = 3 min"], "s", 180.0, "s"),
    ("v", ["v = 90 km/h"], "m/s", 25.0, "m/s"),
    ("2 * pi * r", ["r = 0,5 m"], "m", math.pi, "m"),
    ("abs(x)", ["x = -3 m"], "m", 3.0, "m"),
    ("ln(x)", ["x = 2.718281828"], None, 1.0, ""),
    ("log(x)", ["x = 1000"], None, 3.0, ""),
    ("exp(x)", ["x = 0"], None, 1.0, ""),
]


@pytest.mark.parametrize(("expression", "quantities", "unit", "value", "shown_unit"), PHYSICS)
def test_physics(expression, quantities, unit, value, shown_unit):
    r = calculate(expression, quantities, result_unit=unit)
    assert r["ok"], r.get("error")
    assert r["result"]["value"] == pytest.approx(value, rel=1e-3)
    assert r["result"]["unit"].replace("⋅", "·") == shown_unit


def test_there_are_at_least_forty_physics_cases():
    assert len(PHYSICS) >= 40


# --- refusals the model can act on --------------------------------------------

REFUSALS = [
    ("sin(30)", [], None, "angle with its unit"),
    ("m * c * dT", ["m = 1 kg", "c = 4186 J/(kg*K)", "dT = 80 degC"], None, "temperature DIFFERENCE in K"),
    ("P / t", ["P = 2000 W", "t = 3 min"], "J", "dimensions differ"),
    ("P + t", ["P = 2000 W", "t = 3 min"], None, "dimensions differ"),
    ("x * y", ["x = 2 m"], None, "unknown symbol 'y'"),
    ("x / y", ["x = 2 m", "y = 0 s"], None, "division by zero"),
    ("sqrt(x)", ["x = -4 m^2"], None, "negative"),
    ("ln(x)", ["x = 2 m"], None, "dimensionless"),
    ("P", ["P = 2.000 W"], None, "ambiguous"),
    ("2,5 * x", ["x = 1 m", "y = 2"], None, None),  # decimal comma in the expression is fine
]


@pytest.mark.parametrize(("expression", "quantities", "unit", "message"), REFUSALS)
def test_refusals_say_what_is_wrong(expression, quantities, unit, message):
    r = calculate(expression, quantities, result_unit=unit)
    if message is None:
        assert r["ok"], r.get("error")
        return
    assert r["ok"] is False
    assert message in r["error"]
    assert r["calc_id"].startswith("calc_")  # a refusal is still identifiable


# --- adversarial input ----------------------------------------------------------

ADVERSARIAL = [
    "9**9**9",
    "2**1000",
    "x**y",
    "__import__('os').system('true')",
    "x.__class__",
    "(1).__class__",
    "[x for x in ()]",
    "lambda: 1",
    "open('/etc/passwd')",
    "eval('1')",
    "x if x else x",
    "x[0]",
    "x == x",
    "x; y",
    "f'{x}'",
    "1 << 999",
    "sin(x, y)",
    "sqrt(x=1)",
    "x" * (MAX_EXPRESSION_CHARS + 1),
    "+".join(["x"] * 200),
]


@pytest.mark.parametrize("expression", ADVERSARIAL)
def test_adversarial_expressions_are_refused(expression):
    r = calculate(expression, ["x = 2", "y = 3"])
    assert r["ok"] is False, expression
    assert isinstance(r["error"], str) and r["error"]


def test_a_quantity_cannot_smuggle_code():
    r = calculate("x", ["x = __import__('os').getcwd()"])
    assert r["ok"] is False


def test_too_many_quantities_is_refused():
    r = calculate("x0", [f"x{i} = 1 m" for i in range(25)])
    assert r["ok"] is False and "too many" in r["error"]


# --- verifiability ---------------------------------------------------------------


def test_calc_id_is_stable_and_identifies_the_inputs():
    a = calculate("P * t", ["P = 2000 W", "t = 3 min"], result_unit="kJ")
    b = calculate("P * t", ["t = 3 min", "P = 2000 W"], result_unit="kJ")  # order does not matter
    c = calculate("P * t", ["P = 2000 W", "t = 4 min"], result_unit="kJ")
    d = calculate("P * t", ["P = 2000 W", "t = 3 min"], result_unit="kJ", language="en")
    assert a["calc_id"] == b["calc_id"] == d["calc_id"]  # language is formatting, not the calculation
    assert a["calc_id"] != c["calc_id"]
    assert a["engine"].startswith(f"aipla-calc {ENGINE_VERSION} / pint ")


def test_a_rerun_reproduces_the_result():
    first = calculate("m * c * ΔT", ["m = 1,4 kg", "c = 4186 J/(kg*K)", "ΔT = 80 K"])
    again = calculate(first["expression"], [f"{k} = {v}" for k, v in first["quantities"].items()])
    assert again["calc_id"] == first["calc_id"]
    assert again["result"] == first["result"]


def test_constants_used_are_named():
    r = calculate("m * g", ["m = 70 kg"])
    assert r["constants_used"] == {"g": "9.82 m/s^2"}
    own = calculate("m * g", ["m = 70 kg", "g = 9.81 m/s^2"])
    assert "constants_used" not in own  # the caller's g wins and is not "assumed"


def test_si_value_is_in_the_si_unit_without_a_prefix():
    r = calculate("P * t", ["P = 2000 W", "t = 3 min"])
    assert (r["result"]["value"], r["result"]["unit"]) == (360.0, "kJ")
    assert (r["result"]["si_value"], r["result"]["si_unit"]) == (360000.0, "J")


def test_dimension_check():
    ok = calculate("P * t", ["P = 2000 W", "t = 3 min"], check="E = P * t")
    bad = calculate("P * t", ["P = 2000 W", "t = 3 min"], check="E = P / t")
    assert ok["dimension_check"] == "consistent"
    assert bad["dimension_check"].startswith("inconsistent")


def test_quantities_may_also_arrive_as_a_mapping():
    """The declared shape is a list; a model that sends an object still works."""
    r = calculate("P * t", {"P": "2000 W", "t": "3 min"}, result_unit="kJ")
    assert r["ok"] and r["result"]["value"] == 360.0


# --- LaTeX in the house style (skills/preambles/math_notation.md) -------------------


def test_danish_latex_uses_cdot_decimal_comma_and_units():
    r = calculate("P * t", ["P = 2,2 kW", "t = 3 min"], result_unit="kJ", language="da")
    assert r["latex"] == r"$P \cdot t = 2{,}2\,\text{kW} \cdot 3\,\text{min} = 396\,\text{kJ}$"


def test_english_latex_uses_a_decimal_point():
    r = calculate("P * t", ["P = 2.2 kW", "t = 3 min"], result_unit="kJ", language="en")
    assert r["latex"] == r"$P \cdot t = 2.2\,\text{kW} \cdot 3\,\text{min} = 396\,\text{kJ}$"


def test_latex_never_contains_an_asterisk_and_puts_degrees_outside_text():
    r = calculate("v_0 * cos(θ)", ["v_0 = 15 m/s", "θ = 40 deg"])
    assert "*" not in r["latex"]
    assert r"40^\circ" in r["latex"]
    assert r"\text{ ^\circ" not in r["latex"]
    assert r"\theta" in r["latex"] and "v_{0}" in r["latex"]


def test_latex_frac_and_powers():
    r = calculate("v**2 / (2 * a)", ["v = 20 m/s", "a = 5 m/s^2"])
    assert r"\frac{v^{2}}{2 \cdot a}" in r["latex"]
    assert r"\text{m}/\text{s}^{2}" in r["latex"]


def test_constants_are_substituted_in_the_worked_line():
    r = calculate("m * g", ["m = 70 kg"], result_unit="N", language="da")
    assert r"9{,}82\,\text{m}/\text{s}^{2}" in r["latex"]


@pytest.mark.parametrize(
    ("value", "language", "text"),
    [
        (360.0, "da", "360"),
        (0.5, "da", "0{,}5"),
        (468.832, "da", "468{,}8"),
        (468.832, "en", "468.8"),
        (3.204e-19, "da", r"3{,}204 \cdot 10^{-19}"),
        (6.0e23, "en", r"6 \cdot 10^{23}"),
    ],
)
def test_number_formatting(value, language, text):
    assert format_number(value, language) == text


def test_bare_e_is_refused_with_both_unambiguous_spellings():
    for expr in ("e", "2 * e", "Q / e"):
        r = calculate(expr, ["Q = 3.2e-19 C"])
        assert r["ok"] is False
        assert "q_e" in r["error"] and "exp(" in r["error"]


def test_q_e_is_the_elementary_charge_and_is_named():
    r = calculate("Q / q_e", ["Q = 3.2e-19 C"])
    assert r["ok"] is True
    assert abs(r["result"]["value"] - 3.2 / 1.602176634) < 1e-5  # a count of charges
    assert r["constants_used"] == {"q_e": "1.602176634e-19 C"}


def test_e_given_in_quantities_is_the_callers_symbol():
    r = calculate("e * U", ["e = 0.8", "U = 230 V"])  # an efficiency, not a charge
    assert (r["result"]["value"], r["result"]["unit"]) == (184.0, "V")


def test_pint_e_unit_inside_a_value_is_refused():
    # pint would read "2 e" as two elementary charges, silently.
    r = calculate("U * I", ["U = 2 e", "I = 1 A"])
    assert r["ok"] is False and "ambiguous" in r["error"]


def test_scientific_notation_and_ev_are_not_mistaken_for_e():
    assert calculate("Q * 2", ["Q = 1.6e-19 C"])["ok"] is True
    r = calculate("E", ["E = 2 eV"], result_unit="J")
    assert r["ok"] is True and abs(r["result"]["value"] - 3.204e-19) < 1e-21
