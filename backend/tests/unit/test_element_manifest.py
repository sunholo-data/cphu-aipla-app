"""Unit tests for adk/element_manifest.py (1.1.62 M1).

**Why this module exists at all.** ``compose_teacher_focus`` stacked exactly
four prompt sources — the sim's ``tutor_block``, the solution element, the
concept map, and the teaching goal. ``ELEMENT_REGISTRY`` has eight element
kinds, and ``checklist`` / ``table`` / ``chart`` / ``calculator`` / ``note`` /
``document`` were in none of them. No student tutor template mentioned them
either. The only element -> tutor path was ``useSimSnapshotPush``, which fires
**on student interaction**, so the tutor could not invite a student to use a
tool it had never been told existed.

Aswin, 2026-08-06: *"I designed a class where the students need to fill out the
tables of the experiments in the workbench, upload images, and drawing graph but
they do not connect to the chat. The chat never asked me to work on those
tools."*

The registry-completeness test below is the one that would have caught the
original bug, and is the one that catches element kind #9.
"""

from __future__ import annotations

from datetime import UTC, datetime

from adk.element_manifest import MANIFEST_CHAR_CAP, describe_elements
from db.models.activity_config import (
    ELEMENT_REGISTRY,
    ActivityConfig,
    CalcInput,
    CalculatorElement,
    ChartElement,
    ChecklistItem,
    ConceptMapElement,
    ConceptNode,
    DocumentElement,
    NoteElement,
    SolutionElement,
    TableColumn,
    TableElement,
    WritingElement,
)


def _cfg(**kwargs) -> ActivityConfig:
    base = {
        "activityId": "act-1",
        "classId": "c1",
        "teacherUid": "t1",
        "updatedAt": datetime.now(UTC),
    }
    base.update(kwargs)
    return ActivityConfig(**base)


def _table(id_: str = "tbl1", title: str = "Faldforsøg") -> TableElement:
    return TableElement(
        id=id_,
        title=title,
        columns=[
            TableColumn(id="hojde", label="højde", unit="m", kind="number"),
            TableColumn(id="tid", label="tid", unit="s", kind="number"),
        ],
        rows=5,
    )


# ---------------------------------------------------------------------------
# The core guarantee: elements are described BEFORE any interaction
# ---------------------------------------------------------------------------


def test_empty_config_produces_no_manifest():
    """Graceful degradation — a chat-only activity behaves exactly as before."""
    assert describe_elements(_cfg()) == ""


def test_none_config_produces_no_manifest():
    assert describe_elements(None) == ""


def test_table_is_named_with_its_columns_and_units():
    manifest = describe_elements(_cfg(table=[_table()]))
    assert "Faldforsøg" in manifest
    assert "højde" in manifest
    assert "tid" in manifest
    # Units matter for a physics activity - the tutor already runs a units loop.
    assert "m" in manifest
    assert "s" in manifest


def test_checklist_items_are_listed():
    cfg = _cfg(
        checklist=[
            ChecklistItem(id="a", label="Mål faldtiden tre gange"),
            ChecklistItem(id="b", label="Beregn gennemsnittet"),
        ]
    )
    manifest = describe_elements(cfg)
    assert "Mål faldtiden tre gange" in manifest
    assert "Beregn gennemsnittet" in manifest


def test_calculator_names_its_inputs():
    cfg = _cfg(
        calculator=[
            CalculatorElement(
                id="c1",
                title="Fart",
                formula="s / t",
                inputs=[
                    CalcInput(id="s", label="strækning", unit="m"),
                    CalcInput(id="t", label="tid", unit="s"),
                ],
            )
        ]
    )
    manifest = describe_elements(cfg)
    assert "Fart" in manifest
    assert "strækning" in manifest


def test_chart_is_described():
    cfg = _cfg(table=[_table()], chart=[ChartElement(id="ch1", title="Højde mod tid", chartKind="scatter")])
    manifest = describe_elements(cfg)
    assert "Højde mod tid" in manifest
    assert "scatter" in manifest


def test_note_is_named_but_its_body_is_not_dumped():
    """A note body is up to 4000 chars. Naming it is useful; inlining it would
    blow the manifest budget on its own."""
    cfg = _cfg(note=[NoteElement(id="n1", title="Sikkerhed", body="x" * 3000)])
    manifest = describe_elements(cfg)
    assert "Sikkerhed" in manifest
    assert "x" * 200 not in manifest


def test_solution_and_document_elements_are_described():
    cfg = _cfg(
        solution=[SolutionElement(id="s1", prompt="Skriv din løsning")],
        document=[DocumentElement(id="d1", prompt="Upload dit ark")],
    )
    manifest = describe_elements(cfg)
    assert manifest
    lowered = manifest.lower()
    assert "solution" in lowered or "løsning" in lowered
    assert "upload" in lowered or "document" in lowered


def test_manifest_tells_the_tutor_not_to_wait_to_be_asked():
    """The behavioural half. Naming the elements is not enough — the tutor has
    to know it may bring them up first. That is the actual complaint."""
    manifest = describe_elements(_cfg(table=[_table()])).lower()
    assert "invite" in manifest or "bring" in manifest


