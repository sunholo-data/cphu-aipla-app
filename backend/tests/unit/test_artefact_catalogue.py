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


def test_id_must_be_a_slug() -> None:
    with pytest.raises(ValidationError):
        ArtefactMeta(id="Bad Id!", displayName="x")


def test_version_must_match_v_n() -> None:
    with pytest.raises(ValidationError):
        ArtefactMeta(id="x", version="1.0", displayName="x")
