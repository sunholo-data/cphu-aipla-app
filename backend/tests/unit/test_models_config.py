"""Unit tests for backend/config/models.py — YAML loader + Pydantic validation."""

from __future__ import annotations

import pytest

# These imports will fail until models.py is implemented — that's the TDD red state.
from config.models import (
    ModelEntry,
    ModelsConfig,
    analysis_model,
    default_model,
    fast_model,
    load_models_config,
)


class TestLoadModelsConfig:
    def test_loads_without_error(self):
        cfg = load_models_config()
        assert isinstance(cfg, ModelsConfig)

    def test_has_models(self):
        cfg = load_models_config()
        assert len(cfg.models) >= 6

    def test_all_three_providers_present(self):
        cfg = load_models_config()
        providers = {m.provider for m in cfg.models}
        assert "google" in providers
        assert "anthropic" in providers
        assert "openai" in providers

    def test_all_tiers_present(self):
        cfg = load_models_config()
        tiers = {m.tier for m in cfg.models}
        assert "default" in tiers
        assert "smart" in tiers
        assert "fast" in tiers

    def test_platform_default_exists_in_models(self):
        cfg = load_models_config()
        model_ids = {m.id for m in cfg.models}
        assert cfg.platform_default in model_ids

    def test_defaults_reference_valid_model_ids(self):
        cfg = load_models_config()
        model_ids = {m.id for m in cfg.models}
        for provider, model_id in cfg.defaults.items():
            assert model_id in model_ids, f"default for {provider!r} → {model_id!r} not in models"

    def test_defaults_cover_all_three_providers(self):
        cfg = load_models_config()
        assert "google" in cfg.defaults
        assert "anthropic" in cfg.defaults
        assert "openai" in cfg.defaults

    def test_each_model_has_api_name(self):
        cfg = load_models_config()
        for m in cfg.models:
            assert m.api_name, f"model {m.id!r} has empty api_name"

    def test_context_windows_are_positive(self):
        cfg = load_models_config()
        for m in cfg.models:
            assert m.context_window > 0, f"model {m.id!r} has non-positive context_window"


class TestModelAccessors:
    def test_fast_model_is_a_registry_google_api_name(self):
        cfg = load_models_config()
        google_api_names = {m.api_name for m in cfg.models if m.provider == "google"}
        assert fast_model() in google_api_names

    def test_fast_model_prefers_a_google_fast_tier_model_else_default(self):
        cfg = load_models_config()
        google_fast = next((m for m in cfg.models if m.provider == "google" and m.tier == "fast"), None)
        if google_fast is not None:
            assert fast_model() == google_fast.api_name
        else:
            # No separate cheap Google tier today — the platform default IS the lite
            # model — so the analytics sub-tasks resolve to the default.
            assert fast_model() == default_model()


class TestAnalysisModel:
    """BENCH-1 / 1.1.139 D1 — the after-the-fact analysis model."""

    def test_yaml_names_a_registered_model(self):
        cfg = load_models_config()
        assert cfg.analysis_model in {m.id for m in cfg.models}

    def test_default_is_the_smart_flash(self, monkeypatch):
        monkeypatch.delenv("ANALYSIS_MODEL", raising=False)
        assert analysis_model() == "gemini-3.8-flash"

    def test_is_not_the_tutor_model(self, monkeypatch):
        monkeypatch.delenv("ANALYSIS_MODEL", raising=False)
        assert analysis_model() != default_model()

    def test_env_override_by_id(self, monkeypatch):
        monkeypatch.setenv("ANALYSIS_MODEL", "gemini-3-7-flash")
        assert analysis_model() == "gemini-3.7-flash"

    def test_env_override_by_api_name(self, monkeypatch):
        monkeypatch.setenv("ANALYSIS_MODEL", "gemini-3.6-flash")
        assert analysis_model() == "gemini-3.6-flash"

    def test_env_override_unregistered_raises(self, monkeypatch):
        monkeypatch.setenv("ANALYSIS_MODEL", "gemini-9-pro-imaginary")
        with pytest.raises(ValueError, match="ANALYSIS_MODEL"):
            analysis_model()

    def test_bad_key_fails_validation(self):
        cfg = load_models_config()
        with pytest.raises(ValueError, match="analysis_model"):
            ModelsConfig(
                models=cfg.models,
                defaults=cfg.defaults,
                platform_default=cfg.platform_default,
                analysis_model="no-such-model",
            )

    def test_absent_key_falls_back_to_smart(self, monkeypatch):
        import config.models as cm

        cfg = load_models_config()
        stripped = ModelsConfig(models=cfg.models, defaults=cfg.defaults, platform_default=cfg.platform_default)
        monkeypatch.delenv("ANALYSIS_MODEL", raising=False)
        monkeypatch.setattr(cm, "load_models_config", lambda: stripped)
        assert cm.analysis_model() == cm.smart_model()


class TestModelEntry:
    def test_valid_entry(self):
        entry = ModelEntry(
            id="test-model",
            api_name="test-model-preview",
            provider="google",
            tier="default",
            context_window=1_000_000,
            max_output_tokens=65_536,
            description="Test model",
        )
        assert entry.id == "test-model"
        assert entry.provider == "google"

    def test_invalid_provider_raises(self):
        with pytest.raises(ValueError):
            ModelEntry(
                id="bad",
                api_name="bad",
                provider="amazon",  # not a valid provider
                tier="default",
                context_window=100_000,
                max_output_tokens=8_000,
                description="bad",
            )

    def test_invalid_tier_raises(self):
        with pytest.raises(ValueError):
            ModelEntry(
                id="bad",
                api_name="bad",
                provider="google",
                tier="turbo",  # not a valid tier
                context_window=100_000,
                max_output_tokens=8_000,
                description="bad",
            )
