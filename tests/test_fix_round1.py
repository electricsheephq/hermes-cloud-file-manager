"""A1–A14 regressions and the existing-name ruling R3."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
from threading import Barrier
import time
from types import ModuleType, SimpleNamespace

import pytest

from conftest import PREFIX, error, get, post
from test_uploads import chunk, start


def test_a1_imported_constants_keep_all_homes(client, api, monkeypatch, tmp_path):
    home = tmp_path / "user"
    legacy = home / ".hermes"
    legacy.mkdir(parents=True)
    others = [tmp_path / name for name in ("env", "active", "process", "default")]
    for path in others:
        path.mkdir()
    constants = ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: others[1]
    constants.get_process_hermes_home = lambda: others[2]
    constants.get_default_hermes_root = lambda: others[3]
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.setenv("HERMES_HOME", str(others[0]))
    monkeypatch.setattr(api, "_load_config", lambda: {"plugins": {"entries": {
        "hermes-cloud-file-manager": {"settings": {"roots": [str(legacy), str(home)]}}
    }}})
    assert api._hermes_homes() == {legacy, *others}
    assert [r["id"] for r in get(client, "roots")["roots"]] == ["r1"]
    assert get(client, "list", root="r1")["entries"] == []
    error(post(client, "mkdir", root="r1", path=".hermes/x"), "protected")


@pytest.mark.parametrize("spelling", ["hh", "HH"])
def test_a2_missing_home_canonical_path_protected(client, api, fs, monkeypatch, spelling):
    if spelling == "HH" and sys.platform not in {"darwin", "win32"}:
        pytest.skip("casefold protection is specified for darwin/win32")
    root, _ = fs
    hh = root / "hh"
    monkeypatch.setattr(api, "_hermes_homes", lambda: {hh})
    error(post(client, "mkdir", root="r0", path=f"{spelling}/new"), "protected")
    error(post(client, "uploads/start", root="r0", path=f"{spelling}/file", size=0), "protected")
    assert not hh.exists()


def test_a3_root_itself_in_identity_walk(api, fs, monkeypatch):
    root, _ = fs
    # A bind/alternate spelling can have the home's identity but a different canonical path.
    monkeypatch.setattr(api, "_excluded", lambda: {api._identity(root)})
    selected = api.Root("r0", "files", root)
    with pytest.raises(api.GuardError) as exc:
        api._resolve(selected, "private", for_write=False)
    assert exc.value.code == "protected"


def test_a3_workspace_link_back_to_home_refused(client, api, fs, monkeypatch):
    root, cfg = fs
    cfg["plugins"] = {}
    cfg["terminal"] = {"cwd": str(root)}
    monkeypatch.setattr(api, "_hermes_homes", lambda: {root})
    (root / "workspace").symlink_to(root, target_is_directory=True)
    error(get(client, "roots"), "protected")
    error(get(client, "list", root="workspace"), "protected")


def test_a4_home_alias_hides_and_protects_resolved_dots(client, api, fs, monkeypatch):
    root, _ = fs
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    (root / ".ssh").mkdir()
    (root / ".ssh/private").touch()
    (root / "me").symlink_to(root, target_is_directory=True)
    (root / "visible_alias").symlink_to(root / ".ssh", target_is_directory=True)
    names = {entry["name"] for entry in get(client, "list", root="r0", path="me")["entries"]}
    assert ".ssh" not in names and "visible_alias" not in names
    error(post(client, "uploads/start", root="r0", path="me/.ssh/file", size=0), "protected")
    error(post(client, "mkdir", root="r0", path="visible_alias/new"), "protected")
    assert get(client, "search", root="r0", q="private")["results"] == []


def test_a5_configured_root_ids_do_not_shift(client, fs):
    root, cfg = fs
    changing = root / "changing"
    stable = root / "stable"
    stable.mkdir()
    cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["roots"] = [str(changing), str(stable)]
    assert [(r["id"], r["path"]) for r in get(client, "roots")["roots"]] == [("r1", str(stable))]
    error(get(client, "list", root="r0"), "unknown_root")
    changing.mkdir()
    assert get(client, "list", root="r1")["ok"] is True
    changing.rmdir()
    assert get(client, "list", root="r1")["ok"] is True
    error(get(client, "list", root="r0"), "unknown_root")


def test_a6_double_finish_removes_only_failed_reservation(client, api, fs, monkeypatch):
    root, _ = fs
    upload = start(client, path="d.txt", size=4)
    assert chunk(client, upload, b"data")["ok"]
    barrier = Barrier(2)
    replace = api.os.replace
    def racing_replace(source, target):
        barrier.wait(timeout=3)
        return replace(source, target)
    monkeypatch.setattr(api.os, "replace", racing_replace)
    # HTTP finishes are serialized now (a racing retry replays), so race the unserialized publish step directly.
    finish = api._protocol(api._finish)
    with ThreadPoolExecutor(max_workers=2) as pool:
        bodies = list(pool.map(lambda _: finish(api.Finish(**upload, size=4)), range(2)))
    assert sum(body["ok"] for body in bodies) == 1
    assert [path.read_bytes() for path in root.iterdir()] == [b"data"]


def test_a7_search_skips_unreadable_and_nonportable_folders(client, api, fs, monkeypatch):
    root, _ = fs
    names = ("aux", "a:b", "Acme Inc.", "what?", "good", "blocked")
    for name in names:
        (root / name).mkdir()
        (root / name / "needle.txt").touch()
    scan = api.os.scandir
    def denied(folder):
        if Path(folder) == root / "blocked":
            raise PermissionError("fixture denial")
        return scan(folder)
    monkeypatch.setattr(api.os, "scandir", denied)
    body = get(client, "search", root="r0", q="needle")
    assert body["ok"] is True
    assert {e["rel"] for e in body["results"]} == {f"{name}/needle.txt" for name in names if name != "blocked"}
    assert body["skipped"] == 1


def test_a8_case_insensitive_temp_name_not_published(client, api, fs, monkeypatch):
    root, _ = fs
    monkeypatch.setattr(api.secrets, "token_hex", lambda n: "b" * 32)
    name = ".CFM-" + "A" * 32 + ".PART"
    upload = start(client, path=name, size=1)
    assert chunk(client, upload, b"x")["ok"]
    body = post(client, "uploads/finish", **upload, size=1)
    assert body["ok"] is True and body["renamed"] is True
    assert body["entry"]["name"] == ".CFM-" + "A" * 32 + " (1).PART"
    assert not (root / name).exists()
    (root / name).touch()
    assert name not in {e["name"] for e in get(client, "list", root="r0")["entries"]}
    assert name not in {e["name"] for e in get(client, "search", root="r0", q="*.PART")["results"]}


def test_a9_temp_sweep_at_most_once_per_hour(client, api, fs, monkeypatch):
    root, _ = fs
    scans = []
    scan = api.os.scandir
    def counted(folder):
        scans.append(os.path.realpath(folder))
        return scan(folder)
    clock = [0.0]
    monkeypatch.setattr(api, "time", SimpleNamespace(time=time.time, monotonic=lambda: clock[0]))
    monkeypatch.setattr(api.os, "scandir", counted)
    start(client, "one")
    start(client, "two")
    assert scans == [str(root)]
    clock[0] = 3599.0
    start(client, "three")
    assert scans == [str(root)]
    clock[0] = 3600.0
    start(client, "four")
    assert scans == [str(root), str(root)]


def test_a10_unencodable_request_is_bad_path(client, fs):
    response = client.post(PREFIX + "/mkdir", content=json.dumps({"root": "r0", "path": "bad\ud800"}),
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 200
    error(response.json(), "bad_path")


@pytest.mark.parametrize("route", ["list", "search"])
def test_a10_unrenderable_directory_entry_skipped(client, api, fs, monkeypatch, route):
    root, _ = fs
    (root / "valid").touch()
    scan = api.os.scandir
    bad = SimpleNamespace(name="bad\ud800", path=str(root / "bad\ud800"))
    @contextmanager
    def with_bad(folder):
        with scan(folder) as entries:
            yield iter([bad, *entries])
    monkeypatch.setattr(api.os, "scandir", with_bad)
    body = get(client, route, root="r0", **({"q": "valid"} if route == "search" else {}))
    entries = body["results"] if route == "search" else body["entries"]
    assert body["ok"] and [e["name"] for e in entries] == ["valid"]


def test_a11_collision_outside_link_skipped(client, fs, tmp_path):
    root, _ = fs
    (root / "a.txt").write_bytes(b"original")
    outside = tmp_path / "outside"
    outside.write_bytes(b"outside")
    (root / "a (1).txt").symlink_to(outside)
    upload = start(client, size=3)
    assert chunk(client, upload, b"new")["ok"]
    body = post(client, "uploads/finish", **upload, size=3)
    assert body["ok"] and body["entry"]["name"] == "a (2).txt"
    assert (root / "a.txt").read_bytes() == b"original"
    assert outside.read_bytes() == b"outside"
    assert (root / "a (1).txt").is_symlink()


def test_a12_derived_filesystem_root_falls_back(client, fs, monkeypatch):
    root, cfg = fs
    cfg["plugins"] = {}
    cfg["terminal"] = {"cwd": "/"}
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    monkeypatch.delenv("TERMINAL_CWD", raising=False)
    monkeypatch.delenv("MESSAGING_CWD", raising=False)
    assert get(client, "roots")["roots"][0]["path"] == str(root)


def test_a13_upload_through_internal_parent_link(client, fs):
    root, _ = fs
    (root / "folder").mkdir()
    (root / "link").symlink_to(root / "folder", target_is_directory=True)
    upload = start(client, path="link/upload.txt", size=4)
    assert chunk(client, upload, b"data")["ok"]
    assert post(client, "uploads/finish", **upload, size=4)["ok"]
    assert (root / "folder/upload.txt").read_bytes() == b"data"
    assert post(client, "mkdir", root="r0", path="link/new")["created"] is True


def test_a14_outside_link_metadata_is_link_metadata(client, fs, tmp_path):
    root, _ = fs
    outside = tmp_path / "outside"
    outside.write_bytes(b"x" * 400)
    os.utime(outside, (1, 1))
    link = root / "external"
    link.symlink_to(outside)
    body = get(client, "list", root="r0")
    entry = body["entries"][0]
    assert entry["link_outside"] is True and entry["is_dir"] is False
    assert entry["mtime"] == link.lstat().st_mtime
    assert entry["size"] == link.lstat().st_size


def test_a14_mkdir_below_file_is_exists_file(client, fs):
    root, _ = fs
    (root / "file").touch()
    error(post(client, "mkdir", root="r0", path="file/x"), "exists_file")


@pytest.mark.parametrize("name", ["aux", "a:b", "Acme Inc.", "what?", "back\\slash", "control\x01"])
def test_r3_existing_names_browsable_and_uploadable(client, fs, name):
    root, _ = fs
    (root / name).mkdir()
    (root / name / "needle").touch()
    assert get(client, "list", root="r0", path=name)["entries"][0]["name"] == "needle"
    assert post(client, "mkdir", root="r0", path=f"{name}/new")["ok"]
    upload = start(client, path=f"{name}/upload.txt", size=0)
    assert post(client, "uploads/finish", **upload, size=0)["ok"]
    for invalid in ("new?", "CON", "bad."):
        error(post(client, "mkdir", root="r0", path=f"{name}/{invalid}"), "bad_path")
        error(post(client, "uploads/start", root="r0", path=f"{name}/{invalid}", size=0), "bad_path")
