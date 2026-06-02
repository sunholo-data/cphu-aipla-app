"""Tests for analytics.summarise — the bounded-sample LLM paraphrase
pass for misconception/topic-cluster questions.

The Gemini call is mocked; tests cover the wrapping behavior:

- Bounded sample (MAX_SAMPLE_TURNS hard cap, no matter what the agent
  asks for).
- Group-code redaction BEFORE the LLM sees the content.
- Verbatim-substring defense (drop themes that quote ≥VERBATIM_THRESHOLD
  contiguous chars from the sampled turns).
- Authorization runs before any BQ / LLM call.

Integration with real Gemini lives under ``tests/integration/`` and is
marked ``@integration``.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from analytics import summarise
from analytics.auth import PERMISSION_ERROR_MESSAGE
from db import classes as classes_db
from db import firestore as fs_module
from db.models.class_ import Class


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    from auth.group_id_auth import AnonymousGroupAuth

    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _seed_class(owner_uid: str, *, group_codes: list[str] | None = None) -> Class:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name="Test Class")
    if group_codes:
        cls = cls.model_copy(update={"group_codes": group_codes})
    classes_db.create_class(cls)
    return cls


def _ctx(uid: str) -> MagicMock:
    ctx = MagicMock()
    ctx.state = {"user:id": uid}
    return ctx


def _gemini_returning(themes: list[dict]) -> AsyncMock:
    mock = AsyncMock()
    mock.return_value = json.dumps({"themes": themes})
    return mock


class TestAuthRunsBeforeSample:
    """If the caller doesn't own the class, neither BQ nor Gemini is
    called. Same load-bearing property as the other tools."""

    async def test_missing_class_refuses_without_bq_or_llm(self) -> None:
        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch("analytics.summarise._call_gemini") as mock_gemini,
        ):
            with pytest.raises(PermissionError) as exc:
                await summarise.summarise_chat_excerpts("does-not-exist", tool_context=_ctx("teacher-A"))
            assert str(exc.value) == PERMISSION_ERROR_MESSAGE
            mock_q.assert_not_called()
            mock_gemini.assert_not_called()

    async def test_unowned_class_refuses_without_bq_or_llm(self) -> None:
        cls_b = _seed_class("teacher-B", group_codes=["b-1"])
        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch("analytics.summarise._call_gemini") as mock_gemini,
        ):
            with pytest.raises(PermissionError):
                await summarise.summarise_chat_excerpts(cls_b.class_id, tool_context=_ctx("teacher-A"))
            mock_q.assert_not_called()
            mock_gemini.assert_not_called()


class TestSampleSizeCap:
    """The agent cannot exceed MAX_SAMPLE_TURNS no matter what it
    passes for ``sample_size``."""

    async def test_clamps_sample_size_to_max(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch("analytics.summarise._call_gemini", _gemini_returning([])),
        ):
            mock_q.return_value = []
            await summarise.summarise_chat_excerpts(
                cls.class_id,
                sample_size=99999,
                tool_context=_ctx("teacher-A"),
            )
            params = mock_q.call_args.kwargs["params"]
            assert params["sample_size"] == summarise.MAX_SAMPLE_TURNS

    async def test_uses_default_when_unset(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch("analytics.summarise._call_gemini", _gemini_returning([])),
        ):
            mock_q.return_value = []
            await summarise.summarise_chat_excerpts(cls.class_id, tool_context=_ctx("teacher-A"))
            params = mock_q.call_args.kwargs["params"]
            assert params["sample_size"] == summarise.DEFAULT_SAMPLE_SIZE


class TestGroupCodeRedaction:
    """Real group codes must never reach the LLM. The verifier here
    intercepts ``_call_gemini`` and inspects the prompt arg."""

    async def test_real_group_codes_not_in_llm_prompt(self) -> None:
        cls = _seed_class(
            "teacher-A",
            group_codes=["bold-kazoo-87", "led-fancy-12"],
        )
        sample_rows = [
            {"group_code": "bold-kazoo-87", "skill_id": "boldkast", "content": "Hi tutor"},
            {"group_code": "led-fancy-12", "skill_id": "led-planck", "content": "I am stuck"},
        ]
        captured: dict[str, str] = {}

        async def fake_gemini(prompt: str) -> str:
            captured["prompt"] = prompt
            return json.dumps({"themes": []})

        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch("analytics.summarise._call_gemini", side_effect=fake_gemini),
        ):
            mock_q.return_value = sample_rows
            await summarise.summarise_chat_excerpts(cls.class_id, tool_context=_ctx("teacher-A"))

        prompt = captured["prompt"]
        # Real group codes must NOT appear.
        assert "bold-kazoo-87" not in prompt
        assert "led-fancy-12" not in prompt
        # Placeholders must be present.
        assert "G1" in prompt
        assert "G2" in prompt


class TestVerbatimDefense:
    async def test_drops_themes_with_verbatim_substring_overlap(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        # A 60-char verbatim phrase from a sampled turn — well above
        # the VERBATIM_THRESHOLD of 40.
        sampled_content = "I think the projectile motion equation always gives the same answer no matter what"
        # 70 chars, verbatim substring (case-identical) of the sampled content.
        leaked_paraphrase = "the projectile motion equation always gives the same answer no matter"
        # Confirm test setup: the leaked paraphrase IS in the sampled content.
        assert leaked_paraphrase in sampled_content
        assert len(leaked_paraphrase) >= summarise.VERBATIM_THRESHOLD

        themes_from_llm = [
            {
                "theme": "Verbatim leak",
                "frequency": 1,
                "example_paraphrase": leaked_paraphrase,
            },
            {
                "theme": "Properly paraphrased",
                "frequency": 2,
                "example_paraphrase": "Students sometimes mistake the universality of the equation",
            },
        ]

        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch(
                "analytics.summarise._call_gemini",
                AsyncMock(return_value=json.dumps({"themes": themes_from_llm})),
            ),
        ):
            mock_q.return_value = [{"group_code": "a-1", "skill_id": "kinebot", "content": sampled_content}]
            result = await summarise.summarise_chat_excerpts(cls.class_id, tool_context=_ctx("teacher-A"))

        # The leak theme is dropped; the safe theme remains.
        kept = [t["theme"] for t in result["themes"]]
        assert "Properly paraphrased" in kept
        assert "Verbatim leak" not in kept

    async def test_short_paraphrase_below_threshold_is_kept(self) -> None:
        """If the overlap is shorter than VERBATIM_THRESHOLD the theme
        is kept — physics vocabulary like 'acceleration' overlapping is
        expected and benign."""
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        themes_from_llm = [
            {
                "theme": "Vocabulary recurrence",
                "frequency": 5,
                "example_paraphrase": "acceleration",  # 12 chars, below threshold
            },
        ]
        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch(
                "analytics.summarise._call_gemini",
                AsyncMock(return_value=json.dumps({"themes": themes_from_llm})),
            ),
        ):
            mock_q.return_value = [
                {
                    "group_code": "a-1",
                    "skill_id": "kinebot",
                    "content": "What is acceleration",
                }
            ]
            result = await summarise.summarise_chat_excerpts(cls.class_id, tool_context=_ctx("teacher-A"))
        assert len(result["themes"]) == 1


class TestEmptySampleShortCircuits:
    async def test_no_class_group_codes_returns_empty_without_llm(self) -> None:
        cls = _seed_class("teacher-A")  # no group_codes
        with patch("analytics.summarise._call_gemini") as mock_gemini:
            result = await summarise.summarise_chat_excerpts(cls.class_id, tool_context=_ctx("teacher-A"))
            assert result == {"themes": [], "sampled": 0}
            mock_gemini.assert_not_called()

    async def test_no_matching_turns_returns_empty_without_llm(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch("analytics.summarise._call_gemini") as mock_gemini,
        ):
            mock_q.return_value = []
            result = await summarise.summarise_chat_excerpts(cls.class_id, tool_context=_ctx("teacher-A"))
            assert result == {"themes": [], "sampled": 0}
            mock_gemini.assert_not_called()


class TestMalformedLLMResponse:
    async def test_non_json_response_returns_empty_themes(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with (
            patch("analytics.summarise.run_query") as mock_q,
            patch(
                "analytics.summarise._call_gemini",
                AsyncMock(return_value="Sure! Here are some themes... [not JSON]"),
            ),
        ):
            mock_q.return_value = [{"group_code": "a-1", "skill_id": "s", "content": "test turn content"}]
            result = await summarise.summarise_chat_excerpts(cls.class_id, tool_context=_ctx("teacher-A"))
            assert result["themes"] == []
            assert result["sampled"] == 1
