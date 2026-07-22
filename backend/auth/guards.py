"""Shared route guards.

Centralizes the teacher-only check that several protocol route modules each
re-implemented byte-for-byte (SIMPLIFY-REFACTOR B2). Keeping it here means the
dual-path (Firebase teacher vs anonymous-group student) rejection lives once —
the surface this codebase has repeatedly re-broken.
"""

from fastapi import HTTPException

from auth.firebase_auth import User


def assert_teacher(user: User, detail: str = "teacher access required") -> None:
    """Reject non-teacher callers. Anonymous-group students hit this gate when
    they try to call a teacher-only endpoint (``/api/classes/*``,
    ``/api/activities/*``, ``/api/curriculum/*``, insights, analytics, …).

    ``detail`` lets a caller keep an endpoint-specific 403 message while sharing
    the one canonical predicate (``not user.is_teacher``). Real Firebase teachers
    always carry ``is_teacher=True`` (see ``_user_from_decoded_token``); students
    carry a group JWT with ``is_teacher=False``.
    """
    if not user.is_teacher:
        raise HTTPException(status_code=403, detail=detail)
