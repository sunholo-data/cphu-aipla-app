"""The lesson, for the whole class first (1.1.139 M1).

A **lesson** is an ``(activity, date)`` pair derived from the class's sessions
(D2: start there; add naming only if a class runs one activity across days).
The date is the Copenhagen calendar day the session STARTED on, so a 23:30 UTC
evening session is filed under the day the class actually had.

What this module computes, per lesson, from what already exists — no new store
except one small synthesis cache:

* **Concepts** — per concept, which groups ``discussed`` / ``struggled`` /
  ``demonstrated`` it. Built from M0's structured concepts on each session's
  summary cache doc, MERGED with ``concept_progress`` when the activity has a
  concept map: for a map-backed concept, ``demonstrated`` is read from the
  tutor's evidence record (the same derived status the 1.1.121 class graph
  shows), never from the narrative — one number, not two.
* **Teaching approach** — the per-session fidelity reads ALREADY STORED
  (``framework_fidelity._cached``), rolled up with honest coverage: assessed
  in N of M groups, K too short to judge, J not judged yet. Nothing here runs
  the judge.
* **Next time** — each group's *Next time* line, parsed from its narrative,
  and ONE short class synthesis.
* **Groups** — one line each, with outlier flags.

## Cost and latency (1.1.131)

Everything synchronous here (BigQuery, Firestore) is called from the routes
through ``CACHE.aget_or_compute`` / ``asyncio.to_thread``. **Page load never
fans out model calls**: a session with no summary is reported as *not
summarised yet*, and :func:`summarise_missing` — an explicit teacher action —
generates them with a concurrency cap and a per-request cap. The only model
call a page load may make is :func:`resolve_synthesis`: ONE call per lesson,
cached on a fingerprint of its inputs, debounced, and skipped entirely when
the caller asks for cached-only (the class page's card does).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import statistics
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

LESSON_TZ = ZoneInfo("Europe/Copenhagen")

#: How far back the lessons list looks. A school year, which bounds the scan.
LESSONS_WINDOW = timedelta(days=365)

#: Strength order for one group's reading of one concept across its sessions.
STATUS_RANK = {"discussed": 0, "struggled": 1, "demonstrated": 2}
STATUSES = ("discussed", "struggled", "demonstrated")

#: Explicit "summarise the rest" action: at most this many model calls per
#: request, at most this many in flight at once.
SUMMARISE_MAX_PER_REQUEST = 8
SUMMARISE_CONCURRENCY = 2

#: A changed synthesis input is re-synthesised no more often than this.
SYNTHESIS_DEBOUNCE = timedelta(minutes=5)
SYNTHESIS_VERSION = "lesson-synth-v1"
_SYNTH_COLLECTION = "lesson_syntheses"


# --- Sessions → lessons ----------------------------------------------------------


def class_sessions(group_codes: list[str], since: datetime) -> list[dict[str, Any]]:
    """One row per session the class's groups produced a turn in. BigQuery,
    synchronous — call off the loop. ``activity_id`` is the TUTOR-5 stamp
    (JSON_VALUE: older tables may not carry the field), else None."""
    from db.bigquery import CHAT_TURN_TABLE, run_query, table_ref

    codes = [c for c in group_codes if c]
    if not codes:
        return []
    rows = run_query(
        "SELECT jsonPayload.session_id AS session_id, "
        "ANY_VALUE(jsonPayload.group_id) AS group_id, "
        "ANY_VALUE(jsonPayload.skill_id) AS skill_id, "
        "MAX(JSON_VALUE(TO_JSON_STRING(jsonPayload), '$.activity_id')) AS activity_id, "
        "ARRAY_AGG(JSON_VALUE(TO_JSON_STRING(jsonPayload), '$.framework_id') IGNORE NULLS "
        "ORDER BY timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS framework_id, "
        "MIN(timestamp) AS started_at, MAX(timestamp) AS last_at, COUNT(*) AS turns "
        f"FROM {table_ref(CHAT_TURN_TABLE)} "
        "WHERE jsonPayload.group_id IN UNNEST(@group_codes) AND timestamp >= @since "
        "GROUP BY session_id",
        params={"group_codes": codes, "since": since},
    )
    out = []
    for r in rows:
        get = r.get if hasattr(r, "get") else (lambda k, _r=r: _r[k])
        if not get("session_id"):
            continue
        out.append(
            {
                "sessionId": get("session_id"),
                "groupCode": get("group_id") or "",
                "skillId": get("skill_id") or "",
                "activityId": get("activity_id") or None,
                "frameworkId": get("framework_id") or None,
                "startedAt": get("started_at"),
                "lastAt": get("last_at"),
                "turns": int(get("turns") or 0),
            }
        )
    return out


def _as_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value:
        try:
            ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return ts if ts.tzinfo else ts.replace(tzinfo=UTC)
        except ValueError:
            return None
    return None


def lesson_date(started_at: Any) -> str | None:
    ts = _as_dt(started_at)
    return ts.astimezone(LESSON_TZ).date().isoformat() if ts else None


def activity_key(row: dict[str, Any]) -> str:
    """The lesson's activity: the stamped ``act-…`` id, else the skill id (rows
    from before the TUTOR-5 stamp, 2026-09-11)."""
    return row.get("activityId") or row.get("skillId") or "unknown"


def group_into_lessons(sessions: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    out: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for s in sessions:
        d = lesson_date(s.get("startedAt"))
        if not d:
            continue
        out.setdefault((activity_key(s), d), []).append(s)
    return out


def activity_title(key: str) -> str:
    """The activity's title, else the skill's display name, else the id."""
    try:
        from db.activities import get_activity

        act = get_activity(key, include_deleted=True)
        if act is not None and act.title:
            return act.title
    except Exception as exc:
        log.warning("lessons: activity lookup failed for %s (%s)", key, type(exc).__name__)
    try:
        from db.firestore import get_document

        skill = get_document("skills", key) or {}
        name = skill.get("displayName") or skill.get("name")
        if name:
            return str(name)
    except Exception as exc:
        log.warning("lessons: skill lookup failed for %s (%s)", key, type(exc).__name__)
    return key


def _class_codes(class_id: str) -> list[str]:
    from db.classes import get_class

    cls = get_class(class_id)
    # Evidence surface: ALL codes, revoked included (1.1.146 — revoke ends
    # access, never evidence).
    return list(cls.group_codes) if cls is not None else []


def list_lessons(class_id: str, *, now: datetime | None = None) -> dict[str, Any]:
    """Every lesson this class has had, most recent first. Synchronous."""
    now = now or datetime.now(UTC)
    sessions = class_sessions(_class_codes(class_id), now - LESSONS_WINDOW)
    lessons = []
    titles: dict[str, str] = {}
    for (key, day), rows in group_into_lessons(sessions).items():
        if key not in titles:
            titles[key] = activity_title(key)
        started = min((_as_dt(r["startedAt"]) for r in rows if _as_dt(r["startedAt"])), default=None)
        last = max((_as_dt(r["lastAt"]) for r in rows if _as_dt(r["lastAt"])), default=None)
        lessons.append(
            {
                "activityId": key,
                "activityTitle": titles[key],
                "date": day,
                "groups": len({r["groupCode"] for r in rows if r["groupCode"]}),
                "sessions": len(rows),
                "turns": sum(r["turns"] for r in rows),
                "startedAt": started.isoformat() if started else None,
                "lastAt": last.isoformat() if last else None,
            }
        )
    lessons.sort(key=lambda lesson: (lesson["date"], lesson["lastAt"] or ""), reverse=True)
    return {"classId": class_id, "lessons": lessons}


# --- One lesson -------------------------------------------------------------------

_NEXT_TIME = re.compile(r"\*\*Next time\*\*\s*(?:\([^)]*\))?\s*:?\s*(.*)", re.IGNORECASE)


def next_time_line(markdown: str | None) -> str | None:
    """The narrative's *Next time* sentence (heading line, or the line after)."""
    if not markdown:
        return None
    lines = markdown.splitlines()
    for i, line in enumerate(lines):
        m = _NEXT_TIME.search(line)
        if not m:
            continue
        rest = m.group(1).strip()
        if not rest:
            rest = next((ln.strip() for ln in lines[i + 1 :] if ln.strip()), "")
        rest = rest.lstrip("-* ").strip()
        return rest[:400] or None
    return None


