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
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from analytics.rate_card import CURRENCY, cost_eur, usd_to_eur
from db.activities import get_activity
from db.bigquery import CHAT_TURN_TABLE, jsonpayload_columns, run_query, table_ref
from db.classes import get_class, list_all_classes

VOICE_COST_TABLE = "aipla_voice_cost"

log = logging.getLogger(__name__)

Period = Literal["this_month", "last_month", "all_time"]

#: The calendar a lesson happens in. Day buckets use it so an 08:15 lesson
#: and a 23:30 one land on the date the teacher would name.
LESSON_TZ = "Europe/Copenhagen"

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
    given group codes + window. Empty codes short-circuit (no BQ call).

    **Schema-tolerant.** The Cloud Logging → BQ sink only creates a
    ``jsonPayload.*`` column once a non-null value is logged for it, so
    ``model`` / ``token_in`` / ``token_out`` may be ABSENT on a young dataset
    (this caused a 400 ``Field name model does not exist`` 500 on first
    ship). We probe the live schema and reference only existing columns:
    a missing ``model`` becomes NULL (→ "unknown" at pricing), missing token
    columns become 0. The column-name selection is from the BQ schema, not
    caller input — no injection surface (group codes/timestamps stay bound).

    Each row also carries its ``day`` (Copenhagen calendar date — a lesson is
    a local-time thing), its ``activity_id`` when the turn was stamped with one,
    and ``replies``, the number of priced tutor turns. They are what let the
    class panel answer "what did Tuesday's lesson cost?" without a second
    query; consumers that only want totals simply sum across them."""
    if not group_codes:
        return []
    cols = jsonpayload_columns(CHAT_TURN_TABLE)
    model_sel = "jsonPayload.model" if "model" in cols else "CAST(NULL AS STRING)"
    tin_sel = "SUM(CAST(jsonPayload.token_in AS INT64))" if "token_in" in cols else "0"
    tout_sel = "SUM(CAST(jsonPayload.token_out AS INT64))" if "token_out" in cols else "0"
    act_sel = "jsonPayload.activity_id" if "activity_id" in cols else "CAST(NULL AS STRING)"
    replies_sel = "COUNTIF(jsonPayload.token_in IS NOT NULL)" if "token_in" in cols else "0"
    group_by = (
        "jsonPayload.skill_id, jsonPayload.group_id, day"
        + (", jsonPayload.activity_id" if "activity_id" in cols else "")
        + (", jsonPayload.model" if "model" in cols else "")
    )
    sql = f"""
        SELECT
          {model_sel} AS model,
          jsonPayload.skill_id AS skill_id,
          jsonPayload.group_id AS group_id,
          {act_sel} AS activity_id,
          DATE(timestamp, '{LESSON_TZ}') AS day,
          {tin_sel} AS token_in,
          {tout_sel} AS token_out,
          {replies_sel} AS replies
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY {group_by}
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
                "activity_id": r.get("activity_id"),
                "day": r["day"].isoformat() if r.get("day") else None,
                "replies": int(r.get("replies") or 0),
            }
        )
    return out


def _safe_spend_rows(group_codes: list[str], since: datetime, until: datetime) -> list[dict[str, Any]]:
    """``spend_rows`` that degrades to ``[]`` on any BQ error instead of
    surfacing a 500. Matches the chat-log read path's established
    "callers wrap BQ in try/except" contract (see ``db/bigquery.py``):
    a spend dashboard that can't reach BQ should show zero, not crash."""
    try:
        return spend_rows(group_codes, since, until)
    except Exception as exc:
        log.warning("cost_queries: spend query failed, returning empty (%s)", type(exc).__name__)
        return []


