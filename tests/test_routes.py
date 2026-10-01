from pathlib import Path
from types import SimpleNamespace

import pytest

from conftest import PREFIX, error, get, post


def test_roots_settings_and_notes(client, fs):
    root, cfg = fs
    (root / "docs").mkdir()
    (root / "plain").touch()
    settings = cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]
    settings.update(roots=[str(root / "missing"), "/", "relative", str(root)],
                    folder_notes={"docs": "Imported", "plain": "no", "absent": "no", "long": "x" * 201},
                    max_file_mb=2)
    body = get(client, "roots")
    assert body["supported"] is True and body["reason"] is None
    assert body["roots"] == [{"id": "r3", "label": "files", "path": str(root), "notes": {"docs": "Imported"}}]
    assert body["max_file_bytes"] == 2 * 1024 * 1024
    assert body["chunk_bytes"] == 4 * 1024 * 1024
    assert body["highlights"] == ["docs", "uploads"]
    settings["roots"] = []
    cfg["terminal"] = {"cwd": "."}


def test_workspace_placeholders_and_env(client, api, fs, monkeypatch):
    root, cfg = fs
    cfg["plugins"] = {}
    cfg["terminal"] = {"cwd": "."}
    monkeypatch.delenv("TERMINAL_CWD", raising=False)
    monkeypatch.delenv("MESSAGING_CWD", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    assert get(client, "roots")["roots"][0]["path"] == str(root)
    other = root / "env"
    other.mkdir()
    monkeypatch.setenv("TERMINAL_CWD", "auto")
    monkeypatch.setenv("MESSAGING_CWD", str(other))
    assert get(client, "roots")["roots"][0]["path"] == str(other)


def test_invalid_note_names_filtered(client, fs):
    root, cfg = fs
    (root / "docs").mkdir()
    settings = cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]
    settings["folder_notes"] = {"..": "bad", "a:b": "bad", "docs": "good", 1: "bad", "x": 2}
    body = get(client, "roots")
    assert body["ok"] is True
    assert body["roots"][0]["notes"] == {"docs": "good"}


@pytest.mark.parametrize("cfg", [None, [], {"plugins": []}, {"plugins": {"entries": []}},
    {"plugins": {"entries": {"hermes-cloud-file-manager": []}}},
    {"plugins": {"entries": {"hermes-cloud-file-manager": {"settings": []}}}, "terminal": []}])
def test_malformed_config_defaults(client, api, monkeypatch, tmp_path, cfg):
    monkeypatch.setattr(api, "_load_config", lambda: cfg, raising=False)
    monkeypatch.setattr(api, "_hermes_homes", lambda: set(), raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.delenv("TERMINAL_CWD", raising=False)
    monkeypatch.delenv("MESSAGING_CWD", raising=False)
    body = get(client, "roots")
    assert body["max_file_bytes"] == 100 * 1024 * 1024
    assert body["roots"][0]["path"] == str(tmp_path)


@pytest.mark.parametrize("cap", [0, -1, True, "2", 1.5, None])
def test_invalid_size_setting(client, fs, cap):
    _, cfg = fs
    cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["max_file_mb"] = cap
    assert get(client, "roots")["max_file_bytes"] == 100 * 1024 * 1024


def test_backend_unknown_root_and_fresh_config(client, fs):
    root, cfg = fs
    error(get(client, "list", root="no"), "unknown_root")
    cfg["terminal"] = {"backend": "docker"}
    body = get(client, "roots")
    assert body["supported"] is False and body["reason"]
    error(get(client, "list", root="r0"), "unsupported_backend")
    error(get(client, "search", root="r0", q="x"), "unsupported_backend")
    error(post(client, "mkdir", root="r0", path="x"), "unsupported_backend")
    error(post(client, "uploads/start", root="r0", path="x", size=0), "unsupported_backend")
    cfg["terminal"]["backend"] = "LOCAL"
    assert post(client, "mkdir", root="r0", path="new")["created"] is True


def test_list_sort_pagination_and_scan_cap(client, api, fs, monkeypatch):
    root, _ = fs
    (root / "zdir").mkdir()
    (root / "A.txt").write_bytes(b"abc")
    (root / "b.txt").touch()
    body = get(client, "list", root="r0", path="./", offset=1, limit=1)
    assert body["path"] == ""
    assert body["total"] == 3 and body["truncated"] is False
    entry = body["entries"][0]
    assert entry == {"name": "A.txt", "rel": "A.txt", "abs": str(root / "A.txt"),
                     "is_dir": False, "size": 3, "mtime": (root / "A.txt").stat().st_mtime,
                     "link_outside": False}
    monkeypatch.setattr(api, "SCAN_LIMIT", 2)
    body = get(client, "list", root="r0")
    assert body["total"] == 2 and body["truncated"] is True
    error(get(client, "list", root="r0", path="b.txt"), "not_a_dir")


def test_mkdir_components_and_existing_file(client, fs):
    root, _ = fs
    body = post(client, "mkdir", root="r0", path="a//./b")
    assert body["created"] is True and body["entry"]["rel"] == "a/b"
    assert (root / "a/b").is_dir()
    assert post(client, "mkdir", root="r0", path="a/b")["created"] is False
    (root / "file").touch()
    error(post(client, "mkdir", root="r0", path="file"), "exists_file")


def test_search_substring_glob_skips_and_links(client, fs, tmp_path):
    root, _ = fs
    (root / "Report.TXT").touch()
    (root / "docs").mkdir()
    (root / "docs/report.md").touch()
    for name in ("node_modules", ".hidden"):
        (root / name).mkdir()
        (root / name / "report.txt").touch()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (outside / "report-secret.txt").touch()
    (root / "link").symlink_to(outside, target_is_directory=True)
    (root / "shortcut").symlink_to(root / "docs", target_is_directory=True)
    body = get(client, "search", root="r0", q=" REPORT ")
    assert {e["rel"] for e in body["results"]} == {"Report.TXT", "docs/report.md"}
    assert body["truncated"] is False
    assert {e["rel"] for e in get(client, "search", root="r0", q="*.t?t")["results"]} == {"Report.TXT"}
    assert get(client, "search", root="r0", q=".hidden")["results"][0]["name"] == ".hidden"
    error(get(client, "search", root="r0", q=" "), "bad_query")
    error(get(client, "search", root="r0", q="x" * 201), "bad_query")


def test_search_limits(client, api, fs, monkeypatch):
    root, _ = fs
    for n in range(5):
        (root / f"match{n}").touch()
    body = get(client, "search", root="r0", q="match", limit=2)
    assert len(body["results"]) == 2 and body["truncated"] is True
    monkeypatch.setattr(api, "SEARCH_VISIT_LIMIT", 2)
    body = get(client, "search", root="r0", q="absent")
    assert body["visited"] == 2 and body["truncated"] is True
    monkeypatch.setattr(api, "SEARCH_VISIT_LIMIT", 50000)
    ticks = iter([0.0, 6.0])
    monkeypatch.setattr(api, "time", SimpleNamespace(monotonic=lambda: next(ticks, 6.0)))
    body = get(client, "search", root="r0", q="absent")
    assert body["truncated"] is True and body["visited"] == 0


@pytest.mark.parametrize("route,params", [("list", {"limit": 0}), ("list", {"limit": 2001}),
    ("list", {"offset": -1}), ("search", {"q": "x", "limit": 201})])
def test_malformed_request_422(client, fs, route, params):
    assert client.get(f"{PREFIX}/{route}", params={"root": "r0", **params}).status_code == 422
