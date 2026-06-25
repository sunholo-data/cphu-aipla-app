"""Unit tests for auth.owner_labels.resolve_owner_labels (1.1.5 research view)."""

from __future__ import annotations

from types import SimpleNamespace

import firebase_admin.auth as fb_auth

from auth.owner_labels import resolve_owner_labels


def test_no_op_in_local_mode(monkeypatch):
    monkeypatch.setattr("auth.owner_labels.is_local_mode", lambda: True)
    assert resolve_owner_labels({"uid-1"}) == {}


def test_empty_input_short_circuits(monkeypatch):
    monkeypatch.setattr("auth.owner_labels.is_local_mode", lambda: False)
    assert resolve_owner_labels(set()) == {}


def test_prefers_display_name_then_email_and_omits_blank(monkeypatch):
    monkeypatch.setattr("auth.owner_labels.is_local_mode", lambda: False)
    monkeypatch.setattr(fb_auth, "UidIdentifier", lambda u: u)
    monkeypatch.setattr(
        fb_auth,
        "get_users",
        lambda identifiers: SimpleNamespace(
            users=[
                SimpleNamespace(uid="u1", display_name="Alice Hansen", email="alice@ku.dk"),
                SimpleNamespace(uid="u2", display_name="", email="bob@ku.dk"),
                SimpleNamespace(uid="u3", display_name="", email=""),  # unresolvable → omitted
            ]
        ),
    )
    labels = resolve_owner_labels({"u1", "u2", "u3"})
    assert labels == {"u1": "Alice Hansen", "u2": "bob@ku.dk"}


def test_swallows_firebase_error(monkeypatch):
    monkeypatch.setattr("auth.owner_labels.is_local_mode", lambda: False)
    monkeypatch.setattr(fb_auth, "UidIdentifier", lambda u: u)

    def _boom(identifiers):
        raise RuntimeError("network down")

    monkeypatch.setattr(fb_auth, "get_users", _boom)
    assert resolve_owner_labels({"u1"}) == {}  # never raises; caller falls back to uid
