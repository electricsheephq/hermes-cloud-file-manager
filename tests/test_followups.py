"""Issue #19 regressions: finish replay and symlink listing metadata."""
import base64
import os
from pathlib import Path

import pytest

from conftest import error, get, post


def finish_once(client, path="a.txt", data=b"uploaded"):
    started = post(client, "uploads/start", root="r0", path=path, size=len(data))
    assert started["ok"] is True
    upload = {"root": "r0", "path": path, "upload_id": started["upload_id"]}
    assert post(client, "uploads/chunk", **upload, offset=0,
                data=base64.b64encode(data).decode())["ok"] is True
    request = {**upload, "size": len(data)}
    result = post(client, "uploads/finish", **request)
    assert result["ok"] is True
    return request, result


@pytest.mark.parametrize("collision", [False, True], ids=["original-name", "renamed"])
def test_finish_replay_same_file(client, fs, collision):
    root, _ = fs
    if collision:
        (root / "a.txt").write_bytes(b"original")
    request, first = finish_once(client)
    candidate = root / first["entry"]["rel"]
    before = os.lstat(candidate)
    replay = post(client, "uploads/finish", **request)
    assert replay == first
    assert replay["renamed"] is collision
    assert sorted(p.name for p in root.iterdir()) == (["a (1).txt", "a.txt"] if collision else ["a.txt"])
    assert candidate.read_bytes() == b"uploaded"
    after = os.lstat(candidate)
    assert (after.st_dev, after.st_ino, after.st_mtime_ns) == (before.st_dev, before.st_ino, before.st_mtime_ns)
    if collision:
        assert (root / "a.txt").read_bytes() == b"original"


def test_finish_replay_different_path_gone(client, fs):
    request, _ = finish_once(client)
    error(post(client, "uploads/finish", **{**request, "path": "other.txt"}), "gone")
    assert [p.name for p in fs[0].iterdir()] == ["a.txt"]


