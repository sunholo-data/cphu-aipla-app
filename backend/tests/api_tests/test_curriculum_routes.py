"""Curriculum library M1 — browse ACL + CRUD filtering (mocked Firestore)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import db.curriculum as dbc
from auth import User, build_access_context, get_current_user
from db.models.curriculum import CurriculumDoc, CurriculumFolder
from protocols.curriculum_routes import router


@pytest.fixture(autouse=True)
def _reset_shared_cache():
    """1.1.59 — the shared-corpus cache is process-global; reset it around every
    test so one test's wired store can't leak into the next via a warm cache."""
    dbc.invalidate_shared_cache()
    yield
    dbc.invalidate_shared_cache()


TEACHER = "teacher-1"


def _doc(
    doc_id,
    level,
    owner,
    topic=None,
    source="teacher_upload",
    title=None,
    summary="",
    tags=None,
    subject=None,
    folder_id=None,
):
    now = datetime.now(UTC)
    return CurriculumDoc(
        docId=doc_id,
        title=title or f"Doc {doc_id}",
        level=level,
        topic=topic,
        summary=summary,
        tags=tags or [],
        subject=subject,
        folderId=folder_id,
        source=source,
        ownerScope=owner,
        origin="uvm.dk" if source == "shared" else "teacher",
        copyrightStatus="cleared" if source == "shared" else "teacher_owned",
        createdAt=now,
        updatedAt=now,
    )


def _wire_store(monkeypatch, shared, mine, folders=()):
    """Mock query_documents by ownerScope filter -> shared / teacher's docs.

    Collection-AWARE since 1.1.60: the facets endpoint also queries the folder
    collection, and a fixture that ignored `collection` fed curriculum docs into
    `CurriculumFolder.model_validate` and blew up. `folders` supplies the folder
    collection; it defaults to empty.
    """

    def fake_query(collection, filters=None):
        owner = filters[0][2] if filters else None
        src = folders if collection == "curriculum_folders" else (shared if owner == "shared" else mine)
        if owner not in ("shared", TEACHER):
            return []
        src = [f for f in src if f.owner_scope == owner] if collection == "curriculum_folders" else src
        return [d.model_dump(by_alias=True, mode="json") for d in src]

    monkeypatch.setattr(dbc, "query_documents", fake_query)


def _client(group_id=None):
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = (
            User(uid=TEACHER, email="t@x.dk", group_id=group_id)
            if group_id
            else User(uid=TEACHER, email="t@x.dk", is_teacher=True, access_tier="pilot")
        )
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


# --- CRUD/ACL lib ---


def test_list_returns_shared_union_own(monkeypatch):
    _wire_store(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[_doc("m1", "B", TEACHER)])
    out = dbc.list_curriculum_for_teacher(TEACHER)
    assert {d.doc_id for d in out} == {"s1", "m1"}


def test_scope_mine_excludes_shared(monkeypatch):
    _wire_store(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[_doc("m1", "B", TEACHER)])
    out = dbc.list_curriculum_for_teacher(TEACHER, scope="mine")
    assert {d.doc_id for d in out} == {"m1"}


def test_level_and_topic_filter(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("a", "A", TEACHER, topic="mechanics"), _doc("b", "B", TEACHER, topic="optics")],
    )
    out = dbc.list_curriculum_for_teacher(TEACHER, level="A")
    assert [d.doc_id for d in out] == ["a"]
    out2 = dbc.list_curriculum_for_teacher(TEACHER, topic="OPTICS")  # case-insensitive
    assert [d.doc_id for d in out2] == ["b"]


def test_search_matches_substring_and_title_and_summary(monkeypatch):
    # The "atomer returns nothing" bug: search must be a substring match across
    # title + topic + summary, not exact equality on `topic` alone.
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[
            _doc("t", "A", TEACHER, title="Atomer og molekyler"),  # title, topic=None
            _doc("k", "A", TEACHER, topic="Kernekemi"),  # substring, not exact
            _doc("s", "A", TEACHER, summary="Covers radioaktivt henfald"),  # summary
            _doc("x", "A", TEACHER, title="Optik", topic="lys"),  # no match
        ],
    )
    # Title-only, topic-less doc is now findable (was invisible before).
    assert [d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, topic="atom")] == ["t"]
    # Substring of topic, case-insensitive.
    assert [d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, topic="kerne")] == ["k"]
    # Summary text is searched.
    assert [d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, topic="henfald")] == ["s"]
    # No false positive.
    assert dbc.list_curriculum_for_teacher(TEACHER, topic="atom") != []
    assert "x" not in {d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, topic="atom")}


def test_search_multi_term_is_and(monkeypatch):
    # Every whitespace-separated term must appear (AND), so extra words narrow.
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[
            _doc("a", "A", TEACHER, title="Atomer", topic="kemi"),
            _doc("b", "A", TEACHER, title="Atomer", topic="fysik"),
        ],
    )
    assert [d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, topic="atom kemi")] == ["a"]
    assert {d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, topic="atom")} == {"a", "b"}


# --- 1.1.58 M1: tags (filter AND, search haystack, distinct facet) ---


def test_tags_filter_is_and_and_normalized(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[
            _doc("a", "A", TEACHER, tags=["lab", "exam"]),
            _doc("b", "A", TEACHER, tags=["lab"]),
            _doc("c", "A", TEACHER, tags=["exam"]),
        ],
    )
    # Single tag → all docs carrying it.
    assert {d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, tags=["lab"])} == {"a", "b"}
    # Multiple tags → AND (only docs with EVERY tag). Query side is normalized too.
    assert [d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, tags=["LAB", " Exam "])] == ["a"]
    # No match.
    assert dbc.list_curriculum_for_teacher(TEACHER, tags=["missing"]) == []


def test_search_includes_tags_in_haystack(monkeypatch):
    _wire_store(monkeypatch, shared=[], mine=[_doc("a", "A", TEACHER, title="Worksheet", tags=["radioaktivitet"])])
    assert [d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, topic="radioakt")] == ["a"]


def test_distinct_tags_sorted_and_deduped(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[_doc("s", "A", "shared", source="shared", tags=["exam"])],
        mine=[_doc("m", "A", TEACHER, tags=["lab", "exam"])],
    )
    assert dbc.distinct_tags_for_teacher(TEACHER) == ["exam", "lab"]


# --- 1.1.58 M2: subject facet ---


def test_subject_filter_exact(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[
            _doc("a", "A", TEACHER, subject="Mekanik"),
            _doc("b", "A", TEACHER, subject="Bølger og optik"),
            _doc("c", "A", TEACHER, subject=None),
        ],
    )
    assert [d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, subject="Mekanik")] == ["a"]
    assert dbc.list_curriculum_for_teacher(TEACHER, subject="Kvantefysik") == []


def test_distinct_subjects_sorted(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[_doc("s", "A", "shared", source="shared", subject="Termodynamik")],
        mine=[_doc("m", "A", TEACHER, subject="Mekanik"), _doc("n", "A", TEACHER, subject=None)],
    )
    assert dbc.distinct_subjects_for_teacher(TEACHER) == ["Mekanik", "Termodynamik"]


def test_facets_returns_tags_and_subjects(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("m", "A", TEACHER, tags=["lab"], subject="Fysik")],
    )
    body = _client().get("/api/curriculum/facets").json()
    # 1.1.60 — {value, label, count} objects, not bare strings.
    assert body["tags"] == [{"value": "lab", "label": "lab", "count": 1}]
    assert body["subjects"] == [{"value": "Fysik", "label": "Fysik", "count": 1}]
    assert body["levels"] == [{"value": "A", "label": "A", "count": 1}]
    assert body["folders"] == [{"value": "__unfiled__", "label": "Unfiled", "count": 1}]


def test_browse_subject_facet_param(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("a", "A", TEACHER, subject="Optik"), _doc("b", "A", TEACHER, subject="Mekanik")],
    )
    resp = _client().get("/api/curriculum?subject=Optik")
    assert [d["docId"] for d in resp.json()["docs"]] == ["a"]


def test_patch_sets_and_clears_subject(monkeypatch):
    doc = _doc("m1", "A", TEACHER, subject="Mekanik")
    saved = _wire_patch(monkeypatch, doc)
    # Set a new subject (trimmed).
    resp = _client().patch("/api/curriculum/m1", json={"subject": "  Kvantefysik "})
    assert resp.status_code == 200, resp.text
    assert resp.json()["doc"]["subject"] == "Kvantefysik"
    # Explicit null clears it (presence detected via model_fields_set).
    resp2 = _client().patch("/api/curriculum/m1", json={"subject": None})
    assert resp2.status_code == 200
    assert resp2.json()["doc"]["subject"] is None
    assert saved[-1].subject is None


def test_patch_subject_and_tags_together(monkeypatch):
    doc = _doc("m1", "A", TEACHER, tags=["lab"], subject=None)
    _wire_patch(monkeypatch, doc)
    resp = _client().patch("/api/curriculum/m1", json={"addTags": ["exam"], "subject": "Mekanik"})
    assert resp.status_code == 200, resp.text
    body = resp.json()["doc"]
    assert set(body["tags"]) == {"lab", "exam"}
    assert body["subject"] == "Mekanik"


# --- 1.1.58 M3: folders ---


def _folder(fid, owner, name="Folder"):
    return CurriculumFolder(folderId=fid, name=name, ownerScope=owner, createdAt=datetime.now(UTC))


def _wire_full(monkeypatch, *, docs_shared=(), docs_mine=(), folders_shared=(), folders_mine=()):
    """Collection-aware query fake: dispatches curriculum_docs vs curriculum_folders."""

    def fake_query(collection, filters=None):
        owner = filters[0][2] if filters else None
        if collection == dbc._FOLDER_COLLECTION:
            src = folders_shared if owner == "shared" else (folders_mine if owner == TEACHER else [])
        else:
            src = docs_shared if owner == "shared" else (docs_mine if owner == TEACHER else [])
        return [x.model_dump(by_alias=True, mode="json") for x in src]

    monkeypatch.setattr(dbc, "query_documents", fake_query)


def test_list_folders_scoped_with_live_counts(monkeypatch):
    _wire_full(
        monkeypatch,
        docs_mine=[
            _doc("a", "A", TEACHER, folder_id="f1"),
            _doc("b", "A", TEACHER, folder_id="f1"),
            _doc("c", "A", TEACHER),
        ],
        folders_mine=[_folder("f1", TEACHER, "Kap 4")],
    )
    out = dbc.list_curriculum_folders_for_teacher(TEACHER)
    assert [(f.folder_id, f.doc_count) for f in out] == [("f1", 2)]  # 2 docs filed, count computed live


def test_folder_acl_excludes_other_teacher(monkeypatch):
    def fake_query(collection, filters=None):
        owner = filters[0][2] if filters else None
        if collection == dbc._FOLDER_COLLECTION and owner == "teacher-2":
            return [_folder("fx", "teacher-2").model_dump(by_alias=True, mode="json")]
        return []

    monkeypatch.setattr(dbc, "query_documents", fake_query)
    # TEACHER never queries teacher-2's scope → their private folder is invisible.
    assert dbc.list_curriculum_folders_for_teacher(TEACHER) == []


def test_create_folder_endpoint(monkeypatch):
    import protocols.curriculum_routes as cr

    saved: list = []
    monkeypatch.setattr(cr, "create_curriculum_folder", lambda f: saved.append(f))
    resp = _client().post("/api/curriculum/folders", json={"name": "Kap 4"})
    assert resp.status_code == 201, resp.text
    body = resp.json()["folder"]
    assert body["name"] == "Kap 4" and body["ownerScope"] == TEACHER
    assert saved[0].owner_scope == TEACHER


def test_create_shared_folder(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "create_curriculum_folder", lambda f: None)
    resp = _client().post("/api/curriculum/folders", json={"name": "Delt", "shared": True})
    assert resp.json()["folder"]["ownerScope"] == "shared"


def test_folders_student_forbidden():
    assert _client(group_id="g").get("/api/curriculum/folders").status_code == 403
    assert _client(group_id="g").post("/api/curriculum/folders", json={"name": "x"}).status_code == 403


def test_list_folders_endpoint(monkeypatch):
    _wire_full(
        monkeypatch,
        docs_mine=[_doc("a", "A", TEACHER, folder_id="f1")],
        folders_mine=[_folder("f1", TEACHER, "Kap 4")],
    )
    body = _client().get("/api/curriculum/folders").json()
    assert body["folders"][0]["name"] == "Kap 4"
    assert body["folders"][0]["docCount"] == 1


def test_patch_assigns_folder_same_scope(monkeypatch):
    import protocols.curriculum_routes as cr

    doc = _doc("m1", "A", TEACHER)
    _wire_patch(monkeypatch, doc)
    monkeypatch.setattr(
        cr, "get_curriculum_folder", lambda fid: _folder("f1", TEACHER, "Kap 4") if fid == "f1" else None
    )
    resp = _client().patch("/api/curriculum/m1", json={"folderId": "f1"})
    assert resp.status_code == 200, resp.text
    body = resp.json()["doc"]
    assert body["folderId"] == "f1" and body["folderName"] == "Kap 4"


def test_patch_folder_scope_mismatch_400(monkeypatch):
    import protocols.curriculum_routes as cr

    doc = _doc("m1", "A", TEACHER)  # owner TEACHER
    _wire_patch(monkeypatch, doc)
    monkeypatch.setattr(cr, "get_curriculum_folder", lambda fid: _folder("fS", "shared"))  # a SHARED folder
    resp = _client().patch("/api/curriculum/m1", json={"folderId": "fS"})
    assert resp.status_code == 400  # can't file a private doc into a shared folder


def test_patch_folder_not_found_404(monkeypatch):
    import protocols.curriculum_routes as cr

    _wire_patch(monkeypatch, _doc("m1", "A", TEACHER))
    monkeypatch.setattr(cr, "get_curriculum_folder", lambda fid: None)
    resp = _client().patch("/api/curriculum/m1", json={"folderId": "nope"})
    assert resp.status_code == 404


def test_patch_clears_folder(monkeypatch):
    doc = _doc("m1", "A", TEACHER, folder_id="f1")
    doc.folder_name = "Kap 4"
    saved = _wire_patch(monkeypatch, doc)
    resp = _client().patch("/api/curriculum/m1", json={"folderId": None})
    assert resp.status_code == 200
    assert resp.json()["doc"]["folderId"] is None
    assert saved[-1].folder_name is None


def test_browse_folder_facet_param(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("a", "A", TEACHER, folder_id="f1"), _doc("b", "A", TEACHER)],
    )
    resp = _client().get("/api/curriculum?folder=f1")
    assert [d["docId"] for d in resp.json()["docs"]] == ["a"]


def test_browse_unfiled_sentinel(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("a", "A", TEACHER, folder_id="f1"), _doc("b", "A", TEACHER)],
    )
    resp = _client().get("/api/curriculum?folder=__unfiled__")
    assert [d["docId"] for d in resp.json()["docs"]] == ["b"]  # only the folder-less doc


def test_delete_folder_unfiles_docs(monkeypatch):
    # Two docs filed into f1; deleting f1 clears their folder pointer and removes
    # the folder, but does NOT delete the docs.
    filed = [_doc("a", "A", TEACHER, folder_id="f1"), _doc("b", "A", TEACHER, folder_id="f1")]
    saved: list = []

    def fake_query(collection, filters=None):
        # The unfile step queries docs by folderId.
        if filters and filters[0][0] == "folderId":
            return [d.model_dump(by_alias=True, mode="json") for d in filed]
        return []

    monkeypatch.setattr(dbc, "query_documents", fake_query)
    monkeypatch.setattr(dbc, "set_document", lambda coll, _id, data: saved.append(CurriculumDoc.model_validate(data)))
    deleted: list = []
    monkeypatch.setattr(dbc, "delete_document", lambda coll, _id: deleted.append((coll, _id)))

    n = dbc.delete_curriculum_folder("f1")
    assert n == 2  # two docs unfiled
    assert all(d.folder_id is None and d.folder_name is None for d in saved)  # cleared
    assert (dbc._FOLDER_COLLECTION, "f1") in deleted  # folder row removed


def test_delete_folder_endpoint_own(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_folder", lambda fid: _folder("f1", TEACHER))
    monkeypatch.setattr(cr, "delete_curriculum_folder", lambda fid: 3)
    resp = _client().delete("/api/curriculum/folders/f1")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted": "f1", "unfiled": 3}


def test_delete_folder_shared_allowed(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_folder", lambda fid: _folder("fS", "shared"))
    monkeypatch.setattr(cr, "delete_curriculum_folder", lambda fid: 0)
    assert _client().delete("/api/curriculum/folders/fS").status_code == 200


def test_delete_other_teachers_folder_404(monkeypatch):
    import protocols.curriculum_routes as cr

    called: list = []
    monkeypatch.setattr(cr, "get_curriculum_folder", lambda fid: _folder("fx", "teacher-2"))
    monkeypatch.setattr(cr, "delete_curriculum_folder", lambda fid: called.append(fid))
    resp = _client().delete("/api/curriculum/folders/fx")
    assert resp.status_code == 404
    assert called == []  # never deleted


def test_delete_missing_folder_404(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_folder", lambda fid: None)
    assert _client().delete("/api/curriculum/folders/nope").status_code == 404


def test_delete_folder_student_forbidden():
    assert _client(group_id="g").delete("/api/curriculum/folders/f1").status_code == 403


# --- 1.1.59 M1: shared-corpus read-through cache ---


def _wire_counting(monkeypatch, shared, mine):
    """Like _wire_store, but counts queries per ownerScope so cache HITs are visible."""
    counts = {"shared": 0, "mine": 0}

    def fake_query(collection, filters=None):
        owner = filters[0][2] if filters else None
        if owner == "shared":
            counts["shared"] += 1
            src = shared
        elif owner == TEACHER:
            counts["mine"] += 1
            src = mine
        else:
            src = []
        return [d.model_dump(by_alias=True, mode="json") for d in src]

    monkeypatch.setattr(dbc, "query_documents", fake_query)
    return counts


def test_shared_cache_hit_avoids_second_query(monkeypatch):
    counts = _wire_counting(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[])
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")
    assert counts["shared"] == 1  # second browse served from cache — 0 reads


def test_shared_cache_invalidate_forces_requery(monkeypatch):
    counts = _wire_counting(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[])
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")
    dbc.invalidate_shared_cache()
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")
    assert counts["shared"] == 2


def test_shared_cache_ttl_expiry_requeries(monkeypatch):
    counts = _wire_counting(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[])
    clock = {"t": 1000.0}
    monkeypatch.setattr(dbc, "_monotonic", lambda: clock["t"])
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")
    clock["t"] += dbc._SHARED_TTL_S + 1  # past the TTL
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")
    assert counts["shared"] == 2


def test_own_docs_always_live_not_cached(monkeypatch):
    counts = _wire_counting(monkeypatch, shared=[], mine=[_doc("m1", "B", TEACHER)])
    dbc.list_curriculum_for_teacher(TEACHER, scope="mine")
    dbc.list_curriculum_for_teacher(TEACHER, scope="mine")
    assert counts["mine"] == 2  # own docs re-read every browse (freshness)


def test_new_own_doc_visible_immediately(monkeypatch):
    mine = [_doc("m1", "B", TEACHER)]
    _wire_counting(monkeypatch, shared=[], mine=mine)
    assert {d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, scope="mine")} == {"m1"}
    mine.append(_doc("m2", "B", TEACHER))  # a just-uploaded doc
    assert {d.doc_id for d in dbc.list_curriculum_for_teacher(TEACHER, scope="mine")} == {"m1", "m2"}


def test_create_shared_doc_invalidates_cache(monkeypatch):
    counts = _wire_counting(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[])
    monkeypatch.setattr(dbc, "set_document", lambda *a, **k: None)
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")  # warm
    dbc.create_curriculum_doc(_doc("s2", "B", "shared", source="shared"))  # SHARED write
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")
    assert counts["shared"] == 2  # re-queried after the shared write


def test_create_own_doc_does_not_invalidate_shared(monkeypatch):
    counts = _wire_counting(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[])
    monkeypatch.setattr(dbc, "set_document", lambda *a, **k: None)
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")  # warm
    dbc.create_curriculum_doc(_doc("m1", "B", TEACHER))  # OWN write — must not touch cache
    dbc.list_curriculum_for_teacher(TEACHER, scope="shared")
    assert counts["shared"] == 1  # still cached


def test_shared_cache_holds_only_shared_docs(monkeypatch):
    # SECURE BY CONSTRUCTION: the cache is populated by the shared-filtered query
    # alone, so it can never contain a teacher's private doc.
    _wire_counting(
        monkeypatch,
        shared=[_doc("s1", "B", "shared", source="shared")],
        mine=[_doc("m1", "B", TEACHER)],
    )
    dbc._load_shared()
    assert dbc._shared_cache["docs"] is not None
    assert all(d.owner_scope == "shared" for d in dbc._shared_cache["docs"])


def test_level_optional_doc_lists_and_sorts(monkeypatch):
    # 1.1.33: uploads are level-less (no forced "B"). A level=None doc must be
    # constructible, appear in browse, and not crash the (level, title) sort
    # (level-less sorts after A/B/C). A level filter simply doesn't match it.
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("no-level", None, TEACHER), _doc("has-b", "B", TEACHER)],
    )
    out = dbc.list_curriculum_for_teacher(TEACHER)
    ids = [d.doc_id for d in out]
    assert ids == ["has-b", "no-level"]  # A/B/C first, level-less last
    # A specific-level filter excludes the level-less doc.
    filtered = dbc.list_curriculum_for_teacher(TEACHER, level="B")
    assert [d.doc_id for d in filtered] == ["has-b"]


# --- browse endpoint ---


def test_browse_teacher_ok(monkeypatch):
    _wire_store(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[])
    resp = _client().get("/api/curriculum?scope=shared")
    assert resp.status_code == 200
    assert [d["docId"] for d in resp.json()["docs"]] == ["s1"]


def test_browse_student_forbidden(monkeypatch):
    resp = _client(group_id="grp-1").get("/api/curriculum")
    assert resp.status_code == 403


def test_browse_rejects_bad_scope():
    resp = _client().get("/api/curriculum?scope=everything")
    assert resp.status_code == 422  # pattern guard


def test_browse_tags_facet_param(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("a", "A", TEACHER, tags=["lab"]), _doc("b", "A", TEACHER, tags=["exam"])],
    )
    resp = _client().get("/api/curriculum?tags=lab")
    assert resp.status_code == 200
    assert [d["docId"] for d in resp.json()["docs"]] == ["a"]


# --- 1.1.59 M2: pagination ---


def test_browse_paginates_with_total(monkeypatch):
    # 5 own docs (titles Doc a..e sort ascending); page size 2.
    mine = [_doc(c, "A", TEACHER, title=f"Doc {c}") for c in "abcde"]
    _wire_store(monkeypatch, shared=[], mine=mine)
    body = _client().get("/api/curriculum?limit=2&offset=0").json()
    assert body["total"] == 5
    assert body["limit"] == 2 and body["offset"] == 0
    assert [d["docId"] for d in body["docs"]] == ["a", "b"]
    # Next page.
    body2 = _client().get("/api/curriculum?limit=2&offset=2").json()
    assert [d["docId"] for d in body2["docs"]] == ["c", "d"]
    # Tail page (partial).
    body3 = _client().get("/api/curriculum?limit=2&offset=4").json()
    assert [d["docId"] for d in body3["docs"]] == ["e"]
    assert body3["total"] == 5  # total is the full match count, not the page size


def test_browse_default_limit_applied(monkeypatch):
    _wire_store(monkeypatch, shared=[], mine=[_doc("a", "A", TEACHER)])
    body = _client().get("/api/curriculum").json()
    assert body["limit"] == 50 and body["offset"] == 0


def test_browse_rejects_oversized_limit():
    assert _client().get("/api/curriculum?limit=201").status_code == 422
    assert _client().get("/api/curriculum?offset=-1").status_code == 422


# --- 1.1.58 M1: facets + PATCH tags endpoints ---


def test_facets_returns_distinct_tags(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[_doc("s", "A", "shared", source="shared", tags=["exam"])],
        mine=[_doc("m", "A", TEACHER, tags=["lab", "exam"])],
    )
    resp = _client().get("/api/curriculum/facets")
    assert resp.status_code == 200
    # Counts span the whole ACL-scoped set: "exam" is on both the shared and the
    # teacher's own doc.
    assert resp.json()["tags"] == [
        {"value": "exam", "label": "exam", "count": 2},
        {"value": "lab", "label": "lab", "count": 1},
    ]


def test_facets_student_forbidden():
    assert _client(group_id="grp-1").get("/api/curriculum/facets").status_code == 403


def _wire_patch(monkeypatch, doc):
    """Mock get/create for the PATCH handler; capture the saved doc."""
    import protocols.curriculum_routes as cr

    saved: list = []
    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: doc)
    monkeypatch.setattr(cr, "create_curriculum_doc", lambda d: saved.append(d))
    return saved


def test_patch_sets_tags_full_replacement(monkeypatch):
    doc = _doc("m1", "A", TEACHER, tags=["old"])
    saved = _wire_patch(monkeypatch, doc)
    resp = _client().patch("/api/curriculum/m1", json={"tags": ["Lab", "lab", " Exam "]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["doc"]["tags"] == ["lab", "exam"]  # normalized + deduped
    assert saved[0].tags == ["lab", "exam"]


def test_patch_add_remove_deltas(monkeypatch):
    doc = _doc("m1", "A", TEACHER, tags=["lab", "exam"])
    _wire_patch(monkeypatch, doc)
    resp = _client().patch("/api/curriculum/m1", json={"addTags": ["mekanik"], "removeTags": ["exam"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["doc"]["tags"] == ["lab", "mekanik"]


def test_patch_shared_doc_allowed(monkeypatch):
    doc = _doc("s1", "A", "shared", source="shared", tags=[])
    _wire_patch(monkeypatch, doc)
    resp = _client().patch("/api/curriculum/s1", json={"addTags": ["cleared"]})
    assert resp.status_code == 200


def test_patch_other_teachers_doc_404(monkeypatch):
    doc = _doc("x1", "A", "teacher-2", tags=[])
    saved = _wire_patch(monkeypatch, doc)
    resp = _client().patch("/api/curriculum/x1", json={"addTags": ["nope"]})
    assert resp.status_code == 404  # no existence leak
    assert saved == []


def test_patch_missing_doc_404(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: None)
    resp = _client().patch("/api/curriculum/nope", json={"addTags": ["x"]})
    assert resp.status_code == 404


def test_patch_empty_body_422(monkeypatch):
    doc = _doc("m1", "A", TEACHER, tags=["lab"])
    _wire_patch(monkeypatch, doc)
    resp = _client().patch("/api/curriculum/m1", json={})
    assert resp.status_code == 422


def test_patch_student_forbidden():
    assert _client(group_id="grp-1").patch("/api/curriculum/m1", json={"addTags": ["x"]}).status_code == 403


# --- M4: ingest returns the parsed preview (teacher reviews before grounding) ---


def test_ingest_returns_parsed_preview_and_levelless(monkeypatch):
    # 1.1.33 M4 — the ingest response carries what AILANG Parse extracted
    # (parsedPreview + parsedChars) so the teacher can verify before it grounds
    # the tutor. Also covers level-less upload end-to-end (no level form field).
    import protocols.curriculum_routes as cr

    extracted = "Newtons anden lov: F = m * a. Et regneeksempel følger."

    async def fake_extract(tmp_path, filename):
        return extracted

    async def fake_upload(*a, **k):
        return "rag/parsed-1"

    monkeypatch.setattr(cr, "_extract_text", fake_extract)
    monkeypatch.setattr(cr, "upload_text_as_rag_file", fake_upload)
    monkeypatch.setattr(cr, "create_curriculum_doc", lambda doc: None)

    resp = _client().post(
        "/api/curriculum/ingest",
        files={"file": ("worksheet.txt", b"raw bytes - extract is mocked", "text/plain")},
        data={"title": "Worksheet", "origin": "worksheet.txt"},  # no level
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["parsedPreview"].startswith("Newtons anden lov")
    assert body["parsedChars"] == len(extracted)
    assert body["doc"]["level"] is None  # level-less upload (1.1.33)


# --- M6: delete (RAG file + content + metadata) ---


def _wire_delete(monkeypatch, doc):
    """Mock the delete handler's dependencies; record what got called."""
    import protocols.curriculum_routes as cr

    calls: dict[str, list] = {"rag": [], "content": [], "doc": []}
    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: doc)

    async def fake_rag_delete(name):
        calls["rag"].append(name)
        return True

    monkeypatch.setattr(cr, "delete_rag_file", fake_rag_delete)
    monkeypatch.setattr(cr, "delete_curriculum_content", lambda d: calls["content"].append(d))
    monkeypatch.setattr(cr, "delete_curriculum_doc", lambda d: calls["doc"].append(d))
    return calls