def _fidelity(session_id: str, framework_id: str | None):
    """The STORED fidelity read, or None. Never runs the judge."""
    try:
        from analytics.framework_fidelity import _cached

        return _cached(session_id, framework_id)
    except Exception as exc:
        log.warning("lessons: fidelity read failed for %s (%s)", session_id, type(exc).__name__)
        return None


def _session_index(session_id: str):
    try:
        from db.chat_sessions import get_session_index

        return get_session_index(session_id)
    except Exception as exc:
        log.warning("lessons: index read failed for %s (%s)", session_id, type(exc).__name__)
        return None


def _progress_for(class_id: str, activity_id: str, groups: set[str], labels: dict[str, str]) -> dict[str, dict]:
    """``{group: {concept_key: {status, evidence}}}`` from the tutor's record
    for THIS activity — the 1.1.121 source, derived the one way it is derived."""
    from db.class_concept_rollup import normalise_concept
    from db.concept_progress import docs_for_class, states_from_stored

    out: dict[str, dict] = {}
    for doc in docs_for_class(class_id):
        gid = doc.get("groupId") or ""
        if doc.get("activityId") != activity_id or gid not in groups:
            continue
        for node_id, st in states_from_stored(doc.get("nodeStates", {})).items():
            label = labels.get(node_id, node_id)
            records = st.get("evidence") or []
            latest = next((r for r in reversed(records) if (r.get("summary") or "").strip()), None)
            out.setdefault(gid, {})[normalise_concept(label)] = {
                "status": st.get("status"),
                "nodeId": node_id,
                "label": label,
                "evidence": (latest or {}).get("summary") or None,
            }
    return out


