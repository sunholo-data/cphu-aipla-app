# Shared MCP App guest bridge — one bridge, every host (AIPLA app · ChatGPT · Claude / SEP-1865)

**Status:** **IMPLEMENTED + VERIFIED on `dev`** (2026-07-04, sprint SHARED-BRIDGE
M1–M4). **The headline check passed live in ChatGPT** (M, 2026-07-04): hitting the
commit button (Afspil) → ChatGPT **responds immediately stating what the student
did** — i.e. the `window.openai.sendFollowUpMessage` turn fires on the labelled
commit and the model reacts. This is the exact behaviour that was broken (model
blind on commit) before the sprint. Automated proof also green (sandbox bridge
vitest; frontend consumer tests unchanged; CI `sim-bridge` drift guard live).
Remaining (optional, low-risk): AIPLA-app manual no-regression (automated tests
cover it) and the M365 Copilot live check (§6.3a — same postMessage path, high
confidence, teacher-research-relevant).
**Priority:** P2 — breadth-probe track with
[external-host-mcp-apps.md](external-host-mcp-apps.md). Closes the gap that makes
ChatGPT render a *dead* widget (interacts, but the model never sees the
student's committed values) **and** removes the per-sim bridge drift that would
otherwise make every future host-compat fix an N-file hand-edit. High
demo/workshop value.
**Estimated:** ~1–1.5d (canonical bridge extraction ~0.25d · build+inline step +
CI drift-guard ~0.4d · re-inline the 3 sims + `_template` ~0.15d · scaffold/skill
update ~0.2d · verify in ChatGPT + AIPLA app ~0.25d).
**Scope:** **Artefact (View) + build tooling only.** No backend runtime change,
no server metadata change, no frontend-app change. Files:
`infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js` (new — the single source
of truth), `infrastructure/mcp-sandbox/artefacts/{boldkast,kinebot,led-planck,_template}/v1/index.html`
(re-inlined from it), `scripts/build-artefact-bridge.mjs` (new), `Makefile`
(`sim-build`), `cli/aiplatform/commands/sim.py` (`aiplatform sim build`),
`.github/workflows/ci.yml` (drift guard), `scripts/new-artefact.sh` +
`.claude/skills/mcp-app-artefact/SKILL.md` (stop hand-copying the bridge).
**Source:** 2026-07-04 workshop — M: *"they display ok, we can interact, but when
we push Afspil the AI does not see the values in ChatGPT. Works ok in the local
app. How do we get ChatGPT to see it?"* Confirmed live in ChatGPT developer mode
(Afspil pressed; model blind). Follow-up ask (same session): *"can we make a
general solution … refactor them and be used by all new mcp apps in the future
… so we always have compatibility with both ChatGPT and our local app?"* — this
doc answers that ask, not just the single sim.
**Dependencies / corrects:** direct follow-up to
[external-host-mcp-apps.md](external-host-mcp-apps.md) — it **corrects** that
doc's §*"Why ChatGPT reported 'I haven't received any updates' — and the fix"*
(see §4). Complements [unified-sim-rendering.md](unified-sim-rendering.md), which
unifies the **host-side render dispatch**; this doc unifies the **guest-side
emit bridge** — a different, still-fragmented layer (see §3.3). Supersedes the
narrower draft `chatgpt-window-openai-bridge.md` (this doc folds it in).

## 1. TL;DR

An AIPLA sim reports student actions by posting a SEP-1865
`ui/update-model-context` JSON-RPC message to `window.parent`. The **AIPLA app**
listens for that and feeds the model (session state + trust card). **ChatGPT does
not listen for it at all** — ChatGPT's OpenAI Apps SDK exposes a `window.openai`
object and ignores raw `ui/*` method names. So in ChatGPT the sim renders and the
student can interact and press Afspil, but the commit posts into a void: **the
model never sees the values.**

The single-sim fix is to *also* deliver each commit through `window.openai`
(`setWidgetState` + `sendFollowUpMessage`) when present, keeping the postMessage
path untouched. But that helper — `emit()` plus the JSON-RPC handshake — is
**inlined and drifted across four files** (three live sims + a stale template)
with **two incompatible message formats** between them. Hand-patching
`window.openai` into each would be the *fifth* variation of a helper that should
exist once. So the general solution is: **extract one canonical guest bridge,
inline it into every artefact at build time, and guard against drift in CI.** The
`window.openai` channel then lives in exactly one place and every future sim gets
both-host compatibility for free.

## 2. What was verified (2026-07-04, ChatGPT developer mode)

| Observation | Host | Result |
|---|---|---|
| `show_boldkast` renders as an interactive widget | ChatGPT | works (metadata already correct) |
| Change a parameter → **press ▶ Afspil** → ask "what did I just do?" | ChatGPT | **model does not see the committed values** |
| Same commit gesture | AIPLA app | model sees it (trust card + context) |
| A separate demo widget wired to `window.openai` (`setWidgetState` / `sendFollowUpMessage`) | ChatGPT | **model sees it** |

The Afspil confound (boldkast commits only on Afspil; ChatGPT never sends
`chat-flush`) was explicitly ruled out — Afspil **was** pressed. So this is not
the commit-gating behaviour documented in the parent doc; it is a genuine channel
gap.

**API verified against the OpenAI Apps SDK reference** (developers.openai.com/apps-sdk/reference,
2026-07-04): `window.openai.setWidgetState(state)` — "Stores a new snapshot
synchronously; call it after every meaningful UI interaction"; and
`window.openai.sendFollowUpMessage({ prompt, scrollToBottom })` — "Ask ChatGPT to
post a message authored by the component." Both exist with the exact shapes the
fix uses. Note `sendFollowUpMessage` posts a message *on behalf of the user* — a
user-visible turn (see §8).

## 3. Root cause — two problems, one fix

### 3.1 The channel gap (why ChatGPT is blind)

Two hosts, two **different** iframe bridges — and the sims only speak one:

- **AIPLA app / SEP-1865 hosts** listen for `parent.postMessage(...)` JSON-RPC:
  `ui/initialize`, `ui/update-model-context`, `ping`, etc. The AIPLA frontend
  catches `ui/update-model-context`, reads `structuredContent`, POSTs
  `/api/sessions/{id}/iframe-context`, and renders the trust card.
- **ChatGPT (OpenAI Apps SDK)** does **not** provide a postMessage JSON-RPC host
  for the `ui/*` methods. It injects a **`window.openai`** object into the iframe
  (`setWidgetState`, `sendFollowUpMessage`, `callTool`, `toolOutput`,
  `widgetState`, …). A widget that only posts `ui/update-model-context` to
  `window.parent` is calling a method ChatGPT is not listening for.

Evidence the sims are postMessage-only: `grep -c 'window.openai'
artefacts/*/v1/index.html` → **0** across all four.

### 3.2 The drift (why a per-file patch is the wrong shape)

The bridge — the `ui/initialize` handshake, the ping responder, the pending-emit
queue, and `emit()` — is **hand-inlined per artefact and has drifted into four
non-identical copies**:

| Artefact | Bridge shape | Format emitted | Notes |
|---|---|---|---|
| `boldkast` | verbose, multi-line, commented (L645–809) | SEP-1865 JSON-RPC `ui/update-model-context` | reference version; `chat-flush` handler |
| `kinebot` | minified one-liners (L160–508) | SEP-1865 JSON-RPC | `__contentText()` helper; kind-prefix `kinebot.` |
| `led-planck` | minified one-liners (L73–129) | SEP-1865 JSON-RPC | `chat-flush` handler; kind-prefix `led-planck.` |
| `_template` | **old flat `postMessage`** (L171–181) | **`{source, type, …extra}`** — **no handshake at all** | the scaffold every *new* sim is cloned from |

Two things follow:

1. **The `_template` is a different protocol.** It emits the pre-SEP-1865 flat
   `{ source, type }` shape. The current AIPLA frontend reads **only** JSON-RPC
   `ui/update-model-context` → `structuredContent`
   (`StaticArtefactFrame.tsx:227`, `useMcpAppMessages.ts:53`,
   `GenericArtefactFrame.tsx:131`); it has **no** flat-format path. So a sim
   scaffolded from `_template` today is **silently broken in the AIPLA app too**,
   not just in ChatGPT — the host simply never receives a consumable message.
2. **The tooling actively reproduces the drift.** `scripts/new-artefact.sh:45`
   clones from `_template`, and the `mcp-app-artefact` skill documents *both* the
   flat format (SKILL.md:691, 776) *and* "copy the JSON-RPC handshake (~30 LoC
   inline) from an existing sim" (SKILL.md:906). Copy-from-whichever-sim is
   exactly how four divergent copies happened. Adding a `window.openai` branch to
   each by hand makes it five.

