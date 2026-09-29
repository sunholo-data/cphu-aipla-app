"""A prod promote does not land in a lesson (1.1.138 M1).

`scripts/promote-env.sh … --to prod` refuses Mon–Fri 08:00–16:00
Europe/Copenhagen unless FORCE=1 / --force. Four prod promotes in the week of
21 Sep 2026 landed in school hours — one mid-lesson — and lined up with the
"the platform crashed, refreshing fixed it" reports.

These run the real script with a fake `gcloud` on PATH and `PROMOTE_NOW` pinned,
so nothing touches GCP and the verdict does not depend on when CI runs.
Design: docs/design/aipla/v1.1.0-feedback/no-crash-across-a-deploy.md
"""

from __future__ import annotations

import os
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "promote-env.sh"
CPH = ZoneInfo("Europe/Copenhagen")


def _epoch(local: str) -> str:
    return str(int(datetime.fromisoformat(local).replace(tzinfo=CPH).timestamp()))


@pytest.fixture
def fake_path(tmp_path: Path) -> str:
    gcloud = tmp_path / "gcloud"
    # Prints its arguments so a test can tell "submitted" from "refused". The
    # digest lookup is answered too, so a non-dry run reaches the submit.
    gcloud.write_text('#!/bin/sh\necho "FAKE-GCLOUD $*"\n')
    gcloud.chmod(0o755)
    # A fake `git` so the tag-on-origin check passes without a network.
    git = tmp_path / "git"
    git.write_text("#!/bin/sh\nexit 0\n")
    git.chmod(0o755)
    return f"{tmp_path}{os.pathsep}{os.environ.get('PATH', '')}"


def _run(fake_path: str, now: str, *args: str, force: str | None = None) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if k != "FORCE"}
    env.update(PATH=fake_path, PROMOTE_NOW=_epoch(now))
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


@pytest.mark.parametrize(
    "now",
    [
        "2026-09-22 12:12",  # the mid-lesson promote of 22 Sep (CEST)
        "2026-09-29 08:00",  # the first minute is inside
        "2026-12-01 15:59",  # winter time (CET), last minute inside
    ],
)
def test_prod_in_school_hours_is_refused(fake_path: str, now: str) -> None:
    r = _run(fake_path, now, "--from", "test", "--to", "prod", "--yes")
    assert r.returncode == 1
    assert "refusing to promote to prod" in r.stderr
    assert "FORCE=1" in r.stderr  # says how to override, not just "no"
    assert "FAKE-GCLOUD" not in r.stdout  # refused before anything ran


@pytest.mark.parametrize(
    "now",
    [
        "2026-09-29 16:00",  # 16:00 is outside
        "2026-09-29 07:59",
        "2026-10-03 11:00",  # Saturday
        "2026-10-04 10:00",  # Sunday
    ],
)
def test_prod_outside_school_hours_goes_ahead(fake_path: str, now: str) -> None:
    r = _run(fake_path, now, "--from", "test", "--to", "prod", "--yes")
    assert r.returncode == 0, r.stderr
    assert "triggers run aipla-prod-promote" in r.stdout
    assert "school hours" not in r.stdout


def test_force_env_overrides_and_says_so(fake_path: str) -> None:
    r = _run(fake_path, "2026-09-29 10:00", "--from", "test", "--to", "prod", "--yes", force="1")
    assert r.returncode == 0, r.stderr
    assert "FORCED" in r.stdout
    assert "triggers run aipla-prod-promote" in r.stdout


def test_force_flag_overrides(fake_path: str) -> None:
    r = _run(fake_path, "2026-09-29 10:00", "--from", "test", "--to", "prod", "--yes", "--force")
    assert r.returncode == 0, r.stderr
    assert "FORCED" in r.stdout


def test_dry_run_prints_plan_and_warning(fake_path: str) -> None:
    r = _run(fake_path, "2026-09-29 10:00", "--from", "test", "--to", "prod", "--dry-run")
    assert r.returncode == 0, r.stderr
    assert "build-once promotion plan" in r.stdout
    assert "WARNING" in r.stdout
    assert "would be REFUSED" in r.stdout
    assert "[dry-run] no mutation performed." in r.stdout


def test_test_env_is_never_gated(fake_path: str) -> None:
    r = _run(fake_path, "2026-09-29 10:00", "--from", "dev", "--to", "test", "--yes")
    assert r.returncode == 0, r.stderr
    assert "school hours" not in r.stdout


def test_bad_clock_override_is_an_error(fake_path: str) -> None:
    env = {**os.environ, "PATH": fake_path, "PROMOTE_NOW": "tuesday"}
    env.pop("FORCE", None)
    r = subprocess.run(
        ["bash", str(SCRIPT), "--from", "test", "--to", "prod", "--version", "v9.9.9", "--yes"],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
        check=False,
    )
    assert r.returncode != 0
    assert "PROMOTE_NOW" in r.stderr
