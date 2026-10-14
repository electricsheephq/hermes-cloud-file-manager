"""Read-only gateway preview acceptance, using only temporary fixture files."""

import base64
import os

import pytest

from conftest import error, get


IMAGE_MIME = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "webp": "image/webp", "bmp": "image/bmp", "ico": "image/x-icon", "svg": "image/svg+xml",
}
TEXT_EXTS = (
    "json jsonl ndjson yaml yml toml ini cfg conf properties csv tsv log xml html htm css scss less "
    "js mjs cjs ts tsx jsx py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh fish ps1 sql r "
    "lua pl dart scala vue svelte graphql proto tf diff patch rst tex adoc srt vtt"
).split()


def preview(client, path):
    return get(client, "file/preview", root="r0", path=path)


def test_canonical_tables_and_limits(api):
    assert api.PREVIEW_IMAGE_MIME == IMAGE_MIME
    assert api.PREVIEW_PDF_EXTS == {"pdf"}
    assert api.PREVIEW_TEXT_EXTS == set(TEXT_EXTS)
    assert api.PREVIEW_MAX_BYTES == 10 * 1024 * 1024
    assert api.TEXT_PREVIEW_MAX_BYTES == 1024 * 1024


@pytest.mark.parametrize("ext", TEXT_EXTS + ["JSON"])
def test_text(client, fs, ext):
    raw = "hello\r\n世界\n".encode()
    target = fs[0] / f"file.{ext}"
    target.write_bytes(raw)
    assert preview(client, target.name) == {
        "ok": True, "kind": "text", "text": raw.decode(), "truncated": False,
        "size": len(raw), "mtime": target.stat().st_mtime,
    }


def test_text_replaces_invalid_utf8(client, fs):
    (fs[0] / "file.json").write_bytes(b"a\xffb")
    assert preview(client, "file.json")["text"] == "a\ufffdb"


def test_truncated_text_bounded_read(client, api, fs, monkeypatch):
    cap = api.TEXT_PREVIEW_MAX_BYTES
    raw = b"a" * (cap - 1) + "é".encode() + b"more"
    target = fs[0] / "file.log"
    target.write_bytes(raw)
    read, sizes = api.os.read, []

    def record(fd, size):
        chunk = read(fd, size)
        sizes.append(len(chunk))
        return chunk

    monkeypatch.setattr(api.os, "read", record)
    assert preview(client, target.name) == {
        "ok": True, "kind": "text", "text": "a" * (cap - 1) + "\ufffd", "truncated": True,
        "size": len(raw), "mtime": target.stat().st_mtime,
    }
    assert sum(sizes) == cap + 1


def test_text_has_no_binary_size_cap(client, api, fs, monkeypatch):
    monkeypatch.setattr(api, "PREVIEW_MAX_BYTES", 1)
    (fs[0] / "file.json").write_bytes(b"{}")
    assert preview(client, "file.json")["text"] == "{}"


@pytest.mark.parametrize("ext", list(IMAGE_MIME) + ["PNG", "pdf", "PDF"])
def test_binary_round_trip(client, fs, ext):
    raw = b"\x00\xff\x89binary\r\n"
    target = fs[0] / f"file.{ext}"
    target.write_bytes(raw)
    kind = "pdf" if ext.lower() == "pdf" else "image"
    mime = "application/pdf" if kind == "pdf" else IMAGE_MIME[ext.lower()]
    body = preview(client, target.name)
    assert body == {
        "ok": True, "kind": kind, "mime": mime, "data": base64.b64encode(raw).decode("ascii"),
        "size": len(raw), "mtime": target.stat().st_mtime,
    }
    assert base64.b64decode(body["data"], validate=True) == raw


@pytest.mark.parametrize("ext", ["png", "pdf"])
def test_binary_above_editor_limit(client, api, fs, ext):
    raw = b"x" * (api.EDIT_MAX_BYTES + 1)
    (fs[0] / f"file.{ext}").write_bytes(raw)
    assert base64.b64decode(preview(client, f"file.{ext}")["data"]) == raw


@pytest.mark.parametrize("ext", ["md", "markdown", "txt", "exe"])
def test_not_previewable(client, fs, ext):
    (fs[0] / f"file.{ext}").write_bytes(b"text")
    error(preview(client, f"file.{ext}"), "not_previewable")


@pytest.mark.parametrize("offset", [0, 8191])
def test_not_text(client, fs, offset):
    (fs[0] / "file.json").write_bytes(b"a" * offset + b"\0")
    error(preview(client, "file.json"), "not_text")


