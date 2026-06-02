"""Per-teacher authorization for analytics queries.

Three helpers:

- :func:`resolve_caller_class_ids` — the set of ``class_id`` values the
  caller owns.
- :func:`resolve_caller_group_codes` — the union of ``group_codes``
  across the caller's owned classes. Closes the chat-log BQ schema
  gap (rows do not carry ``class_id`` today, see
  ``backend/observability/chat_log.py``) by resolving owned classes to
  their group codes at query time. Every analytics SQL filters by
  this set.
- :func:`assert_caller_owns` — raises :class:`PermissionError` with
  the same byte-identical message for "class does not exist" and
  "class exists but is owned by someone else". Prevents enumeration:
  a non-owning caller cannot use the error to learn whether a given
  ``class_id`` is real.

Authorization happens here, in Python, not in a SQL ``WHERE`` clause
the model writes and not in prompt instruction. ADR-level decision
captured in
``docs/design/aipla/v1.0.0-pilot/analytics-chat-tools.md`` §Standards
Compliance Check.
"""

from __future__ import annotations

from db.classes import get_class, list_classes_for_owner

#: Byte-identical message used for every authorization failure. Tests
#: assert this; do not vary it by branch. The HTTP layer that wraps the
#: helper turns this into a 404 (same shape as "class not found") so
#: external callers cannot distinguish missing from forbidden.
PERMISSION_ERROR_MESSAGE = "class not accessible"


def resolve_caller_class_ids(user_uid: str) -> set[str]:
    """Return the set of class ids the caller owns.

    Revoked classes are excluded (the caller should not query data
    against a class they have retired). LOCAL_MODE / workshop users
    flagged ``is_teacher=True`` go through the same path; their
    class set is whatever ``list_classes_for_owner(user_uid)`` returns.

    Routes pass ``user.uid``; tools pull from
    ``tool_context.state["user:id"]``.
    """
    classes = list_classes_for_owner(user_uid)
    return {c.class_id for c in classes}


def resolve_caller_group_codes(user_uid: str) -> set[str]:
    """Return the union of ``group_codes`` across the caller's owned
    classes.

    This is the canonical filter set for analytics queries against the
    chat-log BQ tables. Empty for a teacher with no classes or no
    minted group codes — queries should short-circuit and return zero
    rows rather than hit BQ with an empty IN-list.
    """
    classes = list_classes_for_owner(user_uid)
    codes: set[str] = set()
    for c in classes:
        codes.update(c.group_codes)
    return codes


def assert_caller_owns(user_uid: str, class_id: str) -> None:
    """Raise :class:`PermissionError` unless the caller owns
    ``class_id``.

    Byte-identical error message for both branches:

    - ``class_id`` matches no Firestore document.
    - ``class_id`` matches a document with a different ``owner_uid``.

    Tests verify this property (see
    ``backend/tests/unit/analytics/test_auth.py::test_enumeration_resistance``).
    Do not split the branches; do not log the distinction at WARNING
    level (which would leak via Cloud Logging).
    """
    cls = get_class(class_id)
    if cls is None or cls.owner_uid != user_uid:
        raise PermissionError(PERMISSION_ERROR_MESSAGE)


__all__ = [
    "PERMISSION_ERROR_MESSAGE",
    "assert_caller_owns",
    "resolve_caller_class_ids",
    "resolve_caller_group_codes",
]
