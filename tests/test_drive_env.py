"""Drive environment and fixed lookup acceptance, using only fake skill scripts."""
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

from conftest import get
from test_drive import drive, imported

PINNED_ENV = frozenset({
    "PATH", "HOME", "TMPDIR", "LANG", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "HERMES_GWS_BIN",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "HTTPLIB2_CA_CERTS",
    "PYTHONPATH", "PYTHONHOME", "PYTHONUTF8", "PYTHONIOENCODING", "TEMP", "TMP", "SYSTEMROOT",
})
BLOCKED_ENV = {"OPENAI_API_KEY", "ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN", "GOOGLE_WORKSPACE_CLI_TOKEN",
               "GH_TOKEN", "FOO"}


@pytest.mark.parametrize("script,command", [("setup.py", ["--check"]),
    ("google_api.py", ["drive", "search", "name contains 'report'", "--max", "200", "--raw-query"])])
def test_exact_environment_boundary(api, drive, monkeypatch, script, command):
    for key in BLOCKED_ENV:
        monkeypatch.setenv(key, "sk-test-not-real")
    allowed = {key: "test-value" for key in ("HTTPS_PROXY", "https_proxy", "SSL_CERT_FILE", "LC_ALL",
                                           "PYTHONPATH", "HERMES_GWS_BIN", "XDG_CONFIG_HOME")}
    for key, value in allowed.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("HERMES_HOME", "/elsewhere")
    captured = {}
    def run(argv, **kwargs):
        captured.update(kwargs)
        captured["argv"] = argv
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(api.subprocess, "run", run)
    api._drive_run([drive.scripts / script, *command], 10)
    env = captured["env"]
    assert not BLOCKED_ENV.intersection(set(env))
    expected = {k: v for k, v in os.environ.items() if k in api.DRIVE_ENV or k.startswith("LC_")}
    expected["HERMES_HOME"] = str(drive.home)
    matches = env == expected  # Do not render inherited values if this fails on the old runner.
    assert matches
    assert all(env.get(k) == v for k, v in allowed.items())
    assert captured["argv"] == [sys.executable, str(drive.scripts / script), *command]
    assert captured["cwd"] == drive.scripts and captured["shell"] is False


def test_environment_allowlist_is_pinned(api):
    assert api.DRIVE_ENV == PINNED_ENV


def test_real_children_receive_minimal_environment(client, api, drive, monkeypatch):
    for key in ("OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN"):
        monkeypatch.setenv(key, "sk-test-not-real")
    allowed = {"SSL_CERT_FILE": "/test/not-a-real-ca.pem", "HERMES_GWS_BIN": "/test/gws",
               "XDG_CONFIG_HOME": "/test/config"}
    for key, value in allowed.items():
        monkeypatch.setenv(key, value)
    # Add value capture only for these fake, non-secret settings in this scenario.
    for script in drive.scripts.iterdir():
        script.write_text(script.read_text().replace('"env": sorted(os.environ)',
            '"env": sorted(os.environ), "values": {k: os.environ.get(k) for k in ' + repr(list(allowed)) + '}'))
    assert get(client, "drive/available")["available"]
    assert imported(client)["ok"]
    calls = drive.calls()
    assert [c["script"] for c in calls] == ["setup.py", "google_api.py", "google_api.py"]
    for call in calls:
        keys = set(call["env"])
        assert not {"OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN", "FAKE_CONTROL", "FAKE_LOG"}.intersection(keys)
        assert keys <= api.DRIVE_ENV | {"HERMES_HOME", "__CF_USER_TEXT_ENCODING", "__PYVENV_LAUNCHER__"} | {
            k for k in keys if k.startswith("LC_")}
        assert call["values"] == allowed
        assert call["home"] == str(drive.home)


def copy_skill(drive, skills):
    scripts = skills / "productivity/google-workspace/scripts"
    scripts.mkdir(parents=True)
    for name in ("setup.py", "google_api.py"):
        (scripts / name).write_text((drive.scripts / name).read_text())
    return scripts / "setup.py", scripts / "google_api.py"


