"""Register AIPLA sims as portable MCP App resources on the FastMCP server.

This is the *server half* of "the sims are MCP Apps" (design 1.1.49). The View
half is already done — every artefact under
``infrastructure/mcp-sandbox/artefacts/<name>/v<ver>/index.html`` speaks the
SEP-1865 ``ui/*`` postMessage bridge. Here we offer each one to any standard MCP
host (Claude Desktop, ChatGPT, …) as:

  * a ``ui://aipla/<name>/<version>`` resource (mimeType
    ``text/html;profile=mcp-app``) whose body is the artefact HTML, and
  * a ``show_<name>`` tool whose ``_meta`` links to that resource via both
    ``ui.resourceUri`` (standard) and ``openai/outputTemplate`` (ChatGPT).

**Which sims.** The LIBRARY: every live built-in sim in the catalogue
(``backend/artefacts/*.yaml``) and every teacher sim a researcher signed off
for the shared library. A teacher's class-level sim is not offered: this
endpoint is public and unauthenticated (decision 2026-10-13, in-app sim
authoring). Library teacher sims change at runtime, so the list is refreshed
(``refresh_sim_apps``) at most every few minutes as requests arrive.

**Portable pages.** A host renders the page on its own origin with an empty
CSP, where AIPLA's ``/vendor/`` libraries cannot load, so each page is served
through ``sim_authoring.portable.bundle``: the canonical bridge stamped and its
libraries inlined (hash-checked). Never with the catalogue entry, whose
tutorBlock holds the answers. HTML comes from the repo in a checkout, from the
deployed sandbox otherwise (the backend image carries no artefacts), and from
Firestore for teacher sims; it loads on the first ``resources/read`` and is
cached per process.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import httpx
from mcp.server.fastmcp.resources import FunctionResource

logger = logging.getLogger(__name__)

UI_MIME_TYPE = "text/html;profile=mcp-app"
BRIDGE_MARKER = "ui/initialize"  # an artefact is MCP-App-ready iff it runs the handshake

# Repo artefacts dir: present in a checkout (local dev / CI), absent in the
# deployed backend image. Overridable for tests / packaging.
_DEFAULT_ARTEFACTS_DIR = Path(__file__).resolve().parents[2] / "infrastructure" / "mcp-sandbox" / "artefacts"
ARTEFACTS_DIR = Path(os.getenv("SIM_ARTEFACTS_DIR", _DEFAULT_ARTEFACTS_DIR))

# Deployed sandbox base origin, derived from the same _MCP_SANDBOX_URL the
# frontend uses (".../sandbox.html" -> ".../"). Only needed when the FS scan
# fails (i.e. in the deployed backend).
_SANDBOX_URL_ENV = os.getenv("MCP_SANDBOX_URL", "")
SANDBOX_BASE = _SANDBOX_URL_ENV.rsplit("/sandbox.html", 1)[0].rstrip("/") if _SANDBOX_URL_ENV else ""

# Widget metadata on the ui:// resource (design 1.1.49 Tier 1 — ChatGPT render +
# app-submission readiness). Our sims are fully self-contained (inline canvas/JS,
# no external fetches — verified), so the CSP locks down to NO external domains;
# the host keeps its restrictive default (self + unsafe-inline + data:), matching
# the sandbox's ADR-013 CSP. WIDGET_DOMAIN gives the view a stable, dedicated
# sandbox origin (ChatGPT renders under <domain>.web-sandbox.oaiusercontent.com)
# instead of a per-conversation one — set per-env via MCP_WIDGET_DOMAIN (omitted
# when unset, e.g. local dev). Both the standard _meta.ui.* keys and the
# OpenAI-flavoured aliases are emitted for host compatibility. None of this
# affects our own app, which reads structuredContent and ignores resource _meta.
WIDGET_DOMAIN = os.getenv("MCP_WIDGET_DOMAIN", "").strip()


def _widget_meta() -> dict:
    ui: dict = {
        "csp": {"connectDomains": [], "resourceDomains": [], "frameDomains": []},
        "prefersBorder": False,
    }
    meta: dict = {
        "ui": ui,
        # OpenAI-flavoured aliases (snake_case CSP), for the Apps SDK validator.
        "openai/widgetCSP": {"connect_domains": [], "resource_domains": [], "frame_domains": []},
    }
    if WIDGET_DOMAIN:
        ui["domain"] = WIDGET_DOMAIN
        meta["openai/widgetDomain"] = WIDGET_DOMAIN
    return meta


class SimApp:
    """One offered sim + a lazy, cached loader for its portable HTML."""

    def __init__(
        self,
        name: str,
        version: str,
        title: str,
        *,
        description: str = "",
        fs_path: Path | None = None,
        teacher_version: int | None = None,
    ) -> None:
        self.name = name
        self.version = version
        self.title = title
        self.description = description
        self._fs_path = fs_path
        self._teacher_version = teacher_version
        self._html: str | None = None

    @property
    def resource_uri(self) -> str:
        return f"ui://aipla/{self.name}/{self.version}"

    @property
    def tool_name(self) -> str:
        return f"show_{self.name.replace('-', '_')}"

    def _raw_html(self) -> str:
        if self._teacher_version is not None:
            from db.teacher_sims import get_version_html

            html = get_version_html(self.name, self._teacher_version)
            if not html:
                raise RuntimeError(f"Teacher sim '{self.name}' v{self._teacher_version} is no longer live")
            return html
        if self._fs_path is not None and self._fs_path.is_file():
            return self._fs_path.read_text(encoding="utf-8")
        if not SANDBOX_BASE:
            raise RuntimeError(f"Cannot load artefact '{self.name}': no FS copy and MCP_SANDBOX_URL is unset")
        url = f"{SANDBOX_BASE}/artefacts/{self.name}/{self.version}/index.html"
        resp = httpx.get(url, timeout=10.0)
        resp.raise_for_status()
        return resp.text

    def load_html(self) -> str:
        """The page as a host gets it: bridge stamped, libraries inlined, no catalogue (cached)."""
        if self._html is not None:
            return self._html
        from sim_authoring.portable import bundle
        from sim_gates import load_bridge

        html = bundle(self._raw_html(), None, bridge=load_bridge())
        if BRIDGE_MARKER not in html:
            raise RuntimeError(f"Artefact '{self.name}' does not speak the MCP Apps bridge")
        self._html = html
        return self._html


def discover_sims() -> list[SimApp]:
    """The library: live built-in sims, then library teacher sims (when Firestore answers)."""
    from artefacts.loader import builtin_artefacts

    sims = [
        SimApp(
            m.id,
            m.version,
            m.display_name,
            description=m.description,
            fs_path=ARTEFACTS_DIR / m.id / m.version / "index.html",
        )
        for m in builtin_artefacts()
        if m.status == "live"
    ]
    builtin = {s.name for s in sims}
    try:
        from db.teacher_sims import live_metas

        for m in sorted(live_metas(), key=lambda m: m.id):
            if m.scope != "library" or m.id in builtin:
                continue
            sims.append(
                SimApp(
                    m.id,
                    m.version,
                    m.display_name,
                    description=m.description,
                    teacher_version=int(m.version.lstrip("v")),
                )
            )
    except Exception:
        logger.warning("sim_apps: teacher sims unreadable; offering the built-in library only", exc_info=True)
    return sims


def _make_show_handler(title: str):
    """Zero-arg tool handler that returns the model-visible text fallback."""

    def show() -> str:
        return (
            f"Opened the '{title}' simulation. The student can interact with it now; "
            "their actions arrive back as model-context updates."
        )

    return show


# tool name -> resource uri, for what this process has registered (so the
# refresh can diff, add and remove).
_registered: dict[str, str] = {}
_REFRESH_S = 300.0
_last_refresh = 0.0


def register_sim_apps(mcp) -> list[str]:
    """Sync the registered sims to the library: add new ones, drop withdrawn ones.

    Idempotent; returns the tool names added this call.
    """
    global _last_refresh
    _last_refresh = time.monotonic()
    sims = discover_sims()
    wanted = {s.tool_name: s for s in sims}
    for tool_name in [t for t in _registered if t not in wanted]:
        uri = _registered.pop(tool_name)
        try:
            mcp.remove_tool(tool_name)
        except Exception:
            pass
        mcp._resource_manager._resources.pop(uri, None)  # no public remove in the SDK

    added: list[str] = []
    for sim in sims:
        if _registered.get(sim.tool_name) == sim.resource_uri:
            continue
        if sim.tool_name in _registered:  # a new version: replace it
            try:
                mcp.remove_tool(sim.tool_name)
            except Exception:
                pass
            mcp._resource_manager._resources.pop(_registered[sim.tool_name], None)

        # The ui:// resource — content loaded lazily via sim.load_html().
        resource = FunctionResource.from_function(
            fn=sim.load_html,
            uri=sim.resource_uri,
            name=sim.title,
            description=f"AIPLA physics simulation ({sim.name} {sim.version}). {sim.description}".strip(),
            mime_type=UI_MIME_TYPE,
            meta=_widget_meta(),
        )
        mcp.add_resource(resource)

        # The model-callable tool linked to the resource. The text return is the
        # fallback for non-MCP-Apps hosts + the model-visible summary; the
        # interactive iframe is rendered by the host from the linked resource.
        # Zero-param handler (FastMCP turns fn params into the tool inputSchema).
        about = f" {sim.description}" if sim.description else ""
        mcp.add_tool(
            _make_show_handler(sim.title),
            name=sim.tool_name,
            description=(
                f"Show the interactive '{sim.title}' simulation.{about} The student manipulates it "
                "directly; their interactions are fed back to you as model context so you can "
                "tutor on what they did."
            ),
            meta={
                # Standard MCP Apps linkage (Claude Desktop, VS Code, Goose, …).
                "ui": {"resourceUri": sim.resource_uri, "visibility": ["model", "app"]},
                # ChatGPT Apps SDK reads this OpenAI-flavoured key.
                "openai/outputTemplate": sim.resource_uri,
            },
        )
        _registered[sim.tool_name] = sim.resource_uri
        added.append(sim.tool_name)

    if added:
        logger.info("sim_apps: registered %d sim MCP App(s): %s", len(added), added)
    return added


def refresh_due() -> bool:
    return time.monotonic() - _last_refresh >= _REFRESH_S


def refresh_sim_apps(mcp) -> None:
    """Re-sync when the last sync is older than ``_REFRESH_S`` (a library sign-off
    or a withdrawal happened since). Never raises: the listed sims stay as they were."""
    if time.monotonic() - _last_refresh < _REFRESH_S:
        return
    try:
        register_sim_apps(mcp)
    except Exception:
        logger.exception("sim_apps: refresh failed; keeping the current list")
