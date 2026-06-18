"""Tests for `aiplatform deploy` (build-once artifact promotion)."""

from __future__ import annotations

import subprocess
from unittest.mock import patch

from click.testing import CliRunner

from aiplatform.cli import main


def _proc(returncode: int = 0, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


def test_deploy_group_registered() -> None:
    result = CliRunner().invoke(main, ["deploy", "--help"])
    assert result.exit_code == 0, result.output
    for sub in ("promote", "status", "release"):
        assert sub in result.output


@patch("aiplatform.commands.deploy.subprocess.run")
def test_promote_dry_run_passes_flags_to_script(mock_run) -> None:
    mock_run.return_value = _proc()
    result = CliRunner().invoke(
        main,
        ["deploy", "promote", "--from", "test", "--to", "prod", "--version", "v1.1.40", "--dry-run"],
    )
    assert result.exit_code == 0, result.output
    cmd = mock_run.call_args[0][0]
    assert cmd[0] == "bash"
    assert cmd[1].endswith("scripts/promote-env.sh")
    # The edge + version + dry-run flag are forwarded verbatim.
    assert cmd[2:] == ["--from", "test", "--to", "prod", "--version", "v1.1.40", "--dry-run"]


@patch("aiplatform.commands.deploy.subprocess.run")
def test_promote_nonzero_exit_surfaces_error(mock_run) -> None:
    mock_run.return_value = _proc(returncode=2)
    result = CliRunner().invoke(
        main,
        ["deploy", "promote", "--from", "test", "--to", "prod", "--version", "v1", "--yes"],
    )
    assert result.exit_code != 0
    assert "exited 2" in result.output


def test_promote_rejects_unknown_env() -> None:
    # `staging` is not in the --from choice set; Click rejects before any work.
    result = CliRunner().invoke(
        main,
        ["deploy", "promote", "--from", "staging", "--to", "prod", "--version", "v1"],
    )
    assert result.exit_code != 0


@patch("aiplatform.commands.deploy.subprocess.run")
def test_status_targets_right_project(mock_run) -> None:
    mock_run.return_value = _proc(stdout="aipla-v01-frontend-00369-2xs\tui:v1.1.40\n")
    result = CliRunner().invoke(main, ["deploy", "status", "--env", "test"])
    assert result.exit_code == 0, result.output
    cmd = mock_run.call_args[0][0]
    assert cmd[0] == "gcloud"
    assert "--project=aipla-test-2026" in cmd
    assert "--region=europe-north1" in cmd
    assert "test (aipla-test-2026)" in result.output


def test_release_requires_version() -> None:
    result = CliRunner().invoke(main, ["deploy", "release"])
    assert result.exit_code != 0
