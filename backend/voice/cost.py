"""Per-provider cost estimates for OTel span attributes.

Numbers are USD per million characters (TTS) or per minute (STT). Cross-
checked against https://cloud.google.com/text-to-speech/pricing and
https://cloud.google.com/speech-to-text/pricing on 2026-06-03; the Gemini-TTS
rate was derived from https://ai.google.dev/gemini-api/docs/pricing on
2026-08-10 (see the derivation block below — it is the one rate we compute
rather than quote, because that tier bills audio tokens, not characters).

These are *estimates* for the analytics dashboard, not invoiced billing.
The dashboard sums them per-day to give M and JB a "how much voice cost
us this week" signal. Actual GCP billing trumps these numbers.

Update when tier prices change. These same USD estimates are emitted to
BigQuery for the 1.1.9 cost dashboard via ``emit_voice_cost`` (the
``aipla_voice_cost`` log → table), which ``analytics.cost_queries`` reads
and folds into per-class/cohort spend (converted USD→EUR). The
``voice.cost_estimate_usd`` OTel span attribute is kept for Cloud Trace
but is NOT the dashboard's source — spans don't land in BigQuery.
"""

import logging
import os

log = logging.getLogger(__name__)

# --- Gemini-TTS: the tier we actually run ---------------------------------
#
# Every shipped persona sets ``ttsProvider: gcp_gemini`` and
# ``DEFAULT_PERSONA_ID`` guarantees a persona resolves for every session, so
# this is effectively 100% of read-aloud traffic. It logged **$0.00** from the
# day personas shipped, because it is the one tier that is NOT billed per
# character and so had no row in the table below. On a spend chart a zero is
# indistinguishable from cheap, which is why nobody noticed.
#
# Gemini bills audio **output tokens**, so the per-character figure is derived,
# not quoted. Three factors, each stated so the derivation can be redone when
# any one of them moves:
#
#   1. ``_GEMINI_TTS_USD_PER_M_AUDIO_TOKENS`` — $10.00/M audio output tokens
#      for gemini-2.5-flash-tts (Gemini API price list, checked 2026-08-10).
#      The pro tier is $20.00; we run flash (``VOICE_GEMINI_TTS_MODEL``).
#   2. ``_GEMINI_AUDIO_TOKENS_PER_SECOND`` — 25 tokens per second of audio,
#      per the same price list's audio-model note.
#   3. ``_TTS_CHARS_PER_SECOND`` — the shakiest of the three, and the only one
#      that is ours rather than Google's: how much text a natural TTS pace gets
#      through per second. ~150 wpm at ~6 chars/word incl. spaces.
#
# That lands at ~$16.7/M characters — between Neural2 ($16) and Chirp3-HD
# ($30), which is the right neighbourhood for a premium tier and a useful
# sanity check on the arithmetic.
#
# **Reconcile against the invoice.** Factor 3 is an estimate, so this figure
# will be off by whatever the real speaking pace is. ``VOICE_GEMINI_TTS_USD_PER_M_CHARS``
# overrides it from the environment, so a correction from a real GCP bill
# ships as a Cloud Run env var, not a deploy — the same escape hatch
# ``AIPLA_THINKING_BUDGET`` uses.
_GEMINI_TTS_USD_PER_M_AUDIO_TOKENS = 10.0
_GEMINI_AUDIO_TOKENS_PER_SECOND = 25.0
_TTS_CHARS_PER_SECOND = 15.0


def _gemini_tts_usd_per_million_chars() -> float:
    override = os.getenv("VOICE_GEMINI_TTS_USD_PER_M_CHARS", "").strip()
    if override:
        try:
            return float(override)
        except ValueError:
            log.warning(
                "VOICE_GEMINI_TTS_USD_PER_M_CHARS=%r is not a number — using the derived rate",
                override,
            )
    usd_per_audio_second = (_GEMINI_AUDIO_TOKENS_PER_SECOND / 1_000_000.0) * _GEMINI_TTS_USD_PER_M_AUDIO_TOKENS
    seconds_per_million_chars = 1_000_000.0 / _TTS_CHARS_PER_SECOND
    return usd_per_audio_second * seconds_per_million_chars


# USD per million characters synthesized.
_TTS_USD_PER_MILLION_CHARS = {
    "gcp_standard": 4.0,
    "gcp_wavenet": 4.0,
    "gcp_neural2": 16.0,
    "gcp_chirp3hd": 30.0,
    "gcp_studio": 160.0,  # not shipped but listed for completeness
    # Derived, not quoted — see the block above. Read at import so the env
    # override applies per process, like every other runtime knob here.
    "gcp_gemini": _gemini_tts_usd_per_million_chars(),
    "browser": 0.0,  # no cost — local synth
    "null": 0.0,
}

# Providers with no per-character rate, recorded as a positive decision rather
# than left to fall through the unknown-provider branch below. Empty today:
# ``gcp_gemini`` was the only member and is now priced. Kept because the guard
# test needs somewhere to put a deliberate omission, and the next tier that
# bills by something other than characters should land here rather than
# silently at zero.
_TTS_UNPRICED: frozenset[str] = frozenset()

# USD per second of audio transcribed. Gemini is the only STT engine (RAQ-1,
# 2026-06-16 — Cloud STT removed); the model is config-driven (config/models.yaml
# platform_default), provider name "gemini". Gemini counts audio at ~32 tokens/s;
# at a Flash input rate that's ~$0.000037/s. Estimate for the dashboard; actual
# GCP billing trumps it.
_STT_USD_PER_SECOND = {
    "gemini": 0.000037,
    "disabled": 0.0,
    "null": 0.0,
}


def tts_cost_usd(provider_name: str, chars: int) -> float:
    """Estimated USD for synthesizing `chars` characters via `provider_name`.

    Unpriced and unknown providers both return 0.0. The difference is that an
    UNKNOWN one now logs a warning: "the dashboard will surface it so we
    notice" was the original plan and it did not work — ``gcp_gemini`` went
    unpriced from the day personas shipped while carrying all of the traffic,
    because a zero is indistinguishable from cheap on a chart.
    """
    if provider_name in _TTS_UNPRICED:
        return 0.0
    rate = _TTS_USD_PER_MILLION_CHARS.get(provider_name)
    if rate is None:
        log.warning(
            "tts_cost_usd: no rate for provider %r — logging $0.00 for %d chars. "
            "Add it to _TTS_USD_PER_MILLION_CHARS, or to _TTS_UNPRICED with a reason.",
            provider_name,
            chars,
        )
        return 0.0
    return (chars / 1_000_000.0) * rate


def stt_cost_usd(provider_name: str, duration_ms: int) -> float:
    """Estimated USD for transcribing `duration_ms` of audio via `provider_name`.

    Cloud STT bills per 15s increment in reality; we approximate
    per-second for dashboard math. The error is at most one 15s
    increment per call — negligible at our pilot scale.
    """
    rate = _STT_USD_PER_SECOND.get(provider_name)
    if rate is None:
        return 0.0
    return (duration_ms / 1000.0) * rate
