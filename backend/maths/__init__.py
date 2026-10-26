"""The tutor's verifiable calculator (1.1.152 M2).

A closed grammar over physical quantities: a whitelisted Python-AST parser,
units with ``pint``, and LaTeX in the platform's house style. Pure, in-process
and offline, so the same call gives the same ``calc_id`` and the same result on
any model tier, including the on-prem tiers ADR-003 describes. It is
deliberately NOT Gemini's ``BuiltInCodeExecutor`` (design F2, 1.1.158 F4).

Design: docs/design/aipla/v1.1.0-feedback/verifiable-maths-tool.md
"""

from maths.engine import ENGINE_VERSION, calculate

__all__ = ["ENGINE_VERSION", "calculate"]
