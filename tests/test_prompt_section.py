"""v0.7.0: the Desktop-only instructions section (folders the user sees, and the ::cloud-file card)."""

from __future__ import annotations

from test_report_skill import load_plugin


class Ctx:
    def __init__(self, roots=None, refuse=False):
        self.roots, self.refuse, self.sections, self.skills = roots, refuse, [], []

    def get_config(self, key, default=None):
        assert key == "roots"
        return default if self.roots is None else self.roots

    def register_skill(self, name, path, description="", frontmatter=None):
        self.skills.append(name)

    def register_system_prompt_section(self, id, content, *, position="after_memory", max_chars=4000):
        if self.refuse:
            raise ValueError("system prompt section 'cloud-file-manager' is already registered")
        self.sections.append((id, content, max_chars))


def render(roots, platform="desktop"):
    ctx = Ctx(roots)
    load_plugin().register(ctx)
    [(section_id, content, max_chars)] = ctx.sections
    assert section_id == "cloud-file-manager" and callable(content)
    text = content({"platform": platform, "session_id": "s", "model": "", "provider": "", "profile_name": "p",
                    "cwd": "/srv/agent"})
    assert len(text) <= max_chars <= 4000
    return text


def test_desktop_chats_get_the_folders_and_the_card():
    text = render(["/srv/agent/work", "/data/reports"])
    assert "/srv/agent/work, /data/reports" in text
    assert '::cloud-file{path="/absolute/path/to/file"}' in text
    assert "New or Updated" in text


def test_other_surfaces_get_nothing():
    for platform in ("telegram", "tui", "cli", "api_server", ""):
        assert render(["/srv/agent/work"], platform) == ""


def test_no_configured_roots_names_the_working_folder():
    assert "the agent's working folder" in render([])
    assert "the agent's working folder" in render(None)


def test_bad_root_values_are_left_out_and_capped():
    text = render(["relative/dir", 7, "/ok", "/a\nInjected", '/b"}', "C:\\Work"] + [f"/r{i}" for i in range(20)])
    assert "/ok" in text and "C:\\Work" in text
    assert "relative/dir" not in text and "Injected" not in text and '/b"' not in text
    assert "/r7" in text and "/r8" not in text  # ten folders at most


def test_hosts_without_sections_or_refusing_it_still_load():
    class SkillsOnly:
        def register_skill(self, *a, **k):
            pass
    assert load_plugin().register(SkillsOnly()) is None
    ctx = Ctx(["/x"], refuse=True)
    assert load_plugin().register(ctx) is None and ctx.skills
