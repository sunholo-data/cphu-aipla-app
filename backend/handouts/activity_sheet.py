"""A one-page activity sheet per group, as Markdown or Word (1.1.165).

Design: ``docs/design/aipla/v2.1.0-extension/activity-sheet.md``.

The sheet is built from the same ``ActivityConfig`` the student's
``/active`` route serves, and reads ONLY fields a student already sees.
``teaching_goal``, ``tutor_notes``, a check question's answer and explanation,
and a calculator's formula are never read here: ``test_activity_sheet.py``
plants each one and asserts it does not reach the sheet.

Word comes from AILANG Parse (``POST /api/v1/convert``) with a reference
template built in code (A4, KU-red headings, Heading 1 starts a new page, so
each group gets its own page). Join codes are credentials, so the Markdown sent
to Parse carries placeholders and the real codes are written into the docx
locally afterwards. If any placeholder survives, conversion fails rather than
printing a sheet that does not work.
"""

from __future__ import annotations

import io
import logging
import os
import re
import tempfile
import zipfile
from dataclasses import dataclass
from xml.sax.saxutils import escape as xml_escape

from db.models.activity_config import ActivityConfig

log = logging.getLogger(__name__)

NOTE_MAX_CHARS = 600

COPY: dict[str, dict[str, str]] = {
    "da": {
        "group": "Gruppe",
        "join": "Log ind",
        "names": "Navne",
        "what": "Det skal I",
        "steps": "Sådan gør I",
        "workspace": "I arbejdsområdet",
        "ask": "Spørg tutoren",
        "sim": "Simulation",
        "table": "Tabel",
        "columns": "kolonner",
        "writing": "Skriv",
        "note": "Note",
        "calculator": "Lommeregner",
        "solution": "Aflever jeres løsning",
        "document": "Dokument",
        "concept_map": "Begrebskort",
        "materials": "Materialer",
        "footer": "Arbejd i AIPLA",
        "untitled": "Aktivitet",
    },
    "en": {
        "group": "Group",
        "join": "Join",
        "names": "Names",
        "what": "What you'll do",
        "steps": "Steps",
        "workspace": "In the workspace",
        "ask": "Ask the tutor",
        "sim": "Simulation",
        "table": "Table",
        "columns": "columns",
        "writing": "Write",
        "note": "Note",
        "calculator": "Calculator",
        "solution": "Hand in your solution",
        "document": "Document",
        "concept_map": "Concept map",
        "materials": "Materials",
        "footer": "Work in AIPLA",
        "untitled": "Activity",
    },
}

_ORIGIN_RE = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d{1,5})?$")
# Only the escapes AILANG Parse honours (checked live 2026-11-27): it prints
# ``\#``, ``\|``, ``\<``, ``\.`` with the backslash showing. Raw HTML comes out
# as literal text in Word, and react-markdown does not render it either.
_MD_SPECIAL = re.compile(r"([\\`*_\[\]~])")
_LEADING_HASHES = re.compile(r"^\s*#+\s*")
_PLACEHOLDER_RE = re.compile(r"AIPLAGROUP\d{2,3}X")


class SheetUnavailable(RuntimeError):
    """The Word conversion could not be done (no key, Parse down, bad output)."""


@dataclass(frozen=True)
class Sheet:
    code: str | None
    markdown: str


def safe_origin(origin: str | None) -> str | None:
    """The page's origin, or None if it is not a bare http(s) origin."""
    if not origin:
        return None
    origin = origin.strip().rstrip("/")
    return origin if _ORIGIN_RE.match(origin) else None


def _inline(text: str) -> str:
    """Teacher text as one line of literal Markdown.

    Leading ``#`` are dropped rather than escaped: a heading would start a new
    page in the Word template, and Parse prints an escaped hash with its backslash.
    """
    flat = " ".join((text or "").split())
    flat = _LEADING_HASHES.sub("", flat)
    return _MD_SPECIAL.sub(r"\\\1", flat)


def _block(text: str) -> str:
    """Teacher text as literal paragraphs, blank lines kept."""
    paragraphs = [p for p in re.split(r"\n\s*\n", (text or "").strip()) if p.strip()]
    return "\n\n".join(line for line in (_inline(p) for p in paragraphs) if line)


