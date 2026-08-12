"""Who pays for a turn (ACCESS-1 M1).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

The indirection under test: an anonymous-group student carries no identity
(ADR-001), so their authority to spend is their TEACHER's. That is what makes
one invited teacher's cap cover the thirty students they hand a code to, rather
than covering only the teacher's own typing.
"""

from __future__ import annotations

import pytest

from auth import spend_authority
from auth.access_tiers import TIER_PILOT, TIER_VISITOR
from auth.firebase_auth import User
from auth.spend_authority import clear_cache, resolve_spend_authority


@pytest.fixture(autouse=True)
def _fresh_cache():
    clear_cache()
    yield
    clear_cache()


@pytest.fixture
def store(monkeypatch):
    """A dict standing in for Firestore, injected where spend_authority reads."""
    data: dict[str, dict] = {}

    def _get(collection, doc_id):
        return data.get(f"{collection}/{doc_id}")

    def _query(collection, filters=None, order_by=None, order_direction="DESCENDING", limit=None):
        rows = [{**v, "__id": k.split("/", 1)[1]} for k, v in data.items() if k.startswith(f"{collection}/")]
        for field, _op, value in filters or []:
            rows = [r for r in rows if r.get(field) == value]
        return rows[:limit] if limit else rows

    import db.firestore as fs

    monkeypatch.setattr(fs, "get_document", _get)
    monkeypatch.setattr(fs, "query_documents", _query)
    return data


def _student(group_id: str) -> User:
    return User(uid=f"anon:{group_id}", email="", auth_mode="anonymous_group_id", group_id=group_id)


def _teacher(uid: str, tier: str) -> User:
    return User(uid=uid, email=f"{uid}@ku.dk", is_teacher=True, access_tier=tier)


def _wire_class(store, *, code: str, class_id: str, owner_uid: str) -> None:
    store[f"anon_groups/{code}"] = {"classId": class_id}
    store[f"classes/{class_id}"] = {"ownerUid": owner_uid}


def _register(store, *, email: str, uid: str, tier: str, revoked: bool = False) -> None:
    store[f"teacher_access/{email}"] = {"email": email, "tier": tier, "uid": uid, "revoked": revoked}


# --- Firebase identities answer from their own claim -------------------------


def test_pilot_teacher_can_spend():
    authority = resolve_spend_authority(_teacher("t1", TIER_PILOT))
    assert authority.can_spend is True
    assert authority.billing_identity == "teacher:t1"
    assert authority.reason == "firebase_claim"


def test_visitor_teacher_cannot_spend():
    authority = resolve_spend_authority(_teacher("t1", TIER_VISITOR))
    assert authority.can_spend is False
    assert authority.tier == TIER_VISITOR


def test_a_garbage_tier_on_the_user_falls_to_visitor():
    user = User(uid="t1", email="a@ku.dk", is_teacher=True, access_tier="root")
    assert resolve_spend_authority(user).can_spend is False


# --- Students inherit their teacher's authority ------------------------------


def test_student_of_a_pilot_teacher_can_spend(store):
    _wire_class(store, code="PHYS-7K2N", class_id="c1", owner_uid="t1")
    _register(store, email="anna@ku.dk", uid="t1", tier=TIER_PILOT)

    authority = resolve_spend_authority(_student("PHYS-7K2N"))
    assert authority.can_spend is True
    # The point of the whole indirection: the STUDENT's turn is billed to the
    # TEACHER, so one cap covers the class.
    assert authority.billing_identity == "teacher:t1"
    assert authority.reason == "student_owner_tier"


def test_student_of_a_revoked_teacher_cannot_spend(store):
    """The revoked-teacher path must bite. Their old codes keep resolving, so
    this is the only thing standing between a revocation and their class
    carrying on spending."""
    _wire_class(store, code="PHYS-7K2N", class_id="c1", owner_uid="t1")
    _register(store, email="anna@ku.dk", uid="t1", tier=TIER_PILOT, revoked=True)

    authority = resolve_spend_authority(_student("PHYS-7K2N"))
    assert authority.can_spend is False
    assert authority.billing_identity == "teacher:t1"


