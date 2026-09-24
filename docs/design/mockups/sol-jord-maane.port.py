"""Port docs/design/mockups/sol-jord-maane-standalone_4.html -> the AIPLA artefact.

Every replacement asserts it matched exactly once, so a new upstream drop from
the author either ports cleanly or fails loudly at the line that moved.

    uv run --no-project python docs/design/mockups/sol-jord-maane.port.py .
    make sim-build        # fills the bridge block the port leaves empty

Method: .claude/skills/mcp-app-artefact/resources/porting-external-apps.md,
"Author packages".
"""

import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
SRC = ROOT / "docs/design/mockups/sol-jord-maane-standalone_4.html"
DST = ROOT / "infrastructure/mcp-sandbox/artefacts/sol-jord-maane/v1/index.html"
SRI = "sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu"

html = SRC.read_text(encoding="utf-8")


def sub(old: str, new: str, count: int = 1) -> None:
    global html
    n = html.count(old)
    if n != count:
        raise SystemExit(f"expected {count} match(es), found {n}: {old[:80]!r}")
    html = html.replace(old, new)


HEADER = """<title>Sol, Jord og Måne</title>
<!--
  Sol, Jord og Måne — 3D model of the Sun–Earth–Moon system (stx).

  Author I's sim, ported from docs/design/mockups/sol-jord-maane-standalone_4.html
  (package: docs/design/mockups/I_sim_for_AIPLA.zip, INTEGRATION.md,
  aktivitetsmodul.md). The astronomy (Meeus ch. 25/47, validated against NASA's
  2025–2028 eclipse catalogues) is the author's and is untouched. What the port
  changed, and why a later reader should not undo it:

  - three.js r128 loads SAME-ORIGIN from /vendor/three/0.128.0/three.min.js with
    an SRI hash, not from cdnjs. The sandbox serves only hash-checked files named
    in infrastructure/mcp-sandbox/vendor.json; an external CDN would leak the
    student's IP and widen the CSP. Policy: the mcp-app-artefact skill,
    resources/vendored-libraries.md.
  - Google Fonts removed; the author's own system-font fallbacks now apply.
  - The author's postMessage protocol (target aipla-sim) is replaced by the
    AIPLA guest bridge. The author's single emit() seam is kept and now feeds an
    adapter: the five deliberate acts (mission start, prediction, step done,
    answer, quiz done) plus "send my view" become LABELLED emits, and all
    exploration (views, camera, time jumps, toggles) accumulates locally and is
    flushed as one `state-change` when the student commits or sends a chat
    message. No periodic state stream.
  - Mission progress, INCLUDING THE STUDENT'S WRITTEN ANSWERS, is kept in
    sessionStorage, not localStorage: the sandbox origin is shared by every
    student on a lab computer, and localStorage would hand one student's
    answers to the next.
  - The brand mark and title are removed (the host's frame header names the sim).

  Deliberate exceptions to the visual standard / scope rules, recorded:
  - DARK THEME: this is a view of space and of the night sky; the dark canvas is
    the physics, not a style. Panels keep the author's glass styling.
  - MISSIONS + DIAGNOSTIC QUIZ STAY IN THE IFRAME: a mission reconfigures the
    simulation itself (date, view, scale, toggles) and the quiz levels map onto
    the author's construct map; both are the author's design and the tutor
    brief (catalogue tutorBlock) is written against them.
  - locale: da-only, by decision — an author-supplied sim with ~2000 lines of
    Danish UI; a strings-object extraction is a follow-up, not part of import.

  Not ported (need host-side work, see the import notes): the tutor issuing
  <sim>{command}</sim> lines, <vurdering> assessment lines, and snapshot IMAGES.
  The host CAN already drive the sim: every command in INTEGRATION.md is
  registered as the host notification `sol-jord-maane.cmd-<command>`.
-->"""

# --- head: fonts out, header comment in -----------------------------------
sub("<title>Sol, Jord og Måne</title>", HEADER)
sub('<link rel="preconnect" href="https://fonts.googleapis.com">\n', "")
sub('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n', "")
sub(
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500&display=swap">\n',
    "",
)
sub('--ui: "Instrument Sans", system-ui,', "--ui: system-ui,")
sub('--display: "Instrument Serif", Georgia,', "--display: Georgia,")
sub('--mono: "IBM Plex Mono", ui-monospace,', "--mono: ui-monospace,")

sub(".blabel.node { color: #b9a4f5; font-size: 10.5px; }", ".blabel.node { color: #b9a4f5; font-size: 11px; }")

