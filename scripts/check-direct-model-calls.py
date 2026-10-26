#!/usr/bin/env python3
"""No backend code may call a model provider directly, outside the two routers.

WHY (2026-10-26)

AIPLA is moving model calls to UCloud AI (SDU, Denmark) purpose by purpose.
That only works if the choice of provider lives in ONE place. Before this
check, ten modules each built their own ``genai.Client(vertexai=True)`` with a
model looked up their own way, so "what still goes to Google?" could only be
answered by grepping, and every new feature added one more call that was
Gemini by construction.

Now there are two routers, both driven by backend/config/models.yaml:

- agent turns → ``adk.agent.resolve_model`` (ADK model objects)
- everything else → ``llm.generate(purpose=...)`` (backend/llm/)

So this fails on a ``genai.Client(...)`` call, or a ``litellm.completion`` /
``litellm.acompletion`` call, in any backend module outside ``backend/llm/``
and the allowlist below. It reads the AST, so a docstring or comment that
names ``genai.Client`` is not a call.

Fix a failure by calling ``llm.generate`` with a purpose (add the purpose to
``config.models.PURPOSES`` and models.yaml ``purposes`` if it is new). Only
add an allowlist entry for code that is deliberately not a text model call.

Usage:  python3 scripts/check-direct-model-calls.py [--root DIR]
Exit:   0 clean · 1 direct call found
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

#: Paths (relative to the backend root) allowed to call a provider directly.
ALLOWED: dict[str, str] = {
    "llm/": "the one-shot router itself",
    "voice/": "speech-to-text and text-to-speech — audio, not a text model; stays on Google by decision (2026-10-26)",
    "scripts/": "operator scripts and smoke tests, which probe a provider on purpose",
    "tests/": "tests fake the clients",
}

_LITELLM_CALLS = {"completion", "acompletion"}


def _violations(path: Path, rel: str) -> list[str]:
    try:
        tree = ast.parse(path.read_text(), filename=str(path))
    except SyntaxError as exc:
        return [f"{rel}:{exc.lineno}: could not parse ({exc.msg})"]
    found: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        owner = node.func.value
        if not isinstance(owner, ast.Name):
            continue
        if owner.id == "genai" and node.func.attr == "Client":
            found.append(f"{rel}:{node.lineno}: genai.Client(...)")
        elif owner.id == "litellm" and node.func.attr in _LITELLM_CALLS:
            found.append(f"{rel}:{node.lineno}: litellm.{node.func.attr}(...)")
    return found


def check(backend: Path) -> list[str]:
    found: list[str] = []
    for path in sorted(backend.rglob("*.py")):
        rel = path.relative_to(backend).as_posix()
        if rel.startswith((".venv/", "build/")) or any(rel.startswith(p) for p in ALLOWED):
            continue
        found += _violations(path, rel)
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=REPO / "backend", help="backend root to scan")
    args = parser.parse_args(argv)

    found = check(args.root)
    if found:
        print("Direct model-provider calls outside llm/ (call llm.generate(purpose=...) instead):")
        for line in found:
            print(f"  {line}")
        print("\nSee backend/llm/__init__.py and models.yaml `purposes`.")
        return 1
    print(f"OK: no direct model-provider calls outside {', '.join(ALLOWED)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
