"""``aiplatform curriculum`` — the A/B/C curriculum library (1.1.25 M5).

Subcommands:
    ingest  Upload a document into the library (AILANG Parse → ADK RAG corpus).
    list    Browse the library (ACL: shared + your own; filter by level/tag/subject/search).
    tag     Edit a doc's tags (--add/--remove deltas or --set) (1.1.58 M1).
    set     Set a doc's subject/folder facets (1.1.58 M2/M3).
    facets  List the distinct tags + subjects across your visible docs (1.1.58 M1/M2).
    folder  Manage folders (new / list) (1.1.58 M3).
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
@click.option("--topic", default=None, help="Free-text search (title + topic + summary + tags).")
@click.option("--tag", "tags", multiple=True, help="Filter by tag (repeatable — AND).")
@click.option("--subject", default=None, help="Filter by subject (exact).")
@click.option("--folder", "folder_id", default=None, help="Filter by folder id.")
@click.option("--scope", type=click.Choice(["shared", "mine"]), default=None, help="Limit to shared or your own.")
@click.pass_context
def list_curriculum(
    ctx: click.Context,
    level: str | None,
    topic: str | None,
    tags: tuple[str, ...],
    subject: str | None,
    folder_id: str | None,
    scope: str | None,
) -> None:
    """Browse the curriculum library (ACL: shared + your own)."""
    params: dict[str, object] = {
        k: v
        for k, v in (("level", level), ("topic", topic), ("subject", subject), ("folder", folder_id), ("scope", scope))
        if v
    }
    if tags:
        params["tags"] = list(tags)
    result = _client(ctx).get("/api/curriculum", params=params or None)
    click.echo(_json.dumps(result, indent=2))


@curriculum.command("set")
@click.argument("doc_id")
@click.option("--subject", default=None, help="Set the subject facet (empty string clears it).")
@click.option("--folder", "folder_id", default=None, help="File into a folder by id (empty string unfiles).")
@click.pass_context
def set_curriculum(ctx: click.Context, doc_id: str, subject: str | None, folder_id: str | None) -> None:
    """Set a doc's facet fields (--subject, --folder). Empty string clears each."""
    payload: dict[str, object] = {}
    if subject is not None:
        payload["subject"] = subject or None
    if folder_id is not None:
        payload["folderId"] = folder_id or None
    if not payload:
        raise click.UsageError("give --subject and/or --folder (use '' to clear)")
    result = _client(ctx).patch(f"/api/curriculum/{doc_id}", json=payload)
    click.echo(_json.dumps(result, indent=2))


@curriculum.group("folder")
def folder() -> None:
    """Curriculum folders (flat; ACL: shared + your own)."""


@folder.command("new")
@click.argument("name")
@click.option("--shared", is_flag=True, default=False, help="Create in the SHARED corpus (admin).")
@click.pass_context
def folder_new(ctx: click.Context, name: str, shared: bool) -> None:
    """Create a folder named NAME."""
    result = _client(ctx).post("/api/curriculum/folders", json={"name": name, "shared": shared})
    click.echo(_json.dumps(result, indent=2))


@folder.command("list")
@click.option("--scope", type=click.Choice(["shared", "mine"]), default=None, help="Limit to shared or your own.")
@click.pass_context
def folder_list(ctx: click.Context, scope: str | None) -> None:
    """List folders you can see, each with a live doc count."""
    params = {"scope": scope} if scope else None
    result = _client(ctx).get("/api/curriculum/folders", params=params)
    click.echo(_json.dumps(result, indent=2))


@curriculum.command("tag")
@click.argument("doc_id")
@click.option("--add", "add", multiple=True, help="Add a tag (repeatable).")
@click.option("--remove", "remove", multiple=True, help="Remove a tag (repeatable).")
@click.option("--set", "set_tags", multiple=True, help="Replace ALL tags with these (repeatable).")
@click.pass_context
def tag_curriculum(
    ctx: click.Context, doc_id: str, add: tuple[str, ...], remove: tuple[str, ...], set_tags: tuple[str, ...]
) -> None:
    """Edit a doc's tags. Use --add/--remove deltas, or --set to replace all.

    Deltas apply against the doc's current tags server-side (no read-modify-write
    race). Tags are normalised (lowercased, trimmed, de-duped) by the backend.
    """
    if set_tags and (add or remove):
        raise click.UsageError("use --set alone, or --add/--remove — not both")
    if not (set_tags or add or remove):
        raise click.UsageError("give --add, --remove, or --set")
    payload: dict[str, object] = {"tags": list(set_tags)} if set_tags else {}
    if add:
        payload["addTags"] = list(add)
    if remove:
        payload["removeTags"] = list(remove)
    result = _client(ctx).patch(f"/api/curriculum/{doc_id}", json=payload)
    click.echo(_json.dumps(result, indent=2))


@curriculum.command("facets")
@click.option("--scope", type=click.Choice(["shared", "mine"]), default=None, help="Limit to shared or your own.")
@click.pass_context
def facets_curriculum(ctx: click.Context, scope: str | None) -> None:
    """List the distinct tags across the docs you can see (facet chips)."""
    params = {"scope": scope} if scope else None
    result = _client(ctx).get("/api/curriculum/facets", params=params)
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


@curriculum.command("summarize")
@click.option("--doc-id", "doc_id", default=None, help="Summarise one doc by id.")
@click.option(
    "--all", "all_docs", is_flag=True, default=False, help="Summarise all your accessible docs (shared + own)."
)
@click.option("--force", is_flag=True, default=False, help="Regenerate even if a summary already exists.")
@click.pass_context
def summarize_curriculum(ctx: click.Context, doc_id: str | None, all_docs: bool, force: bool) -> None:
    """(Re)generate catalogue summaries (1.1.52) — the backfill for docs ingested
    before the summary field. Give --doc-id <id> or --all."""
    if not doc_id and not all_docs:
        raise click.UsageError("give --doc-id <id> or --all")
    payload: dict[str, object] = {"force": force}
    if doc_id:
        payload["docId"] = doc_id
    if all_docs:
        payload["all"] = True
    result = _client(ctx).post("/api/curriculum/summarize", json=payload)
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
