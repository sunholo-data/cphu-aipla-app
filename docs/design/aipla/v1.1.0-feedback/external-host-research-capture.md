# External-host research capture — the `callTool` mutation round-trip (get ChatGPT/Copilot sim interactions into the AIPLA pipeline)

**Status:** **DEFERRED / backlog** — decision 2026-07-08 (M): *external-host capture is **not currently scoped**; the `callTool` round-trip is a new channel we may want to use, so this is **captured for a future discussion**, not scheduled.* Confirms this doc's own §11 open question ("AIPLA app for research, external hosts for dissemination" is the line — for now). No code to be written until that discussion reopens it. **Likely direction when it does — §0:** external hosts as an *advertising/discovery* surface with a deep-link CTA into the deployed app for full teaching+support (which sidesteps the identity/consent problem). (Prior status: PROPOSED design exploration.)
**Priority:** P2 — research-enabling, not pilot-blocking. Parked. Unblocks a question asked repeatedly once the sims started rendering in ChatGPT/Copilot.
**Estimated:** ~1.5–2d for the *mechanism* (bridge channel + `record_interaction` tool + logging); the *identity/consent* half is an ADR, not an estimate.
**Scope:** Backend (MCP server tool + logging) + Artefact (bridge channel + per-sim call-sites). No AIPLA-app frontend change.
**Dependencies:** [shared-mcp-app-bridge.md](shared-mcp-app-bridge.md) (the dual-channel bridge this extends); [external-host-mcp-apps.md](external-host-mcp-apps.md) (1.1.49 — the `/api/mcp` endpoint + `ui://` sims); the `mcp-app-deploy-test` global skill's `host-compliance.md` (documents the `callTool` / `callServerTool` round-trip). ADR-001 (anonymous-group auth) — the crux of the hard half.
**Source:** 2026-07-04–07 thread — once the sims rendered + broadcast in ChatGPT (1.1.54), the recurring question was *"does ChatGPT also record chat/interactions, and how do we get that into research?"* The answer surfaced from the deploy-test skill: the two channels we ship (`setWidgetState` / `sendFollowUpMessage`) are one-way *notify* to the host's model and **never touch our server**; a widget-initiated **`callTool`** is the only channel that routes back through our MCP server — i.e. the only one we can observe.

## 0. Product framing (M, 2026-07-08) — the likely direction for the future discussion

> External hosts could be **"advertising" our sims** — a discovery / storefront
> surface where a student or teacher (already in ChatGPT / Copilot / Teams) meets
> a physics sim, plays with it, and gets a taste. **For full teaching + support
> — our tutor (ADK agent, persona, Danish Socratic prompt, thinking budget),
> research capture, engagement signals, teacher analytics — we link out to the
> deployed AIPLA app.**

This reframes the channel and **largely dissolves the §7 identity/consent
problem**: the external host is low-commitment discovery (the host's model gives a
taste), and the moment a student wants the *real* experience they click through to
the app — where join-code auth (ADR-001), the consent gate (1.1.3), and the full
research pipeline **already exist**. So we don't need to solve
attribution-inside-ChatGPT; we need a good **"Open the full tutor in AIPLA →"
call-to-action**.

**Two distinct uses of the channel fall out — very different cost/consent:**

| Use | Mechanism | Consent/identity | Value |
|---|---|---|---|
| **Deep-link conversion** (discovery → app) | a "Continue in AIPLA" affordance in the sim → `window.openai.openExternal({href})` / `setOpenInAppUrl({href})` (ChatGPT/Copilot; plain link elsewhere), href = deep-link to the deployed app (optionally sim-preselected / join flow) | **none needed** — it's just a link; real auth/consent happen in the app | **high, low-cost** — turns dissemination into engagement |
| **Anonymous reach telemetry** | the `callServerTool` round-trip (§6) firing an *aggregate* "sim opened / CTA clicked in external host" event — no per-student id | **none** (aggregate, no PII) | marketing/reach signal ("how many met the sim in ChatGPT") |
| Per-student research capture (the rest of this doc) | `record_interaction` + identity binding | **ADR (hard)** | deferred — only if a study needs in-host behaviour |

