"""The tutor acts on the simulation — commands as a tool call (1.1.133 M1/M2).

The tutor could read every sim and drive none of them. An author-supplied sim
(``sol-jord-maane``) proposed the tutor write ``<sim>{"command": …}</sim>`` lines
inside its reply for the host to strip. That fails four ways here — it streams
half-written before the closing tag exists, nothing validates it, it is invisible
to the stream filter / chat log / trust cards, and it is a second wire format —
so the decision is carried by the transport that already exists for "the agent
did something with arguments": **a tool call**.

    control_sim(command, args)            ← this module, schema-checked
      → AG-UI TOOL_CALL_* / RESULT         ← existing transport
      → MessageBubble → SimCommandCard     ← the student SEES every change
      → simCommandBus → GenericArtefactFrame.sendNotification("<id>.cmd-<command>")
      → the sim's onHostNotification       ← existing bridge
      → its new state reaches the tutor on the next commit / chat flush

**Fire-and-forget.** The tool returns at once with the rendered card text; it
does not wait for the sim. The tutor learns what the command did from the sim's
state on its next turn (in-turn results are the M4 spike).

**Built per session, only when it applies.** No tool unless the activity hosts
a sim that declares ``commands`` AND the tutor's ``sim_control`` level admits at
least one of them. So an activity without a commanding sim builds exactly the
tool list it built before this existed — the passthrough guarantee.

**Gated by schema, not by prompt.** The tool's declaration enumerates only the
commands the tutor's level admits; a ``view`` tutor's schema has no ``lock`` in
it at all, so the model never sees it. The call is re-checked server-side
anyway, because a declaration is a hint to the model and not a guarantee.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Literal

from google.adk.tools import FunctionTool, ToolContext
from google.genai import types

from artefacts.arg_schema import describe_args, validate_args
from db.models.artefact import ArtefactCommand, ArtefactMeta

logger = logging.getLogger(__name__)

#: How much a tutor may do to the sim (M2). Cumulative, in this order.
SimControlLevel = Literal["none", "view", "scaffold", "restrict"]
_RANK: dict[str, int] = {"none": 0, "view": 1, "scaffold": 2, "restrict": 3}

#: Decision 2026-10-01 (the design's proposal): a tutor whose approach declares
#: nothing may change what is SHOWN, and nothing more. Text on the student's
#: screen (``scaffold``) and removing an ability (``restrict``) are each an
#: explicit decision in the framework file.
DEFAULT_SIM_CONTROL: SimControlLevel = "view"

#: At most this many control calls per tutor turn. A tutor that "tries things"
#: in a loop is a sim flickering under the student's cursor.
MAX_CALLS_PER_TURN = 3

TOOL_NAME = "control_sim"


def admitted_commands(meta: ArtefactMeta | None, level: str) -> list[ArtefactCommand]:
    """The commands a tutor at ``level`` may issue on ``meta`` — empty when none."""
    if meta is None or not meta.commands:
        return []
    rank = _RANK.get(level, _RANK[DEFAULT_SIM_CONTROL])
    return [c for c in meta.commands if _RANK[c.power] <= rank]


def resolve_sim_control_level(framework_id: str | None) -> SimControlLevel:
    """The tutor's ``sim_control`` level, from its teaching approach (M2).

    A tutor's pedagogy lives in its framework (1.1.91), and how much a tutor may
    steer the sim depends on the approach: a POE tutor locks time until a
    prediction is in, a free-exploration tutor never would. So the level is a
    field of the framework, and a tutor with no framework — every base tutor, by
    design — gets ``DEFAULT_SIM_CONTROL``.

    Never raises: this sits on the agent build path (Axiom 5). An unreadable
    framework falls back to the default, which is the least-powered level that
    still does anything.
    """
    if not framework_id:
        return DEFAULT_SIM_CONTROL
    try:
        from db.framework_overrides import effective_framework

        fw = effective_framework(framework_id)
    except Exception as exc:  # pragma: no cover — defensive, see docstring
        logger.warning("sim_control: framework %s unreadable (%s) — using %s", framework_id, exc, DEFAULT_SIM_CONTROL)
        return DEFAULT_SIM_CONTROL
    level = getattr(fw, "sim_control", None) if fw is not None else None
    return level or DEFAULT_SIM_CONTROL


def _describe(meta: ArtefactMeta, commands: list[ArtefactCommand]) -> str:
    lines = [
        f'Change what the student\'s simulation "{meta.display_name}" shows. The student sees a card in the chat '
        "naming every change you make, so say in your reply what you changed and why, and use it to direct their "
        "attention, not to do the investigating for them. It does not return the sim's new state: that reaches you "
        "with the student's next message. At most "
        f"{MAX_CALLS_PER_TURN} calls per turn.",
        "Commands (pass the arguments as `args`):",
    ]
    for c in commands:
        lines.append(f"- {c.name}: {c.description} Args: {describe_args(c.args)}.")
    return "\n".join(lines)


_GENAI_TYPES = {
    "object": types.Type.OBJECT,
    "array": types.Type.ARRAY,
    "string": types.Type.STRING,
    "number": types.Type.NUMBER,
    "integer": types.Type.INTEGER,
    "boolean": types.Type.BOOLEAN,
}


def _to_genai(schema: dict) -> types.Schema:
    """One catalogue property schema as a Gemini ``Schema``.

    Gemini enums are strings only, so a numeric enum keeps its type and loses
    the enum (the server-side check still enforces it, and the description
    lists the values). A property with only ``enum`` is a string enum.
    """
    typ = schema.get("type") or "string"
    out = types.Schema(type=_GENAI_TYPES[typ])
    if "enum" in schema and typ == "string":
        out.enum = [str(v) for v in schema["enum"]]
    if typ == "array" and "items" in schema:
        out.items = _to_genai(schema["items"])
    if schema.get("description"):
        out.description = schema["description"]
    return out


def _args_schema(commands: list[ArtefactCommand]) -> types.Schema:
    """The ``args`` parameter: the union of every admitted command's arguments,
    all optional (which ones apply depends on ``command``; the server checks).

    Built explicitly rather than from ``args: dict`` because Gemini refuses an
    OBJECT parameter with no properties — and a typed union is more useful to
    the model anyway. Where two commands use one name with different shapes
    (``id`` is a view on ``setView`` and a mission on ``startMission``), the
    property degrades to the common type with the enums merged.
    """
    merged: dict[str, dict] = {}
    for c in commands:
        for name, sub in (c.args.get("properties") or {}).items():
            prev = merged.get(name)
            if prev is None:
                merged[name] = dict(sub)
                continue
            same_type = (prev.get("type") or "string") == (sub.get("type") or "string")
            if same_type and "enum" in prev and "enum" in sub:
                prev["enum"] = list(dict.fromkeys([*prev["enum"], *sub["enum"]]))
            elif same_type:
                prev.pop("enum", None)
            else:
                merged[name] = {"type": "string"}
            prev.pop("description", None)
    if not merged:  # every admitted command takes no arguments
        merged = {"_": {"type": "string", "description": "unused"}}
    return types.Schema(
        type=types.Type.OBJECT,
        description="The command's arguments — see each command's Args in the tool description.",
        properties={name: _to_genai(sub) for name, sub in merged.items()},
    )


class _SimControlTool(FunctionTool):
    """A FunctionTool whose declaration is generated from the catalogue.

    The function signature says ``command: str, args: dict``; the declaration
    narrows ``command`` to an enum of exactly the admitted names, types ``args``
    from their schemas, and carries each command's signature in the
    description — so the model sees one sim's commands, typed.
    """

    def __init__(self, func: Any, *, description: str, commands: list[ArtefactCommand]) -> None:
        super().__init__(func)
        self._sim_description = description
        self._sim_commands = commands

    def _get_declaration(self) -> types.FunctionDeclaration | None:
        decl = super()._get_declaration()
        if decl is None:  # pragma: no cover — FunctionTool always declares
            return None
        decl.description = self._sim_description
        decl.parameters = types.Schema(
            type=types.Type.OBJECT,
            properties={
                "command": types.Schema(
                    type=types.Type.STRING,
                    enum=[c.name for c in self._sim_commands],
                    description="Which command to send.",
                ),
                "args": _args_schema(self._sim_commands),
            },
            required=["command"],
        )
        return decl


def build_sim_control_tools(
    cfg: Any,
    user: Any,
    *,
    level: str = DEFAULT_SIM_CONTROL,
    skill_id: str = "",
    teaching: Any = None,
) -> list[FunctionTool]:
    """The session's ``control_sim`` tool — an empty list when it does not apply.

    Empty when: no activity, no attached artefact, an artefact with no
    ``commands``, or a tutor level that admits none of them (``none``).
    """
    artefact_id = getattr(cfg, "artefact_id", None) if cfg is not None else None
    if not artefact_id:
        return []
    from artefacts.loader import load_artefact

    meta = load_artefact(artefact_id)
    commands = admitted_commands(meta, level)
    if meta is None or not commands:
        return []

    by_name = {c.name: c for c in commands}
    declared = {c.name for c in meta.commands}
    calls_per_turn: dict[str, int] = defaultdict(int)
    group_id = getattr(user, "group_id", None)
    activity_id = getattr(cfg, "activity_id", None)
    class_id = getattr(cfg, "class_id", None)

    def control_sim(command: str, args: dict | None = None, tool_context: ToolContext = None) -> dict[str, Any]:
        """Change what the student's simulation shows (description generated from the catalogue)."""
        args = args or {}
        cmd = by_name.get(command)
        if cmd is None:
            # Two different refusals, because they need different corrections:
            # a command this tutor's approach may not use, and one that does not
            # exist. Neither reaches the browser.
            if command in declared:
                return {
                    "ok": False,
                    "error": f"{command!r} is not available to you in this activity; allowed: {sorted(by_name)}",
                }
            return {"ok": False, "error": f"unknown command {command!r}; allowed: {sorted(by_name)}"}

        errors = validate_args(cmd.args, args)
        if errors:
            return {"ok": False, "error": "invalid args: " + "; ".join(errors[:5])}

        turn_key = getattr(tool_context, "invocation_id", None) or "_"
        if calls_per_turn[turn_key] >= MAX_CALLS_PER_TURN:
            return {
                "ok": False,
                "error": f"at most {MAX_CALLS_PER_TURN} simulation changes per turn — "
                "let the student look at what you have changed first",
            }
        calls_per_turn[turn_key] += 1

        effect = cmd.render_effect(args)
        _log_command(
            tool_context,
            group_id=group_id,
            skill_id=skill_id,
            artefact_id=meta.id,
            command=cmd,
            args=args,
            effect=effect,
            activity_id=activity_id,
            class_id=class_id,
            teaching=teaching,
            level=level,
        )
        logger.info("sim_control: %s.%s args=%s group=%s", meta.id, cmd.name, args, group_id)
        # Everything the client needs to route the command and draw the card.
        # Card-safe by construction: the sim's id, the command, the validated
        # args, the catalogue's own effect text. Never the tutorBlock.
        return {
            "ok": True,
            "artefactId": meta.id,
            "command": cmd.name,
            "args": args,
            "effect": effect,
            "power": cmd.power,
        }

    tool = _SimControlTool(
        control_sim,
        description=_describe(meta, commands),
        commands=commands,
    )
    return [tool]


