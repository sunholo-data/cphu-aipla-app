"""Every workspace element the frontend pushes must be allowlisted by the backend.

A workspace element is registered TWICE: once in the frontend, where it calls
``useSimSnapshotPush(sessionId, "<serverId>")``, and once in the backend, in
``_WORKSPACE_ELEMENT_SERVERS``, which decides whether that push may write to the
agent's context. Nothing tied the two together, so an element could ship
registered on one side only — and did.

On 2026-08-21 the ``writing`` element pushed a student's text on every autosave
and the backend answered 403 twelve times, because ``writing`` had never been
added to the allowlist. The student saw their work saved and the "shared with
the tutor" card appear; the tutor never received a word of it. Both sides' test
suites were green: the frontend asserted it *sends* ``"writing"``, and the
backend parametrised its allowlist test over the four names it already knew.

This test is the missing edge between them. It reads the frontend source rather
than a hand-maintained list, because a third list is a third thing to forget.

Direction matters: a frontend push that the backend does not allow is a broken
feature, so it fails. The reverse — an allowlist entry nothing currently pushes
— is fine (``chart`` is one today) and is not an error.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from protocols.iframe_context_routes import _WORKSPACE_ELEMENT_SERVERS

_FRONTEND_SRC = Path(__file__).resolve().parents[3] / "frontend" / "src"

# `useSimSnapshotPush<Snapshot>(sessionId, "table")` and the untyped form.
_PUSH_CALL = re.compile(
    r"""useSimSnapshotPush\s*(?:<[^>]*>)?\s*\(\s*[^,]+,\s*["']([a-z0-9-]+)["']""",
)


def _frontend_pushed_server_ids() -> dict[str, str]:
    """serverId → "path:line" for every element push in the frontend source."""
    found: dict[str, str] = {}
    for path in sorted([*_FRONTEND_SRC.rglob("*.tsx"), *_FRONTEND_SRC.rglob("*.ts")]):
        if "__tests__" in path.parts:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for match in _PUSH_CALL.finditer(line):
                found.setdefault(match.group(1), f"{path.relative_to(_FRONTEND_SRC)}:{lineno}")
    return found


@pytest.mark.skipif(not _FRONTEND_SRC.is_dir(), reason="frontend source not present in this checkout")
class TestElementServerParity:
    def test_the_scanner_finds_the_known_elements(self):
        """Guards the guard. A regex that silently matches nothing would make
        every assertion below vacuously true — which is precisely the failure
        mode that let the original bug through."""
        pushed = _frontend_pushed_server_ids()

        assert "table" in pushed, f"scanner found only {sorted(pushed)} — the regex has drifted"
        assert "progress" in pushed
        assert len(pushed) >= 3

    def test_every_frontend_push_is_allowlisted_by_the_backend(self):
        pushed = _frontend_pushed_server_ids()
        missing = {sid: where for sid, where in pushed.items() if sid not in _WORKSPACE_ELEMENT_SERVERS}

        assert not missing, (
            "These elements push iframe-context but the backend will 403 them.\n"
            + "\n".join(f"  {sid!r} pushed at frontend/src/{where}" for sid, where in sorted(missing.items()))
            + "\n\nAdd them to _WORKSPACE_ELEMENT_SERVERS in "
            "backend/protocols/iframe_context_routes.py, or the student's work "
            "never reaches the tutor (silently — the trust card still appears)."
        )

    def test_writing_specifically_is_allowlisted(self):
        """The 2026-08-21 regression, named. The general test above would catch
        it, but a named case is what makes a re-break legible in CI output."""
        assert "writing" in _WORKSPACE_ELEMENT_SERVERS
