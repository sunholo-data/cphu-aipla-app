"""llm.generate — one-shot calls routed by the registry, not hardcoded to Google.

The point of the module is that moving a purpose to another provider is a
config edit. These tests pin both routes' request shapes and, end to end, that
pointing ``CHAT_TITLE_MODEL`` at a UCloud model sends the title there with no
code change.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from config.models import PURPOSES, load_models_config, model_for
from llm import Attachment, Turn, UnsupportedInputError, generate, generate_sync
from llm.generate import REASONING_ALLOWANCE, _to_json_schema

_BASE = "https://ucloud.example.dk/v1"


@pytest.fixture
def ucloud_on(monkeypatch):
    monkeypatch.setenv("UCLOUD_AI_BASE_URL", _BASE)
    monkeypatch.setenv("UCLOUD_AI_API_KEY", "sk-test-ucloud")


@pytest.fixture
def gemini(monkeypatch) -> dict[str, Any]:
    """Capture what the google route sends; answer "svar"."""
    from google import genai

    seen: dict[str, Any] = {}
    reply = SimpleNamespace(text="svar", usage_metadata=SimpleNamespace(prompt_token_count=7, candidates_token_count=3))

    class _Models:
        async def generate_content(self, **kw):
            seen.update(kw)
            return reply

    class _SyncModels:
        def generate_content(self, **kw):
            seen.update(kw)
            return reply

    class _Client:
        def __init__(self, **kw):
            seen["client"] = kw
            self.models = _SyncModels()
            self.aio = SimpleNamespace(models=_Models())

    monkeypatch.setattr(genai, "Client", _Client)
    return seen


def _completion(content: str | None, finish_reason: str = "stop") -> Any:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish_reason)],
        usage=SimpleNamespace(prompt_tokens=11, completion_tokens=5),
    )


@pytest.fixture
def litellm_calls(monkeypatch) -> list[dict[str, Any]]:
    """Capture what the OpenAI-compatible route sends; answer "svar"."""
    import litellm

    calls: list[dict[str, Any]] = []

    async def _acompletion(**kw):
        calls.append(kw)
        return _completion("svar")

    def _completion_sync(**kw):
        calls.append(kw)
        return _completion("svar")

    monkeypatch.setattr(litellm, "acompletion", _acompletion)
    monkeypatch.setattr(litellm, "completion", _completion_sync)
    return calls


# --- google route --------------------------------------------------------------


def test_google_plain_prompt_sends_the_string_and_no_config(gemini):
    out = asyncio.run(generate("hej", model="gemini-3.5-flash-lite"))
    assert out.text == "svar" and out.input_tokens == 7 and out.output_tokens == 3
    assert gemini["model"] == "gemini-3.5-flash-lite"
    assert gemini["contents"] == "hej"
    assert "config" not in gemini
    assert gemini["client"] == {"vertexai": True}


def test_google_options_become_generate_content_config(gemini):
    asyncio.run(generate("hej", model="gemini-3.5-flash-lite", system="SYS", json=True, temperature=0.0))
    cfg = gemini["config"]
    assert cfg.system_instruction == "SYS"
    assert cfg.response_mime_type == "application/json"
    assert cfg.temperature == 0.0


def test_google_pdf_attachment_becomes_a_part(gemini):
    asyncio.run(generate(["læs", Attachment(b"%PDF", "application/pdf")], model="gemini-3.5-flash-lite"))
    text, part = gemini["contents"]
    assert text == "læs"
    assert part.inline_data.mime_type == "application/pdf"


def test_google_history_is_sent_as_role_turns(gemini):
    asyncio.run(generate("tre", model="gemini-3.5-flash-lite", history=[Turn("user", "en"), Turn("model", "to")]))
    assert [c["role"] for c in gemini["contents"]] == ["user", "model", "user"]


def test_purpose_resolves_through_the_registry(gemini):
    asyncio.run(generate("hej", purpose="live_summary"))
    assert gemini["model"] == model_for("live_summary")


def test_purpose_and_model_are_exclusive():
    with pytest.raises(ValueError, match="exactly one"):
        asyncio.run(generate("hej"))
    with pytest.raises(ValueError, match="exactly one"):
        asyncio.run(generate("hej", purpose="chat_title", model="gemini-3.5-flash-lite"))


# --- OpenAI-compatible route (UCloud) -------------------------------------------


def test_ucloud_goes_to_the_ucloud_server(ucloud_on, gemini, litellm_calls):
    out = asyncio.run(generate("hej", model="ucloud/glm-5.3-flash", system="SYS"))
    assert out.text == "svar" and out.model == "ucloud/glm-5.3-flash"
    assert "model" not in gemini  # Google never called
    (kw,) = litellm_calls
    assert kw["model"] == "openai/glm-5.3-flash"
    assert kw["api_base"] == _BASE and kw["api_key"] == "sk-test-ucloud"
    assert kw["messages"] == [{"role": "system", "content": "SYS"}, {"role": "user", "content": "hej"}]


def test_ucloud_unconfigured_raises_naming_the_runbook(monkeypatch, litellm_calls):
    monkeypatch.setenv("UCLOUD_AI_BASE_URL", _BASE)
    monkeypatch.delenv("UCLOUD_AI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match=r"UCLOUD_AI_API_KEY.*ucloud-ai\.md"):
        asyncio.run(generate("hej", model="ucloud/glm-5.3-flash"))
    assert litellm_calls == []


def test_ucloud_cap_leaves_room_for_reasoning(ucloud_on, litellm_calls):
    asyncio.run(generate("hej", model="ucloud/glm-5.3-flash", max_output_tokens=32))
    assert litellm_calls[0]["max_tokens"] == 32 + REASONING_ALLOWANCE


def test_ucloud_answer_cut_off_by_the_cap_raises(ucloud_on, monkeypatch):
    import litellm

    async def _cut(**kw):
        return _completion(None, finish_reason="length")

    monkeypatch.setattr(litellm, "acompletion", _cut)
    with pytest.raises(RuntimeError, match="token cap"):
        asyncio.run(generate("hej", model="ucloud/glm-5.3-flash", max_output_tokens=32))


def test_ucloud_json_and_schema(ucloud_on, litellm_calls):
    asyncio.run(generate("hej", model="ucloud/glm-5.3-flash", json=True))
    assert litellm_calls[-1]["response_format"] == {"type": "json_object"}
    schema = {"type": "OBJECT", "properties": {"n": {"type": "STRING", "nullable": True}}, "required": ["n"]}
    asyncio.run(generate("hej", model="ucloud/glm-5.3-flash", schema=schema))
    sent = litellm_calls[-1]["response_format"]["json_schema"]["schema"]
    assert sent == {"type": "object", "properties": {"n": {"type": ["string", "null"]}}, "required": ["n"]}


def test_ucloud_takes_images_but_refuses_pdfs(ucloud_on, litellm_calls):
    asyncio.run(generate(["se", Attachment(b"\x89PNG", "image/png")], model="ucloud/glm-5.3-flash"))
    content = litellm_calls[-1]["messages"][-1]["content"]
    assert content[0] == {"type": "text", "text": "se"}
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")
    with pytest.raises(UnsupportedInputError, match="application/pdf"):
        asyncio.run(generate(["læs", Attachment(b"%PDF", "application/pdf")], model="ucloud/glm-5.3-flash"))


def test_ucloud_history_maps_model_to_assistant(ucloud_on, litellm_calls):
    asyncio.run(generate("tre", model="ucloud/glm-5.3-flash", history=[Turn("user", "en"), Turn("model", "to")]))
    assert [m["role"] for m in litellm_calls[-1]["messages"]] == ["user", "assistant", "user"]


def test_anthropic_has_no_one_shot_route():
    with pytest.raises(RuntimeError, match="no one-shot route"):
        asyncio.run(generate("hej", model="claude-sonnet-4-6"))


def test_json_schema_conversion_leaves_json_schema_alone():
    plain = {"type": "object", "properties": {"a": {"type": "array", "items": {"type": "string"}}}}
    assert _to_json_schema(plain) == plain


# --- the swap is config only ----------------------------------------------------


def test_pointing_chat_titles_at_ucloud_needs_no_code_change(ucloud_on, monkeypatch, gemini, litellm_calls):
    from db.title_generator import generate_title_fast

    monkeypatch.setenv("CHAT_TITLE_MODEL", "ucloud-glm-5-3-flash")
    event = SimpleNamespace(
        author="user", content=SimpleNamespace(parts=[SimpleNamespace(text="Hvorfor falder ting?")])
    )
    assert generate_title_fast([event]) == "svar"
    assert litellm_calls and litellm_calls[0]["model"] == "openai/glm-5.3-flash"
    assert "model" not in gemini


def test_generate_sync_google(gemini):
    assert generate_sync("hej", model="gemini-3.5-flash-lite").text == "svar"
    assert gemini["contents"] == "hej"


# --- model_for ------------------------------------------------------------------


def test_every_purpose_is_configured_in_models_yaml():
    """The yaml is the one place to look: every purpose has an explicit row."""
    assert set(load_models_config().purposes) == set(PURPOSES)


def test_env_override_by_id_or_api_name(monkeypatch):
    monkeypatch.setenv("CHAT_TITLE_MODEL", "gemini-3-8-flash")
    assert model_for("chat_title") == "gemini-3.8-flash"
    monkeypatch.setenv("CHAT_TITLE_MODEL", "ucloud/glm-5.3")
    assert model_for("chat_title") == "ucloud/glm-5.3"


def test_legacy_env_alias_still_works(monkeypatch):
    monkeypatch.delenv("DOCUMENT_EXTRACT_MODEL", raising=False)
    monkeypatch.setenv("PDF_PARSE_MODEL", "gemini-3-8-flash")
    assert model_for("document_extract") == "gemini-3.8-flash"


def test_unregistered_env_value_raises(monkeypatch):
    monkeypatch.setenv("CHAT_TITLE_MODEL", "gemini-2.5-flash-lite")
    with pytest.raises(ValueError, match="CHAT_TITLE_MODEL"):
        model_for("chat_title")


def test_unknown_purpose_raises():
    with pytest.raises(ValueError, match="unknown model purpose"):
        model_for("horoscope")
