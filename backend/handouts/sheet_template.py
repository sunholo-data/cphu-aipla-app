"""The Word template the activity sheet is styled after (1.1.165).

AILANG Parse's ``convert`` takes a reference document and carries its styles,
page setup, header and footer into the generated file. This module builds that
document in code, so every part of the look is reviewable in a diff and pinned
by ``test_activity_sheet.py``:

- A4, 2 cm sides; a header on every page with the KU seal, "AIPLA" in KU red,
  "Københavns Universitet" under it and the sheet's name on the right, above a
  red rule; a quiet one-line footer.
- Heading 1 is the sheet's title and starts a new page, so one file holds one
  page per group (Markdown has no page break Parse understands).
- Heading 2 is a small-caps red section label with a hairline under it.
- ``AiplaInfo`` is the table style for the group box (group, join link, names):
  a light KU-red tint, hairline rows, labels in the first column.

The seal is ``assets/ku-seal.png``, downscaled from the app's own
``frontend/public/images/logo/aipla-logo.png`` (160 px: about 270 dpi at the
1.5 cm it prints).
"""

from __future__ import annotations

import io
import zipfile
from functools import cache
from pathlib import Path

KU_RED = "901A1E"
KU_RED_TINT = "F8F1F1"
KU_RED_LINE = "E2C6C7"
INK = "1F1F1F"
MUTED = "6B6B6B"

INFO_TABLE_STYLE = "AiplaInfo"

SEAL_PATH = Path(__file__).parent / "assets" / "ku-seal.png"

LABELS: dict[str, dict[str, str]] = {
    "da": {
        "sheet": "Aktivitetsark",
        "university": "Københavns Universitet",
        "footer": "AIPLA · AI in Physics Learning and Assessment · Københavns Universitet",
        "seal": "Københavns Universitets segl",
        "lang": "da-DK",
    },
    "en": {
        "sheet": "Activity sheet",
        "university": "University of Copenhagen",
        "footer": "AIPLA · AI in Physics Learning and Assessment · University of Copenhagen",
        "seal": "Seal of the University of Copenhagen",
        "lang": "en-GB",
    },
}

_NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
_NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

# A4 in twentieths of a point, 2 cm sides; the top leaves room for the header.
_PAGE_W, _PAGE_H = 11906, 16838
_MARGIN_SIDE, _MARGIN_TOP, _MARGIN_BOTTOM = 1134, 1814, 1134
_TEXT_W = _PAGE_W - 2 * _MARGIN_SIDE
_SEAL_EMU = 540000  # 1.5 cm


def _content_types() -> str:
    main = "application/vnd.openxmlformats-officedocument.wordprocessingml"
    return (
        f'{_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        f'<Override PartName="/word/document.xml" ContentType="{main}.document.main+xml"/>'
        f'<Override PartName="/word/styles.xml" ContentType="{main}.styles+xml"/>'
        f'<Override PartName="/word/header1.xml" ContentType="{main}.header+xml"/>'
        f'<Override PartName="/word/footer1.xml" ContentType="{main}.footer+xml"/>'
        "</Types>"
    )


def _rels(*rels: tuple[str, str, str]) -> str:
    body = "".join(f'<Relationship Id="{i}" Type="{_REL}/{t}" Target="{target}"/>' for i, t, target in rels)
    return f'{_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'


def _border(side: str, color: str, size: int = 4, space: int = 0) -> str:
    return f'<w:{side} w:val="single" w:sz="{size}" w:space="{space}" w:color="{color}"/>'


def _styles(lang: str) -> str:
    return (
        f'{_XML}<w:styles xmlns:w="{_NS_W}">'
        "<w:docDefaults>"
        '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>'
        f'<w:color w:val="{INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="{lang}"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
        "</w:docDefaults>"
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        # The sheet's title. One per group, and each starts a page.
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:pageBreakBefore/><w:keepNext/><w:spacing w:before="0" w:after="200" w:line="240" '
        'w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr>'
        f'<w:rPr><w:b/><w:color w:val="{KU_RED}"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>'
        # Section labels: small caps, red, a hairline under.
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>'
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:keepNext/><w:spacing w:before="300" w:after="100"/>'
        f'<w:pBdr>{_border("bottom", KU_RED_LINE, 6, 3)}</w:pBdr><w:outlineLvl w:val="1"/></w:pPr>'
        f'<w:rPr><w:b/><w:caps/><w:color w:val="{KU_RED}"/><w:spacing w:val="12"/>'
        '<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>'
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>'
        '<w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>'
        '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="567"/></w:pPr></w:style>'
        '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/>'
        f'<w:rPr><w:i/><w:color w:val="{MUTED}"/></w:rPr></w:style>'
        # The group box.
        f'<w:style w:type="table" w:styleId="{INFO_TABLE_STYLE}"><w:name w:val="AIPLA info"/>'
        '<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'
        f"{_border('top', KU_RED_LINE)}{_border('left', KU_RED_LINE)}"
        f"{_border('bottom', KU_RED_LINE)}{_border('right', KU_RED_LINE)}"
        f'{_border("insideH", KU_RED_LINE)}<w:insideV w:val="nil"/></w:tblBorders>'
        '<w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="160" w:type="dxa"/>'
        '<w:bottom w:w="90" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar></w:tblPr>'
        f'<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="{KU_RED_TINT}"/></w:tcPr>'
        '<w:pPr><w:spacing w:after="0"/></w:pPr>'
        '<w:tblStylePr w:type="firstCol"><w:rPr><w:b/>'
        f'<w:color w:val="{KU_RED}"/></w:rPr></w:tblStylePr>'
        "</w:style>"
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
        f"{_border('top', 'A6A6A6')}{_border('left', 'A6A6A6')}{_border('bottom', 'A6A6A6')}"
        f"{_border('right', 'A6A6A6')}{_border('insideH', 'A6A6A6')}{_border('insideV', 'A6A6A6')}"
        "</w:tblBorders></w:tblPr></w:style>"
        '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/>'
        '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/>'
        f'<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="{MUTED}"/>'
        '<w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr></w:style>'
        "</w:styles>"
    )