def _log_command(
    tool_context: Any,
    *,
    group_id: str | None,
    skill_id: str,
    artefact_id: str,
    command: ArtefactCommand,
    args: dict,
    effect: str,
    activity_id: str | None,
    class_id: str | None,
    teaching: Any,
    level: str,
) -> None:
    """One chat-log row per command (research: which tutor moved the sim, when,
    to what). Rides the workbench-event table — the one that already records
    "something acted on the workbench", with the sim id as ``server``. Teaching
    is stamped at emit time for the TUTOR-5 reason: a class's tutor changes, so
    a later join would attribute this to whatever teaches today. Never raises."""
    if not group_id:
        return  # a teacher's preview: no group to record against
    try:
        from observability.chat_log import emit_workbench_event

        session = getattr(tool_context, "session", None)
        emit_workbench_event(
            group_id=group_id,
            session_id=getattr(session, "id", "") or "",
            skill_id=skill_id,
            server=artefact_id,
            tool=TOOL_NAME,
            field=command.name,
            value={
                "args": args,
                "power": command.power,
                "level": level,
                "tutorId": getattr(teaching, "tutor_id", None),
                "tutorVersion": getattr(teaching, "tutor_version", None),
                "frameworkId": getattr(teaching, "framework_id", None),
                "toolCallId": getattr(tool_context, "function_call_id", None),
            },
            activity_id=activity_id,
            class_id=class_id,
            label=effect,
        )
    except Exception as exc:  # telemetry must never break the turn
        logger.warning("sim_control: chat-log emit failed (suppressed): %s", exc)


__all__ = [
    "DEFAULT_SIM_CONTROL",
    "MAX_CALLS_PER_TURN",
    "TOOL_NAME",
    "SimControlLevel",
    "admitted_commands",
    "build_sim_control_tools",
    "resolve_sim_control_level",
]
