"""Voice provider HTTP routes — TTS synthesize + config.

Three routes:

  GET  /api/voice/config              — return {tts, stt} provider info
                                        for this skill_id (or defaults).
  POST /api/voice/tts/synthesize      — text -> audio (with cache).
  POST /api/voice/stt/transcribe      — audio -> text. STUBBED 501 until
                                        M-B3 (Phase B).

Auth: every route uses the same group-id-or-firebase auth via
``get_current_user``. STT explicitly never persists the uploaded audio
(consumed in-process, discarded after transcribe returns).

OTel spans:

  voice.synthesize       — attrs: voice.provider, voice.chars,
                           voice.lang, voice.cache_hit,
                           voice.cost_estimate_usd, voice.auto_read
                           (set by the caller via header).
  voice.transcribe       — set in M-B3 when STT lands.

See design doc voice-provider-abstraction.md §API Changes.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict, Field

from auth import User, get_current_user
from skills.skill_config import get_skill
from voice import get_stt, get_tts
from voice.cache import CacheKey, TTSCache
from voice.cost import tts_cost_usd

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])

# Lazily-built shared cache so the GCS client is constructed once per
# process. None when VOICE_TTS_CACHE_BUCKET is unset (dev without a
# bucket); routes treat that as miss-every-time + skip-write.
_cache_singleton: TTSCache | None | _Sentinel = None


class _Sentinel:
    """Marker so we can tell "never tried to build" from "tried, got None"."""


_NOT_BUILT = _Sentinel()
_cache_singleton = _NOT_BUILT


def _get_cache() -> TTSCache | None:
    """Process-wide cache singleton. None means no cache configured."""
    global _cache_singleton
    if isinstance(_cache_singleton, _Sentinel):
        _cache_singleton = TTSCache.from_env()
    return _cache_singleton


# --- request / response models ---


class SynthesizeRequest(BaseModel):
    """Body for POST /api/voice/tts/synthesize."""

    text: str = Field(min_length=1, max_length=5000)
    lang: str = Field(min_length=1, max_length=16)
    voice: str | None = Field(default=None, max_length=64)
    skill_id: str | None = Field(default=None, alias="skillId", max_length=128)
    auto_read: bool = Field(default=False, alias="autoRead")
    """Tag the OTel span so the cost dashboard can split auto-read vs
    click-to-read cost. Pure telemetry; doesn't change synthesis."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ConfigResponse(BaseModel):
    tts: dict[str, Any]
    stt: dict[str, Any]


# --- routes ---


@router.get("/config")
async def get_config(
    skill_id: str | None = None,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Return the voice config the frontend should use for `skill_id`.

    Response shape:
      {
        "tts": {
          "provider": "browser" | "gcp_wavenet" | ...,
          "voice": str | null,
          "capabilities": VoiceCapabilities
        },
        "stt": {
          "provider": "disabled" | "gcp_latest_long" | ...,
          "capabilities": VoiceCapabilities
        }
      }
    """
    skill = get_skill(skill_id) if skill_id else None
    tts = get_tts(skill)
    stt = get_stt(skill)

    # Skill-config-supplied voice if any; else None (provider picks default).
    skill_voice = None
    if skill is not None:
        v = getattr(skill, "voice", None)
        if v is not None:
            skill_voice = getattr(v, "tts_voice", None)

    return {
        "tts": {
            "provider": tts.name,
            "voice": skill_voice,
            "capabilities": tts.describe(),
        },
        "stt": {
            "provider": stt.name,
            "capabilities": stt.describe(),
        },
    }


@router.post("/tts/synthesize")
async def synthesize(
    body: SynthesizeRequest,
    user: User = Depends(get_current_user),  # noqa: B008
) -> Response:
    """Synthesize text to audio. Cache-first; provider on miss.

    Returns:
      - 200 audio/mpeg blob (provider mime) on success.
      - 200 JSON {"provider": "browser"} when config selects browser —
        the frontend then uses Web Speech locally.
      - 503 on provider failure.
    """
    skill = get_skill(body.skill_id) if body.skill_id else None
    provider = get_tts(skill)

    with _tracer.start_as_current_span("voice.synthesize") as span:
        span.set_attribute("voice.provider", provider.name)
        span.set_attribute("voice.chars", len(body.text))
        span.set_attribute("voice.lang", body.lang)
        span.set_attribute("voice.auto_read", body.auto_read)

        # Browser path: signal to the FE, no synthesis.
        if provider.name == "browser":
            span.set_attribute("voice.cache_hit", False)
            span.set_attribute("voice.cost_estimate_usd", 0.0)
            return Response(
                content='{"provider":"browser"}',
                media_type="application/json",
                headers={"X-Voice-Provider": "browser"},
            )

        # Cache check.
        rate = 0.85  # matches GCPTTSProvider's default
        if skill is not None:
            v = getattr(skill, "voice", None)
            if v is not None:
                rate = float(getattr(v, "rate", rate))

        voice_for_key = body.voice or "_default_"
        key = CacheKey(
            provider=provider.name,
            voice=voice_for_key,
            lang=body.lang,
            rate=rate,
            text=body.text,
        )

        cache = _get_cache()
        if cache is not None:
            hit = await cache.lookup(key)
            if hit is not None:
                audio, mime = hit
                span.set_attribute("voice.cache_hit", True)
                span.set_attribute("voice.cost_estimate_usd", 0.0)
                return _audio_response(audio, mime, provider.name, cache_hit=True, cost=0.0)

        span.set_attribute("voice.cache_hit", False)

        # Synthesize.
        try:
            audio, mime = await provider.synthesize(
                text=body.text,
                lang=body.lang,
                voice=body.voice,
                extras={"rate": rate},
            )
        except RuntimeError as exc:
            logger.warning("Voice synthesize failed: %s", exc)
            span.set_attribute("voice.error", str(exc))
            raise HTTPException(status_code=503, detail="voice provider unavailable") from exc
        except ValueError as exc:
            # Bad input (empty text, unknown voice for lang, etc.).
            span.set_attribute("voice.error", str(exc))
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        cost = tts_cost_usd(provider.name, len(body.text))
        span.set_attribute("voice.cost_estimate_usd", cost)

        # Best-effort cache write.
        if cache is not None:
            await cache.write(key, audio, mime)

        return _audio_response(audio, mime, provider.name, cache_hit=False, cost=cost)


@router.post("/stt/transcribe")
async def transcribe(
    user: User = Depends(get_current_user),  # noqa: B008
) -> Response:
    """STT — wired in M-B3 (Phase B)."""
    raise HTTPException(
        status_code=501,
        detail="STT not implemented in Phase A; lands in M-B3",
    )


def _audio_response(audio: bytes, mime: str, provider_name: str, *, cache_hit: bool, cost: float) -> Response:
    return Response(
        content=audio,
        media_type=mime,
        headers={
            "X-Voice-Provider": provider_name,
            "X-Voice-Cache-Hit": "true" if cache_hit else "false",
            "X-Voice-Cost-Usd": f"{cost:.6f}",
        },
    )
