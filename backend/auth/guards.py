"""Shared route guards.

Centralizes the teacher-only check that several protocol route modules each
re-implemented byte-for-byte (SIMPLIFY-REFACTOR B2). Keeping it here means the
dual-path (Firebase teacher vs anonymous-group student) rejection lives once —
the surface this codebase has repeatedly re-broken.

Two guards live here and they answer DIFFERENT questions. Read both before
reaching for either:

    assert_teacher    — "is this a Firebase identity rather than an
                        anonymous-group student?"  Gates NAVIGATION.
    assert_can_spend  — "may this identity cause a paid API call or hand out
                        a student join code?"      Gates MONEY and FAN-OUT.
    assert_programme_admin
                      — "may this identity decide who ELSE may spend?"
                        Gates DELEGATED ADMINISTRATION (1.1.76).

A visitor passes the first and fails the second, on purpose. That is the whole
shape of ACCESS-1: a stranger who signs in at aipla.ku.dk should be able to walk
the entire product and spend nothing.
"""

from fastapi import HTTPException

from auth.access_tiers import TIER_PILOT, can_spend
from auth.firebase_auth import User

#: 402 rather than 403. It is a distinct condition the frontend renders
#: differently — a "request access" nudge, not "access denied" — and a distinct
#: status keeps the two apart without anyone string-matching a message.
SPEND_DENIED_STATUS = 402

_DEFAULT_SPEND_DETAIL = (
    "This account is exploring AIPLA with a recorded demonstration. "
    "Teachers in the programme get a live tutor for their classes."
)


def assert_teacher(user: User, detail: str = "teacher access required") -> None:
    """Reject non-teacher callers. Anonymous-group students hit this gate when
    they try to call a teacher-only endpoint (``/api/classes/*``,
    ``/api/activities/*``, ``/api/curriculum/*``, insights, analytics, …).

    ``detail`` lets a caller keep an endpoint-specific 403 message while sharing
    the one canonical predicate (``not user.is_teacher``). Real Firebase teachers
    always carry ``is_teacher=True`` (see ``_user_from_decoded_token``); students
    carry a group JWT with ``is_teacher=False``.

    NOTE: this deliberately says nothing about spend. Every Firebase identity
    passes it, including uninvited visitors — see ``assert_can_spend``.
    """
    if not user.is_teacher:
        raise HTTPException(status_code=403, detail=detail)


def assert_researcher(user: User, detail: str = "researcher role required") -> None:
    """Reject callers without the ``role:researcher`` claim (403).

    The claim is a Firebase custom claim layered on top of teacher identity
    (see ``firebase_auth.py``), granted by a platform admin via
    ``POST /api/admin/grant-researcher``. Every researcher is a teacher, but
    not every teacher is a researcher — callers should ``assert_teacher``
    first if they need that distinction reported separately.
    """
    if not user.is_researcher:
        raise HTTPException(status_code=403, detail=detail)


def assert_programme_admin(user: User) -> None:
    """Reject callers without the ``programmeAdmin`` claim — with **404**.

    404, not 403, and deliberately: an administrative surface should not confirm
    its own existence to a caller who may not use it. Same choice as
    ``research_lens_routes``, same reasoning.

    This gate says nothing about ``role:researcher``. A researcher READS the
    register; a programme admin WRITES it. Conflating them is exactly the design
    error 1.1.76 exists to avoid, so a researcher calling a write route lands
    here and gets the same 404 a stranger does.

    The claim is minted ONLY by the service-account-gated
    ``POST /api/admin/grant-programme-admin``. A programme admin cannot mint the
    claim they hold — the classic privilege escalation, and the one hard "no" in
    this design.
    """
    if not user.is_programme_admin:
        raise HTTPException(status_code=404, detail="not found")


def assert_can_spend(user: User, detail: str = _DEFAULT_SPEND_DETAIL) -> None:
    """Reject callers whose access tier does not authorise paid work (402).

    Guards the two things that cost money on a public domain:

      1. **Paid API calls** — live model turns, Vertex RAG ingest/query, Cloud
         TTS/STT, the Gemini document-extraction fallback.
      2. **Student fan-out** — minting an anonymous-group join code. This is the
         one that actually matters. Students need no identity at all (ADR-001),
         so one uninvited signup plus one shared link is an unbounded number of
         unidentified sessions. Per-IP join limits and the per-group turn lock
         bound concurrency, never spend.

    Anonymous-group students are evaluated on the tier of the teacher whose
    class they joined, resolved upstream — a student in an invited teacher's
    class spends that teacher's budget and is allowed; a student holding a code
    from a visitor cannot exist, because visitors get no codes.
    """
    if not can_spend(user.access_tier):
        raise HTTPException(
            status_code=SPEND_DENIED_STATUS,
            detail=detail,
            headers={"X-AIPLA-Access-Tier": user.access_tier or "visitor"},
        )


def is_pilot(user: User) -> bool:
    """Non-raising form of ``assert_can_spend`` for branch-not-reject callers.

    Used where the right answer is to degrade (serve the recorded demo) rather
    than to refuse — GRACEFUL DEGRADATION beats a 402 mid-lesson.
    """
    return user.access_tier == TIER_PILOT
