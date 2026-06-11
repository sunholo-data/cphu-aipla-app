"""API tests for /api/voice/{config,tts/synthesize,stt/transcribe}.

Uses dependency_overrides to inject a synthetic user and monkeypatches
the voice registry to return controlled provider mocks. No real GCP
calls. The cache is force-disabled (VOICE_TTS_CACHE_BUCKET unset)
unless a test opts in.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from protocols.voice_routes import router
from voice.base import VoiceCapabilities

STUDENT_UID = "group-abc-xyz"


@pytest.fixture(autouse=True)
def _no_cache(monkeypatch):
    """Force-disable the TTS cache for these tests unless the test re-sets it."""
    monkeypatch.delenv("VOICE_TTS_CACHE_BUCKET", raising=False)
    # Reset the lazy cache singleton so each test starts clean.
    from protocols import voice_routes as vr

    vr._cache_singleton = vr._NOT_BUILT
    yield
    vr._cache_singleton = vr._NOT_BUILT


@pytest.fixture()
def app():
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=STUDENT_UID, email="")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


# --- helpers ---


def _fake_tts(name: str = "gcp_wavenet", audio: bytes = b"\xff\xfbAUDIO") -> MagicMock:
    """Build a fake TTSProvider with the given name + audio output."""
    p = MagicMock()
    p.name = name
    p.synthesize = AsyncMock(return_value=(audio, "audio/mpeg"))
    p.describe = MagicMock(
        return_value=VoiceCapabilities(tts=True, stt=False, streaming=False, languages=["da-DK", "en-US"])
    )
    return p


def _fake_stt(name: str = "disabled") -> MagicMock:
    p = MagicMock()
    p.name = name
    p.describe = MagicMock(
        return_value=VoiceCapabilities(
            tts=False,
            stt=name != "disabled",
            streaming=False,
            languages=["da-DK"] if name != "disabled" else [],
        )
    )
    return p


def _fake_browser_tts() -> MagicMock:
    """Browser-provider: synth raises (route should not call it)."""
    p = MagicMock()
    p.name = "browser"
    p.synthesize = AsyncMock(side_effect=NotImplementedError("browser route path"))
    p.describe = MagicMock(return_value=VoiceCapabilities(tts=True, stt=False, streaming=False, languages=[]))
    return p


# --- GET /api/voice/config ---


def test_config_returns_browser_and_disabled_by_default(client, monkeypatch):
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: _fake_browser_tts())
    monkeypatch.setattr("protocols.voice_routes.get_stt", lambda skill=None: _fake_stt("disabled"))
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    resp = client.get("/api/voice/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tts"]["provider"] == "browser"
    assert data["stt"]["provider"] == "disabled"
    assert data["tts"]["capabilities"]["tts"] is True
    assert data["stt"]["capabilities"]["stt"] is False


def test_config_with_skill_id_passes_skill_to_registry(client, monkeypatch):
    seen = {}

    def fake_get_tts(skill=None):
        seen["skill"] = skill
        return _fake_tts("gcp_wavenet")

    monkeypatch.setattr("protocols.voice_routes.get_tts", fake_get_tts)
    monkeypatch.setattr("protocols.voice_routes.get_stt", lambda skill=None: _fake_stt("disabled"))
    fake_skill = MagicMock()
    fake_skill.voice = None  # no voice override
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: fake_skill if sid == "led-planck" else None)

    resp = client.get("/api/voice/config?skill_id=led-planck")
    assert resp.status_code == 200
    assert seen["skill"] is fake_skill


def test_config_persona_voice_overrides_class_and_skill(client, monkeypatch):
    """1.1.12: a persona on the active activity supplies the tutor voice."""
    from types import SimpleNamespace

    seen = {}

    def fake_get_tts(skill=None):
        seen["skill"] = skill
        return _fake_tts("gcp_wavenet")

    monkeypatch.setattr("protocols.voice_routes.get_tts", fake_get_tts)
    monkeypatch.setattr("protocols.voice_routes.get_stt", lambda skill=None: _fake_stt("disabled"))
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)
    monkeypatch.setattr("protocols.voice_routes._class_voice_for_user", lambda user: None)
    # The active activity has the "frida" persona (real catalogue entry).
    monkeypatch.setattr(
        "protocols.voice_routes.resolve_active_config",
        lambda sid, group_tags=None: SimpleNamespace(persona="frida"),
    )

    resp = client.get("/api/voice/config?skill_id=concept-x")
    assert resp.status_code == 200
    data = resp.json()
    # Frida's voice (da-DK-Wavenet-D / gcp_wavenet) wins over the absent class/skill.
    assert data["tts"]["voice"] == "da-DK-Wavenet-D"
    assert data["tts"]["language"] == "da"
    # The persona's provider override reached the registry via the wrapped skill.
    assert seen["skill"].voice.tts_provider == "gcp_wavenet"


# --- POST /api/voice/tts/synthesize ---


def test_synthesize_browser_returns_json_signal(client, monkeypatch):
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: _fake_browser_tts())
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    resp = client.post(
        "/api/voice/tts/synthesize",
        json={"text": "Hej", "lang": "da"},
    )
    assert resp.status_code == 200
    assert resp.headers["x-voice-provider"] == "browser"
    assert resp.json() == {"provider": "browser"}


def test_synthesize_gcp_returns_audio_blob(client, monkeypatch):
    tts = _fake_tts("gcp_wavenet", audio=b"\xff\xfbWAVENET-MP3")
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: tts)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    resp = client.post(
        "/api/voice/tts/synthesize",
        json={"text": "Hej", "lang": "da"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/mpeg"
    assert resp.headers["x-voice-provider"] == "gcp_wavenet"
    assert resp.headers["x-voice-cache-hit"] == "false"
    # Cost > 0 because we synthesized 3 chars on a $4/M tier.
    assert float(resp.headers["x-voice-cost-usd"]) > 0
    assert resp.content == b"\xff\xfbWAVENET-MP3"


def test_synthesize_passes_text_and_lang_to_provider(client, monkeypatch):
    tts = _fake_tts("gcp_wavenet")
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: tts)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    client.post(
        "/api/voice/tts/synthesize",
        json={"text": "Hvad er Plancks konstant?", "lang": "da", "voice": "da-DK-Wavenet-A"},
    )
    tts.synthesize.assert_awaited_once()
    call_kwargs = tts.synthesize.await_args.kwargs
    assert call_kwargs["text"] == "Hvad er Plancks konstant?"
    assert call_kwargs["lang"] == "da"
    assert call_kwargs["voice"] == "da-DK-Wavenet-A"


def test_synthesize_rejects_empty_text(client, monkeypatch):
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: _fake_tts())
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    resp = client.post(
        "/api/voice/tts/synthesize",
        json={"text": "", "lang": "da"},
    )
    assert resp.status_code == 422  # pydantic validation


def test_synthesize_returns_503_on_provider_failure(client, monkeypatch):
    tts = _fake_tts()
    tts.synthesize = AsyncMock(side_effect=RuntimeError("Cloud TTS quota exceeded"))
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: tts)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    resp = client.post(
        "/api/voice/tts/synthesize",
        json={"text": "Hej", "lang": "da"},
    )
    assert resp.status_code == 503


def test_synthesize_returns_400_on_provider_value_error(client, monkeypatch):
    tts = _fake_tts()
    tts.synthesize = AsyncMock(side_effect=ValueError("No default wavenet voice for zu-ZA"))
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: tts)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    resp = client.post(
        "/api/voice/tts/synthesize",
        json={"text": "Hej", "lang": "zu"},
    )
    assert resp.status_code == 400


def test_synthesize_records_auto_read_attr_via_field(client, monkeypatch):
    """auto_read flag is accepted and doesn't fail. Span attr inspection
    is exercised in OTel integration tests, not here."""
    tts = _fake_tts()
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: tts)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    resp = client.post(
        "/api/voice/tts/synthesize",
        json={"text": "Hej", "lang": "da", "autoRead": True},
    )
    assert resp.status_code == 200


def test_synthesize_with_cache_hit_skips_provider_call(client, monkeypatch):
    tts = _fake_tts("gcp_wavenet")
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: tts)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    # Wire a mock cache that hits.
    fake_cache = MagicMock()
    fake_cache.lookup = AsyncMock(return_value=(b"\xff\xfbCACHED", "audio/mpeg"))
    fake_cache.write = AsyncMock()
    monkeypatch.setattr("protocols.voice_routes._get_cache", lambda: fake_cache)

    resp = client.post(
        "/api/voice/tts/synthesize",
        json={"text": "Hej", "lang": "da"},
    )
    assert resp.status_code == 200
    assert resp.content == b"\xff\xfbCACHED"
    assert resp.headers["x-voice-cache-hit"] == "true"
    assert float(resp.headers["x-voice-cost-usd"]) == 0
    # Provider not called.
    tts.synthesize.assert_not_awaited()
    # Cache write not called (we already had a hit).
    fake_cache.write.assert_not_awaited()


def test_synthesize_with_cache_miss_writes_after_synth(client, monkeypatch):
    tts = _fake_tts("gcp_wavenet", audio=b"\xff\xfbFRESH")
    monkeypatch.setattr("protocols.voice_routes.get_tts", lambda skill=None: tts)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)

    fake_cache = MagicMock()
    fake_cache.lookup = AsyncMock(return_value=None)  # miss
    fake_cache.write = AsyncMock()
    monkeypatch.setattr("protocols.voice_routes._get_cache", lambda: fake_cache)

    resp = client.post(
        "/api/voice/tts/synthesize",
        json={"text": "Hej", "lang": "da"},
    )
    assert resp.status_code == 200
    assert resp.content == b"\xff\xfbFRESH"
    tts.synthesize.assert_awaited_once()
    fake_cache.write.assert_awaited_once()


# --- POST /api/voice/stt/transcribe (VOICE-IN-REC M1) ---


def _enabled_stt(monkeypatch, transcript: str = "hej med dig"):
    """Wire get_stt to an enabled fake provider whose transcribe returns text."""
    p = _fake_stt("gcp_latest_long")
    p.transcribe = AsyncMock(return_value=transcript)
    monkeypatch.setattr("protocols.voice_routes.get_stt", lambda skill=None: p)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)
    return p


def test_transcribe_returns_text(client, monkeypatch):
    p = _enabled_stt(monkeypatch, "hej verden")
    resp = client.post(
        "/api/voice/stt/transcribe",
        files={"audio": ("clip.webm", b"\x1aE\xdf\xa3-fake-webm", "audio/webm")},
        data={"lang": "da", "durationMs": "1500"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"text": "hej verden"}
    # the raw bytes reached the provider; nothing here persists them
    assert p.transcribe.await_count == 1


def test_transcribe_disabled_provider_returns_503(client, monkeypatch):
    monkeypatch.setattr("protocols.voice_routes.get_stt", lambda skill=None: _fake_stt("disabled"))
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)
    resp = client.post(
        "/api/voice/stt/transcribe",
        files={"audio": ("clip.webm", b"x", "audio/webm")},
        data={"lang": "da"},
    )
    assert resp.status_code == 503


def test_transcribe_empty_audio_returns_400(client, monkeypatch):
    _enabled_stt(monkeypatch)
    resp = client.post(
        "/api/voice/stt/transcribe",
        files={"audio": ("clip.webm", b"", "audio/webm")},
        data={"lang": "da"},
    )
    assert resp.status_code == 400


def test_transcribe_provider_runtime_error_returns_503(client, monkeypatch):
    p = _fake_stt("gcp_latest_long")
    p.transcribe = AsyncMock(side_effect=RuntimeError("grpc down"))
    monkeypatch.setattr("protocols.voice_routes.get_stt", lambda skill=None: p)
    monkeypatch.setattr("protocols.voice_routes.get_skill", lambda sid: None)
    resp = client.post(
        "/api/voice/stt/transcribe",
        files={"audio": ("clip.webm", b"xx", "audio/webm")},
        data={"lang": "da"},
    )
    assert resp.status_code == 503
