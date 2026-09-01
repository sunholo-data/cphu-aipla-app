# Scoping-site snapshot — the parts that are not published

**Taken:** 2026-09-01 · **Pinned to:** `sunholo-data/aipla` @ `c361ca0` (2026-07-17)
**Why:** P4.2 of the [handover maintainability audit](../v1.1.0-feedback/handover-maintainability-audit.md).

## The problem this solves

AIPLA design docs in this repo cited the scoping site through **`file:///Users/mark/Documents/clients/cph-uni/...`** links — 63 files' worth. Those resolve on exactly one laptop. To anyone else, including AD (who starts ~1 Oct with no in-person overlap with M), every ADR citation in every design doc was a dead link.

## What was done, and the split

The scoping site has two kinds of public content, and they get two different treatments — deliberately, because copying everything would create a second, staler copy of documents that are still being maintained.

| Kind | Treatment | Reason |
|---|---|---|
| The **10 rendered `.qmd` pages** (`index`, `about`, `strands`, `examples`, `timeline`, `architecture`, `evaluation`, `self-hosting`, `led-planck`, `kinebot`) | **Linked to the public site**, now `https://aipla.ku.dk/project/...` (see `CLAUDE.md` "How to cite the scoping site" for the per-page mapping; the old `sunholo.com/aipla` URLs still serve the retiring Quarto site until cutover completes) | They are published, actively maintained, and carry the ADRs. A copy here would go stale the first time an ADR is amended — and `CLAUDE.md` explicitly warns against restoring the scoping site wholesale into this repo |
| The **prototype briefs** under `strand-a-pedagogical-bot/prototypes/` | **Snapshotted here**, in `prototypes/` | They are git-tracked but **not** in the Quarto render whitelist, so they have no public URL. A snapshot is the only way to reach them |
| The **private dirs** (`briefs/`, `notes/`, `admin/`, `sources/`) | **Not copied, and never should be** | Gitignored in the scoping repo — they hold real names, raw correspondence and contract details. Citations to them have been converted to unlinked plain text naming the file |

## How the safety of this snapshot was established

Not by judgement about which files looked sensitive — by construction:

1. Everything here was read from `git ls-tree origin/main` in `sunholo-data/aipla`.
2. That repo's own `.gitignore` excludes `briefs/`, `notes/`, `admin/`, `sources/`, so **no private file is tracked** and none could be picked up by a glob.
3. Only `strand-a-pedagogical-bot/prototypes/*.md` was copied — a single explicit path, not a recursive sweep.

## Keeping it honest

This is a **pinned snapshot, not a mirror**. It does not update itself. It says which commit it came from so a reader can tell how old it is, and the live source is `https://github.com/sunholo-data/aipla`.

If a prototype brief matters enough to be re-read during handover, re-take the snapshot rather than trusting this copy. The `.qmd` links do not have this problem — they point at the live site.
