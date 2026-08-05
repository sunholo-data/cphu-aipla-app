"""The ONE organising vocabulary — level, subject, tags — and its normalisers.

Extracted from ``db/models/curriculum.py`` in 1.1.61, when activities became the
second thing that carries these facets. Two consumers means the definitions need
a home neither of them owns, or they drift: the same words would mean subtly
different things on a document and on an activity, and the facets would stop
composing across the two libraries.

That drift already had a foothold. The frontend hand-copied ``SUBJECTS`` into
``MaterialsSection.tsx`` because there was no way to reach it; 1.1.61 deletes
that copy and serves the vocabulary from the facets endpoint instead. Keep it
that way — this module is the source, everything else is a reader.

Nothing here does I/O or knows about Firestore. It is vocabulary and pure
functions, so both the document and activity filter passes can import it without
either depending on the other.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Literal

# The Danish stx level. A hard vocabulary (unlike subject): these three are what
# the curriculum is actually stratified by, and an unknown fourth value would be
# a bug rather than a teacher's free choice.
StxLevel = Literal["A", "B", "C"]

# --- Sentinels --------------------------------------------------------------
# Filter values for "has no X". Sentinels rather than None because they travel as
# query-string values (?level=__unlevelled__) and have to round-trip through a
# URL, a chip and a CLI flag identically.
UNFILED = "__unfiled__"
UNFILED_LABEL = "Unfiled"
UNLEVELLED = "__unlevelled__"
UNLEVELLED_LABEL = "No level"

# --- Tags -------------------------------------------------------------------
# Freeform teacher labels. Stored in ONE canonical form (lowercased) so filter,
# facet and search can compare with plain equality and never case-fold at read.
MAX_TAGS = 20
MAX_TAG_LEN = 40

# --- Subject ----------------------------------------------------------------
# The BROAD class (school subject), not an area within one. It was the Danish stx
# *physics* areas in 1.1.58 M2, which left the maths corpus homeless and had
# "AIPLA guides" masquerading as a physics area; those areas are now FOLDERS.
#
# A SOFT vocabulary: these seed the picker but free entry is allowed, so a
# teacher is never blocked on a category we failed to predict.
MAX_SUBJECT_LEN = 60
SUBJECTS = [
    "Fysik",
    "Matematik",
    "Kemi",
    "AIPLA guides",
]

# The 1.1.58 subject vocabulary, relocated: seeded as SHARED folders by
# ``scripts/seed_curriculum_folders.py``. Kept beside SUBJECTS so the seed and any
# future classifier share one list.
PHYSICS_AREAS = [
    "Mekanik",
    "Termodynamik",
    "Elektromagnetisme",
    "Bølger og optik",
    "Atom- og kernefysik",
    "Kvantefysik",
    "Astrofysik",
    "Relativitet",
    "Eksperimentel metode",
]


def normalize_subject(subject: str | None) -> str | None:
    """Trim a subject to ``MAX_SUBJECT_LEN``; empty/whitespace → None.

    Case is PRESERVED (unlike tags) — subjects are display-cased vocabulary
    terms, and "Fysik" lowercased would read as a typo in the rail.
    """
    if subject is None:
        return None
    s = subject.strip()[:MAX_SUBJECT_LEN].strip()
    return s or None


def normalize_tags(tags: Iterable[str] | None) -> list[str]:
    """Canonicalise a tag list: lowercase, trim, drop empties, de-dupe (order-
    preserving), truncate each to ``MAX_TAG_LEN`` and the list to ``MAX_TAGS``.

    Applied on EVERY write path (curriculum ingest + PATCH, activity upsert +
    PATCH) so the stored form is canonical and downstream filter/facet/search can
    compare with plain equality/substring.
    """
    if not tags:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for raw in tags:
        t = (raw or "").strip().lower()[:MAX_TAG_LEN].strip()
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= MAX_TAGS:
            break
    return out


__all__ = [
    "MAX_SUBJECT_LEN",
    "MAX_TAGS",
    "MAX_TAG_LEN",
    "PHYSICS_AREAS",
    "SUBJECTS",
    "UNFILED",
    "UNFILED_LABEL",
    "UNLEVELLED",
    "UNLEVELLED_LABEL",
    "StxLevel",
    "normalize_subject",
    "normalize_tags",
]
