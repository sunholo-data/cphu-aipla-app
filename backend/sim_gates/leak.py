"""Tier D — the quantity the student derives must not be on screen.

Only runs when the caller names ``hidden_terms`` (from the brief: a symbol, a
word, a value). Greps what a student can read — string literals in the sim's
script and the markup's text — for each term as a whole word. It cannot see a
value the sim computes and prints (``num(eta)``), and says so.
"""

from __future__ import annotations

import re

from ._text import string_literals
from .report import Gate

_SCRIPT_RE = re.compile(r"<script\b[^>]*>([\s\S]*?)</script>", re.I)
_STYLE_RE = re.compile(r"<style\b[^>]*>[\s\S]*?</style>", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
NOT_SEEN = "a hidden value the sim computes and prints at runtime (only the browser drive can see that)"


def check(app: str, hidden_terms: list[str] | None) -> list[Gate]:
    if not hidden_terms:
        return [Gate("D.hidden_terms", "skipped", "no hidden terms supplied")]
    literals = [lit for script in _SCRIPT_RE.findall(app) for lit in string_literals(script)]
    markup = _TAG_RE.sub(" ", _STYLE_RE.sub(" ", _SCRIPT_RE.sub(" ", app)))
    surfaces = [*literals, markup]
    found = []
    for term in hidden_terms:
        pattern = re.compile(rf"(?<![\w]){re.escape(term)}(?![\w])", re.I)
        for text in surfaces:
            m = pattern.search(text)
            if m:
                found.append(f"{term!r} in {text[max(0, m.start() - 25) : m.end() + 25].strip()!r}")
                break
    if found:
        return [
            Gate(
                "D.hidden_terms",
                "fail",
                "; ".join(found[:5]),
                "Remove the quantity the student is meant to derive from every label, readout and event label. "
                "If the sim shows it, there is nothing left to work out.",
            )
        ]
    return [Gate("D.hidden_terms", "pass", f"{len(hidden_terms)} term(s) not found")]