### 3.3 Relationship to `unified-sim-rendering.md`

That doc says "the event bridge to the tutor is **already one system** — don't
re-plumb it." That is true of the **host-reading** side: one
`GenericArtefactFrame` consumes one format. This doc is about the **guest-writing**
side: each artefact still *produces* that format via its own drifted copy of the
bridge, and none of them produce the ChatGPT channel. Unifying the guest bridge is
complementary to (and does not touch) the host-side unification — the wire format
the host reads is unchanged.

## 4. Correction to `external-host-mcp-apps.md`

That doc's §*"Why ChatGPT reported 'I haven't received any updates' — and the
fix"* attributed the failure to emitting `structuredContent` **without**
`content`, and shipped a fix adding a `content` text block to
`ui/update-model-context`. **That does not fix ChatGPT**, because `content` rides
the very `ui/update-model-context` message ChatGPT never reads. The June
"verification" was **render-only**: the backend logs prove the connector called
`show_boldkast` and read the resource (`POST /mcp/ → 200`), but the sim→host
`ui/update-model-context` message goes to **ChatGPT**, never to the AIPLA backend
— so the logs could not, and did not, prove the *model* saw the interaction.
Today's test (Afspil → model blind) is the first end-to-end check of that claim,
and it fails.

Keep the `content` block: it is correct hygiene and may help SEP-1865-native
hosts (MCP Inspector / some Claude paths — **not yet retested here**). It is
simply orthogonal to ChatGPT, and it moves into the canonical bridge (§6) so all
sims carry it uniformly.

