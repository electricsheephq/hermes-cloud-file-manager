import base64
from concurrent.futures import ThreadPoolExecutor
import os
import time

import pytest

from conftest import error, get, post


def start(client, path="a.txt", size=6):
    body = post(client, "uploads/start", root="r0", path=path, size=size)
    assert body["ok"] is True
    return {"upload_id": body["upload_id"], "root": "r0", "path": path}


def chunk(client, upload, data, offset=0):
    return post(client, "uploads/chunk", **upload, offset=offset,
                data=base64.b64encode(data).decode())


@pytest.mark.parametrize("route", ["chunk", "finish", "abort"])
@pytest.mark.parametrize("upload_id", ["../x", "A" * 32, "f" * 31, "f" * 33, ""])
def test_bad_upload_id(client, fs, route, upload_id):
    fields = {"offset": 0, "data": ""} if route == "chunk" else {"size": 0} if route == "finish" else {}
    error(post(client, f"uploads/{route}", root="r0", path="x", upload_id=upload_id, **fields), "bad_upload_id")


def test_retry_overlap_and_offset(client, fs):
    root, _ = fs
    upload = start(client)
    assert chunk(client, upload, b"abc")["size"] == 3
    assert chunk(client, upload, b"abc")["size"] == 3
    assert chunk(client, upload, b"bcd", offset=1)["size"] == 4
    body = chunk(client, upload, b"!", offset=5)
    error(body, "offset")
    assert body["size"] == 4
    assert chunk(client, upload, b"ef", offset=4)["size"] == 6
    body = post(client, "uploads/finish", **upload, size=6)
    assert body["ok"] is True and body["renamed"] is False
    assert (root / "a.txt").read_bytes() == b"abcdef"


