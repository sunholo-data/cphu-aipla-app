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
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict, Field

from adk.teacher_focus import resolve_active_config
from auth import User, get_current_user
from db.classes import (
    get_class,
    update_class_capabilities,
    update_class_persona,
    update_class_voice_settings,
)
from db.firestore import get_document
from db.models.class_ import Class, ClassVoiceSettings
from personas.loader import load_persona
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
    """Resolve the requesting user's class via the anon_groups -> classId
    binding. Anonymous-group users carry `user.group_id`; teachers in chat
    mode have no group_id (Firebase auth) -> None. Returns None on any lookup
    failure rather than raising; voice config must degrade gracefully.
    """
    group_id = getattr(user, "group_id", None)
    if not group_id:
        return None
    try:
        anon_doc = get_document("anon_groups", group_id)
        if not anon_doc:
            return None
        class_id = anon_doc.get("classId")
        if not class_id:
            return None
        return get_class(class_id)
    except Exception as exc:
        logger.warning("class lookup failed for group=%s: %s", group_id, exc)
        return None


def _class_voice_for_user(user: User) -> ClassVoiceSettings | None:
    """The requesting user's class-level voice override (1.1.11), or None."""
    cls = _class_for_user(user)
    return cls.voice if cls is not None else None


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
    class_voice = cls.voice if cls is not None else None

    # 1.1.12: a persona supplies the voice. Chain: activity persona > class
    # persona (most specific wins). NOT the GLOBAL default persona — its voice
    # is the priciest tier; the default only gives avatar+name (active-config).
    persona_voice = None
    if skill_id:
        cfg = resolve_active_config(skill_id, group_tags=user.group_tags)
        activity_persona = cfg.persona if cfg is not None else None
        class_persona = cls.persona if cls is not None else None
        explicit_persona = (
            load_persona(activity_persona or class_persona) if (activity_persona or class_persona) else None
        )
        if explicit_persona is not None:
            persona_voice = explicit_persona.voice

    # Resolution chain (most specific wins; each tier only fills what's unset):
    #   1. Persona voice (the activity's character) -> 1.1.12
    #   2. Class teacher explicit provider/voice
    #   3. Skill author SkillConfig.voice
    #   4. Env VOICE_TTS_PROVIDER default via the registry
    resolved_provider_override: str | None = None
    resolved_voice: str | None = None
    resolved_lang: str | None = None
    if persona_voice is not None:
        resolved_provider_override = persona_voice.tts_provider
        resolved_voice = persona_voice.tts_voice
        resolved_lang = persona_voice.language
    if class_voice is not None:
        if resolved_provider_override is None:
            resolved_provider_override = class_voice.provider
        if resolved_voice is None:
            resolved_voice = class_voice.voice
        if resolved_lang is None:
            resolved_lang = class_voice.language
    if resolved_voice is None and skill is not None:
        sv = getattr(skill, "voice", None)
        if sv is not None:
            resolved_voice = getattr(sv, "tts_voice", None)
    # Skill-declared language wins when class hasn't set one. This is
    # what locks the LangToggle on the frontend for skills like KineBot
    # (en-only) and Boldkast (da-only).
    if resolved_lang is None and skill is not None:
        sv = getattr(skill, "voice", None)
        if sv is not None:
            resolved_lang = getattr(sv, "language", None)
    # NOTE (1.1.12 default identity): we deliberately do NOT gap-fill the voice
    # from the global default persona here. The default persona supplies only
    # the chat AVATAR + NAME (active-config); its voice (Sofie = gcp_chirp3hd,
    # the priciest tier) is left out so unconfigured skills keep the cheaper env
    # wavenet default — a Danish wavenet voice is coherent enough with the
    # default Danish-educator avatar without a 7.5x TTS cost bump. An explicitly
    # assigned persona still supplies its own voice via the persona tier above.

    # Build a synthetic skill-like object to pass to get_tts so the
    # registry resolves the class's chosen provider when one is set,
    # without us having to re-implement the resolution chain.
    if resolved_provider_override is not None:
        # Wrap the skill with the class's provider override.
        from types import SimpleNamespace

        skill_voice_override = SimpleNamespace(
            tts_provider=resolved_provider_override,
            stt_provider=None,
        )
        effective_skill = SimpleNamespace(voice=skill_voice_override)
    else:
        effective_skill = skill

    tts = get_tts(effective_skill)
    stt = get_stt(skill)

    logger.info(
        "voice/config skill_id=%r skill_found=%s class_voice=%s tts.provider=%s tts.voice=%s tts.lang=%s",
        skill_id,
        skill is not None,
        class_voice is not None,
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
    # 1.1.11 follow-up — same class-override consultation as /voice/config
    # so the synthesize PROVIDER picks the class's tier (gcp_chirp3hd vs
    # gcp_wavenet), not just the env default. Without this, the frontend
    # is told "voice=da-DK-Chirp3-HD-Aoede" but the actual synth runs on
    # gcp_wavenet's provider, which Cloud TTS bills + may downgrade the
    # voice silently to the closest matching tier.
    class_voice = _class_voice_for_user(user)
    if class_voice is not None and class_voice.provider:
        from types import SimpleNamespace

        effective_skill = SimpleNamespace(
            voice=SimpleNamespace(tts_provider=class_voice.provider, stt_provider=None),
        )
        provider = get_tts(effective_skill)
    else:
        provider = get_tts(skill)
    logger.info(
        "voice/synthesize skill_id=%r skill_found=%s class_voice=%s provider=%s lang=%s voice=%s chars=%d",
        body.skill_id,
        skill is not None,
        class_voice is not None,
        provider.name,
        body.lang,
        body.voice,
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
