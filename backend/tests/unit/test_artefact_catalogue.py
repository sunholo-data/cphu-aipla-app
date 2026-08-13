"""Artefact catalogue loader + model — 1.1.41 M0."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from artefacts.loader import is_known_artefact, load_artefact, load_artefacts
from db.models.artefact import ArtefactMeta


def test_catalogue_loads_the_three_live_sims() -> None:
    ids = {a.id for a in load_artefacts()}
    assert {"boldkast", "led-planck", "kinebot"} <= ids


def test_every_artefact_validates_and_derives_its_path() -> None:
    for a in load_artefacts():
        assert a.display_name
        assert a.artefact_path == f"{a.id}/{a.version}"
        assert a.tutor_block  # the three seeded artefacts carry (placeholder) blocks


def test_load_artefact_by_id_and_is_known() -> None:
    assert load_artefact("boldkast") is not None
    assert load_artefact("nope") is None
    assert is_known_artefact("boldkast")
    assert not is_known_artefact("nope")


def test_public_view_excludes_the_tutor_block() -> None:
    pub = load_artefact("boldkast").public()  # type: ignore[union-attr]
    assert "tutorBlock" not in pub
    assert "tutor_block" not in pub
    assert pub["id"] == "boldkast"
    assert pub["artefactPath"] == "boldkast/v1"
    assert pub["status"] == "live"


def test_led_planck_declares_the_viewport_it_actually_needs() -> None:
    """MOBILE-1 (2026-08-13). LED-Planck's bench is laid out at fixed
    coordinates with no media queries — #breadboard reaches 539px on a 390px
    viewport, so half the equipment is off-screen on a phone. The decision was
    to LABEL it rather than rescale it, which only works if the label is here:
    the frontend gates the sim launcher on this number.
    """
    a = load_artefact("led-planck")
    assert a is not None
    assert a.min_viewport_px == 720
    # It has to survive the public view or the student never sees the notice.
    assert a.public()["minViewportPx"] == 720


def test_boldkast_claims_no_minimum_because_it_is_mobile_first() -> None:
    """The reference for a phone-ready sim: single-column by default, columns
    added by `min-width` queries. Audits clean at 390px. If this ever starts
    declaring a minimum, the artefact regressed — do not just update the test.
    """
    a = load_artefact("boldkast")
    assert a is not None
    assert a.min_viewport_px is None
    assert a.public()["minViewportPx"] is None


def test_min_viewport_is_bounded_to_plausible_screen_widths() -> None:
    # A typo here would either gate every device or none of them.
    with pytest.raises(ValidationError):
        ArtefactMeta(id="x", displayName="x", minViewportPx=10)
    with pytest.raises(ValidationError):
        ArtefactMeta(id="x", displayName="x", minViewportPx=99999)


def test_id_must_be_a_slug() -> None:
    with pytest.raises(ValidationError):
        ArtefactMeta(id="Bad Id!", displayName="x")


def test_version_must_match_v_n() -> None:
    with pytest.raises(ValidationError):
        ArtefactMeta(id="x", version="1.0", displayName="x")
