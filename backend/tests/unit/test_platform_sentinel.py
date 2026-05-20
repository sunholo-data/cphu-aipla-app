"""Drift guard for the platform-owner sentinel UID.

The default string `"aitana-platform"` is referenced across Firestore
rules, Cloud Build seed steps, frontend UI copy, and backend guards. A
silent rename of the *default* would ship broken upstream-template
defaults to all forks.

Forks override via the `PLATFORM_OWNER_UID` env var. The test imports
the module fresh in a clean-env subprocess to assert the default, then
verifies the override path independently.
"""

import os
import subprocess
import sys


def test_sentinel_default_is_aitana_platform():
    """When no env var is set, the upstream-template default holds."""
    env = {k: v for k, v in os.environ.items() if k != "PLATFORM_OWNER_UID"}
    out = subprocess.check_output(
        [
            sys.executable,
            "-c",
            "from skills.platform import PLATFORM_OWNER_UID; print(PLATFORM_OWNER_UID)",
        ],
        env=env,
        text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    )
    assert out.strip() == "aitana-platform"


def test_sentinel_respects_env_override():
    """Forks (AIPLA, etc.) set PLATFORM_OWNER_UID to brand the platform-owner namespace."""
    env = {**os.environ, "PLATFORM_OWNER_UID": "aipla-platform"}
    out = subprocess.check_output(
        [
            sys.executable,
            "-c",
            "from skills.platform import PLATFORM_OWNER_UID; print(PLATFORM_OWNER_UID)",
        ],
        env=env,
        text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    )
    assert out.strip() == "aipla-platform"


def test_sentinel_is_string_not_none():
    from skills.platform import PLATFORM_OWNER_UID

    assert isinstance(PLATFORM_OWNER_UID, str)
    assert PLATFORM_OWNER_UID  # non-empty
