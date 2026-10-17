"""Gateway date sorting, pagination and shared name-order cache."""

import os

import pytest

from conftest import error, get


@pytest.fixture
def dated_folder(fs):
    root, _ = fs
    for name, is_dir, mtime in (("old-dir", True, 100), ("new-file", False, 400),
                                ("new-dir", True, 300), ("zulu", False, 200),
                                ("Beta", False, 200), ("alpha", False, 200)):
        path = root / name
        path.mkdir() if is_dir else path.touch()
        os.utime(path, (mtime, mtime))
    return root


def test_mtime_interleaves_files_and_folders(client, dated_folder):
    body = get(client, "list", root="r0", sort="mtime")
    assert body["ok"] and body["applied_sort"] == "mtime"
    assert [e["name"] for e in body["entries"]] == [
        "new-file", "new-dir", "alpha", "Beta", "zulu", "old-dir",
    ]
    assert [e["is_dir"] for e in body["entries"]] == [False, True, False, False, False, True]


def test_mtime_total_ties_and_missing_time(client, api, fs, monkeypatch):
    # Case-insensitive filesystems cannot hold both A and a. Synthetic scan rows also
    # exercise the final rel tiebreaker, which ordinary siblings cannot reach.
    rows = [{"name": name, "rel": rel, "mtime": mtime}
            for name, rel, mtime in (("z", "z", None), ("a", "b/a", 10),
                                     ("A", "A", 10), ("a", "a/a", 10), ("b", "b", 10))]
    monkeypatch.setattr(api, "_scan_folder", lambda *args: (rows, False))
    body = get(client, "list", root="r0", sort="mtime")
    assert [e["rel"] for e in body["entries"]] == ["A", "a/a", "b/a", "b", "z"]
    assert rows[0]["rel"] == "z"


def test_mtime_pages_cover_full_listing(client, dated_folder):
    full = get(client, "list", root="r0", sort="mtime")
    name = get(client, "list", root="r0", sort="name")
    entries = []
    for offset in range(0, full["total"], 2):
        page = get(client, "list", root="r0", sort="mtime", offset=offset, limit=2)
        assert page["applied_sort"] == "mtime"
        assert page["total"] == name["total"] == full["total"]
        entries.extend(page["entries"])
    assert entries == full["entries"]
    assert len({e["rel"] for e in entries}) == full["total"]
    assert get(client, "list", root="r0", sort="mtime", offset=full["total"])["entries"] == []


def test_default_and_name_keep_existing_order(client, dated_folder):
    default = get(client, "list", root="r0")
    named = get(client, "list", root="r0", sort="name")
    assert default == named
    assert default["applied_sort"] == "name"
    assert [e["name"] for e in default["entries"]] == [
        "new-dir", "old-dir", "alpha", "Beta", "new-file", "zulu",
    ]


@pytest.mark.parametrize("sort", ["size", ""])
def test_invalid_sort_uses_protocol_envelope(client, fs, sort):
    body = get(client, "list", root="r0", sort=sort)
    error(body, "bad_sort")
    assert body["message"] == "Sort by name or mtime."


def test_sorts_share_one_scan_without_reordering_cache(client, api, dated_folder, monkeypatch):
    scan, calls = api._scan_folder, []

    def counted(*args):
        calls.append(args[1])
        return scan(*args)

    monkeypatch.setattr(api, "_scan_folder", counted)
    monkeypatch.setattr(api.time, "monotonic", lambda: 100.0)
    name = get(client, "list", root="r0", sort="name")
    cached_entries = next(iter(api._LIST_CACHE.values()))[1]
    before = list(cached_entries)
    date = get(client, "list", root="r0", sort="mtime")
    assert date["entries"] != name["entries"]
    assert date["applied_sort"] == "mtime"
    assert cached_entries == before == name["entries"]
    assert next(iter(api._LIST_CACHE.values()))[1] is cached_entries
    assert get(client, "list", root="r0") == name
    assert calls == [dated_folder]


def test_mtime_preserves_scan_truncation(client, api, dated_folder, monkeypatch):
    monkeypatch.setattr(api, "SCAN_LIMIT", 3)
    date = get(client, "list", root="r0", sort="mtime")
    name = get(client, "list", root="r0")
    assert date["ok"] and date["applied_sort"] == "mtime"
    assert date["truncated"] is name["truncated"] is True
    assert date["total"] == name["total"] == 3
    assert {e["rel"] for e in date["entries"]} == {e["rel"] for e in name["entries"]}
    assert [e["mtime"] for e in date["entries"]] == sorted(
        (e["mtime"] for e in date["entries"]), reverse=True,
    )
