"""Teacher turns reach the cost pipeline, without their transcripts (Ring 3).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

Until 2026-08-12 `_emit_new_turns` returned early for any non-anonymous owner,
so EVERY teacher turn was dropped — the co-pilot, analytics-chat and
manage-class, i.e. the most tool-heavy skills in the product, produced no token
telemetry at all. Found the honest way: M took a live co-pilot turn on dev and
asked what it cost, and nothing could answer.

The two properties that must both hold, and which pull in opposite directions:
teacher spend is VISIBLE, and teacher content is NOT LOGGED.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest import mock

import pytest

from adk.callbacks.session import _emit_new_turns

TEACHER_UID = "firebase-teacher-uid"
STUDENT_UID = "anon-bold-kazoo-87-a1b2c3"


def _event(author: str, text: str, inv: str = "inv-1", tokens: tuple[int, int] | None = None) -> SimpleNamespace:
    usage = SimpleNamespace(prompt_token_count=tokens[0], candidates_token_count=tokens[1]) if tokens else None
    return SimpleNamespace(
        author=author,
        invocation_id=inv,
        content=SimpleNamespace(parts=[SimpleNamespace(text=text)]),
        usage_metadata=usage,
    )


def _run(owner_uid: str, group_id: str | None = None, events=None):
    """Drive the emitter and return the emit_chat_turn call kwargs."""
    session = SimpleNamespace(
        events=events
        or [
            _event("user", "how many students finished?"),
            _event("model", "Twelve of eighteen.", tokens=(4200, 130)),
        ]
    )
    ctx = SimpleNamespace(invocation_id="inv-1")
    with (
        mock.patch("observability.chat_log.emit_chat_turn") as emit,
        mock.patch("skills.skill_config.get_skill", return_value=None),
    ):
        _emit_new_turns(session, "sess-1", owner_uid, "manage-class", ctx, group_id=group_id)
    return [c.kwargs for c in emit.call_args_list]


# --- Visible ----------------------------------------------------------------


def test_a_teacher_turn_is_emitted_at_all():
    """The regression this exists for. It used to emit nothing."""
    calls = _run(TEACHER_UID)
    assert calls, "teacher turns must reach the cost pipeline"


def test_a_teacher_turn_is_keyed_on_the_billing_identity():
    """Same key the budget enforcer meters on, so the two systems reconcile
    instead of each seeing half."""
    calls = _run(TEACHER_UID)
    assert all(c["group_id"] == f"teacher:{TEACHER_UID}" for c in calls)


def test_token_counts_survive():
    """The whole point — 'what did that turn cost?' must be answerable."""
    calls = _run(TEACHER_UID)
    tutor = [c for c in calls if c["role"] == "tutor"]
    assert tutor and tutor[0]["token_in"] == 4200
    assert tutor[0]["token_out"] == 130


# --- Not logged -------------------------------------------------------------


def test_a_teachers_transcript_is_NEVER_logged():
    """The ADR-001 line, and not a compromise: the cost question needs model +
    token counts, never the words.

    A teacher's chat can quote a student's work — analytics-chat exists to
    discuss it — so logging teacher content would add a student-PII surface by
    the back door. Which is exactly what the original blanket `return` was
    protecting against, over-broadly.
    """
    calls = _run(TEACHER_UID)
    assert calls
    for c in calls:
        assert c["content"] == "", f"teacher content leaked into the log: {c['content']!r}"


def test_no_teacher_email_or_transcript_anywhere_in_the_payload():
    calls = _run(TEACHER_UID)
    blob = repr(calls)
    assert "how many students finished?" not in blob
    assert "Twelve of eighteen." not in blob


# --- Students are unchanged -------------------------------------------------


def test_student_turns_still_carry_their_transcript():
    """Student content IS the research data — Ring 3 must not have narrowed it."""
    calls = _run(STUDENT_UID)
    assert calls
    assert any("how many students finished?" in c["content"] for c in calls)
    assert all(c["group_id"] == "bold-kazoo-87" for c in calls)


def test_an_explicit_group_id_still_wins():
    calls = _run(STUDENT_UID, group_id="PHYS-7K2N")
    assert all(c["group_id"] == "PHYS-7K2N" for c in calls)
    assert any(c["content"] for c in calls), "students keep their transcript"


# --- Edges ------------------------------------------------------------------


def test_no_owner_uid_emits_nothing():
    """Nothing to attribute the spend to; do not invent a key."""
    assert _run("") == []


def test_emitting_never_raises():
    """Telemetry must not break a turn."""
    session = SimpleNamespace(events=[_event("user", "hi")])
    ctx = SimpleNamespace(invocation_id="inv-1")
    with mock.patch("observability.chat_log.emit_chat_turn", side_effect=RuntimeError("bq down")):
        _emit_new_turns(session, "s", TEACHER_UID, "manage-class", ctx)  # must not raise


def test_teacher_own_spend_reads_the_same_key():
    """The read side. Teacher turns belong to no class, so they appear in
    neither class_spend nor classes_spend — this is the query that sees them."""
    from analytics.cost_queries import teacher_own_spend

    with mock.patch("analytics.cost_queries._safe_spend_rows", return_value=[]) as rows:
        result = teacher_own_spend(TEACHER_UID, "this_month")
    assert rows.call_args.args[0] == [f"teacher:{TEACHER_UID}"]
    assert result["uid"] == TEACHER_UID


@pytest.mark.parametrize("uid", [TEACHER_UID, STUDENT_UID])
def test_the_emitter_is_total_over_owner_shapes(uid):
    """Neither identity shape may crash it."""
    _run(uid)
