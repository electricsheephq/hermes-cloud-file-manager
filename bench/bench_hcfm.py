#!/usr/bin/env python3
"""Reproducible benchmark for the Cloud File Manager gateway half (dashboard/plugin_api.py).

Runs the plugin's FastAPI router in-process through TestClient, loaded by file path exactly as tests/conftest.py
does, with the same two seams stubbed (``_load_config`` and ``_hermes_homes``) and, for Drive, a fake
google-workspace skill shaped like tests/test_drive.py. No real Hermes, no network, no OAuth.

Usage (from the plugin checkout, or pass --plugin):
    python bench/bench_hcfm.py --reps 5 --json out.json --md out.md
    python bench/bench_hcfm.py --suites list,search --quick
    python bench/bench_hcfm.py --core /path/to/hermes-agent   # also time core hermes_cli/web_routers/files.py
    python bench/bench_hcfm.py --profile prof/                # cProfile the slow paths, write top-N text

Fixtures (flat folders, search trees, a 1 MiB Markdown file) are generated once under --work and reused.
"""
from __future__ import annotations

import argparse
import base64
import cProfile
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import pstats
import random
import resource
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

PREFIX = "/api/plugins/hermes-cloud-file-manager"
MIB = 1024 * 1024
FLAT_SIZES = [100, 1_000, 5_000, 20_000, 25_000]
TREE_SIZES = [10_000, 100_000, 500_000]
WORDS = ["Report", "invoice", "photo", "Notes", "draft", "budget", "Contract", "readme", "scan", "slides"]
EXTS = [".pdf", ".md", ".txt", ".png", ".csv", ".docx", ".jpg"]


# ---------------------------------------------------------------- stats
def summarize(samples):
    s = sorted(samples)
    p95 = s[min(len(s) - 1, max(0, int(round(0.95 * len(s) + 0.5)) - 1))]
    return {"n": len(s), "median_ms": round(statistics.median(s) * 1000, 2), "p95_ms": round(p95 * 1000, 2),
            "min_ms": round(s[0] * 1000, 2), "max_ms": round(s[-1] * 1000, 2)}


def timed(fn, reps, warmup=1):
    for _ in range(warmup):
        fn()
    samples, last = [], None
    for _ in range(reps):
        t = time.perf_counter()
        last = fn()
        samples.append(time.perf_counter() - t)
    return summarize(samples), last


# ---------------------------------------------------------------- fixtures
def _touch_many(folder: Path, names):
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        os.close(os.open(folder / name, os.O_WRONLY | os.O_CREAT, 0o644))


def build_flat(work: Path, n: int) -> Path:
    folder = work / "root" / f"flat_{n}"
    marker = work / f".done_flat_{n}"
    if marker.exists():
        return folder
    shutil.rmtree(folder, ignore_errors=True)
    rng = random.Random(n)
    dirs = n // 20  # 5% folders, like a real Downloads/projects mix
    names = [f"{rng.choice(WORDS)} {i:06d}{rng.choice(EXTS)}" for i in range(n - dirs)]
    rng.shuffle(names)
    _touch_many(folder, names)
    for i in range(dirs):
        (folder / f"{rng.choice(WORDS)} folder {i:05d}").mkdir()
    marker.touch()
    return folder


def build_tree(work: Path, n: int) -> Path:
    """n files: leaf folders of 100 files, 20 leaves per mid folder (500k -> 250 mid, 5000 leaf folders)."""
    folder = work / "root" / f"tree_{n}"
    marker = work / f".done_tree_{n}"
    if marker.exists():
        return folder
    shutil.rmtree(folder, ignore_errors=True)
    leaves = n // 100
    for leaf in range(leaves):
        d = folder / f"mid_{leaf // 20:04d}" / f"leaf_{leaf:05d}"
        _touch_many(d, [f"{WORDS[(leaf + k) % len(WORDS)]}_{leaf:05d}_{k:03d}{EXTS[k % len(EXTS)]}" for k in range(100)])
    # one unique needle in the very last leaf
    (folder / f"mid_{(leaves - 1) // 20:04d}" / f"leaf_{leaves - 1:05d}" / "needle-unique-7f3a.txt").touch()
    marker.touch()
    return folder


