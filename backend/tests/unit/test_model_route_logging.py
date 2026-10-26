"""1.1.142 M4 — the chat-log row says WHY a reply ran on the smart tier.

`ResilientLlm` stamps `custom_metadata["model_route"]` (failover | escalation |
opt_in) beside `served_model`; the session callback must carry it to the row,
or the cost view's split reads every smart-tier turn as "not recorded".
"""

from __future__ import annotations

from types import SimpleNamespace

from adk.callbacks.session import _model_route
from adk.model_routing import MODEL_ROUTE_KEY


def test_route_is_read_from_the_stamp() -> None:
    for route in ("failover", "escalation", "opt_in"):
        event = SimpleNamespace(custom_metadata={MODEL_ROUTE_KEY: route, "served_model": "gemini-3.8-flash"})
        assert _model_route(event) == route


def test_no_stamp_is_the_default_route() -> None:
    assert _model_route(SimpleNamespace(custom_metadata=None)) is None
    assert _model_route(SimpleNamespace(custom_metadata={})) is None
    assert _model_route(SimpleNamespace()) is None
    assert _model_route(SimpleNamespace(custom_metadata={MODEL_ROUTE_KEY: ""})) is None


def test_the_key_the_callback_reads_is_the_key_the_router_writes() -> None:
    assert MODEL_ROUTE_KEY == "model_route"
