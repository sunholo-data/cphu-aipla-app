"""Curated list of TTS voices, grouped by language.

Single source of truth for the teacher's voice picker and the
GET /api/voice/voices endpoint. Covers all tiers (Standard, WaveNet,
Neural2, Chirp3HD) so the teacher can experiment with quality vs cost:

  Standard  $4/M chars   — robotic, cheapest
  WaveNet   $4/M chars   — natural, the safe floor
  Neural2   $16/M chars  — better prosody, limited voice count
  Chirp3HD  $30/M chars  — premium conversational

**This list is NOT what a student normally hears.** Every persona ships on the
``gcp_gemini`` tier (``gemini-2.5-flash-tts``) with a BARE voice name — Sofie
is Aoede, Jonas is Puck, Astrid is Kore — and ``DEFAULT_PERSONA_ID`` means a
persona resolves for every session. Gemini-TTS is the better tier for a tutor
on two counts the table above cannot show: it is the only one that honours a
persona's ``voicePrompt`` Style Instructions, and it is natively multilingual,
which is what lets an English activity keep its Danish persona's character
(1.1.63 M4). Chirp3-HD shares its character roster (Aoede/Puck/Kore/Charon/…)
but is locale-bound and not promptable.

So this catalogue is the **teacher's escape hatch**, reached only through
"Custom voice (advanced)" or a skill-level voice config — and every entry in it
is a step DOWN from the default. Adding the Gemini voices here is worth
considering; it is deliberately not done yet, because a teacher picking one
from a flat list would lose the persona binding that makes the voice match the
avatar and the name.

Voice naming uses Cloud TTS's canonical IDs (e.g. `da-DK-Wavenet-A`).
The tier prefix maps to a registry name (`gcp_standard`, `gcp_wavenet`,
`gcp_neural2`, `gcp_chirp3hd`).

Add languages here as the platform expands. Each entry MUST have a
distinct human label so the teacher dropdown doesn't show duplicates.
"""

from typing import TypedDict


class VoiceEntry(TypedDict):
    """A single voice the teacher can pick.

    `provider` is the registry name (`gcp_wavenet` etc.) so the
    frontend doesn't have to map tier→provider itself. `tier` is the
    human-facing label for the pricing column.
    """

    name: str
    provider: str
    tier: str
    gender: str
    label: str


