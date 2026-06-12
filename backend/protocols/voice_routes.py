"""Voice provider HTTP routes — TTS synthesize + config.

Three routes:

  GET  /api/voice/config              — return {tts, stt} provider info
                                        for this skill_id (or defaults).
  POST /api/voice/tts/synthesize      — text -> audio (with cache).
  POST /api/voice/stt/transcribe      — audio -> text (voice-in / talk-to-type;
                                        transcript-only, raw audio not persisted).

Auth: every route uses the same group-id-or-firebase auth via
``get_current_user``. STT explicitly never persists the uploaded audio
(consumed in-process, discarded after transcribe returns).

OTel spans:

  voice.synthesize       — attrs: voice.provider, voice.chars,
                           voice.lang, voice.cache_hit,
                           voice.cost_estimate_usd, voice.auto_read
                           (set by the caller via header).
  voice.transcribe       — attrs: voice.provider, voice.lang,
                           voice.audio_bytes, voice.transcript_chars,
                           voice.cost_estimate_usd (when durationMs sent).

See design doc voice-provider-abstraction.md §API Changes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict, Field

from adk.teacher_focus import resolve_active_config
from auth import User, get_current_user
from db.classes import (
    get_class,
    get_class_for_group,
    update_class_capabilities,
    update_class_persona,
    update_class_voice_settings,
)
from db.models.class_ import Class
from personas.loader import resolve_persona_chain
from skills.skill_config import get_skill
from voice import get_stt, get_tts
from voice.cache import CacheKey, TTSCache
from voice.cost import stt_cost_usd, tts_cost_usd
from voice.voices import SUPPORTED_LANGS, get_voices_for_lang

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


class ClassVoiceSettingsBody(BaseModel):
    """Body for PUT /api/voice/class/{class_id}/settings — teacher write.

    All three fields optional; passing nulls clears the override and
    sends the class back to skill defaults.
    """

    language: str | None = Field(default=None, max_length=16)
    voice: str | None = Field(default=None, max_length=64)
    provider: str | None = Field(default=None, max_length=32)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


def _class_for_user(user: User) -> Class | None:
    """Resolve the requesting user's class via the group -> classId binding.

    Anonymous-group users carry ``user.group_id``; teachers in chat mode have
    no group_id (Firebase auth) -> None. Delegates to the single canonical
    ``get_class_for_group`` lookup (which also backs the persona/avatar
    resolution in activity_config_routes) so voice and avatar can never resolve
    a different class.
    """
    return get_class_for_group(getattr(user, "group_id", None))


@dataclass
class ResolvedVoice:
    """The voice a chat turn should speak in, resolved ONCE from the full chain.

    Used by BOTH ``GET /config`` (tells the frontend what to request) and
    ``POST /synthesize`` (actually picks the provider). Having one resolver
    means the two endpoints can never drift — the bug where the avatar/name
    changed with the persona but the spoken voice did not.

    ``provider`` is a registry name override (e.g. ``"gcp_wavenet"``) or None to
    fall back to the skill/env default via ``get_tts``.
    """

    provider: str | None = None
    voice: str | None = None
    lang: str | None = None


def resolve_voice(user: User, skill_id: str | None, skill: object | None) -> ResolvedVoice:
    """Resolve the effective voice for this (user, skill) — the single source
    of truth for the voice chain.

    Precedence (most specific wins; each tier only fills what's still unset):
      1. Explicit per-class voice override (the "Custom voice (advanced)" panel)
      2. **Persona** — a persona is a complete bundle (avatar + name + voice +
         style). Resolved via the SAME chain as the chat avatar
         (``activity persona > class persona > global default``), so picking any
         persona — including the global default — sets the spoken voice too.
      3. Skill author's ``SkillConfig.voice`` (voice name + language only)

    The env/registry default is applied later by ``get_tts`` when ``provider``
    is still None.
    """
    cls = _class_for_user(user)
    class_voice = cls.voice if cls is not None else None

    activity_persona = None
    class_persona = cls.persona if cls is not None else None
    if skill_id:
        cfg = resolve_active_config(skill_id, group_tags=user.group_tags)
        activity_persona = cfg.persona if cfg is not None else None
    # Same chain (incl. global default) as the avatar — persona is a full bundle.
    persona = resolve_persona_chain(activity_persona, class_persona)
    persona_voice = persona.voice if persona is not None else None

    rv = ResolvedVoice()
    # 1. Explicit class override (advanced) wins.
    if class_voice is not None:
        rv.provider = class_voice.provider
        rv.voice = class_voice.voice
        rv.lang = class_voice.language
    # 2. Persona voice fills gaps.
    if persona_voice is not None:
        rv.provider = rv.provider or persona_voice.tts_provider
        rv.voice = rv.voice or persona_voice.tts_voice
        rv.lang = rv.lang or persona_voice.language
    # 3. Skill voice fills the voice name + language (not provider — the skill's
    #    provider is handled by get_tts when no override is set).
    if skill is not None:
        sv = getattr(skill, "voice", None)
        if sv is not None:
            rv.voice = rv.voice or getattr(sv, "tts_voice", None)
            rv.lang = rv.lang or getattr(sv, "language", None)
    return rv


def _tts_for(provider_override: str | None, skill: object | None):
    """Build the TTS provider, honouring a resolved provider override."""
    if provider_override is not None:
        from types import SimpleNamespace

        effective = SimpleNamespace(voice=SimpleNamespace(tts_provider=provider_override, stt_provider=None))
        return get_tts(effective)
    return get_tts(skill)


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
    cls = _class_for_user(user)

    # ONE resolver — shared with /synthesize so the spoken voice can never drift
    # from what we advertise here. A persona is a full bundle (incl. the global
    # default), so picking any persona sets the voice too.
    rv = resolve_voice(user, skill_id, skill)
    resolved_voice = rv.voice
    resolved_lang = rv.lang

    tts = _tts_for(rv.provider, skill)
    stt = get_stt(skill)

    logger.info(
        "voice/config skill_id=%r skill_found=%s tts.provider=%s tts.voice=%s tts.lang=%s",
        skill_id,
        skill is not None,
        tts.name,
        resolved_voice,
        resolved_lang,
    )

    return {
        "tts": {
            "provider": tts.name,
            "voice": resolved_voice,
            "language": resolved_lang,
            "capabilities": tts.describe(),
        },
        "stt": {
            "provider": stt.name,
            "capabilities": stt.describe(),
        },
        # VOICE-IN-REC — per-class capability flags the composer gates the mic
        # on. voiceInput also requires a real STT provider (stt.provider !=
        # disabled); recording is independent (its own upload route).
        "capabilities": {
            "voiceInput": bool(cls is not None and cls.voice_input_enabled),
            "recording": bool(cls is not None and cls.recording_enabled),
        },
    }


@router.get("/voices")
async def list_voices(
    lang: str | None = None,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Curated list of Cloud TTS voices for the teacher's picker.

    `lang` (BCP-47 short tag) filters to just that language. Omit to
    get every language's voices in one response (frontend can group).

    Returns:
      {
        "languages": ["da", "en"],
        "voices": { "da": [VoiceEntry, ...], "en": [...] }
      }
    """
    if lang:
        return {
            "languages": [lang],
            "voices": {lang: get_voices_for_lang(lang)},
        }
    return {
        "languages": SUPPORTED_LANGS,
        "voices": {lang_key: get_voices_for_lang(lang_key) for lang_key in SUPPORTED_LANGS},
    }


@router.put("/class/{class_id}/settings")
async def update_class_voice(
    class_id: str,
    body: ClassVoiceSettingsBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Teacher writes the per-class voice override.

    Auth: the caller must own the class. Anonymous-group users (students)
    get 403 — they have no class ownership.
    """
    cls = get_class(class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="class not found")
    if cls.owner_uid != user.uid:
        raise HTTPException(status_code=403, detail="not class owner")

    update_class_voice_settings(
        class_id,
        language=body.language,
        voice=body.voice,
        provider=body.provider,
    )
    logger.info(
        "voice/class-settings updated class=%s lang=%s voice=%s provider=%s",
        class_id,
        body.language,
        body.voice,
        body.provider,
    )
    return {"ok": True}


class ClassCapabilitiesBody(BaseModel):
    """Body for PUT /api/voice/class/{class_id}/capabilities (VOICE-IN-REC M4).
    The two plain per-class on/off toggles. Only passed (non-null) flags are
    written. Enabling recording is the teacher's attestation that signed paper
    consent forms are held."""

    voice_input_enabled: bool | None = Field(default=None, alias="voiceInputEnabled")
    recording_enabled: bool | None = Field(default=None, alias="recordingEnabled")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.put("/class/{class_id}/capabilities")
async def update_class_capabilities_route(
    class_id: str,
    body: ClassCapabilitiesBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Teacher toggles the per-class voice-in / lesson-recording capabilities.
    Auth: caller must own the class (students 403)."""
    cls = get_class(class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="class not found")
    if cls.owner_uid != user.uid:
        raise HTTPException(status_code=403, detail="not class owner")
    update_class_capabilities(
        class_id,
        voice_input_enabled=body.voice_input_enabled,
        recording_enabled=body.recording_enabled,
    )
    logger.info(
        "voice/class-capabilities updated class=%s voiceInput=%s recording=%s",
        class_id,
        body.voice_input_enabled,
        body.recording_enabled,
    )
    return {"ok": True}


class ClassPersonaBody(BaseModel):
    """Body for PUT /api/voice/class/{class_id}/persona. The per-class default
    persona id (null clears it → falls back to the global default)."""

    persona_id: str | None = Field(default=None, alias="personaId", max_length=64)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.put("/class/{class_id}/persona")
async def update_class_persona_route(
    class_id: str,
    body: ClassPersonaBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Teacher sets the per-class default persona (avatar + name + voice + style).
    Auth: caller must own the class."""
    cls = get_class(class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="class not found")
    if cls.owner_uid != user.uid:
        raise HTTPException(status_code=403, detail="not class owner")
    update_class_persona(class_id, body.persona_id)
    logger.info("voice/class-persona updated class=%s persona=%s", class_id, body.persona_id)
    return {"ok": True}


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
    # Resolve the voice through the SAME chain as /config (persona = full
    # bundle, incl. the global default). This is the fix for "the avatar/name
    # changed with the persona but the spoken voice did not": synthesize used
    # to ignore the persona entirely and fall back to the env default provider,
    # so the persona's voice never sounded. Now both endpoints agree.
    rv = resolve_voice(user, body.skill_id, skill)
    provider = _tts_for(rv.provider, skill)
    # The frontend sends the voice it got from /config; trust it, but fall back
    # to the resolver's voice if absent so a direct API caller still gets the
    # persona voice.
    effective_voice = body.voice or rv.voice
    logger.info(
        "voice/synthesize skill_id=%r skill_found=%s provider=%s lang=%s voice=%s chars=%d",
        body.skill_id,
        skill is not None,
        provider.name,
        body.lang,
        effective_voice,
        len(body.text),
    )

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
        # 1.0 is the natural Cloud TTS WaveNet pace; the previous 0.85
        # default carried over from browser Web Speech where Sara talks
        # too fast. Per-skill override via SkillConfig.voice.rate still
        # applies below.
        rate = 1.0
        if skill is not None:
            v = getattr(skill, "voice", None)
            if v is not None:
                rate = float(getattr(v, "rate", rate))

        voice_for_key = effective_voice or "_default_"
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
                voice=effective_voice,
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
    audio: UploadFile = File(...),  # noqa: B008
    lang: str = Form("da"),
    skill_id: str | None = Form(None, alias="skillId"),
    duration_ms: int = Form(0, alias="durationMs"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, str]:
    """Transcribe an uploaded audio blob to text (voice-in / talk-to-type).

    **Transcript-only, non-retaining:** the audio is read into memory, passed
    to the STT provider for one ``recognize()`` call, and discarded — never
    written to GCS/Firestore. (Lesson RECORDING, which *does* retain raw audio
    for research, is the separate ``POST /api/voice/recording`` route.)

    The provider is resolved by the same registry chain as TTS
    (``SkillConfig.voice.stt_provider`` > env ``VOICE_STT_PROVIDER`` >
    ``disabled``). A ``disabled``/``null`` provider returns 503 so the client
    falls back to typing.
    """
    skill = get_skill(skill_id) if skill_id else None
    provider = get_stt(skill)
    if provider.name in ("disabled", "null"):
        raise HTTPException(status_code=503, detail="Speech-to-text is not enabled here.")

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio")
    mime = audio.content_type or "audio/webm"

    with _tracer.start_as_current_span("voice.transcribe") as span:
        span.set_attribute("voice.provider", provider.name)
        span.set_attribute("voice.lang", lang)
        span.set_attribute("voice.audio_bytes", len(raw))
        try:
            text = await provider.transcribe(raw, mime, lang, None)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        span.set_attribute("voice.transcript_chars", len(text))
        if duration_ms > 0:
            span.set_attribute("voice.cost_estimate_usd", stt_cost_usd(provider.name, duration_ms))

    return {"text": text}


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
