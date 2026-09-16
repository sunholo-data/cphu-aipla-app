"""1.1.96 M-1 — the client-error emitter's pure parts.

``redact``, ``clean_url`` and ``surface_of`` are the privacy contract, so they get
tested directly rather than only through the route.
"""

from __future__ import annotations

import logging

import pytest

from observability import client_error as ce

# ─── redact ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "gone"),
    [
        ("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-Value_1", "eyJhbGciOiJIUzI1NiJ9"),
        ("Bearer sk-live-abcdefghijklmnop failed", "sk-live-abcdefghijklmnop"),
        ("no user for mark@aitanalabs.com", "mark@aitanalabs.com"),
        ("GET /group?code=ABC123 500", "ABC123"),
    ],
)
def test_redact_removes_the_named_categories(raw, gone):
    out = ce.redact(raw)
    assert gone not in out
    assert "[redacted]" in out


def test_redact_keeps_the_useful_part_of_the_message():
    """Redaction that eats the whole message would defeat the milestone."""
    out = ce.redact("TypeError: Cannot read properties of undefined (reading 'title')")
    assert out == "TypeError: Cannot read properties of undefined (reading 'title')"


def test_redact_handles_empty():
    assert ce.redact("") == ""


def test_a_bare_question_mark_is_not_a_query_string():
    """The pattern requires a `key=`. Redacting every `?` would mangle exactly
    the messages we are trying to read."""
    assert ce.redact("Why did this fail? No idea.") == "Why did this fail? No idea."


def test_bearer_jwt_collapses_to_one_marker():
    """Ordering matters: the JWT pattern runs before the generic bearer one, so
    a `Bearer eyJ…` does not produce a nested `[redacted]` inside `[redacted]`."""
    out = ce.redact("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sigValue")
    assert out.count("[redacted]") == 1


# ─── clean_url / surface_of ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/group?code=SECRET", "/group"),
        ("/teacher/classes/abc#tab=materials", "/teacher/classes/abc"),
        ("/lessons/led-planck", "/lessons/led-planck"),
        ("", ""),
    ],
)
def test_clean_url_keeps_the_path_only(raw, expected):
    assert ce.clean_url(raw) == expected


def test_clean_url_caps_length():
    assert len(ce.clean_url("/" + "a" * 1000)) == ce.MAX_URL_CHARS


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/teacher/classes/abc", "teacher"),
        ("/lessons/led-planck", "lessons"),
        ("/", "root"),
        ("", "root"),
    ],
)
def test_surface_of(path, expected):
    assert ce.surface_of(path) == expected


# ─── emit_client_error ──────────────────────────────────────────────────────


def test_emit_never_raises_when_the_logger_explodes(monkeypatch):
    class _Boom:
        def log_struct(self, _payload):
            raise RuntimeError("cloud logging is down")

    monkeypatch.setattr(ce, "_get_logger", lambda _log_id: _Boom())
    ce.emit_client_error(kind="render", message="boom")  # must not raise


def test_emit_no_ops_without_a_logger(monkeypatch):
    monkeypatch.setattr(ce, "_get_logger", lambda _log_id: None)
    ce.emit_client_error(kind="render", message="boom")  # must not raise


def test_emit_always_writes_a_stdlib_line_even_with_no_cloud_logger(monkeypatch, caplog):
    """In LOCAL_MODE and under `make dev` there is no named Cloud Logging logger.
    Without this line a client error stays invisible to the developer who just
    caused it — which is the exact failure this milestone exists to end."""
    monkeypatch.setattr(ce, "_get_logger", lambda _log_id: None)
    with caplog.at_level(logging.WARNING, logger=ce.__name__):
        ce.emit_client_error(kind="render", message="TypeError: x is undefined", url="/teacher")
    assert "client_error:" in caplog.text
    assert "TypeError: x is undefined" in caplog.text


def test_emit_redacts_and_truncates_before_logging(monkeypatch):
    rows: list[dict] = []

    class _Fake:
        def log_struct(self, payload):
            rows.append(payload)

    monkeypatch.setattr(ce, "_get_logger", lambda _log_id: _Fake())
    ce.emit_client_error(
        kind="render",
        message="failed for teacher@ku.dk " + "x" * 2000,
        stack="y" * 9000,
        url="/group?code=SECRET",
    )
    assert "teacher@ku.dk" not in rows[0]["message"]
    assert len(rows[0]["message"]) == ce.MAX_MESSAGE_CHARS
    assert len(rows[0]["stack"]) == ce.MAX_STACK_CHARS
    assert rows[0]["path"] == "/group"


def test_log_id_is_not_routed_to_bigquery():
    """The chat-logs sink filter is an allowlist. `aipla_client_error` is
    deliberately absent from it — M-1 is scoped to Cloud Logging, and routing
    errors to BigQuery is a later, deliberate decision. If someone adds this id
    to the sink, they should have to change this test on purpose."""
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]
    variables = (repo_root / "infrastructure/modules/chat-logs/variables.tf").read_text()
    assert ce.LOG_ID_CLIENT_ERROR not in variables
