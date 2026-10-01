"""Red-first gateway editor acceptance, using only temporary fixture files."""

import hashlib
import os
from pathlib import Path
import stat
from threading import Barrier, Event, Thread
import time

import pytest

from conftest import PREFIX, error, get, post


MAX_BYTES = 1024 * 1024


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(client, path="note.md", base=b"old", text="new"):
    return post(client, "file/save", root="r0", path=path, base_sha256=sha(base), text=text)


@pytest.mark.parametrize("name", ["note.md", "note.MD", "note.markdown", "note.txt"])
def test_read_ok(client, fs, name):
    root, _ = fs
    raw = "# Hello\n世界\n".encode()
    target = root / name
    target.write_bytes(raw)
    body = get(client, "file", root="r0", path=name)
    assert body == {"ok": True, "text": raw.decode(), "sha256": sha(raw),
                    "size": len(raw), "mtime": target.stat().st_mtime}


def test_read_not_editable(client, fs):
    (fs[0] / "code.py").write_text("pass")
    error(get(client, "file", root="r0", path="code.py"), "not_editable")


def test_read_parent_traversal(client, fs):
    error(get(client, "file", root="r0", path="../note.md"), "bad_path")


def test_read_outward_middle_symlink(client, fs, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "note.md").write_text("outside fixture")
    (fs[0] / "link").symlink_to(outside, target_is_directory=True)
    error(get(client, "file", root="r0", path="link/note.md"), "outside_root")


def test_read_protected_hermes_home(client, api, fs, monkeypatch):
    home = fs[0] / "hh"
    home.mkdir()
    (home / "note.md").write_text("protected fixture")
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    error(get(client, "file", root="r0", path="hh/note.md"), "protected")


def test_read_home_dot_entry(client, fs, monkeypatch):
    root, _ = fs
    (root / ".note.md").write_text("hidden fixture")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    error(get(client, "file", root="r0", path=".note.md"), "protected")


def test_read_final_symlink(client, fs):
    root, _ = fs
    (root / "note.md").write_bytes(b"old")
    (root / "link.md").symlink_to(root / "note.md")
    error(get(client, "file", root="r0", path="link.md"), "is_link")


def test_read_hard_link(client, fs):
    root, _ = fs
    (root / "note.md").write_bytes(b"old")
    os.link(root / "note.md", root / "hard.md")
    error(get(client, "file", root="r0", path="hard.md"), "hard_link")


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="FIFO unsupported")
def test_read_fifo_does_not_hang(client, fs):
    os.mkfifo(fs[0] / "pipe.md")
    results, failures = [], []

    def request():
        try:
            results.append(get(client, "file", root="r0", path="pipe.md"))
        except BaseException as exc:
            failures.append(exc)

    thread = Thread(target=request, daemon=True)
    thread.start()
    thread.join(timeout=2)
    assert not thread.is_alive(), "Reading a FIFO must not block"
    assert not failures, failures
    error(results[0], "not_a_file")


def test_read_directory(client, fs):
    (fs[0] / "x.md").mkdir()
    error(get(client, "file", root="r0", path="x.md"), "not_a_file")


def test_read_not_text(client, fs):
    (fs[0] / "note.md").write_bytes(b"\xff\xfe")
    error(get(client, "file", root="r0", path="note.md"), "not_text")


def test_read_too_large(client, fs):
    (fs[0] / "note.md").write_bytes(b"x" * (MAX_BYTES + 1))
    body = get(client, "file", root="r0", path="note.md")
    error(body, "too_large")
    assert body["max_bytes"] == MAX_BYTES


def test_read_preserves_crlf_bom(client, fs):
    raw = b"\xef\xbb\xbf# title\r\nbody\r\n"
    (fs[0] / "note.md").write_bytes(raw)
    body = get(client, "file", root="r0", path="note.md")
    assert body["ok"] is True
    assert body["text"].encode() == raw
    assert body["sha256"] == sha(raw)


def test_save_ok_bytes_sha_and_mode(client, fs):
    target = fs[0] / "note.md"
    target.write_bytes(b"old")
    target.chmod(0o640)
    text = "\ufeff# changed\r\n世界\r\n"
    body = save(client, text=text)
    assert target.read_bytes() == text.encode()
    assert stat.S_IMODE(target.stat().st_mode) == 0o640
    assert body == {"ok": True, "sha256": sha(text.encode()), "size": len(text.encode()),
                    "mtime": target.stat().st_mtime}


