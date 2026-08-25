"""Tests for db/clients.py — domain→bucket resolution."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from auth.firebase_auth import User


def _user(domain: str) -> User:
    return User(uid="uid1", email=f"alice@{domain}", domain=domain)


def _anonymous_group_user() -> User:
    """An ADR-001 anonymous-group student: no email, no domain, synthetic uid.

    This is the caller that took every document upload down on prod during the
    2026-08-21 pilot session — see test_firestore_blank_ids.py for the why.
    """
    return User(
        uid="anon-mintyhill43",
        email="",
        domain="",
        auth_mode="anonymous_group_id",
        group_id="minty-hill-43",
    )


class TestResolveDocumentsBucket:
    def test_returns_mapped_bucket_for_known_domain(self):
        from db.clients import resolve_documents_bucket

        mock_client = MagicMock()
        mock_client.documents_bucket = "rockwool-documents"

        with patch("db.clients.get_client_sync", return_value=mock_client):
            result = resolve_documents_bucket(_user("rockwool.com"))

        assert result == "rockwool-documents"

    def test_falls_back_to_env_for_unknown_domain(self, monkeypatch):
        from db.clients import resolve_documents_bucket

        monkeypatch.setenv("DOCUMENTS_BUCKET", "aipla-dev-2026-documents")

        with patch("db.clients.get_client_sync", return_value=None):
            result = resolve_documents_bucket(_user("unknown.com"))

        assert result == "aipla-dev-2026-documents"

    def test_falls_back_to_env_when_client_has_no_bucket(self, monkeypatch):
        from db.clients import resolve_documents_bucket

        monkeypatch.setenv("DOCUMENTS_BUCKET", "aipla-dev-2026-documents")

        mock_client = MagicMock()
        mock_client.documents_bucket = None

        with patch("db.clients.get_client_sync", return_value=mock_client):
            result = resolve_documents_bucket(_user("partial.com"))

        assert result == "aipla-dev-2026-documents"

    def test_uses_domain_from_user(self, monkeypatch):
        from db.clients import resolve_documents_bucket

        monkeypatch.setenv("DOCUMENTS_BUCKET", "aipla-dev-2026-documents")
        calls = []

        def capturing_get(domain: str):
            calls.append(domain)
            return None

        with patch("db.clients.get_client_sync", side_effect=capturing_get):
            resolve_documents_bucket(_user("acme.org"))

        assert calls == ["acme.org"]


class TestAnonymousGroupStudent:
    """The ADR-001 corner case. A student has no email and no domain, so there
    is no client mapping to look up — and asking Firestore for one is not a
    lookup that returns nothing, it is a 400."""

    def test_empty_domain_resolves_to_the_configured_bucket(self, monkeypatch):
        from db.clients import resolve_documents_bucket

        monkeypatch.setenv("DOCUMENTS_BUCKET", "aipla-dev-2026-documents")

        assert resolve_documents_bucket(_anonymous_group_user()) == "aipla-dev-2026-documents"

    def test_empty_domain_makes_no_firestore_call_at_all(self, monkeypatch):
        """The bug was not a wrong bucket — it was reaching Firestore with a
        blank document id. Asserting the call never happens is what keeps this
        fixed; asserting the return value alone would still pass if a future
        refactor looked the domain up and swallowed the error."""
        from db import clients

        monkeypatch.setenv("DOCUMENTS_BUCKET", "aipla-dev-2026-documents")

        with patch.object(clients, "get_document") as get_document:
            clients.resolve_documents_bucket(_anonymous_group_user())

        get_document.assert_not_called()

    def test_an_email_without_an_at_sign_is_also_no_domain(self, monkeypatch):
        """`user.domain or email.split("@")[1]` — the fallback branch has the
        same blank outcome, and the same 400 behind it."""
        from db import clients

        monkeypatch.setenv("DOCUMENTS_BUCKET", "aipla-dev-2026-documents")
        user = User(uid="uid1", email="not-an-email", domain="")

        with patch.object(clients, "get_document") as get_document:
            result = clients.resolve_documents_bucket(user)

        get_document.assert_not_called()
        assert result == "aipla-dev-2026-documents"

    def test_a_teacher_domain_still_reaches_firestore(self, monkeypatch):
        """The guard must be narrow: a real domain is still looked up."""
        from db import clients

        monkeypatch.setenv("DOCUMENTS_BUCKET", "aipla-dev-2026-documents")

        with patch.object(clients, "get_document", return_value=None) as get_document:
            clients.resolve_documents_bucket(_user("ku.dk"))

        get_document.assert_called_once_with("clients", "ku.dk")


class TestDocumentsBucketMustBeConfigured:
    """Prod ran for a month with DOCUMENTS_BUCKET set on no environment, so
    every resolution returned a hardcoded upstream-Aitana bucket name that this
    project's service account cannot reach. Absent config must be loud."""

    def test_missing_env_var_raises_rather_than_guessing_a_bucket(self, monkeypatch):
        from db.clients import resolve_documents_bucket

        monkeypatch.delenv("DOCUMENTS_BUCKET", raising=False)

        with pytest.raises(RuntimeError, match="DOCUMENTS_BUCKET"):
            resolve_documents_bucket(_anonymous_group_user())

    def test_blank_env_var_is_treated_as_missing(self, monkeypatch):
        from db.clients import resolve_documents_bucket

        monkeypatch.setenv("DOCUMENTS_BUCKET", "")

        with pytest.raises(RuntimeError, match="DOCUMENTS_BUCKET"):
            resolve_documents_bucket(_anonymous_group_user())


class TestGetClientSync:
    def test_returns_none_for_missing_doc(self):
        from db.clients import get_client_sync

        with patch("db.clients.get_document", return_value=None):
            assert get_client_sync("nope.com") is None

    def test_returns_client_config_for_existing_doc(self):
        from db.clients import get_client_sync

        with patch(
            "db.clients.get_document",
            return_value={
                "documents_bucket": "acme-docs",
                "display_name": "Acme Corp",
            },
        ):
            client = get_client_sync("acme.com")

        assert client is not None
        assert client.documents_bucket == "acme-docs"
        assert client.display_name == "Acme Corp"
        assert client.domain == "acme.com"
