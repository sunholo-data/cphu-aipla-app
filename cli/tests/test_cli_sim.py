"""Tests for `aiplatform sim build` + the underlying build-artefact-bridge.mjs.

The build script is dependency-free node; we drive the REAL script against a
temp fixture tree via ``--root`` so the logic (stamp + drift + missing markers)
is proven without depending on the repo's current migration state.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from click.testing import CliRunner

from aiplatform.cli import main

# Repo root: cli/tests/ -> cli/ -> repo root
_REPO_ROOT = Path(__file__).resolve().parents[2]
_BUILD_SCRIPT = _REPO_ROOT / "scripts" / "build-artefact-bridge.mjs"

_HAS_NODE = shutil.which("node") is not None
_needs_node = pytest.mark.skipif(not _HAS_NODE, reason="node not on PATH")

_CANONICAL = "/* bridge */\n(function(){ window.AIPLA_BRIDGE = { emit: function(){} }; })();\n"


def _make_fixture(root: Path, *, inner: str) -> Path:
    """A minimal repo-shaped tree: canonical bridge + one artefact with markers."""
    (root / "infrastructure" / "mcp-sandbox" / "bridge").mkdir(parents=True)
    (root / "infrastructure" / "mcp-sandbox" / "bridge" / "aipla-mcp-bridge.js").write_text(_CANONICAL)

    art = root / "infrastructure" / "mcp-sandbox" / "artefacts" / "foo" / "v1"
    art.mkdir(parents=True)
    index = art / "index.html"
    index.write_text(
        "<!doctype html><html><body>\n"
        "  <!-- @aipla-bridge:start (GENERATED) -->\n"
        f"{inner}\n"
        "  <!-- @aipla-bridge:end -->\n"
        "<script>/* app */</script>\n"
        "</body></html>\n"
    )
    return index


def _run(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(_BUILD_SCRIPT), "--root", str(root), *args],
        capture_output=True,
        text=True,
    )


@_needs_node
def test_write_mode_stamps_canonical_into_region(tmp_path: Path) -> None:
    index = _make_fixture(tmp_path, inner="<script>STALE</script>")
    result = _run(tmp_path)
    assert result.returncode == 0, result.stderr
    stamped = index.read_text()
    assert f"<script>\n{_CANONICAL}</script>" in stamped
    assert "STALE" not in stamped


@_needs_node
def test_check_passes_when_up_to_date(tmp_path: Path) -> None:
    _make_fixture(tmp_path, inner=f"<script>\n{_CANONICAL}</script>")
    result = _run(tmp_path, "--check")
    assert result.returncode == 0, result.stderr + result.stdout


@_needs_node
def test_check_fails_on_drift(tmp_path: Path) -> None:
    _make_fixture(tmp_path, inner="<script>DRIFTED</script>")
    result = _run(tmp_path, "--check")
    assert result.returncode == 1
    assert "DRIFT" in result.stderr


@_needs_node
def test_check_fails_on_missing_markers(tmp_path: Path) -> None:
    (tmp_path / "infrastructure" / "mcp-sandbox" / "bridge").mkdir(parents=True)
    (tmp_path / "infrastructure" / "mcp-sandbox" / "bridge" / "aipla-mcp-bridge.js").write_text(_CANONICAL)
    art = tmp_path / "infrastructure" / "mcp-sandbox" / "artefacts" / "bare" / "v1"
    art.mkdir(parents=True)
    (art / "index.html").write_text("<html><body>no markers here</body></html>")
    result = _run(tmp_path, "--check")
    assert result.returncode == 1
    assert "MISSING" in result.stderr


def test_sim_build_command_is_registered() -> None:
    result = CliRunner().invoke(main, ["sim", "build", "--help"])
    assert result.exit_code == 0
    assert "canonical MCP App guest bridge" in result.output
    assert "--check" in result.output
