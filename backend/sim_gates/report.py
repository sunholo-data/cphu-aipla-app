"""The verdict shapes: one ``Gate`` per check, one ``VerifyReport`` per run.

A check that could not run is never a pass. ``skipped`` (nothing to read, e.g. no
catalogue YAML) and ``error`` (the gate itself threw) both keep ``ok`` false, so
a caller can never be told a draft is fine because part of it went unchecked —
CLAUDE.md's "a checker answers when it could not read its subject".
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

Status = Literal["pass", "fail", "warning", "skipped", "error"]

NOT_CHECKED = [
    "whether the physics is right",
    "whether the Danish reads like a physics teacher wrote it",
    "whether a student can tell what to do first",
    "anything that needs the sim to RUN: the self-test verdict, overflow at 390px, "
    "what the events actually carry (verify_sim.mjs --drive, or the sim-verify service)",
]


@dataclass
class Gate:
    id: str
    status: Status
    detail: str = ""
    fix: str = ""

    @property
    def tier(self) -> str:
        return self.id.split(".", 1)[0]


@dataclass
class VerifyReport:
    gates: list[Gate] = field(default_factory=list)
    not_checked: list[str] = field(default_factory=lambda: list(NOT_CHECKED))

    @property
    def ok(self) -> bool:
        return bool(self.gates) and all(g.status in ("pass", "warning") for g in self.gates)

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for g in self.gates:
            out[g.status] = out.get(g.status, 0) + 1
        return out

    @property
    def summary(self) -> str:
        c = self.counts()
        order = ("fail", "error", "warning", "skipped", "pass")
        return ", ".join(f"{c[s]} {'failed' if s == 'fail' else s}" for s in order if c.get(s))

    def failed(self) -> list[Gate]:
        return [g for g in self.gates if g.status in ("fail", "error", "skipped")]

    def to_dict(self) -> dict:
        nxt = (
            "All checks that ran passed. The items in not_checked are still open."
            if self.ok
            else "Fix what failed and verify again."
        )
        return {
            "ok": self.ok,
            "summary": self.summary,
            "gates": [{**asdict(g), "tier": g.tier} for g in self.gates],
            "not_checked": self.not_checked,
            "next": nxt,
        }

    def to_text(self) -> str:
        mark = {"pass": "OK  ", "fail": "FAIL", "warning": "WARN", "skipped": "SKIP", "error": "ERR "}
        lines = []
        for g in self.gates:
            lines.append(f"  {mark[g.status]} {g.id}" + (f" — {g.detail}" if g.detail and g.status != "pass" else ""))
            if g.fix and g.status in ("fail", "error", "warning"):
                lines.append(f"       fix: {g.fix}")
        lines.append("")
        lines.append(("All gates that ran passed" if self.ok else "Not ok") + f": {self.summary}.")
        return "\n".join(lines)
