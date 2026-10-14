"""The plugin's one agent-side registration: the report-a-problem skill."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from conftest import PLUGIN_ROOT

SKILL = "cloud-file-manager-report-problem"
FORM = PLUGIN_ROOT / ".github" / "ISSUE_TEMPLATE" / "bug_report.yml"


def load_plugin():
    spec = importlib.util.spec_from_file_location("hcfm_plugin_init", PLUGIN_ROOT / "__init__.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RecordingCtx:
    def __init__(self):
        self.calls = []

    def register_skill(self, name, path, description="", frontmatter=None):
        self.calls.append((name, Path(path), description, dict(frontmatter or {})))


def test_registers_the_report_skill_with_its_frontmatter():
    ctx = RecordingCtx()
    assert load_plugin().register(ctx) is None
    [(name, path, description, frontmatter)] = ctx.calls
    assert name == SKILL
    assert path == PLUGIN_ROOT / "skills" / SKILL / "SKILL.md" and path.is_file()
    assert frontmatter == {"name": SKILL, "description": description}
    # The file's own frontmatter says the same, so a reader of the file and the host agree.
    head = path.read_text(encoding="utf-8").split("---")[1]
    assert f"name: {SKILL}" in head and f'description: "{description}"' in head


def test_older_hosts_without_plugin_skills_load_it_as_before():
    assert load_plugin().register(object()) is None


def test_skill_drafts_with_the_bug_form_headings():
    text = (PLUGIN_ROOT / "skills" / SKILL / "SKILL.md").read_text(encoding="utf-8")
    for heading in ("What happened", "What you expected", "Steps to reproduce", "Plugin version", "Hermes version",
                    "Where it happened", "Operating system", "Diagnostics", "Relevant log lines"):
        assert f"### {heading}\n" in text
    if FORM.is_file():  # the shared form ships with the community kit
        form = FORM.read_text(encoding="utf-8")
        for heading in ("What happened", "Where it happened", "Relevant log lines"):
            assert f"label: {heading}" in form


def test_a_real_host_resolves_the_skill(monkeypatch):
    plugins = pytest.importorskip("hermes_cli.plugins")
    manager = plugins.PluginManager()
    monkeypatch.setattr(plugins, "_plugin_manager", manager)
    manifest = plugins.PluginManifest(name="hermes-cloud-file-manager", version="test", description="test", source="user")
    load_plugin().register(plugins.PluginContext(manifest, manager))
    assert manager.find_plugin_skill(f"hermes-cloud-file-manager:{SKILL}") == PLUGIN_ROOT / "skills" / SKILL / "SKILL.md"
