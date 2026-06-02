"""Unit tests for ``aiplatform insights`` (sprint
ANALYTICS-CHAT-AND-INSIGHTS, M8).

Mocks the backend with respx. Three subcommands:

- ``insights class`` — table + ``--format json``
- ``insights groups`` — table with per-group rows
- ``insights compare`` — cross-class table; client-side sort honors
  the ``--sort`` flag
"""

from __future__ import annotations

import json

import httpx
import respx
from click.testing import CliRunner

from aiplatform.cli import main

BASE = "http://localhost:1956"


def _kpi_payload(class_id: str = "c1") -> dict:
    return {
        "class_id": class_id,
        "since": "2026-05-26T00:00:00+00:00",
        "until": "2026-06-02T00:00:00+00:00",
        "kpis": {
            "active_groups": 3,
            "total_messages": 142,
            "active_activities": 2,
            "sim_runs": 7,
            "median_time_on_task_min": 18,
            "last_activity": "2026-06-02T11:30:00+00:00",
        },
        "_debug": {"queries": []},
    }


# ---------------------------------------------------------------------------
# insights class
# ---------------------------------------------------------------------------


@respx.mock
def test_class_prints_table() -> None:
    respx.get(f"{BASE}/api/insights/classes/cls-1/kpis").mock(
        return_value=httpx.Response(200, json=_kpi_payload("cls-1"))
    )

    result = CliRunner().invoke(main, ["--env", "local", "insights", "class", "cls-1"])
    assert result.exit_code == 0, result.output
    assert "cls-1" in result.output
    assert "active_groups" in result.output
    assert "142" in result.output  # total_messages


@respx.mock
def test_class_json_flag() -> None:
    payload = _kpi_payload("cls-1")
    respx.get(f"{BASE}/api/insights/classes/cls-1/kpis").mock(return_value=httpx.Response(200, json=payload))

    result = CliRunner().invoke(main, ["--env", "local", "insights", "class", "cls-1", "--format", "json"])
    assert result.exit_code == 0
    assert json.loads(result.output) == payload


@respx.mock
def test_class_forwards_since_and_until() -> None:
    route = respx.get(f"{BASE}/api/insights/classes/cls-1/kpis").mock(
        return_value=httpx.Response(200, json=_kpi_payload())
    )

    result = CliRunner().invoke(
        main,
        [
            "--env",
            "local",
            "insights",
            "class",
            "cls-1",
            "--since",
            "30d",
            "--until",
            "2026-06-02T00:00:00Z",
        ],
    )
    assert result.exit_code == 0, result.output
    sent = route.calls.last.request
    assert sent.url.params["since"] == "30d"
    assert sent.url.params["until"] == "2026-06-02T00:00:00Z"


# ---------------------------------------------------------------------------
# insights groups
# ---------------------------------------------------------------------------


@respx.mock
def test_groups_prints_table() -> None:
    respx.get(f"{BASE}/api/insights/classes/cls-1/groups").mock(
        return_value=httpx.Response(
            200,
            json={
                "class_id": "cls-1",
                "groups": [
                    {"group_code": "bold-kazoo-87", "message_count": 60, "session_count": 4},
                    {"group_code": "neon-eel-12", "message_count": 21, "session_count": 2},
                ],
                "_debug": {"queries": []},
            },
        )
    )

    result = CliRunner().invoke(main, ["--env", "local", "insights", "groups", "cls-1"])
    assert result.exit_code == 0, result.output
    assert "bold-kazoo-87" in result.output
    assert "60" in result.output
    assert "neon-eel-12" in result.output


@respx.mock
def test_groups_empty_window() -> None:
    respx.get(f"{BASE}/api/insights/classes/cls-1/groups").mock(
        return_value=httpx.Response(200, json={"class_id": "cls-1", "groups": [], "_debug": {"queries": []}})
    )

    result = CliRunner().invoke(main, ["--env", "local", "insights", "groups", "cls-1"])
    assert result.exit_code == 0
    assert "No group activity" in result.output


# ---------------------------------------------------------------------------
# insights compare
# ---------------------------------------------------------------------------


@respx.mock
def test_compare_prints_sortable_table() -> None:
    respx.get(f"{BASE}/api/insights/compare").mock(
        return_value=httpx.Response(
            200,
            json={
                "rows": [
                    {
                        "class_id": "c1",
                        "name": "9A",
                        "active_groups": 3,
                        "messages": 100,
                        "messages_prior": 80,
                        "messages_delta": 20,
                        "sim_runs": 7,
                        "last_activity": "2026-06-02T10:00:00+00:00",
                    },
                    {
                        "class_id": "c2",
                        "name": "9B",
                        "active_groups": 2,
                        "messages": 200,
                        "messages_prior": 150,
                        "messages_delta": 50,
                        "sim_runs": 3,
                        "last_activity": "2026-06-02T11:00:00+00:00",
                    },
                ],
                "_debug": {"per_class": []},
            },
        )
    )

    result = CliRunner().invoke(main, ["--env", "local", "insights", "compare", "--sort", "messages"])
    assert result.exit_code == 0, result.output
    # Sorted by messages desc -> 9B (200) listed before 9A (100).
    nine_b = result.output.find("9B")
    nine_a = result.output.find("9A")
    assert 0 <= nine_b < nine_a


@respx.mock
def test_compare_sort_by_name_ascending() -> None:
    respx.get(f"{BASE}/api/insights/compare").mock(
        return_value=httpx.Response(
            200,
            json={
                "rows": [
                    {
                        "class_id": "c2",
                        "name": "Zoology 9B",
                        "active_groups": 2,
                        "messages": 200,
                        "messages_prior": 150,
                        "messages_delta": 50,
                        "sim_runs": 3,
                        "last_activity": "x",
                    },
                    {
                        "class_id": "c1",
                        "name": "Astrophysics 9A",
                        "active_groups": 3,
                        "messages": 100,
                        "messages_prior": 80,
                        "messages_delta": 20,
                        "sim_runs": 7,
                        "last_activity": "y",
                    },
                ],
                "_debug": {"per_class": []},
            },
        )
    )

    result = CliRunner().invoke(main, ["--env", "local", "insights", "compare", "--sort", "name"])
    assert result.exit_code == 0
    astro = result.output.find("Astrophysics")
    zoo = result.output.find("Zoology")
    assert 0 <= astro < zoo


@respx.mock
def test_compare_empty_state() -> None:
    respx.get(f"{BASE}/api/insights/compare").mock(
        return_value=httpx.Response(200, json={"rows": [], "_debug": {"per_class": []}})
    )

    result = CliRunner().invoke(main, ["--env", "local", "insights", "compare"])
    assert result.exit_code == 0
    assert "No classes to compare" in result.output
