"""The access register + tier resolution (ACCESS-1 M1).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

These tests pin the behaviours the whole feature rests on: default-deny by
absence, the three ways a grant stops conferring its tier, and the deliberate
narrowness of email normalisation.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from auth.access_tiers import DEFAULT_ACCESS_TIER, TIER_PILOT, TIER_VISITOR, can_spend
from auth.firebase_auth import User, _user_from_decoded_token
from auth.guards import assert_can_spend, assert_teacher
from db import teacher_access
from db.teacher_access import (
    AccessGrant,
    get_grant,
    grant_access,
    list_grants,
    normalise_email,
    resolve_tier,
    revoke_access,
    stamp_uid,
)


@pytest.fixture(autouse=True)
def _in_memory_firestore(monkeypatch):
    """Back the register with a dict so these stay unit tests."""
    store: dict[str, dict] = {}

    def _get(collection, doc_id):
        return store.get(f"{collection}/{doc_id}")

    def _set(collection, doc_id, data, merge=False):
        key = f"{collection}/{doc_id}"
        store[key] = {**store.get(key, {}), **data} if merge else dict(data)

    def _query(collection, filters=None, order_by=None, order_direction="DESCENDING", limit=None):
        rows = [{**v, "__id": k.split("/", 1)[1]} for k, v in store.items() if k.startswith(f"{collection}/")]
        for field, op, value in filters or []:
            assert op == "==", f"test double only supports ==, got {op}"
            rows = [r for r in rows if r.get(field) == value]
        return rows[:limit] if limit else rows

    monkeypatch.setattr(teacher_access, "get_document", _get)
    monkeypatch.setattr(teacher_access, "set_document", _set)
    monkeypatch.setattr(teacher_access, "query_documents", _query)
    return store


def _iso(delta: timedelta) -> str:
    return (datetime.now(UTC) + delta).isoformat()


# --- Default-deny by absence -------------------------------------------------


def test_unknown_email_resolves_to_visitor():
    """The headline property: not being on the register is not an error, it is
    simply visitor. No explicit check to forget."""
    assert resolve_tier("nobody@example.com") == TIER_VISITOR
    assert DEFAULT_ACCESS_TIER == TIER_VISITOR


def test_empty_email_resolves_to_visitor():
    assert resolve_tier("") == TIER_VISITOR
    assert get_grant("") is None


# --- The three ways a grant stops conferring -------------------------------


def test_granted_email_resolves_to_pilot():
    grant_access("anna@ku.dk", granted_by="m@sunholo.com", note="Cohort A")
    assert resolve_tier("anna@ku.dk") == TIER_PILOT


def test_revoked_grant_resolves_to_visitor():
    grant_access("anna@ku.dk")
    assert resolve_tier("anna@ku.dk") == TIER_PILOT
    assert revoke_access("anna@ku.dk", revoked_by="m@sunholo.com") is True
    assert resolve_tier("anna@ku.dk") == TIER_VISITOR


def test_expired_grant_resolves_to_visitor():
    """expiresAt defaults to the contract boundary, so forgetting to clean up
    means access LAPSES rather than persisting."""
    grant_access("anna@ku.dk", expires_at=_iso(timedelta(days=-1)))
    assert resolve_tier("anna@ku.dk") == TIER_VISITOR


def test_future_expiry_still_confers():
    grant_access("anna@ku.dk", expires_at=_iso(timedelta(days=30)))
    assert resolve_tier("anna@ku.dk") == TIER_PILOT


def test_unparseable_expiry_is_treated_as_expired():
    """Fail-closed: a corrupt date costs spend authority (one CLI call to fix)
    rather than silently conferring it forever."""
    grant = AccessGrant(email="a@b.c", tier="pilot", monthly_cap_usd=25.0, expires_at="not-a-date")
    assert grant.is_active is False
    assert grant.effective_tier == TIER_VISITOR


def test_unknown_tier_in_the_document_resolves_to_visitor(_in_memory_firestore):
    """A hand-edited or future-schema row must not confer spend."""
    _in_memory_firestore["teacher_access/weird@ku.dk"] = {"email": "weird@ku.dk", "tier": "superuser"}
    assert resolve_tier("weird@ku.dk") == TIER_VISITOR


# --- Email normalisation is deliberately narrow ------------------------------


def test_normalisation_is_case_and_whitespace_only():
    assert normalise_email("  Anna@KU.dk ") == "anna@ku.dk"
    grant_access("Anna@KU.dk")
    assert resolve_tier("anna@ku.dk") == TIER_PILOT
    assert resolve_tier("ANNA@ku.DK") == TIER_PILOT


def test_plus_addressing_is_NOT_folded():
    """No plus-stripping, no Gmail dot-folding. Inventing equivalences here
    would create a way to be admitted under an address nobody invited."""
    grant_access("anna@ku.dk")
    assert resolve_tier("anna+test@ku.dk") == TIER_VISITOR


def test_dots_are_NOT_folded():
    grant_access("a.b@gmail.com")
    assert resolve_tier("ab@gmail.com") == TIER_VISITOR


# --- Grant semantics ---------------------------------------------------------


def test_grant_is_idempotent_and_un_revokes():
    grant_access("anna@ku.dk")
    revoke_access("anna@ku.dk")
    assert resolve_tier("anna@ku.dk") == TIER_VISITOR
    grant_access("anna@ku.dk")
    assert resolve_tier("anna@ku.dk") == TIER_PILOT


def test_regrant_preserves_the_audit_trail():
    grant_access("anna@ku.dk")
    stamp_uid("anna@ku.dk", "uid-123")
    grant_access("anna@ku.dk", monthly_cap_usd=100.0, note="raised")
    grant = get_grant("anna@ku.dk")
    assert grant is not None
    assert grant.uid == "uid-123"
    assert grant.monthly_cap_usd == 100.0


def test_stamp_uid_never_reassigns():
    """Two identities on one invited address is worth a log line, not a silent
    reassignment."""
    grant_access("anna@ku.dk")
    stamp_uid("anna@ku.dk", "uid-first")
    stamp_uid("anna@ku.dk", "uid-second")
    grant = get_grant("anna@ku.dk")
    assert grant is not None and grant.uid == "uid-first"


def test_revoking_an_unknown_email_reports_false():
    assert revoke_access("stranger@example.com") is False


def test_grant_rejects_a_bad_tier():
    with pytest.raises(ValueError, match="tier must be one of"):
        grant_access("anna@ku.dk", tier="admin")  # type: ignore[arg-type]


def test_grant_rejects_an_empty_email():
    with pytest.raises(ValueError, match="email is required"):
        grant_access("   ")


def test_list_hides_revoked_by_default():
    grant_access("a@ku.dk")
    grant_access("b@ku.dk")
    revoke_access("b@ku.dk")
    assert {g.email for g in list_grants()} == {"a@ku.dk"}
    assert {g.email for g in list_grants(include_revoked=True)} == {"a@ku.dk", "b@ku.dk"}


# --- The claim, and its relationship to is_teacher ---------------------------


def test_absent_claim_lands_on_visitor():
    user = _user_from_decoded_token({"uid": "u1", "email": "someone@example.com"})
    assert user.access_tier == TIER_VISITOR


def test_pilot_claim_is_read():
    user = _user_from_decoded_token({"uid": "u1", "email": "a@ku.dk", "accessTier": "pilot"})
    assert user.access_tier == TIER_PILOT


def test_unrecognised_claim_lands_on_visitor():
    """A forged or future-schema claim confers nothing."""
    user = _user_from_decoded_token({"uid": "u1", "email": "a@ku.dk", "accessTier": "root"})
    assert user.access_tier == TIER_VISITOR


def test_is_teacher_is_unchanged_by_the_tier():
    """The load-bearing invariant: a visitor is STILL a teacher for navigation.

    ~35 assert_teacher call sites mean "Firebase identity, not an anonymous
    student". Folding spend into that boolean would break the navigation
    surfaces a visitor is supposed to reach — which is the entire point of
    letting them sign in.
    """
    visitor = _user_from_decoded_token({"uid": "u1", "email": "a@example.com"})
    assert visitor.is_teacher is True
    assert visitor.access_tier == TIER_VISITOR
    assert_teacher(visitor)  # must not raise


def test_researcher_claim_still_works_alongside_the_tier():
    user = _user_from_decoded_token({"uid": "u1", "email": "jb@ku.dk", "role": "researcher", "accessTier": "pilot"})
    assert user.is_researcher is True
    assert user.access_tier == TIER_PILOT


# --- The guard ---------------------------------------------------------------


def test_assert_can_spend_402s_a_visitor():
    from fastapi import HTTPException

    visitor = User(uid="u1", email="a@example.com", is_teacher=True, access_tier=TIER_VISITOR)
    with pytest.raises(HTTPException) as exc:
        assert_can_spend(visitor)
    assert exc.value.status_code == 402


def test_assert_can_spend_allows_a_pilot():
    pilot = User(uid="u1", email="a@ku.dk", is_teacher=True, access_tier=TIER_PILOT)
    assert_can_spend(pilot)  # must not raise


def test_can_spend_helper():
    assert can_spend(TIER_PILOT) is True
    assert can_spend(TIER_VISITOR) is False
    assert can_spend("") is False