def test_nul_after_sniff_window(client, fs):
    raw = b"a" * 8192 + b"\0"
    (fs[0] / "file.json").write_bytes(raw)
    assert preview(client, "file.json")["text"] == raw.decode()


@pytest.mark.parametrize("ext", ["png", "pdf"])
def test_too_large_before_open_or_read(client, api, fs, monkeypatch, ext):
    size = api.PREVIEW_MAX_BYTES + 1
    target = fs[0] / f"file.{ext}"
    with target.open("wb") as writer:
        writer.truncate(size)

    def no_io(*args, **kwargs):
        pytest.fail("An oversized preview must be refused before opening or reading")

    monkeypatch.setattr(api.os, "open", no_io)
    monkeypatch.setattr(api.os, "read", no_io)
    body = preview(client, target.name)
    error(body, "too_large")
    assert body["max_bytes"] == api.PREVIEW_MAX_BYTES
    assert body["size"] == size


def test_binary_at_cap(client, api, fs, monkeypatch):
    monkeypatch.setattr(api, "PREVIEW_MAX_BYTES", 8)
    (fs[0] / "file.png").write_bytes(b"x" * 8)
    assert base64.b64decode(preview(client, "file.png")["data"]) == b"x" * 8


@pytest.mark.parametrize("kind,code", [
    ("symlink", "is_link"), ("hard_link", "hard_link"),
    ("directory", "not_a_file"), ("mount", "mount_point"),
])
def test_unsafe_file_refused_before_open(client, api, fs, monkeypatch, kind, code):
    target = fs[0] / "file.json"
    if kind == "directory":
        target.mkdir()
    elif kind in {"symlink", "hard_link"}:
        other = fs[0] / "other.json"
        other.write_bytes(b"{}")
        if kind == "symlink":
            target.symlink_to(other)
        else:
            os.link(other, target)
    else:
        target.write_bytes(b"{}")
        ismount = api.os.path.ismount
        monkeypatch.setattr(api.os.path, "ismount", lambda path: path == target or ismount(path))

    def no_open(*args, **kwargs):
        pytest.fail("Unsafe files must be refused before opening")

    monkeypatch.setattr(api.os, "open", no_open)
    error(preview(client, target.name), code)


def test_protected_hermes_home(client, api, fs, monkeypatch):
    home = fs[0] / "hh"
    home.mkdir()
    (home / "file.json").write_bytes(b"{}")
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    error(preview(client, "hh/file.json"), "protected")


def test_parent_traversal(client, fs):
    error(preview(client, "../file.json"), "bad_path")


def test_outside_symlink(client, fs, tmp_path):
    target = tmp_path / "outside.json"
    target.write_bytes(b"{}")
    (fs[0] / "file.json").symlink_to(target)
    error(preview(client, "file.json"), "outside_root")


def test_missing_file(client, fs):
    error(preview(client, "gone.json"), "not_found")


def test_editor_still_refuses_json(client, fs):
    (fs[0] / "file.json").write_bytes(b"{}")
    error(get(client, "file", root="r0", path="file.json"), "not_editable")


def test_open_identity_and_flags(client, api, fs, monkeypatch):
    target = fs[0] / "file.json"
    target.write_bytes(b"original")
    real_open, flags = api.os.open, []

    def swap(path, mode, *args, **kwargs):
        flags.append(mode)
        target.rename(fs[0] / "original.json")
        target.write_bytes(b"replacement")
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(api.os, "open", swap)
    error(preview(client, target.name), "changed")
    assert len(flags) == 1
    if hasattr(os, "O_NOFOLLOW"):
        assert flags[0] & os.O_NOFOLLOW


@pytest.mark.parametrize("ext", ["json", "png", "pdf"])
@pytest.mark.parametrize("change", ["append", "rewrite"])
def test_torn_read(client, api, fs, monkeypatch, ext, change):
    target = fs[0] / f"file.{ext}"
    raw = b"a" * 65536 + b"tail"
    target.write_bytes(raw)
    os.utime(target, (946684800, 946684800))
    read, changes = api.os.read, []

    def mutate(fd, size):
        chunk = read(fd, size)
        if not changes:
            with target.open("ab" if change == "append" else "r+b") as writer:
                writer.write(b"more" if change == "append" else b"b" * len(raw))
            changes.append(True)
        return chunk

    monkeypatch.setattr(api.os, "read", mutate)
    error(preview(client, target.name), "changed")
    assert changes == [True]
