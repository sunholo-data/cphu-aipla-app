"""Bounds on the DELEGATED register-write path (PROGADMIN-1 — 1.1.76).

Delegation is bounded in **amount** and in **audience**. Bounded only in amount,
a delegate could still admit anyone on the internet; bounded in both, they can
only admit people from the institutions the programme is actually for.

Every bound here is read from env **per environment**, so prod can be tighter
than dev, and none of them constrains the service-account path — M's door stays
unbounded on purpose (GRACEFUL DEGRADATION: if this design is wrong, the blast
radius is a bounded delegated grant, not the admin surface).

⚠️ These env vars must appear in **BOTH** ``cloudbuild.yaml`` AND
``cloudbuild.promote.yaml``. Prod is reached only by ``make promote``, and an
unset bound would read as "no ceiling" — this failure direction is OPEN. The
same omission has already bitten ``MCP_WIDGET_DOMAIN``, three feature flags, the
seed step and ``firestore.rules``.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

#: Ceiling on a cap a delegated admin may set, in USD/month. Deliberately low
#: and raisable: $50 covers the $25 the register actually uses and refuses the
#: $100 research-lead caps, which stay a service-account decision.
DEFAULT_MAX_CAP_USD = 50.0

#: The engagement boundary. A delegated grant may not outlive it, so forgetting
#: to clean up means access LAPSES rather than persists.
#:
#: 2027-09-15, the end of the 2026/27 Danish school year — NOT the original
#: 2026-09-15 contract date, which the 1.1.76 design doc still names because it
#: was written before the extension was awarded. The prod register was
#: re-stamped to this boundary on 2026-08-17.
DEFAULT_MAX_EXPIRY = "2027-09-15T00:00:00Z"


def max_cap_usd() -> float:
    """The delegated cap ceiling. Unparseable value ⇒ the default, logged.

    Never returns "no ceiling": an env var someone fat-fingered must not widen
    the bound it exists to impose.
    """
    raw = os.environ.get("PROGRAMME_ADMIN_MAX_CAP_USD", "").strip()
    if not raw:
        return DEFAULT_MAX_CAP_USD
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "programme_bounds: unparseable PROGRAMME_ADMIN_MAX_CAP_USD=%r; using %.2f",
            raw,
            DEFAULT_MAX_CAP_USD,
        )
        return DEFAULT_MAX_CAP_USD
    if value <= 0:
        logger.warning(
            "programme_bounds: PROGRAMME_ADMIN_MAX_CAP_USD=%r is not a positive ceiling; using %.2f",
            raw,
            DEFAULT_MAX_CAP_USD,
        )
        return DEFAULT_MAX_CAP_USD
    return value


def allowed_domains() -> frozenset[str]:
    """Domains a delegated admin may admit. **Empty means unrestricted.**

    Shipped empty by decision (2026-09-03), not by oversight. The design doc
    suggested ``ku.dk`` on prod; checked against the live prod register, ~20 of
    24 rows are Danish gymnasium domains (``toerring-gym.dk``, ``nrgym.dk``,
    ``vhim-gym.dk``, ``sag.dk``, ``ghg.dk``, ``birke-gym.dk``, ``frbgym.dk``,
    ``sctknud-gym.dk``, ``o365.favrskov-gym.dk``) or deliberate Gmail aliases
    for teachers on Microsoft tenants. A ``ku.dk`` allowlist would refuse almost
    every real teacher in the pilot.

    So: ship the mechanism, default it open, tighten when there is a reason.
    """
    raw = os.environ.get("PROGRAMME_ADMIN_EMAIL_DOMAINS", "")
    return frozenset(d.strip().lower().lstrip("@") for d in raw.split(",") if d.strip())


def max_expiry() -> str:
    """Latest expiry a delegated grant may carry. Delegation cannot outlive the
    engagement."""
    return os.environ.get("PROGRAMME_ADMIN_MAX_EXPIRY", "").strip() or DEFAULT_MAX_EXPIRY


def domain_of(email: str) -> str:
    return email.rsplit("@", 1)[1].lower() if "@" in email else ""


def is_domain_allowed(email: str) -> bool:
    """True when the audience bound permits this address (or is unset)."""
    domains = allowed_domains()
    if not domains:
        return True
    return domain_of(email) in domains
