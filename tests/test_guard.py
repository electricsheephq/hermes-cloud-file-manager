from pathlib import Path

import pytest

from conftest import error, get, post


@pytest.mark.parametrize("rel", ["..", "a/../b", "/etc", "~/x", "a\\b", "C:x",
    "a:b", "x.", "x ", "CON", "con.txt", "nul", "a\x00b", "x" * 256,
    "a\x1fb", "a\x7fb", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", "COM9.txt", "lpt1"])
def test_bad_paths(api, fs, rel):
    root = api._roots()[0]
    with pytest.raises(api.GuardError) as exc:
        api._resolve(root, rel, for_write=False)
    assert exc.value.code == "bad_path"


def test_normalization_and_utf8_bytes(api, fs):
    root, _ = fs
    assert api._resolve(api._roots()[0], "a//./b", for_write=True) == root / "a/b"
    with pytest.raises(api.GuardError) as exc:
        api._resolve(api._roots()[0], "é" * 128, for_write=True)
    assert exc.value.code == "bad_path"


def test_symlinks(client, api, fs, tmp_path):
    root, _ = fs
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "x").write_text("untouched")
    (root / "external").symlink_to(outside, target_is_directory=True)
    (root / "dangling").symlink_to(tmp_path / "missing")
    (root / "inside").mkdir()
    (root / "inside/x").write_text("safe")
    (root / "internal").symlink_to(root / "inside", target_is_directory=True)
    entries = {e["name"]: e for e in get(client, "list", root="r0")["entries"]}
    # A link leaving the root is never stat'ed through, so a dangling one is listed like any outside link (#19).
    assert entries["dangling"]["link_outside"] is True and entries["dangling"]["is_dir"] is False
    assert entries["external"]["link_outside"] is True
    assert entries["external"]["is_dir"] is False
    assert entries["external"]["size"] == (root / "external").lstat().st_size
    for path in ("external", "external/x"):
        error(get(client, "list", root="r0", path=path), "outside_root")
        error(post(client, "mkdir", root="r0", path=path), "outside_root")
        error(post(client, "uploads/start", root="r0", path=path, size=0), "outside_root")
    assert get(client, "list", root="r0", path="internal")["entries"][0]["name"] == "x"
    error(post(client, "mkdir", root="r0", path="internal"), "is_link")


def test_hermes_home_identity(client, api, fs, monkeypatch):
    root, _ = fs
    hh = root / "hh"
    hh.mkdir()
    (hh / "private").write_text("fixture")
    (root / "alias").symlink_to(hh, target_is_directory=True)
    monkeypatch.setattr(api, "_hermes_homes", lambda: {hh, root / "missing"})
    assert get(client, "list", root="r0")["entries"] == []
    assert get(client, "search", root="r0", q="private")["results"] == []
    for path in ("hh", "hh/x", "alias/x"):
        error(post(client, "mkdir", root="r0", path=path), "protected")
        error(post(client, "uploads/start", root="r0", path=path, size=0), "protected")


def test_hermes_home_different_case(client, api, fs, monkeypatch, tmp_path, request):
    (tmp_path / "a").touch()
    sensitive = not (tmp_path / "A").exists()
    if not sensitive:
        sensitive = (tmp_path / "a").stat().st_ino != (tmp_path / "A").stat().st_ino
    request.node.add_marker(pytest.mark.skipif(sensitive, reason="case-sensitive tmp filesystem"))
    if sensitive:
        pytest.skip("case-sensitive tmp filesystem")
    root, _ = fs
    hh = root / "hh"
    hh.mkdir()
    monkeypatch.setattr(api, "_hermes_homes", lambda: {hh})
    error(post(client, "mkdir", root="r0", path="HH/x"), "protected")
    error(post(client, "uploads/start", root="r0", path="HH/x", size=0), "protected")


def test_docker_home_workspace(client, api, fs, monkeypatch):
    root, cfg = fs
    cfg["plugins"] = {}
    cfg["terminal"] = {"cwd": str(root)}
    monkeypatch.setattr(api, "_hermes_homes", lambda: {root})
    (root / "private").write_text("fixture")
    roots = get(client, "roots")["roots"]
    assert len(roots) == 1
    assert roots[0]["path"] == str(root / "workspace")
    assert get(client, "list", root="workspace")["entries"] == []
    error(post(client, "mkdir", root="workspace", path="../private"), "bad_path")


def test_home_dot_rule(client, api, fs, monkeypatch):
    root, _ = fs
    (root / ".ssh").mkdir()
    (root / ".ssh/x").touch()
    (root / ".bashrc").touch()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    for path in (".ssh/x", ".bashrc"):
        error(post(client, "mkdir", root="r0", path=path), "protected")
        error(post(client, "uploads/start", root="r0", path=path, size=0), "protected")
    assert get(client, "list", root="r0")["entries"] == []
    assert get(client, "search", root="r0", q=".")["results"] == []


def test_non_home_dot_entries_allowed(client, fs):
    root, _ = fs
    (root / ".visible").touch()
    assert get(client, "list", root="r0")["entries"][0]["name"] == ".visible"
    assert get(client, "search", root="r0", q="visible")["results"][0]["name"] == ".visible"


def test_configured_hermes_home_skipped(client, api, fs, monkeypatch):
    root, _ = fs
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(api, "_hermes_homes", lambda: {root})
    assert get(client, "roots")["roots"] == []
    error(get(client, "list", root="r0"), "unknown_root")
    error(get(client, "search", root="r0", q="x"), "unknown_root")
    error(post(client, "mkdir", root="r0", path="x"), "unknown_root")
    error(post(client, "uploads/start", root="r0", path="x", size=0), "unknown_root")
    upload = {"root": "r0", "path": "x", "upload_id": "f" * 32}
    error(post(client, "uploads/chunk", **upload, offset=0, data=""), "unknown_root")
    error(post(client, "uploads/finish", **upload, size=0), "unknown_root")
    error(post(client, "uploads/abort", **upload), "unknown_root")


def test_configured_hermes_home_different_case_skipped(client, api, fs, monkeypatch, tmp_path, request):
    (tmp_path / "a").touch()
    sensitive = not (tmp_path / "A").exists()
    if not sensitive:
        sensitive = (tmp_path / "a").stat().st_ino != (tmp_path / "A").stat().st_ino
    request.node.add_marker(pytest.mark.skipif(sensitive, reason="case-sensitive tmp filesystem"))
    if sensitive:
        pytest.skip("case-sensitive tmp filesystem")
    root, cfg = fs
    monkeypatch.setattr(api, "_hermes_homes", lambda: {root})
    cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["roots"] = [str(root.parent / "FILES")]
    assert get(client, "roots")["roots"] == []
    error(get(client, "list", root="r0"), "unknown_root")


def test_configured_subfolder_of_hermes_home_allowed(client, api, fs, monkeypatch):
    root, cfg = fs
    workspace = root / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(api, "_hermes_homes", lambda: {root})
    cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["roots"] = [str(root), str(workspace)]
    roots = get(client, "roots")["roots"]
    assert [(r["id"], r["path"]) for r in roots] == [("r1", str(workspace))]
    assert post(client, "mkdir", root="r1", path="docs")["ok"] is True
    assert get(client, "list", root="r1")["entries"][0]["name"] == "docs"
    assert not (workspace / "workspace").exists()
