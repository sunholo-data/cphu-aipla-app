"""Unit tests for config.environment — runtime environment identity.

The regression these guard: a teacher minted group codes on dev and typed them
into test for two hours (2026-08-04), because the three deployments are
indistinguishable from their URLs. The UI now labels the environment, and the
label is only as good as this resolution.
"""

from __future__ import annotations

import pytest

from config.environment import KNOWN_ENVIRONMENTS, environment_info, environment_name

# Every env var that participates in resolution. Cleared before each test so a
# developer's real shell (or a previous test) can't leak in.
_ENV_VARS = ("AIPLA_ENV", "LOCAL_MODE", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "APP_VERSION")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)


@pytest.mark.parametrize(
    ("project", "expected"),
    [
        ("aipla-dev-2026", "dev"),
        ("aipla-test-2026", "test"),
        ("aipla-prod-2026", "prod"),
        # The year is a naming convention, not a version — a later project
        # must still resolve rather than falling back to "unknown".
        ("aipla-prod-2027", "prod"),
    ],
)
def test_env_derived_from_project_id(monkeypatch, project, expected):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", project)
    assert environment_name() == expected


def test_unrecognised_project_is_unknown_not_prod(monkeypatch):
    """An unrecognised deployment must NOT pass for production.

    "unknown" makes the banner render a cautious label; silently returning
    "prod" would hide the banner entirely — the exact failure this feature
    exists to prevent.
    """
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "some-other-project")
    assert environment_name() == "unknown"


def test_no_project_at_all_is_unknown():
    assert environment_name() == "unknown"


def test_explicit_override_wins(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "aipla-dev-2026")
    monkeypatch.setenv("AIPLA_ENV", "test")
    assert environment_name() == "test"


def test_bogus_override_is_ignored(monkeypatch):
    """A typo in AIPLA_ENV falls through to derivation rather than inventing
    an environment name the frontend has no label for."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "aipla-prod-2026")
    monkeypatch.setenv("AIPLA_ENV", "produciton")
    assert environment_name() == "prod"


def test_local_mode_wins_over_project(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "aipla-dev-2026")
    assert environment_name() == "local"


def test_environment_name_is_always_a_known_value(monkeypatch):
    for project in ("aipla-dev-2026", "aipla-test-2026", "aipla-prod-2026", "nonsense", ""):
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", project)
        assert environment_name() in KNOWN_ENVIRONMENTS


def test_info_carries_project_and_version(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "aipla-test-2026")
    monkeypatch.setenv("APP_VERSION", "v0.1.5")
    assert environment_info() == {
        "env": "test",
        "projectId": "aipla-test-2026",
        "version": "v0.1.5",
    }


def test_info_nulls_missing_fields_rather_than_empty_strings():
    info = environment_info()
    assert info["projectId"] is None
    assert info["version"] is None
