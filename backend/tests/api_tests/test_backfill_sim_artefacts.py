"""Tests for the sim-artefact backfill (USR-1)."""

from __future__ import annotations

import pytest

import scripts.backfill_sim_artefacts as bf
from db import firestore as fs_module
from db.activities import create_activity, get_activity
from db.models.activity import Activity


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    # Map test skill ids → sim skill names + a Boldkast problem statement.
    names = {"sk-boldkast": "problem-set-hints", "sk-led": "led-planck-tutor", "sk-concept": "concept-dialogue"}
    monkeypatch.setattr(bf, "_skill_name", lambda sid: names.get(sid))
    monkeypatch.setattr(bf, "_problem_statement", lambda sid: "Kast en bold." if sid == "sk-boldkast" else "")
    yield
    fs_module._reset_client_for_testing()


def test_sets_artefact_and_elements_for_boldkast():
    create_activity(Activity(activityId="act-bk", skillId="sk-boldkast", title="Boldkast", ownerUid="t"))
    bf.run(dry_run=False)
    a = get_activity("act-bk")
    assert a.artefact_id == "boldkast"
    assert a.workbench_type == "app"
    assert [c.id for c in a.checklist] == ["a", "b", "c", "d"]
    assert a.note and a.note[0].title == "Opgave" and "Kast en bold" in a.note[0].body


def test_sets_artefact_and_led_note():
    create_activity(Activity(activityId="act-led", skillId="sk-led", title="LED", ownerUid="t"))
    bf.run(dry_run=False)
    a = get_activity("act-led")
    assert a.artefact_id == "led-planck"
    assert a.note and "Plancks konstant" in a.note[0].body


def test_non_sim_activity_untouched():
    create_activity(Activity(activityId="act-c", skillId="sk-concept", title="Concept", ownerUid="t"))
    bf.run(dry_run=False)
    assert get_activity("act-c").artefact_id is None


def test_idempotent_and_preserves_existing_elements():
    create_activity(
        Activity(
            activityId="act-bk",
            skillId="sk-boldkast",
            title="Boldkast",
            ownerUid="t",
            checklist=[{"id": "x", "label": "custom"}],  # teacher already authored
        )
    )
    bf.run(dry_run=False)
    first = get_activity("act-bk")
    assert [c.id for c in first.checklist] == ["x"]  # did NOT clobber teacher's checklist
    report = bf.run(dry_run=False)
    assert "act-bk" in report["skipped"]  # second run is a no-op


def test_dry_run_writes_nothing():
    create_activity(Activity(activityId="act-bk", skillId="sk-boldkast", title="Boldkast", ownerUid="t"))
    bf.run(dry_run=True)
    assert get_activity("act-bk").artefact_id is None
