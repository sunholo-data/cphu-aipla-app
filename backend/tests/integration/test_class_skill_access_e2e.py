"""E2E integration test for 1.A teacher-permission-model.

Drives the full chain with the REAL ``AccessContext.can_access``
evaluator — no mocks. The point of this test is to PROVE the design's
primary success criterion: existing 5-type evaluator untouched, all
new behaviour comes from the ownership/minting layer above it
(axiom 9 promise).

Marked slow + integration so make test-fast skips it; make test runs
it. The full suite must pass for sprint completion.

Scenario:
  1. Two teachers T1 and T2, each create their own class.
  2. T1 adds skill-A to T1's class lessons; T2 adds skill-B to T2's.
  3. Student joins via T1's group code.
  4. AccessContext.can_access (REAL evaluator) returns True for
     skill-A and False for skill-B.
  5. The reverse: a student via T2's code sees only skill-B.
"""

from __future__ import annotations

import jwt as _jwt
import pytest

from auth.access_context import build_access_context
from auth.group_id_auth import (
    AUTH_MODE,
    DEFAULT_TOKEN_LIFETIME_SECONDS,
    JWT_ALGORITHM,
    AnonymousGroupAuth,
    _signing_secret,
)
from db import classes as classes_db
from db import firestore as fs_module
from db.firestore import get_document, set_document
from db.models.access import AccessControl
from db.models.class_ import Class

pytestmark = [pytest.mark.slow, pytest.mark.integration]


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _make_class_for(owner_uid: str, name: str) -> Class:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name=name)
    classes_db.create_class(cls)
    return cls


def _seed_skill(skill_id: str, owner_uid: str = "platform") -> None:
    """Drop a minimal skill doc with public access. The lessons-PATCH
    will switch it to tagged when a class adds it."""
    set_document(
        "skills",
        skill_id,
        {
            "skillId": skill_id,
            "name": skill_id,
            "slug": skill_id,
            "ownerId": owner_uid,
            "ownerUid": owner_uid,
            "accessControl": {"type": "public"},
        },
    )


def _add_lesson_via_route_helper(class_id: str, skill_id: str) -> None:
    """Inline the cross-collection mutation that
    classes_routes.patch_lessons does — append the class's namespace
    to the skill's accessControl.tags, switch type to tagged."""
    cls = classes_db.get_class(class_id)
    assert cls is not None
    classes_db.add_lessons(class_id, [skill_id])
    doc = get_document("skills", skill_id)
    assert doc is not None
    tags = list((doc.get("accessControl") or {}).get("tags") or [])
    if cls.tag_namespace not in tags:
        tags.append(cls.tag_namespace)
    doc["accessControl"] = {"type": "tagged", "tags": tags}
    set_document("skills", skill_id, doc)


def _mint_token_for_code(code: str) -> str:
    import time

    now = time.time()
    claims = {
        "sub": f"anon-{code}-xyz",
        "group_id": code,
        "exp": now + DEFAULT_TOKEN_LIFETIME_SECONDS,
        "iat": now,
        "auth_mode": AUTH_MODE,
    }
    return _jwt.encode(claims, _signing_secret(), algorithm=JWT_ALGORITHM)


def _load_skill_ac(skill_id: str) -> AccessControl:
    doc = get_document("skills", skill_id)
    assert doc is not None
    return AccessControl.model_validate(doc["accessControl"])


def _load_skill_owner(skill_id: str) -> str:
    doc = get_document("skills", skill_id)
    assert doc is not None
    return doc.get("ownerId") or doc.get("ownerUid") or "platform"


def test_e2e_class_scoped_skill_access():
    """Full chain: two teachers, two classes, two skills. Each student
    sees only their class's skill via the REAL can_access evaluator."""
    # --- Teachers + classes ---
    t1 = _make_class_for("teacher-T1", "T1's class")
    t2 = _make_class_for("teacher-T2", "T2's class")

    # --- Skills (start public; lessons-PATCH switches to tagged) ---
    _seed_skill("skill-A")
    _seed_skill("skill-B")
    _add_lesson_via_route_helper(t1.class_id, "skill-A")
    _add_lesson_via_route_helper(t2.class_id, "skill-B")

    # --- Mint codes under each class ---
    t1_code = classes_db.mint_group_codes_under_class(t1.class_id, count=1)[0]
    t2_code = classes_db.mint_group_codes_under_class(t2.class_id, count=1)[0]

    # --- Student via T1's code ---
    t1_user = AnonymousGroupAuth.user_from_token(_mint_token_for_code(t1_code))
    t1_ctx = build_access_context(t1_user)

    assert t1_user.group_tags == frozenset({t1.tag_namespace})
    assert t1_ctx.can_access(
        type("_S", (), {"access_control": _load_skill_ac("skill-A"), "owner_id": _load_skill_owner("skill-A")})()
    )
    assert not t1_ctx.can_access(
        type("_S", (), {"access_control": _load_skill_ac("skill-B"), "owner_id": _load_skill_owner("skill-B")})()
    )

    # --- Student via T2's code (the symmetric check) ---
    t2_user = AnonymousGroupAuth.user_from_token(_mint_token_for_code(t2_code))
    t2_ctx = build_access_context(t2_user)

    assert t2_user.group_tags == frozenset({t2.tag_namespace})
    assert t2_ctx.can_access(
        type("_S", (), {"access_control": _load_skill_ac("skill-B"), "owner_id": _load_skill_owner("skill-B")})()
    )
    assert not t2_ctx.can_access(
        type("_S", (), {"access_control": _load_skill_ac("skill-A"), "owner_id": _load_skill_owner("skill-A")})()
    )


def test_e2e_revoking_class_locks_out_students_immediately():
    """Class revocation is the load-bearing security gate for teacher
    deprovisioning. A student whose JWT was issued BEFORE the class
    was revoked must be locked out on the very next request."""
    t = _make_class_for("teacher-T", "Class")
    _seed_skill("skill-X")
    _add_lesson_via_route_helper(t.class_id, "skill-X")
    code = classes_db.mint_group_codes_under_class(t.class_id, count=1)[0]
    token = _mint_token_for_code(code)

    # Pre-revocation: works.
    user = AnonymousGroupAuth.user_from_token(token)
    ctx = build_access_context(user)
    assert ctx.can_access(
        type("_S", (), {"access_control": _load_skill_ac("skill-X"), "owner_id": _load_skill_owner("skill-X")})()
    )

    # Teacher revokes the class — same token, fresh verify, locked out.
    classes_db.revoke_class(t.class_id)
    from auth.group_id_auth import GroupRevoked

    with pytest.raises(GroupRevoked):
        AnonymousGroupAuth.user_from_token(token)
