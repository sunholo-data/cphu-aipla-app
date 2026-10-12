"""Tier C — the page and its catalogue entry agree.

Runs only with the YAML, and reports ``skipped`` (never ``pass``) without it, so
a draft cannot be called ok with half of it unread. Validates against the same
pydantic model the catalogue loader uses, so a draft that passes here loads.

``status`` is not checked: the published prompt asks for ``status: live``, and
whether a draft goes live is decided by review, not by this file.
"""

from __future__ import annotations

import yaml
from pydantic import ValidationError

from db.models.artefact import ArtefactMeta

from .conformance import artefact_name, emitted_verbs
from .report import Gate

REFERENCE_LINE = "REFERENCE, FOR CHECKING ONLY"
_IDS = ("C.yaml_validates", "C.id_matches", "C.vocabulary_matches", "C.reference_block")


def check(app: str, catalogue_yaml: str | None) -> list[Gate]:
    if catalogue_yaml is None:
        return [Gate(i, "skipped", "no catalogue YAML supplied") for i in _IDS]
    try:
        meta = ArtefactMeta.model_validate(yaml.safe_load(catalogue_yaml) or {})
    except (yaml.YAMLError, ValidationError) as exc:
        first = str(exc).splitlines()[:4]
        return [
            Gate(
                "C.yaml_validates",
                "fail",
                " ".join(first),
                "Make the catalogue entry valid YAML with the fields the catalogue expects (id, displayName, "
                "eventVocabulary, tutorBlock …). The library cannot load an entry that fails this.",
            ),
            *[Gate(i, "skipped", "the YAML did not validate") for i in _IDS[1:]],
        ]
    gates = [Gate("C.yaml_validates", "pass")]

    name = artefact_name(app)
    gates.append(
        Gate("C.id_matches", "pass", meta.id)
        if name == meta.id
        else Gate(
            "C.id_matches",
            "fail",
            f"YAML id {meta.id!r}, page ARTEFACT_NAME {name!r}",
            "Use the same id in both files. Events are named <id>.<verb>, and the frame matches them to the "
            "catalogue entry by that prefix.",
        )
    )
    emitted, declared = set(emitted_verbs(app)), set(meta.event_vocabulary)
    if emitted == declared:
        gates.append(Gate("C.vocabulary_matches", "pass", ", ".join(sorted(emitted))))
    else:
        parts = []
        if emitted - declared:
            parts.append(f"emitted but not declared: {sorted(emitted - declared)}")
        if declared - emitted:
            parts.append(f"declared but never emitted: {sorted(declared - emitted)}")
        gates.append(
            Gate(
                "C.vocabulary_matches",
                "fail",
                "; ".join(parts),
                "Make eventVocabulary list exactly the verbs the page emits. The tutor is told what each declared "
                "event means; an undeclared one arrives unexplained and a declared one that never fires misleads.",
            )
        )
    gates.append(
        Gate("C.reference_block", "pass")
        if REFERENCE_LINE in meta.tutor_block
        else Gate(
            "C.reference_block",
            "fail",
            f"tutorBlock has no {REFERENCE_LINE!r} line",
            "Put the values the tutor needs to mark an answer under a 'REFERENCE, FOR CHECKING ONLY — NEVER STATE "
            "THESE VALUES' line in tutorBlock. It stays server-side, so it is the one place they are safe.",
        )
    )
    return gates
