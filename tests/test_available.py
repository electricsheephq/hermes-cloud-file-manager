from conftest import PREFIX


def test_available_reports_plugin_and_version(client, api):
    response = client.get(f"{PREFIX}/available")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "plugin": "hermes-cloud-file-manager", "version": api.VERSION}


def test_versions_agree():
    import json
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "dashboard" / "manifest.json").read_text())
    plugin_yaml = (root / "plugin.yaml").read_text()
    package = json.loads((root / "package.json").read_text())
    assert f"version: {manifest['version']}" in plugin_yaml
    assert package["version"] == manifest["version"]