def test_finish_replay_different_root_gone(client, fs, tmp_path):
    request, _ = finish_once(client)
    other = tmp_path / "other-root"
    other.mkdir()
    fs[1]["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["roots"] = [str(other)]
    error(post(client, "uploads/finish", **request), "gone")
    assert list(other.iterdir()) == []
    assert (fs[0] / "a.txt").read_bytes() == b"uploaded"


def test_finish_replay_different_size_gone(client, fs):
    request, _ = finish_once(client)
    error(post(client, "uploads/finish", **{**request, "size": request["size"] + 1}), "gone")


def test_finish_replay_expired_gone(client, api, fs, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(api.time, "monotonic", lambda: clock[0])
    request, _ = finish_once(client)
    clock[0] = 3699.0
    assert post(client, "uploads/finish", **request)["ok"] is True
    clock[0] = 3700.0
    error(post(client, "uploads/finish", **request), "gone")


def test_finish_replay_deleted_file_gone(client, fs):
    request, first = finish_once(client)
    (fs[0] / first["entry"]["rel"]).unlink()
    error(post(client, "uploads/finish", **request), "gone")
    assert list(fs[0].iterdir()) == []


def test_finish_replay_replaced_inode_gone_untouched(client, fs):
    request, first = finish_once(client)
    candidate = fs[0] / first["entry"]["rel"]
    original = os.lstat(candidate)
    replacement = fs[0] / "replacement"
    replacement.write_bytes(b"replacement")
    os.replace(replacement, candidate)
    before = os.lstat(candidate)
    assert (before.st_dev, before.st_ino) != (original.st_dev, original.st_ino)
    error(post(client, "uploads/finish", **request), "gone")
    assert candidate.read_bytes() == b"replacement"
    after = os.lstat(candidate)
    assert (after.st_dev, after.st_ino, after.st_mtime_ns) == (before.st_dev, before.st_ino, before.st_mtime_ns)


@pytest.mark.parametrize("outside", [False, True], ids=["inside", "outside"])
def test_finish_replay_replaced_symlink_gone(client, fs, tmp_path, outside):
    request, first = finish_once(client)
    candidate = fs[0] / first["entry"]["rel"]
    target = (tmp_path if outside else fs[0]) / "replacement"
    target.write_bytes(b"untouched")
    candidate.unlink()
    candidate.symlink_to(target)
    error(post(client, "uploads/finish", **request), "gone")
    assert candidate.is_symlink()
    assert target.read_bytes() == b"untouched"


def test_abort_after_finish_keeps_published_file(client, fs):
    request, first = finish_once(client)
    upload = {key: value for key, value in request.items() if key != "size"}
    assert post(client, "uploads/abort", **upload) == {"ok": True}
    assert (fs[0] / first["entry"]["rel"]).read_bytes() == b"uploaded"


def test_drive_import_does_not_record_finish(client, api, fs, monkeypatch):
    upload_id = "a" * 32
    monkeypatch.setattr(api.secrets, "token_hex", lambda count: upload_id)

    def command(args, *unused, **kwargs):
        if args[0] == "get":
            return {"name": "drive.txt", "mimeType": "text/plain", "size": "5"}
        assert args[:2] == ["download", "abcdefghij"]
        Path(args[3]).write_bytes(b"drive")

    monkeypatch.setattr(api, "_drive_command", command)
    result = post(client, "drive/import", root="r0", id="abcdefghij", dest="imports")
    assert result["ok"] is True
    error(post(client, "uploads/finish", root="r0", path="imports/drive.txt", size=5,
               upload_id=upload_id), "gone")
    assert upload_id not in getattr(api, "_FINISHED", {})
    assert (fs[0] / "imports/drive.txt").read_bytes() == b"drive"


def test_outside_link_never_stats_target(client, fs, tmp_path, monkeypatch):
    target = tmp_path / "outside"
    target.write_bytes(b"target data")
    link = fs[0] / "outside-link"
    link.symlink_to(target)
    info = os.lstat(link)
    original_stat, original_path_stat = os.stat, Path.stat

    def checked_stat(path, *args, **kwargs):
        if not isinstance(path, int) and os.fspath(path) == str(link) and kwargs.get("follow_symlinks", True):
            pytest.fail("os.stat followed the outside link")
        return original_stat(path, *args, **kwargs)

    def checked_path_stat(path, *args, **kwargs):
        if path == link:
            pytest.fail("Path.stat followed the outside link")
        return original_path_stat(path, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(os, "stat", checked_stat)
        patch.setattr(Path, "stat", checked_path_stat)
        listing = get(client, "list", root="r0")
    assert listing["ok"] is True
    entry, = listing["entries"]
    assert entry["rel"] == "outside-link" and entry["link_outside"] is True
    assert entry["is_dir"] is False
    assert (entry["size"], entry["mtime"]) == (info.st_size, info.st_mtime)


def test_dangling_outside_link_listed(client, fs, tmp_path):
    link = fs[0] / "dangling-outside"
    link.symlink_to(tmp_path / "missing")
    entry, = get(client, "list", root="r0")["entries"]
    assert entry["rel"] == link.name and entry["link_outside"] is True
    assert entry["is_dir"] is False and entry["size"] == os.lstat(link).st_size


def test_dangling_inside_link_skipped(client, fs):
    (fs[0] / "dangling-inside").symlink_to(fs[0] / "missing")
    assert get(client, "list", root="r0")["entries"] == []


def test_outside_link_into_hermes_home_hidden(client, api, fs, tmp_path, monkeypatch):
    home = tmp_path / "hermes"
    home.mkdir()
    target = home / "private"
    target.write_bytes(b"private fixture")
    (fs[0] / "protected-link").symlink_to(target)
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    assert get(client, "list", root="r0")["entries"] == []


@pytest.mark.parametrize("directory", [False, True], ids=["file", "folder"])
def test_inside_link_keeps_target_metadata(client, fs, directory):
    target = fs[0] / "target"
    if directory:
        target.mkdir()
    else:
        target.write_bytes(b"inside")
    (fs[0] / "inside-link").symlink_to(target, target_is_directory=directory)
    entries = {entry["name"]: entry for entry in get(client, "list", root="r0")["entries"]}
    entry = entries["inside-link"]
    assert entry["link_outside"] is False and entry["is_dir"] is directory
    assert entry["size"] == (None if directory else target.stat().st_size)
    assert entry["mtime"] == target.stat().st_mtime


def test_finish_record_failure_never_fails_a_published_upload(client, api, fs, monkeypatch):
    # Recording the replay is best-effort: a file that vanishes right after publishing must not turn success into io_error.
    real_lstat = api.os.lstat
    def flaky(path, *args, **kwargs):
        if str(path).endswith("late.txt"):
            raise FileNotFoundError(path)
        return real_lstat(path, *args, **kwargs)
    upload = post(client, "uploads/start", root="r0", path="late.txt", size=0)
    monkeypatch.setattr(api.os, "lstat", flaky)
    body = post(client, "uploads/finish", root="r0", path="late.txt", size=0, upload_id=upload["upload_id"])
    assert body["ok"] is True and (fs[0] / "late.txt").exists()


def test_finish_retry_during_inflight_original_replays(client, api, fs, monkeypatch):
    # A retry sent while the first finish is still publishing (client timeout) must wait and replay, not duplicate.
    import threading
    import time as _time
    root, _ = fs
    data = b"slow"
    started = post(client, "uploads/start", root="r0", path="slow.txt", size=len(data))
    upload = {"root": "r0", "path": "slow.txt", "upload_id": started["upload_id"]}
    post(client, "uploads/chunk", **upload, offset=0, data=base64.b64encode(data).decode())
    request = {**upload, "size": len(data)}
    real_publish, entered, release = api._publish, threading.Event(), threading.Event()
    def slow_publish(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return real_publish(*args, **kwargs)
    monkeypatch.setattr(api, "_publish", slow_publish)
    results = {}
    first = threading.Thread(target=lambda: results.__setitem__("first", post(client, "uploads/finish", **request)))
    first.start()
    assert entered.wait(5)
    retry = threading.Thread(target=lambda: results.__setitem__("retry", post(client, "uploads/finish", **request)))
    retry.start()
    _time.sleep(0.3)  # the retry is now waiting behind the in-flight original
    release.set()
    first.join(5)
    retry.join(5)
    assert results["first"]["ok"] is True
    assert results["retry"] == results["first"]
    assert sorted(p.name for p in root.iterdir()) == ["slow.txt"]
