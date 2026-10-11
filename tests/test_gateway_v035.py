import errno
import os
from pathlib import Path
import sys
import time

import pytest

from conftest import error, get, post


@pytest.mark.parametrize("number,code,message", [
    (errno.EACCES, "permission_denied", "The agent's user isn't allowed to open or change this."),
    (errno.EPERM, "permission_denied", "The agent's user isn't allowed to open or change this."),
    (errno.ENOSPC, "no_space", "The agent's machine is out of disk space."),
    (errno.EDQUOT, "no_space", "The agent's machine is out of disk space."),
    (errno.EROFS, "read_only", "This location is read-only."),
    (errno.EIO, "io_error", "The filesystem operation failed."),
])
def test_filesystem_error_codes(client, api, fs, monkeypatch, number, code, message):
    def failed(*args, **kwargs):
        raise OSError(number, "fixture")
    monkeypatch.setattr(api, "_mkdir", failed)
    assert post(client, "mkdir", root="r0", path="new") == {"ok": False, "code": code, "message": message}


def test_error_codes_without_edquot(monkeypatch):
    # Windows has no errno.EDQUOT: the module still loads and maps the other codes.
    from conftest import load_plugin_api
    monkeypatch.delattr(errno, "EDQUOT")
    module = load_plugin_api("hcfm_no_edquot")

    def failing(number):
        def fn():
            raise OSError(number, "fixture")
        return module._protocol(fn)
    assert failing(errno.EACCES)()["code"] == "permission_denied"
    assert failing(errno.EIO)()["code"] == "io_error"
    assert None not in module._ERRNO_CODES


@pytest.mark.parametrize("mb,expected", [(250.5, 250), (1.0, 1), (1.5, 1), (0.5, 100),
    (True, 100), (float("inf"), 100), (float("nan"), 100), (0, 100), (-1, 100), ("250", 100), (250, 250)])
def test_decimal_file_limit(api, fs, mb, expected):
    _, cfg = fs
    cfg["plugins"]["entries"][api.PLUGIN_NAME]["settings"]["max_file_mb"] = mb
    assert api._max_bytes(cfg) == expected * 1024 * 1024


@pytest.mark.parametrize("backend", ["local", "docker"])
def test_all_invalid_roots_explained(client, api, fs, backend):
    root, cfg = fs
    cfg["terminal"] = {"backend": backend}
    cfg["plugins"]["entries"][api.PLUGIN_NAME]["settings"]["roots"] = [str(root / "missing"), "relative", "/", None]
    body = get(client, "roots")
    assert body["ok"] and body["roots"] == [] and body["code"] == "no_roots"
    assert body["supported"] is (backend == "local")
    assert body["reason"] == ("None of the folders in Cloud Files settings can be shown on this machine. "
                              "Check the paths in the plugin's settings.")
    assert body["chunk_bytes"] == api.CHUNK_BYTES and body["max_file_bytes"] == 100 * 1024 * 1024


def test_empty_roots_uses_working_folder(client, api, fs):
    root, cfg = fs
    cfg["terminal"] = {"cwd": str(root)}
    cfg["plugins"]["entries"][api.PLUGIN_NAME]["settings"]["roots"] = []
    body = get(client, "roots")
    assert body["roots"][0]["path"] == str(root) and body["reason"] is None
    assert "code" not in body


def test_folded_containment_needs_matching_identity(api, monkeypatch, tmp_path):
    # Model a case-sensitive volume on every platform, including case-insensitive APFS.
    root = tmp_path / "Work"
    different = tmp_path / "work"
    monkeypatch.setattr(api, "_canonical", lambda path: str(path).casefold())
    monkeypatch.setattr(api, "_identity", lambda path: (1, 1) if path == root else (1, 2))
    assert api._contained(different / "docs", root) is None
    assert api._contained(root / "docs", root) == root / "docs"
    monkeypatch.setattr(api, "_identity", lambda path: (1, 1))
    assert api._contained(different / "docs", root) == root / "docs"


@pytest.mark.skipif(sys.platform != "darwin", reason="mis-cased APFS root")
def test_miscased_root_internal_absolute_link(client, api, fs):
    root, cfg = fs
    actual = root / "CaseWork"
    actual.mkdir()
    spelling = root / "casework"
    if not spelling.is_dir():
        pytest.skip("case-sensitive volume")
    (actual / "docs").mkdir()
    (actual / "docs/note.txt").write_text("hello")
    (actual / "link").symlink_to(actual / "docs")
    cfg["plugins"]["entries"][api.PLUGIN_NAME]["settings"]["roots"] = [str(spelling)]
    link = next(e for e in get(client, "list", root="r0")["entries"] if e["name"] == "link")
    assert link["is_dir"] and not link["link_outside"]
    assert get(client, "list", root="r0", path="link")["entries"][0]["name"] == "note.txt"


