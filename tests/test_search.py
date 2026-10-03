"""Search REV 2: baseline parity, bounded cost and traversal, and response semantics."""
from contextlib import contextmanager
import fnmatch
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from conftest import error, get


def reference(api, selected, q):
    # v0.3.0 loop body from 65d707f, verbatim except the time/visit/result caps.
    _resolve, _rel, _entry, GuardError = api._resolve, api._rel, api._entry, api.GuardError
    SEARCH_SKIP = api.SEARCH_SKIP
    q = q.strip()
    stack, results, visited, skipped = [_resolve(selected, "", for_write=False)], [], 0, 0
    pattern, lower = "*" in q or "?" in q, q.lower()
    while stack:
        folder = stack.pop()
        try:
            folder = _resolve(selected, _rel(selected, folder), for_write=False)
            with os.scandir(folder) as scan:
                for item in scan:
                    visited += 1
                    entry = _entry(selected, Path(item.path))
                    if entry is None:
                        continue
                    if entry["is_dir"] and (item.name in SEARCH_SKIP or (item.name.startswith(".") and not q.startswith("."))):
                        continue
                    if fnmatch.fnmatch(item.name.lower(), lower) if pattern else lower in item.name.lower():
                        results.append(entry)
                    if entry["is_dir"] and not item.is_symlink():
                        stack.append(Path(item.path))
        except (GuardError, OSError):
            skipped += 1
    return {e["rel"] for e in results}


@pytest.mark.parametrize("home", [False, True])
@pytest.mark.parametrize("q", ["*", "node", "hidden", ".hidden", ".", "needle", "*.t?t", " REPORT ", ".cfm-", "absent"])
def test_i1_baseline_result_sets(client, api, fs, tmp_path, monkeypatch, home, q):
    root, _ = fs
    hh, outside = root / "hh", tmp_path / "outside"
    for folder in (hh, outside, root / "docs", root / ".hidden", root / "nested/.hidden",
                   root / "internal-skip", root / "outside-skip", *(root / n for n in api.SEARCH_SKIP)):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "needle.txt").touch()
    deep = root / "a/b/c/d/e/f/g"
    deep.mkdir(parents=True)
    (deep / "Report.TXT").touch()
    for name in (".top", "Report.TXT", ".CFM-" + "B" * 32 + ".PART"):
        (root / name).touch()
    for suffix in ("part", "dir"):
        temp = root / (".cfm-" + "a" * 32 + "." + suffix)
        temp.mkdir()
        (temp / "needle.txt").touch()
    for name, target in (("internal", root / "docs"), ("external", outside), ("dangling", outside / "missing"),
                         ("home-alias", hh), ("me", root), ("internal-skip/node_modules", root / "docs"),
                         ("outside-skip/node_modules", outside)):
        (root / name).symlink_to(target, target_is_directory=True)
    monkeypatch.setattr(api, "_hermes_homes", lambda: {hh})
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root if home else tmp_path))
    monkeypatch.setattr(api, "time", SimpleNamespace(monotonic=lambda: 0.0))
    selected = api._roots()[0]
    body = get(client, "search", root="r0", q=q, limit=200)
    assert {e["rel"] for e in body["results"]} == reference(api, selected, q)
    assert not body["truncated"]
    if q == "node":
        assert [e["rel"] for e in body["results"]] == ["outside-skip/node_modules"]
        assert body["results"][0]["link_outside"]
    if q == "hidden":
        assert body["results"] == []


def test_i2_i7_guard_on_pop_and_no_symlink_descent(client, api, fs, tmp_path, monkeypatch):
    root, _ = fs
    hh, outside = root / "hh", tmp_path / "outside"
    for folder in (hh, outside, root / "safe", root / "changed"):
        folder.mkdir()
        (folder / "needle.txt").touch()
    for name, target in (("internal", root / "safe"), ("external", outside), ("protected-link", hh),
                         ("dangling", root / "missing")):
        (root / name).symlink_to(target, target_is_directory=True)
    monkeypatch.setattr(api, "_hermes_homes", lambda: {hh})
    selected = api._roots()[0]
    monkeypatch.setattr(api, "_request_root", lambda _: (selected, {}))
    resolve, scan, scans, resolved = api._resolve, api.os.scandir, [], []
    def guarded(selected, rel, **kwargs):
        resolved.append(rel)
        if rel == "changed":
            raise api.GuardError("outside_root", "Fixture changed before pop.")
        return resolve(selected, rel, **kwargs)
    def observed(folder):
        scans.append(Path(folder))
        return scan(folder)
    monkeypatch.setattr(api, "_resolve", guarded)
    monkeypatch.setattr(api.os, "scandir", observed)
    body = get(client, "search", root="r0", q="*")
    assert set(scans) == {root, root / "safe"}
    assert "hh" in resolved and "changed" in resolved
    assert body["skipped"] == 1  # outside-root guard counts, protected guard does not
    assert not any(e["rel"].startswith(("hh", "protected-link", "external/", "internal/")) for e in body["results"])


