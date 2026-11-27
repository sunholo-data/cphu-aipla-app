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
from handouts.sheet_template import INFO_TABLE_STYLE, reference_docx

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
# Teacher text keeps its inline Markdown (bold labels, italics, code): the
# workspace renders it as Markdown too, and escaping it printed literal "**" on
# the first real activity checked (2026-11-27). Only what changes the PAGE is
# neutralised: a heading (in Word, a heading 1 starts a new page) and an image.
_IMAGE = re.compile(r"!\[")
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
    """Teacher text as one line of Markdown that cannot change the page.

    Whitespace collapses (no new block can start), leading ``#`` are dropped (no
    heading), and ``![`` becomes ``[`` (no image is fetched into the sheet).
    """
    flat = " ".join((text or "").split())
    flat = _LEADING_HASHES.sub("", flat)
    return _IMAGE.sub("[", flat)


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

    # The group box: a two-column table the Word template styles (``AiplaInfo``).
    # The names cell is left empty on purpose: names against codes live only in
    # the teacher's browser (1.1.137), and this is built on the server.
    rows = [(c["group"], f"**{code}**" if code else " ")]
    if code and origin:
        rows.append((c["join"], f"{origin}/group?code={code}"))
    rows.append((c["names"], " "))
    head, *rest = rows
    box = [f"| **{head[0]}** | {head[1]} |", "|:--|:--|"]
    box += [f"| **{label}** | {value} |" for label, value in rest]
    parts.append("\n".join(box))

    if cfg.student_opening.strip():
        parts += [f"## {c['what']}", _block(cfg.student_opening)]

    if cfg.checklist:
        parts.append(f"## {c['steps']}")
        # One paragraph per step, so paper shows a box to tick and no bullet beside it.
        parts.append("\n\n".join(f"☐ {_inline(item.label)}" for item in cfg.checklist))

    ws = _workspace_lines(cfg, c, sim_title)
    if ws:
        parts += [f"## {c['workspace']}", "\n".join(ws)]

    if cfg.starter_prompts:
        parts.append(f"## {c['ask']}")
        parts.append("\n".join(f"- {_inline(p)}" for p in cfg.starter_prompts))

    if origin and not code:
        # With a code, the box above already carries the join link.
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
    raw = _convert(markdown, language=cfg.language)
    return substitute_codes(raw, mapping) if mapping else raw


def _convert(markdown: str, *, language: str = "da") -> bytes:
    """Markdown → docx through AILANG Parse, styled by ``sheet_template``."""
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
            f.write(reference_docx(language))
        try:
            result = client.convert_file(md_path, target="docx", reference_doc=ref_path, table_style=INFO_TABLE_STYLE)
        except Exception as exc:  # any Parse failure is "unavailable"
            log.warning("activity sheet: AILANG Parse convert failed: %s", exc)
            raise SheetUnavailable(str(exc)) from exc
    content = getattr(result, "content", None)
    if not content or not bytes(content[:2]) == b"PK":
        raise SheetUnavailable("AILANG Parse returned no document")
    return bytes(content)
