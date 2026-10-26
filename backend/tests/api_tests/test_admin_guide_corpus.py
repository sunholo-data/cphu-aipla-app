"""The how-to-guide corpus seed is a PLATFORM write, gated by the admin SA (2026-10-26).

`make seed-guide-corpus` used to sign in as the test teacher and call the
teacher routes; two later gates (shared ingest is researcher-only, ingest is a
paid call) refuse it, correctly. These tests pin the replacement:

  * only an ID token whose email is on ``ADMIN_SEED_ALLOWED_SAS`` gets in — a
    teacher's token, a researcher's token, a real anonymous-group token and a
    human Google account are all refused. The tokens are SIGNED (with a test key
    whose certificate stands in for Google's), so the real verifier runs: the
    Firebase-shaped ones fail on issuer, the group one on algorithm, the human
    one on the allowlist — none of them on a mocked-out "no";
  * a dry run writes nothing;
  * re-running over the same PDFs writes nothing; a changed PDF replaces the old
    doc; a failed RAG upload is stored as ``ragStatus: failed``, not a success;
  * the docs land in the SHARED corpus under the guide subject, owned by nobody's
    account, and the onboarding class + tutors are platform-owned.
"""

from __future__ import annotations

import datetime as dt
import json
from types import SimpleNamespace

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.auth import crypt
from google.auth import jwt as google_jwt

import admin.guide_corpus as guide_corpus
import db.rag_corpus as rag_corpus
import protocols.curriculum_routes as curriculum_routes
from admin.routes import router
from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
from auth.local_mode_stub import STUB_TOKEN
from db import firestore as fs_module
from db.activities import list_activities_by_owner
from db.classes import list_classes_for_owner
from db.curriculum import _load_shared, invalidate_shared_cache
from skills.platform import PLATFORM_OWNER_UID

SA = "aipla-v6@aipla-dev-2026.iam.gserviceaccount.com"
CORPUS = "projects/p/locations/europe-north1/ragCorpora/7"
KID = "test-kid"

TUTORS = [
    {"title": "How to use AIPLA (for teachers)", "teachingGoal": "Help teachers.", "audience": "teacher"},
    {"title": "How to use your tutor (for students)", "teachingGoal": "Help students.", "audience": "student"},
]
T1 = "AIPLA guide — T1: Set up a class"
S1 = "AIPLA guide — S1: Join and use your tutor"


# ---------------------------------------------------------------------------
# Signed test tokens — the real verifier runs against a cert we control
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def signing():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    signer = crypt.RSASigner.from_string(pem, key_id=KID)
    return signer, cert.public_bytes(serialization.Encoding.PEM).decode()


def _token(signer, **claims) -> str:
    now = int(dt.datetime.now(dt.UTC).timestamp())
    payload = {"iat": now, "exp": now + 600, "aud": "https://aipla.example", "sub": "x", **claims}
    return google_jwt.encode(signer, payload).decode()


@pytest.fixture(autouse=True)
def _env(monkeypatch, signing):
    _signer, cert_pem = signing
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    monkeypatch.setenv("ADMIN_SEED_ALLOWED_SAS", SA)
    monkeypatch.setenv("CURRICULUM_RAG_CORPUS_NAME", CORPUS)
    monkeypatch.setattr("google.oauth2.id_token._fetch_certs", lambda request, url: {KID: cert_pem})
    monkeypatch.setattr(rag_corpus, "RETRY_BACKOFF_S", 0)
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    invalidate_shared_cache()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    invalidate_shared_cache()


class _Paid:
    """Counts every paid / external call so a test can assert there were none."""

    def __init__(self) -> None:
        self.extract = 0
        self.upload = 0
        self.deleted_rag: list[str] = []
        self.fail_upload = False


