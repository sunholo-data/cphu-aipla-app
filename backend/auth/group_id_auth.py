"""Anonymous group-ID auth — the fourth auth mode.

Sprint 2.11 (v6.2.0). Short-code session join, no persistent accounts,
no PII. A teacher (or admin) signed in via Firebase calls
``create_group(...)`` to mint a short alphanumeric code; anyone who
knows the code calls ``join_group(code, client_ip)`` to get a signed
HS256 JWT. The JWT body carries a synthetic ``sub`` (uid),
``group_id``, ``exp``, ``iat``, ``auth_mode="anonymous_group_id"``.

The rest of the platform accepts this token via
``auth.__init__.get_current_user``'s shape-dispatcher (M2), producing
a ``User`` with ``email="" / domain="" / auth_mode + group_id set``.
That ``User`` flows into the existing permission system, which falls
back to `group/<group_id>` permission lookups for anonymous-group
users (also M2).

Threat model + axiom alignment (SECURE_BY_CONSTRUCTION = -2):
docs/design/v6.2.0/anonymous-group-id-auth.md §"Security Considerations".

This module ships seven gates on ``join_group``; each is exercised by
a ``test_gate_N_<name>`` case in ``tests/unit/test_group_id_auth.py``.

Storage: in-memory ``dict[group_id, GroupRecord]`` for fast-path,
Firestore for persistence across Cloud Run instances and restarts.
Write-through on create/delete; read-fallback on get_group when the
in-memory cache misses. Without this AIPLA v0.1 would need to pin
Cloud Run to a single instance — the whole point of serverless gone.
AIPLA 2026-05-20 — closes the TODO at line 25 of the original module
docstring ("Firestore wiring lands in M2").
"""

from __future__ import annotations

import logging
import os
import secrets
import time
from dataclasses import asdict, dataclass, field

import jwt

from auth.firebase_auth import User
from auth.group_rate_limit import TokenBucketRateLimiter

logger = logging.getLogger(__name__)


# ─── Configuration ──────────────────────────────────────────────────────────

GROUP_AUTH_SIGNING_SECRET_ENV = "GROUP_AUTH_SIGNING_SECRET"
AUTH_MODE = "anonymous_group_id"
JWT_ALGORITHM = "HS256"
DEFAULT_GROUP_CODE_TTL_DAYS = 30
DEFAULT_MAX_CONCURRENT_SESSIONS = 100
DEFAULT_TOKEN_LIFETIME_SECONDS = 8 * 3600  # 8 hours
# Alphabet excludes ambiguous chars (0/O/1/I) per design.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LEN_BEFORE_HYPHEN = 4
_CODE_LEN_AFTER_HYPHEN = 4
_UID_SUFFIX_BYTES = 16  # 128 bits — collision-proof


# ─── Exceptions ─────────────────────────────────────────────────────────────


class GroupNotFound(Exception):
    """Unknown group_id at join time. Distinct from GroupRevoked for telemetry."""


class GroupRevoked(Exception):
    """Group was explicitly deleted by its creator. All tokens invalidated."""


class GroupExpired(Exception):
    """Group's TTL has elapsed."""


class GroupSessionCapExceeded(Exception):
    """Per-group concurrent-session cap reached for the current day."""


class InvalidGroupToken(Exception):
    """Token failed verification (signature, expiry, missing claims, etc.)."""


# ─── Data types ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GroupRecord:
    """A group as persisted (in-memory for v1). Created by ``create_group``."""

    group_id: str
    creator_uid: str
    title: str
    skill_ids: tuple[str, ...]
    created_at: float
    expires_at: float
    max_concurrent_sessions: int


@dataclass(frozen=True)
class JoinResult:
    """Return shape of ``join_group``. Wire format mirrors design §API."""

    token: str
    uid: str
    expires_at: float
    skill_ids: tuple[str, ...] = ()
    """Skills the group has permission to invoke. Live-resolved from
    Class.lessons when the code is class-bound; falls back to the stored
    GroupRecord.skill_ids for unbound (pre-v1) codes."""
    class_name: str | None = None
    """Human-readable class name (e.g. "Hold 9A"). Null for unbound codes."""
    class_id: str | None = None
    """Firestore class_id for the bound class. Null for unbound codes."""


