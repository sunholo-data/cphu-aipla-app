"""One portable file per sim: it runs anywhere, and comes back in unchanged.

A sim in AIPLA is two files (``index.html`` + its catalogue entry), and the page
leans on AIPLA's sandbox for two things: the guest bridge (stamped between the
``@aipla-bridge`` markers when it is published) and any shared library, loaded
from the sandbox's own ``/vendor/`` path. Opened anywhere else (a laptop, a
colleague's server, ChatGPT or Claude as an MCP App) that page has no bridge and
no libraries.

``bundle`` makes the self-contained form: the canonical bridge stamped in, every
``/vendor/`` script inlined (its bytes checked against vendor.json first), and,
for a file a teacher keeps, the catalogue entry embedded as a data block, so one
``.html`` carries the whole sim. The bridge falls back quietly with no host, so
the file also runs when simply opened in a browser.

``unbundle`` is the way back in: it takes the catalogue entry out, puts each
inlined library back as its ``/vendor/`` tag (only when the bytes still match the
manifest) and an outdated bridge back to its placeholder, so an imported sim is
checked by exactly the gates a sim written in the workshop is.

The embedded catalogue includes the tutorBlock, whose reference values are for
the tutor only. A file for a teacher may carry it; a page served to a host the
student sees (MCP) is bundled WITHOUT it.
"""

from __future__ import annotations

import base64
import hashlib
import html as html_lib
import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

PORTABLE_MARK = "<!-- aipla-portable: v1 -->"
CATALOGUE_ID = "aipla-catalogue"
BRIDGE_PLACEHOLDER = (
    "<script>/* The shared AIPLA guest bridge is stamped in here by `make sim-build`.\n"
    "            Do not write it. It is absent until that step runs, so reach it\n"
    "            only through the guard below. */</script>"
)

_VENDOR_TAG_RE = re.compile(r"<script\b[^>]*\bsrc\s*=\s*[\"'](/vendor/[^\"']+)[\"'][^>]*>\s*</script>", re.I)
_INLINED_RE = re.compile(
    r"<script\b[^>]*\bdata-aipla-vendor\s*=\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</script>", re.I | re.S
)
_CATALOGUE_RE = re.compile(
    r"\n?<script\b[^>]*\bid\s*=\s*[\"']" + CATALOGUE_ID + r"[\"'][^>]*>(.*?)</script>\n?", re.I | re.S
)
_BRIDGE_RE = re.compile(
    r"(<!--\s*@aipla-bridge:start\b[^>]*-->\n?)(.*?)(\n?[ \t]*<!--\s*@aipla-bridge:end\s*-->)", re.S
)

_REPO_SANDBOX = Path(__file__).resolve().parents[2] / "infrastructure" / "mcp-sandbox"


class NotPortable(Exception):
    """The page cannot be made portable, or read back in; the message says why."""


def _manifest() -> dict[str, tuple[str, str]]:
    """``/vendor/<lib>/<version>/<file>`` -> (sha384, repo-relative source) from vendor.json."""
    from sim_gates import BACKEND_COPIES

    path = _REPO_SANDBOX / "vendor.json"
    if not path.is_file():
        path = BACKEND_COPIES / "vendor.json"
    libs = json.loads(path.read_text()).get("libraries", {})
    return {
        f"/vendor/{lib}/{entry['version']}/{name}": (spec["sha384"], spec.get("from", ""))
        for lib, entry in libs.items()
        for name, spec in entry.get("files", {}).items()
    }


def _sha384(text: str) -> str:
    return base64.b64encode(hashlib.sha384(text.encode("utf-8")).digest()).decode("ascii")


