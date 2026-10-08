"""Session state written by the turn path must stay in ITS session.

ADK scopes a state key by prefix: ``app:`` is application-global (every user,
every session of the app), ``user:`` is shared by one user's sessions — and every
device on a group code is ONE user (``anon-<code>``), across all its activities.
So an ``app:`` key written for one group's session is visible in every other
group's, and a ``user:`` key written in one activity is visible in all the
group's other activities.

Until 2026-10-08 the document / activity-material loaders kept their bookkeeping
under ``app:`` (``app:docs_loaded``, ``app:activity_images_loaded``, …). The tutor
never received another session's CONTENT through them — every injector loads a
session-scoped artifact, which another session does not have — but the lists
(document ids, original filenames, load errors) rode out to every client on the
AG-UI STATE_SNAPSHOT, and ``analytics.rubric_evidence`` loaded activity images for
a rubric judge from whatever the global list held. Same mistake as the
``app:chat_session_turn_count`` odometer (session.py, 2026-06-23).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from google.adk.events import Event, EventActions
from google.adk.sessions import InMemorySessionService

from adk.callbacks.activity_documents import _STATE_DOCS_IN_CONTEXT
from adk.callbacks.activity_images import _STATE_IMAGES_LOADED
from adk.callbacks.document import (
    _STATE_DOC_IMAGE_LABELS,
    _STATE_DOC_LOAD_ERROR,
    _STATE_DOCS_LOADED,
    _STATE_RESUMED_SESSION,
)
from analytics.rubric_evidence import _STATE_IMAGES_LOADED as _RUBRIC_IMAGES_KEY

_KEYS = {
    _STATE_RESUMED_SESSION: True,
    _STATE_DOCS_LOADED: ["doc-of-activity-a"],
    _STATE_DOC_LOAD_ERROR: {"doc-x": "boom"},
    _STATE_DOC_IMAGE_LABELS: {"doc-of-activity-a": "elevens-foto.jpg"},
    _STATE_DOCS_IN_CONTEXT: ["task-of-activity-a"],
    _STATE_IMAGES_LOADED: ["image-of-activity-a"],
}

_BACKEND = Path(__file__).resolve().parents[2]


def test_rubric_reader_uses_the_loaders_key():
    assert _RUBRIC_IMAGES_KEY == _STATE_IMAGES_LOADED


@pytest.mark.asyncio
async def test_nothing_crosses_sessions_or_activities_through_real_adk_scoping():
    """Real ADK prefix semantics (InMemorySessionService honours app:/user:):
    a key written in one group's activity-A session is absent from the SAME
    group's activity-B session and from another group's session."""
    svc = InMemorySessionService()
    app = "aitana_platform"
    a = await svc.create_session(app_name=app, user_id="anon-latelynx27", session_id="act-a")
    b = await svc.create_session(app_name=app, user_id="anon-latelynx27", session_id="act-b")
    other = await svc.create_session(app_name=app, user_id="anon-kindkettle86", session_id="other")

    await svc.append_event(
        a,
        Event(invocation_id="i1", author="agent", actions=EventActions(state_delta=dict(_KEYS))),
    )

    a2 = await svc.get_session(app_name=app, user_id="anon-latelynx27", session_id=a.id)
    b2 = await svc.get_session(app_name=app, user_id="anon-latelynx27", session_id=b.id)
    o2 = await svc.get_session(app_name=app, user_id="anon-kindkettle86", session_id=other.id)
    for key in _KEYS:
        assert key in a2.state, key
        assert key not in b2.state, f"{key} crossed into the same group's other activity"
        assert key not in o2.state, f"{key} crossed into another group's session"


# Tripwire: no production code may WRITE an app:/user: state key again.
_WRITE = re.compile(r"""state\s*\[\s*f?["'](app|user):""")
_CONST = re.compile(r"""^_STATE_\w+\s*=\s*["'](app|user):""", re.MULTILINE)


def test_no_production_code_writes_app_or_user_scoped_state():
    offenders: list[str] = []
    for path in _BACKEND.rglob("*.py"):
        rel = path.relative_to(_BACKEND).as_posix()
        if rel.startswith(("tests/", ".venv/")) or "/site-packages/" in rel:
            continue
        text = path.read_text(encoding="utf-8")
        for m in _CONST.finditer(text):
            offenders.append(f"{rel}: {m.group(0)}")
        for line_no, line in enumerate(text.splitlines(), 1):
            stripped = line.split("#", 1)[0]
            if _WRITE.search(stripped) and "=" in stripped.split("]", 1)[-1] and ".get(" not in stripped:
                offenders.append(f"{rel}:{line_no}: {line.strip()}")
    assert not offenders, "app:/user:-scoped state key in production code:\n" + "\n".join(offenders)
