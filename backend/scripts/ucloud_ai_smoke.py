"""Smoke-test UCloud AI (SDU, Denmark) from a laptop, before any deploy uses it.

    make ucloud-smoke                         # every registered ucloud model the server serves
    make ucloud-smoke MODEL=ucloud/glm-5.3    # one model

Reads UCLOUD_AI_BASE_URL + UCLOUD_AI_API_KEY from the environment (or
backend/.env). Three checks, each answering a question the next one depends on:

  1. /models — is the base URL right, does the key work, and do the served
     names match models.yaml? A mismatch is the likeliest first failure: the
     registry's names were guessed from the catalogue page.
  2. Raw chat completion, streamed — first-token time and a Danish answer,
     with no ADK in the way.
  3. One ADK turn through ``adk.agent.resolve_model`` with a function tool —
     the path a tutor turn takes (LiteLlm, tool calling, SSE streaming).

Costs a few thousand tokens per model. Exits non-zero on any failure. Never
prints the key. Runbook: docs/ops/runbooks/ucloud-ai.md.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import httpx  # noqa: E402

from config import ucloud  # noqa: E402
from config.models import load_models_config  # noqa: E402

_PROMPT = "Forklar på dansk, i to sætninger, hvorfor en bold i frit fald accelererer med ca. 9,8 m/s²."
_TOOL_PROMPT = (
    "Brug værktøjet multiply til at udregne 37,5 gange 12,8. "
    "Svar på dansk med resultatet og én sætning om, hvad det kunne være i fysik."
)


def multiply(a: float, b: float) -> float:
    """Multiply two numbers exactly.

    Args:
        a: The first factor.
        b: The second factor.

    Returns:
        The product a * b.
    """
    return a * b


def _looks_like_reasoning(text: str) -> bool:
    """English planning prose in a reply asked for in Danish is the signature
    of reasoning leaking into the answer."""
    head = text.strip()[:200].lower()
    return any(cue in head for cue in ("the user wants", "let me ", "i need to", "i should"))


def _fail(msg: str) -> None:
    print(f"  ✗ {msg}")


def check_models(base: str, key: str) -> list[str] | None:
    print(f"1. GET {base}/models")
    headers = {"Authorization": f"Bearer {key}"}
    resp = httpx.get(f"{base}/models", headers=headers, timeout=30)
    if resp.status_code == 404 and not base.rstrip("/").endswith("/v1"):
        alt = base.rstrip("/") + "/v1"
        if httpx.get(f"{alt}/models", headers=headers, timeout=30).status_code == 200:
            _fail(f"404 here, but {alt}/models answers — set UCLOUD_AI_BASE_URL={alt}")
            return None
    if resp.status_code in (401, 403):
        _fail(f"HTTP {resp.status_code}: the key was refused (len {len(key)}). Regenerate it in UCloud.")
        return None
    if resp.status_code != 200:
        _fail(f"HTTP {resp.status_code}: {resp.text[:300]}")
        return None
    served = sorted(m.get("id", "") for m in resp.json().get("data", []))
    print(f"  ✓ key accepted; server lists {len(served)} model(s): {', '.join(served) or '(none)'}")
    return served


async def check_raw(base: str, key: str, served_name: str) -> bool:
    from openai import AsyncOpenAI

    print(f"2. raw streamed chat completion: {served_name}")
    client = AsyncOpenAI(base_url=base, api_key=key)
    start = time.monotonic()
    first: float | None = None
    text = ""
    reasoning = False
    try:
        stream = await client.chat.completions.create(
            model=served_name,
            messages=[{"role": "user", "content": _PROMPT}],
            stream=True,
            max_tokens=4000,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None:
                continue
            if getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None):
                reasoning = True
            if delta.content:
                first = first or time.monotonic() - start
                text += delta.content
    except Exception as exc:
        _fail(f"{type(exc).__name__}: {exc}")
        return False
    if not text.strip():
        _fail(
            "stream finished with no answer text" + (" (only reasoning — budget spent thinking)" if reasoning else "")
        )
        return False
    # A reasoning model's first ANSWER token comes after its thinking: this is
    # the wait a student sees, and it is the number to compare with Gemini's.
    print(f"  ✓ first answer token {first:.2f}s, total {time.monotonic() - start:.2f}s, reasoning={reasoning}")
    print(f"    {text.strip()[:400]}")
    return True


async def check_adk(api_name: str) -> bool:
    from google.adk.agents import LlmAgent
    from google.adk.agents.run_config import RunConfig, StreamingMode
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    from adk.agent import resolve_model

    print(f"3. ADK turn with a tool call: {api_name}")
    agent = LlmAgent(
        name="ucloud_smoke",
        model=resolve_model(api_name),
        instruction="Du er en fysiklærer. Brug altid værktøjet multiply til regning.",
        tools=[multiply],
    )
    sessions = InMemorySessionService()
    runner = Runner(agent=agent, app_name="ucloud_smoke", session_service=sessions)
    session = await sessions.create_session(app_name="ucloud_smoke", user_id="smoke")
    called = False
    text = ""
    thought = ""
    start = time.monotonic()
    try:
        async for event in runner.run_async(
            user_id="smoke",
            session_id=session.id,
            new_message=types.Content(role="user", parts=[types.Part(text=_TOOL_PROMPT)]),
            run_config=RunConfig(streaming_mode=StreamingMode.SSE),
        ):
            called = called or bool(event.get_function_calls())
            if event.content and event.content.parts and not event.partial:
                for part in event.content.parts:
                    if part.thought:
                        thought += part.text or ""
                    else:
                        text += part.text or ""
    except Exception as exc:
        _fail(f"{type(exc).__name__}: {exc}")
        return False
    if not called:
        _fail("the model answered without calling the tool — tool calling may not work on this model")
        return False
    if "480" not in text.replace(".", "").replace(",", ""):
        _fail(f"tool was called but the answer lacks 480: {text.strip()[:300]!r}")
        return False
    # The reasoning must arrive as thought parts, which the AG-UI layer keeps
    # out of the student's chat. Reasoning in plain text parts would be shown.
    if _looks_like_reasoning(text):
        _fail(f"the model's reasoning arrived as ANSWER text — a student would see it: {text.strip()[:300]!r}")
        return False
    print(f"  ✓ tool called, answer streamed in {time.monotonic() - start:.2f}s, thought parts: {len(thought)} chars")
    print(f"    {text.strip()[:400]}")
    return True


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model", help="one ucloud/ api_name (default: every registered one)")
    args = parser.parse_args()

    missing = ucloud.missing_settings()
    if missing:
        print(f"UCloud AI is not configured: set {', '.join(missing)} (env or backend/.env).")
        print("Both are shown once, when you click 'Generate API key' on a model's playground page in UCloud.")
        return 2
    base, key = ucloud.ucloud_base_url(), ucloud.ucloud_api_key()

    served = check_models(base, key)
    if served is None:
        return 1

    registered = [m.api_name for m in load_models_config().models if m.provider == "ucloud"]
    unmatched = [n for n in registered if ucloud.served_name(n) not in served]
    if unmatched:
        print(f"  ! models.yaml names {', '.join(unmatched)}, which the server does not list.")
        print("    Fix the api_name in backend/config/models.yaml to `ucloud/<listed id>` (and the price keys).")

    targets = [args.model] if args.model else [n for n in registered if n not in unmatched]
    if not targets:
        print("Nothing to test: no registered ucloud model is served. Fix models.yaml first.")
        return 1

    ok = not unmatched
    for api_name in targets:
        print()
        ok &= await check_raw(base, key, ucloud.served_name(api_name))
        ok &= await check_adk(api_name)
    print()
    print("✓ UCloud AI is ready to pin to a skill." if ok else "✗ Not ready — see the failures above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
