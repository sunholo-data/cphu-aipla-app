"""Sims made outside AIPLA still import (tests/fixtures/sim_imports/).

Each fixture is a real file a teacher imported. The importer unbundles it
(``sim_authoring.portable.unbundle``) and the gates check the page; if a change
to either would turn one of these away, a teacher's sim stops importing.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from sim_authoring.portable import unbundle
from sim_gates import run

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "sim_imports"
PORTABLES = sorted(FIXTURES.glob("*/portable.html"))


def test_there_are_fixtures() -> None:
    assert PORTABLES, f"no */portable.html under {FIXTURES}"


@pytest.mark.parametrize("portable", PORTABLES, ids=lambda p: p.parent.name)
def test_imported_sim_unbundles_and_passes_gates(portable: Path) -> None:
    page, catalogue = unbundle(portable.read_text(encoding="utf-8"))
    assert catalogue, "the portable file carries its catalogue entry"
    assert f"id: {portable.parent.name}" in catalogue

    report = run(page, catalogue_yaml=catalogue, tiers=("A", "B", "C"))
    failed = [f"{g.id}: {g.detail}" for g in report.failed()]
    assert not failed, "\n".join(failed)
