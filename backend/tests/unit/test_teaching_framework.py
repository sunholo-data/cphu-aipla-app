"""TeachingFramework catalogue + provenance guard (1.1.91 M0)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from db.models.teaching_framework import Construct, Provenance, TeachingFramework
from frameworks.loader import framework_ids, load_framework, load_frameworks, ready_frameworks

# The TP-cycle working set from docs/literature/tp-framework/README.md (2026-09-08).
# Asserted by name because the catalogue is the thing that went stale last time:
# the design doc's list (IBSE, "Bob Evans", SDT) predates the literature landing.
EXPECTED_IDS = {
    "5e",
    "accountable-talk",
    "authentic-dialogue",
    "cer",
    "esru",
    "poe",
    "toulmin",
}


def test_catalogue_loads_and_validates():
    assert set(framework_ids()) == EXPECTED_IDS
    assert len(load_frameworks()) == len(EXPECTED_IDS)


def test_every_framework_carries_a_vouched_citation():
    for fw in load_frameworks():
        assert fw.provenance, f"{fw.id} has no provenance"
        for p in fw.provenance:
            assert p.citation.strip()
            assert p.vouched_by.strip()


def test_esru_is_the_worked_framework():
    esru = load_framework("esru")
    assert esru is not None
    assert esru.status == "ready_for_review"
    # Four moves, not three: the README glosses ESRU as "Elicit-Student
    # response-Use" but the acronym has four letters and Ruiz-Primo's cycle has
    # four moves. Flagged for AR in the YAML; asserted here so a silent drop of
    # the R is a test failure rather than a quiet re-interpretation.
    assert [c.name for c in esru.constructs] == [
        "elicit",
        "student_response",
        "recognise",
        "use",
    ]
    for c in esru.constructs:
        assert c.behaviours, f"construct {c.name} has no observable behaviours"
        assert c.evaluation_hint, f"construct {c.name} has no 1.1.92 evaluation seam"
    assert len(esru.behaviour_lines()) == sum(len(c.behaviours) for c in esru.constructs)


def test_the_other_six_are_slots_not_claims():
    """A framework with no drafted constructs must SAY it is a placeholder — a
    theory field that looks founded but is empty is worse than no field."""
    for fw in load_frameworks():
        if fw.id == "esru":
            continue
        assert fw.is_placeholder, f"{fw.id} claims content it does not have"
        assert fw.constructs == []
    assert [f.id for f in ready_frameworks()] == ["esru"]


def test_provenance_cannot_be_constructed_without_a_human_voucher():
    """The hard requirement from 1.1.91: a fabricated citation must be
    unconstructable, enforced in the type system BEFORE the M2 co-pilot exists
    to violate it."""
    with pytest.raises(ValidationError):
        Provenance(citation="Some plausible-looking 2019 paper")  # type: ignore[call-arg]
    with pytest.raises(ValidationError):
        Provenance(citation="x", vouched_by="")


def test_layer_is_a_closed_enum():
    """The literature set keeps the TP cycle and the conceptual framework (SDT,
    embodied cognition) apart; nothing may invent a third stack by typo."""
    with pytest.raises(ValidationError):
        TeachingFramework(id="x", label="X", layer="umbrella")  # type: ignore[arg-type]
    assert TeachingFramework(id="x", label="X").layer == "tp_cycle"


def test_unknown_and_unset_framework_ids_degrade_to_none():
    assert load_framework("no-such-framework") is None
    assert load_framework(None) is None
    assert load_framework("") is None


def test_construct_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        Construct(name="autonomy", behavior="typo'd field")  # type: ignore[call-arg]
