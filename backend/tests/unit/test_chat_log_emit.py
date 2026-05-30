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


# --- group_code_from_owner_uid (M2) ---


def test_group_code_from_owner_uid():
    f = chat_log.group_code_from_owner_uid
    assert f("anon-bold-kazoo-87-ab12cd") == "bold-kazoo-87"
    assert f("anon-grp1-deadbeef") == "grp1"
    assert f("workshop-user") is None
    assert f("some-firebase-uid") is None  # doesn't start with anon-
    assert f("") is None
    assert f(None) is None
    assert f("anon-") is None  # malformed: no trailing hex segment


# --- after-agent chat-turn emission (M2) ---


class _FakePart:
    def __init__(self, text):
        self.text = text


class _FakeContent:
    def __init__(self, parts):
        self.parts = parts


class _FakeEvent:
    def __init__(self, author, text, invocation_id="inv-1"):
        self.author = author
        self.content = _FakeContent([_FakePart(text)]) if text is not None else None
        self.usage_metadata = None
        self.invocation_id = invocation_id


class _FakeSession:
    def __init__(self, events, id="sess-1"):
        self.events = events
        self.id = id


class _FakeCtx:
    def __init__(self, session, state, invocation_id=None):
        self.session = session
        self.state = state
        # CallbackContext.invocation_id may not exist on older ADK versions;
        # leave unset to exercise the events[-1] fallback when None.
        if invocation_id is not None:
            self.invocation_id = invocation_id


def test_after_agent_emits_only_current_invocation_events():
    """Filter by invocation_id — robust to event compaction (the original cursor bug)."""
    from adk.callbacks import make_after_agent_response

    # Mixed invocations in session.events: prior turns + this turn. Only THIS
    # invocation's events must emit (compaction/prior turns aren't re-emitted).
    events = [
        _FakeEvent("user", "old user msg", invocation_id="inv-prior"),
        _FakeEvent("model", "old reply", invocation_id="inv-prior"),
        _FakeEvent("user", "hello", invocation_id="inv-current"),
        _FakeEvent("model", "hi there", invocation_id="inv-current"),
    ]
    ctx = _FakeCtx(_FakeSession(events), {}, invocation_id="inv-current")
    mock_emit = MagicMock()
    with patch.object(chat_log, "emit_chat_turn", mock_emit):
        make_after_agent_response("anon-bold-kazoo-87-ab12", "boldkast")(ctx)
    assert mock_emit.call_count == 2
    assert [c.kwargs["role"] for c in mock_emit.call_args_list] == ["student", "tutor"]
    # turn_index is the event index in session.events (NOT a per-turn counter).
    assert [c.kwargs["turn_index"] for c in mock_emit.call_args_list] == [2, 3]


def test_after_agent_falls_back_to_latest_event_invocation_id():
    """When CallbackContext has no invocation_id, use the latest event's."""
    from adk.callbacks import make_after_agent_response

    events = [
        _FakeEvent("user", "older", invocation_id="inv-prior"),
        _FakeEvent("user", "hello", invocation_id="inv-cur"),
        _FakeEvent("model", "hi", invocation_id="inv-cur"),
    ]
    ctx = _FakeCtx(_FakeSession(events), {})  # no invocation_id on ctx -> fallback
    mock_emit = MagicMock()
    with patch.object(chat_log, "emit_chat_turn", mock_emit):
        make_after_agent_response("anon-bold-kazoo-87-ab12", "boldkast")(ctx)
    assert mock_emit.call_count == 2
    assert [c.kwargs["turn_index"] for c in mock_emit.call_args_list] == [1, 2]


def test_after_agent_skips_non_anon_owner():
    from adk.callbacks import make_after_agent_response

    ctx = _FakeCtx(_FakeSession([_FakeEvent("user", "hello")]), {})
    mock_emit = MagicMock()
    with patch.object(chat_log, "emit_chat_turn", mock_emit):
        make_after_agent_response("workshop-user", "boldkast")(ctx)
    assert mock_emit.call_count == 0


def test_after_agent_no_chatlog_without_owner_skill():
    from adk.callbacks import make_after_agent_response

    ctx = _FakeCtx(_FakeSession([_FakeEvent("user", "hello")]), {})
    mock_emit = MagicMock()
    with patch.object(chat_log, "emit_chat_turn", mock_emit):
        make_after_agent_response()(ctx)  # back-compat: no args -> no chat-logging
    assert mock_emit.call_count == 0


def test_after_agent_skips_state_delta_only_events():
    from adk.callbacks import make_after_agent_response

    # Second event has no content (e.g. an iframe-context state-delta event).
    events = [_FakeEvent("user", "real question"), _FakeEvent("user", None)]
    ctx = _FakeCtx(_FakeSession(events), {})
    mock_emit = MagicMock()
    with patch.object(chat_log, "emit_chat_turn", mock_emit):
        make_after_agent_response("anon-grp-1-xx", "boldkast")(ctx)
    assert mock_emit.call_count == 1  # only the text event emitted


def test_after_agent_prefers_real_group_id():
    from adk.callbacks import make_after_agent_response

    # owner_uid is the hyphen-stripped synthetic uid; the real display code
    # (user.group_id) is passed and MUST win so BQ keys by 'aipla-demo-1'.
    ctx = _FakeCtx(_FakeSession([_FakeEvent("user", "hi")]), {})
    mock_emit = MagicMock()
    with patch.object(chat_log, "emit_chat_turn", mock_emit):
        make_after_agent_response("anon-aiplademo1-abc", "boldkast", "aipla-demo-1")(ctx)
    assert mock_emit.call_args.kwargs["group_id"] == "aipla-demo-1"


def test_after_agent_falls_back_to_derived_group_when_no_real():
    from adk.callbacks import make_after_agent_response

    ctx = _FakeCtx(_FakeSession([_FakeEvent("user", "hi")]), {})
    mock_emit = MagicMock()
    with patch.object(chat_log, "emit_chat_turn", mock_emit):
        make_after_agent_response("anon-aiplademo1-abc", "boldkast")(ctx)  # no real group_id
    # Derived (cleaned) form — still emits, just hyphen-stripped.
    assert mock_emit.call_args.kwargs["group_id"] == "aiplademo1"
