"""A per-session record of a sim experiment, rendered for the tutor (1.1.155 M3).

Design: docs/design/aipla/v1.1.0-feedback/sim-context-and-class-report.md (F3, D3)

Every generic-frame push lands on ONE latest-value key
(``mcp_app_context.<sim>.state``), so each push replaced the last: after
Capture → slider → Run the tutor could no longer see the reading the student had
just taken, and it never saw the earlier ones. It was also reading raw JSON with
internal names (``power_W``, ``t_end_C``) and echoing them back.

For a sim that declares ``record:`` in its catalogue entry, the iframe-context
route also folds each push into a bounded ledger under ``mcp_app_ledger.<sim>``.
The latest-value key is untouched, so nothing that reads it changes. This module
holds the two pure halves:

- ``append`` — fold one push into the ledger (settings, runs, the last N
  measurements, and a bounded list of recent events);
- ``render`` — plain prose in the session's language, using the declared labels
  and units, with the events since the tutor's last reply collapsed ("Effekt
  2000 → 2200 W").

Hidden-answer rule: the ledger only holds fields the sim declares and emits.
Nothing is computed here — no energy, no efficiency.
"""

from __future__ import annotations

from typing import Any

from db.models.artefact import ArtefactRecord, RecordField

LEDGER_PREFIX = "mcp_app_ledger."
LEDGER_VERSION = 1
#: Recent events kept for "since your last reply". Bounded so the session state
#: cannot grow with the lesson; a tutor that has not replied for 40 events is
#: told the list is truncated rather than shown all of it.
MAX_EVENTS = 40


def ledger_key(server_id: str) -> str:
    return f"{LEDGER_PREFIX}{server_id}"


def _suffix(kind: Any) -> str:
    return kind.rsplit(".", 1)[-1] if isinstance(kind, str) and kind else ""


def _scalar(v: Any) -> bool:
    return isinstance(v, (int, float, str)) and not isinstance(v, bool)


def append(
    ledger: dict[str, Any] | None,
    structured_content: dict[str, Any],
    record: ArtefactRecord,
    *,
    at: float,
    lang: str,
) -> dict[str, Any]:
    """Return a NEW ledger with this push folded in. Never mutates its input.

    ``lang`` is stamped only when the ledger is created; it is the activity's
    language, resolved once per session by the caller.
    """
    old = ledger if isinstance(ledger, dict) and ledger.get("v") == LEDGER_VERSION else None
    out: dict[str, Any] = {
        "v": LEDGER_VERSION,
        "lang": (old or {}).get("lang") or lang,
        "settings": dict((old or {}).get("settings") or {}),
        "runs": int((old or {}).get("runs") or 0),
        "readings": list((old or {}).get("readings") or []),
        "readings_total": int((old or {}).get("readings_total") or 0),
        "events": list((old or {}).get("events") or []),
        "last_event": (old or {}).get("last_event"),
    }
    kind = _suffix(structured_content.get("kind") or structured_content.get("lastEvent"))
    state = structured_content.get("state") if isinstance(structured_content.get("state"), dict) else {}

    events: list[dict[str, Any]] = []
    for f in record.settings:
        new = state.get(f.key)
        if not _scalar(new):
            continue
        prev = out["settings"].get(f.key)
        if prev is not None and prev != new:
            events.append({"at": at, "type": "set", "key": f.key, "from": prev, "to": new})
        out["settings"][f.key] = new

    if kind and kind == record.run_event:
        out["runs"] += 1
        events.append({"at": at, "type": "run", "settings": dict(out["settings"])})

    m = record.measurements
    if m is not None and kind == m.event:
        payload = structured_content.get(m.path)
        if isinstance(payload, dict):
            row = {f.key: payload[f.key] for f in m.fields if _scalar(payload.get(f.key))}
            if row:
                out["readings_total"] += 1
                row["n"] = out["readings_total"]
                out["readings"] = [*out["readings"], row][-m.keep :]
                events.append({"at": at, "type": "reading", "n": row["n"]})

    # Any other kind the student caused (stop, reset, pause …) is named, not
    # interpreted. `open` (which sets the baseline: a first value is never a
    # change) and bare state syncs are not news.
    if kind and not events and kind not in ("state-change", "open"):
        events.append({"at": at, "type": "other", "kind": kind})

    out["events"] = [*out["events"], *events][-MAX_EVENTS:]
    if kind:
        out["last_event"] = kind
    return out


