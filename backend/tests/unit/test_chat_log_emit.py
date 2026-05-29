"""Unit tests for the chat-log structured emitters (SEQUENCE 1.2, M1).

Contract: emit_chat_turn / emit_workbench_event write Cloud Logging
structured entries whose jsonPayload keys EXACTLY match the BigQuery views
(infrastructure/modules/chat-logs/views.tf). Keyed only by anonymous
group_id (ADR-001). Never raise into the caller.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from observability import chat_log

TURN_KW = {
    "group_id": "bold-kazoo-87",
    "session_id": "sess-1",
    "skill_id": "boldkast",
    "turn_index": 0,
    "role": "student",
    "content": "why does it go further at 45 degrees?",
}

WB_KW = {
    "group_id": "bold-kazoo-87",
    "session_id": "sess-1",
    "skill_id": "boldkast",
    "server": "boldkast",
    "tool": "sim",
    "field": "v0",
    "value": "17.5",
}

# Keys the BigQuery views select from jsonPayload — the emitter must produce
# exactly these (no more, no fewer) so the flattened views line up.
CHAT_TURN_KEYS = {
    "group_id",
    "session_id",
    "skill_id",
    "turn_index",
    "role",
    "content",
    "model",
    "token_in",
    "token_out",
    "latency_ms",
    "teacher_focus",
}
WB_EVENT_KEYS = {"group_id", "session_id", "skill_id", "server", "tool", "field", "value"}

# Anything resembling student PII must never appear (ADR-001).
FORBIDDEN_KEYS = {"email", "name", "student_name", "uid", "owner_uid", "user_id", "ip", "student"}


def test_emit_chat_turn_payload_shape():
    gl = MagicMock()
    with patch.object(chat_log, "_get_logger", return_value=gl):
        chat_log.emit_chat_turn(
            **TURN_KW,
            model="gemini-2.5-flash",
            token_in=12,
            token_out=40,
            latency_ms=620,
            teacher_focus="emphasise range vs angle",
        )
    gl.log_struct.assert_called_once()
    payload = gl.log_struct.call_args.args[0]
    assert set(payload.keys()) == CHAT_TURN_KEYS
    assert payload["group_id"] == "bold-kazoo-87"
    assert payload["role"] == "student"
    assert payload["turn_index"] == 0


def test_emit_chat_turn_uses_correct_log_id():
    captured = {}

    def fake_get_logger(log_id):
        captured["log_id"] = log_id
        return MagicMock()

    with patch.object(chat_log, "_get_logger", side_effect=fake_get_logger):
        chat_log.emit_chat_turn(**TURN_KW)
    assert captured["log_id"] == chat_log.LOG_ID_CHAT_TURN == "aipla_chat_turn"


def test_emit_chat_turn_no_pii():
    gl = MagicMock()
    with patch.object(chat_log, "_get_logger", return_value=gl):
        chat_log.emit_chat_turn(**TURN_KW)
    payload = gl.log_struct.call_args.args[0]
    assert not (set(payload.keys()) & FORBIDDEN_KEYS)
    assert "group_id" in payload


def test_emit_chat_turn_never_raises_on_client_error():
    gl = MagicMock()
    gl.log_struct.side_effect = RuntimeError("BigQuery sink unreachable")
    with patch.object(chat_log, "_get_logger", return_value=gl):
        # Must not propagate.
        chat_log.emit_chat_turn(**TURN_KW)


def test_emit_chat_turn_noop_when_no_logger():
    with patch.object(chat_log, "_get_logger", return_value=None):
        # No logger (LOCAL_MODE / no creds) — silent no-op, no raise.
        chat_log.emit_chat_turn(**TURN_KW)


def test_get_logger_none_in_local_mode():
    chat_log._clients.clear()
    with patch.object(chat_log, "is_local_mode", return_value=True):
        assert chat_log._get_logger(chat_log.LOG_ID_CHAT_TURN) is None


def test_emit_workbench_event_payload_shape():
    gl = MagicMock()
    with patch.object(chat_log, "_get_logger", return_value=gl):
        chat_log.emit_workbench_event(**WB_KW)
    gl.log_struct.assert_called_once()
    payload = gl.log_struct.call_args.args[0]
    assert set(payload.keys()) == WB_EVENT_KEYS
    assert payload["server"] == "boldkast"
    assert payload["value"] == "17.5"


def test_emit_workbench_event_uses_correct_log_id():
    captured = {}
    with patch.object(chat_log, "_get_logger", side_effect=lambda lid: captured.update(log_id=lid) or MagicMock()):
        chat_log.emit_workbench_event(**WB_KW)
    assert captured["log_id"] == chat_log.LOG_ID_WORKBENCH_EVENT == "aipla_workbench_event"


def test_emit_workbench_event_stringifies_complex_value():
    gl = MagicMock()
    with patch.object(chat_log, "_get_logger", return_value=gl):
        chat_log.emit_workbench_event(**{**WB_KW, "value": {"x": 1, "y": 2}})
    payload = gl.log_struct.call_args.args[0]
    # value column is STRING in the view — complex values must be serialised.
    assert isinstance(payload["value"], str)


def test_emit_workbench_event_never_raises_on_client_error():
    gl = MagicMock()
    gl.log_struct.side_effect = RuntimeError("down")
    with patch.object(chat_log, "_get_logger", return_value=gl):
        chat_log.emit_workbench_event(**WB_KW)
