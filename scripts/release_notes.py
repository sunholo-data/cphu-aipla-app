#!/usr/bin/env python3
"""Teacher-readable release notes from conventional-commit subjects.

    make release-notes FROM=v0.1.69 TO=v0.1.74
    python3 scripts/release_notes.py v0.1.69 v0.1.74 [--all] [--date YYYY-MM-DD]

Reads `git log --no-merges` subjects between two refs and prints Markdown ready
to paste into Teams: one section per release tag in the range (oldest first),
each grouped by audience — Teachers, Students, Researchers, Behind the scenes.
If TO is past the last tag, the tail is its own "not yet tagged" section.

Deterministic, no AI (1.1.140 M7). The subject is kept as written except for
cheap clean-ups: the conventional-commit prefix, design-doc numbers
("1.1.136 M3"), milestone and sprint codes ("BENCH-1 lane 2", "M0-M2") go.
Wording that needs a human still needs one — this is a first draft to edit,
not a press release.

`docs:`, `test:`, `chore:`, `style:` and `revert:` commits are left out unless
--all is given. `fix(test)`, `build`, `ci`, `refactor`, `perf` and infra/ops
scopes are kept but land in "Behind the scenes".
"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
import subprocess
import sys
from dataclasses import dataclass

AUDIENCES = ("Teachers", "Students", "Researchers", "Behind the scenes")

# Commit types left out by default: no user-visible change.
EXCLUDED_TYPES = {"docs", "test", "chore", "style", "revert"}
# Types that are always plumbing, whatever the scope says.
PLUMBING_TYPES = {"build", "ci", "refactor", "perf"}

# Scope -> audience. Checked first; a scope not listed here (a design-doc number
# like "1.1.108", or none) falls through to the keyword rules below.
SCOPE_AUDIENCE = {
    # Teachers
    "classes": "Teachers",
    "class": "Teachers",
    "teacher": "Teachers",
    "teachers": "Teachers",
    "reports": "Teachers",
    "report": "Teachers",
    "activities": "Teachers",
    "activity": "Teachers",
    "authoring": "Teachers",
    "copilot": "Teachers",
    "curriculum": "Teachers",
    "materials": "Teachers",
    "guides": "Teachers",
    # Students
    "chat": "Students",
    "tutor": "Students",
    "tutors": "Students",
    "persona": "Students",
    "workspace": "Students",
    "workbench": "Students",
    "student": "Students",
    "students": "Students",
    "lessons": "Students",
    "sim": "Students",
    "sims": "Students",
    "artefact": "Students",
    "artefacts": "Students",
    "voice": "Students",
    # Researchers
    "research": "Researchers",
    "researcher": "Researchers",
    "bench": "Researchers",
    "fidelity": "Researchers",
    "analytics": "Researchers",
    "rubric": "Researchers",
    "stx-bench": "Researchers",
    # Behind the scenes
    "test": "Behind the scenes",
    "tests": "Behind the scenes",
    "build": "Behind the scenes",
    "ci": "Behind the scenes",
    "infra": "Behind the scenes",
    "ops": "Behind the scenes",
    "telemetry": "Behind the scenes",
    "errors": "Behind the scenes",
    "frontend": "Behind the scenes",
    "backend": "Behind the scenes",
    "deps": "Behind the scenes",
    "security": "Behind the scenes",
    "deploy": "Behind the scenes",
    "sandbox": "Behind the scenes",
    "claude": "Behind the scenes",
}

# Scopes shared by two audiences: the subject's keywords decide, and the value
# here is the fallback when none match (None = fall through to plumbing).
SOFT_SCOPES = {
    "insights": "Teachers",
    "review": "Teachers",
    "i18n": None,
}

# Scope PREFIXES that mean researchers (bench-1, bench-2, ...).
SCOPE_PREFIX_AUDIENCE = (("bench", "Researchers"),)

# Keyword rules for scopes the table does not know. Order matters: the first
# audience with a hit wins, and researcher vocabulary is checked before
# "tutor"/"student", because a research change is usually ABOUT the tutor.
KEYWORD_AUDIENCE = (
    (
        "Researchers",
        re.compile(
            r"\b(research(?:er|ers)?|bench(?:mark)?|fidelity|judge|calibrat\w*|discriminat\w*|"
            r"scored|rubric|arm|analysis model)\b",
            re.I,
        ),
    ),
    ("Teachers", re.compile(r"\b(teachers?|class(?:es)?|co-?pilots?|reports?|authoring)\b", re.I)),
    ("Students", re.compile(r"\b(students?|tutors?|chat|workspace|sims?|lessons?)\b", re.I)),
)

SUBJECT = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[^)]*)\))?(?P<bang>!)?:\s*(?P<desc>.+)$")

# Clean-ups. Parenthesised references that are only design-doc / sprint codes.
_REF = r"(?:\d+\.\d+\.\d+|BENCH-\d+|CLASSVISIT-\d+|M\d+(?:[-+]M?\d+)?)"
PAREN_REF = re.compile(rf"\s*\((?:[^()]*\b{_REF}\b[^()]*)\)")
LEADING_REF = re.compile(rf"^(?:{_REF}\b[\s,+]*)+[:—-]?\s*")


@dataclass(frozen=True)
class Entry:
    type: str
    scope: str
    text: str
    audience: str


# Subjects that are plumbing whatever their scope: a teacher-scoped commit that
# moves a query off the event loop changes nothing a teacher can name.
PLUMBING_KEYWORDS = re.compile(r"\b(event loop|allow-?list|BigQuery|CI)\b")


def classify(ctype: str, scope: str, desc: str) -> str:
    """Audience for one commit. Never raises; unknown things are plumbing."""
    if ctype in PLUMBING_TYPES or PLUMBING_KEYWORDS.search(desc):
        return "Behind the scenes"
    parts = [s.strip().lower() for s in re.split(r"[,/ ]", scope) if s.strip()]
    soft = next((SOFT_SCOPES[p] for p in parts if p in SOFT_SCOPES), None)
    for part in parts:
        if part in SCOPE_AUDIENCE:
            return SCOPE_AUDIENCE[part]
        for prefix, audience in SCOPE_PREFIX_AUDIENCE:
            if part.startswith(prefix):
                return audience
    for audience, pattern in KEYWORD_AUDIENCE:
        if pattern.search(desc):
            return audience
    return soft or "Behind the scenes"


def clean(desc: str) -> str:
    """Plain-language subject: drop design-doc numbers and sprint codes."""
    text = PAREN_REF.sub("", desc)
    text = LEADING_REF.sub("", text).strip()
    text = re.sub(r"\s{2,}", " ", text).rstrip(" .;:—-")
    if not text:
        return desc
    first = text.split(" ", 1)[0]
    if re.search(r"[_().=/]", first):  # an identifier or command: keep its case
        return text
    return text[:1].upper() + text[1:]


def parse(subject: str, include_all: bool = False) -> Entry | None:
    """One subject line -> Entry, or None if it is excluded or unparseable."""
    subject = subject.strip()
    if not subject or subject.startswith("Merge "):
        return None
    m = SUBJECT.match(subject)
    if not m:
        # Not conventional: keep it only with --all, as plumbing.
        return Entry("", "", subject, "Behind the scenes") if include_all else None
    ctype, scope, desc = m["type"].lower(), (m["scope"] or ""), m["desc"]
    if ctype in EXCLUDED_TYPES and not include_all:
        return None
    # A scope that is ONLY a design-doc number carries meaning for the keyword
    # pass; keep it out of classification but it never reaches the output.
    text = clean(desc)
    if ctype == "fix":
        # "Fixed: the report…", but keep "Fixed: CSV…" and identifiers intact.
        if text[:1].isupper() and not text[1:2].isupper():
            text = text[:1].lower() + text[1:]
        text = f"Fixed: {text}"
    return Entry(ctype, scope, text, classify(ctype, scope, desc))


def render_section(title: str, entries: list[Entry]) -> list[str]:
    lines = [f"### {title}", ""]
    if not entries:
        lines += ["_Maintenance only: nothing a teacher, student or researcher will notice._", ""]
        return lines
    for audience in AUDIENCES:
        items = [e for e in entries if e.audience == audience]
        if not items:
            continue
        lines.append(f"**{audience}**")
        lines += [f"- {e.text}" for e in items]
        lines.append("")
    return lines


def render(
    from_ref: str,
    to_ref: str,
    sections: list[tuple[str, list[Entry]]],
    today: str,
) -> str:
    lines = [f"## AIPLA release notes: {from_ref} → {to_ref}", "", f"_{today}_", ""]
    only_plumbing = all(e.audience == "Behind the scenes" for _, es in sections for e in es)
    if not any(es for _, es in sections):
        lines += ["_No changes in this range._", ""]
        return "\n".join(lines)
    if only_plumbing:
        lines += ["_Only behind-the-scenes changes in this range._", ""]
    for title, entries in sections:
        lines += render_section(title, entries)
    return "\n".join(lines).rstrip() + "\n"


# --- git ---------------------------------------------------------------------


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def subjects(a: str, b: str) -> list[str]:
    """Subjects in a..b, oldest first (release notes read forwards)."""
    out = _git("log", "--no-merges", "--reverse", "--format=%s", f"{a}..{b}")
    return [s for s in out.splitlines() if s.strip()]


def tags_between(from_ref: str, to_ref: str) -> list[str]:
    out = _git(
        "tag", "--list", "v*", "--sort=v:refname", "--merged", to_ref, "--no-merged", from_ref
    )
    return [t for t in out.splitlines() if t.strip()]


def ref_date(ref: str) -> str:
    return _git("log", "-1", "--format=%cs", ref).strip()


def build_sections(from_ref: str, to_ref: str, include_all: bool) -> list[tuple[str, list[Entry]]]:
    tags = tags_between(from_ref, to_ref)
    boundaries: list[tuple[str, str]] = []
    prev = from_ref
    for tag in tags:
        boundaries.append((prev, tag))
        prev = tag
    to_sha = _git("rev-parse", f"{to_ref}^{{commit}}").strip()
    prev_sha = _git("rev-parse", f"{prev}^{{commit}}").strip()
    if to_sha != prev_sha:
        boundaries.append((prev, to_ref))

    sections: list[tuple[str, list[Entry]]] = []
    for a, b in boundaries:
        entries = [e for s in subjects(a, b) if (e := parse(s, include_all))]
        if b in tags:
            title = f"{b} ({ref_date(b)})"
        else:
            title = f"{b} (not yet tagged)"
        sections.append((title, entries))
    # Newest release first reads best in a chat channel.
    sections.reverse()
    return sections


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("from_ref", help="exclusive start, usually the last tag announced")
    ap.add_argument("to_ref", nargs="?", default="HEAD", help="inclusive end (tag or ref)")
    ap.add_argument("--all", action="store_true", help="include docs/test/chore commits")
    ap.add_argument("--date", default=_dt.date.today().isoformat(), help="date printed in the header")
    args = ap.parse_args(argv)
    try:
        sections = build_sections(args.from_ref, args.to_ref, args.all)
    except subprocess.CalledProcessError as exc:
        print(f"release-notes: git failed: {exc.stderr.strip()}", file=sys.stderr)
        return 2
    sys.stdout.write(render(args.from_ref, args.to_ref, sections, args.date))
    return 0


if __name__ == "__main__":
    sys.exit(main())