def test_student_of_a_visitor_teacher_cannot_spend(store):
    _wire_class(store, code="PHYS-7K2N", class_id="c1", owner_uid="t1")
    _register(store, email="anna@ku.dk", uid="t1", tier=TIER_VISITOR)
    assert resolve_spend_authority(_student("PHYS-7K2N")).can_spend is False


# --- The two deliberate fail-open cases, and why they are narrow -------------


def test_unresolvable_group_fails_open_in_m1(store):
    """No classId on the group: a pre-ACCESS-1 code. Allowed, because a VISITOR
    is never issued a code at all (demo_seed), so a working code belongs to a
    teacher who was invited or predates the register. Blocking would break
    legacy lessons while closing no hole."""
    store["anon_groups/OLD-CODE"] = {}
    authority = resolve_spend_authority(_student("OLD-CODE"))
    assert authority.can_spend is True
    assert authority.reason == "student_owner_unresolved"
    assert authority.billing_identity is None


def test_owner_absent_from_the_register_fails_open(store):
    """A teacher account created before ACCESS-1 shipped. Their classes keep
    working until someone explicitly grants or revokes them."""
    _wire_class(store, code="PHYS-7K2N", class_id="c1", owner_uid="t-legacy")
    authority = resolve_spend_authority(_student("PHYS-7K2N"))
    assert authority.can_spend is True
    assert authority.reason == "student_owner_not_registered"
    assert authority.billing_identity == "teacher:t-legacy"


def test_registered_but_not_pilot_does_NOT_fail_open(store):
    """The distinction that makes the fail-open narrow: 'not found' is lenient,
    'found and not a pilot' is not."""
    _wire_class(store, code="PHYS-7K2N", class_id="c1", owner_uid="t1")
    _register(store, email="anna@ku.dk", uid="t1", tier=TIER_VISITOR)
    assert resolve_spend_authority(_student("PHYS-7K2N")).can_spend is False


# --- Caching -----------------------------------------------------------------


def test_group_resolution_is_cached(store, monkeypatch):
    _wire_class(store, code="PHYS-7K2N", class_id="c1", owner_uid="t1")
    _register(store, email="anna@ku.dk", uid="t1", tier=TIER_PILOT)

    calls = {"n": 0}
    import db.firestore as fs

    real_get = fs.get_document

    def counting_get(collection, doc_id):
        calls["n"] += 1
        return real_get(collection, doc_id)

    monkeypatch.setattr(fs, "get_document", counting_get)

    resolve_spend_authority(_student("PHYS-7K2N"))
    after_first = calls["n"]
    resolve_spend_authority(_student("PHYS-7K2N"))
    assert calls["n"] == after_first, "second resolve should be served from cache"


def test_clear_cache_forces_a_re_read(store):
    _wire_class(store, code="PHYS-7K2N", class_id="c1", owner_uid="t1")
    _register(store, email="anna@ku.dk", uid="t1", tier=TIER_PILOT)
    assert resolve_spend_authority(_student("PHYS-7K2N")).can_spend is True

    # Revoke, then clear — this is what the admin route does on revoke.
    _register(store, email="anna@ku.dk", uid="t1", tier=TIER_PILOT, revoked=True)
    clear_cache()
    assert resolve_spend_authority(_student("PHYS-7K2N")).can_spend is False


def test_firestore_failure_does_not_raise(monkeypatch):
    """A Firestore blip must not 500 the turn; it degrades to the fail-open
    student path, which Ring 0's quota still sits under."""

    def boom(*_a, **_k):
        raise RuntimeError("firestore down")

    import db.firestore as fs

    monkeypatch.setattr(fs, "get_document", boom)
    authority = resolve_spend_authority(_student("PHYS-7K2N"))
    assert authority.reason == "student_owner_unresolved"


def test_module_exports_are_stable():
    assert set(spend_authority.__all__) == {"SpendAuthority", "clear_cache", "resolve_spend_authority"}
