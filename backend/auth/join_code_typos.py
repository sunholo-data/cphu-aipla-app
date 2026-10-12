"""Mistyped join codes: silent normalisation and one "Mente du …?" (1.1.151 F4).

M, 2026-10-05: *"for mistyped join codes can we do a 'do you mean…?' — if
easy?"* Two 401s on ``/group/join`` during the seminar; the typed code is not
logged, so the shape of the typo is unknown.

It is easy, and safe, **if the suggestion never searches the code space**.
Codes are ``adjective-noun-NN`` from two PUBLIC 100-word lists
(``auth.group_id_wordlist``); the space is 10^6 and a join already answers
"exists / does not", rate-limited per IP. A suggestion is safe exactly when it
is ONE deterministic correction of what was typed — then it tells a guesser
nothing a second guess would not. So:

* **Normalise silently** (``canonicalise_code_shape``): spaces / underscores /
  dots for hyphens, a missing hyphen before the digits, letter O for zero in
  the digits. Case, whitespace and pasted links are handled by the caller,
  ``normalize_join_code``.
* **Snap a word to its list** (``correct_words``): a word not in its list is
  replaced iff EXACTLY ONE list word is within edit distance 1 (2 for words of
  six letters or more). Digits are NEVER corrected — any other two digits is
  just a different code.
* **Try it** (``suggest_join_code``): the corrected code is offered only if it
  is a live, unrevoked, unexpired code, and the lookup costs one token from the
  same per-IP join bucket. At most one suggestion; never an auto-join (a near
  miss could be another class's code — the student confirms).
"""

from __future__ import annotations

import logging
import re

from auth.group_id_wordlist import ADJECTIVES, NOUNS

logger = logging.getLogger(__name__)

_ADJ = frozenset(ADJECTIVES)
_NOUN = frozenset(NOUNS)
_SEPARATORS = re.compile(r"[\s_.]+")
_HYPHENS = re.compile(r"-{2,}")
_WORD_THEN_DIGITS = re.compile(r"^([a-z]+?)([0-9o]{2})$")
_DIGITS = re.compile(r"^[0-9o]{2}$")
_WORDLIST_CODE = re.compile(r"^([a-z]+)-([a-z]+)-([0-9]{2})$")


def canonicalise_code_shape(code: str) -> str:
    """Silent fixes for an already lower-cased, stripped code. Pure.

    Only reshapes; never changes a letter of a word or a digit's value
    (letter ``o`` in the two-digit slot is a zero, not a correction).
    """
    code = _SEPARATORS.sub("-", code)
    code = _HYPHENS.sub("-", code).strip("-")
    parts = code.split("-")
    # "kind-kettle86" → "kind-kettle-86" (a missing hyphen before the digits).
    # Guarded by a known word so a legacy ``XXXX-XXXX`` code ("abcd-ef12") is
    # never split.
    if len(parts) == 2 and parts[0].isalpha():
        m = _WORD_THEN_DIGITS.match(parts[1])
        if m and any(c.isdigit() for c in m.group(2)) and (parts[0] in _ADJ or m.group(1) in _NOUN):
            parts = [parts[0], m.group(1), m.group(2)]
    # "kind-kettle-8o" → "kind-kettle-80". Only in the digit slot of a
    # word-list-shaped code (one of its words known), so no other code
    # shape — preview-, demo, legacy — is ever touched.
    if (
        len(parts) == 3
        and parts[0].isalpha()
        and parts[1].isalpha()
        and _DIGITS.match(parts[2])
        and (parts[0] in _ADJ or parts[1] in _NOUN)
    ):
        parts[2] = parts[2].replace("o", "0")
    return "-".join(parts)


def _edit_distance(a: str, b: str, cap: int) -> int:
    """Levenshtein distance, giving up (returning cap+1) once it exceeds ``cap``."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def _snap(word: str, vocabulary: frozenset[str]) -> str | None:
    """The one list word ``word`` is a typo of, else None (none or several)."""
    if word in vocabulary:
        return word
    cap = 2 if len(word) >= 6 else 1
    hits = [w for w in vocabulary if _edit_distance(word, w, cap) <= cap]
    return hits[0] if len(hits) == 1 else None


def correct_words(code: str) -> str | None:
    """One deterministic word correction of a word-list-shaped code, or None.

    None when the code is not ``word-word-NN``, when both words are already in
    their lists (only the digits could be wrong, and digits are never
    corrected), or when a misspelt word has zero or several candidates.
    """
    m = _WORDLIST_CODE.match(code)
    if not m:
        return None
    adj, noun, digits = m.groups()
    if adj in _ADJ and noun in _NOUN:
        return None
    fixed_adj = _snap(adj, _ADJ)
    fixed_noun = _snap(noun, _NOUN)
    if fixed_adj is None or fixed_noun is None:
        return None
    corrected = f"{fixed_adj}-{fixed_noun}-{digits}"
    return corrected if corrected != code else None


def suggest_join_code(typed: str, *, client_ip: str) -> str | None:
    """A live code the caller probably meant, or None. Never raises.

    Costs one token from the caller's per-IP join bucket whenever a correction
    is actually looked up; when the bucket is empty there is no suggestion. A
    revoked or expired code is not suggested — indistinguishable from unknown,
    the join endpoint's existing privacy rule.
    """
    from auth.group_id_auth import (
        GroupExpired,
        GroupRevoked,
        _check_group_active,
        _state,
        get_group,
        normalize_join_code,
    )
    from auth.group_rate_limit import RateLimitExceeded

    try:
        candidate = correct_words(normalize_join_code(typed))
        if candidate is None:
            return None
        try:
            _state.rate_limiter.check(client_ip)
        except RateLimitExceeded:
            return None
        record = get_group(candidate)
        if record is None:
            return None
        try:
            _check_group_active(record)
        except (GroupRevoked, GroupExpired):
            return None
        logger.info("group_auth: join suggestion offered (one-word correction)")
        return candidate
    except Exception:
        logger.exception("group_auth: join suggestion failed")
        return None
