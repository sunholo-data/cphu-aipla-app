"""Only the newest draft of a writing sheet reaches the tutor (1.1.164 M1).

Design: docs/design/aipla/v2.1.0-extension/tutor-tracks-what-is-settled.md

The writing sheet's *Ask for feedback* button sends the WHOLE sheet as a chat
turn (``WorkbenchWriting.askForFeedback``, i18n key
``WorkbenchWriting.feedbackRequest``). A group that asks after every edit puts
every draft into the conversation. On prod, 2026-11-25, ``green-beetle-49``
sent fifteen drafts of one sheet; most of them still said "protoner". The tutor
told the group "protoner" was still there seventeen minutes after they fixed it,
and later asked for a typo fix that was in the very message it was replying to.

So, before each model call, every *Ask for feedback* turn for a sheet that has a
newer one in the same request becomes one line naming the sheet. The newest
stays whole, and the tutor's replies to the old drafts stay, so it still knows
what it said. Only THIS request changes: the stored session, the chat log and
BigQuery keep every draft for researchers and the report.

The match is on the exact template, not on free text: a student who types
"kan du give mig feedback" by hand is never collapsed. The templates are copied
from ``frontend/messages/{da,en}/workspace.json`` (the backend image is built
from ``backend/`` and cannot read them); ``test_superseded_drafts.py`` fails if
the two drift apart.

The result depends only on the request, so it is stable from call to call until
a new draft arrives. Fail-open: on any surprise the request is left as it was.
Off-switch: ``TUTOR_COLLAPSE_DRAFTS=0``.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _Template:
    lang: str
    head: str  # before {title}
    tail: str  # between {title} and {text}
    stub: str  # what an older draft becomes; {title} is filled in


#: ``WorkbenchWriting.feedbackRequest`` split at its two placeholders.
TEMPLATES: tuple[_Template, ...] = (
    _Template(
        lang="da",
        head="Kan du give mig feedback på ",
        tail="? Her er hvad jeg har skrevet:\n\n",
        stub="[En tidligere udgave af «{title}»: erstattet af en nyere udgave længere nede i samtalen.]",
    ),
    _Template(
        lang="en",
        head="Can you give me feedback on ",
        tail="? Here is what I've written:\n\n",
        stub='[An earlier draft of "{title}": replaced by a newer draft further down in the conversation.]',
    ),
)


def feedback_title(text: str) -> tuple[str, _Template] | None:
    """The sheet title of an *Ask for feedback* message, or None for anything else."""
    for tpl in TEMPLATES:
        if text.startswith(tpl.head):
            rest = text[len(tpl.head) :]
            cut = rest.find(tpl.tail)
            if cut > 0:
                return rest[:cut], tpl
    return None


def _user_text_parts(llm_request: Any) -> list[tuple[Any, int, str]]:
    """(content, part index, text) for every text part of every user turn, in order."""
    found = []
    for content in getattr(llm_request, "contents", None) or []:
        if getattr(content, "role", None) != "user":
            continue
        for i, part in enumerate(content.parts or []):
            text = getattr(part, "text", None)
            if isinstance(text, str) and text and not getattr(part, "thought", None):
                found.append((content, i, text))
    return found


def collapse_superseded_drafts(llm_request: Any) -> int:
    """Shorten every *Ask for feedback* draft that has a newer one for the same
    sheet in this request. Returns how many were shortened."""
    if os.environ.get("TUTOR_COLLAPSE_DRAFTS", "1").strip() == "0":  # ops off-switch
        return 0
    try:
        parts = _user_text_parts(llm_request)
        matches = [(content, i, m) for content, i, text in parts if (m := feedback_title(text)) is not None]
        newest: dict[str, int] = {}
        for n, (_content, _i, (title, _tpl)) in enumerate(matches):
            newest[title] = n
        collapsed = 0
        for n, (content, i, (title, tpl)) in enumerate(matches):
            if newest[title] == n:
                continue
            # Replace the part in the list rather than editing it: the request's
            # parts are its own copies, but never risk writing through to the
            # stored session event.
            content.parts[i] = content.parts[i].model_copy(update={"text": tpl.stub.format(title=title)})
            collapsed += 1
        if collapsed:
            logger.info(
                "drafts: %d superseded feedback draft(s) shortened, %d sheet(s) kept whole", collapsed, len(newest)
            )
        return collapsed
    except Exception:
        logger.debug("drafts: collapse failed; request left as it was", exc_info=True)
        return 0
