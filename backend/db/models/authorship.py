"""Who made an authored record, by which route, and when (1.1.150 M2).

Shared by the three stores a person can write a teaching record into —
``tutors``, ``authored_frameworks`` (custom approaches) and ``custom_personas``
— so "where did this come from?" has one vocabulary, not three.

On 2026-10-05 a researcher found "Didaktisk Tutor" in their own list and nobody
in the room could say where it came from. The answer was in Firestore (a pilot
teacher made it two days earlier) and nowhere on screen. These fields are what
puts it on screen, and they are deliberately **immutable**: stamped by the
server when the row is created and never rewritten by any later save. An edit
by a researcher must not make a teacher's approach look like the researcher's.

``created_via`` is server-set. A client may only ever claim ``ui`` or
``copilot`` (the two routes a person actually types through); ``seed``,
``sync`` and ``adopt`` are never accepted from a request body. ``adopt`` and
``sync`` are reserved: no path creates a tutor that way today (1.1.150 F3), and
the value exists so the first one that does has somewhere to say so.

``None`` on a backfilled row means **not recorded**, and is displayed as such —
never guessed. The one exception the backfill makes is ``platform-seed``, which
is certain.
"""

from __future__ import annotations

from typing import Literal

#: How a record came to exist. See the module docstring.
CreatedVia = Literal["seed", "copilot", "ui", "adopt", "sync"]

#: The subset a request body may claim. Everything else is server-only.
ClientCreatedVia = Literal["ui", "copilot"]

#: The uid the deploy seed writes under (``admin/tutor_migration.py``). A row
#: carrying it was made by the platform, not a person.
SEED_AUTHOR = "platform-seed"

__all__ = ["SEED_AUTHOR", "ClientCreatedVia", "CreatedVia"]
