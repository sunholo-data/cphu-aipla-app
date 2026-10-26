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


class ArtefactAssessment(BaseModel):
    """The construct map a sim contributes as an assessment scale (1.1.133 M3).

    Optional. When present, a student session gets ``record_assessment``, whose
    phenomenon enum and level range are exactly these — so assessments recorded
    by different tutors on the same sim land on ONE scale and can be compared.
    The level DEFINITIONS stay in ``tutorBlock`` (server-side); this block is
    only the vocabulary the tool enforces. SERVER-SIDE ONLY: "never show the
    student a level" is the sim author's rule, so not even the scale is public.
    """

    phenomena: list[str] = Field(min_length=1, max_length=20)
    min_level: int = Field(default=0, alias="minLevel", ge=0, le=20)
    max_level: int = Field(alias="maxLevel", ge=1, le=20)
    missions: list[str] = Field(default_factory=list, max_length=20)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @model_validator(mode="after")
    def _range_is_a_range(self) -> ArtefactAssessment:
        if self.max_level <= self.min_level:
            raise ValueError("assessment: maxLevel must exceed minLevel")
        for word in [*self.phenomena, *self.missions]:
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,40}", word):
                raise ValueError(f"assessment: {word!r} must be a short identifier")
        return self


_RECORD_KEY = r"^[a-zA-Z][a-zA-Z0-9_]{0,39}$"


class RecordField(BaseModel):
    """One quantity a sim declares in its ``record:`` (1.1.155 D1).

    ``label`` is keyed by language (``{da: …, en: …}``). Which one is shown is
    chosen per session from the activity's language, never baked in here.
    """

    key: str = Field(pattern=_RECORD_KEY)
    label: dict[str, str] = Field(default_factory=dict)
    unit: str = Field(default="", max_length=12)
    # controlledByAction only: the event whose payload carries the value.
    from_event: str | None = Field(default=None, alias="from", max_length=40)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    def label_for(self, lang: str) -> str:
        return self.label.get(lang) or self.label.get("en") or next(iter(self.label.values()), self.key)


def _as_fields(v: Any) -> Any:
    # A bare key ("power_W") is shorthand for a field with no label or unit.
    if isinstance(v, list):
        return [{"key": f} if isinstance(f, str) else f for f in v]
    return v


class RecordMeasurements(BaseModel):
    """What one captured measurement holds: ``structuredContent[path]`` on ``event``."""

    event: str = Field(min_length=1, max_length=40)
    path: str = Field(pattern=_RECORD_KEY)
    fields: list[RecordField] = Field(min_length=1, max_length=20)
    # How many of the latest measurements the tutor sees. Older ones are
    # counted, not shown, so the prompt stays bounded.
    keep: int = Field(default=10, ge=1, le=50)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("fields", mode="before")
    @classmethod
    def _shorthand(cls, v: Any) -> Any:
        return _as_fields(v)


class ArtefactRecord(BaseModel):
    """What a sim's experiment is made of (1.1.155 D1), so readers work from a
    declaration instead of guessing from raw JSON. Every field is optional, and
    a sim without ``record:`` keeps the raw latest-value behaviour.

    Server-side apart from ``tutorTurnOn``, which the frame needs (see
    ``ArtefactMeta.public``). ``extra="forbid"``, so a misspelt key fails the
    load: ``ArtefactMeta`` itself silently drops unknown keys, and a declaration
    that silently does nothing is worse than none.
    """

    settings: list[RecordField] = Field(default_factory=list, max_length=20)
    controlled_by_action: list[RecordField] = Field(default_factory=list, alias="controlledByAction", max_length=10)
    measurements: RecordMeasurements | None = None
    # The event kind (suffix, e.g. "run") that counts as one sim run.
    run_event: str | None = Field(default=None, alias="runEvent", max_length=40)
    # The event kinds that may take the proactive tutor turn (F6). Unset: any
    # meaningful kind may, as before.
    tutor_turn_on: list[str] = Field(default_factory=list, alias="tutorTurnOn", max_length=10)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("settings", "controlled_by_action", mode="before")
    @classmethod
    def _shorthand(cls, v: Any) -> Any:
        return _as_fields(v)

    @field_validator("tutor_turn_on", mode="before")
    @classmethod
    def _one_or_many(cls, v: Any) -> Any:
        return [v] if isinstance(v, str) else v

    def event_names(self) -> set[str]:
        names = {*self.tutor_turn_on}
        if self.run_event:
            names.add(self.run_event)
        if self.measurements:
            names.add(self.measurements.event)
        names.update(f.from_event for f in self.controlled_by_action if f.from_event)
        return names

    def declared_keys(self) -> set[str]:
        keys = {f.key for f in [*self.settings, *self.controlled_by_action]}
        if self.measurements:
            keys.add(self.measurements.path)
            keys.update(f.key for f in self.measurements.fields)
        return keys


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
    # 1.1.133 M3 — the construct map's vocabulary, for ``record_assessment``.
    # Server-side only, like tutor_block: excluded from ``public()``.
    assessment: ArtefactAssessment | None = None
    # 1.1.155 M2 — what the sim's experiment is made of: settings, measurements,
    # which event is a run, which event takes the tutor's proactive turn.
    # Optional and additive; built-in sims only (not a teacher-settable field).
    record: ArtefactRecord | None = None
    # in-app-sim-authoring M6 — where the entry comes from. Set by the loader,
    # never read from a YAML: "builtin" is a reviewed file in this repo; "teacher"
    # was published from the Sim workshop (db/teacher_sims.py) and its page is
    # served by the backend, not the sandbox's /artefacts/ route.
    source: Literal["builtin", "teacher"] = "builtin"
    owner_uid: str | None = Field(default=None, alias="ownerUid")
    scope: Literal["classes", "library"] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _command_names_unique(self) -> ArtefactMeta:
        names = [c.name for c in self.commands]
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            raise ValueError(f"artefact {self.id!r}: duplicate command name(s) {dupes}")
        return self

    @model_validator(mode="after")
    def _record_names_real_events(self) -> ArtefactMeta:
        # A record that names an event the sim never emits would silently never
        # match — the same class as a misspelt key, so it fails the load.
        if self.record is not None and self.event_vocabulary:
            unknown = sorted(self.record.event_names() - set(self.event_vocabulary))
            if unknown:
                raise ValueError(f"artefact {self.id!r}: record names event(s) {unknown} not in eventVocabulary")
        return self

    def command(self, name: str) -> ArtefactCommand | None:
        return next((c for c in self.commands if c.name == name), None)

    @property
    def artefact_path(self) -> str:
        """The sandbox path the frontend ``StaticArtefactFrame`` mounts (e.g. ``boldkast/v1``)."""
        if self.source == "teacher":
            return f"teacher-sims/{self.id}/{self.version}"
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
            "source": self.source,
            **({"scope": self.scope} if self.source == "teacher" else {}),
            # The frame decides which push may ask for a proactive turn, so it
            # needs this one field of the record. The rest stays server-side.
            **({"tutorTurnOn": self.record.tutor_turn_on} if self.record and self.record.tutor_turn_on else {}),
        }


__all__ = [
    "ArtefactAssessment",
    "ArtefactCommand",
    "ArtefactMeta",
    "ArtefactRecord",
    "ArtefactStatus",
    "CommandPower",
    "RecordField",
    "RecordMeasurements",
]