# Prompt copy, both languages, one object (content-localisation M4). The
# language is chosen per session from the activity, never baked in here.
_COPY: dict[str, dict[str, str]] = {
    "da": {
        "now": "Nu",
        "last": "senest",
        "since": "Siden dit sidste svar",
        "since_start": "Indtil nu i denne session",
        "nothing": "ingen ændringer",
        "run_one": "startede en kørsel ({settings})",
        "run_many": "startede {n} kørsler",
        "captured": "registrerede aflæsning {ns}",
        "other": "også: {kinds}",
        "truncated": "(ældre hændelser ikke vist)",
        "readings": "Aflæsninger indtil nu",
        "none": "ingen endnu",
        "older": "{n} tidligere aflæsninger ikke vist",
        "runs": "kørsler i alt: {n}",
    },
    "en": {
        "now": "Now",
        "last": "last",
        "since": "Since your last reply",
        "since_start": "So far in this session",
        "nothing": "no changes",
        "run_one": "started a run ({settings})",
        "run_many": "started {n} runs",
        "captured": "captured reading {ns}",
        "other": "also: {kinds}",
        "truncated": "(older events not shown)",
        "readings": "Readings so far",
        "none": "none yet",
        "older": "{n} earlier readings not shown",
        "runs": "runs in total: {n}",
    },
}


def _copy(lang: str) -> dict[str, str]:
    return _COPY.get(lang) or _COPY["en"]


def _num(v: Any) -> str:
    if isinstance(v, float):
        # Float noise (0.051000000000000004) is not a measurement; sims round
        # before they emit, so 6 places never hides a real digit.
        v = round(v, 6)
        if v.is_integer():
            return str(int(v))
    return str(v)


def _with_unit(field: RecordField, v: Any) -> str:
    return f"{_num(v)} {field.unit}".strip()


def _labelled(field: RecordField, v: Any, lang: str) -> str:
    return f"{field.label_for(lang)} {_with_unit(field, v)}"


def render(
    ledger: dict[str, Any],
    record: ArtefactRecord,
    display_name: str,
    *,
    since: float | None,
    lang: str | None = None,
) -> str:
    """The tutor's view of one sim, as a few lines of prose.

    ``since`` is the time of the tutor's last reply; events after it are
    summarised as news. ``None`` (no reply yet) summarises the whole session.
    """
    lang = lang or ledger.get("lang") or "en"
    c = _copy(lang)
    fields = {f.key: f for f in record.settings}

    now = ", ".join(
        _labelled(fields[k], ledger["settings"][k], lang) for k in fields if k in (ledger.get("settings") or {})
    )
    last = ledger.get("last_event")
    lines = [f"{c['now']}: {now or '—'}" + (f" ({c['last']}: {last})" if last else "") + "."]

    events = ledger.get("events") or []
    news = [e for e in events if since is None or (e.get("at") or 0) > since]
    parts: list[str] = []
    changes: dict[str, list[Any]] = {}
    for e in news:
        if e.get("type") == "set" and e.get("key") in fields:
            span = changes.setdefault(e["key"], [e.get("from"), e.get("to")])
            span[1] = e.get("to")
    for key, (frm, to) in changes.items():
        if frm != to:
            parts.append(f"{fields[key].label_for(lang)} {_num(frm)} → {_with_unit(fields[key], to)}")
    runs = [e for e in news if e.get("type") == "run"]
    if len(runs) == 1:
        settings = runs[0].get("settings") or {}
        shown = ", ".join(_with_unit(fields[k], settings[k]) for k in fields if k in settings)
        parts.append(c["run_one"].format(settings=shown))
    elif runs:
        parts.append(c["run_many"].format(n=len(runs)))
    caught = [f"#{e['n']}" for e in news if e.get("type") == "reading" and "n" in e]
    if caught:
        parts.append(c["captured"].format(ns=", ".join(caught)))
    others = sorted({e["kind"] for e in news if e.get("type") == "other" and e.get("kind")})
    if others:
        parts.append(c["other"].format(kinds=", ".join(others)))
    head = c["since"] if since is not None else c["since_start"]
    truncated = since is not None and len(events) >= MAX_EVENTS and news == events
    lines.append(f"{head}: {'; '.join(parts) or c['nothing']}" + (f" {c['truncated']}" if truncated else "") + ".")

    m = record.measurements
    if m is not None:
        readings = ledger.get("readings") or []
        if readings:
            shown = [
                f"#{r.get('n')} " + " · ".join(_labelled(f, r[f.key], lang) for f in m.fields if f.key in r)
                for r in readings
            ]
            older = int(ledger.get("readings_total") or 0) - len(readings)
            tail = f" ({c['older'].format(n=older)})" if older > 0 else ""
            lines.append(f"{c['readings']}{tail}:\n" + "\n".join(f"- {s}" for s in shown))
        else:
            lines.append(f"{c['readings']}: {c['none']}.")
    if record.run_event:
        lines.append(c["runs"].format(n=int(ledger.get("runs") or 0)).capitalize() + ".")

    return f"{display_name}\n" + "\n".join(lines)


__all__ = ["LEDGER_PREFIX", "MAX_EVENTS", "append", "ledger_key", "render"]
