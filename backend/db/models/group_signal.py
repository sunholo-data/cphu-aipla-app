"""GroupSignal — a live, per-group classroom signal (1.1.29 call-teacher).

A "raised hand" is a property of a *group's* active session, never of an
individual student (ADR-001: many students share one anonymous group code +
one synthetic uid). The teacher sees "group 7B raised their hand" — the
correct privacy posture *and* the correct pedagogical unit (the teacher walks
to a table, not a person).

Collection: ``group_signals`` — one document per group, keyed by ``group_id``
(which, for anonymous groups, is the join code the teacher handed out, so it
matches ``Class.group_codes`` directly).

Schema:
    group_id       : str        — the group's anonymous id (= join code)
    class_id       : str        — the bound class (from anon_groups/{id}.classId)
    activity_id    : str        — the activity the group is in (display only)
    activity_title : str        — the activity title (display only)
    raised_hand_at : str | None — ISO-8601; set ⇒ an active raised hand
    cleared_at     : str | None — ISO-8601; when it was lowered/acknowledged
    cleared_by     : str        — "" while active; teacher uid, or "student"

State: ``raised_hand_at`` set AND ``cleared_at is None`` ⇒ active call. Raising
is idempotent (a second raise while already raised is a no-op), so a flaky
network can't double-fire. Either the teacher (ack) or the student (lower) can
clear it.

Design doc: docs/design/aipla/v1.1.0-feedback/call-teacher.md
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class GroupSignal(BaseModel):
    group_id: str
    class_id: str = ""
    activity_id: str = ""
    activity_title: str = ""
    raised_hand_at: str | None = None
    cleared_at: str | None = None
    cleared_by: str = ""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @property
    def is_raised(self) -> bool:
        """True iff there is an active, uncleared raised hand."""
        return self.raised_hand_at is not None and self.cleared_at is None
