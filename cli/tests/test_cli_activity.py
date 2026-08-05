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


# --- activity library / file (1.1.61 facets) ---


@respx.mock
def test_activity_library_sends_facet_filters_to_the_new_resource() -> None:
    route = respx.get(f"{BASE}/api/activities").mock(
        return_value=httpx.Response(200, json={"activities": [], "total": 0, "limit": 50, "offset": 0}),
    )
    result = CliRunner().invoke(
        main,
        [
            "--env",
            "local",
            "activity",
            "library",
            "--subject",
            "Fysik",
            "--level",
            "B",
            "--tag",
            "lab",
            "--tag",
            "eksamen",
            "-q",
            "bold",
        ],
    )
    assert result.exit_code == 0, result.output
    q = route.calls.last.request.url.params
    assert q["subject"] == "Fysik"
    assert q["level"] == "B"
    assert q["q"] == "bold"
    assert q.get_list("tags") == ["lab", "eksamen"]  # repeatable → AND facet
    assert q["owner"] == "me"


@respx.mock
def test_activity_library_published_targets_the_shared_catalogue() -> None:
    route = respx.get(f"{BASE}/api/activities").mock(
        return_value=httpx.Response(200, json={"activities": [], "total": 0, "limit": 50, "offset": 0}),
    )
    result = CliRunner().invoke(main, ["--env", "local", "activity", "library", "--published"])
    assert result.exit_code == 0, result.output
    q = route.calls.last.request.url.params
    assert q["published"] == "true"
    assert "owner" not in q


@respx.mock
def test_activity_library_facets_flag_hits_the_facets_route() -> None:
    route = respx.get(f"{BASE}/api/activities/facets").mock(
        return_value=httpx.Response(200, json={"subjects": [], "levels": [], "tags": []}),
    )
    result = CliRunner().invoke(main, ["--env", "local", "activity", "library", "--facets"])
    assert result.exit_code == 0, result.output
    assert route.called
    # Paging is meaningless for a facet summary and must not be sent.
    assert "limit" not in route.calls.last.request.url.params


@respx.mock
def test_activity_file_uses_the_facets_only_patch() -> None:
    route = respx.patch(f"{BASE}/api/activities/act-1/facets").mock(
        return_value=httpx.Response(200, json={"activityId": "act-1"}),
    )
    result = CliRunner().invoke(
        main,
        ["--env", "local", "activity", "file", "act-1", "--subject", "Fysik", "--tag", "lab", "--untag", "gammel"],
    )
    assert result.exit_code == 0, result.output
    body = json.loads(route.calls.last.request.content)
    assert body == {"subject": "Fysik", "addTags": ["lab"], "removeTags": ["gammel"]}


@respx.mock
def test_activity_file_empty_string_clears_explicitly() -> None:
    route = respx.patch(f"{BASE}/api/activities/act-1/facets").mock(
        return_value=httpx.Response(200, json={"activityId": "act-1"}),
    )
    result = CliRunner().invoke(main, ["--env", "local", "activity", "file", "act-1", "--subject", "", "--level", ""])
    assert result.exit_code == 0, result.output
    body = json.loads(route.calls.last.request.content)
    # JSON null cannot distinguish "clear it" from "not sent" — hence the flags.
    assert body == {"subject": None, "clearSubject": True, "level": None, "clearLevel": True}


def test_activity_file_with_no_options_is_a_usage_error() -> None:
    result = CliRunner().invoke(main, ["--env", "local", "activity", "file", "act-1"])
    assert result.exit_code != 0
    assert "give --subject" in result.output