# Currated subset of Cloud TTS voices. Keys are short BCP-47 lang tags
# (`"da"`, `"en"`) matching the frontend's lang prop. Each value is a
# list ordered by tier (cheapest first) so the dropdown groups naturally.
CURATED_VOICES: dict[str, list[VoiceEntry]] = {
    "da": [
        # Standard
        {
            "name": "da-DK-Standard-A",
            "provider": "gcp_standard",
            "tier": "Standard",
            "gender": "F",
            "label": "Anna (Standard)",
        },
        {
            "name": "da-DK-Standard-D",
            "provider": "gcp_standard",
            "tier": "Standard",
            "gender": "M",
            "label": "Daniel (Standard)",
        },
        # WaveNet — our current default tier
        {
            "name": "da-DK-Wavenet-A",
            "provider": "gcp_wavenet",
            "tier": "WaveNet",
            "gender": "F",
            "label": "Anna (WaveNet)",
        },
        {
            "name": "da-DK-Wavenet-C",
            "provider": "gcp_wavenet",
            "tier": "WaveNet",
            "gender": "M",
            "label": "Christian (WaveNet)",
        },
        {
            "name": "da-DK-Wavenet-D",
            "provider": "gcp_wavenet",
            "tier": "WaveNet",
            "gender": "F",
            "label": "Dorthe (WaveNet)",
        },
        {
            "name": "da-DK-Wavenet-E",
            "provider": "gcp_wavenet",
            "tier": "WaveNet",
            "gender": "M",
            "label": "Erik (WaveNet)",
        },
        # Neural2
        {
            "name": "da-DK-Neural2-F",
            "provider": "gcp_neural2",
            "tier": "Neural2",
            "gender": "F",
            "label": "Frida (Neural2)",
        },
        # Chirp3 HD — premium
        {
            "name": "da-DK-Chirp3-HD-Aoede",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "F",
            "label": "Aoede (Chirp3 HD)",
        },
        {
            "name": "da-DK-Chirp3-HD-Charon",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "M",
            "label": "Charon (Chirp3 HD)",
        },
        {
            "name": "da-DK-Chirp3-HD-Kore",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "F",
            "label": "Kore (Chirp3 HD)",
        },
        {
            "name": "da-DK-Chirp3-HD-Puck",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "M",
            "label": "Puck (Chirp3 HD)",
        },
        {
            "name": "da-DK-Chirp3-HD-Fenrir",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "M",
            "label": "Fenrir (Chirp3 HD)",
        },
        {
            "name": "da-DK-Chirp3-HD-Leda",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "F",
            "label": "Leda (Chirp3 HD)",
        },
        {
            "name": "da-DK-Chirp3-HD-Orus",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "M",
            "label": "Orus (Chirp3 HD)",
        },
        {
            "name": "da-DK-Chirp3-HD-Zephyr",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "F",
            "label": "Zephyr (Chirp3 HD)",
        },
    ],
    "en": [
        {
            "name": "en-US-Standard-A",
            "provider": "gcp_standard",
            "tier": "Standard",
            "gender": "M",
            "label": "Adam (Standard)",
        },
        {
            "name": "en-US-Standard-C",
            "provider": "gcp_standard",
            "tier": "Standard",
            "gender": "F",
            "label": "Claire (Standard)",
        },
        {
            "name": "en-US-Wavenet-A",
            "provider": "gcp_wavenet",
            "tier": "WaveNet",
            "gender": "M",
            "label": "Adam (WaveNet)",
        },
        {
            "name": "en-US-Wavenet-C",
            "provider": "gcp_wavenet",
            "tier": "WaveNet",
            "gender": "F",
            "label": "Claire (WaveNet)",
        },
        {
            "name": "en-US-Wavenet-D",
            "provider": "gcp_wavenet",
            "tier": "WaveNet",
            "gender": "M",
            "label": "Daniel (WaveNet)",
        },
        {
            "name": "en-US-Wavenet-F",
            "provider": "gcp_wavenet",
            "tier": "WaveNet",
            "gender": "F",
            "label": "Fiona (WaveNet)",
        },
        {
            "name": "en-US-Neural2-A",
            "provider": "gcp_neural2",
            "tier": "Neural2",
            "gender": "M",
            "label": "Adam (Neural2)",
        },
        {
            "name": "en-US-Neural2-F",
            "provider": "gcp_neural2",
            "tier": "Neural2",
            "gender": "F",
            "label": "Fiona (Neural2)",
        },
        {
            "name": "en-US-Chirp3-HD-Aoede",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "F",
            "label": "Aoede (Chirp3 HD)",
        },
        {
            "name": "en-US-Chirp3-HD-Charon",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "M",
            "label": "Charon (Chirp3 HD)",
        },
        {
            "name": "en-US-Chirp3-HD-Kore",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "F",
            "label": "Kore (Chirp3 HD)",
        },
        {
            "name": "en-US-Chirp3-HD-Puck",
            "provider": "gcp_chirp3hd",
            "tier": "Chirp3 HD",
            "gender": "M",
            "label": "Puck (Chirp3 HD)",
        },
    ],
}


SUPPORTED_LANGS: list[str] = sorted(CURATED_VOICES.keys())


def get_voices_for_lang(lang: str) -> list[VoiceEntry]:
    """Look up the curated voice list for a BCP-47 short tag.

    Falls back to the empty list for unknown langs so the frontend
    dropdown gracefully shows "no voices" rather than 500-ing.
    """
    return CURATED_VOICES.get(lang, [])


