r"""``show_calculation``'s payload: the calculation a student SEES (1.1.152 M4).

Design: docs/design/aipla/v1.1.0-feedback/verifiable-maths-tool.md (M4, Pedagogy)

The card is re-evaluated by the engine from the tutor's inputs, so the number on
it is the engine's, never the model's. That is the point of the card: a student
(and a teacher reading over their shoulder) can check the working, because the
working is something the platform computed rather than something the model said.

**Show or hold.** Most tutors show the whole calculation. A tutor whose job is
that the student works the number out (``calculationResults: hold`` in its
SKILL.md, today ``problem-set-hints``) shows the equation and the substituted
values, and holds the final number back until the student gives their own. M
decided this on 2026-10-26 (open question O2, pending AR/JB's review). The
setting is config, never the model's judgement in the moment.

* **Held means absent, not hidden.** ``show_calculation`` is in
  ``_CLIENT_RENDER_TOOLS``, so its result streams to the student's browser. A
  held value that were merely not *drawn* would be one devtools tab away. A held
  payload carries no result, no full ``latex``, and no ratio to the student's
  answer (from which the value could be recovered).
* **A wrong answer gets a direction, never the value** (pedagogy rule 3): a
  different kind of quantity, a power of ten, a minutes/hours factor, a 3,6 for
  km/h, a factor two, or just "too large". A recognised factor is given because
  it names the cause; an unrecognised one is not, because it is only the answer
  in disguise.
* **Only the student can unlock it.** ``student_value`` counts only when its
  number appears in the student's own message. Otherwise a model could "check"
  an answer nobody gave and show the value. Without a message to check against,
  it does not count: fail closed.
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from maths.engine import CalcError, _parse_quantity_value, _report_unit, evaluate_full, format_unit

CalculationResults = Literal["show", "hold"]

#: How close a student's answer must be to count as right: 4 significant figures
#: on the card, and a student who rounds 396 kJ to 400 kJ is not wrong.
MATCH_TOLERANCE = 0.02

#: Factors that name a cause, so saying them is a direction rather than the answer.
_NAMED_FACTORS: tuple[tuple[float, str], ...] = (
    (60.0, "time_unit"),
    (3600.0, "time_unit"),
    (3.6, "speed_unit"),
    (2.0, "factor_two"),
)

_NUMBER = re.compile(
    # "2 000" (a space or a narrow no-break space as the thousands separator) is one number
    r"[-−]?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?!\d)|\d+)(?:[.,]\d+)?"
    r"(?:\s*[eE]\s*[-+−]?\d+|\s*(?:\*|·|⋅|x|×)\s*10\s*\^?\s*\{?\s*[-+−]?\d+\s*\}?)?"
)
_POWER = re.compile(r"(?:\*|·|⋅|x|×)\s*10\s*\^?\s*\{?\s*([-+−]?\d+)\s*\}?$")


def _number_value(token: str) -> float | None:
    """``"3,2·10^-19"`` / ``"1.6e-19"`` / ``"360"`` → a float."""
    text = token.replace("−", "-").strip()
    power = 0
    m = _POWER.search(text)
    if m:
        power = int(m.group(1).replace("−", "-"))
        text = text[: m.start()].strip()
    text = re.sub(r"(?<=\d),(?=\d)", ".", text)
    text = re.sub(r"[ \u00a0\u202f]", "", text)
    try:
        return float(text) * (10.0**power)
    except ValueError:
        return None


def numbers_in(text: str) -> list[float]:
    """Every number a student wrote, in the forms a Danish or English student writes them."""
    out = []
    for m in _NUMBER.finditer(text or ""):
        v = _number_value(m.group(0))
        if v is not None:
            out.append(v)
    return out


def _appears_in(magnitude: float, text: str | None) -> bool:
    if not text:
        return False
    return any(math.isclose(magnitude, n, rel_tol=1e-9, abs_tol=1e-300) for n in numbers_in(text))


def _direction(ratio: float, *, held: bool) -> dict[str, Any]:
    """Which way a wrong answer is off, and its cause when the factor names one."""
    if ratio <= 0:
        return {"direction": "sign"} if ratio < 0 else {"direction": "too_small"}
    out: dict[str, Any] = {"direction": "too_large" if ratio > 1 else "too_small"}
    if not held:
        out["ratio"] = float(f"{ratio:.4g}")
    lg = math.log10(ratio)
    tol = math.log10(1 + MATCH_TOLERANCE)
    n = round(lg)
    if n != 0 and abs(lg - n) < tol:
        out.update(hint="power_of_ten", power=n)
        return out
    for factor, hint in _NAMED_FACTORS:
        for sign in (1, -1):
            if abs(lg - sign * math.log10(factor)) < tol:
                out.update(hint=hint, factor=factor)
                return out
    return out


def _compare(student_value: str, shown: Any) -> dict[str, Any]:
    """The student's answer against the engine's, as a status (and a direction)."""
    try:
        sq = _parse_quantity_value(student_value)
    except CalcError:
        return {"status": "unreadable"}
    if sq.dimensionless and not shown.dimensionless:
        return {"status": "no_unit"}
    if sq.dimensionality != shown.dimensionality:
        return {"status": "different_quantity"}
    truth = float(shown.to_base_units().magnitude)
    theirs = float(sq.to_base_units().magnitude)
    if truth == 0:
        return {"status": "match"} if theirs == 0 else {"status": "mismatch", "direction": "too_large"}
    ratio = theirs / truth
    if abs(ratio - 1) <= MATCH_TOLERANCE:
        return {"status": "match"}
    return {"status": "mismatch", "ratio_raw": ratio}


def calculation_card(
    expression: str,
    quantities: Any = None,
    result_unit: str | None = None,
    student_value: str | None = None,
    *,
    mode: CalculationResults = "show",
    language: str = "da",
    student_text: str | None = None,
) -> dict[str, Any]:
    """The card for one calculation. Never raises, and never carries a held value."""
    mode = "hold" if mode == "hold" else "show"
    ev = evaluate_full(expression, quantities, result_unit=result_unit, language=language)
    r = ev.result
    base = {k: r[k] for k in ("expression", "quantities", "calc_id", "engine") if k in r}
    if not r.get("ok"):
        return {**base, "ok": False, "error": r.get("error", "calculation refused")}

    shown = ev.shown
    student: dict[str, Any] | None = None
    ignored: str | None = None
    if student_value and str(student_value).strip():
        sv = str(student_value).strip()
        try:
            magnitude = float(_parse_quantity_value(sv).magnitude)
        except CalcError:
            magnitude = None
        if magnitude is not None and not _appears_in(magnitude, student_text):
            ignored = "student_value is not in the student's message, so it does not count"
        else:
            student = {"value": sv, **_compare(sv, shown)}

    held = mode == "hold" and not (student and student["status"] == "match")
    if student and "ratio_raw" in student:
        student.update(_direction(student.pop("ratio_raw"), held=held))

    card: dict[str, Any] = {
        **base,
        "ok": True,
        "mode": mode,
        "held": held,
        "working": "$" + " = ".join(ev.working) + "$",
    }
    if r.get("constants_used"):
        card["constants_used"] = r["constants_used"]
    if held:
        # The unit the student should answer in. Unprefixed unless the tutor asked
        # for one: "= ? kJ" already says the answer is in the thousands.
        unit_q = shown if result_unit else _report_unit(shown, prefixes=False)
        card["result_unit_latex"] = format_unit(unit_q.units).removeprefix(r"\,")
        card["note"] = (
            "The student sees the working WITHOUT the final value: this tutor lets the student work it out. "
            "Do not write the value in your reply. Check privately with calculate."
        )
    else:
        card["latex"] = r["latex"]
        card["result"] = {"value": r["result"]["value"], "unit": r["result"]["unit"]}
    if student:
        card["student"] = student
    if ignored:
        card["student_value_ignored"] = ignored
    return card


__all__ = ["MATCH_TOLERANCE", "CalculationResults", "calculation_card", "numbers_in"]
