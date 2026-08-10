"""Unit tests for ADK service factories — env-var-driven backend selection."""

from __future__ import annotations

from unittest.mock import patch

from adk import session as session_mod


class TestGetSessionService:
    def setup_method(self):
        session_mod._reset_session_service_for_tests()

    def teardown_method(self):
        session_mod._reset_session_service_for_tests()

    def test_returns_in_memory_when_no_env(self):
        with patch.dict("os.environ", {}, clear=True):
            svc = session_mod.get_session_service()
        assert type(svc).__name__ == "InMemorySessionService"

    def test_returns_vertex_ai_when_env_set(self):
        env = {
            "AGENT_ENGINE_ID": "projects/p/locations/l/reasoningEngines/123",
            "GOOGLE_CLOUD_PROJECT": "test-project",
            "GOOGLE_CLOUD_LOCATION": "europe-west1",
        }
        with patch.dict("os.environ", env, clear=True):
            svc = session_mod.get_session_service()
        # Wrapped in _LegacyAnonOwnerSessionService so deterministic anon-group
        # uids can resume pre-2026-06-13 legacy-owned Vertex sessions; the inner
        # service is still Vertex.
        assert type(svc).__name__ == "_LegacyAnonOwnerSessionService"
        assert type(svc._inner).__name__ == "VertexAiSessionService"


class TestGetMemoryService:
    def test_returns_in_memory_when_no_env(self):
        with patch.dict("os.environ", {}, clear=True):
            svc = session_mod.get_memory_service()
        assert type(svc).__name__ == "InMemoryMemoryService"

    def test_returns_vertex_ai_when_env_set(self):
        env = {
            "AGENT_ENGINE_ID": "projects/p/locations/l/reasoningEngines/123",
            "GOOGLE_CLOUD_PROJECT": "test-project",
            "GOOGLE_CLOUD_LOCATION": "europe-west1",
        }
        with patch.dict("os.environ", env, clear=True):
            svc = session_mod.get_memory_service()
        assert type(svc).__name__ == "VertexAiMemoryBankService"


class TestGetArtifactService:
    def setup_method(self):
        session_mod._reset_artifact_service_for_tests()

    def teardown_method(self):
        session_mod._reset_artifact_service_for_tests()

    def test_returns_in_memory_when_no_env(self):
        with patch.dict("os.environ", {}, clear=True):
            svc = session_mod.get_artifact_service()
        assert type(svc).__name__ == "InMemoryArtifactService"

    def test_returns_gcs_when_bucket_set(self):
        # GcsArtifactService instantiates a storage.Client in __init__, which
        # calls google.auth.default() — fine on Cloud Run, fatal on CI runners
        # without ADC. Mock the client so the factory branch is exercised
        # without touching real credentials.
        env = {"ADK_ARTIFACT_BUCKET": "my-bucket", "GOOGLE_CLOUD_PROJECT": "test-project"}
        with patch.dict("os.environ", env, clear=True), patch("google.cloud.storage.Client"):
            svc = session_mod.get_artifact_service()
        assert type(svc).__name__ == "GcsArtifactService"


class TestGetServiceUris:
    """Test the URI helpers used by get_fast_api_app()."""

    def test_session_uri_none_when_no_env(self):
        with patch.dict("os.environ", {}, clear=True):
            assert session_mod.get_session_service_uri() is None

    def test_session_uri_agent_engine_when_set(self):
        env = {
            "AGENT_ENGINE_ID": "projects/p/locations/l/reasoningEngines/123",
            "GOOGLE_CLOUD_PROJECT": "test-project",
            "GOOGLE_CLOUD_LOCATION": "europe-west1",
        }
        with patch.dict("os.environ", env, clear=True):
            uri = session_mod.get_session_service_uri()
        assert uri is not None
        assert "agentengine://" in uri

    def test_artifact_uri_none_when_no_env(self):
        with patch.dict("os.environ", {}, clear=True):
            assert session_mod.get_artifact_service_uri() is None

    def test_artifact_uri_gcs_when_bucket_set(self):
        env = {"ADK_ARTIFACT_BUCKET": "my-bucket"}
        with patch.dict("os.environ", env, clear=True):
            uri = session_mod.get_artifact_service_uri()
        assert uri == "gs://my-bucket"


class TestGetCompactionConfig:
    """Config VALUES only. Whether the config is actually WIRED into the chat
    Runner is asserted by test_compaction_reaches_chat_runner.py — this class
    was green for months while the config reached nothing, so never read a
    pass here as "compaction works"."""

    def test_gemini_gets_large_window_thresholds(self):
        cfg = session_mod.get_compaction_config("gemini-3.6-flash")
        assert cfg.token_threshold == 250_000
        assert cfg.event_retention_size == 60
        assert cfg.compaction_interval == 40

    def test_gpt_5_4_gets_large_window_thresholds(self):
        # GPT-5.4 has a 1M context window — same tier as Gemini
        cfg = session_mod.get_compaction_config("gpt-5.4")
        assert cfg.token_threshold == 250_000

    def test_claude_gets_small_window_thresholds(self):
        cfg = session_mod.get_compaction_config("claude-sonnet-4-6")
        assert cfg.token_threshold == 120_000
        assert cfg.event_retention_size == 40
        assert cfg.compaction_interval == 20

    def test_gpt_5_1_gets_small_window_thresholds(self):
        cfg = session_mod.get_compaction_config("gpt-5.1-chat-latest")
        assert cfg.token_threshold == 120_000

    def test_unknown_model_gets_smallest_window_config(self):
        # Compacting too eagerly degrades an answer; overflowing fails the turn.
        cfg = session_mod.get_compaction_config("unknown-future-model")
        assert cfg.token_threshold == 120_000
        assert cfg.event_retention_size == 40

    def test_both_triggers_are_always_armed(self):
        # A token_threshold without event_retention_size is rejected by ADK's
        # validator; an interval-only config is the pre-2026-08 turn-count
        # behaviour. Every family must arm both.
        for model in ("gemini-3.6-flash", "gpt-5.4", "claude-sonnet-4-6", "gpt-5.1", "mystery"):
            cfg = session_mod.get_compaction_config(model)
            assert cfg.token_threshold and cfg.event_retention_size and cfg.compaction_interval

    def test_env_override_changes_the_token_threshold(self, monkeypatch):
        monkeypatch.setenv("COMPACTION_TOKEN_THRESHOLD", "3000")
        cfg = session_mod.get_compaction_config("gemini-3.6-flash")
        assert cfg.token_threshold == 3000
        # The rest of the config is untouched.
        assert cfg.event_retention_size == 60

    def test_garbage_env_override_is_ignored(self, monkeypatch):
        monkeypatch.setenv("COMPACTION_TOKEN_THRESHOLD", "not-a-number")
        assert session_mod.get_compaction_config("gemini-3.6-flash").token_threshold == 250_000

    def test_non_positive_env_override_is_ignored(self, monkeypatch):
        monkeypatch.setenv("COMPACTION_TOKEN_THRESHOLD", "0")
        assert session_mod.get_compaction_config("gemini-3.6-flash").token_threshold == 250_000