def voice_spend(group_codes: list[str], since: datetime, until: datetime) -> list[dict[str, Any]]:
    """Summed voice (STT/TTS) cost in USD grouped by (kind, group_id) for the
    given group codes + window (1.1.9 voice-cost integration). Reads the
    ``aipla_voice_cost`` table that ``emit_voice_cost`` populates.

    Empty codes short-circuit. **Schema-tolerant**: the table (and its
    ``jsonPayload.*`` columns) does not exist until the first voice-cost row
    lands, so probe the schema and bail to [] if the cost column is absent —
    ``_safe_voice_spend`` additionally swallows a missing-table BQ error."""
    if not group_codes:
        return []
    cols = jsonpayload_columns(VOICE_COST_TABLE)
    if "cost_usd" not in cols or "group_id" not in cols:
        return []
    kind_sel = "jsonPayload.kind" if "kind" in cols else "CAST(NULL AS STRING)"
    # ``units`` is characters for TTS and milliseconds for STT. Summing it
    # alongside cost is what lets the dashboard tell "this class used no voice"
    # from "this class used voice we priced at zero" — a distinction that was
    # invisible for the whole time gcp_gemini went unpriced, because a hidden
    # row and a zero row look identical. Schema-tolerant like the rest: rows
    # written before this column existed simply sum to 0.
    units_sel = "SUM(CAST(jsonPayload.units AS INT64))" if "units" in cols else "0"
    group_by = "jsonPayload.group_id" + (", jsonPayload.kind" if "kind" in cols else "")
    sql = f"""
        SELECT
          {kind_sel} AS kind,
          jsonPayload.group_id AS group_id,
          SUM(CAST(jsonPayload.cost_usd AS FLOAT64)) AS cost_usd,
          {units_sel} AS units
        FROM {table_ref(VOICE_COST_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY {group_by}
    """.strip()
    rows = run_query(sql, params={"group_codes": list(group_codes), "since": since, "until": until})
    return [
        {
            "kind": r["kind"],
            "group_id": r["group_id"],
            "cost_usd": float(r["cost_usd"] or 0.0),
            "units": int(r["units"] or 0),
        }
        for r in rows
    ]


def _safe_voice_spend(group_codes: list[str], since: datetime, until: datetime) -> list[dict[str, Any]]:
    """``voice_spend`` that degrades to ``[]`` on any BQ error (incl. the
    table not existing yet). Voice cost is additive context — its absence must
    never 500 the dashboard or zero out the LLM spend."""
    try:
        return voice_spend(group_codes, since, until)
    except Exception as exc:
        log.warning("cost_queries: voice spend query failed, returning empty (%s)", type(exc).__name__)
        return []