def test_manifest_does_not_bake_in_student_values():
    """Current entries arrive fresh over iframe-context every turn.

    The manifest is composed ONCE per session, so baking values in would go
    stale — the same reason living-concept-map deliberately omits node statuses.
    """
    manifest = describe_elements(_cfg(table=[_table()])).lower()
    assert "not shown here" in manifest or "as they work" in manifest


# ---------------------------------------------------------------------------
# Registry completeness — the test that would have caught the original bug
# ---------------------------------------------------------------------------


def _populated_element(kind: str):
    """One minimal populated instance per registered element kind."""
    samples = {
        "checklist": ChecklistItem(id="x", label="Do the thing"),
        "table": _table(),
        "chart": ChartElement(id="ch", title="A chart"),
        "calculator": CalculatorElement(id="c", title="Calc", formula="a", inputs=[CalcInput(id="a", label="A")]),
        "note": NoteElement(id="n", title="A note", body="body"),
        "writing": WritingElement(id="w", title="Konklusion", prompt="Skriv din konklusion"),
        "solution": SolutionElement(id="s", prompt="Solve it"),
        "document": DocumentElement(id="d", prompt="Upload it"),
        "conceptMap": ConceptMapElement(id="cm", title="Map", nodes=[ConceptNode(id="n1", label="Vectors")]),
    }
    return samples[kind]


def test_every_registered_element_kind_is_described():
    """**The guard.**

    Element kind #9 must appear in the tutor's prompt BY DEFAULT and require a
    positive decision to be hidden. 1.1.38 added four element kinds and every
    one of them was silently invisible to the tutor for six weeks, because the
    composition was an ``if cfg.x:`` chain that nobody remembered to extend.

    If this test fails, you added an element the tutor cannot see.
    """
    for kind, spec in ELEMENT_REGISTRY.items():
        cfg = _cfg(**{spec.field: [_populated_element(kind)]})
        manifest = describe_elements(cfg)
        assert manifest.strip(), f"element kind {kind!r} produces no manifest text"


def test_unknown_element_kind_falls_back_to_a_generic_description(monkeypatch):
    """A kind with no bespoke describer degrades to a generic line rather than
    vanishing. Too-generic is a much better failure than invisible."""
    from adk import element_manifest

    monkeypatch.setitem(element_manifest._DESCRIBERS, "table", None)
    monkeypatch.delitem(element_manifest._DESCRIBERS, "table")
    manifest = describe_elements(_cfg(table=[_table()]))
    assert manifest.strip()


# ---------------------------------------------------------------------------
# Bounds — the SkillConfig instruction cap is real (10,000 when this was written,
# 25,000 since 2026-08-06; the manifest bound is its own budget either way)
# ---------------------------------------------------------------------------


def test_manifest_is_capped():
    """50 checklist items x 200 chars each would be 10k on its own."""
    cfg = _cfg(checklist=[ChecklistItem(id=f"i{n}", label="L" * 200) for n in range(50)])
    manifest = describe_elements(cfg)
    assert len(manifest) <= MANIFEST_CHAR_CAP


def test_truncation_says_how_much_was_dropped():
    """Silent truncation reads as 'that's all of them'. Say what was cut."""
    cfg = _cfg(checklist=[ChecklistItem(id=f"i{n}", label="L" * 200) for n in range(50)])
    manifest = describe_elements(cfg)
    assert "more)" in manifest


def test_truncation_keeps_the_behavioural_instruction():
    """Truncation must drop ITEMS, never the instruction that tells the tutor
    what to do with them — otherwise a big activity silently loses the feature."""
    cfg = _cfg(checklist=[ChecklistItem(id=f"i{n}", label="L" * 200) for n in range(50)])
    manifest = describe_elements(cfg).lower()
    assert "invite" in manifest or "bring" in manifest


# ---------------------------------------------------------------------------
# Writing surface (1.1.73)
# ---------------------------------------------------------------------------


def test_writing_surface_is_named_with_its_task():
    manifest = describe_elements(
        _cfg(writing=[WritingElement(id="w", title="Konklusion", prompt="Skriv jeres konklusion", minWords=150)])
    )
    assert "Konklusion" in manifest
    assert "Skriv jeres konklusion" in manifest
    assert "150" in manifest


def test_writing_surface_forbids_ghost_writing():
    """The Axiom 2 guarantee, expressed where it binds.

    Offering to "fix it up for you" is the most natural thing for a helpful
    model to do with a half-written essay, and it turns the student's work into
    the model's. The tutor has no write path into the document by construction;
    this says so in words too, because the model will otherwise offer.
    """
    manifest = describe_elements(_cfg(writing=[WritingElement(id="w", title="Konklusion")])).lower()
    assert "never rewrite it for them" in manifest
    assert "belongs in this conversation" in manifest


def test_writing_surface_says_the_text_arrives_continuously():
    """Otherwise the tutor asks the student to paste their work into the chat —
    which is exactly the copy-paste this element exists to remove."""
    manifest = describe_elements(_cfg(writing=[WritingElement(id="w", title="Konklusion")])).lower()
    assert "as they work" in manifest
