"""Per-provider cost estimates for OTel span attributes.

Numbers are USD per million characters (TTS) or per minute (STT). Cross-
checked against https://cloud.google.com/text-to-speech/pricing and
https://cloud.google.com/speech-to-text/pricing on 2026-06-03.

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

log = logging.getLogger(__name__)

# USD per million characters synthesized.
_TTS_USD_PER_MILLION_CHARS = {
    "gcp_standard": 4.0,
    "gcp_wavenet": 4.0,
    "gcp_neural2": 16.0,
    "gcp_chirp3hd": 30.0,
    "gcp_studio": 160.0,  # not shipped but listed for completeness
    "browser": 0.0,  # no cost — local synth
    "null": 0.0,
}

# Providers with NO per-character rate, recorded as a positive decision rather
# than left to fall through the unknown-provider branch below.
#
# ``gcp_gemini`` (gemini-2.5-flash-tts) is the one that matters, and it is the
# one the platform actually runs: every shipped persona sets
# ``ttsProvider: gcp_gemini``, and ``DEFAULT_PERSONA_ID`` guarantees a persona
# resolves for every session — so **effectively 100% of read-aloud traffic has
# been logging $0.00** since personas landed. It is not a per-character tier
# (Gemini bills audio OUTPUT TOKENS), so it does not fit this table's shape and
# a made-up per-million-chars figure would be worse than a known gap.
#
# TODO(voice-cost): give it a real estimator — chars -> audio seconds -> output
# tokens -> the current Gemini audio-output rate — and check that rate against
# the live price list rather than inferring it. Until then the dashboard
# under-reports voice spend, which matters from the 2026-08-14 pilot on.
_TTS_UNPRICED: frozenset[str] = frozenset({"gcp_gemini"})

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
