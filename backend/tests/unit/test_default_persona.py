"""Default-identity fallback (1.1.12): an activity/skill with no explicit
persona resolves to the global default persona for the chat avatar + name."""

from __future__ import annotations

import personas.loader as loader
from personas.loader import (
    DEFAULT_PERSONA_ID,
    load_default_persona,
    resolve_persona_or_default,
)


def test_default_persona_id_is_a_real_persona():
    p = load_default_persona()
    assert p is not None
    assert p.id == DEFAULT_PERSONA_ID
    assert p.avatar  # has an avatar to show


def test_resolve_returns_explicit_when_set():
    # an explicitly-assigned, loadable persona wins over the default
    explicit = next(p for p in loader.load_personas() if p.id != DEFAULT_PERSONA_ID)
    assert resolve_persona_or_default(explicit.id).id == explicit.id


def test_resolve_falls_back_to_default_when_none():
    assert resolve_persona_or_default(None).id == DEFAULT_PERSONA_ID


def test_resolve_falls_back_to_default_when_unknown_id():
    # a stale / deleted persona id degrades to the default, never None
    assert resolve_persona_or_default("no-such-persona-xyz").id == DEFAULT_PERSONA_ID


def test_default_disabled_returns_none(monkeypatch):
    # opting out (DEFAULT_PERSONA_ID="") keeps the brand-mark fallback
    monkeypatch.setattr(loader, "DEFAULT_PERSONA_ID", "")
    assert load_default_persona() is None
    assert resolve_persona_or_default(None) is None