def test_delete_shared_doc_removes_rag_content_metadata(monkeypatch):
    doc = _doc("s1", "B", "shared", source="shared").model_copy(update={"doc_artifact_id": "rag/file-1"})
    calls = _wire_delete(monkeypatch, doc)
    resp = _client().delete("/api/curriculum/s1")
    assert resp.status_code == 204, resp.text
    assert calls == {"rag": ["rag/file-1"], "content": ["s1"], "doc": ["s1"]}


def test_delete_own_doc_skips_rag_when_no_artifact(monkeypatch):
    doc = _doc("m1", "B", TEACHER)  # doc_artifact_id defaults to ""
    calls = _wire_delete(monkeypatch, doc)
    resp = _client().delete("/api/curriculum/m1")
    assert resp.status_code == 204
    assert calls["doc"] == ["m1"]
    assert calls["rag"] == []  # nothing to delete in RAG


def test_delete_other_teachers_private_doc_forbidden(monkeypatch):
    doc = _doc("x1", "B", "teacher-2")  # a different teacher's private upload
    calls = _wire_delete(monkeypatch, doc)
    resp = _client().delete("/api/curriculum/x1")
    assert resp.status_code == 403
    assert calls["doc"] == []  # nothing deleted


def test_delete_missing_doc_404(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: None)
    resp = _client().delete("/api/curriculum/nope")
    assert resp.status_code == 404


