"""Platform-owned skill sentinel.

Platform skills (default skills shipped by the platform and available to
every tenant) are stored in Firestore with `owner_id == PLATFORM_OWNER_UID`.
The sentinel is a string — not None — because:

1. Firestore queries on `ownerId` are strings; treating "no owner" as
   `None` would require a separate nullable schema and break the existing
   index.
2. `accessControl`-based visibility already distinguishes public from
   private; the sentinel is specifically about **mutation authority**,
   not visibility.
3. A non-UID string that cannot be a real Firebase uid (Firebase uids are
   28-char base64-ish) makes accidental match-by-collision impossible.

Forks override via the `PLATFORM_OWNER_UID` env var (e.g. AIPLA sets
`aipla-platform` so URLs read `/chat/@aipla-platform/<slug>` instead of
the inherited `@aitana-platform`). The default preserves upstream
template behaviour. Renaming requires coordinated updates across
Firestore rules, Cloud Build seed steps, and frontend URL builders;
the test `tests/unit/test_platform_sentinel.py` pins the default and
documents the override contract.
"""

import os

PLATFORM_OWNER_UID: str = os.environ.get("PLATFORM_OWNER_UID", "aitana-platform")
