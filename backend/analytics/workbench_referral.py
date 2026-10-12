"""Is this tutor turn a referral to the workbench? — the ONE answer (1.1.149 M1).

Three things need to agree on what counts as "the tutor sent the student to the
workbench":

* the runtime **nudge** (``adk.workbench_affordances``), which fires after ``K``
  tutor turns with no referral;
* the **bench** referral probe (``scripts/bench-tutor-discrimination.py``),
  which grades whether the tutor referred early and when the student was stuck;
* the **prod SQL** (``research/workbench-referral/m0.sql``), which measured the
  baseline on the 2026-10-05 seminar and re-measures after release (M6).

If each derived its own heuristic, the thing that fires the nudge and the thing
that grades it could disagree, and a "fix" could be an artefact of two
lexicons. So there is one lexicon, ``GENERIC_PATTERN``, held here and mirrored
byte-for-byte in the SQL (``test_workbench_referral.py`` asserts the two are
equal), plus the activity's own names.

**What it over- and under-counts — deliberately, and the same way everywhere.**
"graf"/"tabel" also occur in plain physics talk (over-count); a generic "try
changing the angle" that never names the sim is missed (under-count, the
doc's H3). Both are tolerated because every consumer counts the same thing; the
qualitative check is M0's Q4, not a cleverer regex here.

**Regex dialects.** BigQuery runs RE2, whose ``\\w`` and ``\\b`` are ASCII; Python's
are Unicode. For every term in the lexicon the difference only moves where a
match ENDS, not whether one exists, so presence — the only thing anyone reads —
is the same on both sides.

⚠️ Do not add a second "is this a referral" heuristic anywhere (handover rule in
the design doc). Extend the lexicon here, then mirror it into the SQL.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

#: The generic Danish/English lexicon. Mirrored verbatim in
#: ``research/workbench-referral/m0.sql`` (``DECLARE ref_re``). The M0 additions
#: (arbejdsflade, arbejdsfelt, skrivefelt, simulator, elmåler, kurve) are the
#: words the 2026-10-05 prod read found the tutor actually using.
GENERIC_PATTERN = (
    r"(?i)\b(arbejdsbord\w*|arbejdsflade\w*|arbejdsfelt\w*|workbench|simulering\w*|simulation\w*|"
    r"simulator\w*|simmen|tabel\w*|table|graf\w*|chart|diagram\w*|kurve\w*|lommeregner\w*|beregner\w*|"
    r"calculator|tjekliste\w*|checklist\w*|skriveflade\w*|skrivefelt\w*|begrebskort\w*|concept map|"
    r"mission\w*|boldkast|kinebot|planck|interferens|faseovergang\w*|elkedel\w*|elmåler\w*|bølgefart|"
    r"sekantbænk\w*|sol, jord)\b"
)

_GENERIC_RE = re.compile(GENERIC_PATTERN)

#: The tool name of a tutor ACTING on the sim (1.1.133). A turn that calls it has
#: sent the student's attention to the sim whatever its prose says.
CONTROL_SIM_TOOL = "control_sim"

#: Shorter names than this match too much ordinary prose to count ("LED", "Sol").
_MIN_NAME_LEN = 4

_DASHES = (" — ", " \u2013 ", " - ")


@dataclass(frozen=True)
class Vocabulary:
    """The activity-specific names a referral may use, beside the generic lexicon."""

    names: tuple[str, ...] = ()
    _pattern: re.Pattern[str] | None = field(default=None, compare=False, repr=False)

    @property
    def pattern(self) -> re.Pattern[str] | None:
        return self._pattern


def _compile(names: Iterable[str]) -> re.Pattern[str] | None:
    uniq = sorted({n for n in names if len(n) >= _MIN_NAME_LEN}, key=len, reverse=True)
    if not uniq:
        return None
    return re.compile(r"(?i)(?<!\w)(" + "|".join(re.escape(n) for n in uniq) + r")(?!\w)")


def make_vocabulary(names: Iterable[str]) -> Vocabulary:
    cleaned = tuple(dict.fromkeys(n.strip() for n in names if n and n.strip()))
    kept = tuple(n for n in cleaned if len(n) >= _MIN_NAME_LEN)
    return Vocabulary(names=kept, _pattern=_compile(kept))


def sim_names(display_name: str | None) -> list[str]:
    """The ways a tutor names a sim: the full ``displayName``, its head before a
    dash ("Boldkast", "LED Planck"), and its first word when that is a word on
    its own ("Elkedel", "Faseovergange") rather than "LED" or "Sol,"."""
    name = (display_name or "").strip()
    if not name:
        return []
    out = [name]
    head = name
    for dash in _DASHES:
        if dash in head:
            head = head.split(dash, 1)[0].strip()
    out.append(head)
    first = re.split(r"[\s,]+", head, maxsplit=1)[0].strip(" ,.;:")
    out.append(first)
    return [n for n in dict.fromkeys(out) if len(n) >= _MIN_NAME_LEN]


def referral_vocabulary(cfg: Any) -> Vocabulary:
    """The activity's own names: element titles and the sim's names.

    Reads the authored ``ActivityConfig`` (any object with the same fields).
    Never raises — an unreadable catalogue costs the sim's name, and the generic
    lexicon still answers.
    """
    if cfg is None:
        return Vocabulary()
    from db.models.activity_config import ELEMENT_REGISTRY

    names: list[str] = []
    for spec in ELEMENT_REGISTRY.values():
        for item in getattr(cfg, spec.field, None) or []:
            title = (getattr(item, "title", "") or "").strip()
            if title:
                names.append(title)
    artefact_id = getattr(cfg, "artefact_id", None)
    if artefact_id:
        try:
            from artefacts.loader import load_artefact

            meta = load_artefact(artefact_id)
        except Exception:  # pragma: no cover — defensive, see docstring
            meta = None
        if meta is not None:
            names.extend(sim_names(meta.display_name))
    return make_vocabulary(names)


def is_referral(
    text: str | None,
    vocabulary: Vocabulary | None = None,
    *,
    function_calls: Sequence[str] = (),
) -> bool:
    """True when a tutor turn refers the student to the workbench.

    ``function_calls`` are the names of the tools the turn called; a
    ``control_sim`` call counts on its own.
    """
    if CONTROL_SIM_TOOL in function_calls:
        return True
    body = text or ""
    if not body.strip():
        return False
    if _GENERIC_RE.search(body):
        return True
    pattern = vocabulary.pattern if vocabulary is not None else None
    return bool(pattern is not None and pattern.search(body))


# --- the probe (bench + --from-sessions) --------------------------------------------


@dataclass(frozen=True)
class ReferralProbe:
    """Per transcript: how the tutor used the workbench.

    ``first_referral_turn`` is 1-based among TUTOR turns (``None``: never).
    ``after_stuck`` is ``None`` when the transcript has no planted stuck turn.
    """

    tutor_turns: int
    referring_turns: int
    first_referral_turn: int | None
    after_stuck: bool | None

    @property
    def share(self) -> float | None:
        return self.referring_turns / self.tutor_turns if self.tutor_turns else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tutorTurns": self.tutor_turns,
            "referringTurns": self.referring_turns,
            "firstReferralTurn": self.first_referral_turn,
            "afterStuck": self.after_stuck,
            "share": self.share,
        }


#: A referral counts as answering the stuck turn when it lands within this many
#: tutor turns of it (acceptance criterion 4).
STUCK_WINDOW = 2


def referral_probe(
    turns: Iterable[dict[str, Any]],
    vocabulary: Vocabulary | None = None,
    *,
    stuck_student_turn: int | None = None,
) -> ReferralProbe:
    """Grade one transcript, deterministically — no judge call.

    ``turns`` are ``{"role": "student"|"tutor", "content": str, "calls"?: [names]}``
    in order. ``stuck_student_turn`` is 0-based among STUDENT turns, the same
    convention as the sycophancy probe's ``studentTurn``.
    """
    tutor_n = 0
    referring = 0
    first: int | None = None
    student_n = 0
    stuck_at_tutor: int | None = None  # tutor-turn count when the stuck turn was sent
    after_stuck: bool | None = None if stuck_student_turn is None else False
    for t in turns:
        role = t.get("role")
        if role == "student":
            if stuck_student_turn is not None and student_n == stuck_student_turn:
                stuck_at_tutor = tutor_n
            student_n += 1
            continue
        if role != "tutor":
            continue
        tutor_n += 1
        if is_referral(t.get("content"), vocabulary, function_calls=t.get("calls") or ()):
            referring += 1
            if first is None:
                first = tutor_n
            if stuck_at_tutor is not None and 0 < tutor_n - stuck_at_tutor <= STUCK_WINDOW:
                after_stuck = True
    return ReferralProbe(tutor_n, referring, first, after_stuck)


__all__ = [
    "CONTROL_SIM_TOOL",
    "GENERIC_PATTERN",
    "STUCK_WINDOW",
    "ReferralProbe",
    "Vocabulary",
    "is_referral",
    "make_vocabulary",
    "referral_probe",
    "referral_vocabulary",
    "sim_names",
]
