"""Differential oracle: v0.3.4's scandir -> _entry -> sort -> slice algorithm."""
import json
import os
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
import unicodedata

import pytest

from conftest import get


def reference(api, root_id, path, offset, limit):
    selected, _ = api._request_root(root_id)
    folder = api._resolve(selected, path, for_write=False)
    if not folder.is_dir():
        raise api.GuardError("not_a_dir", "The selected path is not a directory.")
    entries, truncated = [], False
    with os.scandir(folder) as scan:
        for n, item in enumerate(scan):
            if n >= api.SCAN_LIMIT:
                truncated = True
                break
            entry = api._entry(selected, Path(item.path))
            if entry is not None:
                entries.append(entry)
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower(), e["name"]))
    return {"ok": True, "root": root_id, "path": api._rel(selected, folder),
            "entries": entries[offset:offset + limit], "total": len(entries), "truncated": truncated,
            "applied_sort": "name"}


@pytest.mark.parametrize("cache", [0, 5])
@pytest.mark.parametrize("home_root", [False, True])
@pytest.mark.parametrize("scan_limit", [7, 20000])
def test_generated_list_differential(client, api, fs, tmp_path, monkeypatch, cache, home_root, scan_limit):
    root, _ = fs
    for name in ("folder", "nested", ".hidden-dir", "agent-home", "agent-home/work", "unreadable"):
        (root / name).mkdir(parents=True, exist_ok=True)
    for name in ("a.txt", "B.txt", ".hidden", "name with spaces", "nested/a.txt", "nested/.hidden",
                 unicodedata.normalize("NFC", "café"), unicodedata.normalize("NFD", "naïve")):
        (root / name).write_text(name)
    for n in range(600):
        (root / "nested" / f"file-{n:03}.txt").touch()
    for name in (".cfm-" + "a" * 32 + ".part", ".CFM-" + "C" * 32 + ".PART"):
        (root / name).touch()
    for name in (".cfm-" + "b" * 32 + ".dir", ".CFM-" + "D" * 32 + ".DIR"):
        (root / name).mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret").touch()
    for name, target in {"link-file": root / "a.txt", "link-dir": root / "nested",
                         "outside-link": outside / "secret", "broken": root / "missing",
                         "home-link": root / "agent-home", "home-child-link": root / "agent-home/work"}.items():
        (root / name).symlink_to(target)
    if hasattr(os, "mkfifo"):
        os.mkfifo(root / "fifo")
    # APFS cannot create invalid UTF-8 names; inject one before any metadata access.
    scan = os.scandir
    @contextmanager
    def with_unencodable(folder):
        with scan(folder) as entries:
            items = list(entries)
            if Path(folder) == root:
                items.append(SimpleNamespace(name="bad-\udcff", path=str(root / "bad-\udcff")))
            yield iter(items)
    monkeypatch.setattr(api.os, "scandir", with_unencodable)
    unreadable = root / "unreadable"
    unreadable.chmod(0)
    monkeypatch.setattr(api, "LIST_CACHE_SECONDS", cache)
    monkeypatch.setattr(api, "SCAN_LIMIT", scan_limit)
    monkeypatch.setattr(api, "_hermes_homes", lambda: {root / "agent-home"})
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root if home_root else tmp_path / "other"))
    oracle = api._protocol(lambda *args: reference(api, *args))
    try:
        for path in ("", "nested", "link-dir", ".hidden-dir", "unreadable", "home-link", "home-child-link"):
            for offset, limit in ((0, 500), (1, 3), (499, 501), (999, 501), (1499, 501), (1999, 501)):
                expected = oracle("r0", path, offset, limit)
                actual = get(client, "list", root="r0", path=path, offset=offset, limit=limit)
                assert json.dumps(actual, sort_keys=True) == json.dumps(expected, sort_keys=True)
    finally:
        unreadable.chmod(0o700)


@pytest.mark.parametrize("cache", [0, 5])
def test_scoped_home_root_differential(client, api, fs, monkeypatch, cache):
    root, cfg = fs
    home = root / "agent-home"
    work = home / "work"
    work.mkdir(parents=True)
    (home / "config.yaml").touch()
    (work / ".visible").touch()
    (work / "link-home").symlink_to(home)
    (work / "file").touch()
    cfg["plugins"]["entries"][api.PLUGIN_NAME]["settings"]["roots"] = [str(work)]
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    monkeypatch.setattr(api, "LIST_CACHE_SECONDS", cache)
    assert get(client, "list", root="r0") == reference(api, "r0", "", 0, 500)


def test_without_protection_uses_entry(client, api, fs, monkeypatch):
    root, cfg = fs
    (root / "file").touch()
    selected = api.Root("r0", "files", root)
    monkeypatch.setattr(api, "_request_root", lambda _: (selected, cfg))
    original = api._entry
    calls = []
    def observed(*args):
        calls.append(args[1])
        return original(*args)
    monkeypatch.setattr(api, "_entry", observed)
    assert get(client, "list", root="r0")["total"] == 1
    assert calls == [root / "file"]


def test_directory_identity_is_excluded(client, api, fs, monkeypatch):
    root, cfg = fs
    protected = root / "protected-alias"
    protected.mkdir()
    snapshot = api.Protection((), frozenset({api._identity(protected)}))
    selected = api.Root("r0", "files", root, snapshot, False)
    monkeypatch.setattr(api, "_request_root", lambda _: (selected, cfg))
    assert get(client, "list", root="r0") == reference(api, "r0", "", 0, 500)
    assert get(client, "list", root="r0")["total"] == 0
