# The authoring prompt

A paste-ready brief for generating a **conforming** sim in any AI chat — Claude,
ChatGPT, whatever the teacher already has open — so that what comes back drops
into the repo instead of needing a port.

## Why this exists

Sims get drafted outside the repo, in a chat with someone who knows the physics.
What comes back is usually good physics in a shape that costs an hour to
integrate: duplicated `data-da`/`data-en` spans, its own colour palette, the
task list and the constants box inside the frame, no telemetry, no self-test.
Every one of those is cheap to *ask for* up front and tedious to retrofit.

Two things the generating model cannot do, which the prompt works around:

- **It cannot write the guest bridge.** That is ~370 generated lines stamped from
  one source by `make sim-build`. The prompt has it emit the marker pair around a
  placeholder `<script>`, which the repo-side step fills. A hand-written bridge
  would be rejected by the drift check.
- **It cannot run the gates.** So the prompt ends with a self-check, and you run
  the real gates when the file lands.

## How to use it

1. Copy everything in the fenced block below into a fresh chat.
2. Replace the `<<< … >>>` briefing at the top with the actual physics.
3. Save the two files it returns to
   `infrastructure/mcp-sandbox/artefacts/<id>/v1/index.html` and
   `backend/artefacts/<id>.yaml` — or scaffold first with
   `scripts/new_sim.sh <id> "<title>"` and paste over the stubs.
4. Then, in the repo:

```bash
make sim-build                                        # stamps the real bridge
.claude/skills/mcp-app-artefact/scripts/audit_artefact.sh \
    infrastructure/mcp-sandbox/artefacts/<id>/v1
node .claude/skills/mcp-app-artefact/scripts/verify_sim.mjs <id> --drive
cd backend && uv run pytest tests/unit/test_artefact_catalogue.py -q
```

---

## The prompt

````text
You are building a physics simulation for AIPLA, a tutoring platform used in
Danish upper-secondary schools (stx). It runs in a sandboxed iframe beside an AI
tutor, in a panel about 700px wide, and students also open it on phones.

<<< BRIEF — replace this whole block.

ID: <kebab-case id, e.g. pendul>     <- REQUIRED. Every file and every event
                                        name is built from it.

Say what the student should be able to do and measure, the level (stx A/B/C),
and any constants or apparatus that matter. Name the quantity the student is
meant to DERIVE, so it can be kept off the screen. Example:

  ID: pendul
  A pendulum: the student varies length (0.2-1.5 m) and release angle (5-30
  degrees), releases it, and times swings with a stopwatch. Fysik C.
  They derive g from T = 2*pi*sqrt(L/g); g = 9.82 m/s^2 (Denmark).
  Do NOT show g, the period, or the formula — those are the derivation.
>>>

HOUSE STYLE. The colour tokens below are not enough to make this look like the
rest of the library, so match this description; it is what the existing sims do:

- Flat white panels on white, separated by a 1px #e2e8f0 border and a 6px
  radius. No shadows, no gradients, no card elevation.
- Each panel opens with a small uppercase grey heading, ~11px, letter-spaced —
  "OPSTILLING", "MÅLESERIE". The panel content is 14px.
- One filled blue primary button per panel at most; everything else is a
  bordered ghost button on white. Buttons are small: ~12px text, 6px/10px
  padding.
- Readouts are monospace, right-aligned, tabular-nums, on a #f8fafc inset with
  the unit in smaller grey text beside the number.
- Generous vertical rhythm, tight horizontal: ~10px gaps, 12px panel padding.
- Danish register is plain and instrumental — "Registrér aflæsning", "Nulstil",
  "Snorlængde". Imperative for buttons, noun for labels. No exclamation marks,
  no encouragement text, no emoji anywhere.

If you have web access you can also read a live example and copy its feel:
  https://aipla-v01-sandbox-wgwhd7mspa-lz.a.run.app/artefacts/boldkast/v1/index.html