def test_i3_metadata_only_for_name_matches(client, api, fs, monkeypatch):
    root, _ = fs
    for n in range(4):
        folder = root / f"folder{n}"
        folder.mkdir()
        for m in range(100):
            (folder / f"plain{m}.txt").touch()
    (root / "folder0/needle.txt").touch()
    (root / "needle.txt").touch()
    selected = api._roots()[0]
    monkeypatch.setattr(api, "_request_root", lambda _: (selected, {}))
    entry, resolve, calls, resolutions = api._entry, api._resolve, [], []
    def counted_entry(selected, path):
        calls.append(path.name)
        return entry(selected, path)
    def counted_resolve(selected, rel, **kwargs):
        resolutions.append(rel)
        return resolve(selected, rel, **kwargs)
    monkeypatch.setattr(api, "_entry", counted_entry)
    monkeypatch.setattr(api, "_resolve", counted_resolve)
    body = get(client, "search", root="r0", q="needle")
    assert len(body["results"]) == 2
    assert calls == ["needle.txt", "needle.txt"]
    assert len(resolutions) == 6  # five visited folders plus initial scope resolution


@pytest.mark.parametrize("deep_first", [True, False])
@pytest.mark.parametrize("shallow", ["match.txt", "shallow/match.txt"])
def test_i4_breadth_first_limit(client, api, fs, monkeypatch, deep_first, shallow):
    root, _ = fs
    deep = root / "deep/a/b/c"
    deep.mkdir(parents=True)
    (deep / "match.txt").touch()
    (root / shallow).parent.mkdir(exist_ok=True)
    (root / shallow).touch()
    scan = api.os.scandir
    @contextmanager
    def ordered(folder):
        with scan(folder) as entries:
            yield iter(sorted(entries, key=lambda e: e.name == "deep", reverse=deep_first))
    monkeypatch.setattr(api.os, "scandir", ordered)
    body = get(client, "search", root="r0", q="match", limit=1)
    assert [e["rel"] for e in body["results"]] == [shallow]


def test_i5_scoped_results_and_guard_errors(client, api, fs, tmp_path, monkeypatch):
    root, _ = fs
    for rel in ("docs/inner/needle.txt", "other/needle.txt", "needle.txt"):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).touch()
    hh = root / "hh"
    hh.mkdir()
    (root / "external").symlink_to(tmp_path, target_is_directory=True)
    monkeypatch.setattr(api, "_hermes_homes", lambda: {hh})
    body = get(client, "search", root="r0", path="docs", q="needle")
    assert [e["rel"] for e in body["results"]] == ["docs/inner/needle.txt"]
    for path, code in (("..", "bad_path"), ("needle.txt", "not_a_dir"), ("hh", "protected"), ("external", "outside_root")):
        error(get(client, "search", root="r0", path=path, q="needle"), code)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    (root / "me").symlink_to(root, target_is_directory=True)
    (root / ".hidden").mkdir()
    (root / ".hidden/needle.txt").touch()
    assert get(client, "search", root="r0", path="me", q=".hidden")["results"] == []


