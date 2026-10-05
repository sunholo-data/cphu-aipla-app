"""1.1.151 F4 — "Mente du …?" for a mistyped join code.

Safe exactly when the suggestion is ONE deterministic correction of what was
typed and never a search of the code space: one word snapped to the public
word list, digits never touched, at most one suggestion, never an auto-join, a
revoked code indistinguishable from unknown, and every lookup paid for from the
same per-IP join bucket.
"""

from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("GROUP_AUTH_SIGNING_SECRET", "test-secret-for-pytest-only")

from auth.group_id_auth import AnonymousGroupAuth, _state, delete_group, normalize_join_code, upsert_group
from auth.group_routes import router
from auth.join_code_typos import canonicalise_code_shape, correct_words

LIVE = "kind-kettle-86"
IP = "203.0.113.50"


@pytest.fixture(autouse=True)
def isolate_state():
    AnonymousGroupAuth.reset_for_tests()
    yield
    AnonymousGroupAuth.reset_for_tests()


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _live(code: str = LIVE) -> None:
    upsert_group(code=code, title="Fysik C", skill_ids=["concept-dialogue"], creator_uid="teacher-1")


def _join(client: TestClient, code: str):
    return client.post("/api/auth/group/join", json={"group_id": code}, headers={"x-forwarded-for": IP})


# ─── silent normalisation ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("typed", "code"),
    [
        ("Kind-Kettle-86", "kind-kettle-86"),
        ("  kind kettle 86 ", "kind-kettle-86"),
        ("kind_kettle_86", "kind-kettle-86"),
        ("kind.kettle.86", "kind-kettle-86"),
        ("kind-kettle86", "kind-kettle-86"),
        ("kind-kettle-8o", "kind-kettle-80"),
        ("kind--kettle--86", "kind-kettle-86"),
        # Other code shapes are never reshaped.
        ("abcd-ef12", "abcd-ef12"),
        ("aipla-demo-1", "aipla-demo-1"),
        ("preview-bright-fox-42", "preview-bright-fox-42"),
    ],
)
def test_join_normalises_silently(typed, code):
    assert normalize_join_code(typed) == code


def test_a_silently_normalised_code_joins_without_a_suggestion(client):
    _live()
    resp = _join(client, "Kind Kettle 86")
    assert resp.status_code == 200, resp.text


# ─── the suggestion ─────────────────────────────────────────────────────────


def test_join_suggests_one_word_correction(client):
    _live()
    resp = _join(client, "kind-kettel-86")  # transposition, ≥ 6 letters → distance 2
    assert resp.status_code == 401
    body = resp.json()
    assert body["detail"] == "group not found or no longer active"
    assert body["suggestion"] == LIVE
    # Never an auto-join: no token in the refusal.
    assert "token" not in body


def test_join_suggests_for_a_short_word_one_edit_away(client):
    _live()
    assert _join(client, "kimd-kettle-86").json().get("suggestion") == LIVE


def test_join_never_corrects_digits(client):
    _live()
    for typed in ("kind-kettle-87", "kind-kettle-68", "kind-kettel-87"):
        body = _join(client, typed).json()
        assert "suggestion" not in body, typed


def test_no_suggestion_for_a_dead_correction(client):
    # "kind-kettel-86" corrects to a code nobody minted → nothing to offer.
    assert "suggestion" not in _join(client, "kind-kettel-86").json()


def test_revoked_code_not_suggested(client):
    _live()
    delete_group(LIVE, requesting_uid="teacher-1")
    body = _join(client, "kind-kettel-86").json()
    assert "suggestion" not in body
    # And typing the revoked code itself gets exactly the unknown-code answer.
    assert _join(client, LIVE).json() == {"detail": "group not found or no longer active"}


def test_suggestion_respects_rate_limit(client):
    _live()
    # Each typo costs the join token AND the suggestion token: 10 per window.
    bucket_before = None
    resp = _join(client, "kind-kettel-86")
    assert resp.json().get("suggestion") == LIVE
    bucket_before = _state.rate_limiter._buckets[IP].tokens
    assert bucket_before == pytest.approx(8, abs=0.1), "join + suggestion = two tokens"
    # Drain to exactly one token left: the next join spends it, so the
    # suggestion lookup finds the bucket empty and offers nothing.
    _state.rate_limiter._buckets[IP].tokens = 1.0
    resp = _join(client, "kind-kettel-86")
    assert resp.status_code == 401
    assert "suggestion" not in resp.json()
    # And the bucket being empty now means the next try is a 429, as before.
    assert _join(client, "kind-kettel-86").status_code == 429


# ─── the correction itself ──────────────────────────────────────────────────


def test_correct_words_is_one_deterministic_correction_or_none():
    assert correct_words("kind-kettel-86") == "kind-kettle-86"
    assert correct_words("kind-kettle-86") is None  # nothing to correct (digits never)
    assert correct_words("zzzz-kettle-86") is None  # no candidate
    assert correct_words("not-a-code") is None
    assert canonicalise_code_shape("kind-kettle-oo") == "kind-kettle-00"


def test_an_ambiguous_word_gets_no_suggestion():
    """A typo one edit from TWO list words is not corrected — one suggestion max."""
    from auth.group_id_wordlist import ADJECTIVES

    # Find a 3-5 letter adjective pair at distance 2 with a shared neighbour.
    from auth.join_code_typos import _edit_distance

    pairs = [
        (a, b)
        for a in ADJECTIVES
        for b in ADJECTIVES
        if a < b and len(a) == len(b) and len(a) <= 5 and _edit_distance(a, b, 2) == 1
    ]
    if not pairs:
        pytest.skip("no adjacent adjective pair in the word list")
    a, b = pairs[0]
    # A word equidistant (1) from both: change the differing letter to a third.
    idx = next(i for i, (x, y) in enumerate(zip(a, b, strict=True)) if x != y)
    for ch in "qxzjv":
        typo = a[:idx] + ch + a[idx + 1 :]
        if typo not in ADJECTIVES:
            break
    assert correct_words(f"{typo}-kettle-86") is None
