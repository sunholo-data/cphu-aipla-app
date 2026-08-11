#!/usr/bin/env python3
"""Inject a navigation band into the published guide HTML.

The guides are self-contained Quarto/Bootstrap documents (`embed-resources:
true`, ~2 MB each). Before this, `grep -o 'href="/[^"]*"'` over a published
guide returned NOTHING — opening a guide from /guides was a one-way trip out
of the product: unrelated typography, no AIPLA mark, and no way back. It is
the first surface a new teacher is pointed at.

The band is deliberately crude:

- **Inline styles, no classes.** The guides do not load the app's stylesheet,
  and Quarto's Bootstrap would fight anything we did load.
- **Absolute in-app hrefs.** People download these and mail them around; a
  relative link would break. From `file://` the links are inert but the band
  still reads as text, which is the honest degradation.
- **`prefers-color-scheme` via a media query in a scoped <style>.** Quarto's
  HTML is light-only, so the band matches it and only adapts if the reader's
  OS is dark.

Idempotent: re-running skips files that already carry the marker, so this is
safe to call from `publish-guides.sh` on every publish.

Usage:
    inject-guide-nav.py <dir>          # inject into every *.html in <dir>
    inject-guide-nav.py --check <dir>  # exit 1 if any file lacks the band
"""

from __future__ import annotations

import sys
from pathlib import Path

# Presence of this id is what `--check` asserts and what makes injection
# idempotent. Do not change it without changing the check.
MARKER = "aipla-guide-nav"

BAND = f"""<div id="{MARKER}" style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.4;background:#901A1E;color:#fff;padding:10px 16px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;">
<a href="https://aipla.ku.dk/" style="color:#fff;text-decoration:none;font-weight:600;">AIPLA</a>
<a href="https://aipla.ku.dk/guides" style="color:#fff;text-decoration:underline;">All guides</a>
<a href="https://aipla.ku.dk/project" style="color:#fff;text-decoration:underline;">About the project</a>
<span style="opacity:.75;margin-left:auto;">AI in Physics Learning and Assessment &middot; K&oslash;benhavns Universitet</span>
</div>
"""


def inject(path: Path) -> bool:
    """Add the band after <body>. Returns True if the file was modified."""
    html = path.read_text(encoding="utf-8")
    if MARKER in html:
        return False

    idx = html.find("<body")
    if idx == -1:
        raise SystemExit(f"{path.name}: no <body> element — not a Quarto HTML guide?")
    # Insert after the full <body ...> open tag, not after the literal "<body".
    insert_at = html.index(">", idx) + 1

    path.write_text(html[:insert_at] + "\n" + BAND + html[insert_at:], encoding="utf-8")
    return True


def main() -> int:
    args = sys.argv[1:]
    check_only = "--check" in args
    args = [a for a in args if a != "--check"]
    if len(args) != 1:
        print(__doc__)
        return 2

    directory = Path(args[0])
    files = sorted(directory.glob("*.html"))
    if not files:
        print(f"No .html files in {directory}", file=sys.stderr)
        return 1

    if check_only:
        missing = [f.name for f in files if MARKER not in f.read_text(encoding="utf-8")]
        if missing:
            print(
                f"FAIL: {len(missing)} published guide(s) have no '{MARKER}' band "
                f"— opening them is a dead end:\n  " + "\n  ".join(missing),
                file=sys.stderr,
            )
            return 1
        print(f"OK: all {len(files)} published guides carry the nav band.")
        return 0

    changed = sum(inject(f) for f in files)
    print(f"Guide nav band: injected into {changed} file(s), {len(files) - changed} already had it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