So when this reopens, the **first** thing to build is probably the deep-link CTA
(cheap, no consent, directly serves "advertising → app"), with per-student research
capture staying the gated, maybe-never tail. The rest of this doc (the
`callTool` mechanism, §6) is the substrate both uses share.

## 1. Problem

When a sim runs in an **external host** (ChatGPT, M365 Copilot), the student's
in-sim interactions ride `window.openai` (or `ui/*` postMessage) to **that host's
model**. They **never reach AIPLA**. Our `/api/mcp` backend sees only the
protocol-level `tools/call` (`show_<name>` — "the sim was opened") and
`resources/read` (the HTML fetch). So from a ChatGPT session we get:

- **no** session record, transcript, engagement signal, BigQuery row, or trust card;
- **no** visibility into *what* the student did in the sim (parameters, commits);
- and the "tutor" is the host's model (GPT), **not** our ADK agent / persona.

**Current state:** external-host = **demo / dissemination** surface only. All
research capture requires the student to use the **AIPLA app**, where our own
frontend is the MCP host and persists the bridge events
(`iframe-context` → session → BigQuery) + the chat (AG-UI → session → BigQuery).
That is the correct default — but it means a ChatGPT/Copilot pilot cohort
produces **zero research data**, which limits where the sims can be studied.

**Impact:** affects the research team (JB/AR/M) if any study wants to observe
students using the sims in a host we don't control. Not a pilot blocker (the
pilot uses the AIPLA app), but a ceiling on the breadth-probe value of "the sims
are portable."

## 2. The mechanism that makes it possible

There are **three** widget→host channels; only the third is server-observable:

| Channel | Widget call | Reaches AIPLA's server? |
|---|---|---|
| Silent state | `setWidgetState` / `ui/update-model-context` | ❌ host-only (model context) |
| Surface a turn | `sendFollowUpMessage` / `ui/message` | ❌ host-only (a chat turn) |
| **Mutation round-trip** | **`window.openai.callTool(name,args)`** / `app.callServerTool({name,arguments})` | ✅ **the host invokes the tool on OUR MCP server** |

So a widget that calls a **`record_interaction` action tool** on our `/api/mcp`
server produces a real `tools/call` we receive, validate, and log — the same
data contract as the AIPLA app's `iframe-context`, arriving via a different
transport. This is the deterministic round-trip the deploy-test skill's scaffold
demonstrates with its `increment-counter` tool.

## 3. Goals

**Primary goal:** A student's *committed* sim interactions in ChatGPT/Copilot are
captured into AIPLA's research pipeline (BigQuery), attributably and with
consent, via a widget-initiated `record_interaction` tool — without regressing
the AIPLA-app path or the demo-surface framing.

**Success metrics:**
- A committed action (Fit / Afspil / Run) in ChatGPT produces one logged
  research row in AIPLA (0 → 1 today).
- Zero change to AIPLA-app capture (the `iframe-context` path is untouched).
- Every external-host capture carries an explicit consent flag + a
  non-reversible cohort identifier (no raw PII).

**Non-goals:**
- Capturing the host's **chat transcript** (that's OpenAI's/Microsoft's data in
  the user's account — out of reach and out of scope).
- Making the external-host **tutor** be our agent (it's the host's model; a
  separate, larger question).
- Production OAuth for the `/api/mcp` endpoint (tracked separately; today it's
  anonymous/dev).

