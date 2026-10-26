"""One-shot model calls, on whichever provider the registry names.

Everything the platform asks a model OUTSIDE an agent turn — chat titles,
summaries, extraction, rubric scoring, report text — goes through
:func:`generate`. The caller says what the call is FOR (``purpose=``); the
model comes from models.yaml ``purposes`` and the provider from that model's
registry entry. Moving a purpose off Google is a config edit, not a code change.

Agent turns are not here: they go through ``adk.agent.resolve_model``, which
turns the same registry names into ADK models. Between them, those two are the
only places a model provider is chosen. ``scripts/check-direct-model-calls.py``
(``make check-model-calls``, CI) fails on a ``genai.Client`` call anywhere else.
"""

from llm.generate import Attachment, Generation, Turn, UnsupportedInputError, generate, generate_sync

__all__ = ["Attachment", "Generation", "Turn", "UnsupportedInputError", "generate", "generate_sync"]