# ─── State holder (module-level singleton) ──────────────────────────────────


@dataclass
class AnonymousGroupAuth:
    """Module-level state container. Single instance per process.

    Exposed as a class (rather than module-level globals) so tests can
    reset it cleanly via ``reset_for_tests()``.

    Clock injection is done at the MODULE level (``_state.time_provider``
    sets the module callable) rather than as a dataclass field — a
    dataclass field would be assigned at instance-init time and shadow
    later overrides. See ``time_provider`` property below.
    """

    groups: dict[str, GroupRecord] = field(default_factory=dict)
    """Active groups indexed by group_id."""

    revoked_group_ids: set[str] = field(default_factory=set)
    """Group ids that have been explicitly deleted. Distinct from
    'never existed' so error messages can be specific."""

    sessions_today: dict[tuple[str, str], int] = field(default_factory=dict)
    """Per-group session counter, keyed by (group_id, YYYY-MM-DD)."""

    rate_limiter: TokenBucketRateLimiter = field(default_factory=TokenBucketRateLimiter)

    # NOTE: ``time_provider`` lives on the CLASS (not as a dataclass
    # field) so tests can override it for the whole module by writing
    # ``AnonymousGroupAuth.time_provider = staticmethod(lambda: t)``
    # — the override sticks because instance lookup falls through to
    # the class attribute.

    @classmethod
    def reset_for_tests(cls) -> None:
        """Drop every group, revoked id, session count, and bucket.

        Called by the ``isolate_state`` autouse fixture in
        ``test_group_id_auth.py`` so each test starts clean.
        """
        _state.groups.clear()
        _state.revoked_group_ids.clear()
        _state.sessions_today.clear()
        _state.rate_limiter.reset_all()

    @classmethod
    def user_from_token(cls, token: str) -> User:
        """Build a User from a verified group token.

        ``email`` and ``domain`` are empty strings (no PII). The
        ``auth_mode`` field signals downstream code to use group-level
        permission lookups.

        Class binding (1.A M5): when the group code is bound to a class
        (``anon_groups/<code>.classId`` set), the JWT carries
        ``group_tags={class.tag_namespace}`` so the existing tagged-
        access evaluator picks up the binding. A revoked class —
        whether soft-deleted (``revoked=True``) or hard-deleted (doc
        gone) — rejects the token at this layer, even if the JWT itself
        is otherwise valid. This is the live-revocation guarantee.

        """
        claims = verify_group_token(token)
        group_id = claims["group_id"]
        group_tags = _resolve_class_tags(group_id)
        return User(
            uid=claims["sub"],
            email="",
            domain="",
            group_tags=group_tags,
            auth_mode=AUTH_MODE,
            group_id=group_id,
            is_teacher=False,
        )


# Module-level clock injection point. Mutable by tests via
# ``AnonymousGroupAuth.time_provider = staticmethod(lambda: t)``.
# Living on the CLASS (not as a dataclass field) means tests can
# reassign it and instance lookups (via _state.time_provider) fall
# through to the class attr.
AnonymousGroupAuth.time_provider = staticmethod(time.time)

_state = AnonymousGroupAuth()


# ─── Internal helpers ───────────────────────────────────────────────────────


