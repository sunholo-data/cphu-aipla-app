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
    "run_query",
    "table_ref",
]
