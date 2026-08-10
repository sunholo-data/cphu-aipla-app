"""The read-aloud voice follows the ACTIVITY's language (1.1.63 M4 / PILOT-1 M6).

Aswin, 2026-08-10: *"I play the voice to read the text, but when reading the
text in English, numbers are still pronounced in Danish."*

The symptom is precise and the cause is a mismatched PAIR, not a broken rule:
number pronunciation is decided by the voice, not the text. This is the
persona's third resolution path drifting from the other two (memory
``reference-persona-three-resolution-paths``) — 1.1.63 M2 taught the *tutor*
about ``activity.language`` while the voice kept resolving from the persona.

Fixed in ``resolve_voice`` rather than in the frontend chain because that
function is the single source of truth for BOTH ``GET /config`` (what the
frontend asks for, and the language the pronunciation ruleset is picked from)
and ``POST /synthesize`` (which re-resolves server-side). A frontend-only fix
would have left those two disagreeing.
"""

from __future__ import annotations

import pytest

from protocols.voice_routes import ResolvedVoice, _apply_activity_language, _explicit_activity_language


class _Cfg:
    def __init__(self, language: str | None):
        self.language = language


# --- which activities count as having chosen a language -------------------


def test_an_explicit_non_default_language_counts():
    assert _explicit_activity_language(_Cfg("en")) == "en"


def test_the_defaulted_language_does_not_count():
    """``ActivityConfig.language`` is ``Literal["da","en"]`` defaulting to
    "da" — it is never unset, so it cannot be read as "the teacher chose
    Danish". Treating the default as a choice would let every activity
    authored before 1.1.63 override a class that deliberately committed to
    English (KineBot does), for no behaviour anyone asked for.

    Same rule as the TEXT directive in compose_teacher_focus, from the same
    constant, deliberately: the voice must follow the language the tutor is
    actually speaking."""
    assert _explicit_activity_language(_Cfg("da")) is None


def test_no_activity_counts_as_no_choice():
    assert _explicit_activity_language(None) is None
    assert _explicit_activity_language(_Cfg(None)) is None


def test_the_rule_matches_the_text_directive_exactly():
    """One constant, two consumers. Two copies would drift apart on the next
    language added, and the drift would be silent."""
    from adk.teacher_focus import DEFAULT_ACTIVITY_LANGUAGE

    assert _explicit_activity_language(_Cfg(DEFAULT_ACTIVITY_LANGUAGE)) is None


# --- multilingual voices: retune, never swap ------------------------------


def _jonas() -> ResolvedVoice:
    """The shipped default persona: Gemini tier, bare voice name, Danish."""
    return ResolvedVoice(
        provider="gcp_gemini",
        voice="Puck",
        lang="da",
        prompt="Tal i en nysgerrig, ung og inviterende tone.",
    )


def test_an_english_activity_under_a_danish_persona_reads_english():
    """**Aswin's exact case.**"""
    out = _apply_activity_language(_jonas(), "en")
    assert out.lang == "en"


def test_a_multilingual_voice_is_kept_not_substituted():
    """Every shipped persona is on the Gemini tier, whose voices are bare names
    for which ``GcpTTS.synthesize`` treats the caller's lang as authoritative.
    Substituting an ``en-US-Wavenet-*`` here would drop all five personas to
    WaveNet and silently discard their Style Instructions, which non-Gemini
    tiers reject — the voice would speak English and stop being the character.
    """
    out = _apply_activity_language(_jonas(), "en")
    assert out.voice == "Puck"
    assert out.provider == "gcp_gemini"
    assert out.prompt == _jonas().prompt


def test_a_danish_activity_leaves_the_persona_voice_untouched():
    """Persona voice still wins when the languages agree."""
    assert _apply_activity_language(_jonas(), None) == _jonas()


# --- locale-bound voices: swap, or Cloud TTS 400s -------------------------


