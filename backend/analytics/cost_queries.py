"""Spend aggregation over the chat-log BQ tables (sprint 1.1.9).

Cost = tokens (from `aipla_chat_turn`) priced via the code rate card
(`analytics.rate_card`). Rows key on `group_id`, so per-class spend
resolves the class → its `group_codes` first (same pattern as
`analytics.auth.resolve_caller_group_codes`).

Every SQL string uses `@`-named parameter binding via
`db.bigquery.run_query` — never f-string interpolation of caller data.
"""

from __future__ import annotations

import calendar
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from analytics.rate_card import CURRENCY, cost_eur
from db.bigquery import CHAT_TURN_TABLE, run_query, table_ref
from db.classes import get_class, list_all_classes

Period = Literal["this_month", "last_month", "all_time"]

#: Far-past lower bound for "all_time" so the BQ scan still has a bound.
_EPOCH = datetime(2026, 1, 1, tzinfo=UTC)


def period_bounds(period: Period, *, now: datetime | None = None) -> tuple[datetime, datetime]:
    """Return (since, until) UTC for a named period. ``now`` is injectable
    for tests."""
    now = now or datetime.now(UTC)
    if period == "all_time":
        return _EPOCH, now
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "this_month":
        return month_start, now
    if period == "last_month":
        last_end = month_start
        prev = (month_start - timedelta(days=1)).replace(day=1)
        return prev, last_end
    raise ValueError(f"unknown period: {period}")  # pragma: no cover


def project_month_eur(spend_eur: float, *, now: datetime | None = None) -> float:
    """Linear month-end projection: spend x days_in_month / days_elapsed.

    Labelled "at current usage rate" in the UI. ``now`` injectable for tests.
    """
    now = now or datetime.now(UTC)
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    days_elapsed = max(1, now.day)
    return round(spend_eur * days_in_month / days_elapsed, 4)


def spend_rows(group_codes: list[str], since: datetime, until: datetime) -> list[dict[str, Any]]:
    """Summed token usage grouped by (model, skill_id, group_id) for the
    given group codes + window. Empty codes short-circuit (no BQ call)."""
    if not group_codes:
        return []
    sql = f"""
        SELECT
          jsonPayload.model AS model,
          jsonPayload.skill_id AS skill_id,
          jsonPayload.group_id AS group_id,
          SUM(CAST(jsonPayload.token_in AS INT64)) AS token_in,
          SUM(CAST(jsonPayload.token_out AS INT64)) AS token_out
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY model, skill_id, group_id
    """.strip()
    rows = run_query(
        sql,
        params={"group_codes": list(group_codes), "since": since, "until": until},
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "model": r["model"],
                "skill_id": r["skill_id"],
                "group_id": r["group_id"],
                "token_in": int(r["token_in"] or 0),
                "token_out": int(r["token_out"] or 0),
            }
        )
    return out


def _fold(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Price raw token rows into EUR totals + by-activity / by-group / by-model
    breakdowns (each a descending-by-spend list)."""
    by_activity: dict[str, float] = {}
    by_group: dict[str, float] = {}
    by_model: dict[str, float] = {}
    total = 0.0
    total_in = 0
    total_out = 0
    for r in rows:
        c = cost_eur(r["model"], r["token_in"], r["token_out"])
        total += c
        total_in += r["token_in"]
        total_out += r["token_out"]
        by_activity[r["skill_id"]] = by_activity.get(r["skill_id"], 0.0) + c
        by_group[r["group_id"]] = by_group.get(r["group_id"], 0.0) + c
        by_model[r["model"] or "unknown"] = by_model.get(r["model"] or "unknown", 0.0) + c

    def _ranked(d: dict[str, float], key: str) -> list[dict[str, Any]]:
        return [{key: k, "eur": round(v, 4)} for k, v in sorted(d.items(), key=lambda kv: kv[1], reverse=True)]

    return {
        "currency": CURRENCY,
        "total_eur": round(total, 4),
        "token_in": total_in,
        "token_out": total_out,
        "by_activity": _ranked(by_activity, "skill_id"),
        "by_group": _ranked(by_group, "group_id"),
        "by_model": _ranked(by_model, "model"),
    }


def class_spend(class_id: str, period: Period, *, now: datetime | None = None) -> dict[str, Any]:
    """Spend breakdown for one class over ``period``. Resolves the class →
    its group codes; returns EUR totals + breakdowns + a month-end projection
    (for ``this_month``)."""
    since, until = period_bounds(period, now=now)
    cls = get_class(class_id)
    codes = list(cls.group_codes) if cls else []
    folded = _fold(spend_rows(codes, since, until))
    folded["class_id"] = class_id
    folded["period"] = period
    folded["projected_eur"] = project_month_eur(folded["total_eur"], now=now) if period == "this_month" else None
    return folded


def cohort_spend(period: Period, *, now: datetime | None = None) -> dict[str, Any]:
    """Cross-class spend grouped by cohort + by model + per class. Researcher
    surface (the route layer enforces the claim). Maps every group code to its
    class + cohort, queries spend over all codes, then aggregates."""
    since, until = period_bounds(period, now=now)
    classes = list_all_classes()
    code_to_class: dict[str, Any] = {}
    for cls in classes:
        for code in cls.group_codes:
            code_to_class[code] = cls
    rows = spend_rows(list(code_to_class.keys()), since, until)

    by_cohort: dict[str, float] = {}
    by_model: dict[str, float] = {}
    per_class: dict[str, dict[str, Any]] = {}
    total = 0.0
    for r in rows:
        cls = code_to_class.get(r["group_id"])
        cohort = (getattr(cls, "cohort", None) or "uncategorised") if cls else "uncategorised"
        c = cost_eur(r["model"], r["token_in"], r["token_out"])
        total += c
        by_cohort[cohort] = by_cohort.get(cohort, 0.0) + c
        by_model[r["model"] or "unknown"] = by_model.get(r["model"] or "unknown", 0.0) + c
        if cls is not None:
            slot = per_class.setdefault(
                cls.class_id, {"class_id": cls.class_id, "name": cls.name, "cohort": cohort, "eur": 0.0}
            )
            slot["eur"] += c

    return {
        "currency": CURRENCY,
        "period": period,
        "total_eur": round(total, 4),
        "by_cohort": [
            {"cohort": k, "eur": round(v, 4)} for k, v in sorted(by_cohort.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "by_model": [
            {"model": k, "eur": round(v, 4)} for k, v in sorted(by_model.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "per_class": [
            {**v, "eur": round(v["eur"], 4)} for v in sorted(per_class.values(), key=lambda x: x["eur"], reverse=True)
        ],
    }


__all__ = ["Period", "class_spend", "cohort_spend", "period_bounds", "project_month_eur", "spend_rows"]
