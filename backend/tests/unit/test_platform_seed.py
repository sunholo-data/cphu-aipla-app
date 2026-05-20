"""Unit tests for backend/admin/platform_seed.py.

The seeder reads backend/skills/templates/*/SKILL.md, parses YAML
frontmatter + markdown body, and creates each as a platform-owned
public skill. Idempotent: skips any template whose `name` already exists
in Firestore.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from admin.platform_seed import SeedSummary, _parse_template, seed
from db.models import SkillConfig


def _fake_template_dir(tmp_path, name: str, body: str = "Be helpful.", metadata: dict | None = None):
    md = metadata or {"model": "gemini-2.5-flash"}
    content = "---\n"
    content += f"name: {name}\n"
    content += "description: >\n  Do things.\n"
    content += "metadata:\n"
    for k, v in md.items():
        content += f"  {k}: {v}\n"
    content += "---\n\n"
    content += body + "\n"
    skill_dir = tmp_path / name
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(content)
    return tmp_path


def _make_config(name: str, **overrides) -> SkillConfig:
    defaults = {
        "name": name,
        "skillId": f"platform-{name}",
        "ownerId": "aitana-platform",
        "ownerEmail": "platform@aitanalabs.com",
        "accessControl": {"type": "public"},
    }
    defaults.update(overrides)
    return SkillConfig(**defaults)


# === _parse_template ===


def test_parse_template_extracts_frontmatter_and_body(tmp_path):
    _fake_template_dir(tmp_path, "alpha", body="Help the user.")
    parsed = _parse_template(tmp_path / "alpha" / "SKILL.md")
    assert parsed["name"] == "alpha"
    assert "Help the user" in parsed["instructions"]
    assert parsed["metadata"]["model"] == "gemini-2.5-flash"


def test_parse_template_missing_frontmatter_raises(tmp_path):
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "SKILL.md").write_text("Just body, no frontmatter\n")
    with pytest.raises(ValueError, match="frontmatter"):
        _parse_template(bad / "SKILL.md")


# === seed() ===


def test_seed_empty_firestore_creates_all(tmp_path):
    """First run: no existing platform skills → create one for each template."""
    _fake_template_dir(tmp_path, "alpha")
    _fake_template_dir(tmp_path, "beta")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.create_skill") as mock_create,
    ):
        mock_list.return_value = []  # no existing platform skills
        mock_create.side_effect = lambda **kw: _make_config(name=kw["name"])

        summary = seed(templates_root=tmp_path)

    assert summary.created == 2
    assert summary.skipped == 0
    assert summary.failed == []
    # Verify each create call sets the right owner + access
    for call in mock_create.call_args_list:
        kwargs = call.kwargs
        assert kwargs["owner_id"] == "aitana-platform"
        assert kwargs["owner_email"] == "platform@aitanalabs.com"
        assert kwargs["accessControl"] == {"type": "public"}


def test_seed_idempotent_skips_existing(tmp_path):
    """Second run: templates already present → skip, don't recreate."""
    _fake_template_dir(tmp_path, "alpha")
    _fake_template_dir(tmp_path, "beta")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.create_skill") as mock_create,
    ):
        mock_list.return_value = [_make_config("alpha"), _make_config("beta")]
        summary = seed(templates_root=tmp_path)

    assert summary.created == 0
    assert summary.skipped == 2
    assert summary.failed == []
    mock_create.assert_not_called()


def test_seed_malformed_template_is_failed_not_raise(tmp_path):
    """One bad template should not abort the whole run."""
    _fake_template_dir(tmp_path, "alpha")  # valid
    bad = tmp_path / "broken"
    bad.mkdir()
    (bad / "SKILL.md").write_text("no frontmatter here\n")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.create_skill") as mock_create,
    ):
        mock_list.return_value = []
        mock_create.side_effect = lambda **kw: _make_config(name=kw["name"])

        summary = seed(templates_root=tmp_path)

    assert summary.created == 1
    assert summary.skipped == 0
    assert "broken" in summary.failed


def test_seed_summary_is_a_dataclass():
    s = SeedSummary(created=3, skipped=2, failed=["x"])
    assert s.created == 3
    assert s.skipped == 2
    assert s.failed == ["x"]


def test_parse_template_extracts_problem_statement(tmp_path):
    """AIPLA 2026-05-21 — SKILL.md frontmatter `problemStatement` parses
    into the optional field used by the v0.1 WorkspaceShell. Empty/absent
    falls back to empty string (no crash, no spurious populate)."""
    content = (
        "---\n"
        "name: with-problem\n"
        "description: x\n"
        "problemStatement: |\n"
        "  ### Test problem\n"
        "  - sub-part a\n"
        "metadata:\n"
        "  model: gemini-2.5-flash\n"
        "---\n\n"
        "Body.\n"
    )
    skill_dir = tmp_path / "with-problem"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(content)

    parsed = _parse_template(skill_dir / "SKILL.md")
    assert "### Test problem" in parsed["problemStatement"]
    assert "sub-part a" in parsed["problemStatement"]


def test_parse_template_empty_problem_statement_when_absent(tmp_path):
    _fake_template_dir(tmp_path, "alpha")
    parsed = _parse_template(tmp_path / "alpha" / "SKILL.md")
    assert parsed["problemStatement"] == ""


def test_seed_passes_problem_statement_to_create_skill(tmp_path):
    """When SKILL.md declares problemStatement, seed() forwards it to
    create_skill so SkillConfig persists it. Skills without the field
    don't pass any kwarg (so SkillConfig's default of "" applies)."""
    content_with = (
        "---\n"
        "name: with-problem\n"
        "description: x\n"
        "problemStatement: |\n"
        "  ### Boldkast\n"
        "metadata:\n"
        "  model: gemini-2.5-flash\n"
        "---\n\n"
        "Body.\n"
    )
    (tmp_path / "with-problem").mkdir()
    (tmp_path / "with-problem" / "SKILL.md").write_text(content_with)
    _fake_template_dir(tmp_path, "without-problem")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.create_skill") as mock_create,
        patch("admin.platform_seed.unique_slug", side_effect=lambda _o, base, **_: base),
    ):
        mock_list.return_value = []
        mock_create.side_effect = lambda **kw: _make_config(name=kw["name"])
        seed(templates_root=tmp_path)

    by_name = {call.kwargs["name"]: call.kwargs for call in mock_create.call_args_list}
    assert "### Boldkast" in by_name["with-problem"]["problemStatement"]
    # Skills without the field don't pass any kwarg (SkillConfig default = "")
    assert "problemStatement" not in by_name["without-problem"]


def test_seed_sets_slug_at_creation(tmp_path):
    """Each newly seeded skill must have a slug — otherwise the friendly
    URL /chat/@aitana-platform/{slug} 404s and we have to backfill in every
    fresh environment. Regression for the bug where test/prod were cut
    without slugs and the marketplace links broke."""
    _fake_template_dir(tmp_path, "general-assistant")
    _fake_template_dir(tmp_path, "code-assistant")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.create_skill") as mock_create,
        patch("admin.platform_seed.unique_slug", side_effect=lambda _o, base, **_: base),
    ):
        mock_list.return_value = []
        mock_create.side_effect = lambda **kw: _make_config(name=kw["name"])

        summary = seed(templates_root=tmp_path)

    assert summary.created == 2
    slugs = {call.kwargs["slug"] for call in mock_create.call_args_list}
    assert slugs == {"general-assistant", "code-assistant"}
