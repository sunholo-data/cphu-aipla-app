"""``generate()`` — one model call, routed by the model's registry provider.

Two routes:

- **google** → ``google.genai`` on Vertex (ADC), exactly the call every site
  made before this module existed.
- **ucloud / openai** → an OpenAI-compatible chat completion through LiteLLM,
  the same library ADK's ``LiteLlm`` uses for agent turns. UCloud's base URL and
  key come from ``config.ucloud``.

Anthropic is registered for agent turns (ADK ``Claude`` on Vertex) but has no
one-shot route; asking for one raises rather than quietly using Gemini.

What the routes do NOT share, and so refuse rather than approximate:

- **PDF input.** Gemini reads PDF bytes; the OpenAI-compatible API takes images
  only. A PDF on that route raises :class:`UnsupportedInputError` — a purpose
  that extracts PDFs must name a model that reads them.
- **Reasoning.** Open-weight models on UCloud (GLM) reason by default, and the
  reasoning counts against ``max_tokens``. A cap sized for the answer (a title's
  32 tokens) would be spent before the answer starts, so that route adds
  ``REASONING_ALLOWANCE`` to any cap, and an empty answer cut off by the cap
  raises instead of returning ``""``.
"""

from __future__ import annotations

import base64
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from config import ucloud
from config.models import model_for, provider_for_api_name

logger = logging.getLogger(__name__)

#: Tokens added to ``max_output_tokens`` on the OpenAI-compatible route, for a
#: model that reasons before it answers. GLM 5.3-Flash spent ~400 reasoning
#: tokens on a one-line Danish physics answer (2026-10-26, ucloud_ai_smoke).
REASONING_ALLOWANCE = 4096


class UnsupportedInputError(ValueError):
    """The chosen model's provider cannot take this input (e.g. a PDF on the
    OpenAI-compatible route). Point the purpose at a model that can."""


@dataclass(frozen=True)
class Attachment:
    """A file sent with the prompt: an image, or a PDF (Gemini only)."""

    data: bytes
    mime_type: str

    @classmethod
    def from_part(cls, part: Any) -> Attachment:
        """From a ``google.genai`` ``Part`` with inline data — what
        ``adk.activity_images`` loads for the rubric judge."""
        inline = getattr(part, "inline_data", None)
        if inline is None or inline.data is None or not inline.mime_type:
            raise UnsupportedInputError("only a Part with inline data can be sent as an attachment")
        return cls(data=inline.data, mime_type=inline.mime_type)


@dataclass(frozen=True)
class Turn:
    """One earlier message in a multi-turn call. ``model`` is the assistant."""

    role: Literal["user", "model"]
    text: str


@dataclass(frozen=True)
class Generation:
    """What came back. Token counts are 0 when the provider did not report them."""

    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0


Prompt = str | Sequence[str | Attachment]


def _api_name(purpose: str | None, model: str | None) -> str:
    if (purpose is None) == (model is None):
        raise ValueError("pass exactly one of purpose= or model=")
    return model if model is not None else model_for(purpose)  # type: ignore[arg-type]


def _provider(api_name: str) -> str:
    provider = provider_for_api_name(api_name)
    if provider is not None:
        return provider
    if api_name.startswith(ucloud.UCLOUD_PREFIX):
        return "ucloud"
    # Unregistered: passed to Vertex unchanged, as every call site did before
    # this module. Callers that take a model from a user validate it against
    # config.models.model_api_names() first.
    return "google"


