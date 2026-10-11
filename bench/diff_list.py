#!/usr/bin/env python3
"""Differential check: /list from a candidate plugin_api.py must equal /list from the baseline, folder by folder,
over a fixture full of guard edge cases (links in/out/dangling, a protected Hermes home inside the root and an alias
to it, hidden names, a home root, NFC/NFD and case twins, temp names, hard links).

    python bench/diff_list.py --base <plugin checkout> --cand <plugin checkout> --work <empty dir>
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import unicodedata

PREFIX = "/api/plugins/hermes-cloud-file-manager"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def build(work: Path):
    root = work / "home"  # also used as Path.home() for the home-root case
    outside = work / "outside"
    for d in (root, outside, root / "proj/sub", root / ".hidden-dir", root / "proj/.dot-in-proj",
              root / "agent-home/skills", root / "Folder", outside / "od"):
        d.mkdir(parents=True, exist_ok=True)
    (outside / "secret.txt").write_text("s")
    files = ["a.txt", "B.md", ".env", "proj/x.py", "proj/.hidden.txt", "proj/sub/deep.txt",
             ".cfm-0123456789abcdef0123456789abcdef.part", "proj/.cfm-0123456789abcdef0123456789abcdef.dir",
             "agent-home/config.yaml", unicodedata.normalize("NFC", "café.txt"), "Folder/readme.txt"]
    for f in files:
        p = root / f
        if f.endswith(".dir"):
            p.mkdir(exist_ok=True)
        else:
            p.write_text("x" * len(f))
    try:
        (root / unicodedata.normalize("NFD", "naïve.txt")).write_text("n")
    except OSError:
        pass
    links = {"link-in-file": "a.txt", "link-in-dir": "proj", "link-out-dir": str(outside / "od"),
             "link-out-file": str(outside / "secret.txt"), "dangling": "nope", "proj/link-up": "..",
             "alias-to-agent-home": "agent-home", "proj/link-agent": "../agent-home/skills", ".hidden-link": "a.txt"}
    for name, target in links.items():
        p = root / name
        if not p.is_symlink():
            p.symlink_to(target)
    if not (root / "hard.txt").exists():
        os.link(root / "a.txt", root / "hard.txt")
    return root, outside


def folders(root: Path):
    out = [""]
    for dirpath, dirnames, _ in os.walk(root):
        for d in dirnames:
            out.append(str((Path(dirpath) / d).relative_to(root)))
    return out + ["link-in-dir", "alias-to-agent-home", "proj/link-agent", "link-out-dir"]


def run(api, root: Path, hermes_home: Path, home_root: bool, rel_folders):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    cfg = {"plugins": {"entries": {"hermes-cloud-file-manager": {"settings": {"roots": [str(root)]}}}}}
    api._load_config = lambda: cfg
    api._hermes_homes = lambda: {hermes_home}
    orig_home = Path.home
    Path.home = classmethod(lambda cls: root if home_root else root.parent / "elsewhere")
    try:
        app = FastAPI()
        app.include_router(api.router, prefix=PREFIX)
        client = TestClient(app)
        result = {}
        for rel in rel_folders:
            for offset, limit in ((0, 500), (2, 3)):
                body = client.get(f"{PREFIX}/list", params={"root": "r0", "path": rel, "offset": offset, "limit": limit}).json()
                result[f"{rel}|{offset}|{limit}"] = body
        return result
    finally:
        Path.home = orig_home


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--cand", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--cache", type=float, default=5, help="candidate listing-cache TTL; 0 disables")
    a = ap.parse_args()
    work = Path(os.path.realpath(a.work))
    work.mkdir(parents=True, exist_ok=True)
    root, _ = build(work)
    rels = folders(root)
    base = load(Path(a.base), "hcfm_base")
    cand = load(Path(a.cand), "hcfm_cand")
    cand.LIST_CACHE_SECONDS = a.cache
    bad = 0
    checked = 0
    for home_root in (False, True):
        b = run(base, root, root / "agent-home", home_root, rels)
        c = run(cand, root, root / "agent-home", home_root, rels)
        for key in b:
            checked += 1
            if json.dumps(b[key], sort_keys=True) != json.dumps(c[key], sort_keys=True):
                bad += 1
                print("DIFF", "home_root" if home_root else "plain", key)
                print("  base:", json.dumps(b[key])[:400])
                print("  cand:", json.dumps(c[key])[:400])
    print(f"checked {checked} responses, {bad} differ")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
