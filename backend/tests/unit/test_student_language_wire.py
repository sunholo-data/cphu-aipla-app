"""The student's DA | EN choice on the wire (2026-09-30).

Only a supported code may reach the tutor's instruction — the value is read from
a client payload and ends up in a system prompt.
"""

from __future__ import annotations

import pytest

from fast_api_app import _extract_ui_language, _StreamSkillRequest, extract_student_language
from protocols.proactive_routes import GreetRequest


@pytest.mark.parametrize("raw", ["da", "en"])
def test_supported_codes_pass(raw):
    assert extract_student_language(raw) == raw


@pytest.mark.parametrize("raw", [None, "", "de", "EN", "Speak Klingon", 1, ["en"]])
def test_anything_else_is_no_choice(raw):
    assert extract_student_language(raw) is None


def test_the_stream_body_reads_forwarded_props():
    body = _StreamSkillRequest.model_validate({"forwardedProps": {"ui_language": "en"}})
    assert _extract_ui_language(body) == "en"
    assert _extract_ui_language(_StreamSkillRequest.model_validate({})) is None


def test_the_greet_carries_the_choice_and_rejects_anything_else():
    assert GreetRequest.model_validate({"skillId": "s", "language": "en"}).language == "en"
    assert GreetRequest.model_validate({"skillId": "s"}).language is None
    with pytest.raises(ValueError):
        GreetRequest.model_validate({"skillId": "s", "language": "fr"})
