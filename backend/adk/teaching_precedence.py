"""The activity says what to learn, the tutor says how to teach (1.1.141 M1 + M3).

**M1 — the precedence block.** A lesson turn carries two texts that can both
say how to teach: the ACTIVITY's teaching goal (substituted inside the SKILL.md
body as ``{teacher_focus}``) and the TUTOR's approach preamble
(``adk/tutor_framework.inject_framework_preamble``, appended after the body).
The approach comes later, and this file's sibling modules run on "later
instruction wins" — but that convention is ours, not the model's. With no
explicit rule a small model blends the two, and a blend of ESRU and "give hints
freely" looks like every other tutor. That is the likeliest reason JB saw
different tutors "give the same answers" in real lessons while the preview
benchmark (no activity text) saw them differ.

So the rule is said out loud, **immediately after the approach preamble** and
**only when a preamble was actually composed**. No framework, no block: the
passthrough guarantee (tutors handover, rule 1) holds byte for byte, because
:func:`inject_framework_preamble_with_precedence` returns its input unchanged
whenever ``inject_framework_preamble`` does.

The prose is language-neutral (the content-localisation rule, 1.1.108 M4): it
names no language, so it composes the same for a Danish and an English
activity — the language directive in ``{teacher_focus}`` decides that.

**M3 — tutor notes.** Pedagogy and persona lines moved out of a teaching goal
(on a co-pilot draft, a library copy or an adopt) land in the activity's
``tutor_notes``. They reach the tutor **only when no approach is teaching** —
which keeps today's behaviour for a tutor-less activity and removes the conflict
everywhere else. Empty notes, or an approach present, compose ``""``.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from adk.tutor_framework import inject_framework_preamble
from db.models.activity_config import ActivityConfig

log = logging.getLogger(__name__)

#: The rule, verbatim from the design doc (1.1.141 M1). Unconditional given a
#: framework, like the notation and praise blocks are unconditional for all.
TEACHING_PRECEDENCE_TEXT = (
    "The activity description says what the students should learn and do. The "
    "teaching approach above says how you teach it. If the activity description "
    "tells you how to teach (tone, hints, how much to explain, what character to "
    "play) and that conflicts with the approach, follow the approach, and keep the "
    "activity's learning goals."
)

TEACHING_PRECEDENCE_BLOCK = "\n\n## Which instruction decides how you teach\n" + TEACHING_PRECEDENCE_TEXT

#: Tutor notes are teacher free text riding every turn, so they are bounded like
#: every other variable-length contributor (teacher_focus budget, 1.1.62 M2).
TUTOR_NOTES_CAP = 1000


def inject_framework_preamble_with_precedence(
    instructions: str,
    activity_id: str,
    *,
    group_tags: Iterable[str] | None = None,
) -> str:
    """The approach preamble, followed immediately by the precedence block.

    Passthrough exactly when ``inject_framework_preamble`` is one: no framework,
    an unknown or placeholder framework, or an empty rendered instruction all
    return ``instructions`` unchanged — the block never appears without the
    approach it refers to as "above".
    """
    composed = inject_framework_preamble(instructions, activity_id, group_tags=group_tags)
    if composed == instructions:
        return instructions
    return composed + TEACHING_PRECEDENCE_BLOCK


def build_tutor_notes_block(cfg: ActivityConfig | None, framework_id: str | None) -> str:
    """The activity's tutor notes, for a tutor that runs no approach (1.1.141 M3).

    ``""`` when there are no notes OR when an approach is teaching — in the
    second case the approach owns how to teach, and the notes are exactly the
    lines that would conflict with it. An activity that never had notes (every
    activity before 1.1.141) composes byte-identically.
    """
    notes = ((cfg.tutor_notes if cfg is not None else "") or "").strip()
    if not notes or framework_id:
        return ""
    if len(notes) > TUTOR_NOTES_CAP:
        notes = notes[:TUTOR_NOTES_CAP].rsplit(" ", 1)[0] + " …(truncated)"
    return (
        "\n\n## The teacher's notes on how to tutor this activity\n"
        + notes
        + "\n\nThe teacher wrote these about how you should teach this activity. Follow them "
        "alongside the activity's learning goals."
    )


__all__ = [
    "TEACHING_PRECEDENCE_BLOCK",
    "TEACHING_PRECEDENCE_TEXT",
    "TUTOR_NOTES_CAP",
    "build_tutor_notes_block",
    "inject_framework_preamble_with_precedence",
]
