"""Unit tests for adk.proactive_telemetry — OTel span tagging for
proactive turns (sprint PROACTIVE-SIM-REACTIVE M7).

Asserts the two sentinel forms get the right span attributes set:
  - [session_start] → tutor.proactive_kind = "greet"
  - [event_reactive:<kind>] → tutor.proactive_kind = "event_reactive"
    + tutor.triggering_event_kind = "<kind>"

Non-sentinel content (regular student turns) must NOT set any of the
proactive attributes — analytics-chat depends on this to filter
proactive from user-driven turns without parsing message content.

Telemetry must never raise, so the tests also confirm that broken
callback contexts and edge-case content shapes are silently no-op'd.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from adk.proactive_telemetry import (
    tag_proactive_span_from_callback_context,
    tag_proactive_span_from_content,
)

# --- helpers ---


class _FakeSpan:
    """Records set_attribute calls so tests can assert against them."""

    def __init__(self):
        self.attributes: dict[str, object] = {}

    def set_attribute(self, key: str, value: object) -> None:
        self.attributes[key] = value


def _patch_current_span(span):
    """Patch opentelemetry.trace.get_current_span to return the supplied
    span object. Tests use this to capture set_attribute calls."""
    return patch("adk.proactive_telemetry.trace.get_current_span", return_value=span)


# --- tag_proactive_span_from_content ---


def test_greet_sentinel_tags_proactive_kind_greet():
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_content("[session_start]")
    assert span.attributes == {"tutor.proactive_kind": "greet"}


def test_event_reactive_sentinel_tags_proactive_kind_and_event_kind():
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_content("[event_reactive:sim_run]")
    assert span.attributes == {
        "tutor.proactive_kind": "event_reactive",
        "tutor.triggering_event_kind": "sim_run",
    }


@pytest.mark.parametrize(
    "event_kind",
    ["step_advance", "measurement_commit", "sim_run"],
)
def test_event_reactive_tags_each_allowlist_kind(event_kind):
    """All three meaningful event kinds get their kind tagged so
    analytics-chat can filter by kind, not just by proactive vs not."""
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_content(f"[event_reactive:{event_kind}]")
    assert span.attributes["tutor.triggering_event_kind"] == event_kind
    assert span.attributes["tutor.proactive_kind"] == "event_reactive"


def test_regular_student_turn_does_not_tag_span():
    """Without this, every student turn would get tagged as proactive
    (or worse, the analytics-chat filter would lose its discriminator)."""
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_content("What's the launch angle for max range?")
    assert span.attributes == {}


def test_empty_content_is_a_noop():
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_content("")
        tag_proactive_span_from_content(None)
        tag_proactive_span_from_content("   \n  ")
    assert span.attributes == {}


def test_malformed_event_reactive_is_a_noop():
    """Defensive: malformed sentinels (uppercase, unknown chars,
    whitespace inside brackets) should NOT trigger event_reactive
    tagging. Belt-and-braces against accidental sentinel-shaped content
    in real student messages."""
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_content("[event_reactive:Sim_Run]")  # uppercase
        tag_proactive_span_from_content("[event_reactive: sim_run]")  # space
        tag_proactive_span_from_content("[event_reactive:sim-run]")  # hyphen
        tag_proactive_span_from_content("event_reactive:sim_run")  # no brackets
    assert span.attributes == {}


def test_sentinel_with_surrounding_whitespace_is_recognised():
    """Sentinels with leading / trailing whitespace match — the producer
    side may add a trailing newline; sentinel detection should be
    robust to that."""
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_content("  [session_start]  \n")
    assert span.attributes == {"tutor.proactive_kind": "greet"}


# --- tag_proactive_span_from_callback_context ---


def _fake_callback_context_with_text(text: str | None) -> MagicMock:
    """Build a CallbackContext-shaped MagicMock whose user_content has a
    single text part. Mirrors what ADK's Context.user_content exposes."""
    ctx = MagicMock()
    if text is None:
        ctx.user_content = None
    else:
        part = MagicMock()
        part.text = text
        ctx.user_content.parts = [part]
    return ctx


def test_callback_context_with_greet_sentinel_tags_span():
    ctx = _fake_callback_context_with_text("[session_start]")
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_callback_context(ctx)
    assert span.attributes == {"tutor.proactive_kind": "greet"}


def test_callback_context_with_event_reactive_sentinel_tags_span():
    ctx = _fake_callback_context_with_text("[event_reactive:measurement_commit]")
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_callback_context(ctx)
    assert span.attributes == {
        "tutor.proactive_kind": "event_reactive",
        "tutor.triggering_event_kind": "measurement_commit",
    }


def test_callback_context_with_no_user_content_is_a_noop():
    ctx = _fake_callback_context_with_text(None)
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_callback_context(ctx)
    assert span.attributes == {}


def test_callback_context_with_normal_student_turn_does_not_tag():
    ctx = _fake_callback_context_with_text("Hej! Hvad er rækkevidden ved 45 grader?")
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_callback_context(ctx)
    assert span.attributes == {}


def test_callback_context_with_broken_shape_does_not_raise():
    """Defensive: a callback_context whose attributes raise should NOT
    bubble out — telemetry must not break the turn."""
    ctx = MagicMock()
    # Make accessing user_content raise.
    type(ctx).user_content = property(lambda self: (_ for _ in ()).throw(RuntimeError("broken")))
    span = _FakeSpan()
    with _patch_current_span(span):
        # Should NOT raise.
        tag_proactive_span_from_callback_context(ctx)
    assert span.attributes == {}


def test_callback_context_with_multipart_text_concatenates_before_match():
    """User content may have multiple parts (rare for proactive
    triggers but possible). The helper concatenates them with spaces
    before sentinel matching. A trigger split across parts won't match;
    a trigger in a single part with other parts surrounding will also
    not match (defensive — bracketed sentinel must be the only content)."""
    ctx = MagicMock()
    part_a = MagicMock()
    part_a.text = "[session_start]"
    part_b = MagicMock()
    part_b.text = "extra noise"
    ctx.user_content.parts = [part_a, part_b]
    span = _FakeSpan()
    with _patch_current_span(span):
        tag_proactive_span_from_callback_context(ctx)
    # Concatenated content "[session_start] extra noise" doesn't match
    # the strict greet-only equality, so this is correctly a no-op.
    assert span.attributes == {}
