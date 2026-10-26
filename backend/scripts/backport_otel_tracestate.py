"""Backport OTel d5224bf to the ADK 1-compatible 1.38.0 API.

The upstream fix is in 1.45.1, whose removed Events API prevents an ADK 1
upgrade. Preserve all other API/SDK code. Unknown source bytes fail closed.
This temporary backport can be removed after the separate ADK 2 review.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

ORIGINALS = {
    "opentelemetry/trace/span.py": "e1021cd18b8fbe42ec57ccd6a15882a3e0e116385350ec35fca9a2a289a43ccc",
    "opentelemetry/trace/propagation/tracecontext.py": "7a7aeff08f7de76f6c41cbe892c72a7d9c98fd9e866e5815debd96fab8f12d30",
}


def replace_once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise RuntimeError(f"Unrecognized OTel source: {old[:70]}")
    return source.replace(old, new)


def patched_source(name: str, source: str) -> str:
    if name.endswith("span.py"):
        source = replace_once(
            source,
            '_delimiter_pattern = re.compile(r"[ \\t]*,[ \\t]*")\n_member_pattern = re.compile(f"({_KEY_FORMAT})(=)({_VALUE_FORMAT})[ \\t]*")',
            '_TRACECONTEXT_MAXIMUM_TRACESTATE_LENGTH = 8192\n_member_pattern = re.compile(f"({_KEY_FORMAT})=({_VALUE_FORMAT})")',
        )
        source = replace_once(
            source,
            "            members: typing.List[str] = re.split(_delimiter_pattern, header)\n            for member in members:",
            '            for member in header.split(","):\n                member = member.strip(" \\t")',
        )
        return replace_once(
            source,
            "                groups: typing.Tuple[str, ...] = match.groups()\n                key, _eq, value = groups",
            "                key, value = match.groups()",
        )
    source = replace_once(
        source,
        "from opentelemetry.trace.span import TraceState",
        "from opentelemetry.trace.span import (TraceState, _TRACECONTEXT_MAXIMUM_TRACESTATE_LENGTH)",
    )
    return replace_once(
        source,
        "        if tracestate_headers is None:\n            tracestate = None\n        else:",
        "        if tracestate_headers is None:\n            tracestate = None\n        elif (sum(map(len, tracestate_headers)) + len(tracestate_headers) - 1\n              > _TRACECONTEXT_MAXIMUM_TRACESTATE_LENGTH):\n            tracestate = None\n        else:",
    )


def replace_installed_file(file: Path, patched: str) -> None:
    # uv may hard-link installations to its wheel cache. An in-place write
    # would mutate the cache and unrelated environments; replace the inode.
    descriptor, name = tempfile.mkstemp(prefix=file.name + ".security-", dir=file.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w") as stream:
            stream.write(patched)
        temporary.chmod(file.stat().st_mode)
        temporary.replace(file)
    finally:
        temporary.unlink(missing_ok=True)


def apply_backport(*, check_only: bool = False) -> None:
    distribution = importlib.metadata.distribution("opentelemetry-api")
    version = tuple(int(v) for v in distribution.version.split("."))
    if version >= (1, 45, 1):
        return  # The modern dev branch already carries the upstream release.
    if version != (1, 38, 0):
        raise RuntimeError(f"Review backport for opentelemetry-api {distribution.version}")
    expected = json.loads(Path(__file__).with_name("otel_backport_hashes.json").read_text())
    for name, original_hash in ORIGINALS.items():
        file = Path(distribution.locate_file(name))
        source = file.read_text()
        digest = hashlib.sha256(source.encode()).hexdigest()
        if digest == expected[name]:
            continue
        if digest != original_hash:
            raise RuntimeError(f"Unknown or modified OTel source: {file}")
        if check_only:
            raise RuntimeError(f"Missing OTel security backport: {file}")
        patched = patched_source(name, source)
        if hashlib.sha256(patched.encode()).hexdigest() != expected[name]:
            raise RuntimeError(f"Unreviewed backport output: {file}")
        replace_installed_file(file, patched)


def verify_runtime() -> None:
    # Import only in a fresh child after patching, so stale imported classes
    # cannot make a broken installation appear safe. Keep a hard deadline.
    subprocess.run(
        [
            sys.executable,
            "-c",
            """
from opentelemetry.trace import get_current_span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.trace.span import TraceState
p = TraceContextTextMapPropagator()
parent = '00-' + '1' * 32 + '-' + '2' * 16 + '-01'
normal = get_current_span(p.extract({'traceparent': parent, 'tracestate': 'a=1, b=2'})).get_span_context()
assert normal.is_valid and normal.trace_state['b'] == '2'
for whitespace in [' ', '\\t']:
    span = get_current_span(p.extract({'traceparent': parent, 'tracestate': whitespace * 100_000 + 'a=1'})).get_span_context()
    assert span.is_valid and len(span.trace_state) == 0
    assert len(TraceState.from_header([whitespace * 100_000])) == 0
assert len(TraceState.from_header(['a=1,a=2'])) == 0
""",
        ],
        check=True,
        timeout=3,
        capture_output=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-build", action="store_true")
    args = parser.parse_args()
    if args.verify_build:
        backend = Path(__file__).resolve().parents[1]
        lock = tomllib.loads((backend / "uv.lock").read_text())
        versions = {p["name"]: p["version"] for p in lock["package"]}
        if versions.get("opentelemetry-api") != "1.38.0" or versions.get("google-adk") != "1.31.1":
            raise RuntimeError("This backport is reviewed only for the production ADK 1.31.1 / OTel 1.38.0 stack")
        docker = (backend / "Dockerfile").read_text()
        required = "RUN uv run --frozen python scripts/backport_otel_tracestate.py"
        if required not in docker or docker.index(required) < docker.index("RUN uv sync --frozen"):
            raise RuntimeError("Docker build does not apply the verified backport")
        if "python scripts/backport_otel_tracestate.py --check" not in docker:
            raise RuntimeError("Container startup does not verify the installed backport")
    apply_backport(check_only=args.check)
    verify_runtime()
    print("PASS verified OpenTelemetry tracestate security backport/runtime")
