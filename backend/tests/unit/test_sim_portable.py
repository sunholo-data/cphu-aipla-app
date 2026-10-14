"""One portable file per sim (sim_authoring/portable.py)."""

from __future__ import annotations

from pathlib import Path

import pytest

from sim_authoring.portable import BRIDGE_PLACEHOLDER, PORTABLE_MARK, NotPortable, bundle, unbundle
from sim_gates import load_bridge, run

REPO = Path(__file__).resolve().parents[3]
SOL = REPO / "infrastructure" / "mcp-sandbox" / "artefacts" / "sol-jord-maane" / "v1" / "index.html"
THREE = "/vendor/three/0.128.0/three.min.js"


def _page(body: str = "") -> str:
    return (
        "<!doctype html><html><head><title>t</title></head><body>\n"
        "<!-- @aipla-bridge:start -->\n" + BRIDGE_PLACEHOLDER + "\n<!-- @aipla-bridge:end -->\n"
        '<script>const ARTEFACT_NAME = "t";</script>' + body + "</body></html>"
    )


def test_a_plain_draft_becomes_one_file_and_comes_back_unchanged():
    page, yaml = _page(), "id: t\ndisplayName: T\ntutorBlock: |\n  answer 9,82 </script> never\n"
    portable = bundle(page, yaml, bridge=load_bridge())
    assert PORTABLE_MARK in portable
    assert "window.AIPLA_BRIDGE" in portable or "AIPLA_BRIDGE" in portable.split("@aipla-bridge:start")[1]
    assert "</script> never" not in portable  # the catalogue cannot end its own block
    back, cat = unbundle(portable)
    assert cat.strip() == yaml.strip()
    # The canonical bridge stamped on the way out stays (gates accept it); the
    # rest of the page is exactly what went in, and a second trip changes nothing.
    assert back.split("<!-- @aipla-bridge:end -->")[1] == page.split("<!-- @aipla-bridge:end -->")[1]
    assert bundle(back, cat, bridge=load_bridge()) == portable


def test_a_page_for_a_host_the_student_sees_carries_no_catalogue():
    portable = bundle(_page(), None, bridge=load_bridge())
    assert "aipla-catalogue" not in portable
    assert unbundle(portable)[1] is None


@pytest.mark.skipif(not SOL.is_file(), reason="needs the repo's artefacts")
def test_a_vendored_library_is_inlined_and_restored_by_its_hash():
    html = SOL.read_text()
    portable = bundle(html, None, bridge=load_bridge())
    assert 'src="/vendor/' not in portable
    assert f'data-aipla-vendor="{THREE}"' in portable
    back, _ = unbundle(portable)
    assert back == html
    assert run(back, tiers=("A",)).ok


@pytest.mark.skipif(not SOL.is_file(), reason="needs the repo's artefacts")
def test_a_tampered_inlined_library_is_refused():
    portable = bundle(SOL.read_text(), None, bridge=load_bridge())
    tampered = portable.replace("REVISION", "REVISIOM", 1)
    with pytest.raises(NotPortable, match="changed"):
        unbundle(tampered)


def test_an_outdated_bridge_goes_back_to_the_placeholder():
    old = "<script>\nwindow.AIPLA_BRIDGE = {};\n" + "// old bridge\n" * 100 + "</script>"
    page = _page().replace(BRIDGE_PLACEHOLDER, old)
    back, _ = unbundle(page)
    assert BRIDGE_PLACEHOLDER in back and "old bridge" not in back
