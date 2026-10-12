# Anatomy in AIPLA

This file is the **AIPLA layer** over a vendored third-party skill. Everything else in
`.claude/skills/anatomy/` is upstream, unmodified apart from the pointer block at the top
of `SKILL.md`. Read this before you build an anatomy figure for this repo.

## What this is, and what it is not

| | |
|---|---|
| **This** | A **Claude Code skill**, for whoever builds AIPLA (M, AD, an agent in this repo). It turns a physics concept into a crafted interactive figure, and that figure then becomes a **sim in the library** through `mcp-app-artefact`. It runs at build time, with Node and headless Chrome, and takes 30–90 minutes for its smallest figure size. |
| **Not this** | Anything a tutor does in a lesson. The AIPLA app (ADK) has its own skills in `backend/skills/templates/`. The one that draws in chat is **`svg-illustrator`**, which renders and checks a small diagram at runtime (`backend/adk/svg_preview.py`). A tutor can never run anatomy: no Node, no Chrome, and seconds of budget, not hours. |

Its core idea, *the object is the explanation*, is the same bar our sims aim for: a real
apparatus whose working **is** the concept, every number driven by one model. The upstream
`examples/ripple-tank/` is a school ripple tank driven by a real water-wave model
(`model.mjs`). That is the closest thing to a ready-made physics sim in the kit.

## Turning an anatomy figure into an AIPLA sim

Build the figure with anatomy. Then follow **`mcp-app-artefact`** from its step 2
(scaffold), using the figure as the body of `artefacts/<id>/v1/index.html`. Six things
differ from anatomy's own defaults:

1. **Size: Figure size only, under 200 KB.** ADR-013 caps an artefact at 200 KB. The
   upstream `dial-indicator` builds to about 136 KB. `ripple-tank` (505 KB) and
   `raptor-engine` (1.6 MB) do not fit. So a Hero or Epic figure is not a sim today;
   raising the cap is a decision, not a workaround. At the time of writing nothing
   enforces the cap except `audit_artefact.sh`, so check it yourself.
2. **Light theme.** The workspace is a light surface (`mcp-app-artefact`'s
   `resources/visual-standard.md`). Build with `--light` and ship the `-light.html` page.
   Check it at the workspace's real widths, about 700 px and 390 px. Anatomy already
   checks 390.
3. **The sandbox CSP.** `default-src 'none'; connect-src 'none'`, inline scripts allowed,
   images only from `data:`/`blob:`. A built anatomy page is self-contained (the kit is
   inlined with `scripts/inline-kit.mjs`, fonts are system stacks), so it should pass.
   WebGL is a canvas and needs no network. Never load the kit or anything else from a
   CDN.
4. **The tutor must see it.** An anatomy figure has a live readout but tells nobody what
   the student did. Wire the guest bridge and the event vocabulary
   (`mcp-app-artefact` `resources/artefact-anatomy.md` and `event-vocabulary.md`). The
   figure's model, the module that drives its readout, is the natural source of the
   state snapshot.
5. **Words.** Anatomy keeps words out of the drawing. AIPLA additionally keeps every
   student-visible string in one object, because a sim carries no language of its own
   (CLAUDE.md, *content must be translatable*). The card's title, hint and readout
   labels go there.
6. **Both sets of checks.** Anatomy's `--audit` and `scripts/lines.mjs` prove the
   drawing. Our `audit_artefact.sh` and `verify_sim.mjs` prove it is a safe, working sim.
   Run both. Neither replaces the other.

## The worked example: `otto-engine`

The first anatomy figure in the library (2026-10-12) — a half-section four-stroke
engine with a live p-V diagram. Its sources are the pattern to copy:
`infrastructure/mcp-sandbox/figures/otto-engine/` (`model.mjs` the physics,
`geom.mjs` the helpers the kit lacks — convex prisms off the z axis, a vertical
helix, half-section rings with hatching — `live.js` the page, `build.mjs` the
assembly). Lessons it paid for:

- **Inline only the kit's drawing half.** The page needs `iso`, `extrude`,
  `solidSvg` and friends, not `pageHtml`/`plateHtml` or the CSS-as-a-string;
  dropping them saved ~10 KB.
- **Escape `</script` in the inlined kit.** Its source contains the literal in a
  string; unescaped, the page's script ends early.
- **Raise the kit's 10.5 px corner text to 11 px** (AIPLA's floor) in the build,
  not in the vendored kit.
- **Section everything the cut plane passes through**, the piston included: a
  whole piston in front of a sectioned block hides the very chamber the figure
  exists to show.
- **Route pipes behind the cut.** A near-side manifold crosses the cutaway.

## Running it safely

This is third-party code. It is MIT-licensed, and a static scan found no network access
beyond the DevTools socket to the local headless Chrome its verify scripts start.
Still:
- Never build inside this directory. Copy the closest example to a scratch directory,
  build there, and run the scripts with paths as arguments. This tree should only ever
  change on a re-sync.
- The kit needs Node 20.10+. The checks need Chrome or Chromium.

## Provenance and re-sync

- **Upstream:** <https://github.com/wheresryan22/anatomy> (MIT, see `LICENSE`).
- **Pinned commit:** `689dcf966e63d92be10a5d593c6e19e10acd4422` (2026-10-12).
- **Left out:**
  - The built example pages (`examples/**/*.html`, about 10 MB). Each example's
    `build.mjs` regenerates its page.
  - The kit's own tests (`scripts/*.test.mjs`, `tests/`).
  - Repo furniture: `README.md`, `CHANGELOG.md`, `.github/`, `evals/`, `agents/`.
- **Local edit:** the pointer block at the top of `SKILL.md`, and this file.
- **To re-sync:** clone upstream, copy `SKILL.md LICENSE references kit scripts examples`
  over this tree, excluding `*.html` and `*.test.mjs`, then put the pointer block back
  and update the pinned commit above. Upstream moves fast: it was pushed the day it was
  vendored.