def _stronger(a: str | None, b: str | None) -> str | None:
    if a is None:
        return b
    if b is None:
        return a
    return b if STATUS_RANK.get(b, -1) > STATUS_RANK.get(a, -1) else a


def roll_up_concepts(
    group_concepts: dict[str, list[dict[str, Any]]],
    progress: dict[str, dict[str, dict]],
    node_keys: set[str],
) -> list[dict[str, Any]]:
    """Pure. ``group_concepts``: group → its M0 concepts (all sessions in the
    lesson). ``progress``: group → concept_key → tutor record. ``node_keys``:
    keys of the activity's concept-map nodes (map-backed concepts).

    For a map-backed concept, ``demonstrated`` comes ONLY from ``progress``;
    a narrative's stored ``demonstrated`` (stamped at summary time, possibly
    since overridden by the teacher) is read as ``discussed``.
    """
    from db.class_concept_rollup import normalise_concept

    by_key: dict[str, dict[str, Any]] = {}
    for gid, concepts in group_concepts.items():
        for c in concepts:
            # A map-backed concept carries its node's label, and the class graph
            # joins on that label's normalisation — so key on it, not on M0's key.
            raw_key = c.get("label") if c.get("nodeId") else (c.get("key") or c.get("label"))
            key = normalise_concept(str(raw_key or ""))
            if not key:
                continue
            status = c.get("status") if c.get("status") in STATUS_RANK else "discussed"
            if key in node_keys and status == "demonstrated":
                status = "discussed"
            entry = by_key.setdefault(
                key, {"key": key, "label": c.get("label") or key, "nodeId": c.get("nodeId"), "byGroup": {}}
            )
            cur = entry["byGroup"].get(gid)
            entry["byGroup"][gid] = {
                "status": _stronger(cur["status"] if cur else None, status),
                "evidence": cur["evidence"] if cur else None,
            }
    for gid, per in progress.items():
        for key, rec in per.items():
            status = rec.get("status")
            mapped = {"demonstrated": "demonstrated", "partial": "discussed"}.get(status or "")
            if mapped is None:
                continue  # not_yet: "has not shown it" — not a reading of the lesson
            entry = by_key.setdefault(
                key, {"key": key, "label": rec.get("label") or key, "nodeId": rec.get("nodeId"), "byGroup": {}}
            )
            entry["nodeId"] = entry.get("nodeId") or rec.get("nodeId")
            cur = entry["byGroup"].get(gid) or {"status": None, "evidence": None}
            entry["byGroup"][gid] = {
                "status": _stronger(cur["status"], mapped),
                "evidence": rec.get("evidence") or cur["evidence"],
            }
    out = []
    for entry in by_key.values():
        counts = Counter(v["status"] for v in entry["byGroup"].values())
        out.append(
            {
                "key": entry["key"],
                "label": entry["label"],
                "nodeId": entry["nodeId"],
                "mapped": entry["key"] in node_keys,
                "counts": {s: counts.get(s, 0) for s in STATUSES},
                "groups": [
                    {"groupCode": gid, "status": v["status"], "evidence": v["evidence"]}
                    for gid, v in sorted(entry["byGroup"].items())
                ],
            }
        )
    # Most-struggled first, then most groups, then the label for stability.
    out.sort(key=lambda c: (-c["counts"]["struggled"], -sum(c["counts"].values()), c["label"].lower()))
    return out


