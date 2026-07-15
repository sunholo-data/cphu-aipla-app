"""Pydantic models and YAML loader for the v6 model registry.

Source of truth: backend/config/models.yaml
Updated in sync with ~/.ailang/models.yml when new models release.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, model_validator

_YAML_PATH = Path(__file__).parent / "models.yaml"


class ModelEntry(BaseModel):
    id: str
    api_name: str
    provider: Literal["google", "anthropic", "openai"]
    tier: Literal["default", "smart", "fast"]
    context_window: int
    max_output_tokens: int
    description: str


class ModelsConfig(BaseModel):
    models: list[ModelEntry]
    defaults: dict[str, str]
    platform_default: str

    @model_validator(mode="after")
    def validate_references(self) -> ModelsConfig:
        model_ids = {m.id for m in self.models}
        if self.platform_default not in model_ids:
            raise ValueError(f"platform_default {self.platform_default!r} not found in models list")
        for provider, model_id in self.defaults.items():
            if model_id not in model_ids:
                raise ValueError(f"defaults[{provider!r}] = {model_id!r} not found in models list")
        return self


@lru_cache(maxsize=1)
def load_models_config() -> ModelsConfig:
    """Load and validate models.yaml. Cached after first call.

    Raises RuntimeError with a clear message if the file is missing or malformed,
    so startup failures are diagnosable rather than crashing with a raw exception.
    """
    try:
        raw = yaml.safe_load(_YAML_PATH.read_text())
    except FileNotFoundError as exc:
        raise RuntimeError(f"models.yaml not found at {_YAML_PATH}") from exc
    except yaml.YAMLError as exc:
        raise RuntimeError(f"models.yaml is malformed: {exc}") from exc

    models = [
        ModelEntry(id=key, **{k: v for k, v in entry.items() if k != "id"}) for key, entry in raw["models"].items()
    ]

    return ModelsConfig(
        models=models,
        defaults=raw["defaults"],
        platform_default=raw["platform_default"],
    )


def default_model() -> str:
    """API name of the platform default model (models.yaml ``platform_default``).

    The single knob for "what model does the platform use". Code MUST call this
    instead of hardcoding a model string, so a config change — e.g. when a model
    deprecates (``gemini-2.5-flash`` is going away) — moves every call site at
    once. RAQ-1 follow-up 2026-06-16.
    """
    cfg = load_models_config()
    entry = next((m for m in cfg.models if m.id == cfg.platform_default), None)
    return entry.api_name if entry else cfg.platform_default


def model_api_names() -> set[str]:
    """Every curated model's api_name — the allow-list for "is this a model we
    support". Use to validate a caller-chosen model instead of hardcoding."""
    return {m.api_name for m in load_models_config().models}


def provider_for_api_name(api_name: str) -> str | None:
    """The provider (``google`` | ``anthropic`` | ``openai``) for a curated
    api_name, or ``None`` if the api_name isn't in the registry."""
    return next((m.provider for m in load_models_config().models if m.api_name == api_name), None)
