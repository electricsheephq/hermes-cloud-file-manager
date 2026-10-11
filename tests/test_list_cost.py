"""Cost and freshness regression guards; clocks and call counts, never elapsed-time assertions."""
import base64
import hashlib
from pathlib import Path

import pytest

from conftest import get, post


def test_plain_listing_constant_guard_cost(client, api, fs, monkeypatch):
    root, _ = fs
    for n in range(300):
        (root / f"file{n}").touch()
    counts = {"realpath": 0, "protected": 0}
    realpath, protected = api.os.path.realpath, api._check_protected
    def counted_realpath(*args, **kwargs):
        counts["realpath"] += 1
        return realpath(*args, **kwargs)
    def counted_protected(*args, **kwargs):
        counts["protected"] += 1
        return protected(*args, **kwargs)
    monkeypatch.setattr(api.os.path, "realpath", counted_realpath)
    monkeypatch.setattr(api, "_check_protected", counted_protected)
    assert get(client, "list", root="r0")["total"] == 300
    assert counts["realpath"] <= 10
    assert counts["protected"] <= 2


def test_load_more_scans_once(client, api, fs, monkeypatch):
    root, _ = fs
    for n in range(2200):
        (root / f"file{n:04}").touch()
    scans = []
    original = api.os.scandir
    def observed(path):
        if Path(path) == root:
            scans.append(path)
        return original(path)
    monkeypatch.setattr(api.os, "scandir", observed)
    monkeypatch.setattr(api.time, "monotonic", lambda: 100.0)
    previous = None
    for offset, limit in ((0, 500), (499, 501), (999, 501), (1499, 501), (1999, 501)):
        body = get(client, "list", root="r0", offset=offset, limit=limit)
        if previous is not None:
            assert body["entries"][0]["abs"] == previous
        previous = body["entries"][-1]["abs"]
    assert len(scans) == 1


@pytest.mark.parametrize("route", ["mkdir", "upload", "save", "drive"])
def test_write_clears_whole_cache_even_with_coarse_folder_times(client, api, fs, monkeypatch, route):
    root, _ = fs
    target = root / "note.md"
    target.write_text("old")
    # Freeze the actual key: invalidation must work independently of directory timestamp changes.
    key = api._list_key(api._roots()[0], root)
    monkeypatch.setattr(api, "_list_key", lambda *args: key)
    get(client, "list", root="r0")
    assert api._LIST_CACHE
    if route == "mkdir":
        assert post(client, "mkdir", root="r0", path="new")["ok"]
    elif route == "upload":
        start = post(client, "uploads/start", root="r0", path="new", size=3)
        post(client, "uploads/chunk", root="r0", path="new", upload_id=start["upload_id"], offset=0,
             data=base64.b64encode(b"new").decode())
        get(client, "list", root="r0")  # re-prime specifically before publication
        assert post(client, "uploads/finish", root="r0", path="new", upload_id=start["upload_id"], size=3)["ok"]
    elif route == "save":
        assert post(client, "file/save", root="r0", path="note.md", text="longer", base_sha256=
                    hashlib.sha256(b"old").hexdigest())["ok"]
    else:
        def command(args, *unused, **kw):
            if args[0] == "get":
                return {"name": "new", "mimeType": "text/plain"}
            Path(args[-1]).write_text("downloaded")
            get(client, "list", root="r0")  # re-prime before the shared publication helper
        monkeypatch.setattr(api, "_drive_command", command)
        assert post(client, "drive/import", id="abcdefghij", root="r0", dest="")["ok"]
    assert api._LIST_CACHE == {}
    entries = get(client, "list", root="r0")["entries"]
    if route == "save":
        assert next(e for e in entries if e["name"] == "note.md")["size"] == 6
    else:
        assert "new" in {e["name"] for e in entries}


def test_external_child_change_expires_at_five_seconds(client, api, fs, monkeypatch):
    root, _ = fs
    target = root / "file"
    target.write_text("old")
    clock = [100.0]
    monkeypatch.setattr(api.time, "monotonic", lambda: clock[0])
    assert get(client, "list", root="r0")["entries"][0]["size"] == 3
    target.write_text("longer")
    clock[0] = 104.9
    assert get(client, "list", root="r0")["entries"][0]["size"] == 3
    clock[0] = 105.0
    assert get(client, "list", root="r0")["entries"][0]["size"] == 6


def test_cache_eight_folder_limit_and_alias_paths(client, api, fs):
    root, _ = fs
    for n in range(9):
        folder = root / f"folder{n}"
        folder.mkdir()
        (folder / "file").touch()
        get(client, "list", root="r0", path=folder.name)
    assert len(api._LIST_CACHE) == 8
    (root / "alias").symlink_to(root / "folder8")
    body = get(client, "list", root="r0", path="alias")
    assert body["entries"][0]["rel"] == "alias/file"
    assert body["entries"][0]["abs"] == str(root / "alias/file")
    assert len(api._LIST_CACHE) == 8
