"""What survives a compaction (ported from upstream COMPACTION-WIRE M2/M4).

Compaction is LOSSY AND IRREVERSIBLE: the summary REPLACES the raw turns in
every later model request and nothing can reach past it. So "what does the
summariser get to see" is a correctness property, not formatting.

Two defects in ADK's stock `LlmEventSummarizer` are pinned here. Both would
ship as NEW bugs the moment the wiring lets compaction fire:

1. It drops tool results. `_format_events_for_prompt` keeps only `part.text`,
   skipping `function_call` / `function_response`. On this platform the
   substance often IS the tool output — curriculum retrievals, calculator
   results, sim snapshots. A compacted tutoring conversation would summarise
   the chat *around* the work and discard the work.

2. It mutates a shared config. `_ensure_compaction_summarizer` assigns
   `config.summarizer` IN PLACE, and our configs are module-level singletons
   that `from_app` shallow-copies per request. The first skill to compact would
   pin its own model as the summarizer for every skill afterwards.
"""

from __future__ import annotations

from google.adk.events.event import Event
from google.genai import types

from adk.compaction_summarizer import (
    COMPACTION_EVENT_NAME,
    COMPACTION_STARTED_EVENT_NAME,
    FIDELITY_PROMPT_TEMPLATE,
    FidelityEventSummarizer,
    _truncate,
)


def _text_event(author: str, text: str) -> Event:
    return Event(author=author, content=types.Content(role=author, parts=[types.Part(text=text)]))


def _tool_call_event(author: str, name: str, args: dict) -> Event:
    part = types.Part(function_call=types.FunctionCall(name=name, args=args))
    return Event(author=author, content=types.Content(role="model", parts=[part]))


def _tool_result_event(name: str, response: dict) -> Event:
    part = types.Part(function_response=types.FunctionResponse(name=name, response=response))
    return Event(author="user", content=types.Content(role="user", parts=[part]))


class _FakeLlm:
    """Minimal stand-in — these tests are about what the summariser SEES."""

    model = "fake-model"


class TestToolResultsReachTheSummary:
    """Defect 1. The regression that matters most for a tutoring platform."""

    def test_tool_result_content_is_included(self):
        s = FidelityEventSummarizer(llm=_FakeLlm())
        events = [
            _text_event("user", "What does the curriculum say about energy conservation?"),
            _tool_call_event("model", "curriculum_search", {"query": "energy conservation"}),
            _tool_result_event(
                "curriculum_search",
                {
                    "passages": [
                        {"section": "4.2", "text": "Mechanical energy is conserved when only conservative forces act."}
                    ]
                },
            ),
            _text_event("model", "I found the relevant section."),
        ]
        out = s._format_events_for_prompt(events)

        # The finding itself, not merely that a tool ran.
        assert "4.2" in out, "section reference lost — this is the content the student came for"
        assert "conservative forces" in out, "passage text lost from the summariser's input"

    def test_tool_call_is_included(self):
        s = FidelityEventSummarizer(llm=_FakeLlm())
        out = s._format_events_for_prompt([_tool_call_event("model", "curriculum_search", {"query": "kinematics"})])
        assert "curriculum_search" in out
        assert "kinematics" in out

    def test_stock_adk_summarizer_would_have_dropped_it(self):
        """Anti-vacuity: prove the fixture actually exercises the defect.

        If ADK's base implementation also passed this, the override would be
        pointless and these tests would be asserting nothing.
        """
        from google.adk.apps.llm_event_summarizer import LlmEventSummarizer

        events = [
            _tool_result_event("curriculum_search", {"passages": [{"section": "4.2"}]}),
        ]
        stock = LlmEventSummarizer(llm=_FakeLlm())._format_events_for_prompt(events)
        ours = FidelityEventSummarizer(llm=_FakeLlm())._format_events_for_prompt(events)
        assert "4.2" not in stock, "ADK's stock summarizer unexpectedly kept the tool result"
        assert "4.2" in ours

    def test_thoughts_are_excluded(self):
        """Reasoning is not conversation.

        Thought parts are already excluded from request contents, the user never
        saw them, and no later turn can refer back to them — so spending summary
        budget on them would crowd out facts that matter.
        """
        s = FidelityEventSummarizer(llm=_FakeLlm())
        ev = Event(
            author="model",
            content=types.Content(
                role="model",
                parts=[types.Part(text="internal musing", thought=True), types.Part(text="visible answer")],
            ),
        )
        out = s._format_events_for_prompt([ev])
        assert "visible answer" in out
        assert "internal musing" not in out

    def test_text_turns_still_survive(self):
        """Guards against fixing tools by breaking the ordinary path."""
        s = FidelityEventSummarizer(llm=_FakeLlm())
        out = s._format_events_for_prompt(
            [_text_event("user", "problem 3.14 from the set"), _text_event("model", "noted")]
        )
        assert "3.14" in out
        assert "noted" in out


