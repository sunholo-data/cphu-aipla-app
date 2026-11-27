"""1.1.165 — the one-page activity sheet builder and its Word handling."""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from db.models.activity_config import ActivityConfig
from handouts import activity_sheet as sheet
from handouts.activity_sheet import (
    SheetUnavailable,
    build_sheet,
    build_sheets,
    placeholder,
    safe_origin,
    substitute_codes,
    to_docx,
)
from handouts.sheet_template import INFO_TABLE_STYLE, reference_docx

ORIGIN = "https://aipla.ku.dk"


def _cfg(**over) -> ActivityConfig:
    base = {
        "activityId": "act-1",
        "classId": "c1",
        "teacherUid": "t1",
        "updatedAt": datetime.now(UTC),
        "title": "Boldkast",
        "language": "da",
    }
    base.update(over)
    return ActivityConfig.model_validate(base)


def _full_cfg(**over) -> ActivityConfig:
    return _cfg(
        teachingGoal="TEACHER-ONLY-GOAL",
        tutorNotes="TEACHER-ONLY-NOTES",
        studentOpening="I skal undersøge kastevinklen.",
        starterPrompts=["Hvorfor giver 45° længst kast?"],
        checklist=[{"id": "a", "label": "Åbn simulationen"}, {"id": "b", "label": "Mål ved 30°"}],
        table=[
            {
                "id": "t",
                "title": "Målinger",
                "columns": [{"id": "x", "label": "Vinkel", "unit": "°"}, {"id": "y", "label": "Længde", "unit": "m"}],
            }
        ],
        writing=[{"id": "w", "title": "Forklaring", "prompt": "Forklar jeres resultat."}],
        note=[{"id": "n", "title": "Husk", "body": "Luftmodstand ignoreres."}],
        calculator=[
            {"id": "c", "title": "Rækkevidde", "formula": "SECRET_FORMULA*2", "inputs": [{"id": "v", "label": "v"}]}
        ],
        conceptMap=[
            {
                "id": "cm",
                "title": "Kast",
                "nodes": [
                    {
                        "id": "n1",
                        "label": "Vinkel",
                        "checkQuestions": [
                            {
                                "id": "q",
                                "prompt": "Hvad sker der?",
                                "expectedAnswer": "SECRET-ANSWER",
                                "explanation": "SECRET-EXPLANATION",
                            }
                        ],
                    }
                ],
            }
        ],
        materials=[
            {"kind": "curriculum", "docId": "d1", "title": "Haka Fysik kap. 3", "studentVisible": True},
            {"kind": "curriculum", "docId": "d2", "title": "Lærerens facitliste", "studentVisible": False},
        ],
        **over,
    )


# ── content ──────────────────────────────────────────────────────────────────


def test_sheet_carries_what_the_student_sees():
    md = build_sheet(_full_cfg(), code="brave-thicket-77", origin=ORIGIN, sim_title="Boldkast-sim")
    assert md.startswith("# Boldkast\n")
    assert "| **Gruppe** | **brave-thicket-77** |" in md
    assert "| **Log ind** | https://aipla.ku.dk/group?code=brave-thicket-77 |" in md
    assert "## Det skal I" in md and "kastevinklen" in md
    assert "☐ Åbn simulationen\n\n☐ Mål ved 30°" in md
    assert "**Simulation:** Boldkast-sim" in md
    assert "Vinkel (°) · Længde (m)" in md
    assert "**Forklaring:** Forklar jeres resultat." in md
    assert "**Lommeregner:** Rækkevidde" in md
    assert "**Begrebskort:** Kast" in md
    assert "Haka Fysik kap. 3" in md
    assert "## Spørg tutoren" in md


def test_teacher_only_fields_never_reach_the_sheet():
    md = build_sheet(_full_cfg(), code="c", origin=ORIGIN)
    for secret in (
        "TEACHER-ONLY-GOAL",
        "TEACHER-ONLY-NOTES",
        "SECRET",  # formula, expected answer, explanation
        "facitliste",  # a material the student may not open
    ):
        assert secret not in md, secret


def test_english_activity_gets_english_headings():
    md = build_sheet(_full_cfg(language="en"), code="c", origin=ORIGIN)
    assert "| **Group** | **c** |" in md and "## Steps" in md and "## Ask the tutor" in md
    assert "Gruppe" not in md


