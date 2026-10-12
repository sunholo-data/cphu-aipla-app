"""Tier A — the blank-frame class: the ADR-013, CSP and layout checks.

Ported from ``audit_artefact.sh`` gate for gate, same thresholds. A failure here
usually shows in the browser as *nothing*: the sandbox CSP is
``default-src 'none'`` and a violation renders an empty frame with no error,
which is why these come first and why each ``fix`` names the mechanism.

One deliberate change from the bash: gate 1 (external fetches) used a ``(?!…)``
lookahead, which POSIX ``grep -E`` rejects. grep exited 2, ``2>/dev/null`` hid it,
and the empty result counted as a pass, so the gate never checked anything
(found 2026-10-12). Here it is a real check, and it ignores the generated bridge
(which names the app origin) and XML namespace URIs (which are identifiers, not
fetches).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from ._text import hits
from .report import Gate

MAX_BYTES = 200 * 1024
_URL_RE = re.compile(r"https?://[^\s\"'<>)]+")
_NAMESPACE_PREFIXES = ("http://www.w3.org/",)
_FETCH_RE = re.compile(
    r"\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(\s*[\"'`]https?:|new\s+EventSource\s*\(|sendBeacon\s*\("
)
_SCRIPT_SRC_EXT_RE = re.compile(r"<script[^>]*\bsrc\s*=\s*[\"']https?://", re.I)
_CSS_EXT_RE = re.compile(r"@import\s+[\"']https?://|url\(\s*[\"']?https?://|<link[^>]*href\s*=\s*[\"']https?://", re.I)
_DARK_RE = re.compile(
    r"prefers-color-scheme:\s*dark|background:\s*#?[01]{6}\b|background:\s*black|background-color:\s*#?[01]{6}\b"
)
_IFRAME_RE = re.compile(r"<iframe", re.I)
_EXEC_RE = re.compile(r"\beval\(|new Function\(|new WebSocket\(")
_MINW_RE = re.compile(r"min-width\s*:\s*(\d+)px")
_FONT_PX_RE = re.compile(r"font-size\s*:\s*([0-9.]+)px")
_FONT_REM_RE = re.compile(r"font-size\s*:\s*([0-9.]+)rem")
_SCRIPT_TAG_RE = re.compile(r"<script\b[^>]*\bsrc\s*=[^>]*>", re.I)


def _gate(gid: str, found: list[str], fix: str) -> Gate:
    return Gate(gid, "fail", "; ".join(found), fix) if found else Gate(gid, "pass")


def check(html: str, app: str, total_bytes: int, vendor_manifest: Path | None) -> list[Gate]:
    """``html`` is the whole file, ``app`` the same with the bridge region blanked."""
    gates: list[Gate] = []

    urls = [m for m in _URL_RE.finditer(app) if not m.group(0).startswith(_NAMESPACE_PREFIXES)]
    found = [f"line {app.count(chr(10), 0, m.start()) + 1}: {m.group(0)[:80]}" for m in urls[:5]]
    found += hits(_FETCH_RE, app)
    gates.append(
        _gate(
            "A.no_external_fetch",
            found,
            "Remove every URL and network call. The sandbox CSP is connect-src 'none', so the browser blocks "
            "them silently and the sim breaks with no error. Everything the sim needs must be inline.",
        )
    )
    gates.append(
        _gate(
            "A.no_external_script",
            hits(_SCRIPT_SRC_EXT_RE, html),
            "Inline the script. An external <script src> is blocked by the CSP and the page renders blank.",
        )
    )
    gates.append(
        _gate(
            "A.no_external_css",
            hits(_CSS_EXT_RE, html),
            "Inline the CSS and use system font stacks. External stylesheets and fonts are blocked by the CSP.",
        )
    )
    size_detail = f"{total_bytes / 1024:.1f} KB"
    gates.append(
        Gate("A.size", "pass", size_detail)
        if total_bytes <= MAX_BYTES
        else Gate(
            "A.size",
            "fail",
            f"{size_detail}, cap 200 KB",
            "Trim the page under 200 KB (ADR-013): fewer drawn segments, shared helpers, no embedded data URIs.",
        )
    )
    gates.append(
        _gate(
            "A.light_theme",
            hits(_DARK_RE, html),
            "Use a light theme. The workspace around the sim is light, so a dark sim reads as a broken app.",
        )
    )
    gates.append(
        _gate(
            "A.no_iframe",
            hits(_IFRAME_RE, app),
            "Remove the nested iframe. The sim is already the sandboxed frame and frame-src is 'none'.",
        )
    )
    gates.append(
        _gate(
            "A.no_dynamic_code",
            hits(_EXEC_RE, app),
            "Remove eval, new Function and WebSocket. The CSP blocks them and the script stops at that line.",
        )
    )
    wide = [
        m
        for m in _MINW_RE.finditer(html)
        if int(m.group(1)) > 600 and "@media" not in html[html.rfind("\n", 0, m.start()) + 1 : m.start()]
    ]
    gates.append(
        _gate(
            "A.min_width",
            [f"line {html.count(chr(10), 0, m.start()) + 1}: {m.group(0)}" for m in wide[:5]],
            "Drop min-width above 600px. The workspace pane is about 700px and phones are 390px, so a wider "
            "minimum forces horizontal scrolling. Breakpoints in @media are fine.",
        )
    )
    small = [m for m in _FONT_PX_RE.finditer(html) if float(m.group(1)) < 11]
    small += [m for m in _FONT_REM_RE.finditer(html) if float(m.group(1)) < 0.6875]
    gates.append(
        _gate(
            "A.min_font",
            [f"line {html.count(chr(10), 0, m.start()) + 1}: {m.group(0)}" for m in small[:5]],
            "Raise every font-size to at least 11px (0.6875rem). Smaller text is unreadable on a phone.",
        )
    )
    has_markers = "@aipla-bridge:start" in html and "@aipla-bridge:end" in html
    gates.append(
        Gate("A.bridge_present", "pass")
        if has_markers
        else Gate(
            "A.bridge_present",
            "fail",
            "no @aipla-bridge:start / @aipla-bridge:end markers",
            "Add the two bridge marker comments around a placeholder <script>. Without them the sim cannot talk "
            "to the host, and `make sim-build` has nowhere to stamp the bridge.",
        )
    )
    gates.append(_vendor_gate(html, vendor_manifest))
    return gates


def _vendor_gate(html: str, manifest: Path | None) -> Gate:
    tags = _SCRIPT_TAG_RE.findall(html)
    if not tags:
        return Gate("A.vendor_scripts", "pass", "no <script src>")
    if manifest is None or not manifest.is_file():
        return Gate("A.vendor_scripts", "skipped", f"{len(tags)} <script src> tag(s) and no vendor.json to check them")
    try:
        libs = json.loads(manifest.read_text()).get("libraries", {})
    except (OSError, ValueError) as exc:
        return Gate("A.vendor_scripts", "error", f"cannot read {manifest}: {exc}")
    allowed = {
        f"/vendor/{lib}/{entry['version']}/{name}": spec["sha384"]
        for lib, entry in libs.items()
        for name, spec in entry.get("files", {}).items()
    }
    problems = []
    for tag in tags:
        src = (re.search(r"\bsrc\s*=\s*[\"']([^\"']+)[\"']", tag, re.I) or [None, None])[1]
        integrity = (re.search(r"\bintegrity\s*=\s*[\"']([^\"']+)[\"']", tag, re.I) or [None, None])[1]
        if src not in allowed:
            problems.append(f"{src} is not a vendored library (vendor.json)")
            continue
        if integrity != f"sha384-{allowed[src]}":
            problems.append(f"{src} integrity must be sha384-{allowed[src]}")
        if not re.search(r"\bcrossorigin\s*=\s*[\"']anonymous[\"']", tag, re.I):
            problems.append(f'{src} needs crossorigin="anonymous" or SRI is not enforced')
    return _gate(
        "A.vendor_scripts",
        problems,
        "Load a library only from its /vendor/ path with the manifest's sha384 integrity and "
        'crossorigin="anonymous", or inline it.',
    )
