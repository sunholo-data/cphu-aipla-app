"""Teacher Insights Dashboard backend (1.M).

Composes the 1.L ``analytics.queries`` SQL into KPI aggregates the
``/teacher/classes`` strip, ``/teacher/classes/[id]`` panel, and
``/teacher/insights`` cross-class page render.

Two modules:

- :mod:`aggregates` — pure functions taking a teacher uid + class id +
  time window, returning the KPI shape expected by the dashboard plus
  a ``_debug.queries`` list describing the underlying SQL.
- :mod:`cache` — 60s TTL keyed on
  ``(teacher_uid, surface, since, until)``. Cheap defense against the
  N-cards-per-class fan-out turning into N BQ scans on every navigation.

Routes live in :mod:`protocols.insights_routes` and use the helpers
here. Authorization always goes through
:func:`analytics.auth.assert_caller_owns` — never via SQL ``WHERE``
clauses. See ``docs/design/aipla/v1.0.0-pilot/teacher-insights-dashboard.md``.
"""