def test_empty_sections_are_left_out():
    md = build_sheet(_cfg(), code="c", origin=ORIGIN)
    assert "##" not in md


def test_no_codes_gives_one_blank_sheet():
    sheets = build_sheets(_cfg(), codes=[], origin=ORIGIN)
    assert len(sheets) == 1 and sheets[0].code is None
    assert "| **Gruppe** |   |" in sheets[0].markdown
    assert "group?code=" not in sheets[0].markdown
    # Without a code there is no join link in the box, so the address is given below.
    assert "*Arbejd i AIPLA: https://aipla.ku.dk*" in sheets[0].markdown


def test_one_sheet_per_code_each_with_its_own_code():
    sheets = build_sheets(_cfg(), codes=["a-1", "b-2"], origin=ORIGIN)
    assert [s.code for s in sheets] == ["a-1", "b-2"]
    assert "a-1" in sheets[0].markdown and "b-2" not in sheets[0].markdown


def test_names_line_is_blank_names_never_come_from_the_server():
    md = build_sheet(_cfg(), code="c", origin=ORIGIN)
    assert "| **Navne** |   |" in md


def test_group_box_is_one_table_and_the_link_is_not_repeated():
    md = build_sheet(_cfg(), code="c", origin=ORIGIN)
    table = [line for line in md.splitlines() if line.startswith("|")]
    assert table == [
        "| **Gruppe** | **c** |",
        "|:--|:--|",
        "| **Log ind** | https://aipla.ku.dk/group?code=c |",
        "| **Navne** |   |",
    ]
    assert md.count("https://aipla.ku.dk") == 1


@pytest.mark.parametrize(
    "origin,expected",
    [
        ("https://aipla.ku.dk", "https://aipla.ku.dk"),
        ("http://localhost:3456/", "http://localhost:3456"),
        ("https://evil.example/path", None),
        ("javascript:alert(1)", None),
        ("https://x.dk?q=1", None),
        (None, None),
    ],
)
def test_origin_must_be_a_bare_origin(origin, expected):
    assert safe_origin(origin) == expected


def test_bad_origin_drops_the_link_but_keeps_the_code():
    md = build_sheet(_cfg(), code="c-1", origin="https://evil.example/x")
    assert "| **Gruppe** | **c-1** |" in md and "group?code" not in md and "evil" not in md


def test_teacher_text_cannot_start_a_heading_or_inject_markup():
    cfg = _cfg(
        title="# Sneaky [link](http://x) *bold*",
        studentOpening="## Not a heading\n\nline with `code` and a_b",
        checklist=[{"id": "a", "label": "# step"}],
    )
    md = build_sheet(cfg, code="c", origin=ORIGIN)
    lines = md.splitlines()
    headings = [line for line in lines if line.startswith("#")]
    # Only the sheet's own title (H1) and section headings (H2).
    assert headings[0] == "# Sneaky \\[link\\](http://x) \\*bold\\*"
    assert all(h.startswith("## ") and h[3:] in {"Det skal I", "Sådan gør I"} for h in headings[1:])
    assert "Not a heading" in md and "\\`code\\`" in md and "a\\_b" in md
    assert "☐ step" in md


def test_long_note_is_shortened():
    cfg = _cfg(note=[{"id": "n", "title": "", "body": "x" * 2000}])
    md = build_sheet(cfg, code="c", origin=ORIGIN)
    assert "x" * sheet.NOTE_MAX_CHARS not in md
    assert "…" in md


# ── Word ─────────────────────────────────────────────────────────────────────


def test_reference_template_is_a4_and_breaks_page_per_group():
    z = zipfile.ZipFile(io.BytesIO(reference_docx("da")))
    styles = z.read("word/styles.xml").decode()
    doc = z.read("word/document.xml").decode()
    h1 = styles.split('w:styleId="Heading1"')[1].split("</w:style>")[0]
    assert "<w:pageBreakBefore/>" in h1
    assert '<w:pgSz w:w="11906" w:h="16838"/>' in doc  # A4
    assert "901A1E" in styles  # KU red
    assert f'w:styleId="{INFO_TABLE_STYLE}"' in styles


