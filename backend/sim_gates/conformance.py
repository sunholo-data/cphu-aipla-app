"""Tier B — what the authoring prompt asks for, checked instead of trusted.

The prompt ends with a self-check the model performs on its own output. These
are the mechanical items of that list, run by something that does not want the
draft to pass. Each ``fix`` names the mechanism, because models fix what they
understand and re-break what they were merely told.

Sims that predate the prompt (boldkast, led-planck, kinebot, sol-jord-maane)
fail some of these by design; ``test_sim_gates.py`` names which and why.
"""

from __future__ import annotations

import re
from pathlib import Path

from ._text import block_after, hits, top_level_keys
from .proactive import proactive_category
from .report import Gate

_BRIDGE_BODY_RE = re.compile(r"<!--\s*@aipla-bridge:start[^>]*-->\n?([\s\S]*?)\n?[ \t]*<!--\s*@aipla-bridge:end\s*-->")
_GUARD_RE = re.compile(
    r"typeof\s+(?:window\.)?AIPLA_BRIDGE\s*[!=]==?\s*[\"']undefined[\"']\s*\?\s*null\s*:\s*(?:window\.)?AIPLA_BRIDGE"
)
_TYPEOF_RE = re.compile(r"typeof\s+(?:window\.)?AIPLA_BRIDGE")
_BARE_RE = re.compile(r"\bAIPLA_BRIDGE\b")
_OPT_OUT_RE = re.compile(r"<!--\s*@aipla-no-broadcast\b")
_HAS_EMIT_RE = re.compile(r"\bemit\s*\(")
_LABELLED_EMIT_RE = re.compile(r"\bemit\s*\([^;]*\blabel\b")
_VERB_RE = re.compile(r"\bemit\s*\(\s*[\"'`]([\w-]+)[\"'`]")
_STRINGS_RE = re.compile(r"\b(?:const|let|var)\s+strings\s*=\s*\{")
_LOCALE_RE = re.compile(r"\b(da|en)\s*:\s*\{")
_NAME_RE = re.compile(r"\b(?:const|let|var)\s+ARTEFACT_NAME\s*=\s*[\"']([^\"']+)[\"']")


STAMPED = "the stamped canonical bridge"
_COMMENT_RE = re.compile(r"/\*[\s\S]*?\*/|(?<![:\\])//[^\n]*")


def emitted_verbs(app: str) -> list[str]:
    return sorted(set(_VERB_RE.findall(app)))


def artefact_name(app: str) -> str | None:
    m = _NAME_RE.search(app)
    return m.group(1) if m else None


def check(html: str, app: str, canonical_bridge: str | None) -> list[Gate]:
    body_gate = _bridge_body(html, canonical_bridge)
    gates = [body_gate, _bridge_guard(app, stamped=body_gate.detail == STAMPED)]

    gates.append(
        Gate("B.artefact_name", "pass", artefact_name(app) or "")
        if artefact_name(app)
        else Gate(
            "B.artefact_name",
            "fail",
            'no `const ARTEFACT_NAME = "<id>"`',
            "Declare the id once as ARTEFACT_NAME and build every event name from it, so the events, the "
            "catalogue entry and the frame agree.",
        )
    )
    gates.append(_strings(app))

    if _OPT_OUT_RE.search(html):
        gates.append(Gate("B.labelled_emit", "warning", "opted out with @aipla-no-broadcast"))
    elif not _HAS_EMIT_RE.search(app):
        gates.append(
            Gate(
                "B.labelled_emit",
                "fail",
                "no emit() calls",
                "Emit the sim's events through emit(). Without them the tutor never learns what the student did.",
            )
        )
    elif _LABELLED_EMIT_RE.search(app):
        gates.append(Gate("B.labelled_emit", "pass"))
    else:
        gates.append(
            Gate(
                "B.labelled_emit",
                "fail",
                "emit() calls but none carries a label",
                'Add `label: "<what the student did>"` to the deliberate action\'s emit(). The label is the only '
                "thing that shows the student a 'shared with the AI' card and wakes the tutor.",
            )
        )

    verbs = emitted_verbs(app)
    waking = [v for v in verbs if proactive_category(v)]
    gates.append(
        Gate("B.trigger_verb", "pass", ", ".join(waking))
        if waking
        else Gate(
            "B.trigger_verb",
            "fail",
            f"emitted verbs: {', '.join(verbs) or 'none'}; none wakes the tutor",
            "Name the deliberate action with a verb from the trigger list (run, step, reading, record, measure, "
            "complete …). The tutor's gate matches only those words, so any other verb is silently ignored.",
        )
    )
    gates.append(_self_test(app))
    return gates


