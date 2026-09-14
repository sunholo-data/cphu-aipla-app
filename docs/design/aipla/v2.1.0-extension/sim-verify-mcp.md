# A `verify_sim` tool on the MCP server — let the chat check the sim it is drafting

**Status**: **PROPOSED** 2026-09-14 — 1.1.115
**Priority**: **P2** — the authoring prompt works cold without it (two passing drafts on 2026-09-14). This closes the loop the prompt cannot: a draft is checked *before* it is handed over, by the thing that wrote it, instead of *after*, by M
**Estimated**: **~1.5d for M0–M2** (port the gates to one Python module ~0.75d · expose them as an MCP tool + prompt ~0.5d · brief-derived leak check + copy ~0.25d). M3 (live drive) and M4 (scratch preview) are sized but **deferred** — decide with AD in October
**Scope**: Backend — one new module that becomes the single implementation of the static sim gates; one tool, one prompt and one resource on the *existing* FastMCP server. Skill — `audit_artefact.sh` becomes a wrapper. Content — one sentence added to the authoring prompt, regenerated with `make sim-prompt`. No frontend
**Source**: M, 2026-09-14, on reading that the R2 guide said "ask M or AD to send you the prompt": *"I thought we had a GET URL that would be fetched or an mcp server it would connect to to verify what its building?"* — and then: *"we have existing mcp you know right?"* The GET URL shipped the same day (`09b46433`, `/sim-authoring-prompt.txt`). This doc is the MCP half
**Related**: [external-host-mcp-apps.md](../v1.1.0-feedback/external-host-mcp-apps.md) (the server this adds to — `/api/mcp`, public, sims as MCP Apps) · [shared-mcp-app-bridge.md](../v1.1.0-feedback/shared-mcp-app-bridge.md) (the bridge whose markers gate 11 checks) · [sim-onboarding-ergonomics.md](../v1.1.0-feedback/implemented/sim-onboarding-ergonomics.md) (where the gates came from) · `.claude/skills/mcp-app-artefact/` (the skill whose scripts this consolidates) · [plan-2026-09-to-2027-04.md](plan-2026-09-to-2027-04.md) workstream D (the sims/artefact surface is named in the strategic remit; this is maintenance-sized, not a workstream)

## The gap, stated plainly

Since 2026-09-14 a physics teacher can open Claude or ChatGPT, give it
`https://aipla.ku.dk/sim-authoring-prompt.txt` and a brief, and get back two
files that usually pass every gate. **Usually.** The prompt ends with a
twelve-point self-check the model performs *on its own output*, and the doc that
carries the prompt is honest about what that is worth:

> It cannot run the gates. So the prompt ends with a self-check, and you run the
> real gates when the file lands.

So the loop today is: teacher drafts in a chat → emails two files → M runs
`audit_artefact.sh`, `verify_sim.mjs --drive` and the catalogue test → M emails
back what failed → teacher goes back to the chat. Every gate failure costs a
round trip through a person, for checks that are **greps**. Meanwhile the
platform already runs a public MCP server (`backend/protocols/mcp_server.py`,
FastMCP, mounted at `/mcp`, reachable at `https://aipla.ku.dk/api/mcp` — verified
`tools/list` → 200 on prod today) that Claude.ai, ChatGPT and Claude Code can all
connect to as a remote connector. It offers the sims *as* MCP Apps
(`show_boldkast`, `ui://aipla/boldkast/v1`). It offers nothing that checks one.

**The proposal: one tool on that server, `verify_sim`, that runs the static gates
the repo already has and returns what failed and how to fix it, so the model
that wrote the draft corrects it before a person sees it.**

## What exists, and the duplication this removes

The static gates are implemented once in bash and partly again in node, and a
third copy of their *vocabulary* lives in the prompt's self-check:

