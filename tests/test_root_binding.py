"""v0.7.0: a write names the root's absolute path it started with, so a reordered settings list can't redirect it."""

import hashlib

import pytest

from conftest import error, get, post


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


@pytest.fixture
def two_roots(fs, tmp_path):
    first, cfg = fs
    second = tmp_path / "second"
    second.mkdir()
    for root in (first, second):
        (root / "report.md").write_bytes(b"same text")
    return first, second, cfg


def reorder(cfg, *roots):
    cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["roots"] = [str(r) for r in roots]


def test_roots_reports_each_path(client, two_roots):
    first, second, cfg = two_roots
    reorder(cfg, first, second)
    assert [(r["id"], r["path"]) for r in get(client, "roots")["roots"]] == [("r0", str(first)), ("r1", str(second))]


def test_save_refuses_after_reorder(client, two_roots):
    first, second, cfg = two_roots
    reorder(cfg, first, second)
    opened = str(first)  # the editor opened r0 = first
    reorder(cfg, second, first)  # settings changed while it was open: r0 is now `second`
    body = post(client, "file/save", root="r0", root_path=opened, path="report.md",
                base_sha256=sha(b"same text"), text="edited")
    error(body, "root_changed")
    assert (first / "report.md").read_bytes() == b"same text"
    assert (second / "report.md").read_bytes() == b"same text"


def test_save_with_current_root_path_writes(client, two_roots):
    first, second, cfg = two_roots
    reorder(cfg, second, first)
    body = post(client, "file/save", root="r1", root_path=str(first), path="report.md",
                base_sha256=sha(b"same text"), text="edited")
    assert body["ok"] is True
    assert (first / "report.md").read_text() == "edited"
    assert (second / "report.md").read_bytes() == b"same text"


def test_older_desktop_without_root_path_still_saves(client, two_roots):
    first, _, _ = two_roots
    body = post(client, "file/save", root="r0", path="report.md", base_sha256=sha(b"same text"), text="edited")
    assert body["ok"] is True
    assert (first / "report.md").read_text() == "edited"


def test_upload_mkdir_and_drive_import_refuse_a_stale_root(client, two_roots):
    first, second, cfg = two_roots
    reorder(cfg, second, first)
    stale = str(first)  # r0 was `first` when the batch started
    error(post(client, "uploads/start", root="r0", root_path=stale, path="new.txt", size=3), "root_changed")
    error(post(client, "uploads/chunk", root="r0", root_path=stale, upload_id="a" * 32, path="new.txt",
               offset=0, data="YWJj"), "root_changed")
    error(post(client, "uploads/finish", root="r0", root_path=stale, upload_id="a" * 32, path="new.txt", size=3),
          "root_changed")
    error(post(client, "mkdir", root="r0", root_path=stale, path="made"), "root_changed")
    error(post(client, "drive/import", id="1AbCdEfGhIjKlMnOpQrStUvWxYz0", root="r0", root_path=stale), "root_changed")
    assert not (second / "made").exists() and not (second / "new.txt").exists()


def test_reads_refuse_a_stale_root_and_older_desktops_still_read(client, two_roots):
    first, second, cfg = two_roots
    (first / "pic.json").write_text("{}")
    reorder(cfg, second, first)
    stale = str(first)
    error(get(client, "file", root="r0", root_path=stale, path="report.md"), "root_changed")
    error(get(client, "file/preview", root="r0", root_path=stale, path="report.md"), "root_changed")
    assert get(client, "file", root="r1", root_path=stale, path="report.md")["ok"] is True
    assert get(client, "file", root="r0", path="report.md")["ok"] is True
