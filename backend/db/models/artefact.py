"""Artefact catalogue model (1.1.41).

One sandboxed MCP-App artefact (a simulation) a teacher can attach to an
activity. The artefact is a **reusable resource**: the same artefact appears in
many activities with different per-activity pedagogy (goal + 1.1.38 elements).

The artefact-intrinsic ``tutor_block`` (what the sim is / what its events mean —
NOT the per-activity lesson goal) is injected into the sim-activity tutor at
session-start (1.1.41 M2). It is **server-side only** — never serialized to the
public catalogue API (see ``public()``).

Loaded from ``backend/artefacts/*.yaml`` (mirrors the persona catalogue, 1.1.12)
so the catalogue deploys with the backend image.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from db.models.curriculum import StxLevel

ArtefactStatus = Literal["live", "beta", "deprecated"]

#: How much a command does to the student's screen (1.1.133 M2). Cumulative: a
#: tutor allowed ``scaffold`` may also issue ``view`` commands.
#:
#: - ``view``     — changes what is shown; the student can change it straight back
#: - ``scaffold`` — puts tutor-authored text or structure on the student's screen
#: - ``restrict`` — removes an ability from the student (locks, configuration)
CommandPower = Literal["view", "scaffold", "restrict"]

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


class ArtefactCommand(BaseModel):
    """One thing a tutor may do to a sim (1.1.133 M0).

    The sim must register a host notification ``<artefact-id>.cmd-<name>`` for
    it — ``test_artefact_catalogue.py`` cross-checks the artefact's HTML, so the
    catalogue and the sim cannot disagree about what exists.
    """

    name: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z][a-zA-Z0-9]*$")
    # What the MODEL reads, in the tool description. English, like tutorBlock.
    description: str = Field(min_length=1, max_length=300)
    # A small JSON-Schema subset — see artefacts/arg_schema.py for exactly which.
    args: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})
    # What the STUDENT reads on the chat card, in the sim's own language,
    # templated from the args: "Hoppede til {event}".
    effect: str = Field(min_length=1, max_length=160)
    # Optional student-facing names for enum values, per argument, so the card
    # reads "næste solformørkelse" rather than the wire value "solform".
    value_labels: dict[str, dict[str, str]] = Field(default_factory=dict, alias="valueLabels")
    power: CommandPower = "view"

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("args")
    @classmethod
    def _schema_is_supported(cls, v: dict[str, Any]) -> dict[str, Any]:
        from artefacts.arg_schema import check_schema

        check_schema(v)
        return v

    @model_validator(mode="after")
    def _effect_names_real_args(self) -> ArtefactCommand:
        props = set((self.args.get("properties") or {}).keys())
        for placeholder in _PLACEHOLDER.findall(self.effect):
            if placeholder not in props:
                raise ValueError(f"command {self.name!r}: effect names {{{placeholder}}}, which is not an argument")
        for arg in self.value_labels:
            if arg not in props:
                raise ValueError(f"command {self.name!r}: valueLabels names {arg!r}, which is not an argument")
        return self

    def render_effect(self, args: dict[str, Any]) -> str:
        """The card text for these (already validated) args. Substitution only —
        the template is never format-parsed, so a model-chosen value cannot
        reach anything but its own slot."""

        def _sub(m: re.Match[str]) -> str:
            key = m.group(1)
            value = args.get(key)
            if value is None:
                return ""
            label = self.value_labels.get(key, {}).get(str(value))
            return str(label if label is not None else value)[:80]

        return _PLACEHOLDER.sub(_sub, self.effect).strip()

    def public(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "args": self.args,
            "effect": self.effect,
            "power": self.power,
        }


class ArtefactMeta(BaseModel):
    """A vetted MCP-App artefact in the catalogue."""

    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")
    version: str = Field(default="v1", max_length=16, pattern=r"^v[0-9]+$")
    display_name: str = Field(alias="displayName", min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    topics: list[str] = Field(default_factory=list, max_length=12)
    levels: list[StxLevel] = Field(default_factory=list)
    language: str = Field(default="da", max_length=8)
    event_vocabulary: list[str] = Field(default_factory=list, alias="eventVocabulary", max_length=40)
    # Artefact-intrinsic tutor instructions (NOT the per-activity lesson goal).
    # Injected into the sim-activity tutor at session-start; SERVER-SIDE ONLY —
    # excluded from the public catalogue view.
    # 2,000 -> 16,000 on 2026-09-24: an author-supplied sim can ship a whole
    # activity module (missions + construct map); see teacher_focus._TOTAL_FOCUS_CAP.
    tutor_block: str = Field(default="", alias="tutorBlock", max_length=16000)
    # Optional preview image (a path/URL the picker renders to help a teacher
    # identify the sim at a glance). Unset → the frontend draws an icon/monogram
    # tile. Supply a screenshot here per sim as they're produced.
    thumbnail: str | None = Field(default=None, max_length=300)
    # MOBILE-1 (2026-08-13). Narrowest viewport, in CSS px, at which this
    # artefact is FULLY usable. Unset means "works everywhere", which is the
    # honest default only for artefacts actually built mobile-first.
    #
    # This is artefact-INTRINSIC — a property of how the sim was drawn, not of
    # any activity that hosts it — which is why it lives here and not on the
    # activity config. LED-Planck lays its bench out at fixed coordinates
    # (#breadboard reaches 539px) with no media queries, so on a 390px phone
    # half the equipment is off-screen; touch works fine, there is simply
    # nowhere to put it.
    #
    # The point is to TELL the student, not to hide the activity: a labelled
    # "open this on a tablet" beats a sim that silently renders half a circuit.
    min_viewport_px: int | None = Field(default=None, alias="minViewportPx", ge=320, le=2000)
    status: ArtefactStatus = "live"
    # 1.1.133 M0 — what a tutor may do to this sim. EMPTY MEANS UNCONTROLLABLE:
    # no ``control_sim`` tool is built for an activity hosting it (default-deny,
    # per sim). Public — a teacher should see what the tutor may do in the sim
    # they attach.
    commands: list[ArtefactCommand] = Field(default_factory=list, max_length=30)

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _command_names_unique(self) -> ArtefactMeta:
        names = [c.name for c in self.commands]
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            raise ValueError(f"artefact {self.id!r}: duplicate command name(s) {dupes}")
        return self

    def command(self, name: str) -> ArtefactCommand | None:
        return next((c for c in self.commands if c.name == name), None)

    @property
    def artefact_path(self) -> str:
        """The sandbox path the frontend ``StaticArtefactFrame`` mounts (e.g. ``boldkast/v1``)."""
        return f"{self.id}/{self.version}"

    def public(self) -> dict:
        """Teacher-facing view: what the picker + the artefact frame need, minus
        the server-side ``tutor_block``."""
        return {
            "id": self.id,
            "version": self.version,
            "displayName": self.display_name,
            "description": self.description,
            "topics": self.topics,
            "levels": self.levels,
            "language": self.language,
            "artefactPath": self.artefact_path,
            "thumbnail": self.thumbnail,
            "minViewportPx": self.min_viewport_px,
            "status": self.status,
            "commands": [c.public() for c in self.commands],
        }


__all__ = ["ArtefactCommand", "ArtefactMeta", "ArtefactStatus", "CommandPower"]
