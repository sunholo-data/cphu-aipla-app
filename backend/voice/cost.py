"""Per-provider cost estimates for OTel span attributes.

Numbers are USD per million characters (TTS) or per minute (STT). Cross-
checked against https://cloud.google.com/text-to-speech/pricing and
https://cloud.google.com/speech-to-text/pricing on 2026-06-03.

These are *estimates* for the analytics dashboard, not invoiced billing.
The dashboard sums them per-day to give M and JB a "how much voice cost
us this week" signal. Actual GCP billing trumps these numbers.

Update when tier prices change. The 1.1.9 cost-dashboard reads from
BigQuery via the voice.cost_estimate_usd span attribute.
"""

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

    Unknown providers return 0.0 (no estimate). They still emit a span;
    the dashboard will surface them as "unknown provider, no cost
    estimate" so we notice and update the table.
    """
    rate = _TTS_USD_PER_MILLION_CHARS.get(provider_name)
    if rate is None:
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
