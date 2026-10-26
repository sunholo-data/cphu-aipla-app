"""Unit tests for resolve_model() (AGENT-FACTORY M1).

Model IDs coming from SkillConfig.skill_metadata.model are dispatched to the
correct ADK wrapper. Three provider families:
  - Gemini: gemini-*  -> adk.resilient_llm.ResilientLlm over google.adk.models.Gemini
    members (1.1.142 — retry, then fail over; see test_resilient_llm.py)
  - Claude: claude-*  -> google.adk.models.Claude
  - OpenAI: gpt-* / o3*  -> google.adk.models.lite_llm.LiteLlm (openai/ prefix)
"""

from __future__ import annotations

import pytest
from google.adk.models import Claude, Gemini
from google.adk.models.lite_llm import LiteLlm

from adk.agent import resolve_model
from adk.resilient_llm import ResilientLlm


def test_gemini_model_returns_resilient_wrapper_over_gemini():
    model = resolve_model("gemini-2.5-flash")
    assert isinstance(model, ResilientLlm)
    assert model.model == "gemini-2.5-flash"
    assert all(isinstance(member, Gemini) for member in model.chain)


def test_gemini_pro_model_returns_resilient_wrapper():
    model = resolve_model("gemini-2.5-pro")
    assert isinstance(model, ResilientLlm)
    assert model.chain_models == ["gemini-2.5-pro"]


def test_claude_model_returns_claude_wrapper():
    model = resolve_model("claude-opus-4-7")
    assert isinstance(model, Claude)


def test_openai_gpt_model_returns_litellm_with_openai_prefix():
    model = resolve_model("gpt-4o")
    assert isinstance(model, LiteLlm)
    # LiteLlm stores the openai/-prefixed id
    assert "openai/gpt-4o" in str(model.model)


def test_openai_o3_model_returns_litellm():
    model = resolve_model("o3-mini")
    assert isinstance(model, LiteLlm)
    assert "openai/o3-mini" in str(model.model)


def test_unsupported_model_raises_value_error():
    with pytest.raises(ValueError, match="Unsupported model"):
        resolve_model("mistral-large")


def test_empty_model_id_raises_value_error():
    with pytest.raises(ValueError, match="Unsupported model"):
        resolve_model("")


# --- UCloud AI (SDU, Denmark) — config/ucloud.py -----------------------------

_UCLOUD_BASE = "https://inference.example.dk/v1"


@pytest.fixture
def ucloud_env(monkeypatch):
    monkeypatch.setenv("UCLOUD_AI_BASE_URL", _UCLOUD_BASE)
    monkeypatch.setenv("UCLOUD_AI_API_KEY", "sk-test-ucloud")


def test_ucloud_model_returns_litellm_against_the_ucloud_endpoint(ucloud_env):
    model = resolve_model("ucloud/glm-5.3-flash")
    assert isinstance(model, LiteLlm)
    # The prefix is ours; the server is sent the served name over the OpenAI protocol.
    assert model.model == "openai/glm-5.3-flash"
    assert model._additional_args["api_base"] == _UCLOUD_BASE
    assert model._additional_args["api_key"] == "sk-test-ucloud"


def test_ucloud_model_without_a_key_names_what_is_missing(monkeypatch):
    monkeypatch.setenv("UCLOUD_AI_BASE_URL", _UCLOUD_BASE)
    monkeypatch.delenv("UCLOUD_AI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="UCLOUD_AI_API_KEY"):
        resolve_model("ucloud/glm-5.3-flash")


def test_ucloud_terraform_placeholder_counts_as_unconfigured(monkeypatch):
    """secrets.tf seeds the secret with a placeholder; mounting it must not
    switch the provider on with a key that 401s every turn."""
    monkeypatch.setenv("UCLOUD_AI_BASE_URL", _UCLOUD_BASE)
    monkeypatch.setenv("UCLOUD_AI_API_KEY", "REPLACE_ME_WITH_UCLOUD_AI_API_KEY")
    with pytest.raises(RuntimeError, match="UCLOUD_AI_API_KEY"):
        resolve_model("ucloud/glm-5.3-flash")


def test_ucloud_gets_no_gemini_planner_or_code_executor(ucloud_env):
    """BuiltInPlanner / BuiltInCodeExecutor are Gemini-only; a ucloud skill must
    take the non-Gemini branch of both."""
    from adk.agent import _resolve_code_executor

    executor, extra = _resolve_code_executor(["code_execution"], "ucloud/glm-5.3-flash")
    assert executor is None
    assert len(extra) == 1


def test_every_registered_ucloud_model_resolves(ucloud_env):
    from config.models import load_models_config

    names = [m.api_name for m in load_models_config().models if m.provider == "ucloud"]
    assert names, "models.yaml registers no ucloud model"
    for name in names:
        assert isinstance(resolve_model(name), LiteLlm)
