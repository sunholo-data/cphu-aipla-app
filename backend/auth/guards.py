"""Shared route guards.

Centralizes the teacher-only check that several protocol route modules each
re-implemented byte-for-byte (SIMPLIFY-REFACTOR B2). Keeping it here means the
dual-path (Firebase teacher vs anonymous-group student) rejection lives once —
the surface this codebase has repeatedly re-broken.
"""

from fastapi import HTTPException

from auth.firebase_auth import User


def assert_teacher(user: User) -> None:
    """Reject non-teacher callers. Anonymous-group students hit this gate when
    they try to call a teacher-only endpoint (``/api/classes/*``,
    ``/api/activities/*``, insights, analytics, …)."""
    if not user.is_teacher:
        raise HTTPException(status_code=403, detail="teacher access required")