def test_save_conflict(client, fs):
    target = fs[0] / "note.md"
    target.write_bytes(b"current\r\n")
    body = save(client)
    error(body, "conflict")
    assert body["sha256"] == sha(b"current\r\n")
    assert body["text"] == "current\r\n"
    assert target.read_bytes() == b"current\r\n"
    assert list(fs[0].glob(".cfm-*.part")) == []


def test_save_conflict_non_utf8_omits_text(client, fs):
    target = fs[0] / "note.md"
    target.write_bytes(b"\xff")
    body = save(client)
    error(body, "conflict")
    assert body["sha256"] == sha(b"\xff") and "text" not in body
    assert target.read_bytes() == b"\xff"


def test_save_missing_never_creates(client, fs):
    error(save(client), "gone")
    assert list(fs[0].iterdir()) == []


def test_save_not_editable(client, fs):
    target = fs[0] / "code.py"
    target.write_bytes(b"old")
    error(save(client, path="code.py"), "not_editable")
    assert target.read_bytes() == b"old"


def test_save_final_symlink(client, fs):
    root, _ = fs
    target = root / "note.md"
    target.write_bytes(b"old")
    (root / "link.md").symlink_to(target)
    error(save(client, path="link.md"), "is_link")
    assert target.read_bytes() == b"old" and (root / "link.md").is_symlink()


def test_save_hard_link(client, fs):
    root, _ = fs
    (root / "note.md").write_bytes(b"old")
    os.link(root / "note.md", root / "hard.md")
    error(save(client, path="hard.md"), "hard_link")
    assert (root / "note.md").read_bytes() == b"old"
    assert (root / "hard.md").read_bytes() == b"old"


