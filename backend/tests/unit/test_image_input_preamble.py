"""Unit tests for adk.multimodal.inject_image_input_preamble (1.1.7)."""

from __future__ import annotations

from adk.multimodal import _load_preamble, inject_image_input_preamble


def test_passthrough_when_multimodal_disabled():
    base = "You are a tutor."
    assert inject_image_input_preamble(base, False) == base


def test_appends_preamble_when_enabled():
    base = "You are a tutor."
    out = inject_image_input_preamble(base, True)
    assert out.startswith(base)
    assert len(out) > len(base)
    # the canonical guidance markers are present
    assert "Image input" in out
    assert "units loop" in out.lower()
    assert "Read it, don't solve it" in out


def test_preamble_file_loads_nonempty():
    assert _load_preamble().strip() != ""


def test_enabled_output_is_base_plus_blank_line_plus_preamble():
    base = "BODY"
    out = inject_image_input_preamble(base, True)
    assert out == f"{base}\n\n{_load_preamble()}"
