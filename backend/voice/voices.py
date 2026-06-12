"""Curated list of TTS voices, grouped by language.

Single source of truth for the teacher's voice picker and the
GET /api/voice/voices endpoint. Covers all tiers (Standard, WaveNet,
Neural2, Chirp3HD) so the teacher can experiment with quality vs cost:

  Standard  $4/M chars   — robotic, cheapest
  WaveNet   $4/M chars   — natural, our default
  Neural2   $16/M chars  — better prosody, limited voice count
  Chirp3HD  $30/M chars  — premium conversational

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
