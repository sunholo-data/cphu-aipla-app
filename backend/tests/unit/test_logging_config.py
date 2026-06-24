"""Regression: app-level INFO logging must survive a pre-existing root handler.

The deployed backend calls ``setup_telemetry()`` (which installs an OTEL root
handler) BEFORE ``fast_api_app``'s logging setup. A plain
``basicConfig(level=INFO)`` is a NO-OP once the root logger already has
handlers, so it never lowers the root LEVEL off the WARNING default — and every
app-level ``log.info()`` (the per-turn TTFT breakdown, ``stream_skill:`` /
``group_auth:`` markers) was silently dropped in Cloud Logging. The 2026-06-23
demo proved it: ZERO INFO app lines reached Cloud Logging.

``fast_api_app`` now follows ``basicConfig`` with an explicit root
``setLevel(INFO)``. This test pins that mechanism: it must lower the level
through a pre-existing handler WITHOUT creating or closing handlers (closing
would nuke pytest's capture handlers under test — which is why we don't use
``basicConfig(force=True)``).
"""

from __future__ import annotations

import io
import logging


def test_root_setlevel_info_emits_through_preexisting_handler():
    root = logging.getLogger()
    saved_handlers = root.handlers[:]
    saved_level = root.level
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    try:
        # Simulate setup_telemetry()/OTEL: a handler already on root, root at
        # WARNING — the deployed start state where basicConfig(level=INFO)
        # no-ops and leaves the level untouched.
        root.handlers = [handler]
        root.setLevel(logging.WARNING)

        # A plain basicConfig is a no-op here (handler present), so INFO is
        # still dropped — exactly the production bug.
        logging.basicConfig(level=logging.INFO)
        logging.getLogger("app.module.before").info("before-setlevel")
        assert "before-setlevel" not in buf.getvalue()

        # The authoritative fix: lower the root level. INFO now reaches the
        # existing handler — no handler is created or closed.
        logging.getLogger().setLevel(logging.INFO)
        logging.getLogger("app.module.after").info("after-setlevel")
        assert "after-setlevel" in buf.getvalue()
    finally:
        handler.close()
        root.handlers = saved_handlers
        root.setLevel(saved_level)