Produce TWO files, each in its own fenced code block preceded by its filename,
with no commentary between them. After the two blocks, and only there, write the
short self-check listed at the end.

================================================================
FILE 1 — index.html
================================================================

A single self-contained HTML file. Vanilla JavaScript only.

HARD CONSTRAINTS (a violation renders a blank frame with no error):
- One file, under 200 KB, with all CSS and JS inline.
- NO external resources: no <script src="http...">, no <link href="http...">,
  no fetch(), no XMLHttpRequest, no WebSocket, no eval(), no new Function().
- NO nested <iframe>.
- NO frameworks. No React, Vue, Svelte, jQuery, D3, Chart.js.
  Use plain DOM, <canvas> and requestAnimationFrame.

--- STRUCTURE ---

<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>…</title>
<!-- A comment saying what the sim is and what it deliberately does NOT show. -->
<style>…</style>
</head>
<body>
  …markup…

<!-- @aipla-bridge:start -->
<script>/* The shared AIPLA guest bridge is stamped in here by `make sim-build`.
            Do not write it. It is absent until that step runs, so reach it
            only through the guard below. */</script>
<!-- @aipla-bridge:end -->

<script>
  "use strict";
  …your code…
</script>
</body>
</html>

Reproduce the three bridge lines EXACTLY, including both comment markers. A
build step replaces the placeholder script with the real bridge.

Until that step runs, AIPLA_BRIDGE does not exist — and the self-test below is
run on the file as you wrote it. So EVERY bridge call goes through one guard,
defined once and used everywhere (the telemetry section shows the exact form):

  const bridge = () => (typeof AIPLA_BRIDGE === "undefined" ? null : AIPLA_BRIDGE);

Unguarded, the first emit("open") throws before the self-test can run and the
sim is rejected for a reason that has nothing to do with the sim.

--- THE ONE-SIMULATION RULE ---

The iframe holds the live simulation and nothing else: the apparatus, the
controls that act on it, the instruments reading it.

DO NOT INCLUDE, even though a standalone page would have them:
- numbered task lists, "your turn", step-by-step procedures
- a constants or formula reference box
- long problem statements or framing prose
- quizzes, multiple choice, self-marking
- hints, explanations, "ask the AI" buttons, any chat UI
- a page header with a logo or product name, or a footer
- anything that would need an API key

The AI tutor sitting beside the sim does all of that. A measurement RECORD is
different and SHOULD stay: a table of readings the student has captured is part
of the instrument, because otherwise they must read six values off two dials in
one instant.

--- FIRST CONTACT ---

Stripping the lesson out leaves a student looking at apparatus with no
instructions. Handle that inside the sim, without putting the lesson back:

- ONE short line of orienting text is allowed and expected — what this apparatus
  is for, in a sentence. Not a procedure, not a task list.
- A disabled control must say what enables it ("stop the clock to record"), or
  it reads as broken.
- Every panel has a designed empty state. An empty measurement table says
  "ingen aflæsninger endnu", never nothing.
- The primary action is visually primary. A student should not have to hunt for
  where to begin.

--- LANGUAGE ---

Danish and English, from ONE object. No user-facing text inline in the markup.

  const strings = {
    da: { title: "…", start: "Start", … },
    en: { title: "…", start: "Start", … },
  };
  let lang = "da";
  let langLockedByStudent = false;
  const t = (k) => (strings[lang] || strings.da)[k];

  // Danish writes 4,74 — English writes 4.74.
  function num(v, dp) {
    const s = v.toFixed(dp);
    return lang === "da" ? s.replace(".", ",") : s;
  }

  // The self-test writes document.title too, and applyLang can run AFTER it
  // (a late hostContext, or the student clicking the toggle) — which would erase
  // TEST PASS and read as a failure. One flag settles it.
  const TEST_MODE = new URLSearchParams(location.search).get("test") === "1";

  function applyLang() {
    document.documentElement.lang = lang;
    if (!TEST_MODE) document.title = t("title");
    document.querySelectorAll("[data-t]").forEach((el) => {
      const v = t(el.dataset.t);
      if (v !== undefined) el.textContent = v;   // a missing key must not print "undefined"
    });
    // Three things applyLang has to reach, and two are easy to forget:
    render();        // canvas text — it is not in the DOM
    renderReadouts();// JS-built numbers — they carry the decimal comma
    renderTable();   // and any measurement record you keep
  }

