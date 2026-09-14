# Anatomy of a sim artefact

The single HTML file at `infrastructure/mcp-sandbox/artefacts/<id>/v1/index.html`.
Verified against the live artefacts and the bridge on 2026-09-14.

## Hard constraints

The sandbox serves artefacts with `default-src 'none'` and the host mounts them
`sandbox="allow-scripts"` on a separate origin. A violation is a **blank frame
with no error message**, so these are not style preferences:

- One self-contained file, **≤ 200 KB** including inline CSS and JS.
- **No external resources**: no `<script src="http…">`, no `<link href="http…">`,
  no `fetch()`, `XMLHttpRequest`, `WebSocket`, `eval()`, `new Function()`.
- **No nested `<iframe>`** — `frame-src 'none'`.
- **No frameworks.** React/Vue/Svelte blow the size cap several times over.
  Vanilla JS, `requestAnimationFrame`, `<canvas>`.
- Same-origin `fetch("./data.json")` **is** allowed and is how a sim ships a
  static data bank (KineBot's quiz questions).

`scripts/audit_artefact.sh` checks all of these.

## Skeleton

```html
<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>…</title>
<!-- A comment block saying what the sim is, what it deliberately does NOT
     show, and any decision a later reader would otherwise undo. -->
<style> /* tokens + layout — see visual-standard.md */ </style>
</head>
<body>
  …markup, with user-facing text carried by data-t="key" attributes…

<!-- @aipla-bridge:start (GENERATED …) -->
<script> …canonical guest bridge… </script>
<!-- @aipla-bridge:end -->

<script>
  "use strict";
  const ARTEFACT_NAME = "<id>";
  function emit(type, extra) { return AIPLA_BRIDGE.emit(ARTEFACT_NAME + "." + type, extra); }

  const strings = { da: {…}, en: {…} };
  …state, physics, render, wiring…

  AIPLA_BRIDGE.init({ name: ARTEFACT_NAME, version: "1.0.0" });
  AIPLA_BRIDGE.onChatFlush(function () { flushPendingChanges("chat-submit"); });

  if (new URLSearchParams(location.search).get("test") === "1") { …self-test… }
</script>
</body>
</html>
```

**Never hand-edit anything between the `@aipla-bridge` markers.** It is stamped
from `infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js` by `make sim-build`,
and `make sim-build-check` fails CI on drift. To change the transport, edit the
source and re-stamp every artefact.

## The guest bridge API

Everything the sim may call. One transport speaks both the AIPLA app (SEP-1865
postMessage through the sandbox proxy) and ChatGPT (`window.openai`), so a sim
written against this works in both with no extra code.

| Call | Does |
|---|---|
| `AIPLA_BRIDGE.init({name, version})` | runs the `ui/initialize` handshake, flushes queued emits. Also accepts `appUrl` / `appLinkLabel` / `appLink: false` for the external-host deep-link pill. Returns nothing |
| `AIPLA_BRIDGE.emit(kind, extra)` | one `ui/update-model-context`; queues until init resolves |
| `AIPLA_BRIDGE.onChatFlush(cb)` | host is about to send a student message — commit pending state now |
| `AIPLA_BRIDGE.onHostNotification(method, cb)` | react to a host push, e.g. `"<id>.set-topic"` |
| `AIPLA_BRIDGE.hostContext()` | `{theme, displayMode, locale}` or `null`. **Arrives asynchronously and there is no ready callback** — poll briefly |
| `AIPLA_BRIDGE.initialState()` | prior widget state under an external host, else `null` |
| `AIPLA_BRIDGE.reportSize()` | tells an external host our height. Called automatically; only needed after a large manual layout change |

Standalone (opened from disk, no proxy parent) the handshake rejects, the bridge
flips to initialised and emits become no-ops — so a sim still runs for local
iteration.

## Language — one `strings` object

Required by `content-localisation.md` M4 rule 5. No user-facing text inline in
markup.

```js
const strings = {
  da: { title: "…", start: "Start opvarmning", … },
  en: { title: "…", start: "Start heating",   … },
};
let lang = "da";
let langLockedByStudent = false;

const t = (key) => (strings[lang] || strings.da)[key];

// Danish writes 4,74 — English writes 4.74. Formatting is part of the locale.
function num(v, dp) {
  const s = v.toFixed(dp);
  return lang === "da" ? s.replace(".", ",") : s;
}

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t("title");
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  …re-render anything that draws text (canvas axis labels!)…
}
```

Take the initial language from the host, keep a manual toggle as an explicit
override (rule 3 forbids *inferring* from the browser, not an explicit choice):

```js
AIPLA_BRIDGE.init({ name: ARTEFACT_NAME, version: "1.0.0" });
(function adoptHostLocale() {
  let tries = 0;
  const timer = setInterval(() => {
    const ctx = AIPLA_BRIDGE.hostContext();
    if (ctx && typeof ctx.locale === "string") {
      clearInterval(timer);
      const hostLang = ctx.locale.slice(0, 2).toLowerCase();
      if (!langLockedByStudent && strings[hostLang] && hostLang !== lang) { lang = hostLang; applyLang(); }
    } else if (++tries > 40) clearInterval(timer);
  }, 50);
})();
```

⚠️ **The host does not send a locale yet** — `GenericArtefactFrame` passes no
`hostContext`. Write the code anyway; it starts working when M1 of the
localisation milestone lands, and the sim is correct in the meantime.

An English-only sim is allowed as a recorded **decision**:
`// locale: en-only, by decision <ref>` (KineBot is the precedent).

## Emitting — see also `event-vocabulary.md`

```js
// Deliberate action → labelled → trust card + proactive turn.
emit("run", { state: simState(), label: `Tændte kedlen: ${power} W` });

// Housekeeping → unlabelled, and `.reset`/`.pause` never reach the tutor anyway.
emit("reset", { state: simState() });
```

Keep one `simState()` function that returns the whole snapshot, and call it
everywhere. Two hand-built payloads drift.

## Commit-on-submit

**Slider exploration is thinking out loud; it does not belong in the record.**
Continuous controls accumulate locally and reach the host only when the student
commits — by pressing a commit-class button, or when they send a chat message.

```js
const pendingChanges = {};

function flushPendingChanges(triggeredBy) {
  const changed = Object.keys(pendingChanges);
  if (!changed.length) return;                       // no-op when nothing pending
  emit("state-change", { changed, state: simState(), triggeredBy });
  changed.forEach((k) => delete pendingChanges[k]);
}

slider.addEventListener("input", (e) => {
  power = Number(e.target.value);
  pendingChanges.power_W = power;                    // local only — no emit
  render();
});

startBtn.addEventListener("click", () => {
  flushPendingChanges("run");                        // state precedes the action
  emit("run", { state: simState(), label: … });      // on the wire, in that order
});

AIPLA_BRIDGE.onChatFlush(() => flushPendingChanges("chat-submit"));
```

Acceptance: drag without committing → **zero** messages. Drag then commit →
**exactly one** `state-change`, before the commit event. Discrete actions
(capture, mark, reveal) are already commitments and fire immediately.

## Host → artefact pushes

When something outside the iframe needs to change what the sim shows:

```js
AIPLA_BRIDGE.onHostNotification("<id>.set-topic", (p) => { topic = p.topic; render(); });
```

Naming: `<id>.set-<noun>` for state, `<id>.cmd-<verb>` for an action with no
persistent state. `ui/notifications/chat-flush` is the one generic method (no
prefix). **Do not echo a pushed value back** — the host already knows it.

## The self-test

`?test=1` must flip the title to `TEST PASS …` or `TEST FAIL …`. Make it a real
assertion on the sim's own physics — a value you can compute by hand — not a
smoke test that the page loaded.

```js
if (new URLSearchParams(location.search).get("test") === "1") {
  // 2000 W for 60 s into 1,0 kg through the kettle's real efficiency:
  //   0.86 · 2000 · 60 / (4180 · 1.0) = 24.689 K
  const got = usefulDeltaT(2000, 60, 1.0);
  const ok = Math.abs(got - 24.689) < 0.01;
  document.title = (ok ? "TEST PASS" : "TEST FAIL") + " — " + strings.da.title;
  if (!ok) console.error("Self-test failed: " + got);
}
```

This works because the physics lives in **pure functions** taking their inputs
as arguments. Write them that way; it is the only part of a sim that can be
tested without a browser.

## Keeping the answer out

A sim whose job is "measure, then calculate" must not display the thing being
calculated. The pattern:

- the constant that drives the simulation stays a module-level constant and is
  **never** put in a payload or rendered;
- the value a tutor needs in order to mark an answer goes in the catalogue's
  `tutorBlock`, which `ArtefactMeta.public()` strips from everything the browser
  receives;
- where a value must be *available but not given away*, gate it behind an
  explicit reveal (Boldkast's per-marker "Vis" buttons) and emit `show_value` so
  the tutor knows it was revealed.

Honest limit: a constant in this file is readable in view-source. The gate is
"not handed to you", not "cryptographically hidden". Anything that must actually
be secret needs the dynamic-MCP-server path.

Related: **slider defaults must not match the problem's values.** Starting the
sim already calibrated to the question removes the step where the student reads
the question.