def _shorten(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _workspace_lines(cfg: ActivityConfig, c: dict[str, str], sim_title: str | None) -> list[str]:
    lines: list[str] = []
    if sim_title:
        lines.append(f"- **{c['sim']}:** {_inline(sim_title)}")
    for t in cfg.table:
        cols = " · ".join(_inline(f"{col.label} ({col.unit})" if col.unit else col.label) for col in t.columns)
        name = f"{c['table']}: {_inline(t.title)}" if t.title.strip() else c["table"]
        lines.append(f"- **{name}** ({c['columns']}: {cols})")
    for w in cfg.writing:
        name = _inline(w.title) if w.title.strip() else c["writing"]
        lines.append(f"- **{name}:** {_inline(w.prompt)}" if w.prompt.strip() else f"- **{name}**")
    for n in cfg.note:
        name = _inline(n.title) if n.title.strip() else c["note"]
        lines.append(f"- **{name}:** {_inline(_shorten(n.body, NOTE_MAX_CHARS))}")
    for calc in cfg.calculator:
        lines.append(
            f"- **{c['calculator']}:** {_inline(calc.title)}" if calc.title.strip() else f"- **{c['calculator']}**"
        )
    for s in cfg.solution:
        lines.append(f"- **{c['solution']}:** {_inline(s.prompt)}" if s.prompt.strip() else f"- **{c['solution']}**")
    for d in cfg.document:
        lines.append(f"- **{c['document']}:** {_inline(d.prompt)}" if d.prompt.strip() else f"- **{c['document']}**")
    for cm in cfg.concept_map:
        lines.append(
            f"- **{c['concept_map']}:** {_inline(cm.title)}" if cm.title.strip() else f"- **{c['concept_map']}**"
        )
    names = []
    for m in cfg.materials:
        if not m.student_visible:
            continue
        label = (m.alt or m.title) if m.kind == "image" else (m.title or m.origin)
        if label.strip():
            names.append(_inline(label))
    if names:
        lines.append(f"- **{c['materials']}:** " + " · ".join(names))
    return lines


def build_sheet(
    cfg: ActivityConfig,
    *,
    code: str | None,
    origin: str | None,
    sim_title: str | None = None,
) -> str:
    """One group's sheet as Markdown. ``code=None`` leaves a blank to fill in."""
    c = COPY.get(cfg.language, COPY["da"])
    origin = safe_origin(origin)
    title = _inline(cfg.title) if cfg.title.strip() else c["untitled"]
    parts = [f"# {title}"]

    if code:
        group = f"**{c['group']}:** {code}"
        if origin:
            group += f" · **{c['join']}:** {origin}/group?code={code}"
    else:
        group = f"**{c['group']}:** \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_"
    parts.append(group)
    parts.append(f"**{c['names']}:** " + "\\_" * 48)

    if cfg.student_opening.strip():
        parts += [f"## {c['what']}", _block(cfg.student_opening)]

    if cfg.checklist:
        parts.append(f"## {c['steps']}")
        parts.append("\n".join(f"- ☐ {_inline(item.label)}" for item in cfg.checklist))

    ws = _workspace_lines(cfg, c, sim_title)
    if ws:
        parts += [f"## {c['workspace']}", "\n".join(ws)]

    if cfg.starter_prompts:
        parts.append(f"## {c['ask']}")
        parts.append("\n".join(f"- {_inline(p)}" for p in cfg.starter_prompts))

    if origin:
        parts.append(f"*{c['footer']}: {origin}*")
    return "\n\n".join(parts) + "\n"


def build_sheets(
    cfg: ActivityConfig,
    *,
    codes: list[str],
    origin: str | None,
    sim_title: str | None = None,
) -> list[Sheet]:
    """One sheet per code, or a single blank sheet when there are no codes."""
    if not codes:
        return [Sheet(code=None, markdown=build_sheet(cfg, code=None, origin=origin, sim_title=sim_title))]
    return [
        Sheet(code=code, markdown=build_sheet(cfg, code=code, origin=origin, sim_title=sim_title)) for code in codes
    ]


# ── Word ─────────────────────────────────────────────────────────────────────

_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
_KU_RED = "901A1E"


def reference_docx() -> bytes:
    """The Word template AILANG Parse styles the sheet after.

    A4 with 2 cm margins, Arial, KU-red headings, a small footer, and
    ``pageBreakBefore`` on Heading 1 so every group's sheet (one H1 each)
    starts on its own page. Markdown has no page break Parse understands;
    this is how one file holds one page per group.
    """
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/footer1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/></Relationships>'
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '<Relationship Id="rId2" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
        "</Relationships>"
    )
    grey = '"808080"'
    border = f'w:val="single" w:sz="4" w:color={grey}'
    styles = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {_W}>'
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'
        '<w:sz w:val="22"/><w:lang w:val="da-DK"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
        "</w:docDefaults>"
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>'
        '<w:pPr><w:pageBreakBefore/><w:keepNext/><w:spacing w:before="0" w:after="120"/>'
        '<w:outlineLvl w:val="0"/></w:pPr>'
        f'<w:rPr><w:b/><w:color w:val="{_KU_RED}"/><w:sz w:val="36"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>'
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>'
        '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/>'
        f'<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="{_KU_RED}"/></w:pBdr>'
        '<w:outlineLvl w:val="1"/></w:pPr>'
        f'<w:rPr><w:b/><w:color w:val="{_KU_RED}"/><w:sz w:val="26"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>'
        '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/></w:pPr></w:style>'
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
        f"<w:top {border}/><w:left {border}/><w:bottom {border}/><w:right {border}/>"
        f"<w:insideH {border}/><w:insideV {border}/></w:tblBorders></w:tblPr></w:style>"
        '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/>'
        '<w:rPr><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr></w:style>'
        "</w:styles>"
    )
    footer = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr {_W}>'
        '<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>'
        '<w:r><w:t xml:space="preserve">AIPLA · Københavns Universitet</w:t></w:r></w:p></w:ftr>'
    )
    document = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {_W} '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<w:body><w:p/><w:sectPr>"
        '<w:footerReference w:type="default" r:id="rId2"/>'
        '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
        'w:header="567" w:footer="567" w:gutter="0"/>'
        "</w:sectPr></w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/_rels/document.xml.rels", doc_rels)
        z.writestr("word/styles.xml", styles)
        z.writestr("word/footer1.xml", footer)
        z.writestr("word/document.xml", document)
    return buf.getvalue()