def build_doc(work: Path) -> Path:
    doc = work / "root" / "docs" / "notes-1mib.md"
    doc.parent.mkdir(parents=True, exist_ok=True)
    line = "- a markdown line with some **bold** text and a [link](https://example.com)\n"
    body = ("# Bench\n\n" + line * (MIB // len(line) + 1)).encode()[:MIB]
    doc.write_bytes(body)  # rewritten every run: saves change it
    return doc


def build_drive_skill(work: Path) -> Path:
    home = work / "drive-home"
    scripts = home / "skills/productivity/google-workspace/scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    (scripts / "setup.py").write_text('print("AUTHENTICATED")\n')
    items = [{"id": f"file_{i:010d}", "name": f"Drive file {i}.pdf", "mimeType": "application/pdf",
              "size": str(1000 + i), "modifiedTime": "2026-10-01T00:00:00Z"} for i in range(200)]
    (scripts / "google_api.py").write_text(
        "import json, sys\nfrom pathlib import Path\n"
        f"ITEMS = {json.dumps(items)!r}\n"
        "op = sys.argv[2]\n"
        "if op == 'search':\n    print(ITEMS)\n"
        "elif op == 'get':\n    print(json.dumps({'id': sys.argv[3], 'name': 'report.pdf', 'mimeType': 'application/pdf', 'size': str(1048576)}))\n"
        "elif op == 'download':\n    Path(sys.argv[sys.argv.index('--output') + 1]).write_bytes(b'x' * 1048576)\n")
    return home


# ---------------------------------------------------------------- plugin under test
def load_api(plugin: Path, name="hermes_dashboard_plugin_hermes-cloud-file-manager"):
    spec = importlib.util.spec_from_file_location(name, plugin / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def make_client(api, work: Path, drive_home: Path | None = None):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    root = work / "root"
    hermes_home = work / "hermes-home"  # an existing protected home, so the guard does its real work
    hermes_home.mkdir(exist_ok=True)
    (root / "uploads").mkdir(parents=True, exist_ok=True)
    cfg = {"plugins": {"entries": {"hermes-cloud-file-manager": {"settings": {
        "roots": [str(root)],
        "folder_notes": {"docs": "Notes", "uploads": "Incoming", "flat_100": "Small"},
    }}}}}
    api._load_config = lambda: cfg
    api._hermes_homes = lambda: {hermes_home}
    if drive_home is not None:
        api._drive_home = lambda: drive_home
        real = importlib.util.find_spec
        importlib.util.find_spec = lambda n, *a: object() if n in {"google.oauth2", "googleapiclient"} else real(n, *a)
    app = FastAPI()
    app.include_router(api.router, prefix=PREFIX)
    return TestClient(app)


def get(client, route, **params):
    r = client.get(f"{PREFIX}/{route}", params=params)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert body.get("ok", True), body
    return body


def post_raw(client, route, raw: bytes):
    r = client.post(f"{PREFIX}/{route}", content=raw, headers={"content-type": "application/json"})
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert body.get("ok", True), body
    return body


# ---------------------------------------------------------------- suites
def suite_baseline(client, reps, out):
    out["available (transport floor)"] = timed(lambda: get(client, "available"), max(reps, 20))[0]
    out["roots (3 folder notes)"] = timed(lambda: get(client, "roots"), max(reps, 20))[0]


def suite_list(client, work, reps, out, sizes):
    for n in sizes:
        build_flat(work, n)
        rel = f"flat_{n}"
        stats, body = timed(lambda: get(client, "list", root="r0", path=rel, offset=0, limit=500), reps)
        stats.update(total=body["total"], truncated=body["truncated"], page_kb=round(len(json.dumps(body)) / 1024))
        out[f"list {n:>6} first page (0,500)"] = stats
        if n > 2000:
            stats, body = timed(lambda: get(client, "list", root="r0", path=rel, offset=2000, limit=500), reps)
            stats.update(returned=len(body["entries"]))
            out[f"list {n:>6} load-more page (2000,500)"] = stats
            if n >= 20000:
                stats, body = timed(lambda: get(client, "list", root="r0", path=rel, offset=0, limit=2000), reps)
                stats.update(page_kb=round(len(json.dumps(body)) / 1024))
                out[f"list {n:>6} max page (0,2000)"] = stats


def suite_search(client, work, reps, out, sizes):
    for n in sizes:
        build_tree(work, n)
        rel = f"tree_{n}"
        for label, q in [("no match", "zz-no-match"), ("unique needle", "needle-unique"),
                         ("common word (hits limit)", "report"), ("glob *.md", "*.md")]:
            stats, body = timed(lambda: get(client, "search", root="r0", path=rel, q=q, limit=200), reps, warmup=0 if n >= 500_000 else 1)
            stats.update(results=len(body["results"]), visited=body["visited"], reason=body["reason"])
            out[f"search {n:>7} {label}"] = stats


def suite_searchcap(client, api, work, reps, out):
    """Cap behaviour, scaled down so it is measurable on a fast SSD: the real caps are 5 s and 1,000,000 visits."""
    n = 500_000 if (work / ".done_tree_500000").exists() else 10_000
    build_tree(work, n)
    saved = api.SEARCH_SECONDS, api.SEARCH_VISIT_LIMIT
    try:
        api.SEARCH_SECONDS = 0.25
        stats, body = timed(lambda: get(client, "search", root="r0", path=f"tree_{n}", q="zz-no-match"), reps)
        stats.update(cap_ms=250, overshoot_ms=round(stats["median_ms"] - 250, 1), reason=body["reason"],
                     truncated=body["truncated"], visited=body["visited"])
        out[f"search {n:>7} time cap patched to 0.25 s"] = stats
        api.SEARCH_SECONDS = saved[0]
        api.SEARCH_VISIT_LIMIT = 100_000
        stats, body = timed(lambda: get(client, "search", root="r0", path=f"tree_{n}", q="zz-no-match"), reps)
        stats.update(reason=body["reason"], truncated=body["truncated"], visited=body["visited"],
                     us_per_visit=round(stats["median_ms"] * 1000 / max(1, body["visited"]), 2),
                     est_ms_to_1M_visit_cap=round(stats["median_ms"] * 1_000_000 / max(1, body["visited"])))
        out[f"search {n:>7} visit cap patched to 100k"] = stats
    finally:
        api.SEARCH_SECONDS, api.SEARCH_VISIT_LIMIT = saved


def _upload(client, size, payload_chunk: bytes, chunk_bytes, base=""):
    """One upload through start/chunk/finish over a real HTTP client. Returns seconds (bodies pre-built)."""
    name = f"bench-{os.getpid()}-{time.monotonic_ns()}.bin"
    hdr = {"content-type": "application/json"}

    def post(route, raw):
        r = client.post(f"{base}{PREFIX}/{route}", content=raw, headers=hdr)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert body.get("ok", True), body
        return body
    body = json.dumps({"root": "r0", "path": f"uploads/{name}", "size": size}).encode()
    t = time.perf_counter()
    upload_id = post("uploads/start", body)["upload_id"]
    elapsed = time.perf_counter() - t
    b64 = base64.b64encode(payload_chunk).decode()
    for offset in range(0, size, chunk_bytes):
        part = b64 if offset + chunk_bytes <= size else base64.b64encode(payload_chunk[: size - offset]).decode()
        raw = ('{"root":"r0","path":"uploads/%s","upload_id":"%s","offset":%d,"data":"%s"}'
               % (name, upload_id, offset, part)).encode()
        t = time.perf_counter()
        post("uploads/chunk", raw)
        elapsed += time.perf_counter() - t
    raw = json.dumps({"root": "r0", "path": f"uploads/{name}", "upload_id": upload_id, "size": size}).encode()
    t = time.perf_counter()
    done = post("uploads/finish", raw)
    elapsed += time.perf_counter() - t
    assert done["entry"]["size"] == size
    return elapsed


def _maxrss_bytes():
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss if sys.platform == "darwin" else rss * 1024


def child_serve(args):
    """A real uvicorn server (plugin or core router) so server-side peak RSS is measured apart from the client."""
    import uvicorn
    from fastapi import FastAPI
    work = Path(args.work)
    if args.serve == "core":
        sys.path.insert(0, args.core)
        os.environ["HERMES_DASHBOARD_FILES_ROOT"] = str(work / "root")
        import hermes_cli.web_routers.files as files
        app = FastAPI()
        app.include_router(files.router)
    else:
        api = load_api(Path(args.plugin))
        app = make_client(api, work).app
    app.add_api_route("/__rss", lambda: {"maxrss": _maxrss_bytes()})
    config = uvicorn.Config(app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False)
    uvicorn.Server(config).run()


class _Server:
    def __init__(self, args, kind):
        import socket
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        cmd = [sys.executable, __file__, "--plugin", args.plugin, "--work", args.work, "--serve", kind,
               "--port", str(self.port)] + (["--core", args.core] if args.core else [])
        self.proc = subprocess.Popen(cmd, env=dict(os.environ, HERMES_DISABLE_LAZY_INSTALLS="1"))
        self.base = f"http://127.0.0.1:{self.port}"
        import httpx
        self.client = httpx.Client(timeout=120)
        for _ in range(200):
            try:
                self.client.get(self.base + "/__rss")
                break
            except httpx.HTTPError:
                time.sleep(0.05)

    def rss(self):
        return self.client.get(self.base + "/__rss").json()["maxrss"]

    def close(self):
        self.client.close()
        self.proc.terminate()  # our own child, by its exact PID
        self.proc.wait(10)


def suite_upload(args, out):
    srv = _Server(args, "plugin")
    try:
        chunk = os.urandom(4 * MIB)
        _upload(srv.client, MIB, chunk, 4 * MIB, srv.base)  # warm-up
        for size in (1 * MIB, 100 * MIB):
            base_rss = srv.rss()
            samples = [_upload(srv.client, size, chunk, 4 * MIB, srv.base) for _ in range(args.reps)]
            s = summarize(samples)
            s["mib_per_s_median"] = round(size / MIB / (s["median_ms"] / 1000), 1)
            s["server_peak_rss_mib"] = round(srv.rss() / MIB, 1)
            s["server_rss_growth_mib"] = round((srv.rss() - base_rss) / MIB, 1)
            s["wire_bytes_per_payload_byte"] = round(4 / 3, 3)
            out[f"upload {size // MIB:>3} MiB (chunk protocol, 4 MiB chunks, uvicorn)"] = s
    finally:
        srv.close()
        for f in (Path(args.work) / "root" / "uploads").glob("bench-*.bin"):
            f.unlink()


def core_upload(args, out):
    srv = _Server(args, "core")
    root = Path(args.work) / "root"
    try:
        for size in (1 * MIB, 100 * MIB):
            data = os.urandom(size)
            target = root / "uploads" / f"core-{size}.bin"

            def up():
                r = srv.client.post(srv.base + "/api/files/upload-stream", files={"file": ("x.bin", data)},
                                    data={"path": str(target), "overwrite": "true"})
                assert r.status_code == 200, r.text[:200]
            base_rss = srv.rss()
            s = timed(up, args.reps)[0]
            s["mib_per_s_median"] = round(size / MIB / (s["median_ms"] / 1000), 1)
            s["server_peak_rss_mib"] = round(srv.rss() / MIB, 1)
            s["server_rss_growth_mib"] = round((srv.rss() - base_rss) / MIB, 1)
            out[f"core /api/files/upload-stream {size // MIB:>3} MiB (multipart, uvicorn)"] = s
            target.unlink(missing_ok=True)
    except Exception as exc:  # noqa: BLE001
        out["core /api/files/upload-stream"] = {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}
    finally:
        srv.close()


def suite_file(client, work, reps, out):
    doc = build_doc(work)
    rel = str(doc.relative_to(work / "root"))
    stats, body = timed(lambda: get(client, "file", root="r0", path=rel), reps)
    stats.update(bytes=body["size"])
    out["file read 1 MiB .md"] = stats
    state = {"sha": body["sha256"], "flip": 0}

    def save():
        state["flip"] ^= 1
        text = ("x" if state["flip"] else "y") + body["text"][1:]
        raw = json.dumps({"root": "r0", "path": rel, "base_sha256": state["sha"], "text": text}).encode()
        res = post_raw(client, "file/save", raw)
        state["sha"] = res["sha256"]
        return res
    out["file save 1 MiB .md (fsync + rename)"] = timed(save, reps)[0]


def suite_drive(client, api, reps, out):
    out["subprocess floor (python -c pass)"] = timed(
        lambda: subprocess.run([sys.executable, "-c", "pass"], check=True), reps)[0]

    def cold():
        api._DRIVE_CACHE.clear()
        return get(client, "drive/available")
    out["drive/available cold (1 subprocess)"] = timed(cold, reps)[0]
    out["drive/available warm (60 s cache)"] = timed(lambda: get(client, "drive/available"), max(reps, 20))[0]
    stats, body = timed(lambda: get(client, "drive/list"), reps)
    stats.update(items=len(body["items"]))
    out["drive/list 200 items (1 subprocess)"] = stats
    raw = json.dumps({"id": "file_0000000001", "root": "r0", "dest": "uploads/drive"}).encode()
    out["drive/import 1 MiB (2 subprocesses)"] = timed(lambda: post_raw(client, "drive/import", raw), reps)[0]


# ---------------------------------------------------------------- core Hermes comparison
def child_core(args):
    """Time core hermes_cli/web_routers/files.py the same way. Runs in its own process (env differs)."""
    sys.path.insert(0, args.core)
    work = Path(args.work)
    os.environ["HERMES_DASHBOARD_FILES_ROOT"] = str(work / "root")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import hermes_cli.web_routers.files as files
    app = FastAPI()
    app.include_router(files.router)
    client = TestClient(app)
    out, root, reps = {}, work / "root", args.reps

    def cget(route, **params):
        r = client.get(route, params=params)
        assert r.status_code == 200, (route, r.status_code, r.text[:300])
        return r.json()
    for n in [n for n in FLAT_SIZES if (root / f"flat_{n}").is_dir()]:
        stats, body = timed(lambda: cget("/api/files", path=str(root / f"flat_{n}")), reps)
        stats.update(total=len(body["entries"]), page_kb=round(len(json.dumps(body)) / 1024))
        out[f"core /api/files {n:>6} (all entries, no paging)"] = stats
        try:
            stats, body = timed(lambda: cget("/api/fs/list", path=str(root / f"flat_{n}")), reps)
            stats.update(total=len(body["entries"]))
            out[f"core /api/fs/list {n:>6} (names only)"] = stats
        except Exception as exc:  # noqa: BLE001 - report, do not crash the comparison
            out[f"core /api/fs/list {n:>6}"] = {"error": f"{type(exc).__name__}: {str(exc)[:120]}"}
    doc = root / "docs" / "notes-1mib.md"
    out["core /api/files/read 1 MiB (base64 data URL)"] = timed(lambda: cget("/api/files/read", path=str(doc)), reps)[0]
    try:
        out["core /api/fs/read-text 1 MiB (512 KiB preview cap)"] = timed(lambda: cget("/api/fs/read-text", path=str(doc)), reps)[0]
    except Exception as exc:  # noqa: BLE001
        out["core /api/fs/read-text"] = {"error": f"{type(exc).__name__}: {str(exc)[:120]}"}
    text = doc.read_text()
    try:
        def save():
            r = client.post("/api/fs/write-text", json={"path": str(doc), "content": text})
            assert r.status_code == 200, r.text[:200]
        out["core /api/fs/write-text 1 MiB"] = timed(save, reps)[0]
    except Exception as exc:  # noqa: BLE001
        out["core /api/fs/write-text"] = {"error": f"{type(exc).__name__}: {str(exc)[:120]}"}
    print(json.dumps(out))


def suite_core(args, out):
    cmd = [sys.executable, __file__, "--plugin", args.plugin, "--work", args.work, "--reps", str(args.reps),
           "--core", args.core, "--child-core"]
    env = dict(os.environ, HERMES_DISABLE_LAZY_INSTALLS="1")
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if res.returncode:
        out["core comparison"] = {"error": res.stderr.strip().splitlines()[-1][:300] if res.stderr else "failed"}
        return
    out.update(json.loads(res.stdout.strip().splitlines()[-1]))
    if "upload" in args.suites:
        core_upload(args, out)


# ---------------------------------------------------------------- profiling
def profile_paths(client, work, outdir: Path, sizes_flat, sizes_tree):
    outdir.mkdir(parents=True, exist_ok=True)
    cases = {
        "list_20k_first_page": lambda: get(client, "list", root="r0", path="flat_20000", offset=0, limit=500),
        "search_100k_no_match": lambda: get(client, "search", root="r0", path="tree_100000", q="zz-no-match"),
        "search_10k_common_word": lambda: get(client, "search", root="r0", path="tree_10000", q="report", limit=200),
    }
    for name, fn in cases.items():
        fn()
        prof = cProfile.Profile()
        prof.enable()
        fn()
        prof.disable()
        buf = io.StringIO()
        st = pstats.Stats(prof, stream=buf).strip_dirs().sort_stats("cumulative")
        st.print_stats(30)
        buf.write("\n---- by tottime ----\n")
        st.sort_stats("tottime").print_stats(20)
        (outdir / f"{name}.txt").write_text(buf.getvalue())


# ---------------------------------------------------------------- main
def machine_info(work: Path):
    info = {"python": sys.version.split()[0], "platform": platform.platform(), "machine": platform.machine(),
            "cpus": os.cpu_count()}
    if sys.platform == "darwin":
        q = lambda *c: subprocess.run(c, capture_output=True, text=True).stdout.strip()  # noqa: E731
        info["cpu"] = q("sysctl", "-n", "machdep.cpu.brand_string")
        info["mem_gb"] = int(q("sysctl", "-n", "hw.memsize") or 0) // 1024 ** 3
        dev = q("df", str(work)).splitlines()[-1].split()[0]
        info["fs"] = next((line.split(":", 1)[1].strip() for line in q("diskutil", "info", dev).splitlines()
                           if "File System Personality" in line), "?")
    else:
        info["fs"] = subprocess.run(["stat", "-f", "-c", "%T", str(work)], capture_output=True, text=True).stdout.strip()
    import fastapi
    import starlette
    info["fastapi"], info["starlette"] = fastapi.__version__, starlette.__version__
    return info


def to_markdown(meta, results):
    lines = [f"# Cloud File Manager gateway benchmark", "",
             "| key | value |", "|---|---|"] + [f"| {k} | {v} |" for k, v in meta.items()] + [""]
    lines += ["| case | median ms | p95 ms | n | extra |", "|---|---:|---:|---:|---|"]
    for case, s in results.items():
        if "error" in s:
            lines.append(f"| {case} | - | - | - | {s['error']} |")
            continue
        extra = ", ".join(f"{k}={v}" for k, v in s.items() if k not in {"median_ms", "p95_ms", "n", "min_ms", "max_ms"})
        lines.append(f"| {case} | {s['median_ms']} | {s['p95_ms']} | {s['n']} | {extra} |")
    return "\n".join(lines) + "\n"


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plugin", default=str(here.parent), help="plugin checkout (has dashboard/plugin_api.py)")
    ap.add_argument("--work", default=str(Path(tempfile.gettempdir()) / "hcfm-bench-fixtures"))
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--suites", default="baseline,list,search,searchcap,upload,file,drive")
    ap.add_argument("--quick", action="store_true", help="small sizes only (CI smoke)")
    ap.add_argument("--core", help="Hermes checkout: also time core hermes_cli/web_routers/files.py")
    ap.add_argument("--profile", help="directory for cProfile top-N text of the slow paths")
    ap.add_argument("--json")
    ap.add_argument("--md")
    ap.add_argument("--label", default="")
    ap.add_argument("--serve", choices=["plugin", "core"], help=argparse.SUPPRESS)
    ap.add_argument("--port", type=int, help=argparse.SUPPRESS)
    ap.add_argument("--child-core", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()
    args.plugin, args.work = str(Path(args.plugin).resolve()), str(Path(os.path.realpath(args.work)))
    Path(args.work).mkdir(parents=True, exist_ok=True)
    if args.serve:
        return child_serve(args)
    if args.child_core:
        return child_core(args)

    work = Path(args.work)
    flat = [100, 1000] if args.quick else FLAT_SIZES
    tree = [10_000] if args.quick else TREE_SIZES
    drive_home = build_drive_skill(work)
    api = load_api(Path(args.plugin))
    client = make_client(api, work, drive_home)
    build_doc(work)
    meta = machine_info(work)
    meta.update(label=args.label, plugin=args.plugin, plugin_version=api.VERSION, reps=args.reps,
                plugin_api_sha256=hashlib.sha256((Path(args.plugin) / "dashboard/plugin_api.py").read_bytes()).hexdigest()[:16])
    suites = args.suites.split(",")
    results: dict = {}
    t0 = time.monotonic()
    for name in suites:
        print(f"[bench] {name} ...", file=sys.stderr, flush=True)
        if name == "baseline":
            suite_baseline(client, args.reps, results)
        elif name == "list":
            suite_list(client, work, args.reps, results, flat)
        elif name == "search":
            suite_search(client, work, args.reps, results, tree)
        elif name == "searchcap":
            suite_searchcap(client, api, work, args.reps, results)
        elif name == "upload":
            suite_upload(args, results)
        elif name == "file":
            suite_file(client, work, args.reps, results)
        elif name == "drive":
            suite_drive(client, api, args.reps, results)
    if args.core:
        print("[bench] core ...", file=sys.stderr, flush=True)
        suite_core(args, results)
    if args.profile:
        print("[bench] profile ...", file=sys.stderr, flush=True)
        profile_paths(client, work, Path(args.profile), flat, tree)
    meta["wall_s"] = round(time.monotonic() - t0, 1)
    md = to_markdown(meta, results)
    print(md)
    if args.json:
        Path(args.json).write_text(json.dumps({"meta": meta, "results": results}, indent=1))
    if args.md:
        Path(args.md).write_text(md)


if __name__ == "__main__":
    main()
