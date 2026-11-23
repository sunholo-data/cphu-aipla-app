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


@pytest.mark.asyncio
async def test_a_fragment_is_refused_before_any_check(tmp_path):
    browser = FakeBrowser(browser_result())
    lvl, reasons = await level(tmp_path, html="<script>const x = 1;</script>", browser=browser)
    assert lvl == -1 and "COMPLETE" in reasons[0]
    assert browser.calls == 0


# ── a run that did not finish (2026-11-23) ────────────────────────────────────
# The checker timed out on a li-ion battery draft that passed on the next
# identical run; the verdict said only "could not run", and the authoring model
# told the teacher the server was out of resources. The reason must now say what
# stopped, and that nothing about the sim was judged.


class StoppedBrowser(FakeBrowser):
    def __init__(self, result: dict | None, last_error: str = "") -> None:
        super().__init__(result)
        self.last_error = last_error


@pytest.mark.asyncio
async def test_a_run_that_stopped_part_way_is_not_graded(tmp_path):
    # verify_sim.mjs writes what it had before a step threw. The checks it
    # never reached are missing, so grading this would fail a working sim.
    partial = browser_result(incomplete={"step": "the click-through", "error": "Timeout 30000ms exceeded."})
    browser = StoppedBrowser(partial)
    lvl, reasons = await level(tmp_path, browser=browser)
    assert lvl == 1
    assert "could not run" in reasons[0]
    assert "stopped during the click-through" in reasons[0]
    assert "Nothing about the sim was judged" in reasons[0]


@pytest.mark.asyncio
async def test_the_reason_the_service_gave_reaches_the_verdict(tmp_path):
    why = "the browser check did not finish after 72 s (stopped during the 700px screenshot: Timeout)"
    lvl, reasons = await level(tmp_path, browser=StoppedBrowser(None, last_error=why))
    assert lvl == 1 and why in reasons[0]


@pytest.mark.asyncio
async def test_the_service_check_keeps_the_422_detail(tmp_path, monkeypatch):
    import httpx

    from sim_authoring.verify import ServiceBrowserCheck

    detail = "the browser check did not finish after 72 s (stopped during the click-through: Timeout)"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"ok": False, "error": detail})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    check = ServiceBrowserCheck("https://sim-verify.example")
    monkeypatch.setattr(check, "_token", lambda: "t")

    assert await check.check("<html></html>", "demo-sim", tmp_path) is None
    assert check.last_error == detail
