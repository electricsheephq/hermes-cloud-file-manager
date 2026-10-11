#!/usr/bin/env python3
"""Interleaved A/B of /list between plugin checkouts (fair on a busy machine: each rep runs every variant back to back).

    python bench/ab_list.py --variant main=<checkout> --variant fast=<checkout>:cache=0 --variant fast+cache=<checkout>
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bench_hcfm as hb  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", action="append", required=True, help="name=checkout[:cache=SECONDS]")
    ap.add_argument("--work", required=True)
    ap.add_argument("--reps", type=int, default=7)
    ap.add_argument("--sizes", default="1000,5000,20000,25000")
    ap.add_argument("--json")
    a = ap.parse_args()
    work = Path(os.path.realpath(a.work))
    clients = {}
    for spec in a.variant:
        name, rest = spec.split("=", 1)
        path, _, opt = rest.partition(":")
        if opt.startswith("cache="):
            os.environ["HCFM_LIST_CACHE_SECONDS"] = opt.split("=", 1)[1]
        else:
            os.environ.pop("HCFM_LIST_CACHE_SECONDS", None)
        api = hb.load_api(Path(path), f"hcfm_ab_{name}")
        if opt.startswith("cache=") and hasattr(api, "LIST_CACHE_SECONDS"):
            api.LIST_CACHE_SECONDS = float(opt.split("=", 1)[1])
        clients[name] = (api, hb.make_client(api, work))
    sizes = [int(s) for s in a.sizes.split(",")]
    cases = []
    for n in sizes:
        hb.build_flat(work, n)
        rel = f"flat_{n}"
        cases.append((f"list {n:>6} first page (0,500), cold", rel, [(0, 500)], True))
        cases.append((f"list {n:>6} page (2000,500), cold", rel, [(2000, 500)], True))
        cases.append((f"list {n:>6} desktop Load more x4 (0,500)+(499,501)+(999,501)+(1499,501)+(1999,501)",
                      rel, [(0, 500), (499, 501), (999, 501), (1499, 501), (1999, 501)], True))
    results = {}
    for label, rel, pages, cold in cases:
        samples = {name: [] for name in clients}
        for rep in range(a.reps + 1):
            for name, (api, client) in clients.items():
                if cold and hasattr(api, "_LIST_CACHE"):
                    api._LIST_CACHE.clear()
                t = time.perf_counter()
                bodies = [hb.get(client, "list", root="r0", path=rel, offset=o, limit=l) for o, l in pages]
                if rep:  # rep 0 is warm-up
                    samples[name].append(time.perf_counter() - t)
                results.setdefault(label, {}).setdefault("_check", {})[name] = [
                    (b["total"], b["truncated"], [e["rel"] for e in b["entries"]][:3]) for b in bodies]
        checks = results[label].pop("_check")
        same = len({json.dumps(v) for v in checks.values()}) == 1
        results[label] = {name: hb.summarize(s) for name, s in samples.items()}
        results[label]["same_output"] = same
        print(label, {k: (v["median_ms"] if isinstance(v, dict) else v) for k, v in results[label].items()}, flush=True)
    load = os.getloadavg()
    out = {"meta": {"loadavg": load, "reps": a.reps, "variants": a.variant}, "results": results}
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