def placeholder(index: int) -> str:
    """A code stand-in Parse sees instead of the real join code."""
    return f"AIPLAGROUP{index + 1:02d}X"


def substitute_codes(docx: bytes, mapping: dict[str, str]) -> bytes:
    """Write the real join codes into the converted docx, locally.

    Fails closed: raises ``SheetUnavailable`` if a placeholder is missing from
    the converted file (a code would silently be absent) or if any placeholder
    survives substitution anywhere in the package.
    """
    src = zipfile.ZipFile(io.BytesIO(docx))
    out = io.BytesIO()
    seen: set[str] = set()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename.endswith((".xml", ".rels")):
                text = data.decode("utf-8")
                for ph, code in mapping.items():
                    if ph in text:
                        seen.add(ph)
                        text = text.replace(ph, xml_escape(code))
                if _PLACEHOLDER_RE.search(text):
                    raise SheetUnavailable(f"unreplaced code placeholder in {info.filename}")
                data = text.encode("utf-8")
            dst.writestr(info, data)
    missing = set(mapping) - seen
    if missing:
        raise SheetUnavailable(f"converted sheet lost {len(missing)} group code(s)")
    return out.getvalue()


def to_docx(
    cfg: ActivityConfig,
    *,
    codes: list[str],
    origin: str | None,
    sim_title: str | None = None,
) -> bytes:
    """The sheets as one Word file, one page per group. Blocking: call off the loop."""
    mapping = {placeholder(i): code for i, code in enumerate(codes)}
    stand_ins = list(mapping) if codes else []
    sheets = build_sheets(cfg, codes=stand_ins, origin=origin, sim_title=sim_title)
    markdown = "\n".join(s.markdown for s in sheets)
    raw = _convert(markdown)
    return substitute_codes(raw, mapping) if mapping else raw


def _convert(markdown: str) -> bytes:
    """Markdown → docx through AILANG Parse, styled by ``reference_docx()``."""
    from tools.documents.ailang_parse import _get_client

    client = _get_client()
    if client is None:
        raise SheetUnavailable("AILANG Parse is not configured")
    with tempfile.TemporaryDirectory() as tmp:
        md_path = os.path.join(tmp, "sheet.md")
        ref_path = os.path.join(tmp, "reference.docx")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown)
        with open(ref_path, "wb") as f:
            f.write(reference_docx())
        try:
            result = client.convert_file(md_path, target="docx", reference_doc=ref_path)
        except Exception as exc:  # any Parse failure is "unavailable"
            log.warning("activity sheet: AILANG Parse convert failed: %s", exc)
            raise SheetUnavailable(str(exc)) from exc
    content = getattr(result, "content", None)
    if not content or not bytes(content[:2]) == b"PK":
        raise SheetUnavailable("AILANG Parse returned no document")
    return bytes(content)