def _wavenet_da() -> ResolvedVoice:
    return ResolvedVoice(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", prompt="warm")


def test_a_locale_bound_voice_is_swapped_for_one_that_speaks_the_language():
    """``da-DK-Wavenet-A`` cannot say English, and Cloud TTS 400s outright on a
    lang/voice mismatch — so correcting the language alone would turn a wrong
    accent into no audio at all."""
    out = _apply_activity_language(_wavenet_da(), "en")
    assert out.lang == "en"
    assert out.voice is not None
    assert out.voice.startswith("en-")
    assert out.provider is not None and out.provider.startswith("gcp_")


def test_the_swap_keeps_the_style_instructions():
    """A persona is a character, not a language choice. Tone survives an accent
    change; dropping it would flatten the persona for the sake of the swap."""
    assert _apply_activity_language(_wavenet_da(), "en").prompt == "warm"


def test_a_locale_bound_voice_in_the_right_language_is_untouched():
    out = _apply_activity_language(ResolvedVoice(provider="gcp_wavenet", voice="en-US-Wavenet-F", lang="en"), "en")
    assert out.voice == "en-US-Wavenet-F"


def test_a_full_locale_tag_still_counts_as_matching():
    """Voice languages arrive both as short tags (personas, the picker) and as
    full locales (Cloud TTS voice names). Comparing them raw is how "the
    languages agree" silently becomes "they are different strings"."""
    out = _apply_activity_language(ResolvedVoice(provider="gcp_wavenet", voice="en-US-Wavenet-F", lang="en-US"), "en")
    assert out.voice == "en-US-Wavenet-F"


def test_an_unknown_activity_language_clears_the_mismatched_name():
    """Better for the provider to pick its own default than to confidently
    speak the wrong language."""
    out = _apply_activity_language(_wavenet_da(), "de")
    assert out.lang == "de"
    assert out.voice is None


def test_no_voice_resolved_yet_just_takes_the_language():
    out = _apply_activity_language(ResolvedVoice(lang="da"), "en")
    assert out.lang == "en"
    assert out.voice is None


@pytest.mark.parametrize(
    ("voice", "locale_bound"),
    [
        ("da-DK-Wavenet-A", True),
        ("en-US-Chirp3-HD-Aoede", True),
        ("Puck", False),
        ("Aoede", False),
        ("", False),
        (None, False),
    ],
)
def test_locale_bound_detection(voice, locale_bound):
    from protocols.voice_routes import _is_locale_bound_voice

    assert _is_locale_bound_voice(voice) is locale_bound


# --- the swap must not silently downgrade the teacher's choice ------------


def test_a_chirp3hd_voice_stays_chirp3hd_and_keeps_its_character():
    """A teacher who picked Chirp3-HD paid ~7x the WaveNet rate for a better
    voice, and one who picked Kore picked Kore. Opening an English activity is
    a language decision, not a licence to undo either.

    Chirp3-HD's roster is shared across locales — ``da-DK-Chirp3-HD-Kore`` and
    ``en-US-Chirp3-HD-Kore`` are the same character — so the substitute is
    exact, not approximate."""
    rv = ResolvedVoice(provider="gcp_chirp3hd", voice="da-DK-Chirp3-HD-Kore", lang="da")
    out = _apply_activity_language(rv, "en")
    assert out.voice == "en-US-Chirp3-HD-Kore"
    assert out.provider == "gcp_chirp3hd"


def test_a_wavenet_voice_stays_wavenet():
    out = _apply_activity_language(_wavenet_da(), "en")
    assert out.provider == "gcp_wavenet"
    assert "Wavenet" in (out.voice or "")


def test_a_wavenet_letter_is_not_carried_across_languages():
    """``da-DK-Wavenet-A`` is Anna and ``en-US-Wavenet-A`` is Adam — the
    trailing letter is a locale-specific slot, not a character. Carrying it
    over would change the voice's gender while pretending to preserve it."""
    from voice.voices import matching_voice_for_lang

    # da Wavenet-D is Dorthe (F); en Wavenet-D is Daniel (M). Matching on the
    # letter would silently swap gender, so the letter must be ignored.
    picked = matching_voice_for_lang("en", "da-DK-Wavenet-D")
    assert picked is not None
    assert picked["tier"] == "WaveNet"


def test_a_tier_with_no_voice_in_the_target_language_falls_back_safely():
    """Neural2 coverage is thin — Danish has one voice, and a future language
    may have none. Falling back beats returning nothing."""
    from voice.voices import matching_voice_for_lang

    picked = matching_voice_for_lang("en", "da-DK-Neural2-F")
    assert picked is not None
    assert picked["name"].startswith("en-")


def test_an_unknown_voice_name_falls_back_to_the_safe_tier():
    from voice.voices import matching_voice_for_lang

    picked = matching_voice_for_lang("en", "some-custom-voice-nobody-curated")
    assert picked is not None
    assert picked["tier"] == "WaveNet"
