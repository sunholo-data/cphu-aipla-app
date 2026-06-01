"""Tests for the session-bootstrap endpoint (closes 2026-05-21 race).

Pre-creates ``ChatSessionIndex`` before the first agent turn so
iframe-context POSTs that fire on early student clicks don't 404.

Coverage:
  * Happy path: anon-group workshop user, valid skill → 204 + index row written.
  * Idempotence: second POST returns 204 with no extra Firestore write.
  * Skill missing: 403 (not 404 — don't leak which skill ids exist to
    unauthed callers).
  * Skill access denied: 403 via the existing AccessContext policy.
  * The regression we're closing: bootstrap → iframe-context with no
    agent turn in between → 204 instead of 404.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user
from auth.access_context import AccessContext
from db.models import SkillConfig
from db.models.access import AccessControl
from protocols.session_bootstrap_routes import router

_UID = "workshop-user"
_SESSION_ID = "sess-new"
_SKILL_ID = "problem-set-hints"


def _make_client(uid: str = _UID) -> TestClient:
    user = User(uid=uid, email="", domain="")
    ctx = AccessContext(uid=uid, email="", domain="", group_tags=frozenset())

    test_app = FastAPI()
    test_app.include_router(router)

    @test_app.middleware("http")
    async def _inject_access(request, call_next):
        request.state.access = ctx
        return await call_next(request)

    test_app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(test_app)


def _make_skill(owner_uid: str = _UID) -> SkillConfig:
    return SkillConfig(
        skillId=_SKILL_ID,
        name=_SKILL_ID,
        description="problem-set hints",
        ownerId=owner_uid,
        ownerEmail=f"{owner_uid}@example.com",
        accessControl=AccessControl(type="public"),
        skillMetadata={},
    )


def _mock_session_service():
    svc = MagicMock()
    svc.create_session = AsyncMock(return_value=MagicMock())
    return svc


class TestHappyPath:
    @patch("protocols.session_bootstrap_routes.get_session_service")
    @patch("protocols.session_bootstrap_routes.create_session_index")
    @patch("protocols.session_bootstrap_routes.skill_config")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_creates_session_index_for_workshop_user(
        self, mock_get_index, mock_skill_module, mock_create, mock_get_svc
    ):
        mock_get_index.return_value = None  # not yet exists
        mock_skill_module.get_skill.return_value = _make_skill()
        mock_create.return_value = MagicMock()
        svc = _mock_session_service()
        mock_get_svc.return_value = svc

        client = _make_client()
        resp = client.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={"skillId": _SKILL_ID},
        )
        assert resp.status_code == 204, resp.text

        mock_create.assert_called_once()
        kwargs = mock_create.call_args.kwargs
        assert kwargs["session_id"] == _SESSION_ID
        assert kwargs["skill_id"] == _SKILL_ID
        assert kwargs["owner_uid"] == _UID
        assert kwargs["document_ids"] == []

    @patch("protocols.session_bootstrap_routes.get_session_service")
    @patch("protocols.session_bootstrap_routes.create_session_index")
    @patch("protocols.session_bootstrap_routes.skill_config")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_also_creates_adk_session_under_canonical_app_name(
        self, mock_get_index, mock_skill_module, mock_create, mock_get_svc
    ):
        """Without this, iframe-context POSTs still 404 on the ADK
        session lookup even after the Firestore index is in place.
        Caught live by scripts/smoke-workspace-context.sh on 2026-05-21."""
        mock_get_index.return_value = None
        mock_skill_module.get_skill.return_value = _make_skill()
        svc = _mock_session_service()
        mock_get_svc.return_value = svc

        client = _make_client()
        resp = client.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={"skillId": _SKILL_ID},
        )
        assert resp.status_code == 204

        svc.create_session.assert_awaited_once()
        kwargs = svc.create_session.await_args.kwargs
        assert kwargs["app_name"] == "aitana_platform"
        assert kwargs["user_id"] == _UID
        assert kwargs["session_id"] == _SESSION_ID

    @patch("protocols.session_bootstrap_routes.get_session_service")
    @patch("protocols.session_bootstrap_routes.create_session_index")
    @patch("protocols.session_bootstrap_routes.skill_config")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_tolerates_adk_create_session_raising(self, mock_get_index, mock_skill_module, mock_create, mock_get_svc):
        """ADK create_session can raise on duplicate-create. Bootstrap
        should still return 204; the caller doesn't care about ADK-side
        idempotency semantics."""
        mock_get_index.return_value = None
        mock_skill_module.get_skill.return_value = _make_skill()
        svc = MagicMock()
        svc.create_session = AsyncMock(side_effect=RuntimeError("already exists"))
        mock_get_svc.return_value = svc

        client = _make_client()
        resp = client.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={"skillId": _SKILL_ID},
        )
        assert resp.status_code == 204

    @patch("protocols.session_bootstrap_routes.get_session_service")
    @patch("protocols.session_bootstrap_routes.create_session_index")
    @patch("protocols.session_bootstrap_routes.skill_config")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_is_idempotent_when_already_exists(self, mock_get_index, mock_skill_module, mock_create, mock_get_svc):
        # Already exists → no skill lookup, no create call, still 204.
        mock_get_index.return_value = MagicMock()
        mock_get_svc.return_value = _mock_session_service()

        client = _make_client()
        resp = client.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={"skillId": _SKILL_ID},
        )
        assert resp.status_code == 204
        mock_skill_module.get_skill.assert_not_called()
        mock_create.assert_not_called()


class TestAuthAndAccess:
    @patch("protocols.session_bootstrap_routes.create_session_index")
    @patch("protocols.session_bootstrap_routes.skill_config")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_returns_403_when_skill_does_not_exist(self, mock_get_index, mock_skill_module, mock_create):
        mock_get_index.return_value = None
        mock_skill_module.get_skill.return_value = None

        client = _make_client()
        resp = client.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={"skillId": "nope"},
        )
        # 403 not 404 — don't leak which skill ids exist
        assert resp.status_code == 403
        mock_create.assert_not_called()

    @patch("protocols.session_bootstrap_routes.create_session_index")
    @patch("protocols.session_bootstrap_routes.skill_config")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_returns_403_when_caller_cannot_access_skill(self, mock_get_index, mock_skill_module, mock_create):
        # Private skill owned by someone else; current user has no group_tags.
        private_skill = SkillConfig(
            skillId=_SKILL_ID,
            name=_SKILL_ID,
            description="private",
            ownerId="other-user",
            ownerEmail="other@example.com",
            accessControl=AccessControl(type="private"),
            skillMetadata={},
        )
        mock_get_index.return_value = None
        mock_skill_module.get_skill.return_value = private_skill

        client = _make_client(uid=_UID)
        resp = client.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={"skillId": _SKILL_ID},
        )
        assert resp.status_code == 403
        mock_create.assert_not_called()

    def test_returns_422_when_skill_id_missing(self):
        client = _make_client()
        resp = client.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={},
        )
        assert resp.status_code == 422

    def test_returns_422_when_extra_field_present(self):
        client = _make_client()
        resp = client.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={"skillId": _SKILL_ID, "evil": "x"},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# share-consent endpoint
# ---------------------------------------------------------------------------


def _make_session_index(owner_uid: str = _UID) -> MagicMock:
    idx = MagicMock()
    idx.owner_uid = owner_uid
    return idx


class TestShareConsent:
    @patch("protocols.session_bootstrap_routes.update_session_fields")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_owner_can_set_shared_true(self, mock_get_index, mock_update):
        mock_get_index.return_value = _make_session_index(owner_uid=_UID)
        client = _make_client(uid=_UID)
        resp = client.post(f"/api/sessions/{_SESSION_ID}/share-consent", json={"shared": True})
        assert resp.status_code == 204
        mock_update.assert_called_once_with(_SESSION_ID, {"sharedWithTeacher": True})

    @patch("protocols.session_bootstrap_routes.update_session_fields")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_owner_can_retract_consent(self, mock_get_index, mock_update):
        mock_get_index.return_value = _make_session_index(owner_uid=_UID)
        client = _make_client(uid=_UID)
        resp = client.post(f"/api/sessions/{_SESSION_ID}/share-consent", json={"shared": False})
        assert resp.status_code == 204
        mock_update.assert_called_once_with(_SESSION_ID, {"sharedWithTeacher": False})

    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_nonexistent_session_returns_404(self, mock_get_index):
        mock_get_index.return_value = None
        client = _make_client(uid=_UID)
        resp = client.post(f"/api/sessions/{_SESSION_ID}/share-consent", json={"shared": True})
        assert resp.status_code == 404

    @patch("protocols.session_bootstrap_routes.get_session_index")
    def test_wrong_owner_returns_403(self, mock_get_index):
        mock_get_index.return_value = _make_session_index(owner_uid="somebody-else")
        client = _make_client(uid=_UID)
        resp = client.post(f"/api/sessions/{_SESSION_ID}/share-consent", json={"shared": True})
        assert resp.status_code == 403

    def test_missing_shared_field_returns_422(self):
        client = _make_client()
        resp = client.post(f"/api/sessions/{_SESSION_ID}/share-consent", json={})
        assert resp.status_code == 422