def _resolve_class_tags(group_id: str) -> frozenset[str]:
    """Look up the class binding for a group code and return its
    tag_namespace as a single-element frozenset, or empty for unbound
    codes.

    Three cases:
      1. anon_groups doc missing entirely (cloud-mode Firestore write
         failed, or pre-2.11 in-memory-only code): empty tags — the
         in-memory ``_state.groups`` record already proved the JWT is
         legitimate at the verify_group_token layer.
      2. anon_groups doc exists with no ``classId``: pre-v1 unbound
         code, empty tags. Preserves the v0.1 demo flow.
      3. anon_groups doc exists with ``classId`` pointing to a
         soft-deleted OR missing class: raise ``GroupRevoked``. This
         is the live-revocation guarantee — once a teacher revokes a
         class, every JWT under it stops working on the next verify
         regardless of when it was minted.

    Case 3 only fires when there's an explicit class binding to check.
    Cases 1 and 2 fall through cleanly to the pre-v1 zero-tags
    behaviour, so this addition is non-breaking for any code that
    doesn't opt into the class binding.
    """
    # Lazy import — db.classes lazy-imports auth.group_id_auth.create_group
    # so we avoid the circular at top-of-module load.
    from db.classes import get_class
    from db.firestore import get_document

    anon_doc = get_document("anon_groups", group_id)
    if anon_doc is None:
        return frozenset()

    class_id = anon_doc.get("classId")
    if not class_id:
        return frozenset()

    cls = get_class(class_id)
    if cls is None:
        raise GroupRevoked(f"group {group_id!r} bound to class {class_id!r} which no longer exists")
    if cls.revoked:
        raise GroupRevoked(f"group {group_id!r} bound to revoked class {class_id!r}")

    return frozenset({cls.tag_namespace})


def _signing_secret() -> str:
    """Read the signing secret from env. Fail loud if missing or empty.

    Module IMPORT must succeed (so tests + tooling don't blow up
    before reading the env). The secret is required at the first
    create/join/verify call.
    """
    secret = os.environ.get(GROUP_AUTH_SIGNING_SECRET_ENV, "")
    if not secret:
        raise RuntimeError(
            f"{GROUP_AUTH_SIGNING_SECRET_ENV} env var is required for "
            f"anonymous group-ID auth. Set it to a long random string "
            f"(rotate to invalidate all live tokens)."
        )
    return secret


def _generate_code() -> str:
    """Mint a human-readable code teachers can shout across a classroom.

    Shape: ``<adjective>-<noun>-<NN>`` (e.g. ``bright-fox-42``). At
    100 adjectives by 100 nouns by 100 two-digit suffixes, that's 1M
    unique codes — plenty for AIPLA's scale. Combined with the
    10-attempts/min/IP rate limit at /join, it's not enumerable.

    Why not the legacy ``XXXX-XXXX`` alphabet? Because the v0.1
    Jutland-demo blocker was teachers having to read a string of
    ambiguous-but-not-ambiguous-enough characters aloud — "is that
    H or N? Q or Q?". Words remove that failure mode entirely.

    All-lowercase, ASCII, hyphen-separated → keyboard-independent.
    Wordlist + curation rules live in `group_id_wordlist.py`.
    """
    from auth.group_id_wordlist import ADJECTIVES, NOUNS

    adj = secrets.choice(ADJECTIVES)
    noun = secrets.choice(NOUNS)
    # Two-digit numeric suffix (00-99) avoids the most common collision
    # (two teachers minting the same adjective+noun in the same week).
    nn = f"{secrets.randbelow(100):02d}"
    return f"{adj}-{noun}-{nn}"


def _today_iso() -> str:
    """YYYY-MM-DD in UTC for session-cap bucketing."""
    return time.strftime("%Y-%m-%d", time.gmtime(AnonymousGroupAuth.time_provider()))


def _synthesize_uid(group_id: str) -> str:
    """Per-join synthetic uid. Shape: `anon-<group_id>-<random_hex>`."""
    suffix = secrets.token_hex(_UID_SUFFIX_BYTES)
    # Include group_id (hyphens stripped) so the uid is intuitively
    # tied to its group; the random suffix guarantees uniqueness.
    cleaned = group_id.replace("-", "")
    return f"anon-{cleaned}-{suffix}"


