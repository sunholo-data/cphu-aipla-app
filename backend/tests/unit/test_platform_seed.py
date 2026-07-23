"""Unit tests for backend/admin/platform_seed.py.

The seeder reads backend/skills/templates/*/SKILL.md, parses YAML
frontmatter + markdown body, and creates each as a platform-owned
public skill. Idempotent: skips any template whose `name` already exists
in Firestore.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from admin.platform_seed import SeedSummary, _parse_template, main, prune, seed
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


def test_seed_idempotent_upserts_existing(tmp_path):
    """Second run: templates already present → update (not skip) so template
    edits propagate to deployed Firestore. Previously this was a "skip
    if exists" no-op, which silently dropped new SKILL.md frontmatter
    fields like 1.I-PhA's proactiveGreet / openingTemplate. See
    docs/design/aipla/v1.0.0-pilot/proactive-tutor.md."""
    _fake_template_dir(tmp_path, "alpha")
    _fake_template_dir(tmp_path, "beta")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.create_skill") as mock_create,
        patch("admin.platform_seed.skill_config.update_skill") as mock_update,
    ):
        mock_list.return_value = [_make_config("alpha"), _make_config("beta")]
        summary = seed(templates_root=tmp_path)

    assert summary.created == 0
    assert summary.updated == 2
    assert summary.skipped == 0
    assert summary.failed == []
    mock_create.assert_not_called()
    assert mock_update.call_count == 2
    # update_skill receives (skill_id, updates) — verify template-sourced
    # fields are passed (description + instructions always, plus the new
    # proactiveGreet/openingTemplate flags regardless of value).
    for call in mock_update.call_args_list:
        _skill_id, updates = call.args
        assert "description" in updates
        assert "instructions" in updates
        assert "proactiveGreet" in updates
        assert "openingTemplate" in updates
        # 1.1.2 Phase B — the sim-reactive flag + tuning knobs +
        # reactive_template ride the same unconditional-apply path so a
        # template toggle from true to false takes effect on existing
        # skills. See docs/design/aipla/v1.1.0-feedback/proactive-sim-reactive-tutor.md.
        assert "proactiveEventReactive" in updates
        assert "proactiveHeartbeatSeconds" in updates
        assert "proactiveMaxPerSession" in updates
        assert "reactiveTemplate" in updates
        # skillMetadata (tools + agentTools) MUST propagate on update — see
        # test_seed_update_propagates_skill_metadata_tools.
        assert "skillMetadata" in updates


def test_seed_update_propagates_skill_metadata_tools(tmp_path):
    """Re-seeding an already-registered skill MUST propagate ``skillMetadata``
    (the tools list + agentTools), not just instructions.

    Regression for the 2026-06-27 bug: ``manage-class`` was re-seeded after
    its template flipped from advisory (``tools: []``) to active (7 tools +
    ``agentTools``). The update path propagated the new prompt but NOT the
    tools, so the deployed agent built with no function tools while its prompt
    still named them — the model hallucinated calls to undeclared tools and ADK
    raised "Tool 'create_class' not found" with no output. The CREATE path
    always sent skillMetadata; UPDATE must too."""
    _fake_template_dir(
        tmp_path,
        "alpha",
        metadata={
            "model": "gemini-2.5-flash",
            "tools": ["create_class", "list_my_classes"],
            "agentTools": ["analytics-chat"],
        },
    )
    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.create_skill"),
        patch("admin.platform_seed.skill_config.update_skill") as mock_update,
    ):
        mock_list.return_value = [_make_config("alpha")]
        seed(templates_root=tmp_path)

    _skill_id, updates = mock_update.call_args.args
    assert "skillMetadata" in updates, "update payload must carry the tools list"
    assert updates["skillMetadata"]["tools"] == ["create_class", "list_my_classes"]
    assert updates["skillMetadata"]["agentTools"] == ["analytics-chat"]


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


# === prune() ===


def test_prune_dry_run_lists_orphans_without_deleting(tmp_path):
    """1.B follow-up (2026-05-26): the prune helper lists platform-owned
    Firestore skills whose template was removed from disk, but doesn't
    delete by default."""
    _fake_template_dir(tmp_path, "keep-me")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.delete_skill") as mock_delete,
    ):
        mock_list.return_value = [
            _make_config(name="keep-me"),
            _make_config(name="orphan-1"),
            _make_config(name="orphan-2"),
        ]

        result = prune(templates_root=tmp_path)  # dry_run=True default

    assert set(result["pruned"]) == {"orphan-1", "orphan-2"}
    assert set(result["kept"]) == {"keep-me"}
    assert mock_delete.call_count == 0  # dry-run by default


def test_prune_commits_deletions_when_dry_run_false(tmp_path):
    _fake_template_dir(tmp_path, "keep-me")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.delete_skill") as mock_delete,
    ):
        mock_list.return_value = [
            _make_config(name="keep-me"),
            _make_config(name="orphan-1"),
        ]

        result = prune(templates_root=tmp_path, dry_run=False)

    assert result["pruned"] == ["orphan-1"]
    assert mock_delete.call_count == 1
    mock_delete.assert_called_with("platform-orphan-1")


def test_prune_keeps_everything_when_all_templates_present(tmp_path):
    _fake_template_dir(tmp_path, "alpha")
    _fake_template_dir(tmp_path, "beta")

    with (
        patch("admin.platform_seed.skill_config.list_skills") as mock_list,
        patch("admin.platform_seed.skill_config.delete_skill") as mock_delete,
    ):
        mock_list.return_value = [
            _make_config(name="alpha"),
            _make_config(name="beta"),
        ]
        result = prune(templates_root=tmp_path, dry_run=False)

    assert result["pruned"] == []
    assert set(result["kept"]) == {"alpha", "beta"}
    mock_delete.assert_not_called()


def test_parse_template_extracts_avatar(tmp_path):
    """avatar is an optional top-level frontmatter field (1.B follow-up)."""
    skill_dir = tmp_path / "withpic"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: withpic\ndescription: Demo.\navatar: /lesson-images/x.svg\nmetadata:\n  model: gemini-2.5-flash\n---\n\nBody.\n",
    )
    parsed = _parse_template(skill_dir / "SKILL.md")
    assert parsed["avatar"] == "/lesson-images/x.svg"


def test_parse_template_avatar_defaults_to_empty(tmp_path):
    _fake_template_dir(tmp_path, "noavatar")
    parsed = _parse_template(tmp_path / "noavatar" / "SKILL.md")
    assert parsed["avatar"] == ""


# === main() — the P1.3 seed-job CLI entrypoint ===


def test_main_returns_0_on_clean_seed(monkeypatch):
    """No failed templates → exit 0 (build stays green)."""
    monkeypatch.delenv("LOCAL_MODE", raising=False)
    with patch(
        "admin.platform_seed.seed",
        return_value=SeedSummary(created=2, updated=1, skipped=0, failed=[]),
    ) as mock_seed:
        assert main([]) == 0
    mock_seed.assert_called_once()


def test_main_returns_1_when_a_template_fails(monkeypatch):
    """A template in `failed` → exit 1 so the Cloud Run job (and the build
    step that executes it) goes red instead of silently shipping stale data."""
    monkeypatch.delenv("LOCAL_MODE", raising=False)
    with patch(
        "admin.platform_seed.seed",
        return_value=SeedSummary(created=1, updated=0, skipped=0, failed=["broken-skill"]),
    ):
        assert main([]) == 1


def test_main_refuses_to_run_under_local_mode(monkeypatch):
    """LOCAL_MODE would seed the in-memory client (durably nothing) — refuse
    loudly (exit 2) rather than exit 0 having seeded nothing."""
    monkeypatch.setenv("LOCAL_MODE", "1")
    with patch("admin.platform_seed.seed") as mock_seed:
        assert main([]) == 2
    mock_seed.assert_not_called()