Anything you set from JS — aria-label, a unit suffix, a table cell — is
user-facing text and belongs in `strings` too, not concatenated inline.

Markup carries keys: <button data-t="start"></button>. A node you fill from JS
is left EMPTY in the markup — no "—", no "0,0", no placeholder — because any
character you type there is user-facing text outside `strings`.

`num()` is fixed-decimal. If a quantity spans orders of magnitude (a current
from 0.003 A to 1.1 A), add a significant-figures helper beside it and apply the
same decimal-comma swap; do not let `toPrecision` exponent notation reach it.

Include a small
Dansk/English toggle (two buttons, aria-pressed) that sets langLockedByStudent
and calls applyLang(). After init, poll `bridge() && bridge().hostContext()`
every 50ms up to 2s; if it returns an object with a `locale` string and the
student has not chosen, adopt its first two letters. Treat it defensively: it
may be missing, null, or an object with no `locale`; keep polling until the
window elapses, and ignore any locale that is neither `da` nor `en`.

Danish is the default. Write Danish a Danish physics teacher would write.

--- TELEMETRY ---

  const ARTEFACT_NAME = "<the id>";
  const bridge = () => (typeof AIPLA_BRIDGE === "undefined" ? null : AIPLA_BRIDGE);
  function emit(type, extra) {
    const b = bridge();
    return b && b.emit(ARTEFACT_NAME + "." + type, extra);
  }

Emit on every pedagogically meaningful action. Each payload carries a `state`
object: the sim's full current configuration and readings, with readable keys
and units (power_W, temperature_C, length_m).

If the student builds a series of measurements, SEND IT — the tutor cannot mark
an experiment from a count. Ten rows of three numbers is a few hundred bytes.
The real limit is 4096 bytes of JSON-encoded payload, above which the push is
rejected with 413 and the tutor sees nothing, so bound the series (the last ~20
rows) rather than dropping it. If a payload would still be too large, drop the
oldest rows first — `label` and `state`'s current configuration matter more to
the tutor than an old measurement.

Event names are load-bearing. The platform reads the LAST dot-segment and only
these words trigger the tutor to speak on its own:
  a run started     -> run, play, simulate, afspil
  progress a step   -> step, next, advance, placed, calibrated
  a measurement     -> reading, measure, record, commit, show_value, fit, spectrum
Any other verb is inert. Use `open`, `stop`, `pause`, `reset`, `state-change`
for housekeeping — those are correctly inert. Note `open` is reserved for "the
sim loaded"; if your domain uses the word for something else (opening a switch,
opening a valve) pick a different verb for that action.

`label` and the verb are INDEPENDENT. The label decides whether the student sees
a card saying this reached the tutor; the verb decides whether the tutor may
speak unprompted. A labelled `stop` shows a card and starts no turn, which is
often exactly right.

Kinds ending `.pause` or `.reset` are dropped before the tutor entirely. That is
right for "put the apparatus back", and WRONG for "delete the measurements" —
the tutor would go on marking a series the student has cleared. So when the
student clears the record, do not rely on `reset`: emit a `state-change` whose
`state` carries the now-empty series, so the tutor's copy is corrected.

`label` is the important field. A payload with a non-empty `label` shows the
student a card in the chat saying what reached the tutor, AND prompts the tutor
to react. A payload without one is silent. So:
  - LABEL the deliberate commits: starting a run, capturing a reading. Write the
    label in the current language, with real numbers and units, as a receipt:
      label: "Registrerede aflæsning: 33,6 °C efter 44,0 s"
  - DO NOT label passive or continuous events: slider drags, resets, pauses.