# The tier used only when nothing better can be inferred — a voice we cannot
# find in the catalogue at all. WaveNet is the safe floor: natural enough for a
# tutor and, at the same rate as Standard, it cannot surprise anyone's bill.
#
# It is deliberately NOT the answer for a voice we CAN identify. See
# ``matching_voice_for_lang``: swapping a teacher's Chirp3-HD choice down to
# WaveNet because they opened an English activity would quietly undo a
# deliberate quality decision, and change the character while it was at it.
#
# This whole path is the minority case. Every persona ships on the
# ``gcp_gemini`` tier with a multilingual bare voice name, which is RETUNED
# rather than swapped; only the "Custom voice (advanced)" panel and skill-level
# voice configs produce locale-bound names that need substituting at all.
_FALLBACK_TIER = "WaveNet"


def default_voice_for_lang(lang: str) -> VoiceEntry | None:
    """A safe curated voice to speak ``lang`` with, or None when the language
    has no curated voices at all.

    The last resort. Prefer ``matching_voice_for_lang``, which keeps the tier —
    and where the roster allows, the character — the teacher actually chose.
    """
    entries = CURATED_VOICES.get(lang, [])
    if not entries:
        return None
    return next((e for e in entries if e["tier"] == _FALLBACK_TIER), entries[0])


def _entry_by_name(name: str | None) -> VoiceEntry | None:
    """Find a curated entry by its Cloud TTS voice name, across all languages."""
    if not name:
        return None
    for entries in CURATED_VOICES.values():
        for e in entries:
            if e["name"] == name:
                return e
    return None


def _character(name: str) -> str:
    """The trailing token of a Cloud TTS voice name.

    For Chirp3-HD this is a real, locale-INDEPENDENT character:
    ``da-DK-Chirp3-HD-Kore`` and ``en-US-Chirp3-HD-Kore`` are the same voice in
    two languages. For the older tiers it is a bare letter denoting a
    locale-specific slot — ``da-DK-Wavenet-A`` is Anna and ``en-US-Wavenet-A``
    is Adam — so a single-character token is NOT a character, and callers must
    not carry it across languages.
    """
    return name.rsplit("-", 1)[-1]


def matching_voice_for_lang(lang: str, current: str | None) -> VoiceEntry | None:
    """The closest voice to ``current`` that speaks ``lang``.

    Used when an activity's language forces a locale-bound voice to be swapped
    (1.1.63 M4). The point is to change as little as possible: a teacher who
    chose Chirp3-HD chose to spend 7x more for a better voice, and one who
    chose Kore chose Kore. Opening an English activity is not a decision to
    undo either.

    In order: same tier AND same character; same tier; the safe fallback.
    """
    entries = CURATED_VOICES.get(lang, [])
    if not entries:
        return None

    cur = _entry_by_name(current)
    if cur is None:
        return default_voice_for_lang(lang)

    same_tier = [e for e in entries if e["tier"] == cur["tier"]]
    if not same_tier:
        # This tier has no voice in this language — Neural2 coverage is thin.
        return default_voice_for_lang(lang)

    character = _character(cur["name"])
    if len(character) > 1:
        # A real, roster-shared name (Chirp3-HD). Keep the character.
        same_character = next((e for e in same_tier if _character(e["name"]) == character), None)
        if same_character is not None:
            return same_character
    return same_tier[0]


def lang_matches(a: str | None, b: str | None) -> bool:
    """Do two BCP-47 tags name the same language?

    Voice languages appear both as short tags (``"da"``, from personas and the
    frontend picker) and as full locales (``"da-DK"``, from Cloud TTS voice
    names). Comparing them raw is how "the languages agree" silently became
    "they are different strings".
    """
    if not a or not b:
        return False
    return a.split("-", 1)[0].lower() == b.split("-", 1)[0].lower()
