"""Tests for `aiplatform curriculum` subcommands (1.1.25 M5).

Mocks the HTTP transport via respx so the tests don't need a running backend.
Verifies URL + method + payload/query/multipart shape.
"""

from __future__ import annotations

import json

import httpx
import respx
from click.testing import CliRunner

from aiplatform.cli import main

BASE = "http://localhost:1956"


def _run(args: list[str], tmp_path=None) -> object:
    runner = CliRunner()
    return runner.invoke(main, ["--env", "local", "curriculum", *args])


# --- ingest (multipart) ---


@respx.mock
def test_ingest_uploads_multipart(tmp_path) -> None:
    route = respx.post(f"{BASE}/api/curriculum/ingest").mock(
        return_value=httpx.Response(201, json={"doc": {"docId": "x", "level": "B"}}),
    )
    f = tmp_path / "energi.txt"
    f.write_text("Energibevarelse.")

    result = _run(["ingest", str(f), "--level", "B", "--origin", "uvm.dk", "--topic", "mechanics"])
    assert result.exit_code == 0, result.output
    assert route.called
    req = route.calls.last.request
    assert b"multipart/form-data" in req.headers["content-type"].encode()
    body = req.content
    # Form fields + the file are present in the multipart body.
    assert b'name="title"' in body and b"energi" in body
    assert b'name="level"' in body and b"B" in body
    assert b'name="origin"' in body and b"uvm.dk" in body
    assert b'name="topic"' in body and b"mechanics" in body
    assert b'name="file"' in body


@respx.mock
def test_ingest_shared_sends_flags(tmp_path) -> None:
    route = respx.post(f"{BASE}/api/curriculum/ingest").mock(
        return_value=httpx.Response(201, json={"doc": {}}),
    )
    f = tmp_path / "laereplan.txt"
    f.write_text("A-niveau.")

    result = _run(["ingest", str(f), "--level", "A", "--origin", "uvm.dk", "--shared", "--copyright", "cleared"])
    assert result.exit_code == 0, result.output
    body = route.calls.last.request.content
    assert b'name="shared"' in body and b"true" in body
    assert b'name="copyright_status"' in body and b"cleared" in body


def test_ingest_rejects_bad_level(tmp_path) -> None:
    f = tmp_path / "x.txt"
    f.write_text("x")
    result = _run(["ingest", str(f), "--level", "Z", "--origin", "uvm.dk"])
    assert result.exit_code != 0  # click.Choice rejects before any HTTP


def test_ingest_rejects_missing_file() -> None:
    result = _run(["ingest", "/no/such/file.txt", "--level", "B", "--origin", "uvm.dk"])
    assert result.exit_code != 0  # click.Path(exists=True) guards


# --- list ---


@respx.mock
def test_list_gets_with_filters() -> None:
    route = respx.get(f"{BASE}/api/curriculum").mock(
        return_value=httpx.Response(200, json={"docs": []}),
    )
    result = _run(["list", "--level", "B", "--scope", "mine"])
    assert result.exit_code == 0, result.output
    params = route.calls.last.request.url.params
    assert params.get("level") == "B"
    assert params.get("scope") == "mine"


@respx.mock
def test_list_repeatable_tag_filter() -> None:
    route = respx.get(f"{BASE}/api/curriculum").mock(return_value=httpx.Response(200, json={"docs": []}))
    result = _run(["list", "--tag", "lab", "--tag", "exam"])
    assert result.exit_code == 0, result.output
    assert route.calls.last.request.url.params.get_list("tags") == ["lab", "exam"]


# --- tag (1.1.58 M1) ---


@respx.mock
def test_tag_add_remove_deltas() -> None:
    route = respx.patch(f"{BASE}/api/curriculum/d1").mock(
        return_value=httpx.Response(200, json={"doc": {"docId": "d1", "tags": ["lab"]}}),
    )
    result = _run(["tag", "d1", "--add", "lab", "--remove", "old"])
    assert result.exit_code == 0, result.output
    assert json.loads(route.calls.last.request.content) == {"addTags": ["lab"], "removeTags": ["old"]}


@respx.mock
def test_tag_set_replaces_all() -> None:
    route = respx.patch(f"{BASE}/api/curriculum/d1").mock(
        return_value=httpx.Response(200, json={"doc": {"docId": "d1", "tags": ["lab", "exam"]}}),
    )
    result = _run(["tag", "d1", "--set", "lab", "--set", "exam"])
    assert result.exit_code == 0, result.output
    assert json.loads(route.calls.last.request.content) == {"tags": ["lab", "exam"]}


def test_tag_set_conflicts_with_deltas() -> None:
    result = _run(["tag", "d1", "--set", "lab", "--add", "exam"])
    assert result.exit_code != 0
    assert "not both" in result.output.lower()


def test_tag_requires_an_action() -> None:
    result = _run(["tag", "d1"])
    assert result.exit_code != 0
    assert "--add" in result.output


@respx.mock
def test_facets_lists_tags() -> None:
    route = respx.get(f"{BASE}/api/curriculum/facets").mock(
        return_value=httpx.Response(200, json={"tags": ["exam", "lab"]}),
    )
    result = _run(["facets", "--scope", "mine"])
    assert result.exit_code == 0, result.output
    assert route.calls.last.request.url.params.get("scope") == "mine"
    assert "lab" in result.output


# --- query ---


@respx.mock
def test_query_posts_payload() -> None:
    route = respx.post(f"{BASE}/api/curriculum/query").mock(
        return_value=httpx.Response(200, json={"chunks": ["Energy is conserved."], "scopedDocs": [], "note": None}),
    )
    result = _run(["query", "what is energy conservation", "--level", "B", "--top-k", "3"])
    assert result.exit_code == 0, result.output
    body = json.loads(route.calls.last.request.content)
    assert body == {"query": "what is energy conservation", "topK": 3, "level": "B"}
    assert "Energy is conserved." in result.output


# --- summarize (1.1.52 backfill) ---


@respx.mock
def test_summarize_all() -> None:
    route = respx.post(f"{BASE}/api/curriculum/summarize").mock(
        return_value=httpx.Response(200, json={"updated": ["a"], "skipped": []}),
    )
    result = _run(["summarize", "--all"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert json.loads(route.calls.last.request.content) == {"force": False, "all": True}


@respx.mock
def test_summarize_one_doc_force() -> None:
    route = respx.post(f"{BASE}/api/curriculum/summarize").mock(
        return_value=httpx.Response(200, json={"updated": ["d1"], "skipped": []}),
    )
    result = _run(["summarize", "--doc-id", "d1", "--force"])
    assert result.exit_code == 0, result.output
    assert json.loads(route.calls.last.request.content) == {"force": True, "docId": "d1"}


def test_summarize_requires_a_target() -> None:
    result = _run(["summarize"])
    assert result.exit_code != 0
    assert "give --doc-id" in result.output.lower()
