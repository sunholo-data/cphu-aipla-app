"""The per-session sim ledger and its prose (1.1.155 M3).

Design: docs/design/aipla/v1.1.0-feedback/sim-context-and-class-report.md (F3, D3)
"""

from __future__ import annotations

from adk.sim_ledger import MAX_EVENTS, append, render
from artefacts.loader import load_artefact

KETTLE = load_artefact("kettle-efficiency")
assert KETTLE is not None and KETTLE.record is not None
RECORD = KETTLE.record
NAME = KETTLE.display_name


def _state(power=2000, volume=1.4, elapsed=0.0):
    return {
        "power_W": power,
        "volume_L": volume,
        "mass_kg": volume,
        "temperature_C": 20.0,
        "elapsed_s": elapsed,
        "meter_kWh": 0.0,
        "boiling": False,
        "readings_captured": 0,
    }


def _reading(t_end=67.3, duration=95.0, power=2000):
    return {
        "power_W": power,
        "mass_kg": 1.4,
        "t_start_C": 20,
        "t_end_C": t_end,
        "duration_s": duration,
        "meter_kWh": 0.0528,
    }


def _push(ledger, kind, at, **extra):
    sc = {"kind": f"kettle-efficiency.{kind}", "state": extra.pop("state", _state()), **extra}
    return append(ledger, sc, RECORD, at=at, lang="da")


def _cycle():
    led = _push(None, "open", 1.0)
    led = _push(led, "state-change", 2.0, state=_state(power=2200), changed=["power_W"])
    led = _push(led, "run", 3.0, state=_state(power=2200))
    led = _push(led, "stop", 4.0, state=_state(power=2200, elapsed=95.0))
    led = _push(led, "reading", 5.0, state=_state(power=2200, elapsed=95.0), reading=_reading(power=2200))
    return led


def test_open_sets_the_baseline_and_is_not_news():
    led = _push(None, "open", 1.0)
    assert led["settings"] == {"power_W": 2000, "volume_L": 1.4}
    assert led["events"] == []
    assert led["lang"] == "da"


def test_a_cycle_records_the_change_the_run_and_the_reading():
    led = _cycle()
    assert [e["type"] for e in led["events"]] == ["set", "run", "other", "reading"]
    assert led["runs"] == 1
    assert led["readings"] == [{**_reading(power=2200), "n": 1}]
    # The hidden-answer rule: nothing but declared, emitted fields.
    assert "efficiency" not in str(led) and "temperature_C" not in str(led["readings"])


def test_append_never_mutates_its_input():
    led = _cycle()
    before = repr(led)
    _push(led, "run", 9.0)
    assert repr(led) == before


def test_a_later_push_does_not_lose_an_earlier_reading():
    """F3: after Capture → slider → Run, the latest-value key no longer has the
    reading. The ledger must still."""
    led = _cycle()
    led = _push(led, "state-change", 6.0, state=_state(power=1000), changed=["power_W"])
    led = _push(led, "run", 7.0, state=_state(power=1000))
    assert led["readings"][0]["t_end_C"] == 67.3
    assert "#1" in render(led, RECORD, NAME, since=6.5)


def test_readings_are_capped_and_counted():
    led = _push(None, "open", 0.0)
    for i in range(RECORD.measurements.keep + 3):  # type: ignore[union-attr]
        led = _push(led, "reading", 1.0 + i, reading=_reading(t_end=30.0 + i))
    assert len(led["readings"]) == RECORD.measurements.keep  # type: ignore[union-attr]
    assert led["readings_total"] == RECORD.measurements.keep + 3  # type: ignore[union-attr]
    assert led["readings"][0]["n"] == 4
    text = render(led, RECORD, NAME, since=None)
    assert "3 tidligere aflæsninger ikke vist" in text


def test_events_are_bounded():
    led = _push(None, "open", 0.0)
    for i in range(MAX_EVENTS + 10):
        led = _push(led, "stop", 1.0 + i)
    assert len(led["events"]) == MAX_EVENTS


def test_changes_since_the_last_reply_are_collapsed():
    led = _push(None, "open", 0.0)
    for at, power in [(1.0, 1500), (2.0, 1800), (3.0, 2200)]:
        led = _push(led, "state-change", at, state=_state(power=power), changed=["power_W"])
    text = render(led, RECORD, NAME, since=0.5)
    assert "Effekt 2000 → 2200 W" in text
    assert "1500" not in text and "1800" not in text


def test_only_events_after_the_last_reply_are_news():
    led = _cycle()
    text = render(led, RECORD, NAME, since=4.5)
    since_line = next(line for line in text.splitlines() if line.startswith("Siden dit sidste svar"))
    assert "registrerede aflæsning #1" in since_line
    assert "startede" not in since_line and "→" not in since_line


def test_the_prose_is_danish_for_a_danish_session():
    text = render(_cycle(), RECORD, NAME, since=None)
    assert text.startswith(NAME)
    assert "Nu: Effekt 2200 W, Vandmængde 1.4 L" in text
    assert "startede en kørsel (2200 W, 1.4 L)" in text
    assert "#1 P 2200 W · m 1.4 kg · start 20 °C · slut 67.3 °C · t 95 s · måler 0.0528 kWh" in text
    assert "power_W" not in text and "t_end_C" not in text


def test_the_prose_is_english_for_an_english_session():
    led = append(None, {"kind": "kettle-efficiency.open", "state": _state()}, RECORD, at=1.0, lang="en")
    led = append(
        led, {"kind": "kettle-efficiency.reading", "state": _state(), "reading": _reading()}, RECORD, at=2.0, lang="en"
    )
    text = render(led, RECORD, NAME, since=None)
    assert "Now: Power 2000 W, Water 1.4 L" in text
    assert "captured reading #1" in text
    assert "#1 P 2000 W · m 1.4 kg · start 20 °C · end 67.3 °C" in text


def test_the_ledger_keeps_the_language_it_was_created_with():
    led = _push(None, "open", 1.0)
    led = append(led, {"kind": "kettle-efficiency.run", "state": _state()}, RECORD, at=2.0, lang="en")
    assert led["lang"] == "da"


def test_an_old_or_foreign_ledger_shape_is_replaced_not_trusted():
    led = append(
        {"v": 0, "readings": "garbage"},
        {"kind": "kettle-efficiency.open", "state": _state()},
        RECORD,
        at=1.0,
        lang="da",
    )
    assert led["readings"] == [] and led["v"] == 1


def test_ten_readings_stay_well_inside_the_budget():
    """D3 budget: the whole block at the cap, against ~440 tokens for the raw
    single-push dump it replaces. ~4 chars per token."""
    led = _push(None, "open", 0.0)
    for i in range(10):
        led = _push(led, "run", 1.0 + 2 * i)
        led = _push(led, "reading", 2.0 + 2 * i, reading=_reading(t_end=40.0 + i, duration=60.0 + i))
    text = render(led, RECORD, NAME, since=19.5)
    assert len(text) / 4 < 300, len(text)
