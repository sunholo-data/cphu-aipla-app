"""The static sim gates: one implementation for every caller.

    from sim_gates import run
    report = run(index_html, catalogue_yaml=yaml_text, hidden_terms=["eta"])
    report.ok, report.to_dict()

Callers: ``audit_artefact.sh`` (via ``python -m sim_gates``), the sim benchmark
(``research/sim-bench/``), the in-app authoring agent's ``verify_sim`` tool and
the sim-verify service. Design: ``docs/design/aipla/v2.1.0-extension/sim-verify-mcp.md``
(the tiers) and ``in-app-sim-authoring.md`` (M0).

Tiers: A safe and well-formed (the blank-frame class) · B what the authoring
prompt asks for · C the page and its YAML agree · D the derived quantity stays
hidden. Static only: nothing here runs the page. What needs a browser (self-test
verdict, overflow, the events' contents, screenshots) is ``verify_sim.mjs`` and
the sim-verify service, and ``report.not_checked`` says so.

The input is never executed, stored or logged.
"""

from __future__ import annotations

from pathlib import Path

from . import conformance, crossfile, leak, static
from ._text import strip_bridge
from .report import Gate, VerifyReport

__all__ = ["MAX_INPUT_BYTES", "TIERS", "Gate", "VerifyReport", "run"]

TIERS = ("A", "B", "C", "D")
#: Refuse anything larger before a single regex runs. The 200 KB gate is the
#: artefact rule; this is the parser's.
MAX_INPUT_BYTES = 256 * 1024
REPO_ROOT = Path(__file__).resolve().parents[2]


def run(
    index_html: str,
    *,
    catalogue_yaml: str | None = None,
    hidden_terms: list[str] | None = None,
    tiers: tuple[str, ...] = TIERS,
    total_bytes: int | None = None,
    vendor_manifest: Path | None = None,
    canonical_bridge: str | None = None,
) -> VerifyReport:
    """Run the requested tiers over one sim page.

    Args:
        index_html: The page.
        catalogue_yaml: Its catalogue entry, for tier C. Without it tier C is skipped (and ``ok`` false).
        hidden_terms: What the student derives and must not see, for tier D.
        tiers: Which tiers to run.
        total_bytes: Size of the whole artefact directory, when there is one; defaults to the page's size.
        vendor_manifest: ``vendor.json``; defaults to the repo copy when it exists.
        canonical_bridge: The bridge source; defaults to the repo copy when it exists.

    Returns:
        The report. ``ok`` is true only when every gate that is not a warning passed.
    """
    size = len(index_html.encode())
    if size > MAX_INPUT_BYTES:
        return VerifyReport(
            [Gate("A.size", "fail", f"{size / 1024:.0f} KB; refused unread above {MAX_INPUT_BYTES // 1024} KB")]
        )
    app = strip_bridge(index_html)
    if vendor_manifest is None:
        vendor_manifest = REPO_ROOT / "infrastructure" / "mcp-sandbox" / "vendor.json"
    if canonical_bridge is None:
        canonical_bridge = conformance.load_canonical_bridge(REPO_ROOT)

    report = VerifyReport()
    for tier, fn in (
        ("A", lambda: static.check(index_html, app, total_bytes or size, vendor_manifest)),
        ("B", lambda: conformance.check(index_html, app, canonical_bridge)),
        ("C", lambda: crossfile.check(app, catalogue_yaml)),
        ("D", lambda: leak.check(app, hidden_terms)),
    ):
        if tier not in tiers:
            continue
        try:
            report.gates.extend(fn())
        except Exception as exc:  # a gate that throws is an error, never a pass
            report.gates.append(Gate(f"{tier}.tier", "error", f"{type(exc).__name__}: {exc}"))
    if "D" in tiers:
        report.not_checked.append(leak.NOT_SEEN)
    return report