class TestTruncationIsHonest:
    def test_large_payload_is_capped(self):
        assert len(_truncate("x" * 100_000)) < 100_000

    def test_truncation_says_so(self):
        """A silent cut would let the summariser treat a partial result as the
        whole finding and state it with unearned confidence."""
        out = _truncate("x" * 100_000)
        assert "truncated" in out.lower()

    def test_small_payload_is_untouched(self):
        assert _truncate("short") == "short"


class TestPromptPreservesSpecifics:
    def test_prompt_demands_verbatim_specifics(self):
        """ADK's default asks for something 'concise' capturing 'the essence' —
        exactly wrong for physics tutoring, where a paraphrased numeric result
        is indistinguishable from one that was never computed."""
        p = FIDELITY_PROMPT_TEMPLATE.lower()
        assert "{conversation_history}" in FIDELITY_PROMPT_TEMPLATE, "ADK formats this placeholder"
        for demand in ("verbatim", "number", "unit", "formula", "date"):
            assert demand in p, f"prompt does not ask to preserve {demand}s"

    def test_prompt_warns_the_originals_are_gone(self):
        assert "replaces" in FIDELITY_PROMPT_TEMPLATE.lower()

    def test_prompt_preserves_student_reasoning_and_corrections(self):
        """The pedagogical content: what the student worked through and where
        they went wrong is the material the tutor must be able to build on."""
        p = FIDELITY_PROMPT_TEMPLATE.lower()
        assert "misconception" in p
        assert "correction" in p

    def test_prompt_distinguishes_findings_from_environment_state(self):
        """Upstream's measured defect (findings log §3.1).

        Their v1 said only "carry tool results across". Over a 5-compaction
        session EVERY summary then reproduced a 20-document directory listing —
        because a `list_documents` result IS a tool result. It is not a FINDING
        though: it is environment state the tool re-fetches on demand, and
        copying it forward crowds out the actual work.
        """
        p = FIDELITY_PROMPT_TEMPLATE.lower()
        assert "finding" in p and "environment" in p, "prompt does not draw the distinction at all"
        assert "do not reproduce" in p or "never reproduce" in p, (
            "prompt does not tell the summariser to leave environment state out"
        )

    def test_prompt_forbids_opaque_identifiers(self):
        """Opaque ids are backend addressing.

        Upstream measured 20 raw `[ref: <uuid>]` handles in every summary,
        baked into context the model re-reads on every subsequent turn. AIs
        hallucinate and transform exactly these.
        """
        p = FIDELITY_PROMPT_TEMPLATE.lower()
        assert "uuid" in p, "prompt does not name UUIDs as something to drop"
        assert "[ref:" in p, "prompt does not name the [ref: …] handle form"
        for term in ("opaque", "human name"):
            assert term in p, f"prompt lacks {term!r} guidance on identifiers"

    def test_prompt_demands_the_domain_references(self):
        """Scoped to identifiers a human would recognise — problem numbers and
        activity names, not system ids."""
        assert "problem numbers" in FIDELITY_PROMPT_TEMPLATE
        assert "activity names" in FIDELITY_PROMPT_TEMPLATE

    def test_built_summarizer_actually_uses_our_prompt(self):
        """The assertion upstream's first cut was missing.

        Asserting on the CONSTANT proves nothing: `LlmEventSummarizer.__init__`
        falls back to ADK's own template when `prompt_template` is omitted, so
        the summarizer would fix tool visibility while quietly keeping the
        prompt that paraphrases away the specifics. Assert on the object, not
        the module constant.
        """
        s = FidelityEventSummarizer(llm=_FakeLlm(), prompt_template=FIDELITY_PROMPT_TEMPLATE)
        assert s._prompt_template == FIDELITY_PROMPT_TEMPLATE

    def test_the_factory_wires_the_prompt_through(self, monkeypatch):
        """Same check on the real factory — the path production uses."""
        import adk.compaction_summarizer as mod

        monkeypatch.setattr("adk.agent.resolve_model", lambda _api_name: _FakeLlm())
        built = mod.build_compaction_summarizer()
        assert built is not None
        assert built._prompt_template == FIDELITY_PROMPT_TEMPLATE, (
            "build_compaction_summarizer dropped the prompt; the summarizer would "
            "silently use ADK's paraphrasing default"
        )


