"""Pinned upstream discovery, file-path import, mount and session-header smoke."""
import importlib.util
from pathlib import Path
import shutil

import pytest

from conftest import PLUGIN_ROOT, PREFIX


if importlib.util.find_spec("hermes_cli") is None:
    pytest.skip("Hermes interpreter required", allow_module_level=True)


def test_dashboard_discovers_mounts_and_serves(monkeypatch, tmp_path):
    home = tmp_path / "hermes"
    home.mkdir()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    (home / "config.yaml").write_text(
        "plugins:\n  enabled: [hermes-cloud-file-manager]\nterminal:\n  cwd: " + str(workspace) + "\n")
    plugin = home / "plugins/hermes-cloud-file-manager"
    plugin.mkdir(parents=True)
    shutil.copy2(PLUGIN_ROOT / "plugin.yaml", plugin / "plugin.yaml")
    shutil.copytree(PLUGIN_ROOT / "dashboard", plugin / "dashboard", ignore=shutil.ignore_patterns("__pycache__"))
    dashboard = pytest.importorskip("hermes_cli.web_server_dashboard")
    from hermes_cli import web_server as server
    from fastapi.testclient import TestClient
    discovered = server._get_dashboard_plugins(force_rescan=True)
    assert any(p["name"] == "hermes-cloud-file-manager" for p in discovered)
    if not any(getattr(r, "path", None) == PREFIX + "/roots" for r in server.app.routes):
        dashboard._mount_plugin_api_routes()
    assert any(getattr(r, "path", None) == PREFIX + "/roots" for r in server.app.routes)
    client = TestClient(server.app, headers={server._SESSION_HEADER_NAME: server._SESSION_TOKEN})
    assert client.get(PREFIX + "/available").json()["ok"] is True
    body = client.get(PREFIX + "/roots").json()
    assert body["ok"] is True and body["roots"][0]["path"] == str(workspace)
    body = client.post(PREFIX + "/mkdir", json={"root": "workspace", "path": "docs"}).json()
    assert body["ok"] is True and (workspace / "docs").is_dir()
