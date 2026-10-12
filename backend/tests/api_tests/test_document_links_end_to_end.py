"""1.1.147 M3c, end to end — a not-shared document never reaches a student as a link.

The model is the ONLY thing faked here, and it is faked as a hostile one: it
emits an ``aitana://doc`` link to a document the teacher did NOT share, split
across streamed chunks so no single chunk contains the whole link. Everything
else is real:

- a REAL group token from ``join_group``, through the REAL ``auth`` dispatcher
  (no ``dependency_overrides`` — a test that overrides the symbol the route
  imports passes in lockstep with the bug);
- the REAL ``/api/skill/{id}/stream`` route, the REAL agent factory with the
  activity's materials resolved from the store, and the REAL ag_ui_adk runner
  turning model chunks into SSE;
- the REAL history read, ``GET /api/sessions/{id}/messages``.

What must hold: the not-shared docId appears nowhere in the SSE body nor in the
stored transcript; the link's words survive as plain text; the shared link
survives intact; and the prompt the model was given named the shared docId and
not the secret one.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import ClassVar
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
from db import firestore as fs_module
from db.models import SkillConfig, SkillMetadata
from db.models.activity_config import MaterialRef

SKILL = "concept-dialogue"
ACTIVITY = "act-m3c-e2e"
SHARED = "doc-shared-11"
SECRET = "doc-secret-77"

REPLY = (
    f"Læs i [Vejledning til Fysik C](aitana://doc/{SHARED}/block/0) — "
    f"og se også [lærerens egen prompt](aitana://doc/{SECRET}/block/0), "
    f"eller aitana://doc/{SECRET}/block/4."
)
# Split so the secret link straddles chunks: no chunk holds "aitana://doc/<secret>".
_CUTS = [REPLY.index("[lærerens") + 3, REPLY.index(SECRET) + 4, REPLY.rindex("aitana:") + 5]
CHUNKS = [REPLY[a:b] for a, b in zip([0, *_CUTS], [*_CUTS, len(REPLY)], strict=True)]


class _HostileModel(BaseLlm):
    """Streams REPLY the way Gemini does under progressive SSE: partial chunks,
    the last carrying the finish reason, then the aggregated response."""

    model: str = "fake-hostile"
    instructions: ClassVar[list[str]] = []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        _HostileModel.instructions.append(str(llm_request.config.system_instruction or ""))
        if stream:
            for i, chunk in enumerate(CHUNKS):
                yield LlmResponse(
                    content=types.Content(role="model", parts=[types.Part(text=chunk)]),
                    partial=True,
                    finish_reason=types.FinishReason.STOP if i == len(CHUNKS) - 1 else None,
                )
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=REPLY)]),
            partial=False,
            finish_reason=types.FinishReason.STOP,
        )


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    _HostileModel.instructions.clear()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


@pytest.fixture()
def client() -> TestClient:
    import fast_api_app as module
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


def _seed_activity() -> None:
    from adk.teacher_focus import LOCAL_MODE_DEMO_CLASS_ID
    from db.activity_configs import upsert_activity_config
    from db.local_fixture import WORKSHOP_USER_UID

    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id=ACTIVITY,
        teaching_goal="Energibevarelse.",
        materials=[
            MaterialRef(kind="context", docId=SHARED, title="Vejledning til Fysik C", studentVisible=True),
            MaterialRef(kind="context", docId=SECRET, title="Prompt for Energi", studentVisible=False),
        ],
    )


def _authorised_to_spend():
    from auth.spend_authority import SpendAuthority

    return patch(
        "skills.skill_processor.resolve_spend_authority",
        return_value=SpendAuthority(tier="pilot", billing_identity="teacher:t1", reason="test"),
    )


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_a_not_shared_doc_link_never_reaches_the_student(client):
    _seed_activity()
    rec = create_group(title="Seminar", skill_ids=[SKILL], creator_uid="teacher-1")
    token = join_group(rec.group_id, client_ip="203.0.113.9").token

    with (
        _authorised_to_spend(),
        patch("skills.skill_config.get_skill", return_value=_skill()),
        patch("skills.skill_processor.get_skill", return_value=_skill()),
        patch("adk.agent.resolve_model", return_value=_HostileModel()),
    ):
        sess = client.post(
            "/api/auth/group/session", json={"skillId": SKILL, "activityId": ACTIVITY}, headers=_h(token)
        )
        assert sess.status_code == 200, sess.text
        session_id = sess.json()["sessionId"]

        resp = client.post(
            f"/api/skill/{SKILL}/stream",
            json={
                "threadId": session_id,
                "runId": "run-1",
                "messages": [{"id": "u1", "role": "user", "content": "Hvor kan jeg læse om det?"}],
                "forwardedProps": {"activity_id": ACTIVITY},
            },
            headers=_h(token),
        )
        assert resp.status_code == 200, resp.text
        sse = resp.text

        history = client.get(f"/api/sessions/{session_id}/messages", headers=_h(token))
        assert history.status_code == 200, history.text

    # The model really was hostile, and really was asked.
    assert _HostileModel.instructions, "the fake model was never called — the test proves nothing"
    # ...and no single chunk carried a whole secret link a per-chunk regex could catch.
    assert all(f"aitana://doc/{SECRET}" not in c for c in CHUNKS)

    # 1. The live stream: the secret docId is nowhere in the SSE body.
    assert SECRET not in sse
    import json

    deltas = "".join(
        json.loads(line[len("data: ") :]).get("delta", "")
        for line in sse.splitlines()
        if line.startswith("data: ") and '"TEXT_MESSAGE_CONTENT"' in line
    )
    assert f"[Vejledning til Fysik C](aitana://doc/{SHARED}/block/0)" in deltas
    assert "lærerens egen prompt" in deltas  # the words survive as plain text
    assert deltas.endswith("eller .")  # nothing held back is lost at the end of the stream

    # 2. What is stored and replayed.
    stored = " ".join(m["content"] for m in history.json()["messages"])
    assert SECRET not in stored
    assert f"(aitana://doc/{SHARED}/block/0)" in stored

    # 3. The prompt gave the shared id to link, and never the secret one as a link.
    prompt = _HostileModel.instructions[-1]
    assert f"aitana://doc/{SHARED}/block/0" in prompt
    assert f"aitana://doc/{SECRET}" not in prompt