def _check_group_active(record: GroupRecord) -> None:
    """Common gate logic: revoked? expired? Raise typed exception."""
    if record.group_id in _state.revoked_group_ids:
        raise GroupRevoked(f"group {record.group_id} has been revoked")
    if AnonymousGroupAuth.time_provider() >= record.expires_at:
        raise GroupExpired(f"group {record.group_id} expired")


# ─── Firestore persistence (write-through; read-fallback in get_group) ──────
#
# AIPLA 2026-05-20: keeps Cloud Run serverless (no min-instances pin needed)
# by promoting group state to Firestore. Pattern: every create/delete writes
# through to Firestore *and* updates in-memory cache. get_group prefers the
# in-memory hit; on miss, falls back to Firestore and re-hydrates the cache.
#
# Why a small helper rather than refactor AnonymousGroupAuth: the public API
# surface (create_group/get_group/delete_group/join_group) stays identical;
# every existing test in tests/unit/test_group_id_auth.py still pins to the
# in-memory _state directly via reset_for_tests, and the InMemoryFirestoreClient
# in LOCAL_MODE means the persistence layer is a no-op-ish round trip there.

_GROUPS_COLLECTION = "anon_groups"


def _record_to_doc(record: GroupRecord) -> dict:
    """Serialize a GroupRecord for Firestore (tuples → lists)."""
    data = asdict(record)
    data["skill_ids"] = list(data["skill_ids"])
    data["revoked"] = False
    return data


def _doc_to_record(doc: dict) -> GroupRecord:
    """Deserialize Firestore doc → GroupRecord (lists → tuples).

    Drops the persistence-only `revoked` flag; callers handle that
    separately via the revoked set.
    """
    return GroupRecord(
        group_id=doc["group_id"],
        creator_uid=doc["creator_uid"],
        title=doc["title"],
        skill_ids=tuple(doc.get("skill_ids", [])),
        created_at=doc["created_at"],
        expires_at=doc["expires_at"],
        max_concurrent_sessions=doc["max_concurrent_sessions"],
    )


def _persist_group(record: GroupRecord) -> None:
    """Write a group to Firestore. Best-effort: log + skip on failure."""
    try:
        from db import firestore as fs

        fs.set_document(_GROUPS_COLLECTION, record.group_id, _record_to_doc(record))
    except Exception:
        logger.exception("group_auth: failed to persist group=%s", record.group_id)


def _load_group_from_firestore(group_id: str) -> GroupRecord | None:
    """Read a group from Firestore. Returns None for missing or revoked."""
    try:
        from db import firestore as fs

        doc = fs.get_document(_GROUPS_COLLECTION, group_id)
        if not doc or doc.get("revoked"):
            return None
        return _doc_to_record(doc)
    except Exception:
        logger.exception("group_auth: failed to load group=%s from firestore", group_id)
        return None


def _mark_revoked_in_firestore(group_id: str) -> None:
    """Flag a Firestore-persisted group as revoked. Best-effort."""
    try:
        from db import firestore as fs

        fs.update_document(_GROUPS_COLLECTION, group_id, {"revoked": True})
    except Exception:
        logger.exception("group_auth: failed to mark revoked group=%s", group_id)


# ─── Public API: lifecycle ──────────────────────────────────────────────────


