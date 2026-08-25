"""A blank Firestore collection or document id must fail at the call site.

Why this file exists: on 2026-08-21, in the first real teacher pilot session on
prod, every document upload returned 500. The cause was
``get_document("clients", "")`` — an anonymous-group student has ``domain=""``
(ADR-001), so the path became ``.../documents/clients/`` with a trailing slash
and Firestore answered ``InvalidArgument: 400 Document name``, raised from deep
inside gRPC where it reads like a service fault rather than a bad argument.

That exact bug had already been found and fixed on 2026-05-20 in
``auth/permissions.py``, which still carries a nine-line comment explaining it.
The knowledge was written down inside the codebase and did not reach the next
Firestore key site. So the guard belongs at the shared helper, where every
future caller inherits it.

``ValueError`` deliberately, not a ``None`` return: returning ``None`` would fold
"you passed garbage" into "no such document", which is the conflation that makes
a broken read indistinguishable from a real answer.
"""

from __future__ import annotations

import pytest

from db import firestore as fs


def _mutating_helpers():
    """The write helpers, each with the extra args it needs past doc_id."""
    return [
        ("set_document", ({"a": 1},)),
        ("update_document", ({"a": 1},)),
        ("delete_document", ()),
    ]


class TestBlankDocumentId:
    def test_get_document_rejects_a_blank_doc_id(self):
        with pytest.raises(ValueError, match="clients"):
            fs.get_document("clients", "")

    def test_get_document_rejects_a_whitespace_doc_id(self):
        """An anonymous user's domain is ``""``; a mis-stripped one is ``" "``.
        Firestore rejects both — so must we, and for the same reason."""
        with pytest.raises(ValueError):
            fs.get_document("clients", "   ")

    @pytest.mark.parametrize("name,extra", _mutating_helpers())
    def test_write_helpers_reject_a_blank_doc_id(self, name, extra):
        with pytest.raises(ValueError, match="clients"):
            getattr(fs, name)("clients", "", *extra)


class TestBlankCollection:
    def test_get_document_rejects_a_blank_collection(self):
        with pytest.raises(ValueError):
            fs.get_document("", "some-doc")

    @pytest.mark.parametrize("name,extra", _mutating_helpers())
    def test_write_helpers_reject_a_blank_collection(self, name, extra):
        with pytest.raises(ValueError):
            getattr(fs, name)("", "some-doc", *extra)


class TestTheErrorIsActionable:
    def test_the_message_names_the_collection_and_the_argument(self):
        """A 500 that says 'Document name ...clients/' sends you to Firestore.
        The point of raising here is that it sends you to the CALLER instead."""
        with pytest.raises(ValueError) as excinfo:
            fs.get_document("teacher_access", "")

        message = str(excinfo.value)
        assert "teacher_access" in message
        assert "doc_id" in message

    def test_a_real_looking_id_is_not_rejected(self):
        """The guard must not fire on legitimate ids — it runs before every
        Firestore read in the backend."""
        from unittest.mock import MagicMock, patch

        client = MagicMock()
        client.collection.return_value.document.return_value.get.return_value.exists = False

        with patch("db.firestore.get_client", return_value=client):
            assert fs.get_document("clients", "ku.dk") is None

        client.collection.assert_called_once_with("clients")
