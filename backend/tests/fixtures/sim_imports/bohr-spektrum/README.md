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
- That conversation was metered at **$1.60**: 39 model calls and 1.96M input
  tokens. That figure prices every input token at the full rate. Most of them
  were probably served from Gemini's cache (see the measurements below), which
  nothing recorded at the time. Each model call ran 30 s to 5 min before
  anything streamed.
- **The "lost connection" was the co-pilot, not the network.** It treated a tab
  hidden for 10 s or more as a dead stream (a phone rule), stopped listening,
  and polled until the run ended. Meanwhile it showed no thoughts and no steps,
  and it let the teacher send a message the server then refused (409).
  Fixed in the same change as this README.

## Measured on 2026-11-19: where the time goes (`make sim-import-replay`)

One import of this file, plus the workshop's "check it, change nothing" turn,
against `make sim-author-local` (real `gemini-3.8-flash` on Vertex `eu`, dev
project). n = 1 per row, so the noise between runs is large.

| run | turn | model / tools | calls | input (cached) | thinking | $ at full rate |
|---|---|---|---|---|---|---|
| base: no pruning, no `check_sim`, no ADK cache | 531 s | 508 s / 24 s | 6 | 202k (67%) | 9.1k | 0.19 |
| + pruning + `check_sim` | 506 s | 481 s / 24 s | 12 | 277k (78%) | 7.5k | 0.24 |
| + `ADK_CONTEXT_CACHE=1` | 564 s | 540 s / 23 s | 9 | 224k (23%) | 8.1k | 0.20 |

What it says:

- **The model's own latency is the wait, not context size or thinking.** One
  call took 30–250 s while thinking about 1k tokens and writing about 30. A raw
  one-shot call of the same size, outside the agent, got `429
  RESOURCE_EXHAUSTED` in 8 s, then `503 UNAVAILABLE` after 600 s: Vertex's
  shared capacity for this model on `eu` was saturated. Prod's logs show no
  retries in the morning's session either, so there too every call was simply
  slow.
- **Gemini's implicit caching already works** (67–78% of input). ADK's
  explicit cache made it *worse* (23%): it fixes one prefix, and implicit
  caching then stops matching. **Keep `ADK_CONTEXT_CACHE` off.**
- **Pruning had nothing to prune here:** this turn never made a new version,
  so no read was stale. It is for multi-version sessions like the prod one (3
  versions); the A/B above cannot show its effect.
- **`check_sim` did its job:** both runs that had it called it first and
  changed nothing. The base run re-checked with a no-op `edit_sim` again, which
  is how prod's identical v2 came about.
