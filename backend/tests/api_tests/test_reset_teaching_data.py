"""Tests for scripts.reset_teaching_data — the dev clean-slate wipe."""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db.firestore import get_document, query_documents, set_document
from scripts import reset_teaching_data as reset


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _seed():
    # Teaching data (should be wiped).
    set_document("classes", "c1", {"name": "Class 1"})
    set_document("activities", "act-1", {"title": "A"})
    set_document("activity_configs", "t:c:a", {"legacy": True})
    set_document("chat_sessions", "s1", {"skillId": "x"})
    set_document("group_sessions", "g:a", {"state": {}})
    set_document("anon_groups", "grp1", {"code": "abc"})
    set_document("documents", "d1", {"name": "doc"})
    # Config / corpus (must be KEPT).
    set_document("skills", "concept-dialogue", {"name": "Concept"})
    set_document("curriculum_content", "cc1", {"text": "physics"})
    set_document("tool_permissions", "tp1", {"role": "teacher"})


def test_dry_run_counts_but_deletes_nothing():
    _seed()
    counts = reset.run(apply=False)
    assert counts["classes"] == 1
    assert counts["activities"] == 1
    assert counts["activity_configs"] == 1
    # Nothing actually removed.
    assert get_document("classes", "c1") is not None
    assert get_document("activities", "act-1") is not None


def test_apply_wipes_teaching_data_only():
    _seed()
    reset.run(apply=True)
    # Teaching collections emptied.
    for collection in reset._TEACHING_COLLECTIONS:
        assert query_documents(collection) == [], f"{collection} not wiped"
    # Config + corpus + identity untouched.
    assert get_document("skills", "concept-dialogue") is not None
    assert get_document("curriculum_content", "cc1") is not None
    assert get_document("tool_permissions", "tp1") is not None


def test_apply_is_idempotent():
    _seed()
    reset.run(apply=True)
    counts = reset.run(apply=True)  # second pass: nothing left
    assert sum(counts.values()) == 0


def test_guard_refuses_non_dev_project(monkeypatch):
    """Outside LOCAL_MODE, a non-dev project is a hard refusal."""
    monkeypatch.setenv("LOCAL_MODE", "0")
    monkeypatch.setattr(reset, "is_local_mode", lambda: False)
    monkeypatch.setattr(reset, "resolve_gcp_project", lambda: "aipla-prod-2026")
    with pytest.raises(SystemExit):
        reset.run(apply=True)