@pytest.fixture()
def paid(monkeypatch) -> _Paid:
    p = _Paid()

    async def _extract(data: bytes) -> str:
        p.extract += 1
        return f"guide text {len(data)}"

    async def _upload(text, doc_id, **_kw):
        p.upload += 1
        if p.fail_upload:
            raise RuntimeError("vertex said no")
        return f"{CORPUS}/ragFiles/{doc_id}"

    async def _delete(name):
        p.deleted_rag.append(name)

    async def _summary(text, *, model=None):
        return ""

    monkeypatch.setattr(curriculum_routes, "extract_pdf_text", _extract)
    monkeypatch.setattr(rag_corpus, "_upload_once", _upload)
    monkeypatch.setattr(curriculum_routes, "delete_rag_file", _delete)
    monkeypatch.setattr(curriculum_routes, "summarise_curriculum_text", _summary)
    monkeypatch.setattr(
        guide_corpus,
        "list_skills",
        lambda **_kw: [SimpleNamespace(name="concept-dialogue", skill_id="skill-concept")],
    )
    return p


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture()
def sa_headers(signing) -> dict[str, str]:
    signer, _ = signing
    tok = _token(signer, iss="https://accounts.google.com", email=SA, email_verified=True)
    return {"Authorization": f"Bearer {tok}"}


def _doc(client, headers, *, title=T1, audience="teacher", data=b"%PDF-1 v1", dry=False):
    return client.post(
        "/api/admin/guide-corpus/doc",
        headers=headers,
        files={"file": ("t1.pdf", data, "application/pdf")},
        data={"title": title, "audience": audience, "dryRun": "true" if dry else "false"},
    )


def _finalize(client, headers, *, dry=False, titles=(T1, S1), prune=True):
    return client.post(
        "/api/admin/guide-corpus/finalize",
        headers=headers,
        json={"titles": list(titles), "prune": prune, "tutors": TUTORS, "dryRun": dry},
    )


def _guide_docs():
    invalidate_shared_cache()
    return [d for d in _load_shared() if d.subject == guide_corpus.GUIDE_SUBJECT]


def _snapshot() -> str:
    """Everything the seed can write, as one comparable string."""
    invalidate_shared_cache()
    return json.dumps(
        {
            "docs": sorted(d.model_dump_json() for d in _load_shared()),
            "classes": sorted(c.model_dump_json() for c in list_classes_for_owner(PLATFORM_OWNER_UID)),
            "activities": sorted(a.model_dump_json() for a in list_activities_by_owner(PLATFORM_OWNER_UID)),
        }
    )


# ---------------------------------------------------------------------------
# Who may call it
# ---------------------------------------------------------------------------


def _refused_tokens(signer) -> dict[str, str]:
    record = create_group(title="a class", skill_ids=["concept-dialogue"], creator_uid="teacher-1")
    group = join_group(record.group_id, client_ip="203.0.113.7").token
    firebase_iss = "https://securetoken.google.com/aipla-dev-2026"
    return {
        "teacher (Firebase ID token)": _token(
            signer, iss=firebase_iss, email="t@school.dk", email_verified=True, role="teacher"
        ),
        "researcher (Firebase ID token)": _token(
            signer, iss=firebase_iss, email="r@ku.dk", email_verified=True, role="researcher", researcher=True
        ),
        "human Google account": _token(
            signer, iss="https://accounts.google.com", email="m@sunholo.com", email_verified=True
        ),
        "anonymous group": group,
        "LOCAL_MODE teacher stub": STUB_TOKEN,
    }


_EXPECTED_REFUSAL = {
    # Signature verifies (our cert), issuer is Firebase, not Google OAuth.
    "teacher (Firebase ID token)": "GoogleAuthError",
    "researcher (Firebase ID token)": "GoogleAuthError",
    # A genuine Google identity, just not an allowlisted one.
    "human Google account": "not in ADMIN_SEED_ALLOWED_SAS",
    # HS256, our own secret — never a Google signature.
    "anonymous group": "InvalidValue",
    "LOCAL_MODE teacher stub": "MalformedError",
}


@pytest.mark.parametrize("route", ["doc", "finalize"])
def test_non_allowlisted_tokens_are_refused_and_write_nothing(client, paid, signing, route):
    signer, _ = signing
    before = _snapshot()
    for who, tok in _refused_tokens(signer).items():
        headers = {"Authorization": f"Bearer {tok}"}
        resp = _doc(client, headers) if route == "doc" else _finalize(client, headers)
        assert resp.status_code == 403, f"{who}: {resp.status_code} {resp.text}"
        # Refused for the RIGHT reason — not because the test's token was junk.
        assert _EXPECTED_REFUSAL[who] in resp.json()["detail"], f"{who}: {resp.text}"
    assert _snapshot() == before
    assert paid.extract == paid.upload == 0