def create_group(
    *,
    title: str,
    skill_ids: list[str] | tuple[str, ...],
    creator_uid: str,
    ttl_days: int = DEFAULT_GROUP_CODE_TTL_DAYS,
    max_concurrent_sessions: int = DEFAULT_MAX_CONCURRENT_SESSIONS,
) -> GroupRecord:
    """Mint a new group code. Called by the teacher-facing endpoint (M2).

    Args:
        title: Free-form, for display + audit. Not on the JWT.
        skill_ids: Which skills the group's members can access. The
            permission system (M2) reads this list when deciding
            ``can_use_tool`` for anonymous-group users.
        creator_uid: The teacher's Firebase uid. Required for the
            revoke gate ("only the creator can delete").
        ttl_days: Days until the group expires. Default 30. AIPLA teachers
            may pass longer values (up to a full school year ~300 days) when
            the teacher-choice TTL flag ships — see
            docs/design/aipla/v1.1.0-feedback/teacher-choice-ttl.md.
        max_concurrent_sessions: Per-group cap (default 100/day).
    """
    # Verify the signing secret early — fail loud BEFORE we mint state.
    _signing_secret()

    now = AnonymousGroupAuth.time_provider()
    code = _generate_code()
    # Defensive: regenerate if collision (vanishingly rare; loop bounded).
    while code in _state.groups or code in _state.revoked_group_ids:
        code = _generate_code()

    record = GroupRecord(
        group_id=code,
        creator_uid=creator_uid,
        title=title,
        skill_ids=tuple(skill_ids),
        created_at=now,
        expires_at=now + ttl_days * 86400,
        max_concurrent_sessions=max_concurrent_sessions,
    )
    _state.groups[code] = record
    _persist_group(record)
    logger.info(
        "group_auth: created group=%s creator=%s ttl_days=%d skills=%d cap=%d",
        code,
        creator_uid,
        ttl_days,
        len(skill_ids),
        max_concurrent_sessions,
    )
    return record


def upsert_group(
    *,
    code: str,
    title: str,
    skill_ids: list[str] | tuple[str, ...],
    creator_uid: str,
    ttl_days: int = DEFAULT_GROUP_CODE_TTL_DAYS,
    max_concurrent_sessions: int = DEFAULT_MAX_CONCURRENT_SESSIONS,
) -> tuple[GroupRecord, bool]:
    """Create-or-extend a group with a CALLER-CHOSEN code.

    Differs from ``create_group`` in three ways:
      1. The caller passes ``code`` explicitly (random-mint case stays
         on ``create_group``).
      2. If the code already exists, the record's ``expires_at`` is
         extended to ``now + ttl_days * 86400`` without resetting
         created_at / creator_uid / skill_ids / max_concurrent_sessions.
      3. Returns ``(record, created)`` where ``created`` is True on the
         first-time-create path and False when extending an existing.

    Designed for deploy-time demo-code seeding (cloudbuild.yaml). The
    intent is "guarantee these N codes are alive for the next N days,
    every deploy" — extending TTL on the same code rather than cluttering
    Firestore with daily new codes. Idempotency by code is the
    load-bearing property.

    Raises:
        ValueError: ``code`` doesn't match the wordlist-shape sanity
            check (currently relaxed to any non-empty kebab-cased
            string; full enforcement lives in the route layer).
        GroupRevoked: code matches a previously revoked group. We
            refuse to silently un-revoke — the operator must mint a
            fresh code.
    """
    if not isinstance(code, str) or not code.strip():
        raise ValueError("code must be a non-empty string")
    if code in _state.revoked_group_ids:
        raise GroupRevoked(f"code {code} was previously revoked")

    # Verify the signing secret early — same boundary as create_group.
    _signing_secret()

    now = AnonymousGroupAuth.time_provider()
    new_expires = now + ttl_days * 86400

    existing = get_group(code)
    if existing is not None:
        extended = GroupRecord(
            group_id=existing.group_id,
            creator_uid=existing.creator_uid,
            title=existing.title,
            skill_ids=existing.skill_ids,
            created_at=existing.created_at,
            expires_at=new_expires,
            max_concurrent_sessions=existing.max_concurrent_sessions,
        )
        _state.groups[code] = extended
        _persist_group(extended)
        logger.info(
            "group_auth: extended group=%s new_ttl_days=%d new_expires=%.0f",
            code,
            ttl_days,
            new_expires,
        )
        return extended, False

    record = GroupRecord(
        group_id=code,
        creator_uid=creator_uid,
        title=title,
        skill_ids=tuple(skill_ids),
        created_at=now,
        expires_at=new_expires,
        max_concurrent_sessions=max_concurrent_sessions,
    )
    _state.groups[code] = record
    _persist_group(record)
    logger.info(
        "group_auth: upserted (created) group=%s creator=%s ttl_days=%d skills=%d cap=%d",
        code,
        creator_uid,
        ttl_days,
        len(skill_ids),
        max_concurrent_sessions,
    )
    return record, True


