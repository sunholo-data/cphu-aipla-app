---
name: mcp-app-artefact
description: >
  Add, change or debug a simulation in the AIPLA sim library — a self-contained
  HTML/JS artefact served from the sandboxed mcp-sandbox origin and mounted in
  the student workspace. A sim is TWO files: the artefact at
  infrastructure/mcp-sandbox/artefacts/<id>/v1/index.html and its catalogue
  entry at backend/artefacts/<id>.yaml. Covers the whole path — scaffold, the
  guest bridge and event vocabulary, the catalogue fields, the ADR-013 security
  gates, the visual standard, browser verification, and deploy. Use when the
  user says "add a sim", "new artefact", "new MCP app", "build a simulation",
  "port this HTML into the app", "the sim doesn't show up in the picker", "the
  tutor can't see what the student did in the sim", "the trust card isn't
  rendering", "no proactive turn after the student ran the sim", or names
  Boldkast / LED-Planck / KineBot / Elkedel / Faseovergange / mcp-sandbox /
  SimPicker / GenericArtefactFrame. Do NOT use for activity workbench elements
  (that is workbench-element-builder) or for agent skill templates.
---

# Adding a sim to the AIPLA library

> **A sim is two files.** Everything else is done for you by the catalogue and
> the generic frame. If you are about to write a React component, a SKILL.md, or
> a branch in the chat page for a new sim, stop and read
> [§ What you do NOT write](#what-you-do-not-write).

| | |
|---|---|
| The sim | `infrastructure/mcp-sandbox/artefacts/<id>/v1/index.html` |
| The catalogue entry | `backend/artefacts/<id>.yaml` |

## How a sim reaches a student

```
backend/artefacts/<id>.yaml
   │  artefacts.loader → ArtefactMeta
   ├─ GET /api/artefacts?status=live ──► SimPicker ──► teacher attaches it
   │                                     (activity.artefactId, validated
   │                                      against the catalogue)
   │
   ├─ activity /active ──► ArtefactMeta.public()   ◄── tutorBlock STRIPPED here
   │      └─► StudentWorkspace ─► GenericArtefactFrame ─► StaticArtefactFrame
   │              └─► sandbox proxy /sandbox.html (separate origin, ADR-013)
   │                      └─► artefacts/<id>/v1/index.html
   │
   └─ tutorBlock ──► adk/teacher_focus.py ──► the tutor's system prompt
                                              (server-side only, never the browser)

the sim's own events:
   AIPLA_BRIDGE.emit("<id>.<verb>", {...})
      └─ SEP-1865 ui/update-model-context
           └─ GenericArtefactFrame
                ├─ trust card in chat   (only when the payload carries `label`)
                ├─ POST /api/sessions/{id}/iframe-context  (serverId = <id>)
                │     └─ mcp_app_context.<id>.state → adk/iframe_context.py
                │          → the tutor sees the sim's state
                └─ proactive gate (kind suffix → sim_run / measurement_commit …)
```

Two consequences worth holding onto:

- **The catalogue entry is what makes a sim exist.** No YAML, no sim — the HTML
  deploys and nothing can reach it.
- **`status: live` is what "in the library" means.** `SimPicker` requests
  `?status=live`; a `beta` artefact deploys and no teacher can attach it.

## The path

### 1. Does it belong here?

Use this static-artefact path when the sim is HTML + inline JS + inline CSS,
all logic client-side, under 200 KB, no server needed. That is every sim AIPLA
has.

Reach for a **dynamic MCP server** (its own `infrastructure/mcp-<name>/`, its own
Cloud Run service, tools returning `ui://` resources) only when you genuinely
need a server: server-side answer checking that must not expose the answer to
the agent, a lookup table too big to ship, per-user persistence. AIPLA has none
yet; the pattern lives upstream at `infrastructure/mcp-ext-apps-map/`.

### 2. Scaffold

```bash
.claude/skills/mcp-app-artefact/scripts/new_sim.sh <id> "<Display title>"
```

Creates both files — the artefact from `_template` (bridge block already
stamped) and a catalogue stub with every field and a `TODO` tutorBlock. It
refuses an id that is not kebab-case or that already exists.

The underlying commands, if you want them separately:
`./scripts/new-artefact.sh <id> "<title>"` (repo root) writes the artefact only.

### 3. Write the sim

**Drafting it in another chat?** Use
**[resources/authoring-prompt.md](resources/authoring-prompt.md)** — a
paste-ready brief that makes any AI return a conforming artefact plus its
catalogue entry, so there is nothing to port. Then `make sim-build` stamps the
bridge and you go straight to the gates. It is published for physics staff at
`/project/build-a-simulation` and `/sim-authoring-prompt.txt` — generated
copies, `make sim-prompt` after editing the source (`make check-sim-prompt` is
CI-gated).

Writing it here, read **[resources/artefact-anatomy.md](resources/artefact-anatomy.md)** — the
file skeleton, the bridge API, how to emit, commit-on-submit, host→artefact
notifications, and the self-test.

Read **[resources/visual-standard.md](resources/visual-standard.md)** before you
write CSS. The host workspace is light-themed and ~700px wide; a dark header or
a 900px bench reads as a broken app, not a styling nit.

Design the student's experience before you build it — see
[§ Usability is a gate, not a polish pass](#usability-is-a-gate-not-a-polish-pass).

### 4. Catalogue it

Read **[resources/catalogue-entry.md](resources/catalogue-entry.md)** — every
field, who reads it, and how to choose a value. The two that carry weight:

- **`tutorBlock`** — what the sim IS and what its events MEAN, plus any
  reference values the tutor needs in order to mark an answer. Server-side only
  (`ArtefactMeta.public()` strips it), so this is the right home for the numbers
  the student must not be handed.
- **`status: live`** — or the teacher cannot attach it.

### 5. Verify

```bash
# ADR-013 + structure + visual gates
.claude/skills/mcp-app-artefact/scripts/audit_artefact.sh \
    infrastructure/mcp-sandbox/artefacts/<id>/v1

# bridge drift + the broadcast floor (both are CI gates)
make sim-build-check

# the catalogue loads and the tutorBlock does not leak
cd backend && uv run pytest tests/unit/test_artefact_catalogue.py -q

# self-test, viewport fit, and a real drive-through with event capture
node .claude/skills/mcp-app-artefact/scripts/verify_sim.mjs <id>
```

**Run the browser one.** It is the only check that sees behaviour, and it is
what caught `phase-change` shipping with its "mark point" button disabled for
the entire run — every static gate was green. See
[§ Verify in a browser](#verify-in-a-browser).

### 6. Ship

```bash
git add infrastructure/mcp-sandbox/artefacts/<id> backend/artefacts/<id>.yaml
git commit -m "feat(artefact): <id> v1"
git push
```

**A new sim needs BOTH deploys.** The HTML rides the `aipla-mcp-sandbox-deploy`
trigger (push to `dev` + a change under `infrastructure/mcp-sandbox/**`); the
catalogue YAML is baked into the **backend image**, so it needs the root `dev`
build too. A push touching both fires both. If you change only the YAML and the
sim stops appearing, you are looking at a backend deploy that has not run.

Verify deployed:

```bash
SANDBOX_URL=$(gcloud run services describe aipla-v01-sandbox \
  --project=aipla-dev-2026 --region=europe-north1 --format='value(status.url)')
curl -s -o /dev/null -w '%{http_code}\n' "$SANDBOX_URL/artefacts/<id>/v1/index.html"   # 200
curl -s "$(…backend url…)/api/artefacts?status=live" | grep '<id>'
```

test and prod are reached by the tag-based release triggers, not by this push —
see `infrastructure/env/cloudbuild.tf` and the deploy runbook.

## What you do NOT write

Since 1.1.41 a catalogued sim needs **no host-side code**:

| Do not write | Because |
|---|---|
| `<Name>SimButton` / `<Name>Workbench` / `<Name>Frame` | `GenericArtefactFrame` mounts any catalogued artefact |
| A per-sim `use<Name>Snapshot` hook | `useSimSnapshotPush` inside the generic frame does it |
| A `skillSlug === "..."` branch in `app/chat/[...path]/page.tsx` | `StudentWorkspace` resolves the artefact from the activity |
| `backend/skills/templates/<slug>/SKILL.md` | the tutor is the activity's tutor; the sim contributes `tutorBlock` |
| Trust-card dispatch code | the frame cards any payload carrying `label` |
| An entry in `_CLIENT_RENDER_TOOLS` | that allow-list is for client-rendered **tool results**, not sim events |

Boldkast, LED-Planck and KineBot each have a bespoke Frame because they predate
the catalogue. **Do not copy them as the pattern.** If you think you need
host-side code, read
[resources/host-side-code.md](resources/host-side-code.md) — it lists the three
cases that genuinely justify it and how to add one.

## The rules that bite

Each of these has cost real time at least once. The "enforced by" column is what
catches it now; where that says *judgement*, you are the guard.

| Rule | Why | Enforced by |
|---|---|---|
| **One simulation per iframe** | a second *view* (quiz, graph, notes, picker) in the frame produces the cramped multi-role failure twice already shipped | judgement |
| **The answer never reaches the page** | a sim that displays the result it is asking the student to derive has no exercise in it | judgement + `test_artefact_catalogue.py` for the catalogue half |
| **At least one labelled emit** | `label` is the ONLY thing that renders a trust card and fires a proactive turn; unlabelled emits are silent state | `make sim-build-check` |
| **Event verbs from the fixed vocabulary** | the proactive gate matches the kind's LAST dot-segment against keyword lists — `reading` fires, `captured` silently does not | `proactiveEventCheck.test.ts` |
| **One `strings` object, `lang` from the bridge** | language is data; a sim with Danish in its markup cannot be translated without a code change | nothing yet — see [§ Known gaps](#known-gaps) |
| **Light theme, ≥11px text, no `min-width` over 600px** | the host workspace is light and ~700px | `audit_artefact.sh` |
| **Fits 700px AND 390px** | the workspace pane is `md:w-1/2`; students use phones | `verify_sim.mjs` |
| **No external fetch, no CDN, no nested iframe, no `eval`, ≤200 KB** | the sandbox CSP is `default-src 'none'` — a violation is a blank frame with no error | `audit_artefact.sh` |
| **The one exception: a vendored library** (three.js r128 today) by its absolute `/vendor/…` path with the manifest's SRI hash and `crossorigin="anonymous"` — never a CDN | same-origin and hash-checked twice; a CDN leaks every student's IP and widens the CSP. Policy + how to admit one: [resources/vendored-libraries.md](resources/vendored-libraries.md) | `audit_artefact.sh` gate 12, `serve.test.ts` |
| **No `localStorage`** — `sessionStorage` if state must survive a reload | the sandbox origin is shared by every student on a lab machine; `sol-jord-maane` arrived storing students' written answers there | judgement |
| **Never hand-edit the `@aipla-bridge` block** | it is generated from one source; a local edit drifts silently | `make sim-build-check` |
| **`status: live`** | `SimPicker` filters on it | `test_artefact_catalogue.py` |

### Event verbs — the list that actually fires

`frontend/src/lib/proactiveEventCheck.ts` takes the kind's last dot-segment,
splits it on `-` and `_`, and matches **any** token:

| Category | Tokens |
|---|---|
| `sim_run` | `play` `run` `simulate` `afspil` |
| `step_advance` | `step` `next` `advance` `placed` `calibrated` |
| `measurement_commit` | `measure` `record` `commit` `show_value` `reading` `fit` `spectrum` |

Anything else maps to null and never triggers a proactive turn — correct for
`open`, `pause`, `reset`, `state-change`. Name your deliberate actions from this
list; if a new sim needs a word that genuinely fits a category, add it to the
token list in that file **and** a case to its test, rather than inventing a
synonym that silently does nothing.

`GenericArtefactFrame` separately drops kinds ending `.pause`, `.reset`,
`-error` and `.sync` before they reach the tutor at all.

Full per-artefact vocabulary:
[resources/event-vocabulary.md](resources/event-vocabulary.md).

### Usability is a gate, not a polish pass

Write these down before you build. Both prior ports shipped UI-first and then
needed a cleanup sprint.

1. **The student journey.** What is on screen at first contact, and what is the
   obvious next step from every state?
2. **Empty, loading and error states**, explicitly. A default-visible panel that
   renders nothing is a bug, not a TODO.
3. **The narrowest viewport.** Decide the layout at 390px, not on your monitor.
4. **The split.** List every surface and mark it iframe / activity element /
   delete. Quiz, formula sheet, notes, topic picker → not the iframe.
5. **Motivation.** Where is the sense of getting somewhere?

Before merging, drive it as a student for 60 seconds. If anything confuses,
cramps or stalls, it is not done.
[resources/pre-ship-checklist.md](resources/pre-ship-checklist.md) is the
tickable form.

### What belongs in the iframe, and what does not

The iframe holds **the one live simulation**: the canvas or bench, the controls
that act on it, the instruments reading it, and the telemetry.

Everything else moves out — and "out" now usually means the **activity**
(elements the teacher configures: checklist, table, calculator, notes) or the
**tutor** (via `tutorBlock`), not a bespoke React panel:

| In the mockup | Where it goes |
|---|---|
| Numbered task list, "your turn" steps | the tutor (`tutorBlock`) or activity elements |
| Constants / formula reference | the tutor, on demand |
| Long problem statement, framing prose | the activity's goal |
| Progress checklist driven by sim state | derived from the snapshot, outside the iframe |
| Quiz / MCQ, topic picker, notes pad | activity elements |
| Embedded chat, "ask AI" buttons, API-key UI, its own header/branding | **deleted** — AIPLA owns all four |

**The judgement call to get right:** a *measurement record* is part of the
instrument, not lesson scaffolding. `kettle-efficiency` keeps its captured
readings and `phase-change` keeps its marked-point table — they are the numeric
twin of what the sim draws, and without them the student is transcribing six
values off two instruments in one instant. A results *calculator*, a % error
display, or a checklist of lesson steps is a different thing and stays out.

Concrete test: imagine re-rendering the panel outside the iframe. If nothing
breaks, it should not have been inside.

## Verify in a browser

`scripts/verify_sim.mjs` drives the artefact in real Chromium and reports:

- the `?test=1` self-test verdict and any page errors
- horizontal overflow at 390 / 700 / 1024 px
- with `--drive`, a scripted interaction plus every `ui/update-model-context`
  payload the sim emitted, so you can see the kinds, the labels and the state
  the tutor will receive

It needs Playwright. If it is not installed, the script says exactly what to
run and exits non-zero rather than claiming a pass it did not perform.

What it cannot see, and you must: whether the physics is right, whether the
Danish reads well, whether a student knows what to do next.

## Known gaps

Current as of 2026-09-24. Fix or delete these lines when they change.

- **The tutor cannot drive a sim, and has no assessment channel.** Author
  packages (sol-jord-maane's `INTEGRATION.md`) expect the tutor to write
  `<sim>{command}</sim>` lines the host strips and forwards, and
  `<vurdering>{…}</vurdering>` lines the host strips and stores. Neither is
  parsed, so neither is in any tutorBlock: a tutor told to write them would show
  them to the student. The sim half exists already: `sol-jord-maane` registers
  every command as the host notification `sol-jord-maane.cmd-<command>`.
- **No per-activity sim configuration.** A sim cannot be told "run in POE mode"
  or "hide the quiz" by the activity. URL parameters do not work because the
  artefact is `document.write`n under `sandbox.html`'s URL. A `configure` host
  notification is the natural carrier; nothing sends one yet.
- **No image channel.** A sim can share its state, not a screenshot:
  `ui/update-model-context` is JSON capped at 4096 bytes.

- **No sim receives a locale.** `GenericArtefactFrame` passes no `hostContext`
  to `StaticArtefactFrame`, so `AIPLA_BRIDGE.hostContext()` never carries
  `locale` and a rule-compliant sim falls back to its default language.
  Threading `activity.language` through is M1 of
  `docs/design/aipla/v1.1.0-feedback/content-localisation.md`.
- **The bridge has no "host context arrived" callback.** `init()` returns
  nothing and the context lands asynchronously, so `kettle-efficiency` and
  `phase-change` poll `hostContext()` for ~2s after init. Copy that shape until
  the bridge grows a hook.
- **`_template` and the older sections of this skill's own history predate the
  language rule.** The scaffold still emits Danish in markup; the two 2026-09
  sims are the conforming examples.
- **Artefact state is not restored across sessions.** A returning student gets
  chat history but the sim boots at its defaults. Deliberate: a per-sim restore
  contract would be edited in every artefact each time it changed. The host side
  already snapshots into `workbenchState`.
- **No domain-expert sign-off is automated.** ADR-013 asks for AR (or another
  physics reviewer) to sign off a pedagogically loaded artefact before merge.
  Nothing checks this; capture it in the PR or commit.

## The live library

| id | Display | Notes |
|---|---|---|
| `boldkast` | Boldkast — projektilbevægelse | reference implementation; mobile-first, correct sim-core shape |
| `led-planck` | LED Planck | pre-catalogue architecture (checklist + data table in the iframe); `minViewportPx: 720` |
| `kinebot` | KineBot | pre-catalogue; English by decision; quiz/graph lifted to React |
| `kettle-efficiency` | Elkedel — energi og nyttevirkning | catalogue-only; first `strings`-object sim |
| `phase-change` | Faseovergange — opvarmningskurve | catalogue-only; graph is in-iframe because it IS the live sim |
| `wave-speed` | Bølgefart — v = f·λ | catalogue-only; shows f, λ and T and never the speed |
| `wave-interference` | Interferens — to bølger lægges sammen | catalogue-only; one medium owns the speed, so f is DERIVED from λ |
| `sol-jord-maane` | Sol, Jord og Måne | first **author-supplied** port (author I) and first **three.js** sim (vendored); dark by exception (it is space); missions + diagnostic quiz stay in the iframe because they reconfigure the scene; 9.9 KB tutorBlock with the author's construct map; not offered on `/mcp` (vendored lib) |

Keep this table current — it is the fastest answer to "what do we already have".

## Reference files

| File | Read it when |
|---|---|
| [resources/authoring-prompt.md](resources/authoring-prompt.md) | drafting a sim in another AI chat |
| [resources/artefact-anatomy.md](resources/artefact-anatomy.md) | writing or editing the HTML |
| [resources/catalogue-entry.md](resources/catalogue-entry.md) | writing the YAML |
| [resources/visual-standard.md](resources/visual-standard.md) | writing CSS |
| [resources/event-vocabulary.md](resources/event-vocabulary.md) | choosing event kinds, or an event is not reaching the tutor |
| [resources/porting-external-apps.md](resources/porting-external-apps.md) | the sim came from outside AIPLA |
| [resources/vendored-libraries.md](resources/vendored-libraries.md) | a sim needs three.js, or you want to admit another library |
| [resources/host-side-code.md](resources/host-side-code.md) | you believe the generic frame is not enough |
| [resources/pre-ship-checklist.md](resources/pre-ship-checklist.md) | before merging |

| Script | Does |
|---|---|
| [scripts/new_sim.sh](scripts/new_sim.sh) | scaffolds both files from one id |
| [scripts/audit_artefact.sh](scripts/audit_artefact.sh) | 12 static gates: ADR-013, size, theme, type size, layout, bridge presence, vendored-script pinning (via `check_vendor_scripts.cjs`) |
| [scripts/verify_sim.mjs](scripts/verify_sim.mjs) | runs it in Chromium over HTTP under the real runtime CSP, with `/vendor/` resolved and WebGL on: self-test, viewports, and with `--drive` a repeated button sweep, a closing chat-flush, and the live event stream |

Related skills: `agent-protocols` (MCP Apps / AG-UI / A2UI disambiguation),
`workbench-element-builder` (activity elements, a different surface).

ADR-013 (artefact safety, the library-bypass path) is in the pinned snapshot at
`docs/design/aipla/_scoping-snapshot/architecture.qmd`.

## Running this skill outside the AIPLA repo

The method — self-contained HTML, a guest bridge, one labelled commit event, a
catalogue entry, the security gates — is portable. These parts are not, and a
sandboxed agent without this checkout should treat them as inputs it must be
given:

- every path under `infrastructure/`, `backend/`, `frontend/`, `scripts/`
- `make` targets, which assume the repo root
- the GCP project, region, service and trigger names
- `scripts/verify_sim.mjs`, which needs a Chromium and a filesystem

The scripts in this skill resolve the repo root from their own location and fail
with a named error when it is absent, rather than half-running. Keep it that
way: a sim that "passed" because a gate could not run is the failure mode this
whole document exists to prevent.