async def generate(
    prompt: Prompt,
    *,
    purpose: str | None = None,
    model: str | None = None,
    history: Sequence[Turn] = (),
    system: str | None = None,
    json: bool = False,
    schema: dict[str, Any] | None = None,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
) -> Generation:
    """Run one model call and return its text.

    Args:
        prompt: the final user message — text, or a sequence of text and
            :class:`Attachment` parts.
        purpose: a key of ``config.models.PURPOSES``; the model comes from
            models.yaml ``purposes``. Prefer this.
        model: an explicit api_name instead, for a caller whose model is
            itself a parameter (the tutor preview, the rubric judge).
        history: earlier turns, oldest first, sent before ``prompt``.
        system: the system instruction.
        json: ask for a JSON object.
        schema: ask for JSON matching this schema (Gemini ``response_schema``
            form; converted to JSON Schema on the OpenAI-compatible route).
        temperature: sampling temperature.
        max_output_tokens: cap on the answer.

    Raises:
        UnsupportedInputError: the provider cannot take this input.
        RuntimeError: the provider is not configured on this deploy, or the
            answer was cut off before any text.
        Whatever the provider's client raises on a failed call.
    """
    api_name = _api_name(purpose, model)
    provider = _provider(api_name)
    if provider == "google":
        result = await _google(api_name, prompt, history, system, json, schema, temperature, max_output_tokens)
    else:
        kwargs = _openai_compatible_kwargs(
            provider, api_name, prompt, history, system, json, schema, temperature, max_output_tokens
        )
        import litellm

        result = _from_completion(api_name, await litellm.acompletion(**kwargs), max_output_tokens)
    _record(result)
    return result


def generate_sync(
    prompt: Prompt,
    *,
    purpose: str | None = None,
    model: str | None = None,
    history: Sequence[Turn] = (),
    system: str | None = None,
    json: bool = False,
    schema: dict[str, Any] | None = None,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
) -> Generation:
    """:func:`generate` for a synchronous caller (the chat-title callback)."""
    api_name = _api_name(purpose, model)
    provider = _provider(api_name)
    if provider == "google":
        result = _google_sync(api_name, prompt, history, system, json, schema, temperature, max_output_tokens)
    else:
        kwargs = _openai_compatible_kwargs(
            provider, api_name, prompt, history, system, json, schema, temperature, max_output_tokens
        )
        import litellm

        result = _from_completion(api_name, litellm.completion(**kwargs), max_output_tokens)
    _record(result)
    return result


# --- google ------------------------------------------------------------------


def _google_request(
    prompt: Prompt,
    history: Sequence[Turn],
    system: str | None,
    json: bool,
    schema: dict[str, Any] | None,
    temperature: float | None,
    max_output_tokens: int | None,
) -> tuple[Any, Any]:
    from google.genai import types

    def part(item: str | Attachment) -> Any:
        return item if isinstance(item, str) else types.Part.from_bytes(data=item.data, mime_type=item.mime_type)

    items = [prompt] if isinstance(prompt, str) else list(prompt)
    if history:
        contents: Any = [{"role": t.role, "parts": [{"text": t.text}]} for t in history]
        contents.append(
            {"role": "user", "parts": [{"text": i} if isinstance(i, str) else part(i) for i in items]},
        )
    elif isinstance(prompt, str):
        contents = prompt
    else:
        contents = [part(i) for i in items]

    fields: dict[str, Any] = {}
    if system:
        fields["system_instruction"] = system
    if json or schema:
        fields["response_mime_type"] = "application/json"
    if schema:
        fields["response_schema"] = schema
    if temperature is not None:
        fields["temperature"] = temperature
    if max_output_tokens is not None:
        fields["max_output_tokens"] = max_output_tokens
    return contents, (types.GenerateContentConfig(**fields) if fields else None)


def _from_google(api_name: str, response: Any) -> Generation:
    usage = getattr(response, "usage_metadata", None)
    return Generation(
        text=getattr(response, "text", None) or "",
        model=api_name,
        input_tokens=int(getattr(usage, "prompt_token_count", None) or 0),
        output_tokens=int(getattr(usage, "candidates_token_count", None) or 0),
    )


async def _google(
    api_name: str,
    prompt: Prompt,
    history: Sequence[Turn],
    system: str | None,
    json: bool,
    schema: dict[str, Any] | None,
    temperature: float | None,
    max_output_tokens: int | None,
) -> Generation:
    from google import genai

    contents, config = _google_request(prompt, history, system, json, schema, temperature, max_output_tokens)
    kwargs: dict[str, Any] = {"model": api_name, "contents": contents}
    if config is not None:
        kwargs["config"] = config
    client = genai.Client(vertexai=True)
    return _from_google(api_name, await client.aio.models.generate_content(**kwargs))