def _seal_drawing(alt: str) -> str:
    e = _SEAL_EMU
    return (
        '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{e}" cy="{e}"/><wp:docPr id="1" name="seal" descr="{alt}"/>'
        f'<a:graphic xmlns:a="{_NS_A}"><a:graphicData uri="{_NS_PIC}">'
        f'<pic:pic xmlns:pic="{_NS_PIC}"><pic:nvPicPr><pic:cNvPr id="0" name="ku-seal.png"/><pic:cNvPicPr/>'
        '</pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdSeal"/><a:stretch><a:fillRect/></a:stretch>'
        f'</pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{e}" cy="{e}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>'
        "</wp:inline></w:drawing>"
    )


def _cell(width: int, body: str, *, valign: str = "center") -> str:
    return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/><w:vAlign w:val="{valign}"/></w:tcPr>{body}</w:tc>'


def _run(text: str, *, size: int, color: str, bold: bool = False, spacing: int = 0) -> str:
    rpr = f'<w:color w:val="{color}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
    if bold:
        rpr = "<w:b/>" + rpr
    if spacing:
        rpr += f'<w:spacing w:val="{spacing}"/>'
    return f'<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'


def _header(labels: dict[str, str]) -> str:
    seal_w, label_w = 1000, 2600
    name_w = _TEXT_W - seal_w - label_w
    para = '<w:p><w:pPr><w:pStyle w:val="Header"/>{jc}</w:pPr>{runs}</w:p>'
    table = (
        "<w:tbl><w:tblPr>"
        f'<w:tblW w:w="{_TEXT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
        f'<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/>{_border("bottom", KU_RED, 12, 0)}'
        '<w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
        '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>'
        '<w:bottom w:w="100" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>'
        "</w:tblPr>"
        f'<w:tblGrid><w:gridCol w:w="{seal_w}"/><w:gridCol w:w="{name_w}"/><w:gridCol w:w="{label_w}"/></w:tblGrid>'
        "<w:tr>"
        + _cell(seal_w, para.format(jc="", runs=f"<w:r>{_seal_drawing(labels['seal'])}</w:r>"))
        + _cell(
            name_w,
            para.format(jc="", runs=_run("AIPLA", size=30, color=KU_RED, bold=True, spacing=10))
            + para.format(jc="", runs=_run(labels["university"], size=16, color=MUTED)),
        )
        + _cell(
            label_w,
            para.format(
                jc='<w:jc w:val="right"/>', runs=_run(labels["sheet"].upper(), size=16, color=MUTED, spacing=20)
            ),
        )
        + "</w:tr></w:tbl>"
    )
    return (
        f'{_XML}<w:hdr xmlns:w="{_NS_W}" xmlns:r="{_NS_R}" xmlns:wp="{_NS_WP}">'
        f'{table}<w:p><w:pPr><w:pStyle w:val="Header"/><w:spacing w:after="0" w:line="120" w:lineRule="exact"/>'
        "</w:pPr></w:p></w:hdr>"
    )


def _footer(labels: dict[str, str]) -> str:
    return (
        f'{_XML}<w:ftr xmlns:w="{_NS_W}"><w:p><w:pPr><w:pStyle w:val="Footer"/>'
        f"<w:pBdr>{_border('top', 'D9D9D9', 4, 6)}</w:pBdr></w:pPr>"
        f'<w:r><w:t xml:space="preserve">{labels["footer"]}</w:t></w:r></w:p></w:ftr>'
    )


def _document() -> str:
    return (
        f'{_XML}<w:document xmlns:w="{_NS_W}" xmlns:r="{_NS_R}"><w:body><w:p/><w:sectPr>'
        '<w:headerReference w:type="default" r:id="rIdHeader"/>'
        '<w:footerReference w:type="default" r:id="rIdFooter"/>'
        f'<w:pgSz w:w="{_PAGE_W}" w:h="{_PAGE_H}"/>'
        f'<w:pgMar w:top="{_MARGIN_TOP}" w:right="{_MARGIN_SIDE}" w:bottom="{_MARGIN_BOTTOM}" '
        f'w:left="{_MARGIN_SIDE}" w:header="680" w:footer="567" w:gutter="0"/>'
        "</w:sectPr></w:body></w:document>"
    )


@cache
def reference_docx(language: str = "da") -> bytes:
    """The template, in the sheet's language (the header names the sheet)."""
    labels = LABELS.get(language, LABELS["da"])
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _content_types())
        z.writestr("_rels/.rels", _rels(("rId1", "officeDocument", "word/document.xml")))
        z.writestr(
            "word/_rels/document.xml.rels",
            _rels(
                ("rIdStyles", "styles", "styles.xml"),
                ("rIdHeader", "header", "header1.xml"),
                ("rIdFooter", "footer", "footer1.xml"),
            ),
        )
        z.writestr("word/_rels/header1.xml.rels", _rels(("rIdSeal", "image", "media/ku-seal.png")))
        z.writestr("word/styles.xml", _styles(labels["lang"]))
        z.writestr("word/header1.xml", _header(labels))
        z.writestr("word/footer1.xml", _footer(labels))
        z.writestr("word/document.xml", _document())
        z.writestr("word/media/ku-seal.png", SEAL_PATH.read_bytes())
    return buf.getvalue()
