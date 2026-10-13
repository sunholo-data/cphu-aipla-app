"""The draft verdict's levels (in-app-sim-authoring M1).

A fake browser stands in for verify_sim.mjs, so these run anywhere. The rule
under test: a level is reached only when every level below it is, and a step
that could not run stops the climb.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from sim_authoring.verify import verify_draft
from tests.unit.test_sim_gates import GOOD_HTML, GOOD_YAML

GOOD_EVENTS = [
    {"kind": "demo-sim.state-change", "state": {}},
    {"kind": "demo-sim.run", "label": "Started the pendulum", "state": {}},
]


def browser_result(**over) -> dict:
    base = {
        "selfTest": "pass",
        "pageErrors": [],
        "checks": [{"ok": True, "msg": "390px: fits"}, {"ok": True, "msg": "700px: fits"}],
        "events": GOOD_EVENTS,
        "screenshots": {},
    }
    return {**base, **over}


class FakeBrowser:
    def __init__(self, result: dict | None) -> None:
        self.result = result
        self.calls = 0

    async def check(self, index_html: str, artefact_id: str, out_dir: Path) -> dict | None:
        self.calls += 1
        assert artefact_id == "demo-sim"
        return self.result


async def level(tmp_path: Path, html=GOOD_HTML, yml=GOOD_YAML, browser=None) -> tuple[int, list[str]]:
    v = await verify_draft(html, yml, browser=browser, out_dir=tmp_path)
    return v.level, v.reasons


@pytest.mark.asyncio
async def test_a_good_draft_reaches_l3(tmp_path):
    assert (await level(tmp_path, browser=FakeBrowser(browser_result())))[0] == 3


@pytest.mark.asyncio
async def test_a_missing_file_is_below_l0(tmp_path):
    lvl, reasons = await level(tmp_path, yml=None, browser=FakeBrowser(browser_result()))
    assert lvl == -1 and "catalogue YAML" in reasons[0]


@pytest.mark.asyncio
async def test_a_static_failure_stops_at_l0_without_opening_a_browser(tmp_path):
    browser = FakeBrowser(browser_result())
    lvl, reasons = await level(
        tmp_path, html=GOOD_HTML.replace("function applyLang()", 'fetch("x"); function applyLang()'), browser=browser
    )
    assert lvl == 0 and "A.no_external_fetch" in reasons[0]
    assert browser.calls == 0


@pytest.mark.asyncio
async def test_no_browser_stops_at_l1_and_says_so(tmp_path):
    lvl, reasons = await level(tmp_path, browser=None)
    assert lvl == 1 and "no browser" in reasons[0]


@pytest.mark.asyncio
async def test_a_browser_that_could_not_run_is_not_a_pass(tmp_path):
    lvl, reasons = await level(tmp_path, browser=FakeBrowser(None))
    assert lvl == 1 and "could not run" in reasons[0]


@pytest.mark.parametrize(
    "result",
    [
        browser_result(selfTest="fail"),
        browser_result(selfTest="missing"),
        browser_result(pageErrors=["ReferenceError: x"]),
        browser_result(checks=[{"ok": False, "msg": "390px: overflows by 40px"}, {"ok": True, "msg": "700px: fits"}]),
        browser_result(checks=[]),  # the viewport checks never ran
        browser_result(
            checks=[
                {"ok": True, "msg": "390px: fits"},
                {"ok": True, "msg": "700px: fits"},
                {"ok": False, "msg": 'motion: nothing moved in 1.7 s after "Start"'},
            ]
        ),
    ],
)
@pytest.mark.asyncio
async def test_anything_wrong_in_the_run_stops_at_l1(tmp_path, result):
    assert (await level(tmp_path, browser=FakeBrowser(result)))[0] == 1


@pytest.mark.parametrize(
    "events",
    [
        [],
        [{"kind": "demo-sim.run", "state": {}}],  # no label
        [{"kind": "demo-sim.state-change", "label": "Changed", "state": {}}],  # no waking verb
        [{"kind": "other.run", "label": "Started", "state": {}}],  # not namespaced
    ],
)
@pytest.mark.asyncio
async def test_events_that_do_not_reach_the_tutor_stop_at_l2(tmp_path, events):
    assert (await level(tmp_path, browser=FakeBrowser(browser_result(events=events))))[0] == 2
