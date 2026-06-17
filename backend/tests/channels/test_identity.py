"""Unit tests for `channels.identity.IdentityResolver`.

Rewritten 2026-06-17 (firestore-portability-seam): the resolver now goes
through the `db.firestore` DAL helpers instead of the raw client surface,
so these tests exercise *behaviour* against the in-memory store
(LOCAL_MODE) rather than asserting on mock call patterns. Same pattern as
test_classes_firestore.py.
"""

from __future__ import annotations

import pytest

from channels import identity
from channels.identity import COLLECTION, IdentityResolver
from db import firestore as fs


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    """Force the in-memory Firestore client; reset the singleton each test."""
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs._reset_client_for_testing()
    yield
    fs._reset_client_for_testing()


class TestDocId:
    """The deterministic document ID used to key channel_identities."""

    def test_basic(self) -> None:
        # Internal helper but the format is part of the contract — if
        # this changes existing mappings are orphaned.
        assert identity._doc_id("discord", "12345") == "discord_12345"

    def test_rejects_slash_in_channel_user_id(self) -> None:
        # Firestore document IDs cannot contain "/" — fail loud rather
        # than silently corrupt the collection.
        with pytest.raises(ValueError, match="contains '/'"):
            identity._doc_id("email", "bad/value")


class TestResolveHit:
    """`resolve` returns the firebase_uid when the mapping exists."""

    @pytest.mark.asyncio
    async def test_returns_uid_on_hit(self) -> None:
        fs.set_document(COLLECTION, "telegram_999", {"firebase_uid": "abc-uid-123"})

        uid = await IdentityResolver.resolve("telegram", "999")
        assert uid == "abc-uid-123"

    @pytest.mark.asyncio
    async def test_touches_last_seen_at_on_hit(self) -> None:
        fs.set_document(COLLECTION, "telegram_999", {"firebase_uid": "abc"})

        await IdentityResolver.resolve("telegram", "999")
        # last_seen_at is a best-effort touch; verify it landed in the store.
        stored = fs.get_document(COLLECTION, "telegram_999")
        assert stored is not None
        assert "last_seen_at" in stored


class TestResolveMiss:
    """`resolve` returns None when no mapping exists."""

    @pytest.mark.asyncio
    async def test_returns_none_on_miss(self) -> None:
        uid = await IdentityResolver.resolve("discord", "never-seen")
        assert uid is None

    @pytest.mark.asyncio
    async def test_returns_none_when_record_missing_uid(self) -> None:
        # Record exists but has no `firebase_uid` field — treat as miss
        # (a malformed record should not auth as a known user).
        fs.set_document(COLLECTION, "discord_123", {"channel": "discord"})

        uid = await IdentityResolver.resolve("discord", "123")
        assert uid is None


class TestAutoCreate:
    """`auto_create` writes a fresh mapping and returns the synthetic UID."""

    @pytest.mark.asyncio
    async def test_writes_record_with_deterministic_uid(self) -> None:
        uid = await IdentityResolver.auto_create("telegram", "42")
        # UID derived from channel + channel_user_id so re-resolves stable.
        assert uid == "channel-telegram_42"

        record = fs.get_document(COLLECTION, "telegram_42")
        assert record is not None
        assert record["channel"] == "telegram"
        assert record["channel_user_id"] == "42"
        assert record["firebase_uid"] == "channel-telegram_42"
        assert "created_at" in record
        assert "last_seen_at" in record

    @pytest.mark.asyncio
    async def test_email_populates_domain(self) -> None:
        await IdentityResolver.auto_create("email", "user@example.com", email="user@example.com")
        record = fs.get_document(COLLECTION, "email_user@example.com")
        assert record is not None
        assert record["email"] == "user@example.com"
        assert record["domain"] == "example.com"

    @pytest.mark.asyncio
    async def test_no_email_leaves_domain_blank(self) -> None:
        await IdentityResolver.auto_create("discord", "12345")
        record = fs.get_document(COLLECTION, "discord_12345")
        assert record is not None
        assert record["email"] == ""
        assert record["domain"] == ""

    @pytest.mark.asyncio
    async def test_auto_created_record_is_resolvable(self) -> None:
        # Round-trip: auto_create then resolve returns the same UID.
        created = await IdentityResolver.auto_create("discord", "777")
        resolved = await IdentityResolver.resolve("discord", "777")
        assert resolved == created