def test_reference_template_header_carries_the_seal_and_the_sheet_name():
    for lang, name in (("da", "AKTIVITETSARK"), ("en", "ACTIVITY SHEET")):
        z = zipfile.ZipFile(io.BytesIO(reference_docx(lang)))
        header = z.read("word/header1.xml").decode()
        rels = z.read("word/_rels/header1.xml.rels").decode()
        assert name in header and "AIPLA" in header
        assert 'r:embed="rIdSeal"' in header and "media/ku-seal.png" in rels
        assert z.read("word/media/ku-seal.png")[:4] == b"\x89PNG"
        assert 'r:id="rIdHeader"' in z.read("word/document.xml").decode()
        # Every part is well-formed XML.
        import xml.dom.minidom

        for part in z.namelist():
            if part.endswith((".xml", ".rels")):
                xml.dom.minidom.parseString(z.read(part))


def _docx(document_xml: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", document_xml)
        z.writestr("[Content_Types].xml", "<Types/>")
    return buf.getvalue()


def test_codes_are_substituted_locally():
    raw = _docx(f"<w:t>{placeholder(0)}</w:t><w:t>x?code={placeholder(0)}</w:t><w:t>{placeholder(1)}</w:t>")
    out = substitute_codes(raw, {placeholder(0): "brave-thicket-77", placeholder(1): "green-beetle-49"})
    doc = zipfile.ZipFile(io.BytesIO(out)).read("word/document.xml").decode()
    assert doc.count("brave-thicket-77") == 2 and "green-beetle-49" in doc
    assert "AIPLAGROUP" not in doc


def test_substitution_fails_closed_when_a_code_went_missing():
    raw = _docx(f"<w:t>{placeholder(0)}</w:t>")
    with pytest.raises(SheetUnavailable):
        substitute_codes(raw, {placeholder(0): "a", placeholder(1): "b"})


def test_substitution_fails_closed_on_a_stray_placeholder():
    raw = _docx(f"<w:t>{placeholder(0)} {placeholder(5)}</w:t>")
    with pytest.raises(SheetUnavailable):
        substitute_codes(raw, {placeholder(0): "a"})


def test_parse_never_sees_a_join_code():
    sent: list[str] = []

    def fake_convert(markdown: str, **_kw) -> bytes:
        sent.append(markdown)
        return _docx("<w:t>" + " ".join(p for p in (placeholder(0), placeholder(1)) if p in markdown) + "</w:t>")

    with patch.object(sheet, "_convert", side_effect=fake_convert):
        out = to_docx(_cfg(), codes=["brave-thicket-77", "green-beetle-49"], origin=ORIGIN)
    assert "brave-thicket-77" not in sent[0] and "green-beetle-49" not in sent[0]
    assert sent[0].count("\n# ") + sent[0].startswith("# ") == 2  # one H1 (page) per group
    doc = zipfile.ZipFile(io.BytesIO(out)).read("word/document.xml").decode()
    assert "brave-thicket-77" in doc and "green-beetle-49" in doc


def test_convert_without_a_key_is_unavailable(monkeypatch):
    with patch("tools.documents.ailang_parse._get_client", return_value=None):
        with pytest.raises(SheetUnavailable):
            sheet._convert("# x\n")


def test_convert_failure_is_unavailable():
    client = MagicMock()
    client.convert_file.side_effect = RuntimeError("503 from parse")
    with patch("tools.documents.ailang_parse._get_client", return_value=client):
        with pytest.raises(SheetUnavailable):
            sheet._convert("# x\n")


def test_convert_sends_the_reference_template():
    client = MagicMock()
    seen = {}

    def fake(md_path, *, target, reference_doc, table_style):
        seen["target"] = target
        seen["table_style"] = table_style
        with open(reference_doc, "rb") as f:
            seen["ref"] = f.read()
        return MagicMock(content=_docx("<w:t>x</w:t>"))

    client.convert_file.side_effect = fake
    with patch("tools.documents.ailang_parse._get_client", return_value=client):
        out = sheet._convert("# x\n", language="en")
    assert seen["target"] == "docx" and seen["ref"] == reference_docx("en")
    assert seen["table_style"] == INFO_TABLE_STYLE
    assert out[:2] == b"PK"
