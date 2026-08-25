"""Client domain → GCS bucket resolution.

Each client organisation maps to its own GCS bucket, keyed by email domain.
Firestore `clients/{domain}` stores the mapping. Falls back to the
DOCUMENTS_BUCKET env var for unmapped domains (dev, internal users).
"""

from __future__ import annotations

import os

from pydantic import BaseModel, ConfigDict

from db.firestore import get_document

_COLLECTION = "clients"


class ClientConfig(BaseModel):
    """Firestore document at `clients/{domain}`."""

    domain: str
    documents_bucket: str | None = None
    display_name: str = ""

    model_config = ConfigDict(populate_by_name=True)


def get_client_sync(domain: str) -> ClientConfig | None:
    """Return the ClientConfig for a domain, or None if not found."""
    data = get_document(_COLLECTION, domain)
    if data is None:
        return None
    return ClientConfig(domain=domain, **data)


def _default_documents_bucket() -> str:
    """The env-configured bucket, or a loud failure.

    There used to be a hardcoded `"aitana-documents-bucket"` default here. That
    bucket belongs to the UPSTREAM Aitana project, not to any AIPLA environment,
    and DOCUMENTS_BUCKET was in fact set on none of dev/test/prod — so every
    resolution silently returned a bucket this project's service account cannot
    reach, and nothing said so. Missing config must fail where it is missing.
    """
    bucket = os.environ.get("DOCUMENTS_BUCKET", "").strip()
    if not bucket:
        raise RuntimeError(
            "DOCUMENTS_BUCKET is not set. It must be configured per environment "
            "(cloudbuild.yaml for dev/test, cloudbuild.promote.yaml for prod) and "
            "the bucket created in infrastructure/env/storage.tf."
        )
    return bucket


def resolve_documents_bucket(user: User) -> str:  # type: ignore[name-defined]  # noqa: F821
    """Return the GCS bucket name for the user's email domain.

    Looks up `clients/{domain}` in Firestore. Falls back to the
    DOCUMENTS_BUCKET env var when no mapping exists or the mapping
    has no documents_bucket set.

    An anonymous-group student (ADR-001) has `domain == ""` and `email == ""`,
    so there is no client mapping to look up and the lookup is skipped entirely
    — asking Firestore for `clients/""` is not an empty result, it is a 400 that
    surfaces as a 500. This is the guard that was missing on 2026-08-21, when
    every document upload in the teacher pilot failed. Same shape as the
    `if user_email:` guard in `auth/permissions.py`.
    """
    domain = user.domain or (user.email.split("@")[1] if "@" in user.email else "")
    if not domain:
        return _default_documents_bucket()

    client = get_client_sync(domain)
    if client and client.documents_bucket:
        return client.documents_bucket
    return _default_documents_bucket()


def resolve_channel_bucket() -> str:
    """Return the GCS bucket for files arriving via channel webhooks.

    Channel attachments don't carry the user's email domain in a way
    the upload path can rely on (a Discord user might have no email at
    all), so we use a single shared bucket per deployment. Defaults
    to the same value as `resolve_documents_bucket`'s fallback so the
    "user library" view shows channel uploads alongside web uploads.

    Forks that want per-channel buckets (e.g., one for Discord, one
    for email) set CHANNEL_DOCUMENTS_BUCKET to override.
    """
    return os.environ.get("CHANNEL_DOCUMENTS_BUCKET", "").strip() or _default_documents_bucket()