@lru_cache(maxsize=16)
def vendor_source(src: str) -> str:
    """A vendored library's source, verified against vendor.json. The repo copy in
    a checkout, else the deployed sandbox's (the backend image carries no copy)."""
    manifest = _manifest()
    if src not in manifest:
        raise NotPortable(f"{src} is not a vendored library")
    sha, rel = manifest[src]
    text: str | None = None
    local = _REPO_SANDBOX / rel if rel else None
    if local is not None and local.is_file():
        text = local.read_text(encoding="utf-8")
    else:
        base = os.getenv("MCP_SANDBOX_URL", "").rsplit("/sandbox.html", 1)[0].rstrip("/")
        if not base:
            raise NotPortable(f"{src} is not available here (no repo copy and MCP_SANDBOX_URL unset)")
        import httpx

        resp = httpx.get(base + src, timeout=15.0)
        resp.raise_for_status()
        text = resp.text
    if _sha384(text) != sha:
        raise NotPortable(f"{src} does not match its vendor.json hash; refusing to inline it")
    return text


def _script_safe(text: str) -> str:
    # Inside <script>, only "</script" ends the element; "<\/" means the same to JS.
    return re.sub(r"</(script)", r"<\\/\1", text, flags=re.I)


def _script_unsafe(text: str) -> str:
    return re.sub(r"<\\/(script)", r"</\1", text, flags=re.I)


def bundle(index_html: str, catalogue_yaml: str | None, *, bridge: str | None) -> str:
    """The self-contained page: bridge stamped, libraries inlined, catalogue embedded when given."""
    page = unbundle(index_html)[0] if PORTABLE_MARK in index_html else index_html

    if bridge:
        m = _BRIDGE_RE.search(page)
        if m:
            block = "<script>\n" + bridge.rstrip("\n") + "\n</script>"
            page = page[: m.start(2)] + block + page[m.end(2) :]

    def inline(m: re.Match[str]) -> str:
        src = m.group(1)
        return f'<script data-aipla-vendor="{html_lib.escape(src)}">{_script_safe(vendor_source(src))}</script>'

    page = _VENDOR_TAG_RE.sub(inline, page)

    head_extra = PORTABLE_MARK
    if catalogue_yaml:
        head_extra += (
            f'\n<script type="application/yaml" id="{CATALOGUE_ID}">\n'
            f"{_script_safe(catalogue_yaml.rstrip())}\n</script>"
        )
    if re.search(r"</head>", page, re.I):
        page = re.sub(r"</head>", lambda _: head_extra + "\n</head>", page, count=1, flags=re.I)
    else:
        page = head_extra + "\n" + page
    return page


def unbundle(page: str) -> tuple[str, str | None]:
    """Back to AIPLA's two-file form: (index.html with /vendor/ tags and the bridge placeholder, catalogue or None).

    Accepts a portable file, a page with a stamped bridge, or a plain draft; a page
    with nothing to undo comes back unchanged.
    """
    catalogue: str | None = None
    m = _CATALOGUE_RE.search(page)
    if m:
        catalogue = _script_unsafe(m.group(1)).strip("\n") + "\n"
        page = page[: m.start()] + "\n" + page[m.end() :]
    page = page.replace(PORTABLE_MARK + "\n", "").replace(PORTABLE_MARK, "")

    manifest = _manifest()

    def restore(m: re.Match[str]) -> str:
        src = html_lib.unescape(m.group(1))
        if src not in manifest:
            raise NotPortable(f"the page inlines {src}, which is not a vendored library")
        sha = manifest[src][0]
        if _sha384(_script_unsafe(m.group(2))) != sha:
            raise NotPortable(f"the inlined {src} has been changed; it no longer matches vendor.json")
        return f'<script src="{src}" integrity="sha384-{sha}" crossorigin="anonymous"></script>'

    page = _INLINED_RE.sub(restore, page)

    # A stamped bridge stays when it is today's canonical one (the gates accept it,
    # and a page written for a stamped bridge calls it bare); an older or edited
    # copy goes back to the placeholder, to be stamped afresh on publish.
    b = _BRIDGE_RE.search(page)
    if b and "AIPLA_BRIDGE" in b.group(2) and len(b.group(2)) >= 800:
        from sim_gates import load_bridge

        canonical = load_bridge()
        if not canonical or canonical.strip() not in b.group(2):
            page = page[: b.start(2)] + BRIDGE_PLACEHOLDER + page[b.end(2) :]
    return page, catalogue
