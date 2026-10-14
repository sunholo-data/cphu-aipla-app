"""The vendored libraries a generated sim may load, as the model is told about them.

A tag the model copies with a stale hash is a blank frame (the browser refuses
the script) that every static gate passes. So every /vendor/ tag in the
authoring rules and every guide must match vendor.json exactly, and every guide
topic the tool advertises must exist.
"""

from __future__ import annotations

import asyncio
import json
import re

from adk import sim_author
from sim_gates import BACKEND_COPIES

TAG_RE = re.compile(r'<script src="(/vendor/[^"]+)"\s+integrity="sha384-([^"]+)"')


def _allowed() -> dict[str, str]:
    libs = json.loads((BACKEND_COPIES / "vendor.json").read_text())["libraries"]
    return {
        f"/vendor/{lib}/{e['version']}/{name}": spec["sha384"]
        for lib, e in libs.items()
        for name, spec in e.get("files", {}).items()
    }


def test_every_topic_reads_and_every_tag_matches_the_manifest():
    allowed = _allowed()
    seen = set()
    for topic in sim_author._REFERENCE_FILES:
        text = asyncio.run(sim_author.read_reference(topic))
        assert "Unknown topic" not in text and "sha384-HASH:" not in text, topic
        for path, digest in TAG_RE.findall(text):
            assert allowed.get(path) == digest, f"{topic}: {path} has a hash vendor.json does not"
            seen.add(path)
    # every library in the manifest is offered somewhere
    assert seen == set(allowed), f"not offered to the model: {sorted(set(allowed) - seen)}"


def test_the_tool_description_names_every_topic():
    doc = sim_author.read_reference.__doc__ or ""
    for topic in sim_author._REFERENCE_FILES:
        assert f"``{topic}``" in doc, topic
