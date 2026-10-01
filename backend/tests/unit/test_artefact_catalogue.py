"""Artefact catalogue loader + model — 1.1.41 M0."""

from __future__ import annotations

import re
from pathlib import Path

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


# --- 1.1.133 M0 — a sim declares what may be done to it ----------------------

_SANDBOX_ARTEFACTS = Path(__file__).resolve().parents[3] / "infrastructure" / "mcp-sandbox" / "artefacts"

# `onHostNotification(ARTEFACT_NAME + '.cmd-' + name, …)` inside a
# `['a', 'b'].forEach(function (name) { … })` — sol-jord-maane's shape.
_LOOP_REGISTRATION = re.compile(
    r"\[([^\]]*)\]\s*\.forEach\(\s*function\s*\((\w+)\)\s*\{\s*"
    r"AIPLA_BRIDGE\.onHostNotification\([^)]*'\.cmd-'\s*\+\s*\2",
)
# …or one literal registration per command: `'<id>.cmd-jump'` / `".cmd-jump"`.
_LITERAL_REGISTRATION = re.compile(r"onHostNotification\(\s*[^)]*?['\"][\w-]*\.cmd-(\w+)['\"]")


def _registered_commands(html: str) -> set[str]:
    names: set[str] = set()
    for m in _LOOP_REGISTRATION.finditer(html):
        names.update(re.findall(r"['\"](\w+)['\"]", m.group(1)))
    names.update(_LITERAL_REGISTRATION.findall(html))
    return names


def test_every_declared_command_is_registered_by_the_sim() -> None:
    """Two sources of truth for commands — catalogue and HTML — can drift. A
    command the catalogue declares and the sim never registers is a tool call
    that reaches the iframe and does nothing, with a card telling the student
    it happened. Grep the artefact, same shape as the broadcast floor."""
    checked = 0
    for a in load_artefacts():
        if not a.commands:
            continue
        html = (_SANDBOX_ARTEFACTS / a.id / a.version / "index.html").read_text(encoding="utf-8")
        registered = _registered_commands(html)
        missing = sorted(c.name for c in a.commands if c.name not in registered)
        assert not missing, f"{a.id}: declared but not registered by the HTML: {missing}"
        checked += 1
    assert checked >= 1, "no artefact declares commands — sol-jord-maane should"


def test_the_registration_grep_sees_both_shapes() -> None:
    """The cross-check above is only as good as its grep: prove it finds the
    loop form AND the literal form, and nothing else."""
    html = (
        "['jump', 'setView'].forEach(function (name) {\n"
        "  AIPLA_BRIDGE.onHostNotification(ARTEFACT_NAME + '.cmd-' + name, function (p) {});\n"
        "});\n"
        "AIPLA_BRIDGE.onHostNotification('demo.cmd-reset', function () {});\n"
        "AIPLA_BRIDGE.onHostNotification('ui/notifications/chat-flush', function () {});\n"
    )
    assert _registered_commands(html) == {"jump", "setView", "reset"}


def test_sol_jord_maane_declares_its_commands_minus_the_returning_ones() -> None:
    a = load_artefact("sol-jord-maane")
    assert a is not None
    names = {c.name for c in a.commands}
    assert {"jump", "setView", "setScale", "setShow", "setTask", "lock", "configure"} <= names
    # These RETURN something; the host has no reply channel (M4), and snapshot is an image.
    assert not names & {"getState", "snapshot", "getMissions"}
    jump = a.command("jump")
    assert jump is not None
    assert "solform" in jump.args["properties"]["event"]["enum"]
    assert jump.render_effect({"event": "solform"}) == "Sprang til næste solformørkelse"
    # Power tiers: removing an ability is `restrict`, never the default.
    assert a.command("lock").power == "restrict"  # type: ignore[union-attr]
    assert a.command("setTask").power == "scaffold"  # type: ignore[union-attr]
    assert a.command("setView").power == "view"  # type: ignore[union-attr]


def test_commands_are_public_and_the_tutor_block_still_is_not() -> None:
    pub = load_artefact("sol-jord-maane").public()  # type: ignore[union-attr]
    assert {c["name"] for c in pub["commands"]} >= {"jump"}
    assert "tutorBlock" not in pub


def test_an_artefact_without_commands_declares_none() -> None:
    """Default-deny per sim: no `commands` means no control tool (M1)."""
    a = load_artefact("boldkast")
    assert a is not None
    assert a.commands == []
    assert a.public()["commands"] == []


def _meta(**cmd) -> dict:
    base = {"name": "jump", "description": "d", "effect": "e"}
    base.update(cmd)
    return {"id": "x", "displayName": "X", "commands": [base]}


@pytest.mark.parametrize(
    "bad",
    [
        _meta(args={"type": "object", "properties": {"a": {"pattern": ".*"}}}),  # unsupported keyword
        _meta(args={"type": "string"}),  # top level must be an object
        _meta(args={"type": "object", "properties": {}, "required": ["ghost"]}),
        _meta(effect="Til {ghost}"),  # placeholder that is not an argument
        _meta(name="cmd-jump"),  # names are identifiers, they become `<id>.cmd-<name>`
        _meta(power="everything"),
        _meta(valueLabels={"ghost": {"a": "b"}}),
    ],
)
def test_a_malformed_command_is_refused_at_load(bad: dict) -> None:
    with pytest.raises(ValidationError):
        ArtefactMeta.model_validate(bad)


def test_duplicate_command_names_are_refused() -> None:
    data = _meta()
    data["commands"].append(dict(data["commands"][0]))
    with pytest.raises(ValidationError):
        ArtefactMeta.model_validate(data)