class TestSharedConfigIsNeverMutated:
    """Defect 2 — upstream verified at runtime before the fix: the mutation
    leaked into later callers AND into `app.events_compaction_config`."""

    def test_each_call_returns_a_distinct_config(self):
        from adk.session import get_compaction_config

        a = get_compaction_config("gemini-2.5-flash")
        b = get_compaction_config("gemini-2.5-flash")
        assert a is not b, (
            "get_compaction_config handed out the shared singleton; ADK's "
            "_ensure_compaction_summarizer would mutate it in place and pin the "
            "first compacting skill's model for every skill afterwards"
        )

    def test_mutating_a_returned_config_does_not_leak(self):
        from adk.session import get_compaction_config

        first = get_compaction_config("gemini-2.5-flash")
        first.summarizer = "PINNED_BY_FIRST_SKILL"
        assert get_compaction_config("gemini-2.5-flash").summarizer != "PINNED_BY_FIRST_SKILL"

    def test_mutation_does_not_reach_the_app(self):
        import app as app_mod
        from adk.session import get_compaction_config

        get_compaction_config("gemini-2.5-flash").summarizer = "PINNED_BY_FIRST_SKILL"
        assert app_mod.app.events_compaction_config.summarizer != "PINNED_BY_FIRST_SKILL"

    def test_config_carries_an_explicit_summarizer(self):
        """Setting it ourselves makes ADK's mutating branch return early —
        the structural fix, not just a defensive copy."""
        from adk.session import get_compaction_config

        assert get_compaction_config("gemini-2.5-flash").summarizer is not None

    def test_tuning_values_survive_the_copy(self):
        from adk.session import get_compaction_config

        cfg = get_compaction_config("gemini-2.5-flash")
        assert cfg.token_threshold == 250_000
        assert cfg.event_retention_size == 60
        assert cfg.compaction_interval == 40