| Where | What | Runs |
|---|---|---|
| `.claude/skills/mcp-app-artefact/scripts/audit_artefact.sh` | 11 gates: external fetch · `<script src>` · CDN CSS · ≤200 KB · `index.html` present · no dark theme · no nested iframe · no eval/Function/WebSocket · no `min-width` > 600px · no text < 11px · bridge markers present | by hand, in the skill |
| `scripts/check-artefact-broadcast.mjs` | every artefact with `emit()` call-sites has at least one labelled one (or opts out with `@aipla-no-broadcast`) | CI `sim-bridge` job, `make sim-build-check` |
| `scripts/build-artefact-bridge.mjs --check` | the stamped bridge has not drifted from `infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js` | CI, `make sim-build-check` |
| `backend/tests/unit/test_artefact_catalogue.py` | every YAML validates as `ArtefactMeta`; the measurement sims keep reference values server-side; commit events are ones the proactive gate reads | pytest |
| `.claude/skills/mcp-app-artefact/scripts/verify_sim.mjs` | **dynamic**: `?test=1` self-test verdict, page errors, overflow at 390/700/1024, and with `--drive` the emitted kinds, namespacing, a labelled emit, the 4096-byte cap, proactive category | by hand, Playwright |
| `authoring-prompt.md` §"BEFORE YOU ANSWER" | 12 self-check items — the same rules, as prose for the model | by the model, on itself |

`verify_sim.mjs` already mirrors `PROACTIVE_TOKENS` from
`frontend/src/lib/proactiveEventCheck.ts` "so the script can say this kind will
never wake the tutor without importing TypeScript". That is the third copy of
that list. The pattern is set: each check was written where it was needed, and
nothing runs all of them in one place.

**M0 below makes the Python module the implementation and turns the bash script
into a wrapper.** Not because bash is wrong, but because the MCP server is Python,
CI's pytest is Python, and one implementation with three callers is the shape
that stops the fourth copy.

## Design

### Where it lives — the existing server, same posture

`backend/protocols/mcp_server.py` gains, alongside `register_sim_apps(mcp)`:

```python
register_sim_verify(mcp)   # backend/protocols/sim_verify.py
```

which adds:

| Kind | Name | What |
|---|---|---|
| **tool** | `verify_sim` | `(index_html: str, catalogue_yaml: str \| None, hidden_terms: list[str] \| None) → VerifyReport`. The one call |
| **prompt** | `author_sim` | argument `brief: str`; returns the authoring prompt with the `<<< BRIEF >>>` block replaced. MCP prompts exist for exactly this — a host that supports them shows it in its `/` menu |
| **resource** | `aipla://sim-authoring-prompt` | the bare prompt text, for hosts that read resources but not prompts |

Public, no auth — the same posture as the rest of the server and the reason it
is reachable from a teacher's chat at all. The cost of a call is CPU on ≤200 KB
of text; see *Abuse surface* below for why that is acceptable and where the cap
is.

**The prompt text is fetched lazily from the frontend**
(`${FRONTEND_URL}/sim-authoring-prompt.txt`) and cached per process, the way
`sim_apps.py` fetches artefact HTML from the sandbox. The backend image contains
only `backend/`, so `.claude/skills/…/authoring-prompt.md` is not on its disk in
production; the public txt is *generated from* that source and CI-gated against
drift (`make check-sim-prompt`), so it is the right thing to read. No fourth copy.

### The gates — one module, four tiers

`backend/sim_gates/` (new package; `backend/artefacts/` stays YAML-only):

```
sim_gates/
  __init__.py     run(html, yaml=None, hidden_terms=None) -> VerifyReport
  static.py       tier A  — the 11 ADR-013 / CSP / layout greps, ported verbatim
  conformance.py  tier B  — what the authoring prompt asks for
  crossfile.py    tier C  — HTML ↔ YAML agreement, via ArtefactMeta
  leak.py         tier D  — the brief's hidden quantity, if the caller names it
  report.py       VerifyReport / Gate dataclasses, text + JSON renderers
  proactive.py    the trigger vocabulary — ONE copy, imported by tests
```

**Tier A — the blank-frame class.** The eleven checks in `audit_artefact.sh`,
ported line for line including the regexes and the `0.6875rem` threshold. These
are the ones whose failure the browser reports as *nothing* — a CSP violation
renders an empty iframe with no error — which is why they come first and why
their `fix` text says so.

**Tier B — conformance to the prompt.** What the prompt asks for and the
self-check enumerates, checked mechanically instead of by the model's own
account:

| Gate | Checks | Why the model gets this wrong |
|---|---|---|
| `bridge_markers` | both `@aipla-bridge:` markers, in order, with one `<script>` between them, and **no bridge body** (it must be the placeholder — `make sim-build` stamps the real one, and a hand-written bridge fails the drift check) | it is told not to write ~370 lines it knows how to write |
| `bridge_guard` | every `AIPLA_BRIDGE` reference is inside the `bridge()` guard; no bare `AIPLA_BRIDGE.` | *"code shown beats rules stated"* — round 2 found an unguarded snippet in one section overriding the rule in another |
| `strings_object` | a `const strings = { da: {…}, en: {…} }` exists and the two locales have the same keys | a missing key prints `undefined` |
| `no_inline_text` | elements carrying `data-t` are empty in the markup; **heuristic** — flags text nodes > 2 chars inside `<button>`, `<label>`, `<th>`, `<option>` that lack `data-t` | the rule most often broken after the one-simulation rule |
| `labelled_emit` | at least one `emit(` call-site whose `extra` carries `label:` (port of `check-artefact-broadcast.mjs`, honouring `@aipla-no-broadcast`) | without it: no trust card, no proactive turn |
| `trigger_verb` | at least one emitted verb maps to a proactive category in `proactive.py` | *"the tutor will never react on its own"* |
| `reset_on_clear` | **warning**, not fail: an `emit("reset"` whose surrounding function touches the measurement record (heuristic: same function body mentions the table/series identifier) | `.reset` is dropped before the tutor, which then marks a dataset the student deleted |
| `self_test` | the `?test=1` block exists, sets `document.title` to `TEST PASS`/`TEST FAIL`, and `applyLang` is guarded by `TEST_MODE` | a late `applyLang` erased the verdict in round 2 |
| `one_simulation` | **heuristic, warning**: `<ol>` with ≥3 `<li>` outside the measurement table; strings keys matching `/task|opgave|step\d|hint|quiz/`; a `<textarea>` or `<input type=text>` with a "send/ask" button | the rule most often broken |

**Tier C — the two files agree.** Only runs when `catalogue_yaml` is supplied,
and reports `skipped` (never `pass`) when it is not:

- the YAML validates as `db.models.artefact.ArtefactMeta` — the same pydantic
  model the catalogue loader uses, so a draft that passes here loads;
- `id` equals `ARTEFACT_NAME` in the HTML equals the event prefix of every
  `emit(`;
- `eventVocabulary` equals the set of emitted verbs — no more, no fewer
  (self-check item 10);
- `tutorBlock` contains the literal `REFERENCE, FOR CHECKING ONLY` line;
- `status: live` is **downgraded to a warning** — a draft should say `draft`,
  and the person merging flips it.

**Tier D — the brief's hidden quantity.** The single most useful thing R2 asks
staff to specify is *what must stay hidden*, and nothing mechanical checks it
today (the catalogue tests do, per sim, by hand:
`test_wave_speed_never_names_a_speed_anywhere_public`). If the caller passes
`hidden_terms` — names, symbols, or values from the brief (`["g", "9.82",
"tyngdeacceleration", "period"]`) — the gate greps the HTML's **user-facing
surfaces** (the `strings` object, `data-t` targets, canvas `fillText` literals,
readout labels) and every `emit(` payload literal for them. A hit is a `fail`
with the line. It cannot see a value that is *computed* on screen (`num(T)`), and
the report says so in `not_checked`. It is a net, not a proof — the same
standing as the prompt's own item 7, but run by something that does not want the
draft to pass.

### The report — a check that could not run is never a pass

