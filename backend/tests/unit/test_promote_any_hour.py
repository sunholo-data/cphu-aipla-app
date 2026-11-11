"""A prod promote goes ahead at any hour.

The school-hours refusal (1.1.138 M1) was removed on 2026-11-11 at M's request.
What keeps a deploy from crashing open tabs is the stale-tab reload (1.1.138 M2
and M3), and M4 measured 0 unrecovered stale crashes in 21 days. These tests pin
that the refusal does not creep back, and that old command lines carrying
FORCE=1 / --force still run.

They run the real script with a fake `gcloud` and `git` on PATH, so nothing
touches GCP.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "promote-env.sh"


@pytest.fixture
def fake_path(tmp_path: Path) -> str:
    gcloud = tmp_path / "gcloud"
    gcloud.write_text('#!/bin/sh\necho "FAKE-GCLOUD $*"\n')
    gcloud.chmod(0o755)
    git = tmp_path / "git"
    git.write_text("#!/bin/sh\nexit 0\n")
    git.chmod(0o755)
    return f"{tmp_path}{os.pathsep}{os.environ.get('PATH', '')}"


def _run(fake_path: str, *args: str, force: str | None = None) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if k != "FORCE"}
    env["PATH"] = fake_path
    if force is not None:
        env["FORCE"] = force
    return subprocess.run(
        ["bash", str(SCRIPT), "--version", "v9.9.9", *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
        check=False,
    )


def test_prod_promote_is_never_refused_for_the_time_of_day(fake_path: str) -> None:
    r = _run(fake_path, "--from", "test", "--to", "prod", "--yes")
    assert r.returncode == 0, r.stderr
    assert "triggers run aipla-prod-promote" in r.stdout
    assert "school hours" not in (r.stdout + r.stderr).lower()


@pytest.mark.parametrize("how", ["env", "flag"])
def test_old_force_command_lines_still_run(fake_path: str, how: str) -> None:
    args = ["--from", "test", "--to", "prod", "--yes"]
    r = _run(fake_path, *args, "--force") if how == "flag" else _run(fake_path, *args, force="1")
    assert r.returncode == 0, r.stderr
    assert "triggers run aipla-prod-promote" in r.stdout


def test_dry_run_prints_the_plan_and_mutates_nothing(fake_path: str) -> None:
    r = _run(fake_path, "--from", "test", "--to", "prod", "--dry-run")
    assert r.returncode == 0, r.stderr
    assert "build-once promotion plan" in r.stdout
    assert "[dry-run] no mutation performed." in r.stdout


def test_illegal_edge_is_still_refused(fake_path: str) -> None:
    r = _run(fake_path, "--from", "dev", "--to", "prod", "--yes")
    assert r.returncode != 0
    assert "illegal promotion edge" in r.stderr
