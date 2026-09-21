"""Who last edited a document that was not theirs (1.1.123 M3).

A ``role:researcher`` may edit any teacher's class or activity (the assistance
bypass — [researcher-acts-for-teacher.md]). The READ bypass answers "who looked"
with an OTel span; a WRITE needs an answer the teacher can see on the page, so
the stamp lives on the document itself.

Stamped only when the caller is not the owner. An owner's own edit leaves it
untouched — the field means "someone else touched this", not "last modified".
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict


class LastEdit(BaseModel):
    """``{uid, at}`` — the non-owner who last wrote, and when (ISO 8601)."""

    uid: str
    at: str

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def now(cls, uid: str) -> LastEdit:
        return cls(uid=uid, at=datetime.now(UTC).isoformat())