def remove_agent_copy(drive):
    for script in drive.scripts.iterdir():
        script.unlink()


def test_agent_copy_wins_and_bundle_is_lazy(api, drive, monkeypatch):
    constants = sys.modules["hermes_constants"]
    copy_skill(drive, Path(constants.__file__).parent / "skills")
    def unused(default):
        pytest.fail("bundled directory must not be computed when the agent has a copy")
    monkeypatch.setattr(constants, "get_bundled_skills_dir", unused, raising=False)
    assert api._drive_scripts() == (drive.scripts / "setup.py", drive.scripts / "google_api.py")


@pytest.mark.parametrize("location", ["google-workspace/scripts", "tools/google-workspace/scripts",
                                     "a/b/google-workspace/scripts"])
@pytest.mark.parametrize("bundled", [False, True])
def test_other_agent_locations_are_ignored(client, api, drive, location, bundled):
    expected = None
    if bundled:
        expected = copy_skill(drive, Path(sys.modules["hermes_constants"].__file__).parent / "skills")
    elsewhere = drive.home / "skills" / location
    elsewhere.mkdir(parents=True)
    for script in drive.scripts.iterdir():
        (elsewhere / script.name).write_text(script.read_text())
    remove_agent_copy(drive)
    assert api._drive_scripts() == expected
    if not bundled:
        assert get(client, "drive/available") == {"ok": True, "available": False, "reason": "no_skill"}
        assert drive.calls() == []


def test_bundle_is_next_to_hermes_constants(api, drive):
    expected = copy_skill(drive, Path(sys.modules["hermes_constants"].__file__).parent / "skills")
    remove_agent_copy(drive)
    assert api._drive_scripts() == expected


def test_bundle_helper_receives_default_and_uses_override(api, drive, monkeypatch):
    constants = sys.modules["hermes_constants"]
    default = Path(constants.__file__).resolve().parent / "skills"
    copy_skill(drive, default)
    override = drive.home.parent / "override-skills"
    expected = copy_skill(drive, override)
    received = []
    def bundled_dir(value):
        received.append(value)
        return str(override)
    monkeypatch.setattr(constants, "get_bundled_skills_dir", bundled_dir, raising=False)
    remove_agent_copy(drive)
    assert api._drive_scripts() == expected
    assert received == [default]


@pytest.mark.parametrize("parent_index", [1, 2])
def test_old_parent_fallbacks_are_ignored(client, api, drive, monkeypatch, parent_index):
    # Nest the fake install to keep both old parent probes inside this test's temporary folder.
    constants = sys.modules["hermes_constants"]
    module_path = drive.home.parent / "outer/install/hermes_constants.py"
    monkeypatch.setattr(constants, "__file__", str(module_path))
    copy_skill(drive, module_path.parents[parent_index] / "skills")
    remove_agent_copy(drive)
    assert api._drive_scripts() is None
    assert get(client, "drive/available") == {"ok": True, "available": False, "reason": "no_skill"}
    assert drive.calls() == []


@pytest.mark.parametrize("missing", ["setup.py", "google_api.py"])
def test_incomplete_agent_copy_falls_back(api, drive, missing):
    expected = copy_skill(drive, Path(sys.modules["hermes_constants"].__file__).parent / "skills")
    (drive.scripts / missing).unlink()
    assert api._drive_scripts() == expected


def test_relative_bundle_override_runs(client, api, drive, monkeypatch):
    constants = sys.modules["hermes_constants"]
    monkeypatch.chdir(drive.home.parent)
    copy_skill(drive, drive.home.parent / "relative-skills")
    monkeypatch.setattr(constants, "get_bundled_skills_dir", lambda default: "relative-skills", raising=False)
    remove_agent_copy(drive)
    setup, google = api._drive_scripts()
    assert setup.is_absolute() and google.is_absolute()
    assert get(client, "drive/available")["available"]
    assert [c["script"] for c in drive.calls()] == ["setup.py"]
