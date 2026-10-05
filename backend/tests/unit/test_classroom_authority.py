"""1.1.151 F5 — the tutor never grants what is the teacher's to grant.

Seminar 2026-10-05: *"altså må vi tage hjem?"* → *"Ja, lige om lidt"*.
"""

from __future__ import annotations

from adk.classroom_authority import _load_preamble, build_classroom_authority_block


def test_the_preamble_says_the_teacher_decides():
    text = _load_preamble()
    assert "You do not know the class schedule or the teacher's rules." in text
    for topic in ("breaks", "leaving", "deadlines", "grades"):
        assert topic in text
    assert "the teacher decides" in text


def test_the_block_composes_like_the_other_preambles():
    block = build_classroom_authority_block()
    assert block.startswith("\n\n## ")
