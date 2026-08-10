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


def test_gemini_is_the_known_gap():
    """Pins the current state so removing the TODO requires deleting this
    assertion — i.e. noticing it."""
    assert "gcp_gemini" in _TTS_UNPRICED
    assert "gcp_gemini" not in _TTS_USD_PER_MILLION_CHARS