def get_group(group_id: str) -> GroupRecord | None:
    """Lookup; returns None for missing or revoked.

    Fast path: in-memory cache. Cold path: Firestore (rehydrates the
    cache on hit so subsequent calls on this instance are fast). This
    is what makes serverless Cloud Run work — group state minted on
    one instance is visible to a join request on another.
    """
    if group_id in _state.revoked_group_ids:
        return None
    cached = _state.groups.get(group_id)
    if cached is not None:
        return cached
    # Cold-start / cross-instance: fall back to Firestore and rehydrate.
    loaded = _load_group_from_firestore(group_id)
    if loaded is not None:
        _state.groups[group_id] = loaded
    return loaded


def delete_group(group_id: str, requesting_uid: str) -> None:
    """Revoke a group. Only the creator may delete.

    Sets the group_id in ``revoked_group_ids`` (not just deletes from
    ``groups``) so ``verify_group_token`` can distinguish revoked from
    never-existed for telemetry.

    Raises:
        PermissionError: caller is not the creator.
        GroupNotFound: group never existed (or was already gone).
    """
    record = _state.groups.get(group_id)
    if record is None:
        # Revoking a non-existent group is a no-op for idempotency,
        # but we raise so the route can return a clean 404.
        raise GroupNotFound(f"group {group_id} not found")
    if record.creator_uid != requesting_uid:
        logger.warning(
            "group_auth: refused revoke uid=%s creator=%s group=%s",
            requesting_uid,
            record.creator_uid,
            group_id,
        )
        raise PermissionError(f"only the group's creator ({record.creator_uid}) may revoke it")
    _state.groups.pop(group_id, None)
    _state.revoked_group_ids.add(group_id)
    _mark_revoked_in_firestore(group_id)
    logger.info("group_auth: revoked group=%s by uid=%s", group_id, requesting_uid)


# ─── Public API: join ───────────────────────────────────────────────────────


