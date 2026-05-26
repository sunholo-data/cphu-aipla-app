"""Unit tests for backend/admin/demo_classes.py (1.A follow-up)."""

from __future__ import annotations

import pytest

from admin.demo_classes import DEMO_CLASSES, seed_demo_classes
from auth.group_id_auth import DEMO_TEACHER_UID
from db import classes as classes_db
from db import firestore as fs_module
from db.firestore import set_document


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    from auth.group_id_auth import AnonymousGroupAuth

    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _seed_skill(skill_id: str, name: str) -> None:
    """The demo seed looks up lesson names via skill_config.list_skills.
    Drop a minimal doc that satisfies that lookup."""
    from skills.platform import PLATFORM_OWNER_UID

    set_document(
        "skills",
        skill_id,
        {
            "skillId": skill_id,
            "name": name,
            "slug": name,
            "ownerId": PLATFORM_OWNER_UID,
            "ownerEmail": "platform@aipla.dev",
            "accessControl": {"type": "public"},
        },
    )


def test_seed_creates_all_demo_classes_under_demo_uid():
    _seed_skill("skill-pset", "problem-set-hints")
    result = seed_demo_classes()
    assert result["owner_uid"] == DEMO_TEACHER_UID
    assert set(result["created"]) == {c["name"] for c in DEMO_CLASSES}
    assert result["skipped"] == []

    classes = classes_db.list_classes_for_owner(DEMO_TEACHER_UID)
    assert {c.name for c in classes} == {c["name"] for c in DEMO_CLASSES}
    for c in classes:
        assert c.owner_uid == DEMO_TEACHER_UID
        assert c.tag_namespace.startswith(f"class:{DEMO_TEACHER_UID}:")


def test_seed_is_idempotent():
    _seed_skill("skill-pset", "problem-set-hints")
    first = seed_demo_classes()
    second = seed_demo_classes()
    assert second["created"] == []
    assert set(second["skipped"]) == set(first["created"])

    # Still only one of each.
    classes = classes_db.list_classes_for_owner(DEMO_TEACHER_UID)
    assert len(classes) == len(DEMO_CLASSES)


def test_seed_links_lessons_when_skill_exists():
    """The first demo class declares problem-set-hints as a lesson. When
    that skill exists, the seeder links it (writes Class.lessons + the
    skill's accessControl tag)."""
    _seed_skill("skill-pset", "problem-set-hints")
    seed_demo_classes()
    physik = next(c for c in classes_db.list_classes_for_owner(DEMO_TEACHER_UID) if c.name == "Physik 9A vår 2026")
    assert "skill-pset" in physik.lessons

    # Skill's accessControl now carries the class's tag namespace.
    from db.firestore import get_document

    sk = get_document("skills", "skill-pset")
    assert physik.tag_namespace in (sk["accessControl"].get("tags") or [])


def test_seed_handles_missing_lesson_skill_gracefully():
    """When problem-set-hints isn't seeded, the demo class should still
    be created — just without the lesson link. Defensive so a fresh
    deploy that hasn't run platform-skills seed yet doesn't blow up."""
    # NO _seed_skill call.
    result = seed_demo_classes()
    # All three classes still created.
    assert len(result["created"]) == len(DEMO_CLASSES)
    physik = next(c for c in classes_db.list_classes_for_owner(DEMO_TEACHER_UID) if c.name == "Physik 9A vår 2026")
    assert physik.lessons == []


def test_seed_mints_group_codes_per_spec():
    """The demo specs declare how many group codes to mint per class."""
    _seed_skill("skill-pset", "problem-set-hints")
    seed_demo_classes()
    counts = {c.name: len(c.group_codes) for c in classes_db.list_classes_for_owner(DEMO_TEACHER_UID)}
    assert counts["Physik 9A vår 2026"] == 2
    assert counts["Physics 11 NCERT"] == 1
    assert counts["Sandbox class"] == 0