# --- brand removed ----------------------------------------------------------
start = html.index('    <div class="brand">')
end = html.index("</div>", start) + len("</div>\n")
assert "<h1>Sol · Jord · Måne</h1>" in html[start:end]
html = html[:start] + html[end:]

# --- three.js: CDN -> same-origin vendored, SRI-pinned; bridge block before app
sub(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n',
    f'<script src="/vendor/three/0.128.0/three.min.js" integrity="{SRI}" crossorigin="anonymous"></script>\n'
    "<!-- @aipla-bridge:start -->\n<script></script>\n<!-- @aipla-bridge:end -->\n",
)

# --- storage: per-tab, never shared across students on one machine ---------
sub("localStorage.getItem(KEY)", "sessionStorage.getItem(KEY)")
sub("localStorage.setItem(KEY, JSON.stringify(P))", "sessionStorage.setItem(KEY, JSON.stringify(P))")

# --- the AIPLA seam: post()/emit() -> bridge adapter ------------------------
old_seam_start = html.index("  function post(msg) {")
old_seam_end = html.index("  function snapshot() {")
ADAPTER = r"""  // ---- AIPLA guest-bridge adapter (replaces the author's postMessage protocol).
  // Every student action already flows through emit('event', …). Deliberate acts
  // are labelled commits (trust card + tutor state); exploration is local until
  // the next commit or chat send — the commit-on-submit rule.
  var ARTEFACT_NAME = SIM_ID;
  var pendingChanges = {};
  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function compactState() {
    var s = getState();
    delete s.vis; delete s.version; delete s.sim; // toggles are in pending changes; id is the serverId
    return s;
  }
  function flushPendingChanges(triggeredBy) {
    var changed = Object.keys(pendingChanges);
    if (!changed.length) return;
    var summary = {}; changed.forEach(function (k) { summary[k] = pendingChanges[k]; });
    AIPLA_BRIDGE.emit(ARTEFACT_NAME + '.state-change', { changed: summary, state: compactState(), triggeredBy: triggeredBy });
    pendingChanges = {};
  }
  // The five deliberate acts. Verbs are chosen from the proactive vocabulary on
  // purpose: prediction/answer/quiz/view are `commit`/`record` (the tutor may
  // take a turn); mission start and a finished step are not (the student is
  // reading the task card, and the author marks them as batchable).
  var COMMITS = {
    mission_start: { verb: 'mission-start', label: function (d) { return (d.genoptaget ? 'Genoptog' : 'Startede') + ' mission ' + d.mission + ': ' + d.titel; } },
    forudsigelse: { verb: 'prediction-commit', label: function (d) { return 'Forudsigelse (' + d.mission + '): «' + clip(d.tekst, 140) + '»'; } },
    trin_faerdigt: { verb: 'checkpoint', label: function (d) { return 'Færdig med trin ' + d.trin + ' i ' + d.mission; } },
    svar: { verb: 'answer-commit', label: function (d) { return 'Svar på ' + d.mission + ': «' + clip(d.tekst, 140) + '»'; } },
    quiz_slut: { verb: 'quiz-record', label: function () { return 'Besvarede diagnosespørgsmålene'; } }
  };
  function commitDetail(action, d) {
    if (action === 'quiz_slut') {
      // levels go to the tutor (it recommends a first mission from them); never into a label
      return { runde: d.runde, svar: (d.svar || []).map(function (a) { return { item: a.item, emne: a.emne, bogstav: a.bogstav, niveau: a.niveau }; }) };
    }
    var out = {}; Object.keys(d).forEach(function (k) { out[k] = typeof d[k] === 'string' ? clip(d[k], 600) : d[k]; });
    return out;
  }
  function explorationNote(action, d) {
    if (!d) return true;
    return clip(d.begivenhed || d.skala || d.hastighed || d.retning || (d.element ? d.element + '=' + d.til : '') || d.visning || d.navn || d.tid || d.dage || '', 60) || true;
  }
  function emit(type, payload) {
    if (type !== 'event') return;
    var a = payload.action, c = COMMITS[a];
    if (a === 'mission_slut') return; // always follows `svar`, which already carries it
    if (!c) { pendingChanges[a] = explorationNote(a, payload.detail); return; }
    flushPendingChanges(a); // state precedes the action, on the wire in that order
    var d = payload.detail || {};
    AIPLA_BRIDGE.emit(ARTEFACT_NAME + '.' + c.verb, { label: c.label(d), detail: commitDetail(a, d), state: compactState() });
  }
"""
html = html[:old_seam_start] + ADAPTER + html[old_seam_end:]
sub("  var parentOrigin = qs.get('origin') || '*';\n", "")
sub("  var embedded = window.parent && window.parent !== window;\n", "")

