"""Small text helpers shared by the tiers: the bridge region, line numbers, and a
JavaScript scanner that knows about strings and comments.

The scanner is not a parser. It finds the matching brace of a block and the
string literals in a script, skipping quotes and comments so a ``}`` inside a
string does not end a block. That is all the gates need.
"""

from __future__ import annotations

import re

BRIDGE_REGION_RE = re.compile(r"<!--\s*@aipla-bridge:start[\s\S]*?<!--\s*@aipla-bridge:end\s*-->")


def strip_bridge(html: str) -> str:
    """The sim's own code: the generated bridge is checked by the drift guard, and
    its own URLs and emit() calls must not count for or against the sim. Replaced
    by as many newlines so line numbers stay true."""
    return BRIDGE_REGION_RE.sub(lambda m: "\n" * m.group(0).count("\n"), html)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def hits(pattern: re.Pattern[str], text: str, limit: int = 5) -> list[str]:
    """``line N: <excerpt>`` for the first ``limit`` matches."""
    out = []
    for m in pattern.finditer(text):
        excerpt = text[max(0, m.start() - 20) : m.end() + 20].replace("\n", " ").strip()
        out.append(f"line {line_of(text, m.start())}: {excerpt}")
        if len(out) >= limit:
            break
    return out


def _skip(text: str, i: int) -> int:
    """If a string or comment starts at ``i``, return the index after it; else ``i``."""
    c = text[i]
    if c in "\"'`":
        j = i + 1
        while j < len(text):
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == c:
                return j + 1
            j += 1
        return j
    if text.startswith("//", i):
        j = text.find("\n", i)
        return len(text) if j < 0 else j
    if text.startswith("/*", i):
        j = text.find("*/", i + 2)
        return len(text) if j < 0 else j + 2
    return i


def block_after(text: str, open_index: int) -> str | None:
    """The contents of the ``{...}`` whose ``{`` is at ``open_index``."""
    depth, i = 0, open_index
    while i < len(text):
        j = _skip(text, i)
        if j != i:
            i = j
            continue
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_index + 1 : i]
        i += 1
    return None


_KEY_RE = re.compile(r"""\s*(?:["']([^"']+)["']|([A-Za-z_$][\w$]*))\s*:""")


def top_level_keys(body: str) -> set[str]:
    """Keys at depth 0 of an object literal's body."""
    keys: set[str] = set()
    depth, i, at_entry = 0, 0, True
    while i < len(body):
        if depth == 0 and at_entry:
            m = _KEY_RE.match(body, i)
            if m:
                keys.add(m.group(1) or m.group(2))
                i = m.end()
                at_entry = False
                continue
        j = _skip(body, i)
        if j != i:
            i, at_entry = j, False
            continue
        c = body[i]
        if c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
        elif c == "," and depth == 0:
            at_entry = True
        elif not c.isspace():
            at_entry = False
        i += 1
    return keys


def string_literals(text: str) -> list[str]:
    """Every quoted literal in a script (template literals without ``${``)."""
    out, i = [], 0
    while i < len(text):
        j = _skip(text, i)
        if j != i:
            if text[i] in "\"'`":
                lit = text[i + 1 : j - 1]
                if not (text[i] == "`" and "${" in lit):
                    out.append(lit)
            i = j
        else:
            i += 1
    return out
