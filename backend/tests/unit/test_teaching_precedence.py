"""1.1.141 M1 + M3 — the precedence block and the tutor-notes block, as units.

Headline (handover rule 1): NO framework ⇒ the precedence block is absent and
the composition is byte-identical to the plain approach injector.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from adk.teaching_precedence import (
    TEACHING_PRECEDENCE_BLOCK,
    TEACHING_PRECEDENCE_TEXT,
    TUTOR_NOTES_CAP,
    build_tutor_notes_block,
    inject_framework_preamble_with_precedence,
)
from adk.tutor_framework import inject_framework_preamble
from db import firestore as fs_module
from db.framework_overrides import resolve_framework_instruction
from db.models.activity_config import ActivityConfig

BASE = "You are a physics tutor."


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _cfg(framework_id=None, tutor_notes=""):
    return ActivityConfig(
        activityId="act-1",
        classId="c-1",
        teacherUid="t-1",
        frameworkId=framework_id,
        tutorNotes=tutor_notes,
        updatedAt=datetime.now(UTC),
    )


def _patch_config(monkeypatch, cfg):
    monkeypatch.setattr("adk.teacher_focus.resolve_active_config", lambda *a, **k: cfg)


def test_no_framework_is_byte_identical_and_carries_no_block(monkeypatch):
    _patch_config(monkeypatch, _cfg(None))
    out = inject_framework_preamble_with_precedence(BASE, "act-1")
    assert out == BASE
    assert out == inject_framework_preamble(BASE, "act-1")
    assert TEACHING_PRECEDENCE_TEXT not in out


def test_no_config_at_all_is_byte_identical(monkeypatch):
    _patch_config(monkeypatch, None)
    assert inject_framework_preamble_with_precedence(BASE, "act-1") == BASE


def test_framework_with_an_empty_instruction_carries_no_block(monkeypatch):
    """A block that says "the approach above" must never appear with no approach above."""
    _patch_config(monkeypatch, _cfg("esru"))
    monkeypatch.setattr("db.framework_overrides.resolve_framework_instruction", lambda _fid: "")
    assert inject_framework_preamble_with_precedence(BASE, "act-1") == BASE


def test_framework_present_block_follows_the_preamble_immediately(monkeypatch):
    _patch_config(monkeypatch, _cfg("esru"))
    preamble = resolve_framework_instruction("esru")
    assert preamble
    out = inject_framework_preamble_with_precedence(BASE, "act-1")
    assert out == f"{BASE}\n\n{preamble}{TEACHING_PRECEDENCE_BLOCK}"
    assert out.index(preamble) < out.index(TEACHING_PRECEDENCE_TEXT)
    assert out.endswith(TEACHING_PRECEDENCE_TEXT)


def test_precedence_prose_is_language_neutral():
    """Content-localisation rule: the block never bakes a language in."""
    for word in ("Danish", "English", "dansk", "engelsk"):
        assert word not in TEACHING_PRECEDENCE_BLOCK
    assert "follow the approach" in TEACHING_PRECEDENCE_TEXT
    assert "keep the activity's learning goals" in TEACHING_PRECEDENCE_TEXT


# ── M3: tutor notes reach the tutor only without an approach ─────────────────


def test_tutor_notes_absent_when_empty():
    assert build_tutor_notes_block(_cfg(), None) == ""
    assert build_tutor_notes_block(None, None) == ""


def test_tutor_notes_absent_when_an_approach_teaches():
    assert build_tutor_notes_block(_cfg(tutor_notes="Be very encouraging."), "esru") == ""


def test_tutor_notes_present_without_an_approach():
    block = build_tutor_notes_block(_cfg(tutor_notes="Be very encouraging."), None)
    assert "Be very encouraging." in block
    assert block.startswith("\n\n## The teacher's notes")


def test_tutor_notes_are_bounded():
    block = build_tutor_notes_block(_cfg(tutor_notes="word " * 400), None)
    assert "…(truncated)" in block
    assert len(block) < TUTOR_NOTES_CAP + 400
