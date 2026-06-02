"""Analytics package — query + authorization layer shared by 1.L
(analytics-chat skill) and 1.M (insights dashboard).

Layout:

- :mod:`auth`     — per-teacher authorization. ``assert_caller_owns``
  raises a byte-identical error for missing vs not-owned classes
  (cross-tenant enumeration prevention is the load-bearing security
  control for this module).
- :mod:`queries`  — canned, parameter-bound SQL for the chat-log BQ
  tables. Every query filters by ``allowed_group_codes`` resolved from
  the calling teacher's owned classes.
- :mod:`tools`    — ADK ``FunctionTool``-compatible async wrappers
  used by the ``analytics-chat`` skill (registered in
  ``backend/adk/tools.py``).
- :mod:`summarise` — bounded BQ-sample + single LLM-paraphrase pass
  for misconception/topic-cluster questions.

Design docs: ``docs/design/aipla/v1.0.0-pilot/analytics-chat-tools.md``
and ``teacher-insights-dashboard.md``.
"""

from analytics.auth import (
    PERMISSION_ERROR_MESSAGE,
    assert_caller_owns,
    resolve_caller_class_ids,
    resolve_caller_group_codes,
)

__all__ = [
    "PERMISSION_ERROR_MESSAGE",
    "assert_caller_owns",
    "resolve_caller_class_ids",
    "resolve_caller_group_codes",
]
