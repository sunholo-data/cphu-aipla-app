"""normalize_tags — canonical-form rules (1.1.58 M1)."""

from __future__ import annotations

from db.models.curriculum import MAX_TAG_LEN, MAX_TAGS, normalize_tags


def test_none_and_empty():
    assert normalize_tags(None) == []
    assert normalize_tags([]) == []
    assert normalize_tags(["", "   ", None]) == []


def test_lowercase_trim_dedupe_order_preserving():
    assert normalize_tags([" Lab ", "EXAM", "lab", "exam", "Mekanik"]) == ["lab", "exam", "mekanik"]


def test_truncates_each_tag_and_the_list():
    long = "x" * (MAX_TAG_LEN + 10)
    assert normalize_tags([long]) == ["x" * MAX_TAG_LEN]
    many = [f"t{i}" for i in range(MAX_TAGS + 5)]
    assert len(normalize_tags(many)) == MAX_TAGS
