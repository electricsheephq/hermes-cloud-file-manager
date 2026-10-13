"""Drive destination acceptance using the existing request-local fake skill."""
from test_drive import drive, imported, no_temp


def test_import_into_root(client, drive):
    body = imported(client, dest="")
    assert body["ok"] and body["entry"]["rel"] == "report.txt"
    assert (drive.root / "report.txt").read_bytes() == b"hello drive"
    no_temp(drive)


def test_import_creates_destination(client, drive):
    assert not (drive.root / "a/b").exists()
    body = imported(client, dest="a/b")
    assert body["ok"] and body["entry"]["rel"] == "a/b/report.txt"
    assert (drive.root / "a/b/report.txt").read_bytes() == b"hello drive"
    no_temp(drive)


def test_import_destination_keeps_both(client, drive):
    dest = drive.root / "a/b"
    dest.mkdir(parents=True)
    (dest / "report.txt").write_bytes(b"original")
    body = imported(client, dest="a/b")
    assert body["ok"] and body["entry"]["rel"] == "a/b/report (1).txt"
    assert (dest / "report.txt").read_bytes() == b"original"
    assert (dest / "report (1).txt").read_bytes() == b"hello drive"
    no_temp(drive)
