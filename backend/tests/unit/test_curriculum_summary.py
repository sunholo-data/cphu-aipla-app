"""Unit tests for the curriculum catalogue-summary helper (1.1.52).

The helper is best-effort: it must return "" (never raise) on blank input or any
failure, so a missing summary degrades gracefully to metadata-only selection and
never blocks ingest.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


async def test_summarise_blank_returns_empty():
    from tools.documents.ai_extract import summarise_curriculum_text

    assert await summarise_curriculum_text("   ") == ""
    assert await summarise_curriculum_text("") == ""


async def test_summarise_happy_path_strips_output_and_sends_text():
    from tools.documents import ai_extract

    fake_resp = SimpleNamespace(text="  Covers energy conservation for a B-level class.  ")
    fake_client = MagicMock()
    fake_client.aio.models.generate_content = AsyncMock(return_value=fake_resp)

    with patch("google.genai.Client", return_value=fake_client):
        out = await ai_extract.summarise_curriculum_text("A long physics text about energy conservation.")

    assert out == "Covers energy conservation for a B-level class."
    # the document text is passed to the model as the second content part
    contents = fake_client.aio.models.generate_content.call_args.kwargs["contents"]
    assert "energy conservation" in contents[1]


async def test_summarise_caps_input_length():
    from tools.documents import ai_extract

    fake_client = MagicMock()
    fake_client.aio.models.generate_content = AsyncMock(return_value=SimpleNamespace(text="ok"))
    with patch("google.genai.Client", return_value=fake_client):
        await ai_extract.summarise_curriculum_text("x" * 50_000)

    contents = fake_client.aio.models.generate_content.call_args.kwargs["contents"]
    assert len(contents[1]) == ai_extract._SUMMARY_INPUT_CAP


async def test_summarise_failure_returns_empty():
    # Any failure (no creds / network / API error) degrades to "" — never blocks ingest.
    from tools.documents import ai_extract

    with patch("google.genai.Client", side_effect=RuntimeError("no creds")):
        assert await ai_extract.summarise_curriculum_text("some text") == ""