def test_delete_student_forbidden():
    resp = _client(group_id="grp-1").delete("/api/curriculum/s1")
    assert resp.status_code == 403


# --- M3: read a doc's parsed content (display ACL) ---


def _cfg_with(materials):
    from types import SimpleNamespace

    return SimpleNamespace(materials=materials)


def _mat(doc_id, visible):
    from db.models.activity_config import MaterialRef

    return MaterialRef(doc_id=doc_id, origin="o", student_visible=visible)


def test_content_teacher_reads_own_or_shared(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: _doc(d, "A", TEACHER))
    monkeypatch.setattr(cr, "get_curriculum_content", lambda d: {"text": "Newtons love.", "chars": 13})
    resp = _client().get("/api/curriculum/doc-1/content")  # teacher, owns it
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is True
    assert body["text"] == "Newtons love."


def test_content_teacher_denied_other_owner(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: _doc(d, "A", "other-teacher"))
    monkeypatch.setattr(cr, "get_curriculum_content", lambda d: {"text": "x", "chars": 1})
    resp = _client().get("/api/curriculum/doc-1/content")
    assert resp.status_code == 403


def test_content_student_reads_cited_visible(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: _doc(d, "A", TEACHER))
    monkeypatch.setattr(cr, "get_curriculum_content", lambda d: {"text": "Visible.", "chars": 8})
    monkeypatch.setattr(cr, "resolve_active_config", lambda aid, group_tags=None: _cfg_with([_mat("doc-1", True)]))
    resp = _client(group_id="grp-1").get("/api/curriculum/doc-1/content?activityId=act-1")
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "Visible."