## 4. Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Fire-and-forget log; not on a render path. |
| 2 | EARNED TRUST | +1 | Makes external-host interactions *visible + attributable* for research instead of an unobservable void; explicit consent flag on every row. |
| 3 | SKILLS, NOT FEATURES | 0 | Infrastructure. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model routing (zero-LLM logging tool). |
| 5 | GRACEFUL DEGRADATION | +1 | The `callTool` channel is feature-detected + guarded (no bridge → clean no-op); capture failure never breaks the sim. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses the standard MCP `tools/call` + MCP Apps `openai/widgetAccessible` / `app.callServerTool` — no custom side-channel. |
| 7 | API FIRST | +1 | One `record_interaction` tool on the same `/api/mcp` surface; each host is a transport. |
| 8 | OBSERVABLE BY DEFAULT | +1 | The whole point — closes a research-observability blind spot, data lands inside our GCP project (BigQuery). |
| 9 | SECURE BY CONSTRUCTION | -1 | **Introduces a new data-ingestion path from an untrusted host + an identity/attribution requirement for anonymous-group students.** Justified below; this is the doc's hard problem. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Logic/validation in the backend tool; the widget just calls it. |
| 11 | USABLE BY DESIGN | 0 | No new student-facing surface (a consent gate is reused, see §6). |
| | **Net Score** | **+5** | Threshold ≥ +4 — acceptable, proceed with attention to the §9 conflict. |

**Conflict Justifications:**
- **#9 (-1):** the data arrives from a host we don't control, and attributing it
  to an anonymous-group student (ADR-001: `email=""`, synthetic uid, no Firebase
  identity) has no existing mechanism in an external host — there is no AIPLA
  session/group context inside ChatGPT. This is acceptable to *design* but not to
  *ship* without an explicit identity + consent decision (§6, §9). Deny-by-default:
  with no verified identity + consent, the tool logs **nothing** (or anonymous
  aggregate only). The endpoint stays dev/anonymous until that decision + OAuth.

## 5. Standards / framework-native check

- **MCP `tools/call`** + **MCP Apps `_meta["openai/widgetAccessible"]: true`** (ChatGPT) / `app.callServerTool` (SEP-1865/Copilot) — adopted, not reinvented. Verified against the `mcp-app-deploy-test` skill's `host-compliance.md` (`callTool` ↔ `app.callServerTool` mapping; `widgetAccessible` required on the server for ChatGPT; Copilot ignores it but supports `callServerTool`).
- **Framework-native check:** is there already a server-observable widget→server path? Yes — and this *is* it (`callTool`). The `setWidgetState`/`sendFollowUpMessage` notifies are deliberately host-only by spec, so a "side-channel to reach our server" would be reinventing what `tools/call` already is. No custom plumbing.
- **Result shape** varies by host — read `result.structuredContent` defensively (the skill flags this).

## 6. Design (mechanism — the easy half)

### 6.1 Bridge channel (artefact side)
Add a guarded `AIPLA_BRIDGE.callServerTool(name, args)` to
`aipla-mcp-bridge.js` (the deploy-test scaffold is the reference):
`window.openai.callTool` → `window.openai.mcp.callTool` → injected
`app.callServerTool` → clean no-op. Sims call it on a **committed** action, in
addition to `emit()` (which stays for model-context + trust card):
```js
AIPLA_BRIDGE.callServerTool("record_interaction", {
  sim: "led-planck", kind: "fit", value: { u0: 1.99, led: "red" }, label: "…",
});
```
In the AIPLA app (no `window.openai`, no injected MCP-Apps client) this is a
no-op — the app already captures via `iframe-context`, so **no double-logging**.

### 6.2 Backend tool (`/api/mcp`)
A `record_interaction` tool in `mcp_server.py` with
`_meta["openai/widgetAccessible"]: true` + `_meta.ui.visibility`. It validates
the payload, enforces consent + identity (§9), and writes one row to the
research sink (reuse the `iframe-context` → BigQuery schema so external-host and
in-app rows are queryable together, tagged `source: "external-host"`).

### 6.3 CLI + observability
`aiplatform mcp probe record_interaction …` to smoke it through the tunnel;
the row shows in the existing chat-logs pipeline tagged by source.

## 7. The hard half — identity & consent (why this is gated)