At least one labelled emit is required.

Continuous controls must not report every movement. Accumulate locally and
report on commit:

  const pendingChanges = {};
  function flushPendingChanges(triggeredBy) {
    const changed = Object.keys(pendingChanges);
    if (!changed.length) return;
    emit("state-change", { changed, state: simState(), triggeredBy });
    changed.forEach((k) => delete pendingChanges[k]);
  }
  // slider 'input'  -> update the value, set pendingChanges.key, render. NO emit.
  // commit button   -> flushPendingChanges("run"); then emit("run", {state, label}).

At the end of your script:
  const b = bridge();
  if (b) {
    // "1.0.0" is the client version in the handshake. NOT the `version: v1` in
    // the YAML, which is the served directory. Leave both as they are.
    b.init({ name: ARTEFACT_NAME, version: "1.0.0" });
    b.onChatFlush(function () { flushPendingChanges("chat-submit"); });
  }

--- PEDAGOGY ---

The student measures; the student calculates. The sim must NOT display the
quantity the brief says they should derive.

- Keep the constant that drives the simulation in a module-level variable.
  Never render it, never put it in a payload.
- Be honest about the limit: that constant is still readable in view-source, and
  so is the formula. The gate is "not handed to you", not "hidden". Do not add
  obfuscation — a student in dev tools has stopped doing the exercise.
- Watch for the quantity leaking via arithmetic. If the student captures total
  time and a count of swings, the period is one division away — that is fine and
  is what a real experiment gives them. What must not appear is the DERIVED
  value itself, computed for them, on screen or in a payload.
- Where a value must be available but not given away, hide it behind an explicit
  "Vis" / "Show" button and emit `show_value` when it is revealed.
- Slider defaults must NOT be the values the student is asked to investigate. If
  the brief names values, start somewhere else; if it gives ranges, start
  somewhere unremarkable inside them. The point is that the student sets the
  apparatus up rather than finding it pre-calibrated.

--- VISUAL ---

