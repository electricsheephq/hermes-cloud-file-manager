"""Drive gateway acceptance against a request-local fake skill, never OAuth."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

from conftest import error, get, post

FILE_ID = "abcdefghij_123"
FOLDER_MIME = "application/vnd.google-apps.folder"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
FAKE = '''import json, os, sys, time
from pathlib import Path
c = json.loads(Path(__CONTROL__).read_text())
with open(__LOG__, "a") as log:
    log.write(json.dumps({"script": Path(__file__).name, "argv": sys.argv[1:],
                          "home": os.environ.get("HERMES_HOME"), "env": sorted(os.environ)}) + "\\n")
op = "setup" if Path(__file__).name == "setup.py" else sys.argv[2]
v = c.get(op, {})
time.sleep(v.get("sleep", 0))
if op == "download" and not v.get("exit", 0):
    out = Path(sys.argv[sys.argv.index("--output") + 1])
    mode = v.get("mode", "one")
    if mode == "link":
        out.symlink_to(__CONTROL__)
    elif mode != "zero":
        out.write_bytes(v.get("bytes", "hello drive").encode() * v.get("repeat", 1))
        if mode == "two":
            out.with_name("extra").write_bytes(b"extra")
print(v.get("raw", json.dumps(v.get("output", "AUTHENTICATED" if op == "setup" else {}))))
sys.exit(v.get("exit", 0))
'''


@pytest.fixture
def drive(api, fs, monkeypatch, tmp_path):
    home = tmp_path / "hermes"
    scripts = home / "skills/productivity/google-workspace/scripts"
    scripts.mkdir(parents=True)
    control, log = tmp_path / "control.json", tmp_path / "argv.jsonl"
    for name in ("setup.py", "google_api.py"):
        (scripts / name).write_text(FAKE.replace("__CONTROL__", repr(str(control)))
                                   .replace("__LOG__", repr(str(log))))
    state = {"setup": {"raw": "AUTHENTICATED"}, "search": {"output": []},
             "get": {"output": {"id": FILE_ID, "name": "report.txt", "mimeType": "text/plain"}}}
    def save():
        control.write_text(json.dumps(state))
    def calls():
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    save()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("FAKE_CONTROL", str(control))
    monkeypatch.setenv("FAKE_LOG", str(log))
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    monkeypatch.setitem(sys.modules, "hermes_constants", SimpleNamespace(
        get_hermes_home=lambda: home, __file__=str(tmp_path / "install/hermes_constants.py")))
    original = importlib.util.find_spec
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object() if name in
                        {"google.oauth2", "googleapiclient"} else original(name))
    return SimpleNamespace(home=home, scripts=scripts, state=state, save=save, calls=calls,
                           root=fs[0], cfg=fs[1])


def imported(client, **kw):
    return post(client, "drive/import", id=FILE_ID, root="r0", **kw)


def no_temp(drive):
    assert not list(drive.root.rglob(".cfm-*.dir"))


def test_available_no_skill(client, drive):
    for path in drive.scripts.iterdir():
        path.unlink()
    assert get(client, "drive/available") == {"ok": True, "available": False, "reason": "no_skill"}
    assert drive.calls() == []


def test_available_missing_libs_never_spawns(client, drive, monkeypatch):
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
    assert get(client, "drive/available")["reason"] == "no_google_libs"
    assert drive.calls() == []


@pytest.mark.parametrize("output,exit_code,reason", [
    ("NOT_AUTHENTICATED: no token", 1, "not_signed_in"),
    ("AUTHENTICATED (partial): Token valid but missing 1 scopes:\n  - " + DRIVE_SCOPE, 0, "no_drive_scope"),
    ("AUTHENTICATED (partial): Token valid but missing 1 scopes:\n  - https://www.googleapis.com/auth/gmail.readonly", 0, None),
    ("TOKEN_CORRUPT", 1, "error"),
])
def test_available_auth_status(client, drive, output, exit_code, reason):
    drive.state["setup"] = {"raw": output, "exit": exit_code}
    drive.save()
    body = get(client, "drive/available")
    assert body["available"] is (reason is None)
    assert body.get("reason") == reason


def test_available_cache_60_seconds_per_home(client, api, drive, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(api.time, "monotonic", lambda: clock[0])
    assert get(client, "drive/available")["available"]
    clock[0] = 159.0
    assert get(client, "drive/available")["available"]
    assert len(drive.calls()) == 1
    clock[0] = 161.0
    assert get(client, "drive/available")["available"]
    assert len(drive.calls()) == 2
    monkeypatch.setattr(sys.modules["hermes_constants"], "get_hermes_home", lambda: drive.home / "other")
    assert get(client, "drive/available")["reason"] == "no_skill"


def test_available_timeout(client, api, drive, monkeypatch):
    def timeout(args, timeout):
        assert timeout == 10
        raise subprocess.TimeoutExpired(args, timeout)
    monkeypatch.setattr(api, "_drive_run", timeout, raising=False)
    assert get(client, "drive/available")["reason"] == "error"


def test_list_folders_first(client, drive):
    drive.state["search"]["output"] = [
        {"id": FILE_ID, "name": "a", "mimeType": "text/plain"},
        {"id": "folderid123", "name": "Z", "mimeType": FOLDER_MIME},
        {"id": "anotherid123", "name": "B", "mimeType": "text/plain", "size": "3", "modifiedTime": "today"}]
    drive.save()
    body = get(client, "drive/list", folder="root")
    assert [v["name"] for v in body["items"]] == ["Z", "a", "B"]
    assert body["items"][0] == {"id": "folderid123", "name": "Z", "mime": FOLDER_MIME,
                                "is_folder": True, "size": None, "mtime": None}
    assert drive.calls()[-1]["argv"] == ["drive", "search", "'root' in parents and trashed = false", "--max", "200", "--raw-query"]


def test_list_query_escaping(client, drive):
    assert get(client, "drive/list", q="O'Reilly\\notes")["ok"]
    assert drive.calls()[-1]["argv"] == ["drive", "search", "name contains 'O\\'Reilly\\\\notes' and trashed = false",
                                          "--max", "200", "--raw-query"]


@pytest.mark.parametrize("folder", ["../x", "short", "a' OR", "a" * 201])
def test_list_bad_folder(client, drive, folder):
    error(get(client, "drive/list", folder=folder), "bad_id")
    assert drive.calls() == []


@pytest.mark.parametrize("q", ["a\x00b", "a\nb", "a\x7fb", "a" * 201])
def test_list_bad_query(client, drive, q):
    error(get(client, "drive/list", q=q), "bad_query")
    assert drive.calls() == []


def test_list_truncated(client, drive):
    drive.state["search"]["output"] = [{"id": FILE_ID, "name": str(n), "mimeType": "text/plain"} for n in range(200)]
    drive.save()
    body = get(client, "drive/list")
    assert len(body["items"]) == 200 and body["truncated"]


def test_list_unavailable(client, drive):
    drive.state["setup"] = {"raw": "NOT_AUTHENTICATED", "exit": 1}
    drive.save()
    error(get(client, "drive/list"), "unavailable")
    assert len(drive.calls()) == 1


def test_import_happy_path_allowlist_and_child_home(client, drive):
    body = imported(client)
    assert body["ok"] and body["entry"]["rel"] == "uploads/drive/report.txt"
    assert (drive.root / body["entry"]["rel"]).read_bytes() == b"hello drive"
    assert set(body["entry"]) == {"name", "rel", "abs", "is_dir", "size", "mtime", "link_outside"}
    calls = drive.calls()
    assert [c["argv"][:2] for c in calls] == [["--check"], ["drive", "get"], ["drive", "download"]]
    assert all(c["home"] == str(drive.home) for c in calls)
    assert calls[-1]["argv"][:4] == ["drive", "download", FILE_ID, "--output"]
    no_temp(drive)


def test_import_collision_keeps_original(client, drive):
    dest = drive.root / "uploads/drive"
    dest.mkdir(parents=True)
    (dest / "report.txt").write_bytes(b"original")
    body = imported(client)
    assert body["entry"]["name"] == "report (1).txt"
    assert (dest / "report.txt").read_bytes() == b"original"
    assert (dest / "report (1).txt").read_bytes() == b"hello drive"
    no_temp(drive)


@pytest.mark.parametrize("mime,extension", [("document", ".pdf"), ("presentation", ".pdf"),
                                             ("spreadsheet", ".csv"), ("drawing", ".png")])
def test_import_native_extension(client, drive, mime, extension):
    drive.state["get"]["output"].update(name="native", mimeType="application/vnd.google-apps." + mime)
    drive.save()
    assert imported(client)["entry"]["name"] == "native" + extension
    no_temp(drive)


@pytest.mark.parametrize("name", ["native.pdf", "é" * 200 + ".pdf"])
def test_import_native_extension_after_byte_limit(client, drive, name):
    drive.state["get"]["output"].update(name=name, mimeType="application/vnd.google-apps.document")
    drive.save()
    body = imported(client)
    assert body["ok"]
    assert body["entry"]["name"].endswith(".pdf")
    assert body["entry"]["name"].count(".pdf") == 1
    assert len(body["entry"]["name"].encode()) <= 255
    no_temp(drive)


@pytest.mark.parametrize("name,expected", [("../../outside/a.txt", ".._.._outside_a.txt"),
    (" . .  ", "drive-file"), ("x\\:*?\"<>|\x00\n.txt", "x__________.txt"), ("é" * 200, "é" * 127)])
def test_import_sanitized_confined_name(client, drive, name, expected):
    drive.state["get"]["output"]["name"] = name
    drive.save()
    body = imported(client)
    assert body["ok"] and body["entry"]["name"] == expected
    assert Path(body["entry"]["abs"]).parent == drive.root / "uploads/drive"
    assert len(body["entry"]["name"].encode()) <= 255
    no_temp(drive)


def test_import_known_size_cap_never_downloads(client, drive):
    drive.cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["max_file_mb"] = 1
    drive.state["get"]["output"]["size"] = str(1024 * 1024 + 1)
    drive.save()
    error(imported(client), "too_large")
    assert not any(c["argv"][:2] == ["drive", "download"] for c in drive.calls())
    no_temp(drive)


def test_import_download_size_cap(client, drive):
    drive.cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["max_file_mb"] = 1
    drive.state["download"] = {"bytes": "x", "repeat": 1024 * 1024 + 1}
    drive.save()
    error(imported(client), "too_large")
    assert list((drive.root / "uploads/drive").iterdir()) == []
    no_temp(drive)


def test_import_folder(client, drive):
    drive.state["get"]["output"]["mimeType"] = FOLDER_MIME
    drive.save()
    error(imported(client), "is_folder")
    no_temp(drive)


@pytest.mark.parametrize("mode", ["zero", "two", "link"])
def test_import_wrong_download_shape_cleanup(client, drive, mode):
    drive.state["download"] = {"mode": mode}
    drive.save()
    error(imported(client), "drive_error")
    no_temp(drive)


@pytest.mark.parametrize("op,control", [("get", {"exit": 1}), ("get", {"raw": "invalid"}),
                                       ("download", {"exit": 1})])
def test_import_cli_errors_cleanup(client, drive, op, control):
    drive.state[op] = control
    drive.save()
    error(imported(client), "drive_error")
    no_temp(drive)


def test_import_timeout_cleanup(client, api, drive, monkeypatch):
    assert get(client, "drive/available")["available"]
    original = api._drive_run
    def run(args, timeout):
        if args[1:3] == ["drive", "download"]:
            assert timeout == 300
            raise subprocess.TimeoutExpired(args, timeout)
        return original(args, timeout)
    monkeypatch.setattr(api, "_drive_run", run)
    error(imported(client), "timeout")
    no_temp(drive)


def test_import_protected_home(client, drive):
    (drive.root / "home").symlink_to(drive.home, target_is_directory=True)
    # A configured parent root includes the request home; protection must win.
    drive.cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["roots"] = [str(drive.root.parent)]
    error(imported(client, dest="hermes/incoming"), "protected")
    assert not (drive.home / "incoming").exists()
    no_temp(drive)


def test_import_parent_traversal(client, drive):
    error(imported(client, dest="../x"), "bad_path")
    assert not (drive.root.parent / "x").exists()
    no_temp(drive)


@pytest.mark.parametrize("file_id", ["root", "short", "../x"])
def test_import_bad_id(client, drive, file_id):
    error(post(client, "drive/import", id=file_id, root="r0"), "bad_id")
    assert drive.calls() == []


def test_import_unavailable(client, drive):
    drive.state["setup"] = {"exit": 1, "raw": "NOT_AUTHENTICATED"}
    drive.save()
    error(imported(client), "unavailable")
    no_temp(drive)


def test_temp_dir_hidden_and_not_published_upload_name(client, drive):
    name = ".cfm-" + "a" * 32 + ".dir"
    temp = drive.root / name
    temp.mkdir()
    (temp / "needle.txt").write_text("hidden")
    upper = drive.root / (".cfm-" + "B" * 32 + ".dir")
    upper.mkdir()
    assert [e["name"] for e in get(client, "list", root="r0")["entries"]] == [upper.name]
    assert get(client, "search", root="r0", q=".cfm-")["results"][0]["name"] == upper.name
    assert get(client, "search", root="r0", q="needle")["results"] == []
    upload = post(client, "uploads/start", root="r0", path=name, size=0)
    body = post(client, "uploads/finish", root="r0", path=name, size=0, upload_id=upload["upload_id"])
    assert body["ok"] and body["entry"]["name"] == ".cfm-" + "a" * 32 + " (1).dir"


@pytest.mark.parametrize("script,args", [("setup.py", ["--check", "extra"]),
    ("setup.py", ["--login"]), ("google_api.py", ["drive", "delete", FILE_ID]),
    ("google_api.py", ["gmail", "search", "x"]), ("other.py", ["--check"])])
def test_runner_rejects_disallowed_argv(api, drive, script, args):
    # An explicit refusal, not an assert: `python -O` strips asserts.
    with pytest.raises(api.GuardError):
        api._drive_run([drive.scripts / script, *args], 10)
    assert drive.calls() == []


def test_import_cleanup_failure_still_reports_published_file(client, api, drive, monkeypatch):
    def broken_rmtree(path, *args, **kwargs):
        raise PermissionError("cleanup refused")
    monkeypatch.setattr(api.shutil, "rmtree", broken_rmtree)
    body = imported(client)
    assert body["ok"] and (drive.root / body["entry"]["rel"]).read_bytes() == b"hello drive"


@pytest.mark.parametrize("name,mime,expected", [("CON.txt", "text/plain", "_CON.txt"), ("aux", "text/plain", "_aux"),
    ("com1", "application/vnd.google-apps.document", "_com1.pdf"), ("console.txt", "text/plain", "console.txt")])
def test_import_device_names_are_prefixed_not_refused(client, drive, name, mime, expected):
    drive.state["get"]["output"] = {"id": FILE_ID, "name": name, "mimeType": mime}
    drive.save()
    body = imported(client)
    assert body["ok"] and body["entry"]["rel"] == "uploads/drive/" + expected


def test_available_missing_google_package_raises_never_spawns(client, drive, monkeypatch):
    # Without the `google` package, find_spec("google.oauth2") RAISES ModuleNotFoundError rather than returning None.
    def missing(name):
        raise ModuleNotFoundError(f"No module named {name.split('.')[0]!r}")
    monkeypatch.setattr(importlib.util, "find_spec", missing)
    assert get(client, "drive/available")["reason"] == "no_google_libs"
    assert drive.calls() == []