1. **Attribution.** In ChatGPT there is no AIPLA group/session. Options, each an
   ADR-level trade-off: (a) the sim shows a one-time "join code" field that binds
   the widget to a group (reuses ADR-001 anon-group), logged with `callTool`; (b)
   a signed launch token minted when the sim is opened from an AIPLA link; (c)
   **anonymous aggregate only** — no per-student attribution, cohort counts only.
   Recommendation: start at (c), offer (a) opt-in.
2. **Consent (GDPR).** The AIPLA app has a consent gate (1.1.3); an external host
   does not. Capture must be **opt-in inside the widget** with the same wording,
   and log nothing without it.
3. **The tutor isn't ours.** Even captured, the *tutoring* in ChatGPT is GPT, not
   our agent/persona — so external-host research data is different in kind
   (student-sim interaction, not our-tutor dialogue). Researchers must read it as
   such; document the caveat on the row.
4. **Endpoint exposure.** `/api/mcp` is anonymous/dev. Real capture on test/prod
   needs OAuth 2.1 / Entra SSO (Copilot) + the ADR-001 exposure decision.

## 8. Implementation Plan

- **Phase 0 — decision (blocking):** JB/M on identity model (§7.1) + consent
  wording (§7.2). Until then, mechanism only, logging **disabled**.
- **Phase 1 — mechanism (~1d):** `AIPLA_BRIDGE.callServerTool` + bridge vitest;
  `record_interaction` tool (anonymous-aggregate mode) + backend test; wire one
  sim (LED-Planck `fit`) as the reference; smoke via the cloudflared tunnel
  (`mcp-app-deploy-test` skill).
- **Phase 2 — attribution (~0.5–1d, gated on Phase 0):** opt-in join-code binding
  + consent gate in the widget; per-student rows.
- **Phase 3 — rollout:** the other sims' commit call-sites; source-tagged
  researcher view.

## 9. Security Considerations

- **Ingestion boundary:** data flows *into* our GCP project (BigQuery) — the
  trusted side (axiom 8/9), so no egress concern. The concern is **inbound
  authenticity + attribution**: validate/clamp the payload (untrusted host),
  rate-limit, and **deny-by-default** (no consent/identity → no row).
- **No PII:** cohort identifiers only; never a raw name/email from the host.
- **Endpoint:** anonymous only in dev; capture on shared envs waits for OAuth +
  the ADR-001 exposure sign-off.

## 10. Success Criteria

- [ ] `AIPLA_BRIDGE.callServerTool` guarded + feature-detected; no-op in the
      AIPLA app (no double-log) — bridge vitest.
- [ ] `record_interaction` tool live on `/api/mcp` with `openai/widgetAccessible`;
      a `callTool` from a tunnelled ChatGPT widget produces one logged row.
- [ ] Deny-by-default verified: no consent/identity → no row.
- [ ] AIPLA-app capture byte-unchanged (the `iframe-context` path untouched).
- [ ] Researcher can distinguish `source: external-host` rows.

## 11. Open Questions

- Identity model — join-code (a) vs launch-token (b) vs anonymous-aggregate (c)?
  (Recommend c now, a opt-in.)
- Is external-host capture even *wanted* for the pilot, or is "AIPLA app for
  research, external hosts for dissemination" the right permanent line? (This doc
  exists so the choice is informed, not forced.)

## 12. Related Documents

- [shared-mcp-app-bridge.md](shared-mcp-app-bridge.md) — the dual-channel bridge (§6.3a host matrix); this adds the third (server-observable) channel.
- [external-host-mcp-apps.md](external-host-mcp-apps.md) — 1.1.49, the `/api/mcp` endpoint + observability-gap write-up.
- `mcp-app-deploy-test` global skill — `host-compliance.md` (the `callTool` round-trip + `widgetAccessible`) and the `increment-counter` reference implementation.
- ADR-001 (anonymous-group auth) — the identity crux (§7).
