"""Tests for `aiplatform class` subcommands (1.A M9).

Mocks the HTTP transport via respx so the tests don't need a running
backend. Each subcommand is verified for its URL + method + payload
shape.
"""

from __future__ import annotations

import json

import httpx
import respx
from click.testing import CliRunner

from aiplatform.cli import main

BASE = "http://localhost:1956"


@respx.mock
def test_class_new_posts_name_only() -> None:
    route = respx.post(f"{BASE}/api/classes").mock(
        return_value=httpx.Response(
            201,
            json={"classId": "C1", "name": "9A", "ownerUid": "t1"},
        ),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["--env", "local", "class", "new", "--name", "9A"],
    )
    assert result.exit_code == 0, result.output
    assert route.called
    body = json.loads(route.calls.last.request.content)
    assert body == {"name": "9A"}


@respx.mock
def test_class_new_with_description() -> None:
    route = respx.post(f"{BASE}/api/classes").mock(
        return_value=httpx.Response(201, json={"classId": "C1"}),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        [
            "--env",
            "local",
            "class",
            "new",
            "--name",
            "9A",
            "--description",
            "physics term spring 2026",
        ],
    )
    assert result.exit_code == 0
    body = json.loads(route.calls.last.request.content)
    assert body == {"name": "9A", "description": "physics term spring 2026"}


@respx.mock
def test_class_list_gets_classes() -> None:
    route = respx.get(f"{BASE}/api/classes").mock(
        return_value=httpx.Response(200, json={"classes": [{"classId": "C1"}]}),
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "class", "list"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert "C1" in result.output


@respx.mock
def test_class_get_one() -> None:
    route = respx.get(f"{BASE}/api/classes/C1").mock(
        return_value=httpx.Response(200, json={"classId": "C1", "name": "9A"}),
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "class", "get", "C1"])
    assert result.exit_code == 0
    assert route.called
    assert "9A" in result.output


@respx.mock
def test_class_lessons_add() -> None:
    route = respx.patch(f"{BASE}/api/classes/C1/lessons").mock(
        return_value=httpx.Response(200, json={"classId": "C1", "lessons": ["s1"]}),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["--env", "local", "class", "lessons", "C1", "--add", "s1"],
    )
    assert result.exit_code == 0, result.output
    assert route.called
    body = json.loads(route.calls.last.request.content)
    assert body == {"add": ["s1"]}


@respx.mock
def test_class_lessons_add_multiple() -> None:
    route = respx.patch(f"{BASE}/api/classes/C1/lessons").mock(
        return_value=httpx.Response(200, json={"classId": "C1"}),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["--env", "local", "class", "lessons", "C1", "--add", "s1", "--add", "s2"],
    )
    assert result.exit_code == 0, result.output
    body = json.loads(route.calls.last.request.content)
    assert body == {"add": ["s1", "s2"]}


@respx.mock
def test_class_lessons_remove() -> None:
    route = respx.patch(f"{BASE}/api/classes/C1/lessons").mock(
        return_value=httpx.Response(200, json={"classId": "C1", "lessons": []}),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["--env", "local", "class", "lessons", "C1", "--remove", "s1"],
    )
    assert result.exit_code == 0
    body = json.loads(route.calls.last.request.content)
    assert body == {"remove": ["s1"]}


def test_class_lessons_no_op_errors() -> None:
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["--env", "local", "class", "lessons", "C1"],
    )
    assert result.exit_code != 0
    assert "at least one --add or --remove" in result.output


@respx.mock
def test_class_groups_mint() -> None:
    route = respx.post(f"{BASE}/api/classes/C1/groups").mock(
        return_value=httpx.Response(
            201,
            json={"classId": "C1", "codes": ["bright-fox-12", "soft-otter-33"]},
        ),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        ["--env", "local", "class", "groups", "C1", "--mint", "2"],
    )
    assert result.exit_code == 0, result.output
    body = json.loads(route.calls.last.request.content)
    assert body == {"count": 2}
    assert "bright-fox-12" in result.output


@respx.mock
def test_class_groups_list_via_class_get() -> None:
    """--list reuses GET /api/classes/{id} rather than adding a
    dedicated /groups list endpoint."""
    route = respx.get(f"{BASE}/api/classes/C1").mock(
        return_value=httpx.Response(
            200,
            json={
                "classId": "C1",
                "groupCodes": ["a-b-1", "c-d-2"],
            },
        ),
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "class", "groups", "C1", "--list"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert "a-b-1" in result.output


@respx.mock
def test_class_groups_revoke() -> None:
    route = respx.delete(f"{BASE}/api/classes/C1/groups/bright-fox-12").mock(
        return_value=httpx.Response(
            200,
            json={"revoked": True, "code": "bright-fox-12"},
        ),
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        [
            "--env",
            "local",
            "class",
            "groups",
            "C1",
            "--revoke",
            "bright-fox-12",
        ],
    )
    assert result.exit_code == 0, result.output
    assert route.called


def test_class_groups_multiple_actions_errors() -> None:
    runner = CliRunner()
    result = runner.invoke(
        main,
        [
            "--env",
            "local",
            "class",
            "groups",
            "C1",
            "--list",
            "--mint",
            "1",
        ],
    )
    assert result.exit_code != 0
    assert "exactly one" in result.output


def test_class_groups_no_action_errors() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "class", "groups", "C1"])
    assert result.exit_code != 0


@respx.mock
def test_class_delete() -> None:
    route = respx.delete(f"{BASE}/api/classes/C1").mock(
        return_value=httpx.Response(200, json={"revoked": True, "classId": "C1"}),
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "class", "delete", "C1"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert "revoked" in result.output.lower()