def _google_sync(
    api_name: str,
    prompt: Prompt,
    history: Sequence[Turn],
    system: str | None,
    json: bool,
    schema: dict[str, Any] | None,
    temperature: float | None,
    max_output_tokens: int | None,
) -> Generation:
    from google import genai

    contents, config = _google_request(prompt, history, system, json, schema, temperature, max_output_tokens)
    kwargs: dict[str, Any] = {"model": api_name, "contents": contents}
    if config is not None:
        kwargs["config"] = config
    client = genai.Client(vertexai=True)
    return _from_google(api_name, client.models.generate_content(**kwargs))


# --- OpenAI-compatible (UCloud AI, OpenAI) ------------------------------------


def _openai_compatible_kwargs(
    provider: str,
    api_name: str,
    prompt: Prompt,
    history: Sequence[Turn],
    system: str | None,
    json: bool,
    schema: dict[str, Any] | None,
    temperature: float | None,
    max_output_tokens: int | None,
) -> dict[str, Any]:
    if provider == "ucloud":
        missing = ucloud.missing_settings()
        if missing:
            raise RuntimeError(
                f"{api_name!r} needs UCloud AI, which this deploy has not configured "
                f"(missing {', '.join(missing)}; see docs/ops/runbooks/ucloud-ai.md)"
            )
        kwargs: dict[str, Any] = {
            "model": f"openai/{ucloud.served_name(api_name)}",
            "api_base": ucloud.ucloud_base_url(),
            "api_key": ucloud.ucloud_api_key(),
        }
    elif provider == "openai":
        kwargs = {"model": f"openai/{api_name}"}
    else:
        raise RuntimeError(f"{api_name!r} is a {provider} model, which has no one-shot route in llm.generate")

    messages: list[dict[str, Any]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages += [{"role": "assistant" if t.role == "model" else "user", "content": t.text} for t in history]
    messages.append({"role": "user", "content": _openai_content(prompt)})
    kwargs["messages"] = messages

    if schema:
        kwargs["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "response", "schema": _to_json_schema(schema)},
        }
    elif json:
        kwargs["response_format"] = {"type": "json_object"}
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_output_tokens is not None:
        kwargs["max_tokens"] = max_output_tokens + REASONING_ALLOWANCE
    return kwargs


def _openai_content(prompt: Prompt) -> Any:
    if isinstance(prompt, str):
        return prompt
    content: list[dict[str, Any]] = []
    for item in prompt:
        if isinstance(item, str):
            content.append({"type": "text", "text": item})
        elif item.mime_type.startswith("image/"):
            url = f"data:{item.mime_type};base64,{base64.b64encode(item.data).decode()}"
            content.append({"type": "image_url", "image_url": {"url": url}})
        else:
            raise UnsupportedInputError(
                f"the OpenAI-compatible route takes images only, not {item.mime_type} — "
                "point this purpose at a model that reads it (models.yaml purposes)"
            )
    return content


def _to_json_schema(schema: Any) -> Any:
    """Gemini's schema dialect (``"OBJECT"``, ``nullable``) → JSON Schema."""
    if isinstance(schema, list):
        return [_to_json_schema(s) for s in schema]
    if not isinstance(schema, dict):
        return schema
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key == "nullable":
            continue
        if key == "type" and isinstance(value, str):
            out["type"] = [value.lower(), "null"] if schema.get("nullable") else value.lower()
        elif key == "properties":
            out[key] = {name: _to_json_schema(sub) for name, sub in value.items()}
        else:
            out[key] = _to_json_schema(value)
    return out


def _from_completion(api_name: str, response: Any, max_output_tokens: int | None) -> Generation:
    choice = response.choices[0]
    text = choice.message.content or ""
    if not text and getattr(choice, "finish_reason", None) == "length":
        raise RuntimeError(
            f"{api_name!r} reached its token cap before answering "
            f"(max_output_tokens={max_output_tokens} + {REASONING_ALLOWANCE} for reasoning)"
        )
    usage = getattr(response, "usage", None)
    return Generation(
        text=text,
        model=api_name,
        input_tokens=int(getattr(usage, "prompt_tokens", None) or 0),
        output_tokens=int(getattr(usage, "completion_tokens", None) or 0),
    )


def _record(result: Generation) -> None:
    """Cost + token metrics for the call. A metrics failure never fails it."""
    try:
        from observability.llm_metrics import record_llm_cost

        record_llm_cost(result.model, result.input_tokens, result.output_tokens)
    except Exception as exc:
        logger.debug("llm.generate metrics skipped: %s", exc)
