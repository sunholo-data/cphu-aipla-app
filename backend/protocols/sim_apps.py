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

**Artefact availability.** The backend sidecar image contains only ``backend/``
(Docker build context is ``backend/``), so the artefact HTML is not on its disk
in production. The sandbox Cloud Run service is the single source of truth for
artefacts (ADR-013). So we:

  * scan the repo artefacts dir when it exists (local dev + tests — the path is
    present in a checkout), reading titles + which sims speak the bridge; else
  * fall back to a small known-sims list and **lazily** fetch each artefact's
    HTML from the deployed sandbox (``MCP_SANDBOX_URL``) on first ``resources/read``.

Either way there is no git duplication of the HTML and no network call at
startup — the content loads on demand and is cached per process.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

import httpx
from mcp.server.fastmcp.resources import FunctionResource

logger = logging.getLogger(__name__)

UI_MIME_TYPE = "text/html;profile=mcp-app"
BRIDGE_MARKER = "ui/initialize"  # an artefact is MCP-App-ready iff it runs the handshake
_VERSION_RE = re.compile(r"^v(\d+)$")
_TITLE_RE = re.compile(r"<title>([^<]*)</title>", re.IGNORECASE)

# Repo artefacts dir: present in a checkout (local dev / CI), absent in the
# deployed backend image. Overridable for tests / packaging.
_DEFAULT_ARTEFACTS_DIR = Path(__file__).resolve().parents[2] / "infrastructure" / "mcp-sandbox" / "artefacts"
ARTEFACTS_DIR = Path(os.getenv("SIM_ARTEFACTS_DIR", _DEFAULT_ARTEFACTS_DIR))

# Deployed sandbox base origin, derived from the same _MCP_SANDBOX_URL the
# frontend uses (".../sandbox.html" -> ".../"). Only needed when the FS scan
# fails (i.e. in the deployed backend).
_SANDBOX_URL_ENV = os.getenv("MCP_SANDBOX_URL", "")
SANDBOX_BASE = _SANDBOX_URL_ENV.rsplit("/sandbox.html", 1)[0].rstrip("/") if _SANDBOX_URL_ENV else ""

# Fallback when the FS isn't available (deployed). (name, version, title).
KNOWN_SIMS: list[tuple[str, str, str]] = [
    ("boldkast", "v1", "Boldkast — projectile-motion sim"),
    ("kinebot", "v1", "KineBot — Kinematics Workbench"),
    ("led-planck", "v1", "LED-Planck — measuring Planck's constant"),
]


class SimApp:
    """One discovered sim + a lazy, cached loader for its HTML."""

    def __init__(self, name: str, version: str, title: str, *, fs_path: Path | None = None) -> None:
        self.name = name
        self.version = version
        self.title = title
        self._fs_path = fs_path
        self._html: str | None = None

    @property
    def resource_uri(self) -> str:
        return f"ui://aipla/{self.name}/{self.version}"

    @property
    def tool_name(self) -> str:
        return f"show_{self.name.replace('-', '_')}"

    def load_html(self) -> str:
        """Return the artefact HTML (cached). FS read in dev; sandbox fetch in prod."""
        if self._html is not None:
            return self._html
        if self._fs_path is not None and self._fs_path.is_file():
            self._html = self._fs_path.read_text(encoding="utf-8")
            return self._html
        if not SANDBOX_BASE:
            raise RuntimeError(f"Cannot load artefact '{self.name}': no FS copy and MCP_SANDBOX_URL is unset")
        url = f"{SANDBOX_BASE}/artefacts/{self.name}/{self.version}/index.html"
        resp = httpx.get(url, timeout=10.0)
        resp.raise_for_status()
        self._html = resp.text
        return self._html


def discover_sims() -> list[SimApp]:
    """The latest bridge-speaking version of each sim — from the FS, else known list."""
    if ARTEFACTS_DIR.is_dir():
        return _discover_from_fs()
    logger.info("sim_apps: artefacts dir %s absent — using known-sims + sandbox fetch", ARTEFACTS_DIR)
    return [SimApp(name, version, title) for name, version, title in KNOWN_SIMS]


def _discover_from_fs() -> list[SimApp]:
    found: list[SimApp] = []
    for sim_dir in sorted(p for p in ARTEFACTS_DIR.iterdir() if p.is_dir()):
        if sim_dir.name.startswith("_"):  # _template is a scaffold, not a sim
            continue
        versions = sorted(
            (d for d in sim_dir.iterdir() if d.is_dir() and _VERSION_RE.match(d.name)),
            key=lambda d: int(_VERSION_RE.match(d.name).group(1)),  # type: ignore[union-attr]
            reverse=True,
        )
        for vdir in versions:  # newest first; take the first that has a bridged index.html
            index = vdir / "index.html"
            if not index.is_file():
                continue
            html = index.read_text(encoding="utf-8")
            if BRIDGE_MARKER not in html:
                break  # newest version isn't bridge-ready — skip this sim
            title_match = _TITLE_RE.search(html)
            title = title_match.group(1).strip() if title_match else sim_dir.name
            sim = SimApp(sim_dir.name, vdir.name, title, fs_path=index)
            sim._html = html  # already read — cache it
            found.append(sim)
            break
    return found


def _make_show_handler(title: str):
    """Zero-arg tool handler that returns the model-visible text fallback."""

    def show() -> str:
        return (
            f"Opened the '{title}' simulation. The student can interact with it now; "
            "their actions arrive back as model-context updates."
        )

    return show


# Tracks registered sim tool/resource names so register_sim_apps() is idempotent.
_registered: set[str] = set()


def register_sim_apps(mcp) -> list[str]:
    """Register every discovered sim as a ui:// resource + show_<name> tool.

    Idempotent: a sim already registered (by tool name) is skipped, so this is
    safe to call on every ``get_mcp_asgi_app()``. Returns the tool names added
    this call.
    """
    added: list[str] = []
    for sim in discover_sims():
        if sim.tool_name in _registered:
            continue

        # The ui:// resource — content loaded lazily via sim.load_html().
        resource = FunctionResource.from_function(
            fn=sim.load_html,
            uri=sim.resource_uri,
            name=sim.title,
            description=f"AIPLA physics-tutor workbench sim ({sim.name} {sim.version}).",
            mime_type=UI_MIME_TYPE,
        )
        mcp.add_resource(resource)

        # The model-callable tool linked to the resource. The text return is the
        # fallback for non-MCP-Apps hosts + the model-visible summary; the
        # interactive iframe is rendered by the host from the linked resource.
        # Zero-param handler (FastMCP turns fn params into the tool inputSchema).
        mcp.add_tool(
            _make_show_handler(sim.title),
            name=sim.tool_name,
            description=(
                f"Show the interactive '{sim.title}' simulation. The student manipulates it "
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
        _registered.add(sim.tool_name)
        added.append(sim.tool_name)

    if added:
        logger.info("sim_apps: registered %d sim MCP App(s): %s", len(added), added)
    return added
