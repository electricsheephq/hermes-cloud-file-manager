"""v0.7.0 /locate: an absolute path the agent named -> the shown folder and entry, behind the usual guards."""

from conftest import error, get


def test_locates_a_file_in_a_configured_root(client, fs):
    root, _ = fs
    (root / "Inbox").mkdir()
    (root / "Inbox" / "summary.md").write_text("# Summary")
    body = get(client, "locate", path=str(root / "Inbox" / "summary.md"))
    assert body["ok"] is True and body["root"] == "r0" and body["root_path"] == str(root) and body["root_label"] == root.name
    assert body["entry"]["rel"] == "Inbox/summary.md" and body["entry"]["is_dir"] is False
    assert body["entry"]["size"] == len("# Summary")


def test_locates_a_folder_and_the_root_itself(client, fs):
    root, _ = fs
    (root / "Inbox").mkdir()
    assert get(client, "locate", path=str(root / "Inbox"))["entry"]["is_dir"] is True
    assert get(client, "locate", path=str(root))["entry"]["rel"] == ""


def test_refuses_paths_outside_every_root(client, fs, tmp_path):
    outside = tmp_path / "elsewhere.md"
    outside.write_text("x")
    error(get(client, "locate", path=str(outside)), "outside_root")


def test_refuses_traversal_relative_and_missing(client, fs, tmp_path):
    root, _ = fs
    (tmp_path / "secret.md").write_text("x")
    assert get(client, "locate", path=str(root) + "/../secret.md")["code"] in {"bad_path", "outside_root"}
    error(get(client, "locate", path="Inbox/summary.md"), "bad_path")
    error(get(client, "locate", path=str(root / "gone.md")), "not_found")


def test_refuses_a_hermes_home_inside_a_root(client, api, fs, monkeypatch):
    root, _ = fs
    home = root / "hh"
    home.mkdir()
    (home / "note.md").write_text("protected")
    monkeypatch.setattr(api, "_hermes_homes", lambda: {home})
    body = get(client, "locate", path=str(home / "note.md"))
    assert body["ok"] is False and body["code"] in {"protected", "not_found"}


def test_symlink_leaving_the_root_is_not_followed(client, fs, tmp_path):
    root, _ = fs
    outside = tmp_path / "out"
    outside.mkdir()
    (outside / "x.md").write_text("x")
    (root / "link").symlink_to(outside, target_is_directory=True)
    body = get(client, "locate", path=str(root / "link" / "x.md"))
    assert body["ok"] is False and body["code"] == "outside_root"


def test_nul_byte_is_refused_not_a_server_error(client, fs, tmp_path):
    error(get(client, "locate", path=str(tmp_path / "a\x00b")), "bad_path")


def test_nested_root_shows_what_the_outer_root_hides(client, fs, tmp_path):
    root, cfg = fs
    inner = root / ".notes"
    inner.mkdir()
    (inner / "x.md").write_text("x")
    cfg["plugins"]["entries"]["hermes-cloud-file-manager"]["settings"]["roots"] = [str(root), str(inner)]
    body = get(client, "locate", path=str(inner / "x.md"))
    assert body["ok"] is True and body["root"] in {"r0", "r1"} and body["entry"]["name"] == "x.md"
