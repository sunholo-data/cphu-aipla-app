"""Real configured tutor/model: ten successive simulation commands, dev only.

LOCAL_MODE=1 GOOGLE_CLOUD_PROJECT=aipla-dev-2026 GCP_PROJECT=aipla-dev-2026
GOOGLE_CLOUD_LOCATION=eu GOOGLE_GENAI_USE_VERTEXAI=True uv run pytest
tests/eval/test_sim_control_smoke.py -m slow -q
"""

import os
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

import pytest
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.artifacts import InMemoryArtifactService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from adk.agent import create_agent
from admin.platform_seed import _parse_template
from auth.firebase_auth import User
from db.models import SkillConfig, SkillMetadata
from db.models.activity_config import ActivityConfig


@pytest.fixture(autouse=True)
def _real_credentials():
    import google.auth
    import google.auth._default

    with mock.patch.object(google.auth, "default", google.auth._default.default):
        yield


@pytest.mark.slow
async def test_ten_simulation_time_changes_complete_and_persist(monkeypatch):
    if os.environ.get("GOOGLE_CLOUD_PROJECT") != "aipla-dev-2026":
        pytest.skip("live upgrade check requires the dev model project")
    cfg = ActivityConfig(
        activityId="act-upgrade-sim-smoke",
        classId="synthetic",
        teacherUid="synthetic-teacher",
        updatedAt=datetime.now(UTC),
        language="da",
        artefactId="sol-jord-maane",
        teachingGoal="Undersøg Månens faser med simulationen Sol, Jord og Måne.",
    )
    monkeypatch.setattr("adk.agent.resolve_active_config", lambda *a, **k: cfg)
    monkeypatch.setattr("adk.teacher_focus.resolve_active_config", lambda *a, **k: cfg)
    monkeypatch.setattr("adk.callbacks.permission.can_use_tool", lambda *a: True)
    parsed = _parse_template(Path(__file__).resolve().parents[2] / "skills/templates/concept-dialogue/SKILL.md")
    skill = SkillConfig(
        name=parsed["name"],
        description=parsed["description"],
        instructions=parsed["instructions"],
        skill_metadata=SkillMetadata.model_validate(parsed["metadata"]),
    )
    user = User(uid="adk-upgrade-sim-smoke", email="", auth_mode="anonymous_group_id", group_id="synthetic")
    sessions = InMemorySessionService()
    session = await sessions.create_session(app_name="test", user_id=user.uid)
    runner = Runner(
        agent=create_agent(skill, user, activity_id=cfg.activity_id),
        app_name="test",
        session_service=sessions,
        artifact_service=InMemoryArtifactService(),
    )
    for i in range(10):
        iso = f"2027-02-{i + 1:02}T16:00:00Z"
        events = [
            e
            async for e in runner.run_async(
                user_id=user.uid,
                session_id=session.id,
                new_message=types.Content(
                    role="user",
                    parts=[
                        types.Part(
                            text=f"Indstil simulationens klokkeslæt til {iso} med control_sim, kommandoen setTime og argumentet iso. Fortæl kort hvad du ændrede."
                        )
                    ],
                ),
                run_config=RunConfig(streaming_mode=StreamingMode.SSE),
            )
        ]
        assert not any(e.error_code for e in events), f"step {i + 1}: model error"
        responses = [r for e in events for r in e.get_function_responses() if r.name == "control_sim"]
        assert any(
            r.response.get("ok")
            and r.response.get("command") == "setTime"
            and r.response.get("args", {}).get("iso") == iso
            for r in responses
        ), f"step {i + 1}: requested command did not complete"
        assert any(e.is_final_response() and e.content for e in events)
    restored = await sessions.get_session(app_name="test", user_id=user.uid, session_id=session.id)
    assert len([r for e in restored.events for r in e.get_function_responses() if r.name == "control_sim"]) >= 10