def join_group(group_id: str, *, client_ip: str) -> JoinResult:
    """Mint a token for a caller holding a valid group code.

    Seven gates in order — see design doc §"Implementation Plan / Phase 1".

    Args:
        group_id: The short code the caller is presenting.
        client_ip: For per-IP rate limiting (gate #5). Caller (the
            route) is responsible for passing the verified peer IP.

    Returns:
        JoinResult with the signed token + synthetic uid + expires_at.

    Raises:
        - TypeError / ValueError: gate #1 (malformed args)
        - GroupNotFound: gate #2
        - GroupExpired: gate #3
        - GroupRevoked: gate #4
        - RateLimitExceeded: gate #5
        - GroupSessionCapExceeded: gate #6
    """
    # Gate 1: type validation at function boundary (route layer adds
    # Pydantic 422 for body shape).
    if not isinstance(group_id, str) or not group_id:
        raise ValueError("group_id must be a non-empty string")
    if not isinstance(client_ip, str) or not client_ip:
        raise ValueError("client_ip must be a non-empty string")

    # Normalize: codes are case-insensitive + whitespace-tolerant so
    # "Bright-Fox-42" / " bright-fox-42 " / "BRIGHT-FOX-42" all hit the
    # same record. Mint outputs are always lowercase (see _generate_code).
    group_id = group_id.strip().lower()

    # Gate 5 (rate limit) is FIRST so brute-force attempts don't even
    # get to learn whether the group exists.
    _state.rate_limiter.check(client_ip)

    # Gates 2 + 4: lookup, revocation. Uses get_group() so a cold-start
    # container (in-memory cache empty) can still validate codes minted
    # by a previous instance — Firestore is the source of truth.
    if group_id in _state.revoked_group_ids:
        raise GroupRevoked(f"group {group_id} has been revoked")
    record = get_group(group_id)
    if record is None:
        raise GroupNotFound(f"group {group_id} not found")

    # Gate 3: expiry.
    _check_group_active(record)

    # Gate 6: per-group session cap (per-day).
    cap_key = (group_id, _today_iso())
    current = _state.sessions_today.get(cap_key, 0)
    if current >= record.max_concurrent_sessions:
        raise GroupSessionCapExceeded(f"group {group_id} reached daily session cap ({record.max_concurrent_sessions})")

    # Gate 7: happy path — mint token.
    now = AnonymousGroupAuth.time_provider()
    uid = _synthesize_uid(group_id)
    exp = now + DEFAULT_TOKEN_LIFETIME_SECONDS
    claims = {
        "sub": uid,
        "group_id": group_id,
        "exp": exp,
        "iat": now,
        "auth_mode": AUTH_MODE,
    }
    token = jwt.encode(claims, _signing_secret(), algorithm=JWT_ALGORITHM)
    _state.sessions_today[cap_key] = current + 1
    logger.info(
        "group_auth: joined group=%s uid=%s session_n=%d",
        group_id,
        uid,
        current + 1,
    )

    # Live-resolve class context. If the code is bound to a class, use the
    # class's current lesson list instead of the snapshot in GroupRecord so
    # teachers can add/remove lessons without re-minting codes.
    live_skill_ids = record.skill_ids
    resolved_class_name: str | None = None
    resolved_class_id: str | None = None

    from db.classes import get_class
    from db.firestore import get_document

    anon_doc = get_document("anon_groups", group_id)
    if anon_doc:
        bound_class_id = anon_doc.get("classId")
        if bound_class_id:
            cls = get_class(bound_class_id)
            if cls and not cls.revoked:
                live_skill_ids = tuple(cls.lessons)
                resolved_class_name = cls.name
                resolved_class_id = cls.class_id

    return JoinResult(
        token=token,
        uid=uid,
        expires_at=exp,
        skill_ids=live_skill_ids,
        class_name=resolved_class_name,
        class_id=resolved_class_id,
    )


# ─── Public API: verify ─────────────────────────────────────────────────────


def verify_group_token(token: str) -> dict:
    """Verify a JWT minted by ``join_group``.

    Returns the decoded claims dict on success. Raises ``InvalidGroupToken``
    for ANY failure (bad signature, wrong algorithm, expired, missing
    required claims). ``GroupRevoked`` is raised separately so callers
    can distinguish "expired" from "actively-revoked-by-creator".
    """
    try:
        claims = jwt.decode(
            token,
            _signing_secret(),
            algorithms=[JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError as exc:
        raise InvalidGroupToken("token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise InvalidGroupToken(f"token invalid: {exc}") from exc

    # Claim shape check.
    required = {"sub", "group_id", "exp", "iat", "auth_mode"}
    if set(claims.keys()) != required:
        raise InvalidGroupToken(f"token claims must be {sorted(required)}; got {sorted(claims.keys())}")
    if claims["auth_mode"] != AUTH_MODE:
        raise InvalidGroupToken(f"token auth_mode is {claims['auth_mode']!r}, expected {AUTH_MODE!r}")

    # Revocation check (cross-reference state). Distinct exception
    # type so the route layer can pick a different status code if it
    # wants (we return 401 in both cases by design, but telemetry
    # benefits from the distinction).
    if claims["group_id"] in _state.revoked_group_ids:
        raise GroupRevoked(f"group {claims['group_id']} revoked")

    return claims


__all__ = [
    "AUTH_MODE",
    "GROUP_AUTH_SIGNING_SECRET_ENV",
    "AnonymousGroupAuth",
    "GroupExpired",
    "GroupNotFound",
    "GroupRecord",
    "GroupRevoked",
    "GroupSessionCapExceeded",
    "InvalidGroupToken",
    "JoinResult",
    "create_group",
    "delete_group",
    "get_group",
    "join_group",
    "upsert_group",
    "verify_group_token",
]
