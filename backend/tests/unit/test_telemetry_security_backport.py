"""Security and startup checks for the ADK 1-compatible parser backport."""

from __future__ import annotations

import subprocess
import sys
from importlib import import_module
from pathlib import Path

from scripts.backport_otel_tracestate import apply_backport, replace_installed_file


def test_backport_verification_is_idempotent():
    apply_backport(check_only=True)
    apply_backport()
    apply_backport(check_only=True)


def test_backport_does_not_modify_uv_cache_or_other_linked_environments(tmp_path: Path):
    cached = tmp_path / "cached.py"
    installed = tmp_path / "installed.py"
    cached.write_text("original")
    installed.hardlink_to(cached)
    replace_installed_file(installed, "security-patched")
    assert cached.read_text() == "original"
    assert installed.read_text() == "security-patched"


def test_audit_proof_rejects_an_image_without_the_backport(tmp_path: Path):
    import shutil

    backend = tmp_path / "backend"
    scripts = backend / "scripts"
    scripts.mkdir(parents=True)
    source = Path(__file__).resolve().parents[2] / "scripts" / "backport_otel_tracestate.py"
    shutil.copyfile(source, scripts / source.name)
    (backend / "uv.lock").write_text(
        '[[package]]\nname="google-adk"\nversion="1.31.1"\n[[package]]\nname="opentelemetry-api"\nversion="1.38.0"\n'
    )
    (backend / "Dockerfile").write_text("RUN uv sync --frozen --no-install-project\n")
    result = subprocess.run(
        [sys.executable, str(scripts / source.name), "--verify-build"], capture_output=True, text=True, timeout=5
    )
    assert result.returncode != 0
    assert "Docker build does not apply" in result.stderr


def test_oversized_tracestate_is_discarded_without_blocking_the_worker():
    # A subprocess deadline makes a vulnerable parser fail rather than hanging
    # the test worker. Exercise the real inbound propagator, not a version check.
    subprocess.run(
        [
            sys.executable,
            "-c",
            """
from opentelemetry.trace import get_current_span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
propagator = TraceContextTextMapPropagator()
parent = '00-' + '1' * 32 + '-' + '2' * 16 + '-01'
valid = propagator.extract({'traceparent': parent, 'tracestate': 'vendor=classroom'})
assert get_current_span(valid).get_span_context().trace_state['vendor'] == 'classroom'
hostile = propagator.extract({'traceparent': parent, 'tracestate': ' ' * 100_000 + 'vendor=classroom'})
span = get_current_span(hostile).get_span_context()
assert span.is_valid
assert len(span.trace_state) == 0
""",
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_adk_and_gcp_telemetry_import_with_the_patched_sdk():
    # ADK 1.x imports the removed OTel Events API. Cloud-only imports must also
    # work: LOCAL_MODE tests alone do not exercise the deployed telemetry path.
    for module in (
        "google.adk.telemetry.google_cloud",
        "google.adk.telemetry.setup",
        "opentelemetry.exporter.cloud_logging",
        "opentelemetry.exporter.cloud_monitoring",
        "opentelemetry.exporter.cloud_trace",
        "opentelemetry.instrumentation.google_genai",
    ):
        import_module(module)