def test_save_too_large(client, fs):
    target = fs[0] / "note.md"
    target.write_bytes(b"old")
    body = save(client, text="é" * (MAX_BYTES // 2 + 1))
    error(body, "too_large")
    assert body["max_bytes"] == MAX_BYTES
    assert target.read_bytes() == b"old" and list(fs[0].glob(".cfm-*.part")) == []


@pytest.mark.parametrize("base", ["", "a" * 63, "a" * 65, "A" * 64, "g" * 64, "a" * 64 + "\n"])
def test_save_malformed_sha_refused(client, fs, base):
    target = fs[0] / "note.md"
    target.write_bytes(b"old")
    response = client.post(f"{PREFIX}/file/save", json={
        "root": "r0", "path": "note.md", "base_sha256": base, "text": "new"})
    assert response.status_code == 422
    assert target.read_bytes() == b"old"


def test_save_replace_failure_cleans_temp(client, api, fs, monkeypatch):
    target = fs[0] / "note.md"
    target.write_bytes(b"old")
    attempted = []

    def fail(source, destination):
        assert destination == target
        assert api.TEMP_RE.fullmatch(source.name)
        assert source.read_bytes() == b"new"
        attempted.append(source)
        raise OSError("fixture replace failure")

    monkeypatch.setattr(api.os, "replace", fail)
    error(save(client), "io_error")
    assert attempted and target.read_bytes() == b"old"
    assert list(fs[0].glob(".cfm-*.part")) == []


def test_save_same_base_threads_one_conflict(client, fs):
    target = fs[0] / "note.md"
    target.write_bytes(b"old")
    barrier, results, failures = Barrier(2), [], []

    def request(text):
        try:
            barrier.wait(timeout=2)
            results.append((text, save(client, text=text)))
        except BaseException as exc:
            failures.append(exc)

    threads = [Thread(target=request, args=(text,), daemon=True) for text in ("first", "second")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=3)
    assert not any(thread.is_alive() for thread in threads)
    assert not failures, failures
    assert len(results) == 2
    winner = [(text, body) for text, body in results if body["ok"]]
    loser = [body for _, body in results if not body["ok"]]
    assert len(winner) == len(loser) == 1
    error(loser[0], "conflict")
    assert loser[0]["sha256"] == winner[0][1]["sha256"]
    assert loser[0]["text"] == winner[0][0]
    assert target.read_bytes() == winner[0][0].encode()
    assert list(fs[0].glob(".cfm-*.part")) == []


def test_failed_save_leftover_temp_hidden(client, api, fs, monkeypatch):
    root, _ = fs
    (root / "note.md").write_bytes(b"old")
    unlink = api.os.unlink
    leftovers = []

    def fail_replace(source, destination):
        leftovers.append(source)
        raise OSError("fixture replace failure")

    def fail_cleanup(path, *args, **kwargs):
        if api.TEMP_RE.fullmatch(Path(path).name):
            raise OSError("fixture cleanup failure")
        return unlink(path, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(api.os, "replace", fail_replace)
        patch.setattr(api.os, "unlink", fail_cleanup)
        error(save(client), "io_error")
    assert len(leftovers) == 1 and leftovers[0].exists()
    assert [e["name"] for e in get(client, "list", root="r0")["entries"]] == ["note.md"]
    assert get(client, "search", root="r0", q=".cfm-")["results"] == []
    assert (root / "note.md").read_bytes() == b"old"


@pytest.mark.parametrize("replacement", ["symlink", "missing", "other_inode"])
def test_save_target_changed_before_replace(client, api, fs, monkeypatch, replacement):
    root, _ = fs
    target, other = root / "note.md", root / "other.md"
    target.write_bytes(b"old")
    other.write_bytes(b"untouched")
    fsync = api.os.fsync
    swaps = []

    def swap(fd):
        fsync(fd)
        target.rename(root / "original.md")
        if replacement == "symlink":
            target.symlink_to(other)
        elif replacement == "other_inode":
            target.write_bytes(b"replacement")
        swaps.append(replacement)

    def no_replace(*args):
        pytest.fail("Changed target must be refused before replace")

    monkeypatch.setattr(api.os, "fsync", swap)
    monkeypatch.setattr(api.os, "replace", no_replace)
    error(save(client), "changed")
    assert swaps == [replacement]
    assert other.read_bytes() == b"untouched"
    assert (root / "original.md").read_bytes() == b"old"
    if replacement == "symlink":
        assert target.is_symlink()
    elif replacement == "missing":
        assert not target.exists()
    else:
        assert target.read_bytes() == b"replacement"
    assert list(root.glob(".cfm-*.part")) == []


@pytest.mark.parametrize("kind,code", [("protected", "protected"), ("outside", "outside_root"),
                                        ("traversal", "bad_path"), ("home_dot", "protected")])
def test_save_confinement_before_write(client, api, fs, tmp_path, monkeypatch, kind, code):
    root, _ = fs
    if kind == "protected":
        home = root / "hh"
        home.mkdir()
        target, path = home / "note.md", "hh/note.md"
        monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    elif kind == "outside":
        outside = tmp_path / "outside"
        outside.mkdir()
        (root / "link").symlink_to(outside, target_is_directory=True)
        target, path = outside / "note.md", "link/note.md"
    elif kind == "traversal":
        target, path = tmp_path / "note.md", "../note.md"
    else:
        target, path = root / ".note.md", ".note.md"
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    target.write_bytes(b"old")

    def no_open(*args, **kwargs):
        pytest.fail("Confinement must be checked before opening any file")

    with monkeypatch.context() as patch:
        patch.setattr(api.os, "open", no_open)
        error(save(client, path=path), code)
    assert target.read_bytes() == b"old"
    assert list(root.glob(".cfm-*.part")) == []


def test_read_missing_not_found(client, fs):
    error(get(client, "file", root="r0", path="gone.md"), "not_found")


def test_save_unencodable_text_not_text(client, fs):
    target = fs[0] / "note.md"
    target.write_bytes(b"old")
    # A lone surrogate is valid JSON (\\ud800) but cannot be encoded as UTF-8.
    payload = '{"root": "r0", "path": "note.md", "base_sha256": "%s", "text": "bad \\ud800"}' % sha(b"old")
    response = client.post(f"{PREFIX}/file/save", content=payload.encode(),
                           headers={"content-type": "application/json"})
    assert response.status_code == 200
    error(response.json(), "not_text")
    assert target.read_bytes() == b"old"


def test_save_aliases_share_one_lock(client, api, fs, monkeypatch):
    # Two spellings of one file (a folder link inside the root) must serialise: the second save sees the
    # first one's content and returns conflict instead of silently replacing it.
    root, _ = fs
    (root / "sub").mkdir()
    target = root / "sub" / "note.md"
    target.write_bytes(b"old")
    (root / "alias").symlink_to(root / "sub", target_is_directory=True)
    replace, entered, results = api.os.replace, Barrier(2), []

    def slow_replace(source, destination):
        if not results:  # only the first save to reach the replace waits, holding its lock
            results.append("slow")
            entered.wait(timeout=2)
            time.sleep(0.3)
        return replace(source, destination)

    monkeypatch.setattr(api.os, "replace", slow_replace)
    first = Thread(target=lambda: results.append(save(client, path="sub/note.md", text="first")), daemon=True)
    first.start()
    entered.wait(timeout=2)
    second = save(client, path="alias/note.md", text="second")
    first.join(timeout=3)
    assert results[1]["ok"] is True
    error(second, "conflict")
    assert target.read_bytes() == b"first"


def test_save_syncs_the_folder(client, api, fs, monkeypatch):
    target = fs[0] / "note.md"
    target.write_bytes(b"old")
    synced, fsync = [], api.os.fsync

    def record(fd):
        synced.append(os.path.isdir(f"/dev/fd/{fd}") or stat.S_ISDIR(os.fstat(fd).st_mode))
        return fsync(fd)

    monkeypatch.setattr(api.os, "fsync", record)
    assert save(client)["ok"] is True
    assert synced == [False, True]  # the temp file, then its folder after the replace


@pytest.mark.parametrize("route", ["read", "save"])
def test_mounted_file_refused(client, api, fs, monkeypatch, route):
    # A file mounted into the root (a Docker bind mount of a Hermes-home file, say) is refused, not read.
    target = fs[0] / "note.md"
    target.write_bytes(b"old")
    ismount = api.os.path.ismount
    monkeypatch.setattr(api.os.path, "ismount", lambda path: str(path) == str(target) or ismount(path))
    body = get(client, "file", root="r0", path="note.md") if route == "read" else save(client)
    error(body, "mount_point")
    assert target.read_bytes() == b"old"


def test_save_new_inode_generation_still_serialised(client, api, fs, monkeypatch):
    # A's replace gives the file a new inode while B waits for A's lock. C arrives while B is replacing and
    # must not slip past on a lock keyed to the new inode: B and C cannot both succeed.
    target = fs[0] / "note.md"
    target.write_bytes(b"same")
    replace, calls, results = api.os.replace, [], {}
    a_in, a_go, b_in = Event(), Event(), Event()

    def slow_replace(source, destination):
        calls.append(source)
        if len(calls) == 1:
            a_in.set()
            a_go.wait(timeout=2)
        elif len(calls) == 2:
            b_in.set()
            time.sleep(0.4)
        return replace(source, destination)

    monkeypatch.setattr(api.os, "replace", slow_replace)
    run = lambda key, text: results.__setitem__(key, save(client, base=b"same", text=text))
    a = Thread(target=run, args=("a", "same"), daemon=True)
    a.start()
    assert a_in.wait(timeout=2)
    b = Thread(target=run, args=("b", "from b"), daemon=True)
    b.start()
    time.sleep(0.1)  # B is now queued behind A
    a_go.set()
    a.join(timeout=3)
    assert b_in.wait(timeout=2)
    c = save(client, base=b"same", text="from c")
    b.join(timeout=3)
    assert results["a"]["ok"] is True
    assert len([body for body in (results["b"], c) if body["ok"]]) == 1


def test_read_opens_in_binary_mode(client, api, fs, monkeypatch):
    # Windows text mode would translate CRLF and stop at Ctrl-Z; the read must ask for O_BINARY like the save.
    (fs[0] / "note.md").write_bytes(b"a\r\nb")
    fake, flags, real_open = 0x40000000, [], api.os.open
    monkeypatch.setattr(api.os, "O_BINARY", fake, raising=False)

    def record(path, mode, *args, **kwargs):
        flags.append(mode)
        return real_open(path, mode & ~fake, *args, **kwargs)

    monkeypatch.setattr(api.os, "open", record)
    assert get(client, "file", root="r0", path="note.md")["text"] == "a\r\nb"
    assert flags and all(mode & fake for mode in flags)