## 5. Goals

**Primary goal:** One canonical guest bridge, inlined into every MCP App artefact,
that delivers each student commit to **whichever host is present** — the AIPLA app
(SEP-1865 postMessage), ChatGPT (`window.openai`), and SEP-1865-native hosts —
with **zero per-sim divergence** and a CI guard that keeps it that way.

**Success metrics:**
- ChatGPT: for all three sims, a committed interaction (▶ Afspil / equivalent) is
  correctly reported by the model when asked "what did I just do?" (0 → 3 sims).
- Bridge implementations in the repo: **4 divergent → 1 canonical** (+ N inlined
  copies that are byte-identical to it, enforced by CI).
- Message formats emitted across artefacts: **2 (flat + JSON-RPC) → 1** (JSON-RPC;
  the flat `_template` format retired).
- New-sim onboarding: a sim scaffolded from `_template` works in **both** the AIPLA
  app and ChatGPT with **no hand-copied bridge code**.

**Non-goals:**
- No backend, server-metadata, or frontend-app change (the host-reading side is
  already unified — §3.3).
- Not a runtime shared module — the bridge is inlined at build time (§6.1 explains
  why a runtime `<script src>` is not viable under ADR-013 / host CSP).
- Not retesting Claude Desktop / Inspector rendering (tracked in the parent doc).

## 6. Design

### 6.1 Why inline-at-build, not a runtime shared module

The obvious "share it once" instinct is a runtime `<script src=".../bridge.js">`.
That is **not viable across our two serving paths**, and the check matters
(framework-native-capability rule):

- Artefacts are **self-contained single-file** `index.html`, served two ways: the
  AIPLA app injects the HTML via `document.write()` into a sandboxed iframe
  (`sandbox.js`), and ChatGPT/Claude fetch it via MCP `resources/read`
  (`sim_apps.py`, `text/html;profile=mcp-app`) into a host-owned skybridge iframe.
- **ADR-013 + the widget CSP forbid external fetches.** `sim_apps._widget_meta()`
  ships `connect_domains: []`, `resource_domains: []`, `frame_domains: []`, and
  the sandbox CSP is `self + unsafe-inline + data:`. A cross-origin
  `<script src>` to the sandbox origin would be blocked in ChatGPT's iframe and
  would add an external-code trust relationship the sandbox model is designed to
  avoid.
- So a runtime module is genuinely unavailable. The minimal mechanism that keeps
  **one source of truth** while preserving the self-contained, no-external-fetch,
  standalone-testable artefact is **build-time inlining**: author the bridge once,
  stamp it into each artefact between markers, ship the same single file.

*(Alternative considered — server-side injection in `sim_apps.load_html()` +
sandbox `serve.ts`: avoids a build step but splits the injection across two
runtimes, breaks `open index.html?test=1` standalone testing, and complicates the
200 KB-per-artefact accounting. Rejected in favour of build-time inlining, which
keeps the artefact self-contained and testable and has one implementation.)*

