"""Every live built-in sim carries its screenshots (``make sim-screenshots``).

They are the picker's thumbnail and what the activity co-pilot looks at when it
plans a lesson around a sim, so a new sim without them reaches teachers as a
grey tile and the co-pilot plans blind.
"""

from __future__ import annotations

import pytest

from artefacts.loader import builtin_artefacts
from artefacts.screenshots import SHOTS, builtin_screenshot_path, screenshot_png, thumbnail_url

LIVE = [a for a in builtin_artefacts() if a.status == "live"]


@pytest.mark.parametrize("meta", LIVE, ids=lambda m: m.id)
def test_every_live_builtin_sim_has_both_screenshots(meta):
    for shot in SHOTS:
        path = builtin_screenshot_path(meta.id, shot)
        assert path is not None, f"{meta.id}: no {shot} screenshot; run `make sim-screenshots ID={meta.id}`"
        assert path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
        assert path.stat().st_size < 400_000, f"{meta.id}-{shot}.png is too big for a thumbnail"


@pytest.mark.parametrize("meta", LIVE, ids=lambda m: m.id)
def test_the_catalogue_points_at_the_screenshot(meta):
    assert meta.public()["thumbnail"] == thumbnail_url(meta.id)
    assert screenshot_png(meta, "700") is not None


def test_unknown_shots_are_refused():
    assert builtin_screenshot_path("boldkast", "../boldkast-700") is None
    assert screenshot_png(LIVE[0], "1024") is None
