#!/usr/bin/env python3
"""Score a snapshot the way the published July 2026 numbers were scored.

  python3 score-snapshot.py [runs/stage2-2026-10]

TEXT   = correct / (correct + incorrect), declined answers excluded, over the
         33 July items (and, separately, all 44 incl. recovered.jsonl keys).
FIGURE = correct / all 8 items: a declined figure question counts as a miss.

Both verified 2026-10-05 by recomputing July's published table from its own
raw files (runs/stage2vision, runs/stage2vltext) — e.g. gemini-2.5-flash-lite
figures 40 ± 9, qwen3-vl-235b 95 ± 6. Reads only runs/ (gitignored).
"""

import glob
import json
import os
import re
import statistics as st
import sys

SNAP = sys.argv[1] if len(sys.argv) > 1 else "runs/stage2-2026-10"
JULY_REF = "runs/stage2vltext/qwen3-vl-235b-r1.jsonl"


def rows(f):
    return [json.loads(line) for line in open(f) if line.strip()]


def text_score(rs, ids):
    rs = [r for r in rs if ids is None or r["item_id"] in ids]
    c = sum(r["verdict"] == "correct" for r in rs)
    i = sum(r["verdict"] == "incorrect" for r in rs)
    return 100 * c / (c + i) if c + i else 0.0, len(rs) - c - i


def fig_score(rs):
    return 100 * sum(r["verdict"] == "correct" for r in rs) / len(rs), 0


def table(d, fn):
    out = {}
    for f in glob.glob(f"{d}/*-r*.jsonl"):
        out.setdefault(re.sub(r"-r\d+\.jsonl$", "", os.path.basename(f)), []).append(fn(rows(f)))
    return out


def show(title, t):
    print(f"\n## {title}\n\n| Model | Score (mean ± sd) | Declined / run | Clears 80% |\n|---|---|---|---|")
    for lab, v in sorted(t.items(), key=lambda kv: -st.mean(x[0] for x in kv[1])):
        s = [x[0] for x in v]
        m = st.mean(s)
        print(f"| {lab} | {m:.0f} ± {st.pstdev(s):.0f} | {st.mean(x[1] for x in v):.1f} | {'yes' if m >= 80 else 'no'} |")


july = {r["item_id"] for r in rows(JULY_REF)} if os.path.exists(JULY_REF) else None
show("Text — the 33 July items", table(f"{SNAP}/text", lambda rs: text_score(rs, july)))
show("Text — all 44 items", table(f"{SNAP}/text", lambda rs: text_score(rs, None)))
show("Figures — 8 items", table(f"{SNAP}/vision", fig_score))