@pytest.mark.parametrize("reason", [None, "results", "visits", "time"])
def test_i6_caps_before_increment_and_reason(client, api, fs, monkeypatch, reason):
    root, _ = fs
    for n in range(3):
        (root / f"match{n}").touch()
    if reason == "visits":
        monkeypatch.setattr(api, "SEARCH_VISIT_LIMIT", 2)
    ticks = iter([0.0, 6.0] if reason == "time" else [])
    monkeypatch.setattr(api, "time", SimpleNamespace(monotonic=lambda: next(ticks, 6.0 if reason == "time" else 0.0)))
    body = get(client, "search", root="r0", q="match" if reason == "results" else "absent", limit=1)
    assert body["reason"] == reason
    assert body["truncated"] == (reason is not None)
    assert body["visited"] == {None: 3, "results": 1, "visits": 2, "time": 0}[reason]


def test_i6_end_of_walk_visit_cap_precedes_time(client, api, fs, monkeypatch):
    (fs[0] / "one").touch()
    monkeypatch.setattr(api, "SEARCH_VISIT_LIMIT", 1)
    ticks = iter([0.0, 0.0])
    monkeypatch.setattr(api, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    assert get(client, "search", root="r0", q="absent")["reason"] == "visits"
    monkeypatch.setattr(api, "SEARCH_VISIT_LIMIT", 0)
    ticks = iter([0.0])  # a zero visit cap must short-circuit before consulting time again
    monkeypatch.setattr(api, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    body = get(client, "search", root="r0", q="absent")
    assert body["visited"] == 0 and body["reason"] == "visits"


def test_i8_search_budget_constants(api):
    assert api.SEARCH_VISIT_LIMIT == 1_000_000
    assert api.SEARCH_SECONDS == 5.0


def test_i5_scope_through_an_internal_link(client, api, fs):
    root, _ = fs
    (root / "docs/inner").mkdir(parents=True)
    (root / "docs/inner/needle.txt").touch()
    (root / "alias").symlink_to(root / "docs", target_is_directory=True)
    body = get(client, "search", root="r0", path="alias", q="needle")
    assert [e["rel"] for e in body["results"]] == ["alias/inner/needle.txt"]
    assert body["skipped"] == 0


@pytest.mark.parametrize("path", ["", "me"])
def test_i3_home_root_dot_names_cost_nothing(client, api, fs, monkeypatch, path):
    root, _ = fs
    for name in (".config", ".ssh", "docs"):
        (root / name).mkdir()
    (root / "a.txt").touch()
    (root / "me").symlink_to(root, target_is_directory=True)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    selected = api._roots()[0]
    monkeypatch.setattr(api, "_request_root", lambda _: (selected, {}))
    entry, resolve, calls, resolutions = api._entry, api._resolve, [], []
    def counted_entry(selected, item):
        calls.append(item.name)
        return entry(selected, item)
    def counted_resolve(selected, rel, **kwargs):
        resolutions.append(rel)
        return resolve(selected, rel, **kwargs)
    monkeypatch.setattr(api, "_entry", counted_entry)
    monkeypatch.setattr(api, "_resolve", counted_resolve)
    body = get(client, "search", root="r0", path=path, q=".")
    prefix = f"{path}/" if path else ""
    assert [e["rel"] for e in body["results"]] == [f"{prefix}a.txt"]
    assert calls == ["a.txt"]  # home-root dot names never reach _entry, also through a link to the root
    assert resolutions == [path, path, f"{prefix}docs"]  # and no dot folder is queued


def test_i6_time_cap_is_inclusive(client, api, fs, monkeypatch):
    (fs[0] / "one").touch()
    ticks = iter([0.0, 5.0])
    monkeypatch.setattr(api, "time", SimpleNamespace(monotonic=lambda: next(ticks, 5.0)))
    body = get(client, "search", root="r0", q="absent")
    assert body["reason"] == "time" and body["visited"] == 0


def test_i2_unreadable_entry_type_is_not_descended(client, api, fs, monkeypatch):
    root, _ = fs
    (root / "folder").mkdir()
    (root / "folder/needle.txt").touch()
    scan = api.os.scandir

    class Unreadable:
        def __init__(self, item):
            self.name, self.path = item.name, item.path

        def is_dir(self, follow_symlinks=True):
            raise PermissionError("fixture: type unreadable")

    @contextmanager
    def failing(folder):
        with scan(folder) as entries:
            yield iter([Unreadable(e) if e.name == "folder" else e for e in entries])
    monkeypatch.setattr(api.os, "scandir", failing)
    body = get(client, "search", root="r0", q="needle")
    assert body["results"] == [] and body["skipped"] == 0
