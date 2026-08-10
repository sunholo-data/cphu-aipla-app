"""Every reachable TTS provider is priced, or knowingly unpriced.

``gcp_gemini`` carried 100% of read-aloud traffic — every persona sets it, and
``DEFAULT_PERSONA_ID`` guarantees a persona resolves for every session — while
logging $0.00, from the day personas shipped. The original plan was that the
dashboard would "surface unknown providers so we notice". It did not: on a
spend chart a zero is indistinguishable from cheap.

So the decision moves to a test. A provider a persona can actually resolve to
must be in the rate table or in the explicit unpriced set — never silently
absent from both.
"""

from __future__ import annotations

import pathlib

import yaml

from voice.cost import _TTS_UNPRICED, _TTS_USD_PER_MILLION_CHARS

_PERSONAS = pathlib.Path(__file__).resolve().parents[3] / "personas"


def _persona_providers() -> set[str]:
    providers = set()
    for f in _PERSONAS.glob("*.yaml"):
        voice = (yaml.safe_load(f.read_text()) or {}).get("voice") or {}
        if voice.get("ttsProvider"):
            providers.add(voice["ttsProvider"])
    return providers


def test_personas_exist_to_check():
    """Guard the guard: a glob that silently matches nothing passes vacuously."""
    assert _persona_providers()


def test_every_persona_provider_is_priced_or_knowingly_unpriced():
    known = set(_TTS_USD_PER_MILLION_CHARS) | set(_TTS_UNPRICED)
    missing = _persona_providers() - known
    assert not missing, (
        f"TTS providers reachable from a persona with no cost decision: {sorted(missing)}. "
        "Add a rate to _TTS_USD_PER_MILLION_CHARS, or add it to _TTS_UNPRICED with a comment "
        "saying why. Silence means the voice dashboard under-reports and nobody finds out."
    )


def test_the_unpriced_set_is_not_a_dumping_ground():
    """Unpriced is meant to be exceptional. If most tiers end up here the
    dashboard has stopped meaning anything and the fix is an estimator, not
    another entry."""
    assert len(_TTS_UNPRICED) < len(_TTS_USD_PER_MILLION_CHARS)


def test_the_tier_we_actually_run_is_priced():
    """gcp_gemini carries ~100% of read-aloud traffic. It logging $0.00 is the
    bug this file exists for."""
    from voice.cost import tts_cost_usd

    assert "gcp_gemini" in _TTS_USD_PER_MILLION_CHARS
    assert tts_cost_usd("gcp_gemini", 1_000_000) > 0


def test_the_gemini_rate_is_in_a_plausible_range():
    """Derived from three factors, one of which (speaking pace) is ours rather
    than Google's — so the arithmetic deserves a sanity check. A premium tier
    should land between Neural2 and Chirp3-HD; landing outside that means a
    factor moved by an order of magnitude, which is a typo, not a price change.
    """
    rate = _TTS_USD_PER_MILLION_CHARS["gcp_gemini"]
    assert _TTS_USD_PER_MILLION_CHARS["gcp_neural2"] <= rate <= _TTS_USD_PER_MILLION_CHARS["gcp_chirp3hd"]


def test_the_rate_can_be_corrected_from_the_environment(monkeypatch):
    """The speaking-pace factor is an estimate, so this WILL be off by some
    margin against a real invoice. Correcting it must not need a deploy."""
    from voice.cost import _gemini_tts_usd_per_million_chars

    monkeypatch.setenv("VOICE_GEMINI_TTS_USD_PER_M_CHARS", "21.5")
    assert _gemini_tts_usd_per_million_chars() == 21.5


def test_a_garbage_override_falls_back_to_the_derived_rate(monkeypatch):
    from voice.cost import _gemini_tts_usd_per_million_chars

    monkeypatch.setenv("VOICE_GEMINI_TTS_USD_PER_M_CHARS", "not-a-number")
    assert _gemini_tts_usd_per_million_chars() > 0
