---
title: "Build a simulation with an AI chat"
description: "How physics staff draft a new AIPLA simulation in Claude, ChatGPT or any AI chat, using the authoring prompt — no coding required."
eyebrow: "For physics staff"
owner: "AIPLA project team"
reviewed: "2026-09-14"
reviewBy: "2026-12-14"
status: "Current"
order: "44"
nav: "false"
---
# Build a simulation with an AI chat

This page is for the person who knows the physics, not the person who writes the code. You do not need to be able to build a simulation to get one into AIPLA — you need to be able to say precisely what it should let a student *do*. Drafting it in an AI chat is the intended route, and the prompt at the bottom of this page makes the draft land in the right shape.

## What a simulation is here

A simulation in AIPLA is a small interactive bench that opens beside the tutor in the student's workspace. The student changes something, watches what happens, and records readings. The tutor sees those readings and can ask about them. [Boldkast](/project/activities/boldkast) is a worked example.

Seven are live today:

| Simulation | The student's job |
|---|---|
| Boldkast | Launch a projectile, find the angle for maximum range |
| LED Planck | Measure LED threshold voltages, fit Planck's constant |
| KineBot | Read motion graphs |
| Elkedel | Heat water, measure energy in and temperature out, find the efficiency |
| Faseovergange | Heat ice to steam, read the plateaus off the heating curve |
| Bølgefart | Set *f* and *λ*, work out the wave speed |
| Interferens | Add two waves, find constructive, destructive and beats |

Note the shape they share. **The simulation never shows the answer.** The kettle reports energy and temperature and never the efficiency; the wave bench reports *f*, *λ* and *T* and never the speed. That withholding is the exercise, and it is the single most useful thing you can specify when you propose one.

## The one question worth getting right

> **What does the student measure, and what do they work out from it?**

If you can answer that in one sentence, the rest follows. If the answer is "they watch it", it is a diagram rather than a simulation, and a picture in the activity will serve better.

Two things follow from your answer:

- **The readings the bench must show.** These are instrument faces — a thermometer, a stopwatch, a frequency readout. Showing them is fine.
- **The value that must stay hidden.** The thing being calculated. It never appears on screen, and it goes into a private note for the tutor instead, so the tutor can mark an answer without handing it over.

## What belongs in the simulation, and what does not

The bench holds the live experiment: the thing being simulated, the controls that act on it, the instruments reading it, and a small table of the readings the student has captured.

Everything else is better placed elsewhere, and placing it elsewhere makes it *more* useful, not less:

| If your draft has | Where it actually goes |
|---|---|
| A numbered task list, "your turn" steps | the tutor, which can adapt them to the student |
| Constants, a formula sheet | the tutor, on request |
| A long problem statement | the activity's goal, which the teacher writes |
| A quiz, a multiple-choice check | an activity element |
| Its own chat box or "ask AI" button | deleted — AIPLA supplies the tutor |
| Its own title bar and logo | deleted — the app draws that |

The bench is about 700 px wide on a laptop and 390 px on a phone, so this is not tidiness. Anything that is not the experiment is crowding the experiment out.

## How to draft one

1. Open a fresh chat in whichever AI you already use — Claude, ChatGPT, Gemini, Copilot. Any of them will do.
2. Give it the authoring prompt. Either press **Copy** on the block below and paste it in, or — if your chat can read web pages — paste this link instead: `https://aipla.ku.dk/sim-authoring-prompt.txt`
3. Replace the `<<< BRIEF … >>>` block at the top with your experiment. A good brief says:
   - **The physics.** The relationship the student should come away with.
   - **What they control**, with ranges and units.
   - **What the instruments read.**
   - **What must stay hidden**, explicitly.
   - **What "done" looks like** — the capture or commit action.
4. Save the two files it returns and open the first one in a browser. Try it. You are the physics reviewer; nobody downstream can catch a wrong model, and the automated checks certainly cannot.
5. Send both files to the project team.

The prompt tells the AI the size limit, the "no external resources" rule, the light-on-white visual standard and the event vocabulary the tutor listens for, so what comes back can be dropped in with little rework rather than rebuilt. It was tested cold on 2026-09-14 — a fresh AI given only the prompt and a brief produced simulations that passed every automated gate on the first attempt.

## What happens to your draft

Your two files then go through a documented path that does the following, none of which is your problem:

- splits anything that turned out to be two experiments into two benches;
- strips any task list that crept in into the tutor's private brief;
- wires the capture button so the tutor actually receives the readings and the student sees a "shared with the AI" card;
- runs the security, size, layout and phone-width gates;
- drives it in a real browser and captures the events;
- writes the tutor's private note, including your reference values.

Then it is in the library and any teacher can attach it to an activity.

## Two things we will ask you

**Sign off the physics.** A pedagogically loaded simulation is approved by a physics reviewer before it ships, and nothing automated checks this. When a draft comes back to you, the question is whether the model is right and whether the Danish reads like physics teaching.

This is not a formality. A wave draft in September 2026 gave two waves in the same medium a shared frequency and independent wavelengths, which makes them travel at different speeds — impossible in one medium — and the "beats" it produced were a drawing artefact rather than physics. It was caught during integration, not by any gate. A physicist reading it would have caught it sooner.

**Tell us the reference values.** The constants a tutor needs in order to mark an answer — the real efficiency, the latent heats, the medium's speed. They go in the tutor's private brief, which the student's browser never receives, under an instruction never to state them outright.

## What a simulation cannot do

Worth knowing before you design around it:

- **It does not remember.** A student returning tomorrow gets their chat history but the bench reopens at its defaults. Readings that must persist belong in an activity table, not in the bench.
- **It cannot reach the internet.** No live data, no external images, no lookups. Everything ships inside the one file.
- **It does not know who the student is.**
- **A constant inside it is readable by a determined student** who opens the page source. The guarantee is "not handed to you", not "cryptographically hidden". Anything that must genuinely be secret needs a different approach — say so and it will be built differently.

## The authoring prompt

Copy all of it. Replace only the `<<< BRIEF … >>>` block.

<!-- sim-prompt:start -->
```text
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
  https://aipla-sandbox.ku.dk/artefacts/boldkast/v1/index.html

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
```
<!-- sim-prompt:end -->

The same text as a plain file, for an AI that can fetch a URL: [sim-authoring-prompt.txt](/sim-authoring-prompt.txt)
