# bohr-spektrum — a sim made outside AIPLA, imported on 2026-11-19

A real-world import, kept as a regression fixture. It came in through the
Sim workshop's import (`POST /api/sim-drafts/import`) on prod, as draft
`b9e0ada3…` owned by the teacher who built it with Claude, outside the
platform. This copy is that draft's **version 1, byte for byte**.

| File | What it is | Where it belongs in the app |
|---|---|---|
| `portable.html` | The sim as one portable file: AIPLA's bridge plus its catalogue entry inside a `<script type="application/yaml" id="aipla-catalogue">` block. Four tabs (overview, allowed orbits, jumps and light, practice), Danish and English. | Imported in the Sim workshop, never committed to the built-in library by hand. Publishing it goes through the workshop's publish panel |
| `practice-solutions.html` | Worked solutions for the sim's practice tab. The sim deliberately does not check practice answers on screen ("the tutor holds the solutions"). | A **material on the activity** that uses the sim, so the tutor can draw on it. Students never see this file. Not part of the sim |

`test_sim_import_fixtures.py` checks that `portable.html` still unbundles and
passes gate tiers A–C. It is the first sim built outside the platform, so a
change to the importer or the gates that would turn such sims away shows up
here first.

## What happened on 2026-11-19 (prod logs + the draft's versions)

- **The import was fine.** Level 3, no reasons. The page is 201,214 bytes, just
  under the 200 KiB cap (204,800).
- The teacher then asked the in-app sim author to check it. **v2** (10:08 UTC)
  is identical to v1. **v3** (10:57) only tightens spacing and font sizes, to
  stop a double scroll bar inside the workspace.
- That conversation cost **$1.60**: 39 model calls and 1.96M input tokens (about
  50k a call, because the 200 KB sim is in context). Each model call ran 30 s to
  5 min before anything streamed.
- **The "lost connection" was the co-pilot, not the network.** It treated a tab
  hidden for 10 s or more as a dead stream (a phone rule), stopped listening,
  and polled until the run ended. Meanwhile it showed no thoughts and no steps,
  and it let the teacher send a message the server then refused (409).
  Fixed in the same change as this README.
