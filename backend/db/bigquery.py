"""Thin BigQuery query helper for the chat-log read path (SEQUENCE 1.2).

Region-pinned (ADR-007). Reads the **raw** sink tables
(``aipla_chat_turn`` / ``aipla_workbench_event``) directly via their
``jsonPayload`` columns — the flattened views are optional (terraform
``create_views``) and absent on dev's gcloud-provisioned dataset, so the
app never depends on them.

The client is lazily created and cached. Callers (e.g. ``summarize_session_bq``)
wrap calls in try/except so a missing table / no creds degrades to the
session-state fallback rather than erroring.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from config.gcp import resolve_gcp_project

log = logging.getLogger(__name__)

CHAT_LOGS_DATASET = "chat_logs"
CHAT_TURN_TABLE = "aipla_chat_turn"
WORKBENCH_EVENT_TABLE = "aipla_workbench_event"

# Dataset location — must match the dataset created by the chat-logs module /
# ensure_chat_logs() (ADR-007 europe-north1).
_LOCATION = "europe-north1"

_client: Any = None


def _get_client() -> Any:
    global _client
    if _client is None:
        from google.cloud import bigquery

        _client = bigquery.Client(project=resolve_gcp_project())
    return _client


def table_ref(table: str) -> str:
    """Fully-qualified, back-ticked table reference for ``table``."""
    return f"`{resolve_gcp_project()}.{CHAT_LOGS_DATASET}.{table}`"


def jsonpayload_columns(table: str) -> set[str]:
    """Return the set of ``jsonPayload.*`` subfield names that exist on
    ``table``'s BQ schema.

    The Cloud Logging → BigQuery sink only materialises a ``jsonPayload``
    subfield once a row has logged a NON-NULL value for it. So a field that
    is always null (e.g. ``model`` before model-logging landed) simply does
    not exist as a column, and ``SELECT jsonPayload.model`` raises a 400
    ``Field name model does not exist``. Callers building SQL over volatile
    log-sink schemas must consult this and reference only existing columns.

    Raises on BQ/credential errors — callers degrade. Result is not cached:
    the schema grows as new fields start logging, and the call is one cheap
    metadata RPC on an infrequently-hit path.
    """
    client = _get_client()
    tbl = client.get_table(f"{resolve_gcp_project()}.{CHAT_LOGS_DATASET}.{table}")
    for field in tbl.schema:
        if field.name == "jsonPayload" and field.fields:
            return {sub.name for sub in field.fields}
    return set()


def _warn_if_on_event_loop() -> None:
    """Log loudly when a query runs on the asyncio event loop's own thread.

    1.1.131 — ``run_query`` blocks until BigQuery answers (seconds, sometimes a
    minute). Called from an ``async def`` route without ``asyncio.to_thread`` it
    froze the only uvicorn worker on 2026-09-22 and stalled every student's
    tutor stream on the instance for 59 s. The query still runs — refusing would
    turn a slow dashboard into a broken one — but the log line names the caller
    so a missed offload shows up in Cloud Logging, not in a classroom.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return  # a worker thread or a script: fine
    import traceback

    caller = "".join(traceback.format_stack(limit=6)[:-2]).strip()
    log.error("bigquery.run_query on the event loop — offload with asyncio.to_thread (1.1.131)\n%s", caller)


def run_query(sql: str, params: dict[str, Any] | None = None) -> list[Any]:
    """Run a parameterised query and return the rows.

    Parameter values bind to BigQuery types by Python type:

    - ``str``           → ``ScalarQueryParameter(STRING)``
    - ``datetime``      → ``ScalarQueryParameter(TIMESTAMP)``
    - ``int``           → ``ScalarQueryParameter(INT64)``
    - ``list[str]``     → ``ArrayQueryParameter(STRING)``

    Anything else falls back to STRING via ``str()`` — preserves backward
    compat for callers passing pre-stringified values.

    Region-pinned (ADR-007). Raises on BQ errors — callers decide whether
    to fall back.
    """
    from datetime import datetime

    from google.cloud import bigquery

    _warn_if_on_event_loop()
    client = _get_client()
    qparams: list[Any] = []
    for name, value in (params or {}).items():
        if isinstance(value, datetime):
            qparams.append(bigquery.ScalarQueryParameter(name, "TIMESTAMP", value))
        elif isinstance(value, bool):
            qparams.append(bigquery.ScalarQueryParameter(name, "BOOL", value))
        elif isinstance(value, int):
            qparams.append(bigquery.ScalarQueryParameter(name, "INT64", value))
        elif isinstance(value, list):
            qparams.append(bigquery.ArrayQueryParameter(name, "STRING", [str(v) for v in value]))
        else:
            qparams.append(bigquery.ScalarQueryParameter(name, "STRING", str(value)))
    job_config = bigquery.QueryJobConfig(query_parameters=qparams)
    return list(client.query(sql, job_config=job_config, location=_LOCATION).result())


__all__ = [
    "CHAT_LOGS_DATASET",
    "CHAT_TURN_TABLE",
    "WORKBENCH_EVENT_TABLE",
    "jsonpayload_columns",
    "run_query",
    "table_ref",
]
