"""``ADK_CONTEXT_CACHE``: ADK's explicit context caching, off unless switched on.

Two halves, for the reason test_compaction_reaches_chat_runner.py gives: a
config tested on its own proves nothing about whether anything reads it. So the
flag is parsed here, and separately a cache config on the deployment App is
followed to the Runner the chat path actually builds.
"""

from __future__ import annotations

import pytest

from adk import agui
from adk.session import get_context_cache_config


@pytest.mark.parametrize("raw", [None, "", "0", "off", "false", "no"])
def test_off_by_default_and_when_switched_off(monkeypatch, raw):
    if raw is None:
        monkeypatch.delenv("ADK_CONTEXT_CACHE", raising=False)
    else:
        monkeypatch.setenv("ADK_CONTEXT_CACHE", raw)
    assert get_context_cache_config() is None


@pytest.mark.parametrize("raw", ["1", "on", "TRUE", " yes "])
def test_on_gives_a_config_above_gemini_3s_floor(monkeypatch, raw):
    monkeypatch.setenv("ADK_CONTEXT_CACHE", raw)
    cfg = get_context_cache_config()
    assert cfg is not None
    assert cfg.min_tokens >= 4096 and cfg.cache_intervals >= 1 and cfg.ttl_seconds > 0


def test_a_typo_stays_off_rather_than_guessing(monkeypatch, caplog):
    monkeypatch.setenv("ADK_CONTEXT_CACHE", "onn")
    with caplog.at_level("WARNING"):
        assert get_context_cache_config() is None
    assert "ADK_CONTEXT_CACHE" in caplog.text


def test_a_cache_config_on_the_deployment_app_reaches_the_chat_runner(monkeypatch):
    from ag_ui_adk.session_manager import SessionManager
    from google.adk.agents import Agent
    from google.adk.apps import App
    from google.adk.artifacts import InMemoryArtifactService
    from google.adk.memory import InMemoryMemoryService
    from google.adk.sessions import InMemorySessionService

    monkeypatch.setenv("ADK_CONTEXT_CACHE", "1")
    cfg = get_context_cache_config()
    probe = Agent(name="probe_agent", model="gemini-2.5-flash", instruction="probe")
    monkeypatch.setattr(agui, "_deployment_app", lambda: App(name="probe", root_agent=probe, context_cache_config=cfg))

    SessionManager.reset_instance()
    try:
        built = agui.build_agui_adk_agent(
            probe,
            user_id="probe-user",
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
            artifact_service=InMemoryArtifactService(),
        )
        runner = built._create_runner(probe, "probe-user", agui.APP_NAME)
    finally:
        SessionManager.reset_instance()
    assert runner.app is not None and runner.app.context_cache_config == cfg