```json
{
  "ok": false,
  "summary": "2 failed, 1 warning, 3 skipped (no catalogue_yaml), 17 passed",
  "gates": [
    {"id": "A.no_external_fetch", "tier": "A", "status": "pass"},
    {"id": "B.bridge_guard", "tier": "B", "status": "fail",
     "detail": "line 214: AIPLA_BRIDGE.emit(...) outside the guard",
     "fix": "Route every bridge call through `const bridge = () => (typeof AIPLA_BRIDGE === \"undefined\" ? null : AIPLA_BRIDGE)`. Until `make sim-build` runs, AIPLA_BRIDGE does not exist and this line throws before the self-test can run."},
    {"id": "C.yaml_validates", "tier": "C", "status": "skipped",
     "detail": "no catalogue_yaml supplied"},
    …
  ],
  "not_checked": [
    "whether the physics is right",
    "whether the Danish reads like a physics teacher wrote it",
    "whether a student can tell what to do first",
    "anything that needs the sim to RUN: the self-test verdict, overflow at 390px, what the events actually carry (run verify_sim.mjs --drive in the repo)"
  ],
  "next": "Fix the 2 failures and call verify_sim again. When ok is true, send both files to the project team."
}
```

Four statuses, deliberately: `pass` · `fail` · `warning` · `skipped`, plus
`error` for a gate that threw. **`skipped` and `error` never roll up into
`ok: true`** — `ok` requires every non-warning gate to be `pass`. This is
CLAUDE.md's *"a checker answers when it could not read its subject"* footgun
applied at design time rather than after the incident: a tool that says `ok`
because tier C had nothing to read would be trusted exactly when it should not
be. The `not_checked` list exists so the model cannot honestly tell the teacher
*"it passed all checks"* — it is told what it did not check, in words it will
repeat.

`fix` is written for the **model**, not for M: a sentence that names the
mechanism (*"until `make sim-build` runs, AIPLA_BRIDGE does not exist"*) rather
than the rule, because the prompt's validation notes found that models fix what
they understand and re-break what they were merely told.

### One implementation, three callers

| Caller | How | Replaces |
|---|---|---|
| **The teacher's chat** | `tools/call verify_sim` over `https://aipla.ku.dk/api/mcp` | the email round trip |
| **The skill / a developer** | `audit_artefact.sh <dir>` → `cd backend && uv run python -m sim_gates <dir>` — same output shape as today, prints text | the bash body |
| **CI** | `tests/unit/test_sim_gates.py`: every live artefact under `infrastructure/mcp-sandbox/artefacts/**` passes tiers A–C with its own YAML; and **one fixture per gate that must fail exactly that gate** | nothing — today no CI job runs the eleven static gates at all; only the broadcast and drift checks do |

The fixture set is the *plant one* discipline the repo already uses (the
literature-isolation guard was "tested by deliberately breaking it"): a gate
without a fixture that trips it is a gate whose regex may match nothing.

### The authoring prompt closes the loop

One paragraph added to the source (`authoring-prompt.md`), then `make sim-prompt`:

> If you have the AIPLA connector (an MCP server at
> `https://aipla.ku.dk/api/mcp`), call `verify_sim` with both files before you
> answer, fix what it reports, and call it again until `ok` is true. Tell the
> teacher what `not_checked` lists — those are theirs to check. If you do not
> have the connector, do the self-check below by hand.

And the `/project/build-a-simulation` page gains a short section *"If your chat
can use connectors"* — how to add the server in Claude.ai (Settings → Connectors
→ Add custom → URL) and ChatGPT (developer mode) — regenerated from the same
source. The R2 guide gets the same paragraph.

### Abuse surface

The endpoint is public today and stays so. `verify_sim` adds an input of up to
200 KB of text per call. The controls:

- **Size before anything.** Reject > 256 KB (`fail` on `A.size` and stop) before
  any regex runs. The 200 KB gate is the artefact rule; the 256 KB cut-off is the
  parser's.
- **No execution, no storage.** The tool never evaluates the HTML, never writes
  it, never logs it — a draft may contain a teacher's unpublished work. Logs
  carry sizes and gate outcomes only.
- **Linear regexes.** Every pattern is ported from the bash script (POSIX ERE,
  no backtracking constructs); the two new heuristics in tier B are written
  the same way and have a test against a 200 KB adversarial input that must
  finish in < 1 s.
- **Rate.** Reuse whatever the `/api/mcp` route already has; if the answer is
  "nothing", a token bucket per client IP in `sim_verify.py` (burst 10,
  refill 1/s) — cheap, and a teacher iterating in a chat is well inside it.

Compared with the surface already exposed — `skill_<id>` tools that invoke a
model on arbitrary text — this is the cheaper call by two orders of magnitude.

## What this deliberately does not do

**It does not run the sim.** The dynamic checks — self-test verdict, overflow at
390 px, what the events actually carry, the 4096-byte cap on a *real* payload —
need a browser. The backend image has no Chromium and should not grow one for
this. `verify_sim.mjs --drive` stays repo-side and the report's `not_checked`
says so. **M3** below is the honest cost of changing that.