### 6.2 The canonical bridge

New file `infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js` — the single
source of truth. It contains, once, everything currently hand-copied per sim:

- the SEP-1865 lifecycle: `ui/initialize` request → `ui/notifications/initialized`,
  the `ping` responder, the `chat-flush` handler, `__pendingEmits` queue + flush;
- `emit(kind, extra)` building `structuredContent` (+ optional `content` text
  block for generic hosts);
- **the `window.openai` channel** (guarded);
- a tiny public surface the artefact body calls: `AIPLA_BRIDGE.emit(kind, extra)`
  and `AIPLA_BRIDGE.onChatFlush(cb)`.

Per-sim specifics that legitimately differ stay **in the artefact body** and are
wired to the bridge through a small public surface — they are data/behaviour, not
transport:

- **event vocabulary + labels** → passed *into* `AIPLA_BRIDGE.emit(kind, extra)`;
- **the lifecycle start** → the sim calls `AIPLA_BRIDGE.init({ name, version })` at
  the bottom of its script (after its own functions are defined — the current
  `rpcRequest("ui/initialize", …)` call-site);
- **incoming host→iframe notifications** → registered by the sim, because they
  dispatch to app functions: `AIPLA_BRIDGE.onChatFlush(() => flushPendingChanges("chat-submit"))`
  (boldkast, led-planck) and `AIPLA_BRIDGE.onHostNotification("kinebot.set-topic", setTopic)`
  (kinebot). The bridge owns the `ping` responder and JSON-RPC envelope parsing;
  the sim owns what each notification *does*.

This means each artefact has **one marked bridge region** (the transport
definitions, near the top) plus a few **sim-authored call-sites** in the body
(`init`, handler registrations, `emit` calls) — exactly the call-sites that exist
today, minus the ~30 LoC of copied handshake plumbing. The `__contentText`
fallback (currently duplicated in kinebot + led-planck, absent in boldkast) folds
into the shared `emit()` so every sim derives a `content` text uniformly.

### 6.3 Channel mapping (the same commit, two hosts)

The commit already carries everything needed: `structuredContent` (exact values)
and, on a real commit, `content`/`extra.label` (the curated Danish string, e.g.
`"Afspillede med v₀=15 m/s, θ=40°"`). The bridge delivers it to whichever host is
present:

| Intent | AIPLA app / SEP-1865 (postMessage) | ChatGPT (`window.openai`) |
|---|---|---|
| Commit is deliberate — surface it *now* (Afspil / chat-submit) | `ui/update-model-context` + `content` | `sendFollowUpMessage({ prompt: label })` |
| Persist exact values for later model reference | `structuredContent` | `setWidgetState(structuredContent)` |
| Passive slider settle (pre-commit) | not emitted (gated on `label`) | **not emitted** — same gate |

No host-detection branching is needed beyond `if (window.openai)`: in the AIPLA
app `window.openai` is absent (block skips); in ChatGPT the `ui/initialize`
handshake never resolves so the postMessage emits become harmless no-ops
(`__post` try/catch; nothing listens). The two channels are mutually exclusive in
every real host, and firing both would still be harmless.

### 6.3a Host coverage matrix (incl. M365 Copilot — added 2026-07-04)

