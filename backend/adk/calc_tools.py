r"""``calculate``: the tutor's verifiable calculator, as an ADK FunctionTool (1.1.152 M2).

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
the answer. Showing a worked calculation is ``show_calculation`` (M4), which
waits on AR/JB (O2). The call's NAME still reaches the chip ("Bruger
calculate…"), which is why the tool has a neutral name and not ``check_answer``.

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

from google.adk.tools import FunctionTool

from maths import calculate as _engine_calculate

log = logging.getLogger(__name__)

TOOL_NAME = "calculate"


def _language(cfg: Any, student_language: str | None) -> str:
    """The student's explicit DA|EN choice wins, then the activity's language, then Danish."""
    for value in (student_language, getattr(cfg, "language", None) if cfg is not None else None):
        if value in ("da", "en"):
            return value
    return "da"


def build_calc_tools(cfg: Any = None, *, student_language: str | None = None) -> list[FunctionTool]:
    """The ``calculate`` tool, with its LaTeX in the conversation's language."""
    language = _language(cfg, student_language)

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

    return [FunctionTool(calculate)]


__all__ = ["TOOL_NAME", "build_calc_tools"]
