"""1.1.145 — the join test: two devices, one group code, end to end.

Two REAL ``join_group`` calls on one code mint two tokens; both go through the
REAL ``auth`` dispatcher (no ``dependency_overrides`` of the auth symbol — tests
that override the symbol the route imports pass in lockstep with the bug).

  1. Both resolve the session via ``POST /api/auth/group/session`` → one id.
  2. A posts a turn (the model is stubbed; the stub persists the user + tutor
     events into the ADK session the way ag_ui_adk does).
  3. B's ``GET /messages`` returns A's turn — the transcript the tutor reads is
     the transcript B can render (V1, "ghost context").
  4. B posts against ACTIVITY 2's session id from activity 1's page → refused
     (M3, H4).
  5. While two devices are present, the tutor's prompt says the conversation is
     shared (M0 results: it told a student it could "only see what you write").
"""

from __future__ import annotations

import time
from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest
from ag_ui.core import (
    EventType,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from fastapi.testclient import TestClient
from google.adk.events import Event
from google.genai import types

from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
from db import firestore as fs_module
from db.models import SkillConfig, SkillMetadata

SKILL = "concept-dialogue"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


@pytest.fixture()
def client() -> TestClient:
    import fast_api_app as module

    # The point of this file: the REAL dispatcher. Fail loudly if some other
    # test left an override behind rather than silently testing a stub.
    from auth import get_current_user

    assert get_current_user not in module.app.dependency_overrides
    return TestClient(module.app)


def _skill() -> SkillConfig:
    return SkillConfig(
        name=SKILL,
        description="Under test.",
        instructions="Be helpful.",
        skillId=SKILL,
        ownerId="platform",
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
        accessControl={"type": "public"},
    )


def _authorised_to_spend():
    from auth.spend_authority import SpendAuthority

    return patch(
        "skills.skill_processor.resolve_spend_authority",
        return_value=SpendAuthority(tier="pilot", billing_identity="teacher:t1", reason="test"),
    )


def _text_of(input_data) -> str:
    content = input_data.messages[-1].content
    return content if isinstance(content, str) else ""


async def _persisting_model(self, input_data) -> AsyncGenerator:
    """Stand-in for ``ADKAgent.run``: write the user turn and a tutor reply into
    the ADK session under the session's owner uid (what ag_ui_adk does), then
    emit the AG-UI events the client would see."""
    from adk.agui import APP_NAME
    from adk.session import get_session_service
    from db.chat_sessions import get_session_index

    thread_id = input_data.thread_id
    owner = get_session_index(thread_id).owner_uid
    service = get_session_service()
    session = await service.get_session(app_name=APP_NAME, user_id=owner, session_id=thread_id)
    question = _text_of(input_data)
    for author, text in (("user", question), ("tutor", f"Svar på: {question}")):
        await service.append_event(
            session,
            Event(
                author=author,
                invocation_id=input_data.run_id,
                timestamp=time.time(),
                content=types.Content(role="user" if author == "user" else "model", parts=[types.Part(text=text)]),
            ),
        )
    yield RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=input_data.run_id)
    yield TextMessageStartEvent(type=EventType.TEXT_MESSAGE_START, message_id="m1", role="assistant")
    yield TextMessageContentEvent(type=EventType.TEXT_MESSAGE_CONTENT, message_id="m1", delta="ok")
    yield TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id="m1")
    yield RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=input_data.run_id)


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _session(client: TestClient, token: str, activity: str) -> str:
    resp = client.post(
        "/api/auth/group/session",
        json={"skillId": SKILL, "activityId": activity},
        headers=_h(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["sessionId"]


def _turn(client: TestClient, token: str, session_id: str, activity: str, text: str):
    return client.post(
        f"/api/skill/{SKILL}/stream",
        json={
            "threadId": session_id,
            "runId": "run-1",
            "messages": [{"id": "u1", "role": "user", "content": text}],
            "forwardedProps": {"activity_id": activity},
        },
        headers=_h(token),
    )


def test_two_devices_share_one_transcript_and_cannot_cross_activities(client):
    from adk.agent import create_agent_with_thinking as real_factory
    from db.group_sessions import touch_presence

    rec = create_group(title="Seminar", skill_ids=[SKILL], creator_uid="teacher-1")
    tok_a = join_group(rec.group_id, client_ip="203.0.113.7").token
    tok_b = join_group(rec.group_id, client_ip="203.0.113.8").token

    seen_devices: list[int] = []

    def _spy_factory(*args, **kwargs):
        seen_devices.append(kwargs.get("devices_present", 0))
        return real_factory(*args, **kwargs)

    with (
        _authorised_to_spend(),
        patch("skills.skill_config.get_skill", return_value=_skill()),
        patch("skills.skill_processor.get_skill", return_value=_skill()),
        patch("skills.skill_processor.create_agent_with_thinking", side_effect=_spy_factory),
        patch("ag_ui_adk.ADKAgent.run", autospec=True, side_effect=_persisting_model),
    ):
        # 1. One session for both devices on activity 1; a different one on activity 2.
        s1_a = _session(client, tok_a, "act-1")
        s1_b = _session(client, tok_b, "act-1")
        assert s1_a == s1_b
        s2 = _session(client, tok_b, "act-2")
        assert s2 != s1_a

        # Both tabs are on activity 1 (the pulse heartbeat the chat page sends).
        touch_presence(rec.group_id, "tab-a", activity_id="act-1")
        touch_presence(rec.group_id, "tab-b", activity_id="act-1")

        # 2. A asks the tutor something.
        resp = _turn(client, tok_a, s1_a, "act-1", "Hvorfor hopper bolden lavere?")
        assert resp.status_code == 200, resp.text

        # 3. B's transcript holds A's turn and the tutor's reply.
        msgs = client.get(f"/api/sessions/{s1_b}/messages", headers=_h(tok_b))
        assert msgs.status_code == 200, msgs.text
        contents = [m["content"] for m in msgs.json()["messages"]]
        assert "Hvorfor hopper bolden lavere?" in contents
        assert "Svar på: Hvorfor hopper bolden lavere?" in contents

        # 5. The tutor was told two screens share it.
        assert seen_devices and seen_devices[-1] == 2

        # 4. B, on activity 1's page, posts into activity 2's session → refused.
        cross = _turn(client, tok_b, s2, "act-1", "skriv i den anden samtale")
        assert cross.status_code == 422, cross.text
        assert cross.json()["detail"]["error"] == "session_activity_mismatch"


def test_shared_conversation_block_reaches_the_prompt_only_when_shared():
    """The block is empty for one device, and names the count for several."""
    from adk.shared_conversation import build_shared_conversation_block

    assert build_shared_conversation_block(0) == ""
    assert build_shared_conversation_block(1) == ""
    block = build_shared_conversation_block(3)
    assert "3 screens" in block
    assert "Never claim you can only see one student's messages" in block


def test_shared_block_is_in_the_built_agent_instruction_for_a_group_student():
    """Not just a helper with a unit test: the factory composes it in (the
    "resolver ships with one consumer" footgun)."""
    from adk.agent import create_agent
    from auth import User

    student = User(uid="anon-grp1", email="", domain="", group_id="grp-1")
    teacher = User(uid="t1", email="t@example.dk", domain="example.dk")
    with patch("adk.agent.get_skill", return_value=None):
        shared = create_agent(_skill(), student, devices_present=3)
        alone = create_agent(_skill(), student, devices_present=1)
        teacher_agent = create_agent(_skill(), teacher, devices_present=3)

    assert "This conversation is shared by a group" in _base_instruction(shared)
    assert "This conversation is shared by a group" not in _base_instruction(alone)
    assert "This conversation is shared by a group" not in _base_instruction(teacher_agent)


def _base_instruction(agent) -> str:
    """Resolve the composed instruction to text the way ADK would, with an empty
    state — the shared block is a build-time string, so it is in the base."""
    import asyncio

    instr = agent.instruction
    if isinstance(instr, str):
        return instr

    class _Ctx:
        state: dict = {}  # noqa: RUF012 — a throwaway stand-in

        def __getattr__(self, _name):
            return None

    result = instr(_Ctx())
    if asyncio.iscoroutine(result):
        result = asyncio.run(result)
    return str(result)
