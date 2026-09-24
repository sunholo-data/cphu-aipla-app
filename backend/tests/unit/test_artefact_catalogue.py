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


def test_measurement_sims_keep_their_reference_values_server_side() -> None:
    """The kettle and the phase-change curve both work by WITHHOLDING the answer:
    the student measures, then calculates. Each carries the values that would
    give the game away (the kettle's real efficiency, the latent heats) in its
    ``tutorBlock`` so the tutor can mark an answer — and ``public()`` is what
    stops those reaching the browser. If a future refactor serialises the whole
    model, this test is the thing that notices.
    """
    for artefact_id, giveaway in (("kettle-efficiency", "86%"), ("phase-change", "334")):
        a = load_artefact(artefact_id)
        assert a is not None, artefact_id
        assert giveaway in a.tutor_block, artefact_id
        assert "NEVER STATE THESE" in a.tutor_block, artefact_id
        assert giveaway not in str(a.public()), artefact_id


def test_measurement_sims_are_built_for_a_phone() -> None:
    """Both were audited at 390px before being catalogued (no horizontal scroll,
    nothing clipped). Declaring no minimum is a claim about the CSS — if either
    grows a fixed-width bench, set the number rather than editing this away.
    """
    for artefact_id in ("kettle-efficiency", "phase-change", "wave-speed", "wave-interference"):
        a = load_artefact(artefact_id)
        assert a is not None, artefact_id
        assert a.min_viewport_px is None, artefact_id


def test_measurement_sims_name_the_commit_events_the_proactive_gate_reads() -> None:
    """`run` and `reading` are not decoration: the frontend maps an artefact's
    kind SUFFIX onto the proactive-tutor categories, and these two are the words
    that light up sim_run and measurement_commit. Renaming one to something
    prettier silently switches proactive tutoring off for that sim.
    """
    for artefact_id, run_verb in (
        ("kettle-efficiency", "run"),
        ("phase-change", "run"),
        # The wave sims say `play`, which is a sim_run token too. Both words are
        # in the list; a sim that invented `start` would light up nothing.
        ("wave-speed", "play"),
        ("wave-interference", "play"),
    ):
        a = load_artefact(artefact_id)
        assert a is not None, artefact_id
        assert run_verb in a.event_vocabulary, artefact_id
        assert "reading" in a.event_vocabulary, artefact_id


def test_wave_interference_keeps_the_medium_speed_server_side() -> None:
    """wave-interference withholds ONE constant and everything else follows from
    it: the medium's speed. Each wave's frequency is derived as f = v/lambda and
    IS shown, so a student can recover the speed from a single wave's own
    readings — which is a legitimate thing to be steered towards and not a thing
    to be handed. If ``public()`` ever starts serialising the whole model, the
    number appears in the browser and that exercise is gone.
    """
    a = load_artefact("wave-interference")
    assert a is not None
    assert "4.0 m/s" in a.tutor_block
    assert "NEVER STATE THESE" in a.tutor_block
    assert "4.0 m/s" not in str(a.public())


def test_wave_speed_never_names_a_speed_anywhere_public() -> None:
    """The whole exercise is computing v = f*lambda, so the sim shows f, lambda
    and T and never a speed. The tutorBlock says so in as many words; this test
    is what stops a later description or topic list from casually adding it.
    """
    a = load_artefact("wave-speed")
    assert a is not None
    assert "NEVER" in a.tutor_block
    pub = str(a.public()).lower()
    # `bølgefart` in the display name is the sim's SUBJECT, not a value. What
    # must never appear is a number carrying m/s.
    assert "m/s" not in pub


def test_the_two_wave_sims_are_separate_artefacts() -> None:
    """They arrived as one two-tab mockup and were deliberately split: different
    controls, different physics, and two exercises in one ~700px pane is the
    cramped multi-role shape this library has already shipped twice. Re-merging
    them would have to undo this test, which is the point.
    """
    for artefact_id in ("wave-speed", "wave-interference"):
        a = load_artefact(artefact_id)
        assert a is not None, artefact_id
        assert a.status == "live", artefact_id
        assert a.artefact_path == f"{artefact_id}/v1", artefact_id


def test_sol_jord_maane_keeps_the_construct_map_server_side() -> None:
    """sol-jord-maane (author I, 2026-09-24) arrived with a 13 KB activity module
    whose construct map describes, level by level, what a target answer looks
    like. The module says never to show a student their level — so the map lives
    in the tutorBlock and must not reach ``public()``. It is the reason the cap
    went 2,000 -> 16,000 (2026-09-24); this pins that it fits.
    """
    a = load_artefact("sol-jord-maane")
    assert a is not None
    assert a.status == "live"
    assert "CONSTRUCT MAP" in a.tutor_block
    assert len(a.tutor_block) <= 16000
    pub = str(a.public())
    assert "CONSTRUCT MAP" not in pub
    assert "coherent model" not in pub
    # The labelled commits that carry the student's own words are proactive
    # (`commit`); mission start and a finished step deliberately are not.
    for verb in ("prediction-commit", "answer-commit", "quiz-record", "view-record"):
        assert verb in a.event_vocabulary, verb
