r"""``calculate`` and ``show_calculation``: the tutor's verifiable calculator (1.1.152 M2, M4).

Design: docs/design/aipla/v1.1.0-feedback/verifiable-maths-tool.md

**Attached to every agent ``create_agent`` builds, unconditionally.** The design
said "every student-facing tutor". It is attached wherever the notation preamble
is applied instead, because M3 puts "call ``calculate`` before stating a number
you derived" into that preamble, and the preamble is unconditional
(``adk/math_notation.py``). A rule that names a tool the agent does not have is
the contradiction the 29 Sept meeting asked to guard against. It is also the
notation block's own argument: a per-skill list is one more registration site
for the next tutor to miss. A teacher co-pilot or analytics chat that does
arithmetic is better off with the tool than without it.

**Private to the tutor.** The result is NOT in
``adk.stream_redaction._CLIENT_RENDER_TOOLS``, so a student stream carries the
redaction sentinel in its place. That is the design's rule 1: ``calculate`` is
how the tutor *checks*, and a check of a student's answer must not hand them
the answer. The call's NAME still reaches the chip ("Bruger calculate…"), which
is why the tool has a neutral name and not ``check_answer``.

**``show_calculation`` is the visible one (M4).** Same inputs, same engine,
re-evaluated, so the number on the student's ``CalculationCard`` is the
engine's and never the model's. It IS in ``_CLIENT_RENDER_TOOLS``. On a tutor
whose SKILL.md says ``calculationResults: hold`` the payload carries the working
but not the final value until the student's own answer matches it, and the
student's answer counts only when it is in the student's own message. The rules
and why live in ``maths/card.py``.

**In-process and offline.** Never Gemini's ``BuiltInCodeExecutor`` (design F2,
1.1.158 F4): the same call returns the same ``calc_id`` on any model tier.
Whether a local model *calls* it is that model's capability (O4).

Parameter types are plain ``str`` / ``list[str]`` on purpose. A
``dict[str, str]`` becomes ``additionalProperties``, which model function
declarations handle badly, and the 2026-10-23 ADK upgrade already cost one
schema bug (``39fe8b6f``).
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import FunctionTool, ToolContext

from maths import calculate as _engine_calculate
from maths.card import CalculationResults, calculation_card

log = logging.getLogger(__name__)

TOOL_NAME = "calculate"
SHOW_TOOL_NAME = "show_calculation"


def _student_text(tool_context: ToolContext | None) -> str | None:
    """The text of the message this turn answers, or None when there is none to read.

    None makes a ``student_value`` not count (fail closed): without the student's
    message there is no way to tell their answer from one the model made up.
    """
    content = getattr(tool_context, "user_content", None) if tool_context is not None else None
    parts = getattr(content, "parts", None) or []
    text = " ".join(p.text for p in parts if getattr(p, "text", None))
    return text or None


def _language(cfg: Any, student_language: str | None) -> str:
    """The student's explicit DA|EN choice wins, then the activity's language, then Danish."""
    for value in (student_language, getattr(cfg, "language", None) if cfg is not None else None):
        if value in ("da", "en"):
            return value
    return "da"


def build_calc_tools(
    cfg: Any = None,
    *,
    student_language: str | None = None,
    calculation_results: CalculationResults = "show",
) -> list[FunctionTool]:
    """``calculate`` and ``show_calculation``, with LaTeX in the conversation's language.

    ``calculation_results`` is the skill's ``calculationResults``: ``hold`` keeps
    the final value off the student's card until their own answer matches it.
    """
    language = _language(cfg, student_language)
    mode: CalculationResults = "hold" if calculation_results == "hold" else "show"

    def calculate(
        expression: str,
        quantities: list[str] | None = None,
        result_unit: str = "",
        check: str = "",
    ) -> dict[str, Any]:
        """Calculate a physical quantity exactly, with units. Use it instead of doing arithmetic yourself.

        Call this BEFORE you state any number you derived: a product, a quotient,
        a unit conversion, a rearranged value. Call it BEFORE you tell a student
        their number is right or wrong. You do not need it for a number the
        student, the activity or the simulation already gave, used as given.

        The result is for YOU. The student does not see it. To check a student's
        answer, compare it with the result and tell them which DIRECTION to look
        in ("your energy is a factor of 60 off: look at the unit of t"). Do not
        tell them the correct value.

        Never state a calculated number this tool did not produce. If it returns
        ``ok: false``, the error says what is wrong, often a unit. Turn that into
        a question for the student instead of guessing.

        Args:
            expression: The relationship to evaluate, in symbols: "P * t",
                "m * c * ΔT", "sqrt(2 * g * h)", "v_0 * t + 0.5 * a * t**2".
                Operators: + - * / ** (or ^). Functions: sqrt sin cos tan asin
                acos atan exp ln log abs. Constants: pi, g (9.82 m/s^2, unless
                you give g yourself), c, and q_e (the elementary charge). There
                is no e: write q_e for the charge, exp(x) for Euler's number.
            quantities: One string per symbol, "symbol = value unit":
                ["P = 2000 W", "t = 3 min"]. Danish decimal commas are fine
                ("9,82 m/s^2"). An angle needs its unit ("30 deg", "0.5 rad"). A
                temperature DIFFERENCE is in K ("ΔT = 80 K"), never °C.
            result_unit: The unit to give the answer in, e.g. "kJ" or "km/h".
                Leave empty for the SI unit. It is refused if the dimensions differ.
            check: Optional. An equation to check for dimensional consistency,
                e.g. "E = P / t". The answer is "consistent" or "inconsistent: …".

        Returns:
            ok, result (value + unit, and the SI value), latex (the whole
            calculation, ready to paste into your reply in the house style),
            calc_id (identifies this exact calculation for re-checking), and
            error when ok is false.
        """
        result = _engine_calculate(
            expression,
            quantities,
            result_unit=result_unit or None,
            check=check or None,
            language=language,
        )
        log.info(
            "calculate %s ok=%s calc_id=%s",
            result.get("expression"),
            result.get("ok"),
            result.get("calc_id"),
        )
        return result

    def show_calculation(
        expression: str,
        quantities: list[str] | None = None,
        result_unit: str = "",
        student_value: str = "",
        tool_context: ToolContext | None = None,
    ) -> dict[str, Any]:
        """Show the student a calculation as a card: the equation, the values put in, and the result.

        The platform works the calculation out again itself, so the number the
        student sees is always right. Use it for a worked example (with numbers
        that are NOT the student's own task), to relate two simulation readings
        the student has taken, or to check an answer the student gave. The card
        is the calculation: do not repeat its number in your reply; say what it
        means.

        Some tutors let the student work the number out themselves. Then the
        card shows the working but not the final value, and the result says
        ``held: true``. When the student gives an answer, pass it as
        ``student_value``: the card tells them whether it matches, or which way
        it is off, still without the value.

        Args:
            expression: The relationship, in symbols, as for calculate: "P * t".
            quantities: One string per symbol, "symbol = value unit", as for
                calculate: ["P = 2000 W", "t = 150 s"].
            result_unit: The unit to show the answer in, e.g. "kJ". Leave empty
                for the SI unit.
            student_value: The student's own answer with its unit, EXACTLY as
                they wrote it in their message ("18000 kJ"). Leave empty if they
                have not given one. A value that is not in their message is
                ignored.

        Returns:
            ok, held, working (the equation with the values put in), result and
            latex when not held, student (status match | mismatch |
            different_quantity | no_unit | unreadable, and a direction for a
            mismatch), and error when ok is false.
        """
        card = calculation_card(
            expression,
            quantities,
            result_unit=result_unit or None,
            student_value=student_value or None,
            mode=mode,
            language=language,
            student_text=_student_text(tool_context),
        )
        log.info(
            "show_calculation %s ok=%s held=%s student=%s calc_id=%s",
            card.get("expression"),
            card.get("ok"),
            card.get("held"),
            (card.get("student") or {}).get("status"),
            card.get("calc_id"),
        )
        return card

    return [FunctionTool(calculate), FunctionTool(show_calculation)]


__all__ = ["SHOW_TOOL_NAME", "TOOL_NAME", "build_calc_tools"]