**It does not judge the physics, the Danish, or first contact.** R2 is explicit
that these are the physicist's, and the September wave draft (two waves, one
medium, different speeds) is the standing example of what no gate catches. The
tool's job is to make sure the *only* things left for the physicist are the
things only a physicist can do.

**It does not host the draft.** A teacher still opens the HTML from disk to try
it. **M4** is the version where the tool returns a temporary sandbox URL — and
the reason it is deferred is ADR-013, not effort: today every byte the sandbox
origin serves was reviewed at commit time, and a scratch path would be the first
that was not.

## Milestones

| | What | Est. | Gate |
|---|---|---|---|
| **M0** | `backend/sim_gates/` — tiers A–C ported; `audit_artefact.sh` becomes the wrapper; `proactive.py` becomes the one vocabulary (`verify_sim.mjs` imports it via a generated JSON, or keeps its mirror with a lockstep test — decide at the keyboard); `test_sim_gates.py` with all-live-pass + one-fixture-per-gate | ~0.75d | every live artefact passes; every fixture fails its gate and only its gate |
| **M1** | `protocols/sim_verify.py` — `verify_sim` tool, `author_sim` prompt, the resource; lazy prompt fetch; size cut-off + rate limit; e2e test through `TestClient` at `/mcp` **and** a curl against dev's `/api/mcp` with boldkast's real HTML | ~0.5d | `tools/list` shows it on dev; a Claude.ai connector can call it |
| **M2** | tier D `hidden_terms`; the prompt paragraph + `make sim-prompt`; the page and R2 section on connectors | ~0.25d | a draft with `g` on screen fails `D.leak` when the brief says hide it |
| **M3** *(deferred)* | live drive as a service — Playwright in a small Cloud Run service (`aipla-v01-sim-verify`, node image like the sandbox's), `verify_sim_live` tool proxies to it; returns self-test verdict, overflow, event table, screenshots as `image/png` content | ~1.5d + a service to run | decide in Oct with AD once M1 shows use |
| **M4** *(deferred)* | scratch preview — `verify_sim` optionally returns a temporary URL on the sandbox origin (`/scratch/<token>/`, 1 h TTL, bridge stamped), so the reviewer tries it in the real frame and an activity could mount it | ~2d | **needs an ADR-013 decision first**: unreviewed HTML on the artefact origin, even under the same CSP, is a posture change |

## Verification of the feature itself

1. `cd backend && uv run pytest tests/unit/test_sim_gates.py` — seven live
   artefacts pass; N fixtures fail exactly their gate.
2. `audit_artefact.sh infrastructure/mcp-sandbox/artefacts/boldkast/v1` prints
   the same eleven `OK` lines it does today (wrapper parity).
3. From a laptop, with the real prod HTML:
   ```bash
   curl -s https://aipla-sandbox.ku.dk/artefacts/boldkast/v1/index.html -o /tmp/b.html
   jq -n --rawfile h /tmp/b.html '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"verify_sim",arguments:{index_html:$h}}}' \
     | curl -s https://aipla.ku.dk/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d @- \
     | jq '.result.structuredContent | {ok, summary}'
   ```
   expects `ok: false` with **only** tier C `skipped` — boldkast passes A and B,
   and `ok` must not be true with C unread.
4. The 2026-09-14 cold test, re-run with the connector attached: the agent
   calls `verify_sim` unprompted after the prompt paragraph lands, and the
   transcript shows a fix-and-recall loop rather than a self-check paragraph.
   **Ask the agent what it guessed at**, per the prompt's validation notes.

## Open for a human

- **Public or authed?** Public matches the server and is what makes it reachable
  from a teacher's own chat. If the rate limit ever binds, the alternative is a
  per-teacher token minted from `/teacher` and passed as a header — the
  `mcp_proxy.py` pattern — at the cost of a setup step R2 would have to explain.
- **Should `ok: true` be reachable without the YAML?** As designed, no — tier C
  `skipped` blocks it, so a chat must produce both files to get a green. That
  is the intended pressure; say if it is too much.
- **M3's service or not.** ~1.5d plus a Cloud Run service per env for the checks
  that catch the *phase-change button disabled for the whole run* class of bug.
  Worth it if M1 sees real use from staff; not worth it for two drafts a term.