def _bridge_body(html: str, canonical: str | None) -> Gate:
    m = _BRIDGE_BODY_RE.search(html)
    if not m:
        return Gate("B.bridge_body", "skipped", "no bridge markers (see A.bridge_present)")
    body = m.group(1)
    if "AIPLA_BRIDGE" not in body or len(body) < 800:
        return Gate("B.bridge_body", "pass", "placeholder, to be stamped by make sim-build")
    if canonical is None:
        return Gate("B.bridge_body", "skipped", "a bridge body is present and the canonical bridge was not available")
    if canonical.strip() in body:
        return Gate("B.bridge_body", "pass", STAMPED)
    return Gate(
        "B.bridge_body",
        "fail",
        "a bridge body that is not the canonical one",
        "Leave only a placeholder <script> between the bridge markers. `make sim-build` stamps the real bridge, "
        "and a hand-written one fails the drift check.",
    )


def _bridge_guard(app: str, stamped: bool) -> Gate:
    if stamped:
        # Once stamped, AIPLA_BRIDGE is defined above the sim's script and a bare
        # reference is safe. The guard matters for the draft, before stamping.
        return Gate("B.bridge_guard", "pass", "stamped: AIPLA_BRIDGE is defined")
    scrubbed = _TYPEOF_RE.sub("", _GUARD_RE.sub("", _COMMENT_RE.sub("", app)))
    found = hits(_BARE_RE, scrubbed)
    if not found:
        return Gate("B.bridge_guard", "pass")
    return Gate(
        "B.bridge_guard",
        "fail",
        "; ".join(found),
        'Route every bridge call through `const bridge = () => (typeof AIPLA_BRIDGE === "undefined" ? null : '
        "AIPLA_BRIDGE)`. Until `make sim-build` runs, AIPLA_BRIDGE does not exist and a bare reference throws "
        "before the self-test can run.",
    )


def _strings(app: str) -> Gate:
    fix = (
        "Keep every student-visible string in one `const strings = { da: {…}, en: {…} }` with the same keys "
        "in both. Language is data: a string outside it cannot be translated, and a missing key prints undefined."
    )
    m = _STRINGS_RE.search(app)
    if not m:
        return Gate("B.strings_object", "fail", "no `const strings = {…}`", fix)
    body = block_after(app, m.end() - 1) or ""
    locales = {}
    for lm in _LOCALE_RE.finditer(body):
        inner = block_after(body, lm.end() - 1)
        if inner is not None and lm.group(1) not in locales:
            locales[lm.group(1)] = top_level_keys(inner)
    if set(locales) != {"da", "en"}:
        return Gate("B.strings_object", "fail", f"locales found: {sorted(locales) or 'none'}", fix)
    only_da, only_en = locales["da"] - locales["en"], locales["en"] - locales["da"]
    if only_da or only_en:
        detail = "; ".join(
            p
            for p in (
                f"only in da: {sorted(only_da)}" if only_da else "",
                f"only in en: {sorted(only_en)}" if only_en else "",
            )
            if p
        )
        return Gate("B.strings_object", "fail", detail, fix)
    return Gate("B.strings_object", "pass", f"{len(locales['da'])} keys")


def _self_test(app: str) -> Gate:
    fix = (
        "Add the ?test=1 self-test: it asserts a number you can verify by hand and sets document.title to "
        '"TEST PASS" or "TEST FAIL". Guard applyLang\'s title write with `if (!TEST_MODE)`, or it overwrites the verdict.'
    )
    if "TEST PASS" not in app or "TEST FAIL" not in app:
        return Gate("B.self_test", "fail", "no TEST PASS / TEST FAIL verdict", fix)
    if re.search(r"document\.title\s*=\s*t\(", app) and "TEST_MODE" not in app:
        # A warning: it is only a bug when applyLang runs after the self-test.
        return Gate("B.self_test", "warning", "applyLang writes document.title with no TEST_MODE guard", fix)
    return Gate("B.self_test", "pass")


def load_canonical_bridge(repo_root: Path) -> str | None:
    path = repo_root / "infrastructure" / "mcp-sandbox" / "bridge" / "aipla-mcp-bridge.js"
    return path.read_text() if path.is_file() else None