class TestAnnouncement:
    """Compaction must announce itself (M4) — and announce EARLY (M2).

    The student keeps seeing a full transcript while the model sees a summary,
    so a degraded answer looks identical to a good one. The CUSTOM events are
    the only signal that it happened. METADATA ONLY on the wire — counts and
    timestamps, never summary text.
    """

    class _StubbedSummarizer(FidelityEventSummarizer):
        """Bypass the real LLM call: the base maybe_summarize_events is stubbed
        per-test via monkeypatch on the PARENT class."""

    async def test_announces_start_and_completion(self, monkeypatch):
        from google.adk.apps.llm_event_summarizer import LlmEventSummarizer

        from observability.timing import LatencyTracker, reset_current_tracker, set_current_tracker

        fake_compaction = type(
            "E",
            (),
            {
                "actions": type(
                    "A",
                    (),
                    {
                        "compaction": type(
                            "C",
                            (),
                            {
                                "compacted_content": types.Content(parts=[types.Part(text="summary text")]),
                                "start_timestamp": 1.0,
                                "end_timestamp": 2.0,
                            },
                        )()
                    },
                )()
            },
        )()

        async def _fake_super(self, *, events):
            return fake_compaction

        monkeypatch.setattr(LlmEventSummarizer, "maybe_summarize_events", _fake_super)

        tracker = LatencyTracker(skill_id="s", session_id="sess", user_id="u")
        token = set_current_tracker(tracker)
        try:
            s = FidelityEventSummarizer(llm=_FakeLlm())
            result = await s.maybe_summarize_events(events=[_text_event("user", "hi")] * 3)
        finally:
            reset_current_tracker(token)

        assert result is fake_compaction
        names = [e.name for e in tracker.drain_stage_events()]
        assert COMPACTION_STARTED_EVENT_NAME in names
        assert COMPACTION_EVENT_NAME in names

    async def test_metadata_only_never_summary_text(self, monkeypatch):
        from google.adk.apps.llm_event_summarizer import LlmEventSummarizer

        from observability.timing import LatencyTracker, reset_current_tracker, set_current_tracker

        secret = "the student admitted they cheated"
        fake_compaction = type(
            "E",
            (),
            {
                "actions": type(
                    "A",
                    (),
                    {
                        "compaction": type(
                            "C",
                            (),
                            {
                                "compacted_content": types.Content(parts=[types.Part(text=secret)]),
                                "start_timestamp": 1.0,
                                "end_timestamp": 2.0,
                            },
                        )()
                    },
                )()
            },
        )()

        async def _fake_super(self, *, events):
            return fake_compaction

        monkeypatch.setattr(LlmEventSummarizer, "maybe_summarize_events", _fake_super)

        tracker = LatencyTracker(skill_id="s", session_id="sess", user_id="u")
        token = set_current_tracker(tracker)
        try:
            await FidelityEventSummarizer(llm=_FakeLlm()).maybe_summarize_events(events=[_text_event("user", "hi")])
        finally:
            reset_current_tracker(token)

        for event in tracker.drain_stage_events():
            assert secret not in str(event.value), "summary content leaked onto the wire"
        # The metadata that IS allowed: length, not content.
        # (re-run to inspect the payload shape)

    async def test_no_op_compaction_is_not_announced_as_completed(self, monkeypatch):
        from google.adk.apps.llm_event_summarizer import LlmEventSummarizer

        from observability.timing import LatencyTracker, reset_current_tracker, set_current_tracker

        async def _fake_super(self, *, events):
            return None

        monkeypatch.setattr(LlmEventSummarizer, "maybe_summarize_events", _fake_super)

        tracker = LatencyTracker(skill_id="s", session_id="sess", user_id="u")
        token = set_current_tracker(tracker)
        try:
            result = await FidelityEventSummarizer(llm=_FakeLlm()).maybe_summarize_events(
                events=[_text_event("user", "hi")]
            )
        finally:
            reset_current_tracker(token)

        assert result is None
        names = [e.name for e in tracker.drain_stage_events()]
        # STARTED fires (the time is about to be spent); COMPLETED must not —
        # announcing a no-op would train people to ignore the marker.
        assert COMPACTION_STARTED_EVENT_NAME in names
        assert COMPACTION_EVENT_NAME not in names

    async def test_no_bound_tracker_is_survivable(self, monkeypatch):
        """Jobs, A2A and tests run without a bound tracker — the null tracker
        no-ops and the compaction itself must proceed."""
        from google.adk.apps.llm_event_summarizer import LlmEventSummarizer

        async def _fake_super(self, *, events):
            return None

        monkeypatch.setattr(LlmEventSummarizer, "maybe_summarize_events", _fake_super)
        result = await FidelityEventSummarizer(llm=_FakeLlm()).maybe_summarize_events(
            events=[_text_event("user", "hi")]
        )
        assert result is None  # and no exception


class TestFailureDegradesRatherThanBreaks:
    def test_unresolvable_model_returns_none(self, monkeypatch):
        """A deploy without the provider mounted must not break every turn once
        the threshold is crossed. ADK falls back to its own summarizer —
        worse, but working."""
        import adk.compaction_summarizer as mod

        def _boom(_api_name):
            raise RuntimeError("no such provider")

        monkeypatch.setattr("adk.agent.resolve_model", _boom)
        assert mod.build_compaction_summarizer() is None

    def test_config_still_usable_when_summarizer_is_none(self, monkeypatch):
        import adk.session as session_mod

        monkeypatch.setattr(session_mod, "_summarizer_built", True)
        monkeypatch.setattr(session_mod, "_summarizer_singleton", None)
        cfg = session_mod.get_compaction_config("gemini-2.5-flash")
        assert cfg.summarizer is None
        assert cfg.token_threshold == 250_000