def test_content_student_denied_when_hidden(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: _doc(d, "A", TEACHER))
    monkeypatch.setattr(cr, "get_curriculum_content", lambda d: {"text": "secret", "chars": 6})
    # cited but NOT student_visible -> denied
    monkeypatch.setattr(cr, "resolve_active_config", lambda aid, group_tags=None: _cfg_with([_mat("doc-1", False)]))
    resp = _client(group_id="grp-1").get("/api/curriculum/doc-1/content?activityId=act-1")
    assert resp.status_code == 403


def test_content_unavailable_when_not_stored(monkeypatch):
    import protocols.curriculum_routes as cr

    monkeypatch.setattr(cr, "get_curriculum_doc", lambda d: _doc(d, "A", TEACHER))
    monkeypatch.setattr(cr, "get_curriculum_content", lambda d: None)  # ingested pre-M3
    resp = _client().get("/api/curriculum/doc-1/content")
    assert resp.status_code == 200
    assert resp.json()["available"] is False


def test_ingest_pdf_routes_through_gemini(monkeypatch):
    # 1.1.33 — PDFs are accepted (no 422) and parsed via Gemini OCR, not rejected
    # as "convert first". Mock the Gemini call + the stores.
    import protocols.curriculum_routes as cr

    async def fake_pdf(pdf_bytes):
        return "## Fysik A\nNewtons love…"

    async def fake_upload(*a, **k):
        return "rag/pdf-1"

    monkeypatch.setattr(cr, "_extract_pdf_text", fake_pdf)
    monkeypatch.setattr(cr, "upload_text_as_rag_file", fake_upload)
    monkeypatch.setattr(cr, "create_curriculum_doc", lambda doc: None)
    monkeypatch.setattr(cr, "set_curriculum_content", lambda d, t: None)

    resp = _client().post(
        "/api/curriculum/ingest",
        files={"file": ("laereplan.pdf", b"%PDF-1.4 fake bytes", "application/pdf")},
        data={"title": "Læreplan", "origin": "laereplan.pdf"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["parsedPreview"].startswith("## Fysik A")


# --- 1.1.60: facet narrowing, the unlevelled bucket, ingest capture ---


def test_facet_counts_narrow_by_the_other_facets(monkeypatch):
    """The core 1.1.60 semantic: picking a subject re-counts the OTHER facets
    against it, while the subject options keep their own unnarrowed counts so the
    teacher can switch without clearing first."""
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[
            _doc("p1", "A", TEACHER, subject="Fysik", folder_id="f-mek"),
            _doc("p2", "B", TEACHER, subject="Fysik", folder_id="f-mek"),
            _doc("m1", "A", TEACHER, subject="Matematik", folder_id="f-alg"),
        ],
        folders=[_folder("f-mek", TEACHER, "Mekanik"), _folder("f-alg", TEACHER, "Algebra")],
    )

    body = _client().get("/api/curriculum/facets?subject=Matematik").json()

    # Folders + levels are counted against maths docs only...
    assert {f["label"]: f["count"] for f in body["folders"]} == {"Algebra": 1, "Mekanik": 0}
    assert {lv["value"]: lv["count"] for lv in body["levels"]} == {"A": 1, "B": 0}
    # ...but the subject facet still counts itself unnarrowed, so "Fysik" stays
    # switchable rather than collapsing to 0.
    assert {s["value"]: s["count"] for s in body["subjects"]} == {"Fysik": 2, "Matematik": 1}


def test_facet_options_are_stable_when_filtered(monkeypatch):
    """Options come from the whole visible corpus, counts from the narrowed set —
    so chips never appear/vanish mid-filter, they just go to 0."""
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("a", "A", TEACHER, subject="Fysik"), _doc("b", "C", TEACHER, subject="Matematik")],
        folders=[_folder("f-empty", TEACHER, "Kvantefysik")],
    )

    unfiltered = _client().get("/api/curriculum/facets").json()
    filtered = _client().get("/api/curriculum/facets?subject=Fysik").json()

    assert [s["value"] for s in unfiltered["subjects"]] == [s["value"] for s in filtered["subjects"]]
    assert [lv["value"] for lv in unfiltered["levels"]] == [lv["value"] for lv in filtered["levels"]]
    # An empty folder stays in the rail — it's a valid destination, and a folder
    # created a moment ago must not vanish.
    assert "Kvantefysik" in [f["label"] for f in unfiltered["folders"]]
    assert {lv["value"]: lv["count"] for lv in filtered["levels"]} == {"A": 1, "C": 0}


