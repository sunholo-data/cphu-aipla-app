#!/usr/bin/env python3
"""Render a teacher-feedback spreadsheet into a readable markdown record.

The spreadsheets SCP compiles after each feedback session have a stable shape:
one English sheet, one Danish sheet holding the teachers' original wording, and
an agenda sheet. Read them through AILANG Parse (deterministic XLSX extraction,
no AI pass) and emit markdown, so every quote in the repo is verbatim from the
cell rather than retyped.

    docparse "docs/Feedback meeting 21-8-2026.xlsx"
    python3 scripts/render-feedback-xlsx.py \
        <parser-json> docs/notes-YYYY-MM-DD-teacher-feedback.md \
        --date "21 August 2026" --source "docs/Feedback meeting 21-8-2026.xlsx"

People are reduced to initials per the repo convention (see CLAUDE.md).
"""

import argparse
import collections
import difflib
import json
import re


# Repo convention: people by initials (CLAUDE.md / scoping site).
INITIALS = [(r"\bJesper\b", "JB"), (r"\bMarker\b", "M"), (r"\bMark\b", "M")]


def anonymise(text):
    for pattern, initials in INITIALS:
        text = re.sub(pattern, initials, text)
    return text


def clean(cell):
    text = (cell or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return anonymise(text.strip())


def blockquote(text, label=None):
    lines = [line.strip() for line in clean(text).split("\n") if line.strip()]
    if not lines:
        return "> _(empty in source)_"
    out = ["> **%s**" % label, ">"] if label else []
    return "\n".join(out + ["> " + line for line in lines])


def same_text(left, right):
    """True when two cells say the same thing bar punctuation and initials.

    Some rows in the Danish sheet were never translated back and hold the English
    text; a one-word difference (an anonymised name) must not hide that.
    """
    if not left or not right:
        return False
    norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", s.lower())).strip()
    a, b = norm(left), norm(right)
    if difflib.SequenceMatcher(None, a, b).ratio() >= 0.9:
        return True
    # One cell truncated mid-sentence is still the same text, not a translation.
    short, long = sorted((a, b), key=len)
    return len(short) >= 40 and short in long


def anchor(heading):
    """GitHub's heading-anchor rules: lowercase, drop punctuation, spaces to hyphens."""
    slug = heading.lower()
    slug = re.sub(r"[^a-z0-9 \-]", "", slug)
    return slug.replace(" ", "-")


def sheet_table(document, name):
    for section in document["blocks"]:
        if section.get("name") != name:
            continue
        for block in section["blocks"]:
            if block["type"] == "table":
                return block["rows"]
    return []


def load_items(document, english_sheet, danish_sheet):
    english = sheet_table(document, english_sheet)
    danish = sheet_table(document, danish_sheet)
    items = []
    for index, row in enumerate(english):
        row = list(row) + [""] * (5 - len(row))
        other = list(danish[index]) if index < len(danish) else []
        other += [""] * (5 - len(other))
        items.append(
            {
                "n": index + 1,
                "title": clean(row[0]),
                "theme": clean(row[1]),
                "sub": clean(row[2]),
                "type": clean(row[3]) or "Unclassified",
                "quote_en": clean(row[4]),
                "theme_da": clean(other[1]),
                "sub_da": clean(other[2]),
                "type_da": clean(other[3]),
                "quote_da": clean(other[4]),
            }
        )
    return items


def source_notes(items):
    notes = []
    untranslated = [i for i in items if same_text(i["quote_da"], i["quote_en"])]
    for item in untranslated:
        notes.append(
            "Item %d (%s): the Danish sheet carries the English text — that entry was "
            "never translated back, so there is no teacher-voice original for it."
            % (item["n"], item["sub_da"] or item["sub"])
        )
    for item in items:
        if item["type"] != "Unclassified" and not item["type_da"]:
            notes.append(
                "Item %d: Type is blank in the Danish sheet, `%s` in the English one."
                % (item["n"], item["type"])
            )
    return notes


def render(items, agenda, meta, extra_notes):
    by_theme = collections.OrderedDict()
    for item in items:
        by_theme.setdefault(item["theme"], []).append(item)

    out = []
    add = out.append

    add("# Teacher feedback — meeting of %s" % meta["date"])
    add("")
    add(meta["intro"])
    add("")
    add("| | |")
    add("|---|---|")
    add("| Source | `%s` |" % meta["source"])
    add("| Compiled by | %s |" % meta["compiled_by"])
    add("| Parsed with | `docparse` (AILANG Parse %s) — deterministic XLSX extraction, no AI pass |" % meta["parser_version"])
    add("| Rendered by | `scripts/render-feedback-xlsx.py`, straight from the parser JSON, so every quote is verbatim |")
    add("| Items | %d, numbered 1–%d in the spreadsheet's own order |" % (len(items), len(items)))
    add("")
    add("Names appear as initials, per the repo convention.")
    add("")

    add("## At a glance")
    add("")
    add("| Theme | Problems | Feature requests | Questions / other | Total |")
    add("|---|---:|---:|---:|---:|")
    for theme, group in by_theme.items():
        counts = collections.Counter(i["type"] for i in group)
        problems, features = counts["Problem"], counts["Feature Request"]
        add("| %s | %d | %d | %d | %d |"
            % (theme, problems, features, len(group) - problems - features, len(group)))
    totals = collections.Counter(i["type"] for i in items)
    add("| **All** | **%d** | **%d** | **%d** | **%d** |"
        % (totals["Problem"], totals["Feature Request"],
           len(items) - totals["Problem"] - totals["Feature Request"], len(items)))
    add("")

    add("## Index")
    add("")
    for theme, group in by_theme.items():
        add("**%s**" % theme)
        add("")
        for item in group:
            heading = "%d. %s" % (item["n"], item["title"])
            add("%d. [%s](#%s) — `%s` · %s"
                % (item["n"], item["title"], anchor(heading), item["type"], item["sub"]))
        add("")
    add("---")
    add("")

    for theme, group in by_theme.items():
        add("## %s" % theme)
        add("")
        for item in group:
            add("### %d. %s" % (item["n"], item["title"]))
            add("")
            add("`%s` · %s" % (item["type"], item["sub"]))
            add("")
            add(blockquote(item["quote_en"]))
            add("")
            if item["quote_da"] and not same_text(item["quote_da"], item["quote_en"]):
                add(blockquote(item["quote_da"], "Original (DA)"))
                add("")
        add("---")
        add("")

    if agenda:
        add("## Appendix A — the meeting's own agenda")
        add("")
        for line in agenda:
            add("- %s" % line)
        add("")

    notes = source_notes(items) + extra_notes
    if notes:
        add("## Appendix B — notes on the source spreadsheet")
        add("")
        add("Fidelity flags found while parsing. None of them change the substance; they")
        add("matter only if the spreadsheet is re-read as the authoritative record.")
        add("")
        for note in notes:
            add("- %s" % note)
        add("")

    return "\n".join(out) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parser_json", help="JSON emitted by docparse for the spreadsheet")
    parser.add_argument("output", help="markdown file to write")
    parser.add_argument("--date", required=True, help='e.g. "21 August 2026"')
    parser.add_argument("--source", required=True, help="repo-relative path of the .xlsx")
    parser.add_argument("--compiled-by", default="SCP")
    parser.add_argument("--parser-version", default="v0.34.0")
    parser.add_argument("--english-sheet", default="Feedback English")
    parser.add_argument("--danish-sheet", default="Feedback Dansk")
    parser.add_argument("--agenda-sheet", default="Ark4")
    parser.add_argument("--intro", default="")
    parser.add_argument("--note", action="append", default=[],
                        help="extra source-fidelity note; repeatable")
    args = parser.parse_args()

    document = json.load(open(args.parser_json))["document"]
    items = load_items(document, args.english_sheet, args.danish_sheet)
    agenda = [r[0].strip() for r in sheet_table(document, args.agenda_sheet) if r and r[0].strip()]

    meta = {
        "date": args.date,
        "source": args.source,
        "compiled_by": args.compiled_by,
        "parser_version": args.parser_version,
        "intro": args.intro,
    }
    with open(args.output, "w") as handle:
        handle.write(render(items, agenda, meta, args.note))
    print("wrote %s (%d items)" % (args.output, len(items)))


if __name__ == "__main__":
    main()