def test_bad_and_oversize_data(client, api, fs):
    upload = start(client)
    error(post(client, "uploads/chunk", **upload, offset=0, data="%%%"), "bad_data")
    error(post(client, "uploads/chunk", **upload, offset=0,
               data="x" * ((8 * 1024 * 1024 * 4) // 3 + 9)), "chunk_too_large")
    error(chunk(client, upload, b"x" * (8 * 1024 * 1024 + 1)), "chunk_too_large")


def test_size_caps_and_mismatch(client, fs):
    _, cfg = fs
    cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["max_file_mb"] = 1
    cap = 1024 * 1024
    body = post(client, "uploads/start", root="r0", path="x", size=cap + 1)
    error(body, "too_large")
    assert body["max_file_bytes"] == cap
    upload = start(client, size=cap)
    assert chunk(client, upload, b"x" * cap)["ok"] is True
    error(chunk(client, upload, b"y", offset=cap), "too_large")
    body = post(client, "uploads/finish", **upload, size=cap - 1)
    error(body, "size_mismatch")
    assert body["size"] == cap


def test_parent_swap_refused(client, fs, tmp_path):
    root, _ = fs
    upload = start(client, path="parent/a.txt")
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "parent").rename(root / "saved")
    (root / "parent").symlink_to(outside, target_is_directory=True)
    for body in (chunk(client, upload, b"abc"), post(client, "uploads/finish", **upload, size=0)):
        assert body["ok"] is False and body["code"] in {"outside_root", "gone"}
        assert body["message"]
    assert list(outside.iterdir()) == []
    assert (root / "saved" / f".cfm-{upload['upload_id']}.part").read_bytes() == b""


def test_no_overwrite(client, fs):
    root, _ = fs
    (root / "a.txt").write_bytes(b"original")
    upload = start(client)
    chunk(client, upload, b"new")
    body = post(client, "uploads/finish", **upload, size=3)
    assert body["renamed"] is True and body["entry"]["name"] == "a (1).txt"
    assert (root / "a.txt").read_bytes() == b"original"
    assert (root / "a (1).txt").read_bytes() == b"new"


def test_concurrent_finishes(client, fs):
    root, _ = fs
    uploads = [start(client) for _ in range(8)]
    for n, upload in enumerate(uploads):
        assert chunk(client, upload, str(n).encode())["ok"] is True
    with ThreadPoolExecutor(max_workers=8) as pool:
        bodies = list(pool.map(lambda u: post(client, "uploads/finish", **u, size=1), uploads))
    assert all(body["ok"] for body in bodies)
    assert len({body["entry"]["name"] for body in bodies}) == 8
    assert {p.read_bytes() for p in root.iterdir()} == {str(n).encode() for n in range(8)}


def test_no_hardlinks_and_long_name(client, api, fs, monkeypatch):
    root, _ = fs
    def forbidden(*args, **kwargs):
        raise PermissionError("hardlinks unsupported")
    monkeypatch.setattr(api.os, "link", forbidden)
    name = "é" * 125 + "x.txt"
    assert len(name.encode()) == 255
    (root / name).write_bytes(b"original")
    upload = start(client, path=name, size=1)
    chunk(client, upload, b"y")
    body = post(client, "uploads/finish", **upload, size=1)
    assert body["ok"] and body["renamed"]
    assert len(body["entry"]["name"].encode()) <= 255
    assert body["entry"]["name"].endswith(" (1).txt")
    assert (root / name).read_bytes() == b"original"


def test_dotfile_collision(client, fs):
    root, _ = fs
    (root / ".env").write_text("original")
    upload = start(client, path=".env", size=0)
    assert post(client, "uploads/finish", **upload, size=0)["entry"]["name"] == ".env (1)"


def test_temps_hidden_swept_without_following_links(client, fs, tmp_path):
    root, _ = fs
    old = root / (".cfm-" + "a" * 32 + ".part")
    old.touch()
    recent = root / (".cfm-" + "b" * 32 + ".part")
    recent.touch()
    os.utime(old, (time.time() - 90000,) * 2)
    outside = tmp_path / "outside-file"
    outside.write_text("untouched")
    link = root / (".cfm-" + "c" * 32 + ".part")
    link.symlink_to(outside)
    try:
        os.utime(link, (time.time() - 90000,) * 2, follow_symlinks=False)
    except (NotImplementedError, OSError):
        pass
    assert get(client, "list", root="r0")["entries"] == []
    assert get(client, "search", root="r0", q="cfm")["results"] == []
    upload = start(client, path="visible")
    assert not old.exists() and recent.exists() and link.is_symlink()
    assert outside.read_text() == "untouched"
    assert post(client, "uploads/abort", **upload)["ok"] is True
    assert post(client, "uploads/abort", **upload)["ok"] is True


def test_temp_pattern_not_final_collision_candidate(client, fs):
    root, _ = fs
    name = ".cfm-" + "d" * 32 + ".part"
    upload = start(client, path=name, size=0)
    body = post(client, "uploads/finish", **upload, size=0)
    assert body["renamed"] is True
    assert body["entry"]["name"] == ".cfm-" + "d" * 32 + " (1).part"
    assert not (root / name).exists()


def test_missing_or_symlink_temp(client, fs, tmp_path):
    root, _ = fs
    upload = start(client)
    temp = root / f".cfm-{upload['upload_id']}.part"
    temp.unlink()
    error(chunk(client, upload, b"x"), "gone")
    error(post(client, "uploads/finish", **upload, size=0), "gone")
    outside = tmp_path / "outside"
    outside.write_bytes(b"safe")
    temp.symlink_to(outside)
    error(chunk(client, upload, b"x"), "gone")
    error(post(client, "uploads/finish", **upload, size=4), "gone")
    assert post(client, "uploads/abort", **upload)["ok"]
    assert temp.is_symlink() and outside.read_bytes() == b"safe"


@pytest.mark.parametrize("path", ["", "."])
def test_upload_root_has_no_filename(client, fs, path):
    error(post(client, "uploads/start", root="r0", path=path, size=0), "bad_path")


@pytest.mark.parametrize("name", ["x." + "a" * 253, "ééx." + "a" * 249])
def test_first_255_byte_name_and_unfittable_collision(client, fs, name):
    root, _ = fs
    assert len(name.encode("utf-8")) == 255
    first = start(client, path=name, size=1)
    assert chunk(client, first, b"a")["ok"] is True
    body = post(client, "uploads/finish", **first, size=1)
    assert body["ok"] is True and body["renamed"] is False
    assert body["entry"]["name"] == name
    second = start(client, path=name, size=1)
    assert chunk(client, second, b"b")["ok"] is True
    error(post(client, "uploads/finish", **second, size=1), "no_free_name")
    assert (root / name).read_bytes() == b"a"
    temp = root / f".cfm-{second['upload_id']}.part"
    assert temp.read_bytes() == b"b"
    assert post(client, "uploads/abort", **second)["ok"] is True
    assert not temp.exists()