def test_missing_bearer_is_refused(client, paid):
    assert _doc(client, {}).status_code == 403
    assert _finalize(client, {}).status_code == 403


# ---------------------------------------------------------------------------
# What it does
# ---------------------------------------------------------------------------


def test_seed_creates_shared_platform_owned_corpus_class_and_tutors(client, paid, sa_headers):
    r1 = _doc(client, sa_headers)
    r2 = _doc(client, sa_headers, title=S1, audience="student", data=b"%PDF-1 s1")
    assert r1.status_code == 200, r1.text
    assert r1.json()["action"] == r2.json()["action"] == "add"

    docs = {d.title: d for d in _guide_docs()}
    assert set(docs) == {T1, S1}
    t1 = docs[T1]
    assert t1.owner_scope == "shared" and t1.source == "shared"
    assert t1.subject == "AIPLA guides"
    assert t1.copyright_status == "cleared"
    assert t1.rag_status == "ready" and t1.doc_artifact_id
    assert t1.created_by == "platform-seed:guide-corpus"
    assert "audience:teacher" in t1.tags

    fin = _finalize(client, sa_headers)
    assert fin.status_code == 200, fin.text
    body = fin.json()
    assert body["class"]["action"] == "create"
    assert body["groupCodes"]["action"] == "mint" and len(body["groupCodes"]["codes"]) == 1

    (cls,) = list_classes_for_owner(PLATFORM_OWNER_UID)
    assert cls.name == "AIPLA onboarding"
    assert cls.tag_namespace == f"class:{PLATFORM_OWNER_UID}:{cls.class_id}"
    tutors = {a.title: a for a in list_activities_by_owner(PLATFORM_OWNER_UID)}
    assert set(tutors) == {t["title"] for t in TUTORS}
    assert set(cls.activity_ids) == {a.activity_id for a in tutors.values()}
    teacher_tutor = tutors["How to use AIPLA (for teachers)"]
    assert [m.doc_id for m in teacher_tutor.materials] == [t1.doc_id]
    assert teacher_tutor.skill_id == "skill-concept" and teacher_tutor.language == "en"
    assert [m.doc_id for m in tutors["How to use your tutor (for students)"].materials] == [docs[S1].doc_id]


def test_dry_run_writes_nothing_and_calls_nothing_paid(client, paid, sa_headers):
    before = _snapshot()
    r = _doc(client, sa_headers, dry=True)
    assert r.status_code == 200 and r.json() == {
        "title": T1,
        "action": "add",
        "docId": None,
        "ragStatus": None,
        "removed": [],
        "kept": [],
        "dryRun": True,
    }
    f = _finalize(client, sa_headers, dry=True)
    assert f.status_code == 200, f.text
    assert f.json()["class"]["action"] == "create"
    assert {t["action"] for t in f.json()["tutors"]} == {"create"}
    assert _snapshot() == before
    assert paid.extract == paid.upload == 0


def test_omitting_dry_run_is_a_dry_run(client, paid, sa_headers):
    before = _snapshot()
    r = client.post(
        "/api/admin/guide-corpus/doc",
        headers=sa_headers,
        files={"file": ("t1.pdf", b"%PDF-1 v1", "application/pdf")},
        data={"title": T1, "audience": "teacher"},
    )
    assert r.status_code == 200 and r.json()["dryRun"] is True
    f = client.post("/api/admin/guide-corpus/finalize", headers=sa_headers, json={"tutors": TUTORS})
    assert f.status_code == 200 and f.json()["dryRun"] is True
    assert _snapshot() == before


def test_second_run_over_the_same_pdfs_writes_nothing(client, paid, sa_headers):
    _doc(client, sa_headers)
    _doc(client, sa_headers, title=S1, audience="student", data=b"%PDF-1 s1")
    _finalize(client, sa_headers)
    calls = (paid.extract, paid.upload)
    before = _snapshot()

    assert _doc(client, sa_headers).json()["action"] == "unchanged"
    assert _doc(client, sa_headers, title=S1, audience="student", data=b"%PDF-1 s1").json()["action"] == "unchanged"
    second = _finalize(client, sa_headers).json()
    assert second["class"]["action"] == "unchanged"
    assert {t["action"] for t in second["tutors"]} == {"unchanged"}
    assert second["groupCodes"]["action"] == "unchanged"
    assert second["pruned"] == []

    assert _snapshot() == before
    assert (paid.extract, paid.upload) == calls