def test_unlevelled_is_a_selectable_level_bucket(monkeypatch):
    """Level is optional and no upload path sets it, so "no level" is where most
    teacher docs live — it must be filterable, not just a gap."""
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("a", "A", TEACHER), _doc("b", None, TEACHER), _doc("c", None, TEACHER)],
    )

    resp = _client().get("/api/curriculum?level=__unlevelled__")
    assert resp.status_code == 200
    assert sorted(d["docId"] for d in resp.json()["docs"]) == ["b", "c"]

    levels = {lv["value"]: lv for lv in _client().get("/api/curriculum/facets").json()["levels"]}
    assert levels["__unlevelled__"]["count"] == 2
    assert levels["__unlevelled__"]["label"] == "No level"


def test_facets_reject_unknown_level(monkeypatch):
    _wire_store(monkeypatch, shared=[], mine=[])
    assert _client().get("/api/curriculum/facets?level=Z").status_code == 422
    assert _client().get("/api/curriculum?level=Z").status_code == 422


def _wire_ingest(monkeypatch, saved):
    """Stub the ingest side effects, capturing the CurriculumDoc that gets saved."""
    import protocols.curriculum_routes as cr

    async def fake_extract(path, filename):
        return "Newtons love…"

    async def fake_upload(*a, **k):
        return "rag/file-1"

    async def fake_summary(text):
        return ""

    monkeypatch.setattr(cr, "_extract_text", fake_extract)
    monkeypatch.setattr(cr, "upload_text_as_rag_file", fake_upload)
    monkeypatch.setattr(cr, "summarise_curriculum_text", fake_summary)
    monkeypatch.setattr(cr, "create_curriculum_doc", lambda doc: saved.append(doc))
    monkeypatch.setattr(cr, "set_curriculum_content", lambda d, t: None)


