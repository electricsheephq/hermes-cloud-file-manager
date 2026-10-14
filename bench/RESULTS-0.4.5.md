# Benchmark results: v0.4.5

Run on 2026-10-14 at 22:00 UTC: Apple M4 Pro (14 cores, 64 GB), APFS, macOS 27.0, Python 3.12.13, FastAPI 0.133.1. The machine was busy (load average about 17), so trust the A/B more than the absolute numbers.

## /list since v0.3.5

Between v0.3.5 and v0.4.5, `dashboard/plugin_api.py` gained only the read-only `GET /file/preview` route and version strings. `ab_list.py --variant v035=<v0.3.5> --variant v045=<v0.4.5> --reps 7` ran both back to back in every repetition, clearing the listing cache before every case.

| case | v0.3.5 median ms | v0.4.5 median ms | same output |
|---|---:|---:|---|
| list 1000 first page (0,500), cold | 10.14 | 10.06 | yes |
| list 1000 page (2000,500), cold | 6.38 | 6.41 | yes |
| list 1000 desktop Load more x4 | 16.52 | 16.44 | yes |
| list 5000 first page (0,500), cold | 31.81 | 31.46 | yes |
| list 5000 page (2000,500), cold | 31.3 | 31.3 | yes |
| list 5000 desktop Load more x4 | 49.08 | 48.54 | yes |
| list 20000 first page (0,500), cold | 112.61 | 113.17 | yes |
| list 20000 page (2000,500), cold | 142.45 | 138.07 | yes |
| list 20000 desktop Load more x4 | 159.63 | 160.75 | yes |
| list 25000 first page (0,500), cold | 140.14 | 140.27 | yes |
| list 25000 page (2000,500), cold | 140.92 | 144.42 | yes |
| list 25000 desktop Load more x4 | 161.8 | 164.8 | yes |

No change: every median is within 3%, and every response is identical.

## Full run at v0.4.5

`bench_hcfm.py --reps 5`; `plugin_api.py` sha256 prefix `ba16049921a719ac`. "Cold" clears the 5 s listing cache before every repetition, so it is the folder scan a first visit pays; "warm" is answered from that cache.

| case | median ms | p95 ms | n | extra |
|---|---:|---:|---:|---|
| available (transport floor) | 1.12 | 1.75 | 20 |  |
| roots (3 folder notes) | 2.02 | 3.05 | 20 |  |
| list    100 first page (0,500) cold | 3.29 | 10.92 | 5 | total=100, truncated=False, page_kb=26 |
| list    100 first page (0,500) warm | 1.99 | 2.03 | 5 | total=100, truncated=False, page_kb=26 |
| list   1000 first page (0,500) cold | 11.42 | 28.76 | 5 | total=1000, truncated=False, page_kb=132 |
| list   1000 first page (0,500) warm | 4.77 | 5.12 | 5 | total=1000, truncated=False, page_kb=132 |
| list   5000 first page (0,500) cold | 38.47 | 127.28 | 5 | total=5000, truncated=False, page_kb=133 |
| list   5000 first page (0,500) warm | 4.35 | 4.72 | 5 | total=5000, truncated=False, page_kb=133 |
| list   5000 load-more page (2000,500) | 4.59 | 4.73 | 5 | returned=500 |
| list  20000 first page (0,500) cold | 137.09 | 479.03 | 5 | total=20000, truncated=False, page_kb=136 |
| list  20000 first page (0,500) warm | 4.68 | 5.18 | 5 | total=20000, truncated=False, page_kb=136 |
| list  20000 load-more page (2000,500) | 4.63 | 4.8 | 5 | returned=500 |
| list  20000 max page (0,2000) | 14.17 | 14.58 | 5 | page_kb=536 |
| list  25000 first page (0,500) cold | 138.07 | 508.82 | 5 | total=20000, truncated=True, page_kb=136 |
| list  25000 first page (0,500) warm | 4.75 | 4.83 | 5 | total=20000, truncated=True, page_kb=136 |
| list  25000 load-more page (2000,500) | 4.62 | 4.83 | 5 | returned=500 |
| list  25000 max page (0,2000) | 14.38 | 14.4 | 5 | page_kb=536 |
| search   10000 no match | 37.25 | 37.62 | 5 | results=0, visited=10106, reason=None |
| search   10000 unique needle | 36.53 | 38.42 | 5 | results=1, visited=10106, reason=None |
| search   10000 common word (hits limit) | 43.88 | 46.26 | 5 | results=200, visited=2105, reason=results |
| search   10000 glob *.md | 38.84 | 40.87 | 5 | results=200, visited=1431, reason=results |
| search  100000 no match | 249.96 | 371.77 | 5 | results=0, visited=101051, reason=None |
| search  100000 unique needle | 246.47 | 257.35 | 5 | results=1, visited=101051, reason=None |
| search  100000 common word (hits limit) | 41.7 | 42.61 | 5 | results=200, visited=3040, reason=results |
| search  100000 glob *.md | 39.71 | 42.32 | 5 | results=200, visited=2373, reason=results |
| search  500000 no match | 1221.46 | 1309.05 | 5 | results=0, visited=505251, reason=None |
| search  500000 unique needle | 1206.37 | 1272.23 | 5 | results=1, visited=505251, reason=None |
| search  500000 common word (hits limit) | 70.48 | 74.23 | 5 | results=200, visited=7247, reason=results |
| search  500000 glob *.md | 70.07 | 76.51 | 5 | results=200, visited=6582, reason=results |
| search  500000 time cap patched to 0.25 s | 251.74 | 251.88 | 5 | cap_ms=250, overshoot_ms=1.7, reason=time, truncated=True, visited=95664 |
| search  500000 visit cap patched to 100k | 264.66 | 267.05 | 5 | reason=visits, truncated=True, visited=100000, us_per_visit=2.65, est_ms_to_1M_visit_cap=2647 |
| upload   1 MiB (chunk protocol, 4 MiB chunks, uvicorn) | 5.46 | 6.21 | 5 | mib_per_s_median=183.2, server_peak_rss_mib=60.2, server_rss_growth_mib=0.1, wire_bytes_per_payload_byte=1.333 |
| upload 100 MiB (chunk protocol, 4 MiB chunks, uvicorn) | 284.8 | 314.39 | 5 | mib_per_s_median=351.1, server_peak_rss_mib=82.9, server_rss_growth_mib=22.6, wire_bytes_per_payload_byte=1.333 |
| file read 1 MiB .md | 4.59 | 6.15 | 5 | bytes=1048576 |
| file save 1 MiB .md (fsync + rename) | 4.5 | 4.95 | 5 |  |
| subprocess floor (python -c pass) | 13.65 | 13.83 | 5 |  |
| drive/available cold (1 subprocess) | 26.87 | 27.36 | 5 |  |
| drive/available warm (60 s cache) | 0.61 | 0.78 | 20 |  |
| drive/list 200 items (1 subprocess) | 27.3 | 28.82 | 5 | items=200 |
| drive/import 1 MiB (2 subprocesses) | 54.74 | 70.82 | 5 |  |

What it shows:
- **Folders.** A first visit to a 20,000-entry folder costs about 140 ms on the gateway. Revisits and Load more within 5 s cost about 5 ms.
- **Search.** Searches that reach the 200-result limit stay under 75 ms, even across 500,000 files. A search with no match walks the whole tree: 1.2 s at 500,000 files.
- **Uploads.** They run at about 350 MiB/s over loopback. A 100 MiB upload grows server memory by about 23 MiB.

Not covered here:
- Desktop rendering and preview time to visible, which are measured in the real app (B2).
- Network latency (B4).
