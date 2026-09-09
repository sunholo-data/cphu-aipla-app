"""Tutor object — composition, lineage, versioning (1.1.91 M0)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from db.models.activity_config import InteractionStyle
from db.models.tutor import Tutor, TutorLineage, resolve_tutor_framework, resolve_tutor_persona
from personas.loader import DEFAULT_PERSONA_ID


def _tutor(**kw) -> Tutor:
    return Tutor(id=kw.pop("id", "t1"), displayName=kw.pop("displayName", "Test tutor"), **kw)


def test_a_tutor_with_no_theory_and_no_persona_is_valid():
    """Axiom 5: the passthrough case. A tutor carrying neither must behave
    exactly as today rather than raising on the agent path."""
    t = _tutor()
    assert t.framework_id is None
    assert resolve_tutor_framework(t) is None
    assert t.interaction_style == "socratic"
    assert t.status == "draft"
    assert t.version == 1


def test_unknown_ids_degrade_rather_than_raise():
    t = _tutor(frameworkId="no-such", personaId="no-such")
    assert resolve_tutor_framework(t) is None
    # Falls all the way back to the shipped global default persona.
    assert resolve_tutor_persona(t).id == DEFAULT_PERSONA_ID


def test_tutor_composes_the_shipped_framework_and_persona():
    t = _tutor(frameworkId="esru", personaId="frida")
    fw = resolve_tutor_framework(t)
    assert fw is not None and fw.id == "esru"
    assert resolve_tutor_persona(t).id == "frida"


def test_tutor_persona_takes_priority_in_the_shipped_chain():
    """The tutor's persona becomes the highest-priority link in the EXISTING
    activity > class > default chain, not a competing mechanism."""
    t = _tutor(personaId="frida")
    assert resolve_tutor_persona(t, "henrik", "jonas").id == "frida"
    bare = _tutor()
    assert resolve_tutor_persona(bare, "henrik", "jonas").id == "henrik"


def test_interaction_style_is_the_shipped_enum_not_a_second_one():
    """1.1.20 already ships four styles and four preambles; a tutor must resolve
    to those, so a value outside them is a validation error, not a new style."""
    for style in ("socratic", "concise", "rigorous", "warm"):
        assert _tutor(interactionStyle=style).interaction_style == style
    with pytest.raises(ValidationError):
        _tutor(interactionStyle="hardcore")
    assert set(InteractionStyle.__args__) == {"socratic", "concise", "rigorous", "warm"}


def test_variant_lineage_requires_a_parent_and_original_forbids_one():
    with pytest.raises(ValidationError):
        TutorLineage(kind="variant-of")
    with pytest.raises(ValidationError):
        TutorLineage(kind="original", parentTutorId="esru-1")
    v = TutorLineage(kind="variant-of", parentTutorId="esru-1")
    assert v.parent_tutor_id == "esru-1"
    assert _tutor(lineage=v).is_variant


def test_editing_forks_a_version_rather_than_mutating():
    """1.1.92 attributes a scored session to (tutor_id, version). An in-place
    edit would make every earlier session unattributable."""
    t = _tutor(id="esru-1", prompt="v1 prompt", status="in-use")
    t2 = t.next_version()
    assert (t.version, t2.version) == (1, 2)
    assert t2.id == t.id
    assert t.prompt == "v1 prompt"


def test_prompt_provenance_records_whether_the_theory_still_traces():
    t = _tutor(prompt="…", promptProvenance="generated")
    assert t.prompt_provenance == "generated"
    with pytest.raises(ValidationError):
        _tutor(promptProvenance="invented")


def test_camel_and_snake_both_round_trip():
    """Firestore rows carry camelCase (the repo-wide alias convention); Python
    callers use snake_case."""
    t = Tutor.model_validate({"id": "t", "displayName": "T", "frameworkId": "esru", "authorRole": "teacher"})
    assert t.framework_id == "esru" and t.author_role == "teacher"
    assert t.model_dump(by_alias=True)["frameworkId"] == "esru"


def test_tutor_rejects_unknown_fields():
    """Guards the decision NOT to re-declare persona fields: an avatar written
    onto a Tutor must fail loudly rather than create a second source of truth."""
    with pytest.raises(ValidationError):
        _tutor(avatar="/personas/sofie.webp")