Research after ship (2026-07-04, prompted by the teacher-research finding that the
sims render in **Microsoft 365 Copilot**) confirmed the "one bridge, every host"
thesis with a *third* host. Per the MS Learn *"Supported MCP Apps capabilities in
Copilot"* table, Copilot is **native SEP-1865** — it reads the same
`ui/update-model-context` postMessage our bridge already sends (that method is
exactly what Copilot's App Bridge `app.updateModelContext()` wraps).
**ChatGPT's `window.openai` is the outlier; everyone else is the postMessage
family.**

| Host | Renders sim? | Sees the student's commit via | Bridge branch that carries it |
|---|---|---|---|
| **AIPLA app** | yes | `ui/update-model-context` → `/iframe-context` + trust card | postMessage (authoritative) |
| **M365 Copilot** | yes (MCP Apps GA, 2026-04) | `ui/update-model-context` = `app.updateModelContext()` | **postMessage — already covered, no new code** |
| **Claude Desktop / Inspector** | host-dependent | `ui/update-model-context` (+ `content`) | postMessage |
| **ChatGPT** | yes | `window.openai.setWidgetState` + `sendFollowUpMessage` | `window.openai` branch |

So the sprint that shipped for ChatGPT **also made the sims Copilot-ready for
free** — no third channel. Server-side, `sim_apps.py` already emits the
`_meta` keys Copilot honours (`ui.resourceUri`, `ui.visibility`, `ui.csp`); the
`ui.domain`/`frameDomains` it doesn't support are ignored (harmless). Two Copilot
caveats for a live test, both server/deploy-side (not the bridge): Copilot renders
under `{sha256(mcp-domain)}.widget-renderer.usercontent.microsoft.com` so the MCP
server domain must be **CORS-allowlisted**, and production needs **OAuth 2.1 /
Entra SSO** (anonymous is dev-only — our `/api/mcp` is anonymous, fine for the probe).

**Possible double-signal in Copilot (verify in the live test):** Copilot also
exposes a `window.openai` compatibility shim, so on a labelled commit our bridge
*may* fire both `window.openai.sendFollowUpMessage` **and** the postMessage
`ui/update-model-context`. Both are guarded and harmless (belt-and-suspenders —
the model definitely sees the commit), but it could surface as an extra user turn.
If it does, gate the `window.openai` follow-up on the absence of a resolved
postMessage host. This is the §8 "double-signal in a hypothetical dual host" risk
made concrete — Copilot is that host.

### 6.3c Cross-referenced with the `mcp-app-deploy-test` skill (added 2026-07-08)

An independent cross-host reference (the global `mcp-app-deploy-test` skill's
`host-compliance.md` + scaffold `widget.html`) confirmed our dual-bridge +
dual-metadata design, and surfaced two additive bridge improvements now shipped
in `aipla-mcp-bridge.js`:

- **`reportSize()`** — reports content height to a `window.openai` host via
  `notifyIntrinsicHeight` (ChatGPT/Copilot default the widget frame to ~600px and
  only shrink on this). Routed through `window.openai` **only** (the AIPLA app
  owns the workspace-pane height; Claude/Inspector default frames are fine —
  sending nothing there avoids noise). Guarded; auto-fires after `init` + on a
  `ResizeObserver`. Full-bleed sims (kinebot) harmlessly report the frame height.
- **`initialState()`** — returns `window.openai.widgetState` so a sim can restore
  its UI when a host re-renders it (opt-in per sim; null in the AIPLA app).

A **third** widget→host channel it documents — the **`callTool` mutation
round-trip** (the only channel that reaches *our* server) — is the basis of a
separate design: [external-host-research-capture.md](external-host-research-capture.md).

**Also shipped (2026-07-08): the deep-link CTA.** `AIPLA_BRIDGE.showAppLink()`
injects a floating "Open the full tutor in AIPLA ↗" pill **only in an external
host** (gated on `window.openai`, which our sandbox iframe never injects → never
shows in our app). Click → `window.openai.openExternal` (native `_blank`
fallback), href = deployed app `?sim=<name>`. This is the "external hosts =
advertising, app = the product" line: discover the sim in ChatGPT/Copilot, click
through to the app for the real tutor + research capture. Auto on `init`;
per-sim `init({ appLink:false | appUrl | appLinkLabel })`.

### 6.3b The `label` audit — every sim must carry a labelled commit (added 2026-07-04)

Live-testing exposed a follow-on gap: the ChatGPT broadcast
(`sendFollowUpMessage`) fires **only** when an `emit()` carries `extra.label`.
Boldkast labels its Afspil commit, so it broadcasts. **KineBot and LED-Planck
carried zero labelled emits** (audit: Boldkast 2, KineBot 0, LED-Planck 0), so in
ChatGPT they only did the silent `setWidgetState` — the model saw the values only
on the student's *next typed turn*, never proactively. (In the AIPLA app they
still worked because `GenericArtefactFrame.cardLabel()` synthesises a card from
`structuredContent.state` when no label is present — an asymmetry the ChatGPT
branch does not replicate, and deliberately shouldn't: a blanket fallback would
fire a follow-up on every passive event and flood the thread.)

Fix: label each sim's **deliberate result moments** (KineBot `sim-run`;
LED-Planck `fit` / `spectrum` / `auto-run` / `calibrated`), leaving passive /
repeated events (slider drag, topic nav, individual readings) unlabelled. Plus a
CI floor guard — `scripts/check-artefact-broadcast.mjs` (in the `sim-bridge` job
and `make sim-build-check`) **fails any artefact that emits but never labels**,
with an `<!-- @aipla-no-broadcast: <reason> -->` opt-out for read-only artefacts.
The `_template` now models a labelled commit so scaffolded sims inherit it. This
is the same "the trust-card/broadcast goes WITH the interaction" discipline as the
workbench-element trust-card rule — enforced by CI, not memory.