# --- inbound: the author's message listener -> host notifications ----------
lst_start = html.index("  window.addEventListener('message', function (e) {")
lst_end = html.index("  $('#shareBtn').onclick")
HOST = """  // Host -> sim: every command in INTEGRATION.md, as `sol-jord-maane.cmd-<command>`.
  // Nothing is echoed back (the host knows what it pushed); state rides the next commit.
  ['setTime', 'addTime', 'play', 'pause', 'setSpeed', 'setView', 'setScale', 'setObserver', 'look', 'setShow',
   'jump', 'setTask', 'clearTask', 'lock', 'toast', 'startMission', 'openMissions', 'openQuiz', 'configure']
    .forEach(function (name) {
      AIPLA_BRIDGE.onHostNotification(ARTEFACT_NAME + '.cmd-' + name, function (p) { command(name, p || {}); });
    });
"""
html = html[:lst_start] + HOST + html[lst_end:]
sub(
    "  $('#shareBtn').onclick = function () { var s = snapshot(); s.kilde = 'bruger'; post(s); toast('Din visning er sendt til tutoren.', null); };",
    "  $('#shareBtn').onclick = function () {\n"
    "    flushPendingChanges('view-record');\n"
    "    var s = compactState();\n"
    "    AIPLA_BRIDGE.emit(ARTEFACT_NAME + '.view-record', { label: 'Delte sin visning: ' + clip(s.tid.dansk, 40) + (s.observatoer ? ', ' + s.observatoer.navn : ''), state: s });\n"
    "    toast('Din visning er sendt til tutoren.', null);\n"
    "  };",
)
sub('<div class="sec" id="aiplaSec" hidden>', '<div class="sec" id="aiplaSec">')
sub("      <h2>AIPLA</h2>\n", "      <h2>Tutoren</h2>\n")

# --- main loop: no periodic state stream ------------------------------------
sub(
    """    stateTimer += dt;
    if (S.connected && stateTimer > (S.playing ? 2 : 0.5)) {
      stateTimer = 0; var s = getState(), js = JSON.stringify(s);
      if (js !== lastStateJson) { lastStateJson = js; post({ type: 'state', state: s }); }
    }
""",
    "",
)
sub("var last = performance.now(), roTimer = 0, stateTimer = 0, lastStateJson = '';", "var last = performance.now(), roTimer = 0;")

# --- boot: bridge init + self-test ------------------------------------------
sub(
    "  post({ type: 'ready', version: API_VERSION, state: getState() });\n",
    """  S.connected = true;
  AIPLA_BRIDGE.init({ name: ARTEFACT_NAME, version: '1.0.0' });
  AIPLA_BRIDGE.onChatFlush(function () { flushPendingChanges('chat-submit'); });
  AIPLA_BRIDGE.emit(ARTEFACT_NAME + '.open', { state: compactState() });

  // ?test=1 — the astronomy against NASA's catalogue (the author's validation set):
  // total solar eclipse 2026-08-12 17:46 UT; new moon 2026-10-10 15:50 UT;
  // total lunar eclipse 2026-03-03.
  if (qs.get('test') === '1') {
    var e1 = Astro.solarShadow(Astro.state(Date.parse('2026-08-12T17:46:00Z'))).type;
    var el = Astro.state(Date.parse('2026-10-10T15:50:00Z')).elong, dNew = Math.min(el, 360 - el);
    var e2 = Astro.lunarShadow(Astro.state(Date.parse('2026-03-03T11:33:00Z'))).type;
    var ok = e1 === 'total' && dNew < 0.2 && e2 === 'total' && typeof THREE !== 'undefined';
    document.title = (ok ? 'TEST PASS' : 'TEST FAIL') + ' — Sol, Jord og Måne';
    if (!ok) console.error('Self-test failed', { solar: e1, newMoonElong: el, lunar: e2, three: typeof THREE });
  }
""",
)

# post() must be gone entirely
for leftover in ("post(", "parentOrigin", "'aipla-sim'", "https://"):
    hits = [ln for ln in html.splitlines() if leftover in ln and "@aipla-bridge" not in ln]
    if leftover == "post(":
        hits = [h for h in hits if "postMessage" not in h]
    if hits:
        raise SystemExit(f"leftover {leftover!r}: {hits[:3]}")

DST.write_text(html, encoding="utf-8")
print(f"wrote {DST} ({len(html.encode())} bytes)")