def roll_up_approach(per_group: dict[str, Any], *, researcher: bool) -> dict[str, Any]:
    """Pure. ``per_group``: group → its latest session's stored FidelityResult
    (or None = not judged yet) plus the session's framework id.

    Coverage first; teachers get prose only (1.1.65 R1, D3), researchers the
    per-construct band distribution too.
    """
    frameworks = Counter(v["frameworkId"] for v in per_group.values() if v.get("frameworkId"))
    total = len(per_group)
    if not frameworks:
        return {"state": "no_framework", "coverage": {"groups": total}, "frameworkId": None}
    framework_id = frameworks.most_common(1)[0][0]
    assessed = too_short = other_abstain = not_judged = other_framework = 0
    summaries: list[dict[str, Any]] = []
    bands: dict[str, Counter] = {}
    overall: Counter = Counter()
    label = None
    for gid, v in sorted(per_group.items()):
        if v.get("frameworkId") != framework_id:
            other_framework += 1
            continue
        res = v.get("fidelity")
        if res is None:
            not_judged += 1
            continue
        label = label or res.framework_label
        if res.abstained:
            if "too little dialogue" in (res.abstain_reason or ""):
                too_short += 1
            else:
                other_abstain += 1
            continue
        assessed += 1
        summaries.append({"groupCode": gid, "summary": res.summary, "drift": list(res.drift)})
        if researcher:
            overall[res.overall_band or "absent"] += 1
            for key, c in (res.constructs or {}).items():
                bands.setdefault(key, Counter())[str(c.get("band") or "absent")] += 1
    out: dict[str, Any] = {
        "state": "assessed" if assessed else "not_assessed",
        "frameworkId": framework_id,
        "frameworkLabel": label,
        "coverage": {
            "groups": total,
            "assessed": assessed,
            "tooShort": too_short,
            "abstained": other_abstain,
            "notJudged": not_judged,
            "otherApproach": other_framework,
        },
        "groupSummaries": summaries,
    }
    if researcher:
        out["bands"] = {k: dict(v) for k, v in sorted(bands.items())}
        out["overallBands"] = dict(overall)
    return out


