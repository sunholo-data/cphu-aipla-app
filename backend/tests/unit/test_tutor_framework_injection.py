"""1.1.91 M1 — the framework reaches (or deliberately does not reach) a turn.

Headline: NO framework ⇒ byte-identical composition. That is the 1.1.20
precedent and the reason this sprint's blast radius is only the activities a
researcher opted in.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from adk.tutor_framework import inject_framework_preamble
from db import firestore as fs_module
from db.framework_overrides import (
    clear_framework_override,
    default_framework_instruction,
    resolve_framework_instruction,
    save_framework_override,
)
from db.models.activity_config import ActivityConfig
from frameworks.instruction import build_framework_instruction
from frameworks.loader import load_framework

BASE = "You are a physics tutor."


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _cfg(framework_id=None):
    return ActivityConfig(
        activityId="act-1",
        classId="c-1",
        teacherUid="t-1",
        frameworkId=framework_id,
        updatedAt=datetime.now(UTC),
    )


def _patch_config(monkeypatch, cfg):
    monkeypatch.setattr("adk.tutor_framework.resolve_active_config", lambda *a, **k: cfg)


# ── the passthrough guarantee ────────────────────────────────────────────────


def test_no_framework_composes_byte_identically(monkeypatch):
    _patch_config(monkeypatch, _cfg(None))
    assert inject_framework_preamble(BASE, "act-1") == BASE


def test_no_config_at_all_composes_byte_identically(monkeypatch):
    _patch_config(monkeypatch, None)
    assert inject_framework_preamble(BASE, "act-1") == BASE


def test_unknown_framework_id_is_a_passthrough(monkeypatch):
    _patch_config(monkeypatch, _cfg("no-such-framework"))
    assert inject_framework_preamble(BASE, "act-1") == BASE


def test_placeholder_framework_is_a_passthrough(monkeypatch):
    """A framework with no drafted constructs has nothing to tell a tutor, and
    inventing something would be the unfounded claim 1.1.91 warns about.

    The placeholder is built here rather than borrowed from the catalogue. Every
    shipped framework has drafted constructs since 2026-09-10, so naming a real
    id made this test assert the opposite of what it says the moment that one
    was written — which is exactly what happened to `poe`.
    """
    from db.models.teaching_framework import TeachingFramework

    empty = TeachingFramework(id="slot-only", label="Slot only", status="placeholder")
    assert empty.is_placeholder and empty.constructs == []
    monkeypatch.setattr(
        "db.framework_overrides.load_framework",
        lambda fid: empty if fid == "slot-only" else None,
    )
    monkeypatch.setattr("db.framework_overrides.get_framework_override", lambda fid: None)
    _patch_config(monkeypatch, _cfg("slot-only"))
    assert inject_framework_preamble(BASE, "act-1") == BASE


# ── the framework actually reaching the prompt ───────────────────────────────


def test_esru_reaches_the_prompt_with_all_four_verified_moves(monkeypatch):
    _patch_config(monkeypatch, _cfg("esru"))
    out = inject_framework_preamble(BASE, "act-1")
    assert out.startswith(BASE)
    for move in ("Elicit", "Student response", "Recognise", "Use"):
        assert move in out
    # Behaviours travel verbatim, so the prompt cannot drift from the theory.
    for behaviour in load_framework("esru").behaviour_lines():
        assert behaviour in out


def test_a_researcher_edit_reaches_the_prompt_without_a_deploy(monkeypatch):
    """The premise of 1.1.91: the people who own the pedagogy cannot write files
    in git, so their edit has to reach a live turn some other way."""
    _patch_config(monkeypatch, _cfg("esru"))
    save_framework_override("esru", "Ask one question. Then use the answer.", updated_by="r-1")
    out = inject_framework_preamble(BASE, "act-1")
    assert "Ask one question. Then use the answer." in out
    assert "Ruiz-Primo" not in out  # the generated text is replaced, not appended

    clear_framework_override("esru")
    assert resolve_framework_instruction("esru") == default_framework_instruction("esru")


# ── the render itself ────────────────────────────────────────────────────────


def test_render_is_deterministic():
    fw = load_framework("esru")
    assert build_framework_instruction(fw) == build_framework_instruction(fw)


def test_render_never_leaks_framework_jargon_to_the_student():
    """The framework names its own moves in the SYSTEM prompt; the tutor is told
    not to name them to the student. Pinned because it is the kind of line that
    gets dropped in an edit."""
    out = build_framework_instruction(load_framework("esru"))
    assert "Never name the framework" in out
