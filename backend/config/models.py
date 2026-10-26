"""Pydantic models and YAML loader for the v6 model registry.

Source of truth: backend/config/models.yaml
Updated in sync with ~/.ailang/models.yml when new models release.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, model_validator

_YAML_PATH = Path(__file__).parent / "models.yaml"

#: Every one-shot model call the platform makes outside an agent turn, by what
#: it is FOR. models.yaml ``purposes`` maps each to a model; ``model_for()``
#: resolves it, and ``llm.generate(purpose=...)`` calls it on that model's
#: provider. Moving a call off Google is a one-line edit there, not a code
#: change. A new kind of call gets a key here first.
PURPOSES: dict[str, str] = {
    "chat_title": "the title of a new chat, from its first messages (every student chat)",
    "compaction": "the summary that replaces the start of a long conversation",
    "live_summary": "the teacher's live overview of a class, from group signals",
    "chat_summary": "themes across student chat excerpts (analytics chat)",
    "analysis": "after-the-fact analysis: rubric scoring, report narrative, fidelity, goal lint",
    "document_extract": "text from an uploaded PDF or image (must read PDFs)",
    "curriculum_summary": "the short summary stored with a curriculum document",
    "structured_extract": "JSON extracted from parsed document blocks",
}

#: Env vars that predate the ``<PURPOSE>_MODEL`` convention and still work.
_PURPOSE_ENV_ALIASES: dict[str, str] = {
    "document_extract": "PDF_PARSE_MODEL",
    "structured_extract": "EXTRACTION_MODEL",
}


class ModelEntry(BaseModel):
    id: str
    api_name: str
    provider: Literal["google", "anthropic", "openai", "ucloud"]
    tier: Literal["default", "smart", "fast"]
    context_window: int
    max_output_tokens: int
    description: str


class ModelsConfig(BaseModel):
    models: list[ModelEntry]
    defaults: dict[str, str]
    platform_default: str
    # BENCH-1 / 1.1.139 D1: the model for AFTER-THE-FACT analysis (report
    # narrative, rubric lenses, the fidelity judge). Optional so an older YAML
    # without the key still loads; ``analysis_model()`` then falls back to
    # ``smart_model()``.
    analysis_model: str | None = None
    # 1.1.142 M2: ordered fail-over chain for the platform default. Optional so
    # an older YAML still loads; ``tutor_chain()`` then returns the default alone.
    tutor_chain: list[str] | None = None
    # Which model each one-shot call uses (models.yaml ``purposes``). Keys must
    # be in ``PURPOSES``; read through ``model_for()``.
    purposes: dict[str, str] = {}

    @model_validator(mode="after")
    def validate_references(self) -> ModelsConfig:
        model_ids = {m.id for m in self.models}
        if self.platform_default not in model_ids:
            raise ValueError(f"platform_default {self.platform_default!r} not found in models list")
        if self.analysis_model is not None and self.analysis_model not in model_ids:
            raise ValueError(f"analysis_model {self.analysis_model!r} not found in models list")
        if self.tutor_chain is not None:
            if not self.tutor_chain:
                raise ValueError("tutor_chain must not be empty (omit the key for no fail-over)")
            if len(set(self.tutor_chain)) != len(self.tutor_chain):
                raise ValueError(f"tutor_chain {self.tutor_chain!r} repeats a model")
            by_id = {m.id: m for m in self.models}
            for model_id in self.tutor_chain:
                if model_id not in by_id:
                    raise ValueError(f"tutor_chain entry {model_id!r} not found in models list")
                if by_id[model_id].provider != "google":
                    raise ValueError(f"tutor_chain entry {model_id!r} is not a google model (Gemini-only chain)")
            if self.tutor_chain[0] != self.platform_default:
                raise ValueError(
                    f"tutor_chain must start with platform_default {self.platform_default!r}, "
                    f"not {self.tutor_chain[0]!r}"
                )
        for provider, model_id in self.defaults.items():
            if model_id not in model_ids:
                raise ValueError(f"defaults[{provider!r}] = {model_id!r} not found in models list")
        for purpose, model_id in self.purposes.items():
            if purpose not in PURPOSES:
                raise ValueError(f"purposes[{purpose!r}] is not a known purpose ({', '.join(sorted(PURPOSES))})")
            if model_id not in model_ids:
                raise ValueError(f"purposes[{purpose!r}] = {model_id!r} not found in models list")
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

    purposes = raw.get("purposes") or {}
    analysis = raw.get("analysis_model")
    if analysis and purposes.get("analysis") and analysis != purposes["analysis"]:
        raise RuntimeError(
            f"models.yaml names two analysis models: analysis_model={analysis!r}, "
            f"purposes.analysis={purposes['analysis']!r}. Keep one."
        )
    return ModelsConfig(
        models=models,
        defaults=raw["defaults"],
        platform_default=raw["platform_default"],
        analysis_model=analysis or purposes.get("analysis"),
        tutor_chain=raw.get("tutor_chain"),
        purposes=purposes,
    )


def default_model() -> str:
    """API name of the platform default model (models.yaml ``platform_default``).

    The single knob for "what model does the platform use". Code MUST call this
    instead of hardcoding a model string, so a config change — e.g. bumping the
    default to a new model generation — moves every call site at once. Currently
    ``gemini-3.5-flash-lite``. RAQ-1 follow-up 2026-06-16.
    """
    cfg = load_models_config()
    entry = next((m for m in cfg.models if m.id == cfg.platform_default), None)
    return entry.api_name if entry else cfg.platform_default


def fast_model() -> str:
    """API name of the cheap / high-volume Google model for analytics sub-tasks —
    the session-summary model. (The rubric-judge default moved to
    ``analysis_model()`` in BENCH-1.)

    Returns the registry's ``fast``-tier Google model when one exists, else falls
    back to ``default_model()``. Registry-sourced so a model swap moves every call
    site at once instead of the hardcoded strings that would silently point at a
    dead model. Currently there is no separate cheap Google tier — the platform
    default is itself the lite model (``gemini-3.5-flash-lite``) — so this resolves
    to the default. If a cheaper high-volume Google model is later added at the
    ``fast`` tier, the analytics sub-tasks pick it up here without further changes.
    """
    cfg = load_models_config()
    entry = next((m for m in cfg.models if m.provider == "google" and m.tier == "fast"), None)
    return entry.api_name if entry else default_model()


def smart_model() -> str:
    """API name of the ``smart``-tier Google model — for sub-tasks that are
    harder than the average chat turn (currently the compaction summarizer,
    where a paraphrased-away specific is unrecoverable).

    Registry-sourced like ``fast_model()``: returns the ``smart``-tier Google
    entry when one exists, else falls back to ``default_model()``. Google-tier
    only because these sub-tasks run inside the Vertex serving path with ADC —
    no cross-provider key requirements.
    """
    cfg = load_models_config()
    entry = next((m for m in cfg.models if m.provider == "google" and m.tier == "smart"), None)
    return entry.api_name if entry else default_model()


def analysis_model() -> str:
    """API name of the model for after-the-fact analysis (``model_for("analysis")``).

    THE RULE: work that runs after the lesson — the report narrative, the
    RUBRIC lens defaults, the approach-fidelity judge, the discrimination
    benchmark — uses this. Anything a student or teacher WAITS ON in a lesson
    (the tutor turn, live-class summaries, chat titles, extraction) does not.

    Override per deploy with ``ANALYSIS_MODEL`` (a registry id or api_name).
    Without a ``purposes.analysis`` entry it falls back to ``smart_model()``.
    """
    return model_for("analysis")


def _registered_api_name(value: str, *, source: str) -> str:
    """``value`` as an api_name, given either a registry id or an api_name.

    Raises ``ValueError`` naming ``source`` for anything unregistered, rather
    than pointing a call at a model nobody priced or routed.
    """
    cfg = load_models_config()
    by_id = next((m for m in cfg.models if m.id == value), None)
    if by_id is not None:
        return by_id.api_name
    if any(m.api_name == value for m in cfg.models):
        return value
    raise ValueError(f"{source}={value!r} is neither a model id nor an api_name in models.yaml")


def model_for(purpose: str) -> str:
    """API name of the model for one kind of one-shot call (see ``PURPOSES``).

    In order: the env var ``<PURPOSE>_MODEL`` (or its legacy alias, e.g.
    ``PDF_PARSE_MODEL``), then models.yaml ``purposes``, then a fallback —
    ``smart_model()`` for analysis and compaction, ``default_model()`` for the
    rest. Env values may be a registry id or an api_name; unregistered ones
    raise. Not cached, so a test or a redeploy sees the current env.
    """
    if purpose not in PURPOSES:
        raise ValueError(f"unknown model purpose {purpose!r} — add it to config.models.PURPOSES")
    for var in (f"{purpose.upper()}_MODEL", _PURPOSE_ENV_ALIASES.get(purpose)):
        value = (os.environ.get(var) or "").strip() if var else ""
        if value:
            return _registered_api_name(value, source=var)
    cfg = load_models_config()
    model_id = cfg.purposes.get(purpose) or (cfg.analysis_model if purpose == "analysis" else None)
    if model_id:
        return next(m.api_name for m in cfg.models if m.id == model_id)
    return smart_model() if purpose in ("analysis", "compaction") else default_model()


def tutor_chain() -> list[str]:
    """API names of the fail-over chain for the platform default (models.yaml
    ``tutor_chain``), head first. The head is always ``default_model()``.

    Used by ``adk.agent.resolve_model``: when the requested model is the head,
    the model is wrapped with the whole chain; any other model gets a chain of
    one (retry, no fail-over). Without the key → ``[default_model()]``.
    """
    cfg = load_models_config()
    if not cfg.tutor_chain:
        return [default_model()]
    by_id = {m.id: m for m in cfg.models}
    return [by_id[model_id].api_name for model_id in cfg.tutor_chain]


def model_api_names() -> set[str]:
    """Every curated model's api_name — the allow-list for "is this a model we
    support". Use to validate a caller-chosen model instead of hardcoding."""
    return {m.api_name for m in load_models_config().models}


def provider_for_api_name(api_name: str) -> str | None:
    """The provider (``google`` | ``anthropic`` | ``openai`` | ``ucloud``) for a curated
    api_name, or ``None`` if the api_name isn't in the registry."""
    return next((m.provider for m in load_models_config().models if m.api_name == api_name), None)
