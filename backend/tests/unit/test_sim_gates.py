"""The static sim gates (in-app-sim-authoring M0 · sim-verify-mcp M0).

Three kinds of test, and the middle one is the point:

1. Every live artefact passes the tiers it should, with the pre-prompt sims'
   known gaps named here with a reason, so a NEW gap fails.
2. One broken fixture per gate, which must fail exactly that gate. A gate with
   no fixture that trips it may be a regex that matches nothing, which is what
   audit_artefact.sh's gate 1 was for its whole life (invalid lookahead, error
   hidden by 2>/dev/null, counted as a pass).
3. A check that could not run never makes ``ok`` true.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import pytest

import sim_gates
from sim_gates import run
from sim_gates.proactive import PROACTIVE_TOKENS, proactive_category

REPO = Path(__file__).resolve().parents[3]
ARTEFACTS = REPO / "infrastructure" / "mcp-sandbox" / "artefacts"
CATALOGUE = REPO / "backend" / "artefacts"

GOOD_HTML = """<!doctype html>
<html lang="da"><head><meta charset="utf-8"><title></title>
<style>body { font-size: 14px; background: #fff; } .tick { font-size: 11px; }</style>
</head><body>
<p data-t="intro"></p>
<button id="go" data-t="start"></button>
<!-- @aipla-bridge:start -->
<script>/* stamped by make sim-build */</script>
<!-- @aipla-bridge:end -->
<script>
const ARTEFACT_NAME = "demo-sim";
const TEST_MODE = new URLSearchParams(location.search).get("test") === "1";
const strings = {
  da: { title: "Demo", intro: "Et pendul.", start: "Start", label: "Startede pendulet" },
  en: { title: "Demo", intro: "A pendulum.", start: "Start", label: "Started the pendulum" },
};
let lang = "da";
const t = (k) => strings[lang][k];
const bridge = () => (typeof AIPLA_BRIDGE === "undefined" ? null : AIPLA_BRIDGE);
function emit(type, extra) {
  const b = bridge();
  return b && b.emit(ARTEFACT_NAME + "." + type, extra);
}
function applyLang() { if (!TEST_MODE) document.title = t("title"); }
document.getElementById("go").onclick = () => emit("run", { state: {}, label: t("label") });
if (TEST_MODE) {
  const ok = Math.abs(2 * Math.PI * Math.sqrt(1 / 9.82) - 2.005) < 0.01;
  document.title = (ok ? "TEST PASS" : "TEST FAIL") + " — " + strings.da.title;
}
</script>
</body></html>
"""

GOOD_YAML = """id: demo-sim
displayName: Demo
eventVocabulary: [run]
tutorBlock: |
  A pendulum.
  REFERENCE, FOR CHECKING ONLY — NEVER STATE THESE VALUES: T = 2.005 s at L = 1 m.
"""


def gates(html: str = GOOD_HTML, yaml: str | None = GOOD_YAML, hidden: list[str] | None = None) -> dict:
    report = run(html, catalogue_yaml=yaml, hidden_terms=hidden)
    return {g.id: g.status for g in report.gates}


def failing(**kw) -> set[str]:
    return {gid for gid, status in gates(**kw).items() if status in ("fail", "error")}


# ---- 1. the good fixture and the live library ----------------------------------


def test_the_good_fixture_passes_every_gate():
    report = run(GOOD_HTML, catalogue_yaml=GOOD_YAML, hidden_terms=["period", "g"])
    assert report.ok, report.to_text()


def live_artefacts() -> list[str]:
    return sorted(
        p.parent.parent.name for p in ARTEFACTS.glob("*/v1/index.html") if not p.parent.parent.name.startswith("_")
    )


#: Known gaps in sims that predate the authoring prompt (or arrived from an
#: author before it). Listed so a NEW gap fails. Remove an entry when it is fixed.
_PRE_PROMPT = {"B.artefact_name", "B.strings_object", "C.id_matches", "C.vocabulary_matches", "C.reference_block"}
KNOWN_GAPS: dict[str, tuple[set[str], str]] = {
    "boldkast": (_PRE_PROMPT | {"B.trigger_verb"}, "reference implementation from v0.1; emits through its own wrapper"),
    "kinebot": (_PRE_PROMPT | {"B.self_test"}, "pre-catalogue port; quiz and graph lifted to React"),
    "led-planck": (_PRE_PROMPT | {"B.self_test"}, "pre-catalogue port"),
    "sol-jord-maane": (_PRE_PROMPT | {"B.trigger_verb"}, "author-supplied port; emits <id>.event with a sub-kind"),
    "sekant-intro": ({"C.reference_block"}, "author-supplied; its tutorBlock has no reference values yet"),
}


@pytest.mark.parametrize("name", live_artefacts())
def test_every_live_artefact_passes_tier_a(name):
    index = ARTEFACTS / name / "v1" / "index.html"
    report = run(index.read_text(), tiers=("A",))
    assert report.ok, report.to_text()


@pytest.mark.parametrize("name", live_artefacts())
def test_every_live_artefact_conforms_except_its_named_gaps(name):
    index = ARTEFACTS / name / "v1" / "index.html"
    yaml_path = CATALOGUE / f"{name}.yaml"
    report = run(index.read_text(), catalogue_yaml=yaml_path.read_text(), tiers=("A", "B", "C"))
    bad = {g.id for g in report.gates if g.status in ("fail", "error", "skipped")}
    expected = KNOWN_GAPS.get(name, (set(), ""))[0]
    assert bad == expected, (
        f"{name}: new gaps {sorted(bad - expected)}, fixed (remove from KNOWN_GAPS) {sorted(expected - bad)}"
    )


# ---- 2. one fixture per gate ----------------------------------------------------


def _sub(old: str, new: str, text: str = GOOD_HTML) -> str:
    assert old in text, old
    return text.replace(old, new, 1)


BRIDGE_PLACEHOLDER = "<script>/* stamped by make sim-build */</script>"
HAND_BRIDGE = "<script>var AIPLA_BRIDGE = {" + " emit: function () {}, " * 60 + "};</script>"

BROKEN: dict[str, str] = {
    "A.no_external_fetch": _sub("function applyLang()", 'fetch("/api/x"); function applyLang()'),
    "A.no_external_script": _sub("</head>", '<script src="https://cdn.example.com/x.js"></script></head>'),
    "A.no_external_css": _sub("</head>", '<link rel="stylesheet" href="https://fonts.example.com/a.css"></head>'),
    "A.light_theme": _sub("background: #fff;", "background: #000000;"),
    "A.no_iframe": _sub("<p data-t", '<iframe src="about:blank"></iframe><p data-t'),
    "A.no_dynamic_code": _sub("function applyLang()", 'eval("1"); function applyLang()'),
    "A.min_width": _sub("body { font-size: 14px;", "body { min-width: 900px; font-size: 14px;"),
    "A.min_font": _sub(".tick { font-size: 11px; }", ".tick { font-size: 10px; }"),
    "A.vendor_scripts": _sub("</head>", '<script src="/vendor/nothing/1.0/x.js"></script></head>'),
    "B.bridge_body": _sub(BRIDGE_PLACEHOLDER, HAND_BRIDGE),
    "B.bridge_guard": _sub("const b = bridge();\n  return b && b.emit", "return AIPLA_BRIDGE.emit"),
    "B.artefact_name": _sub('const ARTEFACT_NAME = "demo-sim";', 'const NAME = "demo-sim";').replace(
        "ARTEFACT_NAME +", "NAME +"
    ),
    "B.strings_object": _sub('label: "Started the pendulum" ', 'label: "Started the pendulum", extra: "x" '),
    "B.labelled_emit": _sub('{ state: {}, label: t("label") }', "{ state: {} }"),
    "B.trigger_verb": _sub('emit("run"', 'emit("go"'),
    "B.self_test": _sub('(ok ? "TEST PASS" : "TEST FAIL")', '(ok ? "fine" : "broken")'),
}
BROKEN_YAML: dict[str, str] = {
    "C.yaml_validates": "id: Not A Valid Id\n",
    "C.id_matches": GOOD_YAML.replace("id: demo-sim", "id: other-sim"),
    "C.vocabulary_matches": GOOD_YAML.replace("[run]", "[run, reading]"),
    "C.reference_block": GOOD_YAML.replace("REFERENCE, FOR CHECKING ONLY", "Values"),
}
# The two gates with no single-gate fixture, and why:
#   A.size           — tested on its own below (a 200 KB page also trips nothing else)
#   A.bridge_present — removing the markers also skips B.bridge_body, by design


#: Faults that honestly trip a second gate too. Declared, so "exactly" stays exact.
CO_FAILS: dict[str, set[str]] = {
    "A.no_external_script": {"A.no_external_fetch", "A.vendor_scripts"},  # a CDN script is a URL and not vendored
    "A.no_external_css": {"A.no_external_fetch"},  # a stylesheet URL is a URL
    "B.artefact_name": {"C.id_matches"},  # no ARTEFACT_NAME, so nothing to match the YAML id
    "B.trigger_verb": {"C.vocabulary_matches"},  # the renamed verb is no longer the declared one
}


@pytest.mark.parametrize("gate_id", sorted(BROKEN))
def test_each_broken_page_fails_exactly_its_gate(gate_id):
    assert failing(html=BROKEN[gate_id]) == {gate_id} | CO_FAILS.get(gate_id, set())


@pytest.mark.parametrize("gate_id", sorted(BROKEN_YAML))
def test_each_broken_yaml_fails_exactly_its_gate(gate_id):
    assert failing(yaml=BROKEN_YAML[gate_id]) == {gate_id}


def test_a_hidden_term_on_screen_fails_tier_d():
    html = _sub('label: "Started the pendulum"', 'label: "Started the pendulum", g: "g = 9.82 m/s²"')
    html = html.replace('start: "Start", label: "Startede', 'start: "Start", g: "g = 9,82", label: "Startede')
    assert failing(html=html, hidden=["9.82"]) == {"D.hidden_terms"}


def test_removing_the_bridge_markers_fails_presence_and_skips_the_body_check():
    html = _sub("<!-- @aipla-bridge:start -->", "").replace("<!-- @aipla-bridge:end -->", "")
    statuses = gates(html=html)
    assert statuses["A.bridge_present"] == "fail"
    assert statuses["B.bridge_body"] == "skipped"


def test_a_page_over_200kb_fails_size_only():
    html = _sub("</body>", "<!--" + "x" * 210_000 + "--></body>")
    assert failing(html=html) == {"A.size"}


def test_gate_one_regression_a_bare_fetch_is_caught():
    """audit_artefact.sh passed this for its whole life."""
    report = run(_sub("function applyLang()", 'fetch("x"); function applyLang()'), tiers=("A",))
    assert not report.ok


def test_xml_namespaces_and_the_stamped_bridge_are_not_fetches():
    html = _sub("<p data-t", '<svg xmlns="http://www.w3.org/2000/svg"></svg><p data-t')
    html = _sub(BRIDGE_PLACEHOLDER, '<script>var APP_URL = "https://example.run.app";</script>', html)
    assert gates(html=html)["A.no_external_fetch"] == "pass"


# ---- 3. unchecked is never ok --------------------------------------------------


def test_without_the_yaml_tier_c_is_skipped_and_the_report_is_not_ok():
    report = run(GOOD_HTML)
    assert {g.status for g in report.gates if g.tier == "C"} == {"skipped"}
    assert not report.ok


def test_a_gate_that_throws_is_an_error_not_a_pass(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("bang")

    monkeypatch.setattr(sim_gates.conformance, "check", boom)
    report = run(GOOD_HTML, catalogue_yaml=GOOD_YAML, hidden_terms=["x"])
    assert any(g.id == "B.tier" and g.status == "error" for g in report.gates)
    assert not report.ok


def test_an_oversize_input_is_refused_unread():
    report = run("x" * (sim_gates.MAX_INPUT_BYTES + 1))
    assert [g.id for g in report.gates] == ["A.size"]
    assert not report.ok


def test_a_hostile_200kb_input_finishes_quickly():
    hostile = "emit(" + "(" * 50_000 + "font-size:" * 5_000 + '"' * 20_000 + "{" * 20_000
    start = time.perf_counter()
    run(hostile[:200_000], catalogue_yaml=GOOD_YAML, hidden_terms=["g"])
    assert time.perf_counter() - start < 2.0


# ---- the proactive vocabulary: one copy here, two elsewhere, all equal -----------


def _js_lists(path: Path, names: dict[str, str]) -> dict[str, set[str]]:
    text = path.read_text()
    out = {}
    for category, pattern in names.items():
        m = re.search(pattern, text, re.S)
        assert m, f"{category} not found in {path.name}"
        out[category] = set(re.findall(r'"([^"]+)"', m.group(1)))
    return out


def test_the_frontend_gate_uses_the_same_tokens():
    ts = REPO / "frontend" / "src" / "lib" / "proactiveEventCheck.ts"
    found = _js_lists(
        ts,
        {
            "sim_run": r"SIM_RUN_TOKENS\s*=\s*\[(.*?)\]",
            "step_advance": r"STEP_ADVANCE_TOKENS\s*=\s*\[(.*?)\]",
            "measurement_commit": r"MEASUREMENT_COMMIT_TOKENS\s*=\s*\[(.*?)\]",
            "completion": r"COMPLETION_TOKENS\s*=\s*\[(.*?)\]",
        },
    )
    assert found == {k: set(v) for k, v in PROACTIVE_TOKENS.items()}


def test_verify_sim_uses_the_same_tokens():
    mjs = REPO / ".claude" / "skills" / "mcp-app-artefact" / "scripts" / "verify_sim.mjs"
    found = _js_lists(mjs, {k: rf"{k}:\s*\[(.*?)\]" for k in PROACTIVE_TOKENS})
    assert found == {k: set(v) for k, v in PROACTIVE_TOKENS.items()}


@pytest.mark.parametrize(
    ("kind", "category"),
    [
        ("otto-engine.reading", "measurement_commit"),
        ("kinebot.sim-run", "sim_run"),
        ("led-planck.component-placed", "step_advance"),
        ("x.mission_complete", "completion"),
        ("x.quiz-submitted", "completion"),
        ("x.state-change", None),
        ("x.reset", None),
    ],
)
def test_proactive_category(kind, category):
    assert proactive_category(kind) == category