**Why `sendFollowUpMessage` for the commit** (not `setWidgetState` alone):
`setWidgetState` is silent and only visible on the model's *next* turn, and relies
on the host folding widget state into context — finicky and easy to miss.
`sendFollowUpMessage` injects the commit as a turn the model answers immediately —
exactly the AIPLA-app behaviour the workshop compared against ("press Afspil → the
AI knows"). Send both: state for durable numeric reference, follow-up for
immediate awareness.

### 6.4 Reference implementation (the `emit()` core, lives once in the bridge)

```js
// aipla-mcp-bridge.js — inlined into every artefact at build time. Do NOT
// hand-edit the inlined copy; edit this file and run `make sim-build`.
function emit(kind, extra) {
  const params = {
    structuredContent: Object.assign({}, extra || {}, { kind: kind }),
  };
  // Human-readable text for generic MCP hosts (ChatGPT/Claude feed `content`
  // to the model; the AIPLA frontend reads structuredContent and ignores it).
  if (extra && typeof extra.label === "string" && extra.label) {
    params.content = [{ type: "text", text: extra.label }];
  }

  // ── ChatGPT (OpenAI Apps SDK) path ────────────────────────────────────
  // ChatGPT does NOT read ui/update-model-context; it exposes window.openai.
  // Absent in the AIPLA app and Claude Desktop → this whole block is a no-op
  // and the postMessage path below stays authoritative. Guard every call so a
  // partial/old window.openai never throws.
  var oa = (typeof window !== "undefined") ? window.openai : undefined;
  if (oa) {
    try { oa.setWidgetState && oa.setWidgetState(params.structuredContent); }
    catch (e) { /* best effort */ }
    // Inject a turn only on a real commit (has a label) — never on a passive
    // settle. Mirrors the commit-on-submit gating the postMessage path uses.
    if (params.content && oa.sendFollowUpMessage) {
      try { oa.sendFollowUpMessage({ prompt: extra.label }); }
      catch (e) { /* best effort */ }
    }
  }

  // ── SEP-1865 postMessage path (AIPLA app reads this) ─── unchanged ────
  const msg = { jsonrpc: "2.0", method: "ui/update-model-context", params: params };
  if (!__initialized) { __pendingEmits.push(msg); return; }
  __post(msg);
}
```

### 6.5 Build + inline step (drift guard)

Each artefact carries a marked region the build step owns:

```html
<!-- @aipla-bridge:start — GENERATED. Edit infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js, then `make sim-build`. -->
…inlined bridge…
<!-- @aipla-bridge:end -->
```

`scripts/build-artefact-bridge.mjs`:
- **write mode** (`make sim-build`): replace every artefact's marked region — and
  `_template`'s — with the canonical bridge. `_template` is regenerated by the same
  step, so the scaffold can never be stale again.
- **check mode** (`make sim-build -- --check`, run in CI): fail if any inlined
  region differs from the canonical source, or if any artefact `index.html` lacks
  the markers. This is the architectural guard that makes "used by all future MCP
  apps" actually hold (per SECURE BY CONSTRUCTION: enforce by CI, not discipline).

### 6.6 CLI surface

Fits the existing `sim` command group (`cli/aiplatform/commands/sim.py` already has
`scaffold`):

| Command | Does |
|---|---|
| `aiplatform sim build` | Inline the canonical bridge into all artefacts + `_template`. |
| `aiplatform sim build --check` | Verify no artefact's bridge has drifted (CI parity, exit 1 on drift). |

Plus a `make sim-build` target (root Makefile) wrapping the script, per the
Automation Principle.

### 6.7 Retire the drift sources

- `scripts/new-artefact.sh`: `_template` now carries the marked region, so a fresh
  clone already speaks JSON-RPC + `window.openai`. Add a post-scaffold
  `aiplatform sim build` (or a note) so the new file is stamped.
- `mcp-app-artefact` SKILL.md: delete the flat-format `{source,type}` guidance
  (SKILL.md:691, 776) and the "copy the ~30 LoC handshake from an existing sim"
  instruction (SKILL.md:906). Replace with: *"the bridge is generated — never
  hand-edit it; add event kinds by calling `AIPLA_BRIDGE.emit(...)` from the
  artefact body; run `make sim-build`."*

## 7. Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | No latency-path change; inlining is byte-neutral (already a single file). |
| 2 | EARNED TRUST | +1 | Fixes the "dead widget" — the ChatGPT model actually sees the student's committed values; `sendFollowUpMessage` surfaces the shared action as a visible turn (provenance of what the student did). |
| 3 | SKILLS, NOT FEATURES | 0 | Infrastructure invisible to end users. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model routing. |
| 5 | GRACEFUL DEGRADATION | +1 | Every host path guarded (window.openai absent → no-op; postMessage void → harmless; standalone → no host). One well-tested degradation path instead of four drifted ones. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Adopts two open host contracts (SEP-1865 MCP Apps bridge + OpenAI Apps SDK `window.openai`); retires the custom flat `{source,type}` format; replaces four hand-rolled copies with one protocol-compliant implementation. |
| 7 | API FIRST | +1 | One guest-bridge contract; each host (AIPLA app, ChatGPT, Claude) is a thin transport target. Parity across hosts becomes a consequence of the single bridge, not per-host code. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Uses existing sinks (postMessage → iframe-context → BigQuery; ChatGPT follow-up → normal chat logging). No new instrumentation, though it closes a ChatGPT blind spot. |
| 9 | SECURE BY CONSTRUCTION | +1 | Stays inside ADR-013 (self-contained, no external fetch, no new trust relationship — the runtime-module path was rejected precisely to avoid that); the CI drift-guard enforces the invariant by architecture, not developer discipline. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | The bridge is a thin transport shim; no business logic added to the artefact; centralising reduces per-artefact client complexity. |
| 11 | USABLE BY DESIGN | +1 | Removes a broken student-facing first-contact (interact → model blind) on a student surface; the commit is acknowledged (follow-up turn / trust card) instead of a dead end. |
| | **Net Score** | **+7** | Threshold: ≥ +4 — strong alignment, 0 conflicts. |

**Conflict Justifications:** none (no axiom scored -1).

## 8. Risks / notes

- **Host is young (2026) and drifts.** This behaviour is exactly such a drift: the
  June assumption that ChatGPT reads the SEP-1865 bridge no longer holds (if it
  ever did). Keep ChatGPT support framed as a probe and re-verify per build. The
  single-bridge design *reduces* the blast radius — a future host tweak is one file.
- **Follow-up messages are user-visible turns.** On Afspil the student sees their
  commit as a chat message ("Afspillede med …") — desirable here (it *is* a
  deliberate submit), but it differs from the AIPLA app's silent trust-card model.
  If a silent channel is later required, revisit `setWidgetState`-only + prompting
  the model to read widget state.
- **Double-signal in a hypothetical dual host.** A host that answered *both*
  `ui/update-model-context` *and* `window.openai` would see the commit twice. No
  current host does; note it if one appears.
- **Claude Desktop / Inspector not retested** with this change — the `content`
  block is retained for them; verify separately if they become a target.
- **Deploy note:** `sim_apps.SimApp.load_html()` caches artefact HTML per backend
  process, so a bridge edit reaches `/api/mcp` only after the **backend** redeploys
  (a `dev` push redeploys sandbox + backend, so it is automatic). For a
  laptop/tunnel demo, restart the local server. Optional, not required: switch the
  resource mimeType `text/html;profile=mcp-app` → `text/html+skybridge` in
  `sim_apps.py` for Apps-SDK tidiness — ChatGPT already renders with the current
  type (it keys off `openai/outputTemplate`), so this is cosmetic.

## 9. Implementation Plan

### Phase 1 — Canonical bridge + build tooling (~0.65d)
- [ ] Extract `aipla-mcp-bridge.js` from the `boldkast` bridge (the reference
      version), adding the guarded `window.openai` block (§6.4). (~120 LoC)
- [ ] `scripts/build-artefact-bridge.mjs` — write + `--check` modes, marker
      handling. (~80 LoC)
- [ ] `make sim-build` target + `aiplatform sim build [--check]` subcommand + one
      CLI unit test. (~40 LoC)

### Phase 2 — Re-inline every artefact (~0.3d)
- [ ] Add the `@aipla-bridge` markers + run `make sim-build` for `boldkast`,
      `kinebot`, `led-planck`, `_template`. Move each sim's event vocabulary /
      labels into `emit()` call-sites (they already pass `extra`).
- [ ] Confirm each re-inlined file is byte-identical under `--check`.

### Phase 3 — Guard + tooling hygiene (~0.35d)
- [ ] CI `sim-bridge-check` step (or fold into the existing gate) running
      `make sim-build -- --check`.
- [ ] Update `scripts/new-artefact.sh` (post-scaffold stamp) + `mcp-app-artefact`
      SKILL.md (remove flat-format + hand-copy guidance).

### Phase 4 — Verify (~0.25d)
- [ ] ChatGPT developer mode: all three sims, commit → model states values.
- [ ] AIPLA app: trust card + iframe-context unchanged (no-regression).

## 10. Testing Strategy

### Static / build tests
- [ ] `sim build --check` passes on a clean tree; fails when a byte is changed in
      one inlined copy (drift-guard unit test).
- [ ] `grep -c 'window.openai' artefacts/*/v1/index.html` → 1 per file (was 0);
      `grep -c 'ui/update-model-context'` → ≥1 per file including `_template`
      (was 0 for `_template`).

### Bridge behaviour (new — the real safety net)
- [ ] Sandbox vitest `infrastructure/mcp-sandbox/__tests__/aipla-mcp-bridge.test.ts`
      exercises the canonical bridge in isolation: dual-channel `emit()` (postMessage
      + `window.openai`), the `label`-gated follow-up, the no-`window.openai` no-op,
      and pending-queue flush on init. This is the *only* behavioural test of the
      guest emit code — none existed before (the per-sim `*SimFrame` components +
      their integration tests were retired by
      [unified-sim-rendering.md](unified-sim-rendering.md); sims now render through
      `GenericArtefactFrame`).

### Frontend (no-regression — host-reading side unchanged)
- [ ] `GenericArtefactFrame.test.tsx`, `StaticArtefactFrame.test.tsx`,
      `useArtefactReportEvent.test.ts`, `proactiveEventCheck.test.ts` stay green —
      the emitted JSON-RPC shape the host reads is byte-unchanged, so these must not
      need edits.

### Manual
- [ ] ChatGPT: `show_boldkast` → change param → ▶ Afspil → "what did I just do?"
      → model states committed v₀/θ. Repeat `show_kinebot`, `show_led_planck`.
- [ ] AIPLA app: same gesture → trust card renders, session context / BigQuery
      capture unchanged, no thrown errors.
- [ ] ChatGPT: drag a slider without Afspil → **no** follow-up injected (passive
      settle stays silent, gated on `label`).

## 11. Success Criteria

- [ ] **ChatGPT — the channel is live** for all three sims (commit → model sees
      the values).
- [ ] **No regression — AIPLA app**: `ui/update-model-context` still emitted,
      trust card renders, iframe-context + BigQuery unchanged.
- [ ] **No thrown errors** with `window.openai` absent (every call guarded).
- [ ] **Passive settles still silent** in ChatGPT (gated on `content`/label).
- [ ] **One canonical bridge**; `make sim-build -- --check` green in CI; all four
      artefacts byte-identical to source.
- [ ] **`_template` speaks JSON-RPC + `window.openai`** — a sim scaffolded from it
      works in both hosts with no hand-copied bridge code.
- [ ] Skill + `new-artefact.sh` no longer instruct hand-copying the bridge.

## 12. Open Questions

- Build step in **JS (`.mjs`)** vs a small **Python** script to match the CLI's
  language? Leaning `.mjs` (the sandbox is a Node/TS project); the CLI subcommand
  can shell out to it. Confirm before Phase 1.
- Should `_template`'s bridge markers ship in the repo copy, or should `sim build`
  *insert* them into a marker-less file on first run? Leaning: ship markers in
  `_template` so `new-artefact.sh` clones a stamped scaffold directly.

## 13. Related Documents

- [external-host-mcp-apps.md](external-host-mcp-apps.md) — the parent probe (sims
  as `ui://` MCP Apps); this doc corrects its §"content fix" and adds the missing
  `window.openai` channel.
- [unified-sim-rendering.md](unified-sim-rendering.md) — unifies the host-side
  render dispatch (complementary; §3.3).
- `.claude/skills/mcp-app-artefact/SKILL.md` — the artefact authoring recipe
  (updated by §6.7).
- ADR-013 (scoping site `architecture.qmd`) — the static-artefact security model
  (self-contained, sandboxed, no external fetch, 200 KB cap) this design honours.
- OpenAI Apps SDK reference — `window.openai` API (verified §2).
