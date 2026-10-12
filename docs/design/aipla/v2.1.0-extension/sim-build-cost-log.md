# Sim build cost log

What it cost an AI agent to build a sim, in time and tokens. This is evidence for
sizing the in-app path where teachers make their own simulations: how long a
build takes, how much model output it needs, and how much context it carries.

Measure each entry with `make session-cost` (`scripts/session_cost.py`). It reads
the Claude Code transcript from the user message that asked for the sim to the
commit that shipped it.

## Entries

| Date | Sim | Built with | Wall clock | API calls | Output tokens | Input tokens (fresh + cache write + cache read) | Mean context per call | Produced |
|---|---|---|---|---|---|---|---|---|
| 2026-10-12 | `otto-engine` + DA activity | Claude Code, Opus 5.5, `anatomy` + `mcp-app-artefact` skills | 20.4 min | 57 | 93,666 | 114 + 164,577 + 27,925,155 | ~493k | 1,208 source lines (model, geometry, page, build), a 187 KB artefact, the catalogue entry, an activity template with a 7-node concept map |
| 2026-10-12 | + EN twin activity | same session | +1.2 min (21.6 total) | +7 (64) | +5,140 (98,806) | 128 + 174,109 + 31,841,863 | ~500k | an English copy of the template, same concept-map ids |

## Reading the otto-engine numbers

- **Context is inflated.** The build ran at the end of a long session, so every
  call carried about 500k tokens of earlier work: the svg-illustrator build,
  vendoring anatomy, and a release. Cache reads (31.8M) are almost all that
  history. A fresh session would carry the two skills plus the files being built,
  likely under 100k per call, so its input would be roughly a fifth of this.
  Output tokens (about 99k) do not depend on the history, so they are the
  comparable figure.
- **Not included:** vendoring the anatomy kit, the deploy and promote (CI waits,
  about 1.5 h across dev, test and prod), and a later physics check of the
  model. The check found the ideal-cycle simplifications (instant combustion at
  TDC, valves switching exactly at the dead centres) and they were kept on
  purpose.
- **What the agent did:** 44 shell commands, 7 file writes, 5 reads and 2 skill
  loads. Every build was checked. Problems it found and fixed: the page was over
  the 200 KB cap, an unescaped `</script` broke it, text was below the 11 px
  floor, a whole piston hid the chamber, the gudgeon pin passed through the wall,
  and the exhaust crossed the cutaway.
- **A teacher's build is not this build.** This agent had full repo access, the
  vendored skills and a developer's toolchain (Node, the audits and a headless
  browser). A teacher today drafts a sim in another chat with
  `/sim-authoring-prompt.txt`, and a developer ports it. Treat these numbers as an
  upper bound for an expert agent's output, not as a teacher's time.