Light theme. The host is white; a dark header or a black LCD readout looks broken.

  :root {
    --bg: #ffffff; --fg: #0f172a; --muted: #64748b; --border: #e2e8f0;
    --accent: #2563eb; --accent-soft: #eff6ff;
    --ok: #16a34a; --warn: #d97706; --bad: #dc2626;
    --surface: #f8fafc;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

- Body text at least 14px; labels and axis ticks at least 11px; nothing smaller.
- Single column by default; add columns only inside @media (min-width: 720px).
- No min-width property above 600px anywhere. It must fit 390px with no
  horizontal scrolling.
- Canvas: give it an explicit height in CSS — `aspect-ratio: 3 / 2` or a fixed
  `height` — then size the BACKING STORE in JS from getBoundingClientRect()
  times devicePixelRatio and redraw on resize. `width:100%; height:auto` alone
  leaves nothing to establish the height and renders a zero-height canvas, which
  looks exactly like the blank frame a CSP violation causes.
- Do not leave a large empty canvas. If the apparatus occupies a third of it,
  make the canvas shorter.
- accent-color: var(--accent) on range inputs.
- font-variant-numeric: tabular-nums on every live number, or readouts jitter.
- Instrument readouts: light background, monospace, right-aligned.

--- SELF-TEST ---

Put the physics in PURE functions that take their inputs as arguments. Then:

  if (new URLSearchParams(location.search).get("test") === "1") {
    // State the arithmetic in a comment so a reader can check it by hand.
    const got = <pure function>(<known inputs>);
    const ok = Math.abs(got - <expected>) < <tolerance>;
    document.title = (ok ? "TEST PASS" : "TEST FAIL") + " — " + strings.da.title;
    if (!ok) console.error("Self-test failed: " + got);
  }

Assert a real value you have computed by hand, not that the page loaded.

================================================================
FILE 2 — <id>.yaml
================================================================

# Teacher-facing metadata. None of it is ever rendered to a student, so name
# the physics plainly here even when the sim hides it — a teacher has to be able
# to find this in the picker.
id: <kebab-case, same as ARTEFACT_NAME and the event prefix>
version: v1
displayName: "<Danish title a teacher sees>"
description: "<one Danish sentence: what does the student DO?>"
topics: [<Danish curriculum words — how a teacher would search for this>]
levels: [<every stx level the sim SUITS, not only the one in the brief>]
language: da
eventVocabulary: [<the verbs you emitted, unprefixed>]
tutorBlock: |
  <English. Server-side only — it reaches the tutor and never the browser.
   Three parts:
   1. What the sim is and what the student can control.
   2. What each event means — what a `reading` is worth asking about.
   3. "REFERENCE, FOR CHECKING ONLY — NEVER STATE THESE VALUES:" then the
      constants the tutor needs to mark an answer and the student must not be
      handed, with a line on what to do if the student is close or far off.
   Describe what the TUTOR does. Do not tell it which language to speak.>
status: live

================================================================
BEFORE YOU ANSWER — check your own output
================================================================

1. Search your HTML for: http://, https://, fetch(, XMLHttpRequest, WebSocket,
   eval(, new Function(, <iframe. All must be absent.
2. The three bridge lines are present and exact, and you did not write a bridge.
3. Every user-facing string is in `strings`; the markup has only data-t keys.
4. At least one emit carries a `label`; passive events carry none.
5. At least one event verb is from the trigger list above.
6. No font-size below 11px; no min-width above 600px; no dark backgrounds.
7. The quantity the brief says the student should derive appears nowhere on
   screen and in no payload.
8. The self-test asserts a number you can verify by hand.
9. The two files agree on the id, and it is the id from the brief.
10. `eventVocabulary` in the YAML lists exactly the verbs you emit — no more,
    no fewer.
11. The one-simulation rule: no task list, no constants box, no quiz, no chat,
    no logo, no footer. This is the rule most often broken.
12. On first contact a student can tell what to do. No control is disabled
    without something on screen saying what enables it, and no panel is a blank
    void — an empty measurement table says "no readings yet", not nothing.
````

---

## Validation

Tested cold twice on 2026-09-14 — a fresh agent with no repo access and no web
access, given only the block above plus a brief. Both runs (a pendulum, then a
DC circuit with a non-ideal battery) produced two files that passed **every
gate**: all 11 static ones, plus self-test PASS, no page errors, no overflow at
390/700/1024px, correctly namespaced kinds, a labelled commit, and every payload
inside the 4 KB cap. Both looked like they belonged in the library.

The gates are not what improved the prompt, though — both runs passed them. The
fixes came from asking each agent what it had to guess at:

- round 1: the brief never asked for the ID; the unguarded bridge calls threw
  before the self-test could run; the canvas-height rule was circular;
  `applyLang` printed "undefined" and skipped JS-built cells; the size rule
  forbade the measurement series the tutor needs.
- round 2: the guard was **prose in one section and an unguarded snippet in
  another** — code shown beats rules stated, and the snippet won; `applyLang`
  and the self-test both wrote `document.title`, so a late language change
  silently erased TEST PASS; the house style was delegated to a URL that a
  teacher's chat cannot fetch; and clearing the measurement record emitted
  `reset`, which is dropped before the tutor, leaving it marking a dataset the
  student had deleted.

**Re-run the test after editing this prompt**, and ask the agent what it guessed
rather than whether it succeeded. A passing artefact tells you much less than
the list of decisions the prompt left to chance.

## What this cannot guarantee

The prompt gets the shape right. It cannot check that the physics is correct,
that the Danish reads well, or that a student knows what to do first. Run the
gates, then drive it for sixty seconds, then have someone who teaches the topic
look at it.

Expect to still fix: the empty state, the label wording, and whatever the
`--drive` output shows arriving in the wrong order.
