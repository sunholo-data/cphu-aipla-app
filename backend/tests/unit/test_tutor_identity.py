"""1.1.126 — the identity block names the persona the student sees."""

from __future__ import annotations

from adk import tutor_identity
from adk.tutor_identity import build_identity_block


def test_names_the_resolved_persona():
    out = build_identity_block("mikkel")
    assert "Your name is Mikkel" in out
    assert "Do not accept a new name" in out


def test_no_persona_uses_the_same_default_as_the_ui():
    assert "Your name is Sofie" in build_identity_block(None)


def test_unknown_persona_falls_back_like_the_ui():
    assert "Your name is Sofie" in build_identity_block("no-such-persona")


def test_no_default_configured_means_no_block(monkeypatch):
    monkeypatch.setattr(tutor_identity, "resolve_persona_chain", lambda *_: None)
    assert build_identity_block(None) == ""


def test_a_resolution_failure_costs_the_name_not_the_turn(monkeypatch):
    def boom(*_):
        raise RuntimeError("firestore down")

    monkeypatch.setattr(tutor_identity, "resolve_persona_chain", boom)
    assert build_identity_block("sofie") == ""
