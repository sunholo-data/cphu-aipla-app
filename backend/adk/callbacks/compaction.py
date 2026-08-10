"""Compaction-latency callback — keep routine compaction out of the student's turn.

Upstream measured (2026-08-06, 18 real turns): in-request compaction cost
+13.6s of TTFT and +28.2s of post-answer tail, and **every compacting turn
compacted twice** — ADK's pre-request and post-invocation paths both fired on
the same turn.

Those two paths read different config objects, which is what makes this a
small fix rather than an ADK fight:

    pre-request      invocation_context.events_compaction_config  <- demoted here
    post-invocation  app.events_compaction_config                 <- untouched

So routine compaction happens only at the END of a turn, exactly when the
student starts reading the answer, instead of ambushing their next question.
The pre-request path stays armed at a much higher threshold because it is the
safety net against exceeding the context window — a slow turn beats a failed
one.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _demote_pre_request_compaction(callback_context: Any) -> None:
    """Raise this turn's PRE-REQUEST compaction trigger to emergency-only.

    Fail-open and silent: this is an optimisation, and a turn that runs with
    the routine threshold is merely slower, not broken. Never raise from here.
    """
    try:
        ictx = getattr(callback_context, "_invocation_context", None)
        config = getattr(ictx, "events_compaction_config", None) if ictx is not None else None
        if config is None:
            return
        from adk.session import emergency_compaction_config

        # The emergency threshold is derived from THIS agent's context window,
        # so read the model actually running the turn rather than a default.
        agent = getattr(ictx, "agent", None)
        model = getattr(agent, "model", None)
        model_id = getattr(model, "model", None) or (model if isinstance(model, str) else "") or ""

        # Assign a COPY — this object may be shared with the App.
        ictx.events_compaction_config = emergency_compaction_config(config, model_id)
    except Exception as exc:
        logger.debug("could not demote pre-request compaction (harmless): %s", exc)
