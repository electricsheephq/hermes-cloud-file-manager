"""Red-first coverage for the four approved Fix round 2 items."""
from pathlib import Path
import os
import sys
import unicodedata

import pytest

from conftest import error, get, post


@pytest.mark.skipif(sys.platform != "darwin", reason="Darwin Unicode canonicalization rule")
@pytest.mark.parametrize("home_form,request_form", [("NFC", "NFD"), ("NFD", "NFC")])
def test_missing_unicode_home_other_spelling_protected(client, api, fs, monkeypatch, home_form, request_form):
    root, _ = fs
    home_name = unicodedata.normalize(home_form, "café-home")
    request_name = unicodedata.normalize(request_form, "café-home")
    assert home_name != request_name
    home = root / home_name
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    error(post(client, "mkdir", root="r0", path=request_name), "protected")
    assert not home.exists() and not (root / request_name).exists()


def test_derived_workspace_link_to_slash(client, api, fs, monkeypatch):
    home, cfg = fs
    cfg["plugins"] = {}
    cfg["terminal"] = {"cwd": str(home)}
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    (home / "workspace").symlink_to("/", target_is_directory=True)
    scans = []
    def never_scan(folder):
        scans.append(folder)
        raise AssertionError("An invalid root must not reach scandir")
    monkeypatch.setattr(api.os, "scandir", never_scan)
    error(get(client, "roots"), "protected")
    error(get(client, "list", root="workspace", path="etc"), "protected")
    assert scans == []


@pytest.mark.parametrize("listing_path", ["", "me"])
def test_home_dotlink_hidden_and_refused(client, api, fs, monkeypatch, listing_path):
    root, _ = fs
    (root / "Documents").mkdir()
    (root / ".dotlink").symlink_to(root / "Documents", target_is_directory=True)
    (root / "me").symlink_to(root, target_is_directory=True)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: root))
    entries = get(client, "list", root="r0", path=listing_path)["entries"]
    assert ".dotlink" not in {e["name"] for e in entries}
    assert get(client, "search", root="r0", q=".dotlink")["results"] == []
    error(get(client, "list", root="r0", path=".dotlink"), "protected")
    error(post(client, "mkdir", root="r0", path=".dotlink/new"), "protected")
    error(post(client, "uploads/start", root="r0", path=".dotlink/x", size=0), "protected")
    assert list((root / "Documents").iterdir()) == []


def test_list_home_set_and_identities_once_per_request(client, api, fs, tmp_path, monkeypatch):
    root, _ = fs
    for n in range(32):
        (root / f"file{n}").touch()
    blocked = root / "blocked"
    blocked.mkdir()
    homes = {tmp_path / f"home{n}" for n in range(5)}
    for home in homes:
        home.mkdir()
    calls = []
    identity_calls = {home: 0 for home in homes}
    identity = api._identity
    def counted_homes():
        calls.append(None)
        return homes
    def counted_identity(path):
        path = Path(path)
        if path in identity_calls:
            identity_calls[path] += 1
        return identity(path)
    monkeypatch.setattr(api, "_hermes_homes", counted_homes)
    monkeypatch.setattr(api, "_identity", counted_identity)
    body = get(client, "list", root="r0")
    assert body["ok"] and body["total"] == 33
    assert len(calls) == 1
    assert set(identity_calls.values()) == {1}
    # Reuse within the request must never become a cross-request cache.
    homes = {blocked}
    body = get(client, "list", root="r0")
    assert len(calls) == 2
    assert body["total"] == 32 and "blocked" not in {e["name"] for e in body["entries"]}


def test_b5_sweep_removes_only_exact_lowercase_temp_names(client, api, fs):
    """The sweep may delete only names the plugin itself creates (lowercase); a case variant is someone else's file."""
    import os
    import time
    root, _ = fs
    foreign = root / (".CFM-" + "A" * 32 + ".PART")
    foreign.write_bytes(b"not ours")
    os.utime(foreign, (time.time() - 90000,) * 2)
    api._LAST_SWEEP.clear()
    assert post(client, "uploads/start", root="r0", path="visible", size=0)["ok"]
    assert foreign.read_bytes() == b"not ours"


@pytest.mark.skipif(sys.platform != "darwin", reason="needs a case-insensitive filesystem to alias the home")
def test_b4_mkdir_recheck_sees_a_home_created_mid_request(client, api, fs, monkeypatch):
    """The per-request protection snapshot must not blind the post-mkdir re-check: if a spelling slips past the
    canonical path comparison and creates the (missing) home, the live identity check still refuses going deeper."""
    root, _ = fs
    home = root / "hh"
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    monkeypatch.setattr(api, "_canonical", lambda path: os.path.realpath(path))  # simulate a canonical-path gap
    error(post(client, "mkdir", root="r0", path="HH/x"), "protected")
    assert not (home / "x").exists()
