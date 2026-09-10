"""1.1.91 M1 — one bundled tutor choice, and the fallback that keeps it safe.

Headline: an activity with no `tutor_id` resolves EXACTLY as it did before
tutors existed. That is what lets one picker replace two controls without
changing any activity's behaviour.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from adk.tutor_resolution import resolve_teaching
from db import firestore as fs_module
from db.models.activity_config import ActivityConfig
from db.tutors import create_variant, list_tutor_catalogue, resolve_tutor, save_tutor
from tutors.loader import base_tutor_ids, load_base_tutors


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _cfg(**kw) -> ActivityConfig:
    return ActivityConfig(activityId="act-1", classId="c-1", teacherUid="t-1", updatedAt=datetime.now(UTC), **kw)


# ── the safety property ──────────────────────────────────────────────────────


def test_no_base_tutor_carries_a_framework():
    """The catalogue does not make pedagogical claims nobody signed off.
    Selecting a base tutor must compose exactly as its persona did before."""
    for t in load_base_tutors():
        assert t.framework_id is None, f"{t.id} pairs a persona with a framework"
        assert t.persona_id == t.id
        assert not t.is_variant


def test_there_is_one_base_tutor_per_shipped_persona():
    from personas.loader import load_personas

    assert set(base_tutor_ids()) == {p.id for p in load_personas()}


def test_no_tutor_id_resolves_to_the_pre_tutor_field_path():
    r = resolve_teaching(_cfg(persona="frida", interactionStyle="concise"))
    assert r.tutor is None
    assert (r.persona_id, r.interaction_style, r.framework_id) == ("frida", "concise", None)
    assert r.source == "fields"


def test_no_config_at_all_is_the_socratic_default():
    r = resolve_teaching(None)
    assert (r.persona_id, r.framework_id, r.interaction_style) == (None, None, "socratic")


def test_unknown_tutor_id_degrades_to_the_field_path_rather_than_raising():
    """A teacher picked something and it did not resolve. Teaching differently
    without warning would be worse than falling back (Axiom 5)."""
    r = resolve_teaching(_cfg(tutorId="no-such-tutor", persona="frida", interactionStyle="warm"))
    assert r.tutor is None
    assert (r.persona_id, r.interaction_style) == ("frida", "warm")


# ── the bundle ───────────────────────────────────────────────────────────────


def test_a_tutor_supplies_persona_framework_and_style_together():
    create_variant("sofie", variant_id="sofie-esru", display_name="Sofie — ESRU", created_by="r-1", framework_id="esru")
    r = resolve_teaching(_cfg(tutorId="sofie-esru"))
    assert r.tutor is not None
    assert (r.persona_id, r.framework_id, r.interaction_style) == ("sofie", "esru", "warm")
    assert r.source == "tutor"


def test_the_tutor_overrides_the_individual_fields():
    """One choice, not four. A stale persona field must not fight the tutor."""
    create_variant("sofie", variant_id="sofie-esru", display_name="Sofie — ESRU", created_by="r-1", framework_id="esru")
    r = resolve_teaching(_cfg(tutorId="sofie-esru", persona="henrik", interactionStyle="rigorous", frameworkId="poe"))
    assert (r.persona_id, r.framework_id, r.interaction_style) == ("sofie", "esru", "warm")


# ── variants ─────────────────────────────────────────────────────────────────


def test_a_variant_records_lineage_and_never_mutates_its_parent():
    """Lineage is the research finding, not bookkeeping: "the framework as
    designed vs as teachers actually adapted it" is only askable if the delta
    is recorded."""
    v = create_variant(
        "sofie",
        variant_id="sofie-dialogic",
        display_name="Sofie — open dialogue",
        created_by="r-1",
        framework_id="authentic-dialogue",
        interaction_style="socratic",
    )
    assert v.is_variant and v.lineage.parent_tutor_id == "sofie"
    assert v.status == "draft"
    assert v.author_uid == "r-1"
    parent = resolve_tutor("sofie")
    assert parent is not None and parent.framework_id is None
    assert parent.interaction_style == "warm"


def test_a_variant_inherits_what_it_does_not_state():
    v = create_variant("mikkel", variant_id="mikkel-v2", display_name="Mikkel v2", created_by="r-1")
    base = next(t for t in load_base_tutors() if t.id == "mikkel")
    assert v.persona_id == base.persona_id
    assert v.interaction_style == base.interaction_style


def test_editing_an_authored_tutor_bumps_the_version():
    """1.1.92 attributes a scored session to (tutor_id, version)."""
    v = create_variant("sofie", variant_id="sofie-x", display_name="X", created_by="r-1")
    assert v.version == 1
    again = save_tutor(v, updated_by="r-1")
    assert again.version == 2


def test_the_catalogue_shows_bases_and_variants_with_bases_first():
    create_variant("sofie", variant_id="sofie-esru", display_name="Sofie — ESRU", created_by="r-1", framework_id="esru")
    cat = list_tutor_catalogue()
    ids = [t.id for t in cat]
    assert "sofie-esru" in ids
    # Bases sort ahead of variants so the picker leads with the safe choices.
    assert [t.is_variant for t in cat] == sorted(t.is_variant for t in cat)


def test_a_malformed_stored_row_is_skipped_not_fatal(caplog):
    """One bad row must not empty the catalogue — but it must be logged, or
    "the tutor I made is missing" becomes unexplainable."""
    from db.firestore import set_document

    set_document("tutors", "broken", {"id": "broken", "nonsense": True}, merge=False)
    with caplog.at_level("WARNING"):
        ids = [t.id for t in list_tutor_catalogue()]
    assert "broken" not in ids
    assert set(base_tutor_ids()).issubset(set(ids))
    assert any("broken" in r.getMessage() for r in caplog.records)
