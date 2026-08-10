"""The group's recorded progress, as ambient tutor context (1.1.70 M1).

**The bug.** ``checklist_progress`` and ``concept_progress`` are keyed by
(group, activity) and never by session — deliberately, because a group works
across separate devices and progress that died with a tab would be the worse
bug (``test_state_survives_a_new_session``). But the tutor had no way to tell
progress it inherited from progress it watched happen: both read identically
through ``list_checklist()``, and it only ever saw either by *asking*.

Aswin, 2026-08-10: a long productive session; the chat history goes away; the
student rejoins on the same group code; the tutor finds four of five steps done
and wraps up after one question. From the student's seat, *Jonas forgot
everything, then claimed to remember.*

**Why this module exists rather than two blocks.** Both summaries were written,
exported and unit-tested in 1.1.62 / CONCEPT-1 and **never wired**, so the
first job was wiring them. Written as two independent blocks they each carried
a near-identical contract paragraph — the same instruction, stated twice, for
the model to reconcile, at ~450 characters of a budget already shared seven
ways. One section per store, one contract for both.

**A note on timing, because the design doc got it wrong.** 1.1.70 proposed the
wording *"This group has progress from an EARLIER session, which you did not
witness"*, on the premise that the block is composed once at agent build. It is
not: ``create_agent_with_thinking`` is called from
``skills.skill_processor.process_skill_request`` on **every request**, so a
build-time block is a per-turn block. Asserting non-witness would therefore be
a falsehood from turn two onward — about marks the tutor made itself, which it
can see in its own conversation.

So the contract states what the store actually knows (who, when, what evidence)
and asks the model to compare that against the conversation it is in. Every
behaviour the doc wanted survives: the record is not a memory, continue from
what is outstanding, do not re-test, a mark may be revisited.
"""

from __future__ import annotations

import logging

from adk.checklist_tools import checklist_state_summary
from adk.checkpoint_tools import checkpoint_state_summary
from auth.firebase_auth import User
from db.models.activity_config import ActivityConfig

logger = logging.getLogger(__name__)

# Stated once for both stores. Three things here block the reported behaviour:
# the tutor learns the record may predate the conversation; it is told to
# continue from what is outstanding rather than wrap up; and it is given
# permission to revisit, so an inherited mark cannot railroad a student who has
# actually forgotten.
_CONTRACT = (
    "These records are keyed to the group and the activity, NOT to this conversation — some or all "
    "of this may have been earned in an EARLIER session you cannot see. It is a record, not a "
    "memory of yours: if you do not find the work in the conversation you are actually in, do not "
    "describe it as something you observed. Do not re-test it either — that punishes the student "
    "for our bookkeeping. Acknowledge it briefly, continue from what is still outstanding rather "
    "than wrapping up, and revisit anything the student seems unsure about. A mark is not a verdict."
)


def compose_progress_context(cfg: ActivityConfig | None, user: User) -> str:
    """Both stores' recorded progress plus the shared contract, or ``""``.

    Empty when nothing is recorded, so a first-ever session composes exactly as
    it did before this was wired — and the two costs (one Firestore document
    read each) are only paid by an activity that actually has a checklist or a
    concept map, for a caller who is a group student.

    A read failure must never cost a session: a tutor with no progress context
    behaves as it did last week, while one that 500s helps nobody.
    """
    sections: list[str] = []
    for name, summarise in (("checklist", checklist_state_summary), ("checkpoint", checkpoint_state_summary)):
        try:
            section = summarise(cfg, user)
        except Exception:
            logger.exception("progress context: %s summary failed — continuing without it", name)
            continue
        if section:
            sections.append(section)

    if not sections:
        return ""

    logger.info(
        "progress context: %d section(s) composed for group=%s activity=%s",
        len(sections),
        user.group_id,
        cfg.activity_id if cfg else "-",
    )
    return "\n\n" + "\n\n".join([*sections, _CONTRACT])


__all__ = ["compose_progress_context"]