def _fold_voice(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Price voice rows (USD) into EUR: total + by-kind (stt/tts) breakdown.

    ``voice_units`` rides alongside the money so the UI can render a voice line
    whenever voice was USED, rather than only when it cost something. Browser
    TTS is genuinely free, and a mispriced tier reads as free — both are
    "someone pressed play", and both were previously indistinguishable from
    "nobody did".
    """
    by_kind: dict[str, float] = {}
    units_by_kind: dict[str, int] = {}
    total = 0.0
    total_units = 0
    for r in rows:
        kind = r["kind"] or "unknown"
        eur = usd_to_eur(r["cost_usd"])
        total += eur
        by_kind[kind] = by_kind.get(kind, 0.0) + eur
        units = int(r.get("units") or 0)
        total_units += units
        units_by_kind[kind] = units_by_kind.get(kind, 0) + units
    return {
        "voice_eur": round(total, 4),
        "voice_units": total_units,
        "by_voice_kind": [
            {"kind": k, "eur": round(v, 4), "units": units_by_kind.get(k, 0)}
            for k, v in sorted(by_kind.items(), key=lambda kv: kv[1], reverse=True)
        ],
    }


def _fold(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Price raw token rows into EUR totals + by-activity / by-group / by-model
    breakdowns (each a descending-by-spend list), and a by-day breakdown
    (newest first) so one lesson's cost can be read off directly.

    An activity bucket is the (activity_id, skill_id) pair: rows logged before
    turns were stamped with an activity, or outside one, carry no activity_id
    and fall back to their skill."""
    by_activity: dict[tuple[str | None, str], float] = {}
    by_group: dict[str, float] = {}
    by_model: dict[str, float] = {}
    by_day: dict[str, dict[str, Any]] = {}
    total = 0.0
    total_in = 0
    total_out = 0
    for r in rows:
        c = cost_eur(r["model"], r["token_in"], r["token_out"])
        total += c
        total_in += r["token_in"]
        total_out += r["token_out"]
        act_key = (r.get("activity_id") or None, r["skill_id"])
        by_activity[act_key] = by_activity.get(act_key, 0.0) + c
        by_group[r["group_id"]] = by_group.get(r["group_id"], 0.0) + c
        by_model[r["model"] or "unknown"] = by_model.get(r["model"] or "unknown", 0.0) + c
        if r.get("day"):
            d = by_day.setdefault(r["day"], {"eur": 0.0, "replies": 0, "groups": set()})
            d["eur"] += c
            d["replies"] += int(r.get("replies") or 0)
            if r.get("replies"):
                d["groups"].add(r["group_id"])

    def _ranked(d: dict[str, float], key: str) -> list[dict[str, Any]]:
        return [{key: k, "eur": round(v, 4)} for k, v in sorted(d.items(), key=lambda kv: kv[1], reverse=True)]

    return {
        "currency": CURRENCY,
        "total_eur": round(total, 4),
        "token_in": total_in,
        "token_out": total_out,
        "by_activity": [
            {"activity_id": act, "skill_id": skill, "eur": round(v, 4)}
            for (act, skill), v in sorted(by_activity.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "by_group": _ranked(by_group, "group_id"),
        "by_model": _ranked(by_model, "model"),
        "by_day": [
            {"day": day, "eur": round(d["eur"], 4), "replies": d["replies"], "groups": len(d["groups"])}
            for day, d in sorted(by_day.items(), reverse=True)
        ],
    }


def _title_activities(by_activity: list[dict[str, Any]]) -> None:
    """Give each activity bucket the title a teacher knows it by, in place.

    A missing or deleted activity keeps ``title: None`` and the panel falls
    back to the id — a cost view must not fail on a lookup."""
    for a in by_activity:
        title = None
        if a.get("activity_id"):
            try:
                act = get_activity(a["activity_id"], include_deleted=True)
                title = act.title if act and act.title else None
            except Exception as exc:
                log.warning("cost_queries: activity title lookup failed (%s)", type(exc).__name__)
        a["title"] = title


def class_spend(class_id: str, period: Period, *, now: datetime | None = None) -> dict[str, Any]:
    """Spend breakdown for one class over ``period``. Resolves the class →
    its group codes; returns EUR totals + breakdowns + a month-end projection
    (for ``this_month``)."""
    since, until = period_bounds(period, now=now)
    cls = get_class(class_id)
    codes = list(cls.group_codes) if cls else []
    folded = _fold(_safe_spend_rows(codes, since, until))
    _title_activities(folded["by_activity"])
    voice = _fold_voice(_safe_voice_spend(codes, since, until))
    # total = LLM token cost + voice (STT/TTS); breakdowns stay LLM, voice is
    # its own line. Combine BEFORE projecting so the projection includes voice.
    folded["voice_eur"] = voice["voice_eur"]
    folded["voice_units"] = voice["voice_units"]
    folded["by_voice_kind"] = voice["by_voice_kind"]
    folded["total_eur"] = round(folded["total_eur"] + voice["voice_eur"], 4)
    folded["class_id"] = class_id
    folded["period"] = period
    folded["projected_eur"] = project_month_eur(folded["total_eur"], now=now) if period == "this_month" else None
    return folded


def teacher_own_spend(uid: str, period: Period, *, now: datetime | None = None) -> dict[str, Any]:
    """Spend on a teacher's OWN turns — co-pilot, analytics-chat, manage-class.

    Distinct from ``class_spend``, and not a subset of it. `class_spend`
    resolves a class to its student join codes; a teacher's own chat belongs to
    no class, so it appears in neither `class_spend` nor `classes_spend`.

    Until ACCESS-1 Ring 3 (2026-08-12) these turns were not logged AT ALL — the
    session callback dropped every non-anonymous owner, so the most tool-heavy
    skills in the product were invisible to every cost view. They now emit under
    the same billing key the budget enforcer meters on (`teacher:{uid}`), which
    is what this reads.

    Content is not logged for these turns (ADR-001); only model + token counts,
    which is all a cost view needs.
    """
    since, until = period_bounds(period, now=now)
    folded = _fold(_safe_spend_rows([f"teacher:{uid}"], since, until))
    folded["uid"] = uid
    folded["period"] = period
    folded["projected_eur"] = project_month_eur(folded["total_eur"], now=now) if period == "this_month" else None
    return folded


def classes_spend(
    class_id_to_codes: dict[str, list[str]], period: Period, *, now: datetime | None = None
) -> dict[str, Any]:
    """Teacher-scoped spend: EUR total + per-class breakdown across the supplied
    ``{class_id: group_codes}`` map (the caller's OWN classes). One BQ query
    over the union of codes, aggregated by the class each code belongs to.

    Distinct from ``cohort_spend`` (cross-tenant, researcher-only) — this is
    scoped to exactly the classes passed in, so any teacher can see the cost of
    their own cohort without the researcher claim."""
    since, until = period_bounds(period, now=now)
    code_to_class: dict[str, str] = {code: cid for cid, codes in class_id_to_codes.items() for code in codes}
    codes = list(code_to_class.keys())
    rows = _safe_spend_rows(codes, since, until)
    per_class: dict[str, float] = dict.fromkeys(class_id_to_codes, 0.0)
    total = 0.0
    for r in rows:
        c = cost_eur(r["model"], r["token_in"], r["token_out"])
        total += c
        cid = code_to_class.get(r["group_id"])
        if cid is not None:
            per_class[cid] = per_class.get(cid, 0.0) + c
    # Voice cost (STT/TTS) folded in — total + per-class, same group→class map.
    voice_total = 0.0
    voice_units = 0
    for vr in _safe_voice_spend(codes, since, until):
        eur = usd_to_eur(vr["cost_usd"])
        voice_total += eur
        voice_units += int(vr.get("units") or 0)
        cid = code_to_class.get(vr["group_id"])
        if cid is not None:
            per_class[cid] = per_class.get(cid, 0.0) + eur
    return {
        "currency": CURRENCY,
        "period": period,
        "total_eur": round(total + voice_total, 4),
        "voice_eur": round(voice_total, 4),
        "voice_units": voice_units,
        "per_class": [{"class_id": cid, "eur": round(v, 4)} for cid, v in per_class.items()],
    }


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
    codes = list(code_to_class.keys())
    rows = _safe_spend_rows(codes, since, until)

    by_cohort: dict[str, float] = {}
    by_model: dict[str, float] = {}
    by_voice_kind: dict[str, float] = {}
    voice_units_by_kind: dict[str, int] = {}
    per_class: dict[str, dict[str, Any]] = {}
    total = 0.0

    def _cohort_of(cls: Any) -> str:
        return (getattr(cls, "cohort", None) or "uncategorised") if cls else "uncategorised"

    def _class_slot(cls: Any) -> dict[str, Any]:
        return per_class.setdefault(
            cls.class_id, {"class_id": cls.class_id, "name": cls.name, "cohort": _cohort_of(cls), "eur": 0.0}
        )

    for r in rows:
        cls = code_to_class.get(r["group_id"])
        c = cost_eur(r["model"], r["token_in"], r["token_out"])
        total += c
        by_cohort[_cohort_of(cls)] = by_cohort.get(_cohort_of(cls), 0.0) + c
        by_model[r["model"] or "unknown"] = by_model.get(r["model"] or "unknown", 0.0) + c
        if cls is not None:
            _class_slot(cls)["eur"] += c

    # Voice cost (STT/TTS) folded across the same dimensions.
    voice_total = 0.0
    voice_units = 0
    for vr in _safe_voice_spend(codes, since, until):
        cls = code_to_class.get(vr["group_id"])
        kind = vr["kind"] or "unknown"
        eur = usd_to_eur(vr["cost_usd"])
        total += eur
        voice_total += eur
        units = int(vr.get("units") or 0)
        voice_units += units
        voice_units_by_kind[kind] = voice_units_by_kind.get(kind, 0) + units
        by_cohort[_cohort_of(cls)] = by_cohort.get(_cohort_of(cls), 0.0) + eur
        by_voice_kind[kind] = by_voice_kind.get(kind, 0.0) + eur
        if cls is not None:
            _class_slot(cls)["eur"] += eur

    return {
        "currency": CURRENCY,
        "period": period,
        "total_eur": round(total, 4),
        "voice_eur": round(voice_total, 4),
        "voice_units": voice_units,
        "by_cohort": [
            {"cohort": k, "eur": round(v, 4)} for k, v in sorted(by_cohort.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "by_model": [
            {"model": k, "eur": round(v, 4)} for k, v in sorted(by_model.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "by_voice_kind": [
            {"kind": k, "eur": round(v, 4), "units": voice_units_by_kind.get(k, 0)}
            for k, v in sorted(by_voice_kind.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "per_class": [
            {**v, "eur": round(v["eur"], 4)} for v in sorted(per_class.values(), key=lambda x: x["eur"], reverse=True)
        ],
    }


__all__ = [
    "Period",
    "class_spend",
    "classes_spend",
    "cohort_spend",
    "period_bounds",
    "project_month_eur",
    "spend_rows",
    "voice_spend",
]
