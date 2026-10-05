"""Who has acknowledged the teacher privacy notice? Read-only.

    make list-privacy-acks ENV=prod [VERSION=2026-10-05]

Prints one row per acknowledgement (email, version, server time), newest
first. The record exists so the programme can show KU legal that each teacher
was informed in writing — see db/privacy_ack.py.
"""

from __future__ import annotations

import argparse
import os

PROJECTS = {"dev": "aipla-dev-2026", "test": "aipla-test-2026", "prod": "aipla-prod-2026"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("env", choices=sorted(PROJECTS))
    parser.add_argument("--version", default=None, help="one notice version (default: all)")
    args = parser.parse_args()
    os.environ["GOOGLE_CLOUD_PROJECT"] = PROJECTS[args.env]

    from db.privacy_ack import PRIVACY_NOTICE_VERSION, list_acknowledgements

    rows = sorted(list_acknowledgements(args.version), key=lambda r: r.get("acknowledgedAt", ""), reverse=True)
    print(f"{args.env}: current notice version {PRIVACY_NOTICE_VERSION}; {len(rows)} acknowledgement(s)")
    for r in rows:
        print(f"  {r.get('acknowledgedAt', '?'):32}  v{r.get('version', '?'):12}  {r.get('email') or r.get('uid')}")


if __name__ == "__main__":
    main()