def flag_outliers(groups: list[dict[str, Any]]) -> None:
    """In place. ``struggle``: clearly more struggled concepts than the class's
    median group. ``drift``: the approach read was ``absent`` overall, or named
    two or more drifts. A flag says "look here", never a rank."""
    counts = [g["struggledCount"] for g in groups if g["summarised"]]
    median = statistics.median(counts) if counts else 0
    for g in groups:
        flags = []
        if g["summarised"] and g["struggledCount"] >= 2 and g["struggledCount"] > median + 1:
            flags.append("struggle")
        if g.get("_band") == "absent" or g.get("_driftCount", 0) >= 2:
            flags.append("drift")
        g["flags"] = flags
        g.pop("_band", None)
        g.pop("_driftCount", None)


def lesson_detail(class_id: str, activity_id: str, day: str, *, researcher: bool = False) -> dict[str, Any] | None:
    """Everything the lesson page shows, with NO model call. Synchronous.
    None when the class had no session of this activity on this day."""
    from reports.narrative import CONCEPTS_VERSION

    try:
        target = date.fromisoformat(day)
    except ValueError:
        return None
    since = datetime.combine(target - timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    sessions = [
        s
        for s in class_sessions(_class_codes(class_id), since)
        if activity_key(s) == activity_id and lesson_date(s.get("startedAt")) == day
    ]
    if not sessions:
        return None

    labels: dict[str, str] = {}
    try:
        from db.activities import get_activity

        act = get_activity(activity_id, include_deleted=True)
        if act is not None and act.concept_map:
            labels = {n.id: n.label for n in act.concept_map[0].nodes}
    except Exception as exc:
        log.warning("lessons: concept map read failed for %s (%s)", activity_id, type(exc).__name__)
    from db.class_concept_rollup import normalise_concept

    node_keys = {normalise_concept(v) for v in labels.values()}

    by_group: dict[str, list[dict[str, Any]]] = {}
    for s in sorted(sessions, key=lambda s: _as_dt(s["lastAt"]) or datetime.min.replace(tzinfo=UTC)):
        by_group.setdefault(s["groupCode"] or "?", []).append(s)

    group_concepts: dict[str, list[dict[str, Any]]] = {}
    approach_in: dict[str, Any] = {}
    groups: list[dict[str, Any]] = []
    next_lines: list[dict[str, str]] = []
    missing: list[str] = []
    uncached: list[str] = []
    for gid, rows in by_group.items():
        concepts: list[dict[str, Any]] = []
        summarised = extracted = False
        nxt = None
        for s in rows:
            idx = _session_index(s["sessionId"])
            if idx is None:
                # No index row = nowhere to cache a summary (the index is sparse
                # for some anonymous sessions). Generating one would be paid for
                # again on every read, so it is counted, never queued.
                uncached.append(s["sessionId"])
                continue
            if not (idx.summary_text or "").strip():
                missing.append(s["sessionId"])
                continue
            summarised = True
            nxt = next_time_line(idx.summary_text) or nxt
            if idx.concepts is not None and idx.concepts_version == CONCEPTS_VERSION:
                extracted = True
                concepts.extend(idx.concepts)
            else:
                missing.append(s["sessionId"])
        group_concepts[gid] = concepts
        latest = rows[-1]
        fid = _fidelity(latest["sessionId"], latest.get("frameworkId"))
        approach_in[gid] = {"frameworkId": latest.get("frameworkId"), "fidelity": fid}
        if nxt:
            next_lines.append({"groupCode": gid, "text": nxt})
        groups.append(
            {
                "groupCode": gid,
                "latestSessionId": latest["sessionId"],
                "sessionIds": [r["sessionId"] for r in rows],
                "turns": sum(r["turns"] for r in rows),
                "summarised": summarised,
                "conceptsExtracted": extracted,
                "nextTime": nxt,
                "_band": fid.overall_band if fid is not None and not fid.abstained else None,
                "_driftCount": len(fid.drift) if fid is not None and not fid.abstained else 0,
                "approachSummary": fid.summary if fid is not None and not fid.abstained else None,
            }
        )

    progress = _progress_for(class_id, activity_id, set(by_group), labels) if labels else {}
    concepts = roll_up_concepts(group_concepts, progress, node_keys)

    for g in groups:
        mine = [(c, x) for c in concepts for x in c["groups"] if x["groupCode"] == g["groupCode"]]
        g["struggledCount"] = sum(1 for _, x in mine if x["status"] == "struggled")
        struggled = [c["label"] for c, x in mine if x["status"] == "struggled"]
        g["topConcept"] = struggled[0] if struggled else (mine[0][0]["label"] if mine else None)
    flag_outliers(groups)
    groups.sort(key=lambda g: (not g["flags"], g["groupCode"]))

    approach = roll_up_approach(approach_in, researcher=researcher)
    return {
        "classId": class_id,
        "activityId": activity_id,
        "activityTitle": activity_title(activity_id),
        "date": day,
        "hasConceptMap": bool(labels),
        "concepts": concepts,
        "approach": approach,
        "nextTime": {"groups": next_lines},
        "groups": groups,
        "coverage": {
            "groups": len(groups),
            "sessions": len(sessions),
            "summarised": sum(1 for g in groups if g["summarised"]),
            "conceptsExtracted": sum(1 for g in groups if g["conceptsExtracted"]),
            "pendingSessions": len(set(missing)),
            "unsummarisable": len(set(uncached)),
        },
        "pendingSessionIds": sorted(set(missing)),
    }


# --- The one model call per lesson ---------------------------------------------------

_SYNTH_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {"approach": {"type": "STRING"}, "nextTime": {"type": "STRING"}},
    "required": ["approach", "nextTime"],
}


