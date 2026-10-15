# Benchmark results: v0.4.6 (B3, unreadable folders)

Run on 2026-10-15 at 12:45 UTC: Apple M4 Pro (14 cores, 64 GB), APFS, macOS 27.0, Python 3.12.13, FastAPI 0.133.1, `plugin_api.py` sha256 prefix `9b6552f93119e41e`. The machine was very busy (load average about 32), so read the absolute times loosely; the counts are exact.

`bench_hcfm.py --suites search,locked --quick --reps 5`. The `locked` suite makes folders the bench user genuinely cannot open: mode 000, run as an ordinary user (as root it records "not exercised", because root reads mode 000 folders). It removes them again when it finishes.

- **Flat:** 19,990 files and 10 locked subfolders in one folder, 20,000 entries, which is exactly the list scan cap. Each locked subfolder hides one `hidden-needle` file.
- **Tree:** 40,000 files in leaf folders of 100; every tenth leaf (40 of 400) is locked and also hides a `hidden-needle` file. The newest file in the tree sits in the very last leaf, which is readable and comes last in the search's breadth-first order.

| case | median ms | p95 ms | n | extra |
|---|---:|---:|---:|---|
| search 10000 no match (no locked folders, same run) | 38.34 | 43.45 | 5 | results=0, visited=10106, reason=None |
| locked flat 19990+10 list first page, cold | 141.48 | 153.18 | 5 | total=20000, truncated=False, locked_dirs_listed=10 |
| locked flat: open a mode-000 folder | 3.89 | 6.51 | 5 | ok=False, code=permission_denied |
| locked flat 19990+10 search a name only inside locked folders | 48.45 | 51.38 | 5 | results=0, truncated=False, reason=None, visited=20000, skipped=10 |
| locked tree 40000 search no match (40 locked leaves) | 107.61 | 239.01 | 5 | results=0, truncated=False, reason=None, visited=36421, skipped=40 |
| locked tree 40000 search the late newest file | 113.16 | 124.75 | 5 | results=1, truncated=False, reason=None, visited=36421, skipped=40, found_mtime_is_newest=True |
| locked tree 40000 search, time cap patched to 0.01 s | 11.58 | 11.84 | 5 | reason=time, truncated=True, visited=2820, skipped=3 |

## What it shows

- **Bounded time: yes.** Locked folders cost nothing extra: about 2.95 µs per visited entry on the locked tree against 3.8 µs on the unlocked 10k tree in the same run. The time cap still stops a search early (`reason=time`), and the visit count stays below the 1,000,000 visit cap.
- **Locked folders in a listing: honest.** All 10 are listed as folders, and opening one answers `permission_denied` in a few milliseconds, which Desktop shows as an error.
- **The late newest file is found** after the search has passed all 40 locked leaves.
- **Partial search results: the gateway is honest, Desktop is not.** The gateway counts every locked folder in `skipped` (10 of 10, 40 of 40), but it reports `truncated=False` and `reason=None`, and Desktop reads `truncated` and `reason` (and `visited` when a cap stops the search), never `skipped`. A search for a name that exists only inside locked folders therefore shows a plain "no results", with nothing to say that folders were left out. On a Mac-hosted agent whose root is a home folder, this can happen without any mode-000 folder: macOS privacy protection makes folders such as Desktop, Documents and Mail unreadable to a process without Full Disk Access.
