"""``aiplatform curriculum`` — the A/B/C curriculum library (1.1.25 M5).

Subcommands:
    ingest  Upload a document into the library (AILANG Parse → ADK RAG corpus).
    list    Browse the library (ACL: shared + your own).
    query   Test retrieval + provenance from the CLI (ops / eval parity).

Wraps ``/api/curriculum`` (M1 browse), ``/api/curriculum/ingest`` (M2), and
``/api/curriculum/query`` (M5). All routes are teacher-only — authenticate as a
teacher via the existing ``aiplatform auth`` token flow. Teacher uploads are
``teacher_owned`` (un-gated); shared ingestion requires ``--copyright cleared``.
"""

from __future__ import annotations

import json as _json
import os

import click

from aiplatform.http import AIPlatformClient

_LEVELS = ["A", "B", "C"]


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group(name="curriculum")
def curriculum() -> None:
    """A/B/C curriculum library (ingest / list / query)."""


@curriculum.command("ingest")
@click.argument("file_path", type=click.Path(exists=True, dir_okay=False, readable=True))
@click.option("--level", type=click.Choice(_LEVELS), required=True, help="Danish stx level (A/B/C).")
@click.option("--origin", required=True, help="Provenance for citation, e.g. 'uvm.dk' or 'Haka Fysik'.")
@click.option("--title", default=None, help="Display title. Defaults to the filename (sans extension).")
@click.option("--topic", default=None, help="Topic tag, e.g. 'mechanics'.")
@click.option("--shared", is_flag=True, default=False, help="Ingest into the SHARED corpus (admin).")
@click.option(
    "--copyright",
    "copyright_status",
    type=click.Choice(["teacher_owned", "cleared", "pending"]),
    default=None,
    help="Copyright status. Shared ingestion requires 'cleared'.",
)
@click.pass_context
def ingest_curriculum(
    ctx: click.Context,
    file_path: str,
    level: str,
    origin: str,
    title: str | None,
    topic: str | None,
    shared: bool,
    copyright_status: str | None,
) -> None:
    """Ingest FILE_PATH into the curriculum library + RAG corpus."""
    if title is None:
        base = os.path.basename(file_path)
        title = os.path.splitext(base)[0] or base
    data: dict[str, str] = {"title": title, "level": level, "origin": origin}
    if topic:
        data["topic"] = topic
    if shared:
        data["shared"] = "true"
    if copyright_status:
        data["copyright_status"] = copyright_status

    with open(file_path, "rb") as fh:
        files = {"file": (os.path.basename(file_path), fh)}
        result = _client(ctx).post("/api/curriculum/ingest", data=data, files=files)
    click.echo(_json.dumps(result, indent=2))


@curriculum.command("list")
@click.option("--level", type=click.Choice(_LEVELS), default=None, help="Filter by level.")
@click.option("--topic", default=None, help="Filter by topic.")
@click.option("--scope", type=click.Choice(["shared", "mine"]), default=None, help="Limit to shared or your own.")
@click.pass_context
def list_curriculum(ctx: click.Context, level: str | None, topic: str | None, scope: str | None) -> None:
    """Browse the curriculum library (ACL: shared + your own)."""
    params = {k: v for k, v in (("level", level), ("topic", topic), ("scope", scope)) if v}
    result = _client(ctx).get("/api/curriculum", params=params or None)
    click.echo(_json.dumps(result, indent=2))


@curriculum.command("query")
@click.argument("query_text")
@click.option("--level", type=click.Choice(_LEVELS), default=None, help="Scope retrieval to one level.")
@click.option("--topic", default=None, help="Scope retrieval to one topic.")
@click.option("--scope", type=click.Choice(["shared", "mine"]), default=None, help="Limit to shared or your own.")
@click.option("--top-k", "top_k", type=click.IntRange(1, 20), default=5, show_default=True, help="Max chunks.")
@click.pass_context
def query_curriculum(
    ctx: click.Context,
    query_text: str,
    level: str | None,
    topic: str | None,
    scope: str | None,
    top_k: int,
) -> None:
    """Test retrieval over your accessible corpus + show provenance."""
    payload: dict[str, object] = {"query": query_text, "topK": top_k}
    if level:
        payload["level"] = level
    if topic:
        payload["topic"] = topic
    if scope:
        payload["scope"] = scope
    result = _client(ctx).post("/api/curriculum/query", json=payload)
    click.echo(_json.dumps(result, indent=2))


@curriculum.command("delete")
@click.argument("doc_id")
@click.option("--yes", is_flag=True, default=False, help="Skip the confirmation prompt.")
@click.pass_context
def delete_curriculum(ctx: click.Context, doc_id: str, yes: bool) -> None:
    """Delete a doc (RAG file + parsed content + metadata) by DOC_ID.

    Teacher-only; deletes your own uploads or any shared-corpus doc.
    """
    if not yes:
        click.confirm(f"Delete curriculum doc {doc_id}? This removes its RAG file too.", abort=True)
    _client(ctx).delete(f"/api/curriculum/{doc_id}")
    click.echo(f"Deleted {doc_id}")


__all__ = ["curriculum"]