def synthesis_inputs(detail: dict[str, Any]) -> dict[str, Any]:
    approach = detail.get("approach") or {}
    return {
        "activity": detail.get("activityTitle"),
        "approach": approach.get("frameworkLabel"),
        "groupApproach": [{"summary": g["summary"], "drift": g["drift"]} for g in approach.get("groupSummaries") or []],
        "nextTime": [g["text"] for g in (detail.get("nextTime") or {}).get("groups") or []],
    }


def fingerprint(inputs: dict[str, Any]) -> str:
    raw = json.dumps({"v": SYNTHESIS_VERSION, **inputs}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _synth_doc_id(class_id: str, activity_id: str, day: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", f"{class_id}__{activity_id}__{day}")


def build_synthesis_prompt(inputs: dict[str, Any]) -> str:
    return (
        "You are helping a physics teacher review one lesson across all groups in the class.\n"
        "Write two short fields, no preamble, no emoji, no numbers or scores, never name a group:\n"
        "`approach` (2-4 sentences): how the AI tutor's teaching approach "
        f"({inputs.get('approach') or 'unnamed'}) looked ACROSS the class and where it drifted, "
        "from the per-group readings below. Empty string if there are none.\n"
        "`nextTime` (1-2 sentences): what the CLASS most needs next lesson, synthesised from "
        "the groups' lines below. Empty string if there are none.\n\n"
        f"Activity: {inputs.get('activity')}\n"
        f"Per-group approach readings:\n{json.dumps(inputs.get('groupApproach'), ensure_ascii=False)}\n"
        f"Per-group 'next time' lines:\n{json.dumps(inputs.get('nextTime'), ensure_ascii=False)}\n"
    )


_SYNTH_INFLIGHT: dict[tuple[int, str], asyncio.Future] = {}


async def _generate_synthesis(inputs: dict[str, Any]) -> dict[str, str]:
    from reports.narrative import _call_model

    raw = await _call_model(build_synthesis_prompt(inputs), schema=_SYNTH_SCHEMA)
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return {"approach": "", "nextTime": raw.strip()[:600]}
    return {"approach": str(data.get("approach") or "").strip(), "nextTime": str(data.get("nextTime") or "").strip()}


async def resolve_synthesis(detail: dict[str, Any], *, generate: bool = True) -> dict[str, Any] | None:
    """The lesson's class-level prose (approach + next time). Cached in
    ``lesson_syntheses/{class}__{activity}__{date}`` against a fingerprint of
    its inputs. With ``generate=False`` only a cached value is returned — the
    class page's card asks this way, so opening a class page never pays.
    Best-effort: a failure returns the stale value or None."""
    from config.models import analysis_model
    from db.firestore import get_document, set_document

    inputs = synthesis_inputs(detail)
    if not inputs["groupApproach"] and not inputs["nextTime"]:
        return None
    fp = fingerprint(inputs)
    doc_id = _synth_doc_id(detail["classId"], detail["activityId"], detail["date"])
    try:
        cached = await asyncio.to_thread(get_document, _SYNTH_COLLECTION, doc_id)
    except Exception:
        cached = None
    if cached and cached.get("fingerprint") == fp:
        return {**_public(cached), "stale": False}
    if not generate:
        return {**_public(cached), "stale": True} if cached else None
    if cached:
        at = _as_dt(cached.get("generatedAt"))
        if at is not None and datetime.now(UTC) - at < SYNTHESIS_DEBOUNCE:
            return {**_public(cached), "stale": True}

    key = (id(asyncio.get_running_loop()), doc_id)
    task = _SYNTH_INFLIGHT.get(key)
    if task is None:
        task = asyncio.ensure_future(_generate_synthesis(inputs))
        _SYNTH_INFLIGHT[key] = task
        task.add_done_callback(lambda _t: _SYNTH_INFLIGHT.pop(key, None))
    try:
        out = await asyncio.shield(task)
    except Exception as exc:
        log.warning("lessons: synthesis failed for %s (%s)", doc_id, type(exc).__name__)
        return {**_public(cached), "stale": True} if cached else None
    doc = {
        **out,
        "fingerprint": fp,
        "model": analysis_model(),
        "version": SYNTHESIS_VERSION,
        "generatedAt": datetime.now(UTC).isoformat(),
    }
    try:
        await asyncio.to_thread(set_document, _SYNTH_COLLECTION, doc_id, doc)
    except Exception as exc:
        log.warning("lessons: synthesis cache write failed for %s (%s)", doc_id, type(exc).__name__)
    return {**_public(doc), "stale": False}


def _public(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "approach": doc.get("approach") or "",
        "nextTime": doc.get("nextTime") or "",
        "model": doc.get("model"),
        "generatedAt": doc.get("generatedAt"),
    }


# --- The explicit "summarise the rest" action -------------------------------------


async def summarise_sessions(session_ids: list[str], *, cap: int = SUMMARISE_MAX_PER_REQUEST) -> dict[str, int]:
    """Generate the narrative + M0 concepts for up to ``cap`` sessions, at most
    :data:`SUMMARISE_CONCURRENCY` model calls at once. A teacher action, never
    page load. ``force`` is used so a summary from before M0 gains concepts."""
    from reports.narrative import resolve_narrative
    from reports.session_summary import resolve_session_summary

    todo = list(dict.fromkeys(session_ids))[: max(0, cap)]
    sem = asyncio.Semaphore(SUMMARISE_CONCURRENCY)
    done = failed = 0

    async def one(session_id: str) -> bool:
        async with sem:
            summary = await resolve_session_summary(session_id)
            if summary is None:
                return False
            return bool(await resolve_narrative(summary, force=True))

    results = await asyncio.gather(*(one(s) for s in todo), return_exceptions=True)
    for r in results:
        if r is True:
            done += 1
        else:
            failed += 1
    return {
        "requested": len(todo),
        "summarised": done,
        "failed": failed,
        "remaining": max(0, len(session_ids) - len(todo)),
    }


__all__ = [
    "LESSON_TZ",
    "SUMMARISE_MAX_PER_REQUEST",
    "activity_key",
    "class_sessions",
    "flag_outliers",
    "group_into_lessons",
    "lesson_date",
    "lesson_detail",
    "list_lessons",
    "next_time_line",
    "resolve_synthesis",
    "roll_up_approach",
    "roll_up_concepts",
    "summarise_sessions",
]
