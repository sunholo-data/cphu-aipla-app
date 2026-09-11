"""Researchers see what teachers build (1.1.91 M4).

The ``scope=all`` pattern the class reads already use, applied to the tutor
layer: every tutor and every teacher-authored approach in one read, with
lineage, who wrote it, and how much it has actually been used.

## What "teacher-authored" means today

M4's row said it was *"moot until M1b — there is nothing for a researcher to look
at"*. M1b shipped as [1.1.110] custom approaches, so there is: a teacher can
write their own approach and assign it to a class. Tutor VARIANTS remain
possible and unused (zero on every environment), so they appear here as an empty
category rather than being left out — an absent category reads as "not built",
and this one is built and unused, which is a different and more useful fact.

## Read-only, and logged

Every read tags the current span ``auth.researcher_bypass`` exactly as
``analytics.auth`` does for classes, so "who looked at whose work" is answerable.

⚠️ **And teachers are told, in the product.** The design is explicit that this is
their professional work and that the trust-card principle applies to teachers as
much as to students. Someone having said so once in a meeting is not the same
thing as the surface saying so where the work is written — see the note rendered
on the custom-approach panel.

## Usage is measured, never inferred

A framework's usage comes from the chat log — turns actually taught with it —
and from the assignment store. Not from "a tutor exists that names it", which
counts intent rather than use, and would report a framework assigned in March
and never run as busy.
"""

from __future__ import annotations

import logging
from typing import Any

from opentelemetry import trace

log = logging.getLogger(__name__)


def _tag_researcher_read(what: str) -> None:
    """Record that a researcher read across tenancy. No-op without a span."""
    span = trace.get_current_span()
    if not span.is_recording():
        return
    span.set_attribute("auth.researcher_bypass", True)
    span.set_attribute("research.crossview", what)


def _approach_usage() -> dict[str, dict[str, int]]:
    """Turns and sessions per framework, from the chat log.

    Degrades to ``{}`` when BigQuery cannot answer — a catalogue that cannot
    show usage is still worth reading, and the caller reports the degradation
    rather than printing zeros that look like "never used".
    """
    from analytics.research_logs import framework_tabs

    try:
        return {
            row["framework_id"]: {"turns": int(row["turns"] or 0), "sessions": int(row["sessions"] or 0)}
            for row in framework_tabs()
        }
    except Exception as exc:
        log.warning("crossview: usage unavailable (%s)", type(exc).__name__)
        return {}


def tutor_crossview() -> dict[str, Any]:
    """Every tutor and every authored approach, with lineage and real usage."""
    _tag_researcher_read("tutors+approaches")

    from db.authored_frameworks import list_authored_frameworks
    from db.tutor_assignments import list_assignments
    from db.tutors import list_tutor_catalogue
    from frameworks.loader import load_frameworks

    usage = _approach_usage()
    usage_available = bool(usage)
    assignments = list_assignments()

    tutors = list_tutor_catalogue()
    # How many tutors point at each approach — INTENT, kept separate from the
    # chat-log's USE. Conflating them is how a framework assigned once and never
    # run reads as busy.
    assigned_count: dict[str, int] = {}
    for t in tutors:
        if t.framework_id:
            assigned_count[t.framework_id] = assigned_count.get(t.framework_id, 0) + 1

    def _approach_row(fw, authored: bool) -> dict[str, Any]:
        u = usage.get(fw.id, {})
        return {
            "id": fw.id,
            "label": fw.label,
            "authored": authored,
            "authorUid": fw.author_uid,
            "authorRole": fw.author_role,
            "status": fw.status,
            "register": fw.teaching_register,
            "constructs": len(fw.constructs),
            "sources": len(fw.provenance),
            "tutorsAssigned": assigned_count.get(fw.id, 0),
            # ⚠️ The default is 0 when the store ANSWERED and None only when it
            # could not. An approach with no rows in a readable chat log has
            # been used zero times — that is a finding, and a real one here:
            # on prod only Authentic Dialogue has ever taught a turn.
            #
            # The first version used `u.get("turns")`, which returns None for a
            # missing key, so six genuinely-unused approaches reported "could
            # not read" while `usageAvailable` was True. That inverts the very
            # distinction this field exists to make.
            "turns": u.get("turns", 0) if usage_available else None,
            "sessions": u.get("sessions", 0) if usage_available else None,
        }

    published = [_approach_row(fw, authored=False) for fw in load_frameworks()]
    authored = [_approach_row(fw, authored=True) for fw in list_authored_frameworks()]

    return {
        "usageAvailable": usage_available,
        "publishedApproaches": published,
        "authoredApproaches": authored,
        "tutors": [
            {
                "id": t.id,
                "displayName": t.display_name,
                "frameworkId": t.framework_id,
                "assignedByResearcher": t.id in assignments,
                "isVariant": t.is_variant,
                "parentTutorId": t.lineage.parent_tutor_id,
                "authorUid": t.author_uid,
                "authorRole": t.author_role,
                "isSkillBound": t.is_skill_bound,
                "status": t.status,
                "version": t.version,
            }
            for t in tutors
        ],
        # Built and unused is a different fact from not built, and an absent
        # category would read as the latter.
        "variantCount": sum(1 for t in tutors if t.is_variant),
    }


__all__ = ["tutor_crossview"]
