"""Routine events stay out of WARNING, and only the known SDK notice is filtered.

Prod logged ~530 WARNING lines a day that were not warnings: the doc loader's
"turn start" line for turns with no documents, and the Gemini SDK saying
automatic function calling is off (which ADK wants). Both buried real warnings.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest

from adk.callbacks import make_document_loader
from observability.telemetry import quiet_known_sdk_noise

AFC = (
    "Tools at indices [0] are not compatible with automatic function calling (AFC). AFC is disabled. "
    "If AFC is intended, please include python callables in the tool list."
)


def _emit(logger: logging.Logger, msg: str) -> logging.LogRecord:
    return logger.makeRecord(logger.name, logging.WARNING, __file__, 1, msg, (), None)


def test_the_afc_notice_is_dropped_and_other_sdk_warnings_are_kept() -> None:
    quiet_known_sdk_noise()
    quiet_known_sdk_noise()  # idempotent: setup may run more than once
    sdk = logging.getLogger("google_genai.models")
    assert len(sdk.filters) == len({id(f) for f in sdk.filters})
    assert sum(1 for f in sdk.filters if type(f).__name__ == "_DropMessage") == 1

    assert not sdk.filter(_emit(sdk, AFC))
    assert sdk.filter(_emit(sdk, "Retrying after 429 RESOURCE_EXHAUSTED"))


@pytest.mark.asyncio
async def test_a_turn_with_no_documents_is_not_a_warning(caplog: pytest.LogCaptureFixture) -> None:
    ctx = MagicMock()
    ctx.state = {}
    with caplog.at_level(logging.DEBUG, logger="adk.callbacks.document"):
        await make_document_loader()(ctx)
    lines = [r for r in caplog.records if "turn start" in r.getMessage()]
    assert lines and all(r.levelno == logging.DEBUG for r in lines)


@pytest.mark.asyncio
async def test_a_turn_with_documents_is_still_logged_at_info(caplog: pytest.LogCaptureFixture) -> None:
    ctx = MagicMock()
    ctx.state = {"document_ids": []}
    ctx.state["docs_loaded"] = ["doc-gone"]

    async def _none(**_kw):
        return None

    ctx.load_artifact = _none
    with caplog.at_level(logging.DEBUG, logger="adk.callbacks.document"):
        await make_document_loader()(ctx)
    lines = [r for r in caplog.records if "turn start" in r.getMessage()]
    assert lines and all(r.levelno == logging.INFO for r in lines)
