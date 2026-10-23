"""Dev-only ADK 1 -> 2 -> 1 session, tool and GCS artifact continuation drill.

Run seed using the production ADK 1.31.1 environment, upgrade using the current
backend environment, then rollback using 1.31.1 again. Each phase reads the
previous phase's persisted events/artifacts AND appends a real Runner turn.
Uses synthetic data and the dev service's configured Vertex/GCS resources.
No deployment, real model call, user transcript or production access is involved.
"""

import argparse
import asyncio
import json
import os
import subprocess
import uuid
from importlib.metadata import version
from pathlib import Path

PROJECT = "aipla-dev-2026"
APP = "aitana_platform"


def artifact_text(artifact) -> str | None:
    # GCS reloads a saved text Part as text/plain inline_data; memory keeps text.
    if artifact is None:
        return None
    if artifact.text is not None:
        return artifact.text
    return artifact.inline_data.data.decode() if artifact.inline_data else None


async def run(phase: str, fixture_path: Path) -> None:
    os.environ["GOOGLE_CLOUD_PROJECT"] = PROJECT
    os.environ["GCP_PROJECT"] = PROJECT
    import google.auth
    import vertexai
    from google.adk.agents import LlmAgent
    from google.adk.artifacts import GcsArtifactService
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import Runner
    from google.adk.sessions import VertexAiSessionService
    from google.adk.tools import ToolContext
    from google.cloud import secretmanager
    from google.genai import types

    sdk = version("google-adk")
    assert (sdk == "1.31.1") if phase != "upgrade" else sdk.startswith("2."), sdk
    deployment = json.loads(
        subprocess.check_output(
            [
                "gcloud",
                "run",
                "services",
                "describe",
                "aipla-v01-frontend",
                f"--project={PROJECT}",
                "--region=europe-north1",
                "--format=json",
            ],
            text=True,
        )
    )
    sidecar = next(c for c in deployment["spec"]["template"]["spec"]["containers"] if c["name"] == "sidecar")
    env = {e["name"]: e for e in sidecar["env"]}
    location = env["VERTEX_SESSION_LOCATION"]["value"]
    bucket = env["ADK_ARTIFACT_BUCKET"]["value"]
    assert location.startswith("europe-") and bucket.startswith(PROJECT + "-")
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"], quota_project_id=PROJECT
    )
    engine = env["AGENT_ENGINE_ID"].get("value")
    if not engine:
        ref = env["AGENT_ENGINE_ID"]["valueFrom"]["secretKeyRef"]
        assert "/" not in ref["name"], "Expected a secret in the dev project"
        resource = f"projects/{PROJECT}/secrets/{ref['name']}/versions/{ref['key']}"
        engine = (
            secretmanager.SecretManagerServiceClient(credentials=credentials)
            .access_secret_version(request={"name": resource})
            .payload.data.decode()
            .strip()
        )
    vertexai.init(project=PROJECT, location=location, credentials=credentials)
    sessions = VertexAiSessionService(project=PROJECT, location=location, agent_engine_id=engine.split("/")[-1])
    artifacts = GcsArtifactService(bucket_name=bucket)
    if phase == "seed":
        assert not fixture_path.exists(), "Use a fresh fixture file for seed"
        user = "adk-upgrade-gate-" + uuid.uuid4().hex
        session = await sessions.create_session(app_name=APP, user_id=user)
        fixture = {"userId": user, "sessionId": session.id, "phases": []}
    else:
        fixture = json.loads(fixture_path.read_text())
        assert fixture["userId"].startswith("adk-upgrade-gate-")
        assert [p["phase"] for p in fixture["phases"]] == (["seed"] if phase == "upgrade" else ["seed", "upgrade"])
    user, sid = fixture["userId"], fixture["sessionId"]
    saved = await sessions.get_session(app_name=APP, user_id=user, session_id=sid)
    assert saved is not None
    history = " ".join(p.text for e in saved.events if e.content for p in e.content.parts or [] if p.text)
    for previous in fixture["phases"]:
        for tag in previous["tags"]:
            assert f"Completed {tag}" in history, f"Missing history from {tag}"
            art = await artifacts.load_artifact(app_name=APP, user_id=user, session_id=sid, filename=f"{tag}.txt")
            assert artifact_text(art) == f"Synthetic measurement {tag}", f"Missing artifact {tag}"
            assert saved.state[f"trial_{tag}"] == tag

    tags = [f"{phase}{i}" for i in range(3 if phase == "seed" else 1)]

    async def run_trial(tag: str) -> None:
        calls = []

        async def record_trial(tool_context: ToolContext) -> dict:
            """Save the synthetic trial and its artifact."""
            await tool_context.save_artifact(
                filename=f"{tag}.txt", artifact=types.Part.from_text(text=f"Synthetic measurement {tag}")
            )
            tool_context.state[f"trial_{tag}"] = tag
            return {"saved": tag}

        class Model(BaseLlm):
            async def generate_content_async(self, llm_request, stream=False):
                calls.append(1)
                part = (
                    types.Part(function_call=types.FunctionCall(name="record_trial", args={}))
                    if len(calls) == 1
                    else types.Part.from_text(text=f"Completed {tag}")
                )
                yield LlmResponse(content=types.Content(role="model", parts=[part]))

        runner = Runner(
            agent=LlmAgent(name="migration_probe", model=Model(model="stub"), tools=[record_trial]),
            app_name=APP,
            session_service=sessions,
            artifact_service=artifacts,
        )
        events = [
            e
            async for e in runner.run_async(
                user_id=user,
                session_id=sid,
                new_message=types.Content(role="user", parts=[types.Part.from_text(text=f"Record {tag}")]),
            )
        ]
        assert len(calls) == 2 and any(e.get_function_responses() for e in events)
        assert any(
            e.is_final_response() and e.content and any(p.text == f"Completed {tag}" for p in e.content.parts or [])
            for e in events
        )
        art = await artifacts.load_artifact(app_name=APP, user_id=user, session_id=sid, filename=f"{tag}.txt")
        assert artifact_text(art) == f"Synthetic measurement {tag}"

    for tag in tags:
        await run_trial(tag)
    persisted = await sessions.get_session(app_name=APP, user_id=user, session_id=sid)
    assert all(persisted.state[f"trial_{tag}"] == tag for tag in tags)
    fixture["phases"].append({"phase": phase, "adk": sdk, "tags": tags, "events": len(persisted.events)})
    fixture_path.write_text(json.dumps(fixture, indent=2) + "\n")
    fixture_path.chmod(0o600)
    print(
        f"PASS {phase}: ADK {sdk}, {len(persisted.events)} persisted events; prior history/state/artifacts read and {len(tags)} tool turns appended on dev"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["seed", "upgrade", "rollback"])
    parser.add_argument("--fixture", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(run(args.phase, args.fixture))