def test_distinct_case_directories_stay_outside(client, api, fs, monkeypatch):
    root, cfg = fs
    actual, other = root / "Work", root / "work"
    actual.mkdir()
    if other.exists():
        pytest.skip("volume cannot express distinct case-only directories")
    other.mkdir()
    (other / "secret").touch()
    (actual / "link").symlink_to(other)
    cfg["plugins"]["entries"][api.PLUGIN_NAME]["settings"]["roots"] = [str(actual)]
    original = api._canonical
    monkeypatch.setattr(api, "_canonical", lambda path: original(path).casefold())
    entry = get(client, "list", root="r0")["entries"][0]
    assert entry["link_outside"] and not entry["is_dir"]
    error(get(client, "list", root="r0", path="link"), "outside_root")


def test_sweep_stale_reserved_directories_only(api, fs):
    root, _ = fs
    names = [".cfm-" + c * 32 + ".dir" for c in "abcde"]
    stale, fresh, link, regular, uppercase = [root / name for name in names]
    uppercase = uppercase.with_name(uppercase.name.upper())
    stale.mkdir()
    (stale / "download").touch()
    fresh.mkdir()
    target = root / "keep"
    target.mkdir()
    link.symlink_to(target)
    regular.touch()
    uppercase.mkdir()
    old = time.time() - 25 * 3600
    for path in (stale, link, regular, uppercase):
        os.utime(path, (old, old), follow_symlinks=False)
    api._sweep(root)
    assert not stale.exists()
    assert fresh.is_dir() and link.is_symlink() and target.is_dir() and regular.is_file() and uppercase.is_dir()


def test_sweep_scandir_failure_does_not_block_upload(client, api, fs, monkeypatch):
    def failed(*args):
        raise PermissionError(errno.EACCES, "fixture")
    monkeypatch.setattr(api.os, "scandir", failed)
    assert post(client, "uploads/start", root="r0", path="new", size=0)["ok"]


@pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0, reason="root bypasses permissions")
def test_write_only_folder_accepts_upload(client, fs):
    root, _ = fs
    folder = root / "write-only"
    folder.mkdir()
    folder.chmod(0o300)
    try:
        start = post(client, "uploads/start", root="r0", path="write-only/new", size=0)
        assert start["ok"]
        assert post(client, "uploads/finish", root="r0", path="write-only/new", size=0,
                    upload_id=start["upload_id"])["ok"]
    finally:
        folder.chmod(0o700)
    assert (folder / "new").is_file()


def test_drive_import_sweeps_staging(client, api, fs, monkeypatch):
    root, _ = fs
    dest = root / "dest"
    dest.mkdir()
    stale = dest / (".cfm-" + "a" * 32 + ".dir")
    stale.mkdir()
    old = time.time() - 25 * 3600
    os.utime(stale, (old, old))
    def command(args, *unused, **kw):
        if args[0] == "get":
            assert not stale.exists()
            return {"name": "file", "mimeType": "text/plain"}
        Path(args[-1]).write_text("downloaded")
    monkeypatch.setattr(api, "_drive_command", command)
    assert post(client, "drive/import", root="r0", dest="dest", id="abcdefghij")["ok"]
    assert not stale.exists()


@pytest.mark.parametrize("path", [".cfm-" + "a" * 32 + ".dir", ".cfm-" + "b" * 32 + ".part",
                                  ".CFM-" + "C" * 32 + ".PART", "x/.cfm-" + "d" * 32 + ".dir/y"])
def test_mkdir_refuses_reserved_temporary_names(client, api, fs, path):
    root, _ = fs
    error(post(client, "mkdir", root="r0", path=path), "bad_path")
    assert not any(p.name.lower().startswith(".cfm-") for p in root.rglob("*"))


def test_mkdir_allows_an_upper_case_staging_lookalike(client, api, fs):
    # Only the exact lower-case .dir name is swept, so only that one (and any .part spelling) is reserved.
    assert post(client, "mkdir", root="r0", path=".cfm-" + "E" * 32 + ".dir")["ok"]
