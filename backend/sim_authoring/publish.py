"""Prepare one checked draft version for students (in-app-sim-authoring M6).

Publishing never trusts what the workshop showed earlier. It takes the exact
stored version and:

1. refuses anything below level 3 (it must have run, moved and fitted in the
   browser under the sandbox policy);
2. reads the catalogue entry and refuses an id a built-in sim already has;
3. stamps the canonical guest bridge, as ``scripts/build-artefact-bridge.mjs``
   does for built-in sims, so the page talks to the tutor the same way;
4. re-runs every static gate on the stamped page: tier A (no network, size,
   vendor hashes), B (prompt conformance, bridge), C (catalogue agreement) and,
   when the version recorded what the student must work out, D (not on screen).

Any failure refuses the publish with reasons a teacher can act on.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import yaml

import sim_gates
from db.models.artefact import ArtefactMeta

_START_RE = re.compile(r"[ \t]*<!--\s*@aipla-bridge:start\b[^>]*-->\n")
_END_RE = re.compile(r"\n[ \t]*<!--\s*@aipla-bridge:end\s*-->")

# Catalogue fields a teacher's entry may set. Everything else (source, owner,
# scope, status, version) is the platform's to decide.
_TEACHER_FIELDS = (
    "id",
    "displayName",
    "description",
    "topics",
    "levels",
    "language",
    "eventVocabulary",
    "tutorBlock",
    "minViewportPx",
    "commands",
    "assessment",
)


class NotPublishable(Exception):
    """The version cannot go to students; ``reasons`` say why."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.reasons = reasons


@dataclass
class Prepared:
    sim_id: str
    meta: dict[str, Any]
    html: str
    gates: dict[str, Any]


def stamp_bridge(index_html: str, bridge_source: str) -> str:
    """Put the canonical bridge between the page's bridge markers."""
    start = _START_RE.search(index_html)
    if not start:
        raise NotPublishable(["The page has no @aipla-bridge markers, so it could not talk to the tutor."])
    rest = index_html[start.end() :]
    end = _END_RE.search(rest)
    if not end:
        raise NotPublishable(["The page's @aipla-bridge start marker has no end marker."])
    block = "<script>\n" + bridge_source.rstrip("\n") + "\n</script>"
    return index_html[: start.end()] + block + rest[end.start() :]


def prepare(version_doc: dict[str, Any], *, builtin_ids: set[str]) -> Prepared:
    """Turn a stored draft version into what students get, or raise ``NotPublishable``."""
    if int(version_doc.get("level") or 0) < 3:
        raise NotPublishable(
            ["Only a version at level 3 of 3 can be published: it has to run, move and fit on a phone first."]
        )
    try:
        raw = yaml.safe_load(version_doc.get("yaml") or "") or {}
        if not isinstance(raw, dict):
            raise ValueError("not a mapping")
        entry = {k: raw[k] for k in _TEACHER_FIELDS if k in raw}
        meta = ArtefactMeta.model_validate(entry)
    except Exception as exc:
        raise NotPublishable([f"The catalogue entry is not valid: {exc}"[:400]]) from exc
    if meta.id in builtin_ids:
        raise NotPublishable(
            [f"The id {meta.id!r} belongs to a built-in sim. Ask the assistant to give this sim its own id."]
        )

    bridge = sim_gates.load_bridge()
    if not bridge:
        raise NotPublishable(["The guest bridge is not available on this server, so the page cannot be prepared."])
    html = stamp_bridge(version_doc.get("html") or "", bridge)

    terms = [t for t in (version_doc.get("hiddenTerms") or []) if isinstance(t, str) and t.strip()]
    tiers = ("A", "B", "C", "D") if terms else ("A", "B", "C")
    report = sim_gates.run(html, catalogue_yaml=version_doc.get("yaml"), hidden_terms=terms or None, tiers=tiers)
    if not report.ok:
        raise NotPublishable([f"{g.id}: {g.detail}" for g in report.failed()][:8] or ["A check could not run."])

    return Prepared(
        sim_id=meta.id, meta=meta.model_dump(by_alias=True, exclude_none=True), html=html, gates=report.to_dict()
    )
