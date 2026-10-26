"""Platform seed for the in-product how-to guides (2026-10-26).

``make seed-guide-corpus ENV=<env>`` puts the guide PDFs into the SHARED
curriculum corpus (subject "AIPLA guides") and builds the "AIPLA onboarding"
class with teacher / student / researcher tutors grounded in them.

WHY THIS IS AN ADMIN PATH AND NOT A USER ONE
    Until now the script signed in as ``test-teacher@example.dk`` and called the
    teacher routes. Two gates added after the last successful prod seed
    (2026-08-05) refuse that, correctly: shared-library ingest is researcher-only
    and ingest is a paid call (``assert_can_spend``). The fix is not to make a
    convenience account with its password in the repo a researcher — researchers
    read every student conversation. The guides are platform content, so the
    platform seeds them: the caller is the env's runtime service account, gated
    by ``ADMIN_SEED_ALLOWED_SAS`` like every other ``/api/admin`` route.

OWNERSHIP — nobody's account
    * Guide docs: ``ownerScope="shared"`` (as before) and
      ``createdBy="platform-seed:guide-corpus"`` — an honest provenance value,
      not a fake user.
    * The onboarding class and its tutor activities: ``PLATFORM_OWNER_UID``, the
      same sentinel that owns the platform skills (``admin/platform_seed.py``).
      The class's ``tagNamespace`` is derived from it, and its group codes are
      minted with it as ``creator_uid``.
    * A class of the same name owned by a PERSON (the one the old script made as
      the test teacher) is reported as ``legacyClasses`` and never modified: its
      ``tagNamespace`` embeds that owner's uid, so it cannot be re-owned, and
      revoking it would break a join code someone may have handed out.

IDEMPOTENCY
    Guides are matched by title within the subject; ``sourceSha256`` (hash of
    the PDF bytes) tells an unchanged guide from a changed one. A second run over
    the same PDFs writes nothing. A changed PDF is ingested as a NEW doc and the
    old copies are deleted only once the new one is readable (``ragStatus`` ready)
    — the same "never take away a copy the tutor could read" rule as
    ``db/curriculum_reingest.py``. An unchanged guide whose RAG upload failed is
    re-ingested from its stored text (the teacher's *Prøv igen* path).

DRY RUN IS THE DEFAULT
    Both routes default ``dryRun`` to true; a caller has to say ``false`` to
    write. A dry run reads, hashes and reports — it never extracts text (a paid
    Gemini call) or touches the RAG corpus.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from db.activities import create_activity, list_activities_by_owner, save_activity
from db.classes import (
    add_activities,
    create_class,
    get_class,
    list_all_classes,
    list_classes_for_owner,
    mint_group_codes_under_class,
)
from db.curriculum import _load_shared, create_curriculum_doc, invalidate_shared_cache
from db.curriculum_reingest import NoStoredText, reingest_curriculum_doc
from db.models.activity import Activity
from db.models.activity_config import MaterialRef
from db.models.class_ import Class
from db.models.curriculum import SHARED_SCOPE, CurriculumDoc, normalize_tags
from protocols.activity_routes import ActivityUpsert, _activity_from_body
from protocols.curriculum_routes import extract_upload_text, remove_curriculum_doc, store_ingested_text
from skills.platform import PLATFORM_OWNER_UID
from skills.skill_config import list_skills

logger = logging.getLogger(__name__)

GUIDE_SUBJECT = "AIPLA guides"
SEED_PROVENANCE = "platform-seed:guide-corpus"
#: Every title the seed has ever written starts with this. Pruning is limited to
#: it (or to ``createdBy == SEED_PROVENANCE``) so a document a researcher filed
#: under the same subject by hand is never deleted by a seed run.
GUIDE_TITLE_PREFIX = "AIPLA guide — "
TUTOR_SKILL_NAME = "concept-dialogue"

Audience = Literal["teacher", "student", "researcher"]
DocAction = Literal["add", "replace", "reingest", "unchanged"]


def audience_tag(audience: str) -> str:
    """The tag that records which tutor cites a guide (``audience:teacher``)."""
    return f"audience:{audience}"


def _guide_tags(audience: str) -> list[str]:
    return normalize_tags(["onboarding", audience_tag(audience)])


def _is_seed_doc(doc: CurriculumDoc) -> bool:
    return doc.created_by == SEED_PROVENANCE or doc.title.startswith(GUIDE_TITLE_PREFIX)


def _guide_docs() -> list[CurriculumDoc]:
    """Every shared doc in the guide subject, read fresh (not from the TTL cache:
    another instance may have written since, and a stale read here would
    re-ingest or skip the wrong guide)."""
    invalidate_shared_cache()
    return [d for d in _load_shared() if d.owner_scope == SHARED_SCOPE and d.subject == GUIDE_SUBJECT]


def _newest_first(docs: list[CurriculumDoc]) -> list[CurriculumDoc]:
    return sorted(docs, key=lambda d: d.created_at or datetime.min.replace(tzinfo=UTC), reverse=True)


# ---------------------------------------------------------------------------
# Step 1 — one guide document
# ---------------------------------------------------------------------------


async def reconcile_guide_doc(
    *,
    data: bytes,
    filename: str,
    title: str,
    audience: Audience,
    dry_run: bool,
    caller: str,
) -> dict[str, Any]:
    """Make the corpus hold exactly one readable copy of this guide's bytes.

    Returns ``{title, action, docId, ragStatus, removed, kept, dryRun}``.
    ``action`` is what happened (or would): ``add`` (no copy yet), ``replace``
    (the bytes changed), ``reingest`` (same bytes, RAG upload had failed) or
    ``unchanged``. ``removed`` are stale copies deleted; ``kept`` are stale copies
    left because the new one is not readable yet.
    """
    sha = hashlib.sha256(data).hexdigest()
    existing = _newest_first([d for d in await asyncio.to_thread(_guide_docs) if d.title == title])
    same = [d for d in existing if d.source_sha256 == sha]
    tags = _guide_tags(audience)

    current: CurriculumDoc | None = same[0] if same else None
    stale = [d for d in existing if d is not current]

    if current is not None:
        action: DocAction = "unchanged" if current.rag_status == "ready" else "reingest"
    else:
        action = "replace" if existing else "add"

    if dry_run:
        # Predict the removal on the assumption that the write would succeed;
        # the real run only removes once the new copy is readable.
        return {
            "title": title,
            "action": action,
            "docId": current.doc_id if current else None,
            "ragStatus": current.rag_status if current else None,
            "removed": [d.doc_id for d in stale],
            "kept": [],
            "dryRun": True,
        }

    if current is not None and action == "reingest":
        try:
            current, _rag = await reingest_curriculum_doc(current)
        except NoStoredText:
            # Nothing stored to re-send: only a fresh upload can repair it.
            stale.append(current)
            current = None
            action = "replace"

    if current is None:
        text = await extract_upload_text(data, filename)
        current = await store_ingested_text(
            text,
            title=title,
            origin="AIPLA",
            # Guides are not levelled; "A" is what the seed has always written
            # (level was a required field when it was first seeded).
            level="A",
            topic="onboarding",
            tags=tags,
            subject=GUIDE_SUBJECT,
            folder_id=None,
            folder_name=None,
            shared=True,
            owner_scope=SHARED_SCOPE,
            copyright_status="cleared",
            created_by=SEED_PROVENANCE,
            source_sha256=sha,
        )
    elif current.tags != tags:
        # Same bytes, moved to another tutor's audience: retag in place.
        current.tags = tags
        create_curriculum_doc(current)

    removed: list[str] = []
    kept: list[str] = []
    for old in stale:
        # A stale copy the tutor can still read is only removed once the new one
        # is readable too — a failed upload must never leave the env with no guide.
        if current.rag_status != "ready" and old.rag_status == "ready":
            kept.append(old.doc_id)
            continue
        await remove_curriculum_doc(old)
        removed.append(old.doc_id)

    logger.info(
        "guide_corpus: %s %r -> %s rag=%s removed=%d kept=%d by %s",
        action,
        title,
        current.doc_id,
        current.rag_status,
        len(removed),
        len(kept),
        caller,
    )
    return {
        "title": title,
        "action": action,
        "docId": current.doc_id,
        "ragStatus": current.rag_status,
        "removed": removed,
        "kept": kept,
        "dryRun": False,
    }


# ---------------------------------------------------------------------------
# Step 2 — prune, class, tutors, join code
# ---------------------------------------------------------------------------


class TutorSpec(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    teaching_goal: str = Field(alias="teachingGoal", min_length=1, max_length=2000)
    audience: Audience
    language: Literal["da", "en"] = "en"

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class FinalizeRequest(BaseModel):
    """Body for ``POST /api/admin/guide-corpus/finalize``."""

    #: The guide titles this run seeded. With ``prune``, a seed-made guide doc
    #: whose title is not here is removed (an excluded / retired guide).
    titles: list[str] = Field(default_factory=list, max_length=100)
    #: Off when the caller seeded a SUBSET (``GUIDE_SLUGS``) — then the absent
    #: guides were simply not part of this run, not retired.
    prune: bool = False
    class_name: str = Field(default="AIPLA onboarding", alias="className", min_length=1, max_length=200)
    class_description: str = Field(
        default="How to use AIPLA — queryable guides for teachers and students.",
        alias="classDescription",
        max_length=2000,
    )
    tutors: list[TutorSpec] = Field(default_factory=list, max_length=10)
    dry_run: bool = Field(default=True, alias="dryRun")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


def _cited_docs(docs: list[CurriculumDoc], audience: str) -> list[CurriculumDoc]:
    """The guide docs a tutor for ``audience`` should cite: per title, the
    readable copies (or the newest one if none is readable yet), title-ordered
    so the materials list is stable run to run."""
    tag = audience_tag(audience)
    by_title: dict[str, list[CurriculumDoc]] = {}
    for d in docs:
        if tag in d.tags:
            by_title.setdefault(d.title, []).append(d)
    out: list[CurriculumDoc] = []
    for title in sorted(by_title):
        group = _newest_first(by_title[title])
        ready = [d for d in group if d.rag_status == "ready"]
        out.extend(ready or group[:1])
    return out


_CONTENT_EXCLUDE = {
    "activity_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "visibility",
    "last_edited_by",
    "source_activity_id",
    "source_owner_uid",
    "links",
}


def _same_content(a: Activity, b: Activity) -> bool:
    return a.model_dump(exclude=_CONTENT_EXCLUDE) == b.model_dump(exclude=_CONTENT_EXCLUDE)


async def finalize(body: FinalizeRequest, *, caller: str) -> dict[str, Any]:
    """Prune retired guides, then find-or-create the onboarding class, upsert
    its tutors (re-pointed at the current guide docs) and make sure it has a
    join code. Writes nothing when ``body.dry_run``."""
    report: dict[str, Any] = {"dryRun": body.dry_run, "ownerUid": PLATFORM_OWNER_UID}

    # Resolve the tutor skill FIRST: a run that cannot finish must not have
    # pruned anything on its way to finding that out.
    skill = await asyncio.to_thread(_tutor_skill)

    # --- prune ---------------------------------------------------------------
    docs = await asyncio.to_thread(_guide_docs)
    keep = set(body.titles)
    prunable = [d for d in docs if body.prune and d.title not in keep and _is_seed_doc(d)]
    report["pruned"] = [{"docId": d.doc_id, "title": d.title} for d in prunable]
    if not body.dry_run:
        for d in prunable:
            await remove_curriculum_doc(d)
    docs = [d for d in docs if d not in prunable]

    # The rest is synchronous Firestore work; keep it off the event loop
    # (uvicorn runs one worker — see the "Blocking I/O" footgun in CLAUDE.md).
    report.update(await asyncio.to_thread(_finalize_class_and_tutors, body, docs, skill))
    logger.info(
        "guide_corpus.finalize: dry=%s class=%s tutors=%s pruned=%d legacy=%d by %s",
        body.dry_run,
        report["class"],
        [(t["title"], t["action"]) for t in report["tutors"]],
        len(prunable),
        len(report["legacyClasses"]),
        caller,
    )
    return report


def _tutor_skill() -> Any:
    skill = next(
        (s for s in list_skills(owner_id=PLATFORM_OWNER_UID, limit=200) if s.name == TUTOR_SKILL_NAME),
        None,
    )
    if skill is None:
        raise LookupError(f"{TUTOR_SKILL_NAME} skill not seeded in this env — run `make seed-job ENV=<env>` first")
    return skill


def _finalize_class_and_tutors(body: FinalizeRequest, docs: list[CurriculumDoc], skill: Any) -> dict[str, Any]:
    dry = body.dry_run
    report: dict[str, Any] = {}

    # --- class ---------------------------------------------------------------
    cls: Class | None = next((c for c in list_classes_for_owner(PLATFORM_OWNER_UID) if c.name == body.class_name), None)
    report["legacyClasses"] = [
        {"classId": c.class_id, "ownerUid": c.owner_uid, "groupCodes": c.active_group_codes}
        for c in list_all_classes()
        if c.name == body.class_name and c.owner_uid != PLATFORM_OWNER_UID
    ]
    if cls is not None:
        report["class"] = {"action": "unchanged", "classId": cls.class_id}
    elif dry:
        report["class"] = {"action": "create", "classId": None}
    else:
        cls = Class.create_for_teacher(
            owner_uid=PLATFORM_OWNER_UID, name=body.class_name, description=body.class_description
        )
        create_class(cls)
        report["class"] = {"action": "create", "classId": cls.class_id}

    # --- tutors --------------------------------------------------------------
    by_title = {a.title: a for a in list_activities_by_owner(PLATFORM_OWNER_UID)}
    tutors: list[dict[str, Any]] = []
    for spec in body.tutors:
        cited = _cited_docs(docs, spec.audience)
        upsert = ActivityUpsert(
            skillId=skill.skill_id,
            classId=cls.class_id if cls else None,
            title=spec.title,
            teachingGoal=spec.teaching_goal,
            language=spec.language,
            materials=[
                MaterialRef(kind="curriculum", docId=d.doc_id, origin=d.origin, studentVisible=True) for d in cited
            ],
        )
        existing = by_title.get(spec.title)
        in_class = bool(cls and existing and existing.activity_id in cls.activity_ids)
        if existing is None:
            action = "create"
        else:
            desired = _activity_from_body(upsert, owner_uid=existing.owner_uid, activity_id=existing.activity_id)
            action = "unchanged" if _same_content(desired, existing) else "update"
        row: dict[str, Any] = {
            "title": spec.title,
            "action": action,
            "activityId": existing.activity_id if existing else None,
            "materials": [d.doc_id for d in cited],
            "assign": not in_class,
        }
        if not dry and cls is not None:
            if existing is None:
                created = create_activity(_activity_from_body(upsert, owner_uid=PLATFORM_OWNER_UID))
                row["activityId"] = created.activity_id
            elif action == "update":
                # Full replace, like PATCH /api/activities/{id}: identity,
                # provenance and visibility are preserved, content is the spec.
                updated = _activity_from_body(
                    upsert, owner_uid=existing.owner_uid, activity_id=existing.activity_id
                ).model_copy(
                    update={
                        "created_at": existing.created_at,
                        "source_activity_id": existing.source_activity_id,
                        "source_owner_uid": existing.source_owner_uid,
                        "visibility": existing.visibility,
                        "last_edited_by": existing.last_edited_by,
                    }
                )
                save_activity(updated)
            if not in_class:
                add_activities(cls.class_id, [row["activityId"]])
        tutors.append(row)
    report["tutors"] = tutors

    # --- join code -----------------------------------------------------------
    codes = cls.active_group_codes if cls else []
    if codes:
        report["groupCodes"] = {"action": "unchanged", "codes": codes}
    elif dry:
        report["groupCodes"] = {"action": "mint", "codes": []}
    else:
        assert cls is not None
        # Re-read: add_activities above changed the stored class.
        fresh = get_class(cls.class_id) or cls
        report["groupCodes"] = {"action": "mint", "codes": mint_group_codes_under_class(fresh.class_id, count=1)}
    return report
