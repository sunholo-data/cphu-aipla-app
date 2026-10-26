#!/usr/bin/env python3
"""No backend model may grow a field that stores a student's identity.

WHY (1.1.137 §Guard, 2026-10-26)

ADR-001 (decided M + JB 2026-05-18) gives students anonymous group codes and
keeps NO server-side map from a code to a person. That is the project's
strongest privacy property, and it is what keeps the chat logs, BigQuery and
the research reports free of names without anyone having to remember to strip
them.

1.1.137 gave a teacher names against codes anyway — in the BROWSER only
(localStorage + the teacher's own Excel file). The obvious "improvement" a
later change will reach for is to store that sheet server-side so it follows
the teacher between devices. That is exactly the identity map ADR-001 removed,
and it needs JB + a DPIA decision, an ADR-001 revision and UCPH IT informed —
not a Pydantic field added in good faith.

So: any model under backend/db/models/ whose field NAME or ALIAS reads like a
student identity (student_name / studentName / names / roster / pupil / elev /
first_name …) fails this check, unless scripts/student-identity-allowlist.txt
carries an entry for it whose reason cites the DPIA decision.

It is deliberately stricter than "on a class or group record": a roster hung
off any model is the same identity map, and the false positive costs one
allowlist line with a reason.

Usage:  python3 scripts/check-student-identity-fields.py [--models DIR] [--allowlist FILE]
Exit:   0 clean · 1 identity-shaped field without an allowlist entry · 2 bad allowlist
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# Tokens that on their own mean "a list of people / a person" in this domain.
# `elev` / `elever` / `navn` are Danish (pupil / pupils / name).
IDENTITY_TOKENS = {
    "roster",
    "rosters",
    "pupil",
    "pupils",
    "elev",
    "elever",
    "elevnavn",
    "navn",
    "navne",
    "names",
    "surname",
    "forename",
    "cpr",
}
# A `name` token is fine on its own (a class has a name) — only these
# qualifiers make it a PERSON's name.
NAME_QUALIFIERS = {"student", "students", "first", "last", "full", "given", "family", "real"}


def tokens(identifier: str) -> list[str]:
    """`studentName` / `student_name` / `StudentNames` → ['student', 'name(s)']."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", identifier)
    return [t for t in re.split(r"[_\W]+", spaced.lower()) if t]


def looks_like_identity(identifier: str) -> bool:
    toks = tokens(identifier)
    if any(t in IDENTITY_TOKENS for t in toks):
        return True
    return any(t in ("name", "names") for t in toks) and any(t in NAME_QUALIFIERS for t in toks)


def fields_in(path: Path) -> list[tuple[str, str, int, str]]:
    """(class, field, lineno, identifier-that-matched) for every model field."""
    tree = ast.parse(path.read_text(), filename=str(path))
    found: list[tuple[str, str, int, str]] = []
    for cls in ast.walk(tree):
        if not isinstance(cls, ast.ClassDef):
            continue
        for stmt in cls.body:
            if not (isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)):
                continue
            field = stmt.target.id
            names = [field]
            # Field(alias="studentName") / Field(validation_alias=...) — the
            # Firestore key is the alias, so check it too.
            if isinstance(stmt.value, ast.Call):
                for kw in stmt.value.keywords:
                    if kw.arg in ("alias", "validation_alias", "serialization_alias") and isinstance(
                        kw.value, ast.Constant
                    ):
                        if isinstance(kw.value.value, str):
                            names.append(kw.value.value)
            for ident in names:
                if looks_like_identity(ident):
                    found.append((cls.name, field, stmt.lineno, ident))
                    break
    return found


def load_allowlist(path: Path) -> tuple[set[str], list[str]]:
    """Lines: `<file relative to repo>:<Class>.<field> | <reason citing the DPIA>`."""
    allowed: set[str] = set()
    errors: list[str] = []
    if not path.exists():
        return allowed, errors
    for n, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, reason = line.partition("|")
        key, reason = key.strip(), reason.strip()
        if not sep or not reason:
            errors.append(f"{path.name}:{n}: entry has no reason: {line!r}")
        elif "dpia" not in reason.lower():
            errors.append(f"{path.name}:{n}: reason must cite the DPIA decision: {line!r}")
        else:
            allowed.add(key)
    return allowed, errors


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", type=Path, default=REPO / "backend/db/models")
    ap.add_argument("--allowlist", type=Path, default=REPO / "scripts/student-identity-allowlist.txt")
    args = ap.parse_args(argv)

    allowed, errors = load_allowlist(args.allowlist)
    if errors:
        print("BAD ALLOWLIST:")
        for e in errors:
            print(f"  {e}")
        return 2

    violations = []
    for py in sorted(args.models.rglob("*.py")):
        try:
            rel = py.relative_to(REPO)
        except ValueError:
            rel = py.relative_to(args.models)
        for cls, field, lineno, ident in fields_in(py):
            key = f"{rel}:{cls}.{field}"
            if key in allowed:
                print(f"  allowed: {key} (allowlisted with a DPIA reason)")
            else:
                violations.append(f"  {rel}:{lineno}  {cls}.{field}  (matched {ident!r})")

    if violations:
        print("STUDENT IDENTITY FIELD ON A BACKEND MODEL:")
        print("\n".join(violations))
        print(
            """
ADR-001: the server keeps NO map from a group code to a person. A names or
roster field on a stored record is that map. 1.1.137 keeps the class list in
the teacher's browser for exactly this reason
(docs/design/aipla/v1.1.0-feedback/class-list-on-the-teacher-device.md).

If storing it is genuinely decided (JB + DPIA sign-off, ADR-001 revised, UCPH
IT informed), add `<file>:<Class>.<field> | <reason citing the DPIA decision>`
to scripts/student-identity-allowlist.txt. Otherwise rename or remove it."""
        )
        return 1

    print("OK: no backend model stores a student's identity (ADR-001).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
