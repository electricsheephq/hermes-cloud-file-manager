# Benchmark results: v0.4.6 (B3, unreadable folders)

Run on 2026-10-15 at 13:03 UTC: Apple M4 Pro (14 cores, 64 GB), APFS, macOS 27.0, Python 3.12.13, FastAPI 0.133.1, `plugin_api.py` sha256 prefix `9b6552f93119e41e`. The machine was very busy (load average 27 to 35), so read the absolute times loosely; the counts are exact.

`bench_hcfm.py --suites locked --reps 7`. The `locked` suite makes folders the bench user genuinely cannot open: mode 000, run as an ordinary user. It records "not exercised" as root, because root reads mode 000 folders, and on a system without POSIX modes. It removes the locked folders again when it finishes.

- **Flat:** 19,990 files and 10 locked subfolders in one folder, 20,000 entries, which is exactly the list scan cap. Each locked subfolder hides one `hidden-needle` file.
- **Tree:** 40,000 files in leaf folders of 100; every tenth leaf (40 of 400) is locked and also hides a `hidden-needle` file. The newest file in the tree sits in the last leaf by name. The filesystem decides the walk order (APFS does not list names in order), so the case records how far the walk had got when it found the file.
- **Unlocked twin:** the same 40,000-file tree with nothing locked, searched in the same run. Its readable contents match the locked tree except for one file name; the 40 hidden needles sit inside the locked leaves, which the locked search never reads.

| case | median ms | p95 ms | n | extra |
|---|---:|---:|---:|---|
| locked flat 19990+10 list first page, cold | 150.96 | 163.47 | 7 | total=20000, truncated=False, locked_dirs_listed=10 |
| locked flat: open a mode-000 folder | 2.63 | 2.97 | 7 | ok=False, code=permission_denied |
| locked flat 19990+10 search a name only inside locked folders | 40.62 | 46.75 | 7 | results=0, truncated=False, reason=None, visited=20000, skipped=10 |
| unlocked twin tree 40000 search no match | 146.94 | 155.92 | 7 | results=0, reason=None, visited=40421, skipped=0, us_per_visit=3.64 |
| locked tree 40000 search no match (40 locked leaves) | 145.92 | 152.29 | 7 | results=0, truncated=False, reason=None, visited=36421, skipped=40, us_per_visit=4.01 |
| locked tree 40000 search the newest file, limit 1 | 90.87 | 99.65 | 7 | results=1, reason=results, visited_at_find=23292, locked_leaves_passed_at_find=26, found_mtime_is_newest=True |
| locked tree 40000 search, time cap patched to 0.01 s | 12.69 | 14.5 | 7 | reason=time, truncated=True, visited=2120, skipped=2 |

## What it shows

- **Bounded time: yes.** The locked tree took about as long as the unlocked twin: 146 against 147 ms in this run, and 126 against 119 ms in an earlier run at lower load. It visits 4,000 fewer entries, because it never reads the locked leaves, so its time per visited entry is 10 to 18% higher (here 4.01 against 3.64 µs). The time cap still stops a search early (`reason=time`).
- **Locked folders in a listing: honest.** All 10 are listed as folders, and opening one answers `permission_denied` in a few milliseconds, which Desktop shows as an error.
- **The newest file is found** deep into the walk: 23,292 entries in, after the walk had already passed 26 of the 40 locked leaves.
- **Partial search results: the gateway is honest, Desktop is not.** The gateway counts every locked folder in `skipped` (10 of 10, 40 of 40), but it reports `truncated=False` and `reason=None`, and Desktop reads `truncated` and `reason` (and `visited` when a cap stops the search), never `skipped`. A search for a name that exists only inside locked folders therefore shows a plain "no results", with nothing to say that folders were left out. On a Mac-hosted agent whose root is a home folder, this can happen without any mode-000 folder: macOS privacy protection makes folders such as Desktop, Documents and Mail unreadable to a process without Full Disk Access.
