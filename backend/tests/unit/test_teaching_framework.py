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
    # Four moves, not three. VERIFIED 2026-09-09 against Ruiz-Primo & Furtak
    # (2007) JRST 44(1) 57-84: "Teacher Elicits Response / Student Responds /
    # Teacher Recognizes Student Response / Teacher Uses Student Response".
    # The literature README originally glossed ESRU as three moves; Recognise is
    # a distinct step (revoicing + comparing to accepted scientific ideas), not
    # a sub-step of Use. Pinned so it cannot be quietly re-interpreted.
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


def test_esru_cites_the_2007_jrst_paper_not_the_conflated_row():
    """The literature README originally cited "Ruiz-Primo 2006 … (J Res Sci
    Teach)" — a chimera of two real papers: the 2006 one is in *Educational
    Assessment*, and JRST is the 2007 one. ESRU-as-used-here comes from the 2007
    paper, so the primary citation must name it. Pinned because a citation in a
    research instrument that ends up in a journal paper is the failure 1.1.91
    cares most about, and this one was already wrong once."""
    esru = load_framework("esru")
    assert esru is not None
    primary = esru.provenance[0].citation
    assert "2007" in primary
    assert "Journal of Research in Science Teaching" in primary
    assert "10.1002/tea.20163" in primary

    joined = " ".join(p.citation for p in esru.provenance)
    # The companion paper must be attributed to its OWN venue, not JRST.
    # Assert on the DOI rather than the page range: it is unambiguous, and it
    # is what actually distinguishes the two papers.
    assert "Educational Assessment" in joined
    assert "10.1080/10627197.2006.9652991" in joined
    # ESRU operationalises Duschl & Gitomer's "assessment conversation" — the
    # antecedent is part of what makes the framework defensible.
    assert "Duschl" in joined


def test_esru_use_construct_carries_the_finding_that_makes_it_worth_scoring():
    """Ruiz-Primo & Furtak found teachers ran INCOMPLETE cycles and that the
    final step (Use) was what learning gains depended on. That is why Use gets a
    counterfactual evaluation hint rather than a presence check."""
    esru = load_framework("esru")
    assert esru is not None
    use = next(c for c in esru.constructs if c.name == "use")
    assert use.evaluation_hint is not None
    assert "different" in use.evaluation_hint.lower()
    # The IRE/F contrast is the operative distinction: a tutor that judges an
    # answer rather than acting on it has degenerated to Initiation-Response-
    # Evaluation/Feedback, which is the failure mode 1.1.92 should catch.
    assert "IRE/F" in esru.summary or any("IRE/F" in (c.evaluation_hint or "") for c in esru.constructs)


#: Frameworks whose teaching moves have been extracted from their source. Grew
#: one at a time, each by reading the paper — never by inference from a title.
#: As of 2026-09-10 this is the WHOLE catalogue: the five second-wave frameworks
#: were drafted from the parsed PDFs in docs/literature/tp-framework/, so there
#: is no placeholder left to test against. The tests below that need a
#: placeholder now build a synthetic one rather than borrowing a real id, which
#: is what made them break when the catalogue filled up.
WORKED = {
    "esru",
    "authentic-dialogue",
    "5e",
    "accountable-talk",
    "cer",
    "poe",
    "toulmin",
}


def test_status_and_content_always_agree():
    """A framework with no drafted constructs must SAY it is a placeholder — a
    theory field that looks founded but is empty is worse than no field. And the
    converse: a framework claiming content must have some."""
    for fw in load_frameworks():
        if fw.id in WORKED:
            assert not fw.is_placeholder, f"{fw.id} is worked but still marked placeholder"
            assert fw.constructs, f"{fw.id} claims content it does not have"
        else:
            assert fw.is_placeholder, f"{fw.id} claims content it does not have"
            assert fw.constructs == []
    assert {f.id for f in ready_frameworks()} == WORKED


def test_every_worked_framework_is_fully_formed():
    """Applies to each worked framework, so a third one cannot ship half-done."""
    for fw in load_frameworks():
        if fw.id not in WORKED:
            continue
        assert fw.provenance, f"{fw.id} has no source"
        for c in fw.constructs:
            assert c.behaviours, f"{fw.id}.{c.name} has no observable behaviours"
            assert c.evaluation_hint, f"{fw.id}.{c.name} has no 1.1.92 evaluation seam"
            assert c.summary, f"{fw.id}.{c.name} has no summary"
        assert any(c.avoid for c in fw.constructs), f"{fw.id} names nothing to avoid"


