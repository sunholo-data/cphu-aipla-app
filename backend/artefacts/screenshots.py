"""Screenshots of the sims in the catalogue: the picker's thumbnail, and what the
activity co-pilot looks at when it plans a lesson around a sim.

- **Built-in** sims: ``backend/artefacts/screenshots/<id>-<shot>.png``, made by
  ``make sim-screenshots`` (the Sim workshop's own browser check).
- **Teacher** sims: frozen with the published version (``db.teacher_sims``).

Two shots: ``700`` (at rest, 700 px wide: the thumbnail) and ``driven`` (after
the browser check has clicked through it).
"""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from db.models.artefact import ArtefactMeta

logger = logging.getLogger(__name__)

SHOTS = ("700", "driven")
_DIR = Path(__file__).resolve().parent / "screenshots"


def builtin_screenshot_path(artefact_id: str, shot: str) -> Path | None:
    if shot not in SHOTS:
        return None
    path = _DIR / f"{artefact_id}-{shot}.png"
    return path if path.is_file() else None


def thumbnail_url(artefact_id: str) -> str:
    """Where the browser fetches a sim's thumbnail (teacher-authenticated)."""
    return f"/api/proxy/api/artefacts/{artefact_id}/screenshot/700"


def screenshot_png(meta: ArtefactMeta, shot: str) -> bytes | None:
    """The PNG for one shot of a catalogued sim, or None if there is none."""
    if shot not in SHOTS:
        return None
    if meta.source == "teacher":
        try:
            from db.teacher_sims import get_version_screenshot

            b64 = get_version_screenshot(meta.id, shot)
        except Exception:
            logger.warning("teacher sim %s: screenshot unreadable", meta.id, exc_info=True)
            return None
        return base64.b64decode(b64) if b64 else None
    path = builtin_screenshot_path(meta.id, shot)
    return path.read_bytes() if path else None
