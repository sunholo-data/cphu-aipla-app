"""Tests for `aiplatform activity` subcommands (TAA-1 M0.3).

Mocks the HTTP transport via respx so the tests don't need a running
backend. Verifies URL + method + payload/query shape.
"""

from __future__ import annotations

import json

import httpx
import respx
from click.testing import CliRunner

from aiplatform.cli import main

BASE = "http://localhost:1956"


@respx.mock
def test_activity_new_no_workbench_posts_minted() -> None:
    route = respx.post(f"{BASE}/api/activity-configs").mock(
        return_value=httpx.Response(201, json={"activityId": "teacher:abc123", "title": "Energy"}),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        [
            "--env",
            "local",
            "activity",
            "new",
            "--class",
            "C1",
            "--title",
            "Energibevarelse",
            "--goal",
            "Discover energy conservation.",
        ],
    )
    assert result.exit_code == 0, result.output
    assert route.called
    body = json.loads(route.calls.last.request.content)
    # No activityId in the body — the backend mints it.
    assert body == {
        "classId": "C1",
        "title": "Energibevarelse",
        "teachingGoal": "Discover energy conservation.",
        "workbenchType": "none",
    }


@respx.mock
def test_activity_new_accepts_workbench_type() -> None:
    route = respx.post(f"{BASE}/api/activity-configs").mock(
        return_value=httpx.Response(201, json={"activityId": "teacher:x"}),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        [
            "--env",
            "local",
            "activity",
            "new",
            "--class",
            "C1",
            "--title",
            "Lab notes",
            "--goal",
            "g",
            "--type",
            "notebook",
        ],
    )
    assert result.exit_code == 0, result.output
    body = json.loads(route.calls.last.request.content)
    assert body["workbenchType"] == "notebook"


def test_activity_new_rejects_unknown_type() -> None:
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["--env", "local", "activity", "new", "--class", "C1", "--title", "t", "--goal", "g", "--type", "banana"],
    )
    assert result.exit_code != 0  # click.Choice rejects before any HTTP


@respx.mock
def test_activity_list_gets() -> None:
    route = respx.get(f"{BASE}/api/activity-configs").mock(
        return_value=httpx.Response(200, json=[{"activityId": "teacher:abc", "title": "Energy"}]),
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "activity", "list"])
    assert result.exit_code == 0, result.output
    assert route.called


@respx.mock
def test_activity_list_with_class_filter() -> None:
    route = respx.get(f"{BASE}/api/activity-configs").mock(
        return_value=httpx.Response(200, json=[]),
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "activity", "list", "--class", "C1"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert route.calls.last.request.url.params.get("classId") == "C1"