def test_authentic_dialogue_carries_dysthes_three_constructs_and_the_ire_contrast():
    """Dysthe's own three (authentic questions, uptake, high-level evaluation)
    plus the dialogic aim they serve. She names the SAME anti-pattern as ESRU —
    praise as judgement — which is what makes the two comparable arms rather
    than merely different ones."""
    fw = load_framework("authentic-dialogue")
    assert fw is not None
    assert [c.name for c in fw.constructs] == [
        "authentic_question",
        "uptake",
        "high_level_evaluation",
        "multivoicedness",
    ]
    hle = next(c for c in fw.constructs if c.name == "high_level_evaluation")
    assert any("Good" in a for a in hle.avoid)
    # Nystrand & Gamoran are where the constructs come from; citing Dysthe alone
    # would credit the wrong people for the coding scheme.
    assert any("Nystrand" in p.citation for p in fw.provenance)


def test_authentic_dialogue_has_no_inquiry_dimensions():
    """The asymmetry with ESRU is deliberate: Dysthe's model has no
    epistemic/conceptual axis, and adding one for symmetry would be exactly the
    unfounded claim this catalogue exists to prevent."""
    fw = load_framework("authentic-dialogue")
    assert fw is not None
    assert all(b.dimension is None for c in fw.constructs for b in c.behaviours)


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


# ── the two-dimensional model (added 2026-09-09 after reading the PDF) ───────


def test_esru_crosses_moves_with_inquiry_dimensions():
    """The source's model is 4 moves x 2 coded inquiry dimensions. Table 2 lists
    11 epistemic and 4 conceptual eliciting strategies; both counts are pinned so
    a future edit cannot quietly collapse the second axis."""
    esru = load_framework("esru")
    assert esru is not None
    assert len(esru.behaviours_in("epistemic")) == 11
    assert len(esru.behaviours_in("conceptual")) == 4


def test_dimensions_tag_eliciting_only():
    """Ruiz-Primo & Furtak scope this explicitly: "the dimensions of scientific
    inquiry are used only to distinguish the strategies used in the eliciting
    phase ... whereas recognizing and using strategies ... can be used as a
    reaction to any type of initial question". Tagging recognise/use would be a
    misreading, so it is a test failure."""
    esru = load_framework("esru")
    assert esru is not None
    for construct in esru.constructs:
        tagged = [b for b in construct.behaviours if b.dimension]
        if construct.name == "elicit":
            assert len(tagged) == len(construct.behaviours)
        else:
            assert tagged == [], f"{construct.name} must not carry inquiry dimensions"


def test_every_move_names_what_to_avoid():
    """The appendix codes counter-indicative strategies (evaluative "Yes! Good!",
    yes/no questions, interrupting) and they are what separates ESRU from IRE/F.
    They are also an LLM's defaults, so every move must name at least one."""
    esru = load_framework("esru")
    assert esru is not None
    for construct in esru.constructs:
        assert construct.avoid, f"{construct.name} names nothing to avoid"


def test_the_ire_f_evaluative_default_is_named_explicitly():
    """The single likeliest LLM failure: answering with praise instead of
    recognising. It must appear as an anti-pattern, not be left implicit."""
    esru = load_framework("esru")
    assert esru is not None
    recognise = next(c for c in esru.constructs if c.name == "recognise")
    joined = " ".join(recognise.avoid).lower()
    assert "good" in joined and "evaluative" in joined


def test_behaviours_accept_bare_strings_and_tagged_forms():
    """A framework with no dimension axis stays simple to author in YAML."""
    esru = load_framework("esru")
    assert esru is not None
    student = next(c for c in esru.constructs if c.name == "student_response")
    assert all(b.dimension is None for b in student.behaviours)
    assert student.behaviours[0].text.startswith("Stop after the question")


def test_render_groups_by_dimension_and_ends_each_move_with_its_avoid_list():
    from frameworks.instruction import build_framework_instruction

    out = build_framework_instruction(load_framework("esru"))
    assert "Questions about how the student knows" in out
    assert "Questions about what the student knows" in out
    assert "Avoid:" in out
    # The dimension headings must appear ONLY under eliciting.
    assert out.count("Questions about how the student knows") == 1
