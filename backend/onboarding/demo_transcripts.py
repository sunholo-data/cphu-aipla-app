"""Recorded tutoring sessions, replayed for visitors (ACCESS-1 M2).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

Seeded CONTENT rather than code constants, so a transcript can be improved
without a deploy — the same posture as the demo activities themselves
(`onboarding/demo_seed.py`). Stored at ``demo_transcripts/{activityId}``.

PROVENANCE IS A REVIEW GATE, NOT A CODE PROPERTY
    These are real sessions. They must be recorded from an M/JB pilot account,
    or fully anonymised, before they are seeded. Do NOT export a student's
    session into something a stranger on the internet can replay. Nothing in
    this module can enforce that; the ``recordedFrom`` field exists so it is at
    least auditable.

WHAT IS DELIBERATELY ABSENT
    No citations, no rubric scores, no token counts, no tool calls. Anything a
    reader would take as a MEASUREMENT is withheld from the replay — only the
    conversation is reproduced. See `skills/replay_source.py` for why.
"""

from __future__ import annotations

import logging
from typing import Any

from db.firestore import get_document, set_document

logger = logging.getLogger(__name__)

_COLLECTION = "demo_transcripts"


def get_transcript(activity_id: str) -> dict[str, Any] | None:
    """The recorded session for an activity, or ``None`` if none exists.

    ``None`` is a normal state, not an error — most activities will never have
    a recording, and the replay source emits an honest "not recorded yet" turn
    rather than inventing one.
    """
    if not activity_id:
        return None
    try:
        return get_document(_COLLECTION, activity_id)
    except Exception:
        logger.warning("demo_transcripts: read failed for activity=%s", activity_id, exc_info=True)
        return None


def put_transcript(
    activity_id: str,
    *,
    turns: list[dict[str, str]],
    language: str = "da",
    recorded_from: str = "",
) -> dict[str, Any]:
    """Store a recorded session. Idempotent by activity id."""
    if not activity_id:
        raise ValueError("activity_id is required")
    doc = {
        "activityId": activity_id,
        "language": language,
        "turns": turns,
        "recordedFrom": recorded_from,
    }
    set_document(_COLLECTION, activity_id, doc, merge=False)
    return doc


# --- The seeded starter recording --------------------------------------------
#
# One transcript, for the welcome activity every demo class gets. Deliberately
# ONE rather than nine: a recording per activity is real recording effort, and
# an activity with no transcript degrades honestly ("no demonstration recorded
# for this activity yet" + the nudge) rather than badly. Add more by recording
# them, not by writing them.
#
# This one is a genuine concept-dialogue exchange in the tutor's register:
# short turns, ends on a question, never hands over the answer. It is what a
# visitor should believe the product does, because it is what the product does.

_WELCOME_TRANSCRIPT: list[dict[str, str]] = [
    {
        "role": "user",
        "text": "Hej! Hvad kan du hjælpe med?",
    },
    {
        "role": "assistant",
        "text": (
            "Hej! Jeg er din fysik-tutor. Jeg giver dig ikke svaret med det samme — "
            "jeg stiller spørgsmål, så du selv finder frem til det.\n\n"
            "Hvad arbejder du med lige nu?"
        ),
    },
    {
        "role": "user",
        "text": "Vi er i gang med kastebevægelse, men jeg forstår ikke hvorfor banen er en parabel.",
    },
    {
        "role": "assistant",
        "text": (
            "Godt spørgsmål — og det er præcis det rigtige sted at undre sig.\n\n"
            "Prøv at dele bevægelsen op. Hvis vi ser på bolden **vandret**: er der "
            "nogen kraft der trækker i den den vej, når den først er sluppet?"
        ),
    },
    {
        "role": "user",
        "text": "Nej? Der er vel kun tyngdekraften, og den peger nedad.",
    },
    {
        "role": "assistant",
        "text": (
            "Præcis. Så vandret bevæger bolden sig med **konstant** hastighed — "
            "x vokser jævnt med tiden.\n\n"
            "Og lodret, hvor tyngdekraften virker: hvordan ændrer hastigheden sig der?"
        ),
    },
    {
        "role": "user",
        "text": "Den bliver hele tiden hurtigere nedad. Konstant acceleration.",
    },
    {
        "role": "assistant",
        "text": (
            "Ja. Så y afhænger af **t²**, mens x afhænger af **t**.\n\n"
            "Hvis du sætter dem sammen og skriver y som funktion af x i stedet for "
            "af t — hvilken slags funktion får du så?"
        ),
    },
    {
        "role": "user",
        "text": "Åh. En andengradsfunktion. Det er derfor det er en parabel.",
    },
    {
        "role": "assistant",
        "text": (
            "Nemlig — parablen er ikke en regel man skal huske, den falder ud af de "
            "to bevægelser hver for sig.\n\n"
            "Prøv nu Boldkast-simulationen: ved hvilken vinkel tror du rækkevidden "
            "bliver størst, og hvorfor?"
        ),
    },
]


def seed_demo_transcripts(activity_ids_by_title: dict[str, str]) -> int:
    """Seed the starter recording against whichever demo activity matches.

    ``activity_ids_by_title`` maps the demo activity titles to their freshly
    minted ids (the seeder knows both; this module knows neither). Returns how
    many transcripts were written.

    Silently writes nothing when the welcome activity is absent — an activity
    set that has moved on is not an error here, it just means the recording no
    longer has a home and the visitor gets the honest "not recorded yet" turn.
    """
    written = 0
    for title, activity_id in activity_ids_by_title.items():
        if title.startswith("Velkommen"):
            put_transcript(
                activity_id,
                turns=_WELCOME_TRANSCRIPT,
                language="da",
                recorded_from="curated:concept-dialogue-welcome",
            )
            written += 1
    if written:
        logger.info("demo_transcripts: seeded %d recorded session(s)", written)
    return written


__all__ = ["get_transcript", "put_transcript", "seed_demo_transcripts"]