def test_ingest_persists_subject_and_folder(monkeypatch):
    """The 1.1.60 regression guard. The backend accepted `subject` from 1.1.58 M2,
    but no upload path ever SENT it, so every doc ingested through the UI or CLI
    landed with subject=None and the Subject facet row stayed empty for two weeks.
    Assert the field survives the round trip."""
    saved: list[CurriculumDoc] = []
    _wire_ingest(monkeypatch, saved)
    monkeypatch.setattr(
        "protocols.curriculum_routes.get_curriculum_folder",
        lambda fid: _folder("f-1", TEACHER, "Mekanik") if fid == "f-1" else None,
    )

    resp = _client().post(
        "/api/curriculum/ingest",
        files={"file": ("noter.txt", b"Newtons love", "text/plain")},
        data={"title": "Noter", "origin": "teacher", "subject": "  Fysik  ", "folder_id": "f-1"},
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["doc"]["subject"] == "Fysik"  # normalised (trimmed)
    assert saved[0].subject == "Fysik"
    assert (saved[0].folder_id, saved[0].folder_name) == ("f-1", "Mekanik")


def test_ingest_rejects_a_folder_in_another_scope(monkeypatch):
    """ACL parity with PATCH: a teacher_owned doc can't be filed into a shared
    folder. Checked BEFORE the parse/RAG upload so a bad request is cheap."""
    saved: list[CurriculumDoc] = []
    _wire_ingest(monkeypatch, saved)
    monkeypatch.setattr(
        "protocols.curriculum_routes.get_curriculum_folder",
        lambda fid: _folder("f-shared", "shared", "Delt"),
    )

    resp = _client().post(
        "/api/curriculum/ingest",
        files={"file": ("noter.txt", b"x", "text/plain")},
        data={"title": "Noter", "origin": "teacher", "folder_id": "f-shared"},
    )

    assert resp.status_code == 400
    assert saved == []


def test_ingest_without_subject_still_works(monkeypatch):
    """Subject stays optional — a teacher is never blocked on categorising."""
    saved: list[CurriculumDoc] = []
    _wire_ingest(monkeypatch, saved)

    resp = _client().post(
        "/api/curriculum/ingest",
        files={"file": ("noter.txt", b"x", "text/plain")},
        data={"title": "Noter", "origin": "teacher"},
    )

    assert resp.status_code == 201, resp.text
    assert saved[0].subject is None
    assert saved[0].folder_id is None
