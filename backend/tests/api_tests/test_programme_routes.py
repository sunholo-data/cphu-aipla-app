"""PROGADMIN-1 (1.1.76) — /api/programme delegated administration.

Headline: the tests that matter here are all REFUSALS.

Two claims, two privilege levels, one surface:

    plain teacher     -> 404 on everything, read and write
    researcher        -> 200 on GET, 404 on every write
    programme admin   -> 200 on both, within bounds

404 rather than 403 throughout: an administrative surface should not confirm
its own existence to a caller who may not use it.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from protocols.programme_routes import router


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


TEACHER = User(uid="t-1", email="teacher@ku.dk")
RESEARCHER = User(uid="r-1", email="jb@ind.ku.dk", is_researcher=True)
PROG_ADMIN = User(uid="p-1", email="admin@ku.dk", is_programme_admin=True)


# --- the gate ---


def test_every_read_404s_for_a_plain_teacher():
    """A teacher with neither claim must not learn this surface exists."""
    c = _client(TEACHER)
    assert c.get("/api/programme/access/list").status_code == 404
    assert c.get("/api/programme/access/requests").status_code == 404


def test_researcher_reads_the_register():
    res = _client(RESEARCHER).get("/api/programme/access/list")
    assert res.status_code == 200
    assert "grants" in res.json()


def test_researcher_reads_the_request_queue():
    res = _client(RESEARCHER).get("/api/programme/access/requests")
    assert res.status_code == 200
    assert "requests" in res.json()


def test_programme_admin_reads_both():
    c = _client(PROG_ADMIN)
    assert c.get("/api/programme/access/list").status_code == 200
    assert c.get("/api/programme/access/requests").status_code == 200


# --- the read/write split, carried in the payload ---


def test_can_write_is_false_for_a_researcher():
    """The read-only view and the write view are the SAME surface at different
    privilege levels. `canWrite` is how the client knows which to render, so a
    researcher seeing `true` here would mean buttons that 404 on click."""
    for path in ("/api/programme/access/list", "/api/programme/access/requests"):
        assert _client(RESEARCHER).get(path).json()["canWrite"] is False


def test_can_write_is_true_for_a_programme_admin():
    for path in ("/api/programme/access/list", "/api/programme/access/requests"):
        assert _client(PROG_ADMIN).get(path).json()["canWrite"] is True


# --- the claim itself ---


def test_claim_is_read_from_the_token_and_defaults_false():
    """Absent claim -> not an admin, by construction rather than by a check
    someone could forget."""
    from auth.firebase_auth import _user_from_decoded_token

    plain = _user_from_decoded_token({"uid": "u1", "email": "a@ku.dk"})
    assert plain.is_programme_admin is False

    admin = _user_from_decoded_token({"uid": "u2", "email": "b@ku.dk", "programmeAdmin": True})
    assert admin.is_programme_admin is True


def test_a_truthy_non_true_claim_does_not_grant_admin():
    """Compared against True identically, so a stray string in the claim blob
    cannot confer spend authority."""
    from auth.firebase_auth import _user_from_decoded_token

    for sneaky in ("true", 1, "yes", [1]):
        u = _user_from_decoded_token({"uid": "u", "email": "c@ku.dk", "programmeAdmin": sneaky})
        assert u.is_programme_admin is False, f"{sneaky!r} must not grant admin"


def test_programme_admin_and_researcher_are_independent():
    """Separate keys, not two values of one field — so holding one says nothing
    about the other."""
    from auth.firebase_auth import _user_from_decoded_token

    admin_only = _user_from_decoded_token({"uid": "u", "email": "d@ku.dk", "programmeAdmin": True})
    assert admin_only.is_researcher is False

    researcher_only = _user_from_decoded_token({"uid": "u", "email": "e@ku.dk", "role": "researcher"})
    assert researcher_only.is_programme_admin is False


# --- grantedVia (the audit half) ---


def test_granted_via_round_trips_and_defaults_to_empty_for_legacy_rows():
    """A row written before 1.1.76 has no `grantedVia`; it must read back as
    empty rather than blowing up, and callers treat empty as service-account."""
    from db.teacher_access import AccessGrant

    legacy = AccessGrant.from_doc({"email": "old@ku.dk", "tier": "pilot", "monthlyCapUsd": 25.0})
    assert legacy.granted_via == ""

    stamped = AccessGrant.from_doc(
        {"email": "new@ku.dk", "tier": "pilot", "monthlyCapUsd": 25.0, "grantedVia": "programme-admin"}
    )
    assert stamped.granted_via == "programme-admin"
    assert stamped.to_doc()["grantedVia"] == "programme-admin"


def test_grant_access_stamps_service_account_by_default():
    """The SA path is the default caller, so an un-passed `granted_via` must
    land on `service-account` rather than empty — otherwise the field only ever
    tells you about the new door."""
    from db.teacher_access import GRANTED_VIA_SERVICE_ACCOUNT, grant_access

    g = grant_access("someone@ku.dk", granted_by="sa@project.iam.gserviceaccount.com")
    assert g.granted_via == GRANTED_VIA_SERVICE_ACCOUNT


# ─── M2: the bounded write path ──────────────────────────────────────────────
#
# Every test below is a REFUSAL except the two that establish the happy path.
# That ratio is the point: this router's job is saying no correctly.


@pytest.fixture(autouse=True)
def _no_firebase(monkeypatch):
    """The write path's post-effects all reach Firebase. Stub them: this suite
    is about the BOUNDS, not about claim propagation."""
    import auth.access_sync as sync

    monkeypatch.setattr(sync, "sync_access_claim", lambda *a, **k: None)
    monkeypatch.setattr(sync, "invalidate_spend_cache", lambda *a, **k: None)
    monkeypatch.setattr(sync, "close_access_request", lambda *a, **k: None)
    monkeypatch.setattr(sync, "revoke_sessions", lambda *a, **k: None)
    import protocols.programme_routes as pr

    monkeypatch.setattr(pr, "sync_access_claim", lambda *a, **k: None)
    monkeypatch.setattr(pr, "invalidate_spend_cache", lambda *a, **k: None)
    monkeypatch.setattr(pr, "close_access_request", lambda *a, **k: None)
    monkeypatch.setattr(pr, "revoke_sessions", lambda *a, **k: None)
    yield


GRANT = {"email": "new@ku.dk", "tier": "pilot", "monthlyCapUsd": 25, "note": "Cohort A"}


def test_a_plain_teacher_cannot_write():
    c = _client(TEACHER)
    assert c.post("/api/programme/access/grant", json=GRANT).status_code == 404
    assert c.post("/api/programme/access/revoke", json={"email": "x@ku.dk"}).status_code == 404


def test_a_researcher_can_read_but_not_write():
    """The central split. A researcher reads the register and gets the SAME 404
    a stranger does on write — reading transcripts and committing money are
    different questions about a person."""
    c = _client(RESEARCHER)
    assert c.get("/api/programme/access/list").status_code == 200
    assert c.post("/api/programme/access/grant", json=GRANT).status_code == 404
    assert c.post("/api/programme/access/revoke", json={"email": "x@ku.dk"}).status_code == 404


def test_programme_admin_grants_within_the_bounds():
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json=GRANT)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["email"] == "new@ku.dk"
    assert body["monthlyCapUsd"] == 25
    assert body["grantedVia"] == "programme-admin"


def test_cap_above_the_ceiling_is_refused_and_names_the_bound():
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "monthlyCapUsd": 5000})
    assert res.status_code == 403
    assert "50" in res.json()["detail"], "the ceiling must be named, not just enforced"


def test_nothing_is_written_when_a_bound_refuses():
    """A refused grant must leave no trace — a partial write here would be a
    grant nobody authorised."""
    from db.teacher_access import get_grant

    c = _client(PROG_ADMIN)
    assert (
        c.post("/api/programme/access/grant", json={**GRANT, "email": "over@ku.dk", "monthlyCapUsd": 5000}).status_code
        == 403
    )
    assert get_grant("over@ku.dk") is None


def test_uncapped_is_refused():
    """Removing the limit entirely stays a service-account decision: an
    uncapped teacher is bounded only by the shared project quota."""
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "monthlyCapUsd": -1})
    assert res.status_code == 403


def test_zero_cap_is_refused():
    """0 is a ZERO cap, not 'no limit' — and it disables the per-teacher gate
    outright, so it is not delegated either."""
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "monthlyCapUsd": 0})
    assert res.status_code == 403


def test_an_unknown_tier_is_refused():
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "tier": "superuser"})
    assert res.status_code == 403


def test_expiry_beyond_the_engagement_boundary_is_refused():
    """Delegation cannot outlive the engagement: forgetting to clean up should
    make access LAPSE, not persist."""
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "expiresAt": "2099-01-01T00:00:00Z"})
    assert res.status_code == 403
    assert "2027-09-15" in res.json()["detail"]


def test_expiry_defaults_to_the_engagement_boundary():
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "email": "dflt@ku.dk"})
    assert res.json()["expiresAt"] == "2027-09-15T00:00:00Z"


def test_the_domain_bound_is_off_by_default():
    """Shipped open by decision: ~20 of 24 live prod rows are Danish gymnasium
    domains or Gmail aliases, so a ku.dk allowlist would refuse almost every
    real teacher."""
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "email": "teacher@toerring-gym.dk"})
    assert res.status_code == 200


def test_the_domain_bound_refuses_when_configured(monkeypatch):
    monkeypatch.setenv("PROGRAMME_ADMIN_EMAIL_DOMAINS", "ku.dk")
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "email": "outsider@gmail.com"})
    assert res.status_code == 403
    assert "ku.dk" in res.json()["detail"]


def test_the_cap_ceiling_is_read_from_env_per_environment(monkeypatch):
    """So prod can be tighter than dev."""
    monkeypatch.setenv("PROGRAMME_ADMIN_MAX_CAP_USD", "10")
    res = _client(PROG_ADMIN).post("/api/programme/access/grant", json={**GRANT, "monthlyCapUsd": 25})
    assert res.status_code == 403
    assert "10" in res.json()["detail"]


def test_an_unparseable_ceiling_falls_back_to_the_default_not_to_no_ceiling(monkeypatch):
    """A fat-fingered env var must not widen the bound it exists to impose."""
    from auth.programme_bounds import DEFAULT_MAX_CAP_USD, max_cap_usd

    monkeypatch.setenv("PROGRAMME_ADMIN_MAX_CAP_USD", "fifty dollars")
    assert max_cap_usd() == DEFAULT_MAX_CAP_USD

    monkeypatch.setenv("PROGRAMME_ADMIN_MAX_CAP_USD", "-1")
    assert max_cap_usd() == DEFAULT_MAX_CAP_USD


def test_revoke_is_delegated():
    """Revoke reduces spend and undoes in one command; raising a cap does not.
    The asymmetry is deliberate."""
    from db.teacher_access import grant_access

    grant_access("goodbye@ku.dk", granted_by="m@sunholo.com")
    res = _client(PROG_ADMIN).post("/api/programme/access/revoke", json={"email": "goodbye@ku.dk"})
    assert res.status_code == 200
    assert res.json()["revoked"] is True


def test_revoking_someone_not_on_the_register_404s():
    res = _client(PROG_ADMIN).post("/api/programme/access/revoke", json={"email": "ghost@ku.dk"})
    assert res.status_code == 404


# ─── The escalation test ─────────────────────────────────────────────────────


def test_a_programme_admin_cannot_mint_the_claim_they_hold():
    """THE escalation. A delegated admin who can mint their own claim is an
    unbounded admin.

    Closed by construction rather than by a check: the claim is minted only by
    `/api/admin/grant-programme-admin`, which is behind the service-account
    gate, and this router has no route that reaches it.
    """
    from protocols.programme_routes import router as programme_router

    paths = {r.path for r in programme_router.routes}  # type: ignore[attr-defined]
    assert not any("programme-admin" in p or "grant-admin" in p for p in paths), (
        f"the delegated router must expose no claim-minting route; found {paths}"
    )


def test_the_delegated_router_never_reaches_the_service_account_gate():
    """The two doors must not share a guard — neither can be widened by
    accident while someone edits the other."""
    from pathlib import Path

    src = Path(__file__).resolve().parents[2] / "protocols" / "programme_routes.py"
    body = src.read_text()
    # A CALL, not a mention: the module docstring names the symbol precisely to
    # record that it must never be used here.
    assert "_assert_caller_is_service_account(" not in body
    assert "from admin.auth import" not in body
    assert "from admin import" not in body


def test_the_service_account_router_never_reads_the_programme_admin_claim():
    """The mirror of the test above, from the other side."""
    from pathlib import Path

    src = Path(__file__).resolve().parents[2] / "admin" / "routes.py"
    body = src.read_text()
    assert "is_programme_admin" not in body, "the SA router must gate on the allowlist, never on the delegated claim"