def test_a_changed_pdf_replaces_the_old_doc_and_repoints_the_tutor(client, paid, sa_headers):
    old_id = _doc(client, sa_headers).json()["docId"]
    _finalize(client, sa_headers, titles=(T1,))

    r = _doc(client, sa_headers, data=b"%PDF-1 v2 with the new screenshots").json()
    assert r["action"] == "replace" and r["removed"] == [old_id] and r["docId"] != old_id
    (only,) = [d for d in _guide_docs() if d.title == T1]
    assert only.doc_id == r["docId"]
    assert f"{CORPUS}/ragFiles/{old_id}" in paid.deleted_rag

    fin = _finalize(client, sa_headers, titles=(T1,)).json()
    teacher = next(t for t in fin["tutors"] if t["title"] == TUTORS[0]["title"])
    assert teacher["action"] == "update" and teacher["materials"] == [r["docId"]]


def test_rag_failure_is_stored_as_failed_and_keeps_the_readable_old_copy(client, paid, sa_headers):
    old_id = _doc(client, sa_headers).json()["docId"]

    paid.fail_upload = True
    r = _doc(client, sa_headers, data=b"%PDF-1 v2").json()
    assert r["action"] == "replace"
    assert r["ragStatus"] == "failed"
    # The old copy still works, so it stays until the new one is readable.
    assert r["removed"] == [] and r["kept"] == [old_id]
    stored = {d.doc_id: d for d in _guide_docs()}
    assert stored[r["docId"]].rag_status == "failed"
    assert stored[r["docId"]].rag_error and "vertex said no" in stored[r["docId"]].rag_error

    # Next run, RAG back: same bytes → re-ingest from stored text, then converge.
    paid.fail_upload = False
    extracts = paid.extract
    again = _doc(client, sa_headers, data=b"%PDF-1 v2").json()
    assert again["action"] == "reingest" and again["ragStatus"] == "ready"
    assert again["docId"] == r["docId"] and again["removed"] == [old_id]
    assert paid.extract == extracts  # re-sent the stored text, did not re-extract
    assert [d.doc_id for d in _guide_docs()] == [r["docId"]]


def test_prune_removes_a_retired_seed_guide_but_not_a_hand_filed_doc(client, paid, sa_headers):
    _doc(client, sa_headers)
    _doc(client, sa_headers, title=S1, audience="student", data=b"%PDF-1 s1")

    dry = _finalize(client, sa_headers, titles=(T1,), dry=True).json()
    assert [p["title"] for p in dry["pruned"]] == [S1]
    assert {d.title for d in _guide_docs()} == {T1, S1}

    # A subset run (GUIDE_SLUGS) does not prune.
    assert _finalize(client, sa_headers, titles=(T1,), prune=False).json()["pruned"] == []
    assert {d.title for d in _guide_docs()} == {T1, S1}

    real = _finalize(client, sa_headers, titles=(T1,)).json()
    assert [p["title"] for p in real["pruned"]] == [S1]
    assert {d.title for d in _guide_docs()} == {T1}


def test_a_class_of_the_same_name_owned_by_a_person_is_reported_not_touched(client, paid, sa_headers):
    from db.classes import create_class
    from db.models.class_ import Class

    legacy = Class.create_for_teacher(owner_uid="test-teacher-uid", name="AIPLA onboarding", description="old seed")
    create_class(legacy)
    before = legacy.model_dump_json()

    body = _finalize(client, sa_headers).json()
    assert body["legacyClasses"] == [{"classId": legacy.class_id, "ownerUid": "test-teacher-uid", "groupCodes": []}]
    assert body["class"]["action"] == "create" and body["class"]["classId"] != legacy.class_id
    from db.classes import get_class

    assert get_class(legacy.class_id).model_dump_json() == before


def test_missing_tutor_skill_is_a_409_not_a_half_seed(client, paid, sa_headers, monkeypatch):
    monkeypatch.setattr(guide_corpus, "list_skills", lambda **_kw: [])
    before = _snapshot()
    r = _finalize(client, sa_headers)
    assert r.status_code == 409 and "concept-dialogue" in r.json()["detail"]
    assert _snapshot() == before
