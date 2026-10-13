# bench/ — Cloud File Manager gateway benchmark

A reproducible speed and memory benchmark for the gateway half (`dashboard/plugin_api.py`). It needs no real Hermes.

- The router runs in-process under FastAPI `TestClient`. It is loaded by file path, exactly as `tests/conftest.py` does it.
- The same two seams are stubbed: `_load_config` and `_hermes_homes`. One existing Hermes home is configured, so the guard does its real work.
- Uploads go through a real `uvicorn` server in a child process. This keeps the server's peak memory separate from the client's request bodies.
- Drive uses a fake `google-workspace` skill, shaped like the one in `tests/test_drive.py`. There is no OAuth and no network.

## Run

```sh
pip install "fastapi==0.133.1" "starlette==1.3.1" httpx uvicorn python-multipart
python bench/bench_hcfm.py --reps 5 --json bench.json --md bench.md          # full run, about 4-5 min (first run builds ~640k fixture files)
python bench/bench_hcfm.py --quick --reps 3                                 # CI smoke: small sizes only
python bench/bench_hcfm.py --profile prof/                                  # also write cProfile top-N for the slow paths
python bench/bench_hcfm.py --core /path/to/hermes-agent                     # also time core hermes_cli/web_routers/files.py
python bench/ab_list.py --work <fixtures> --variant main=. --variant cand=../other-checkout   # interleaved A/B of /list
python bench/diff_list.py --base . --cand ../other-checkout --work <empty dir>               # /list output must be identical
```

- `--work` holds the fixtures. It defaults to `$TMPDIR/hcfm-bench-fixtures`, and the fixtures are reused between runs.
- `--core` needs a Python that core Hermes supports (3.14 at upstream main d4d2ab7b5d) with its dependencies installed. Run it in a sandbox, because it imports Hermes code.

## Suites

| suite | what it measures |
|---|---|
| baseline | `/available` (the transport floor) and `/roots` |
| list | `/list` on flat folders of 100, 1k, 5k, 20k and 25k entries (5% folders, mixed names). It times the first page `(0,500)` cold (the plugin's 5 s listing cache cleared before every repetition, so it is the scan a first visit pays) and warm (answered from that cache), then a Load-more page `(2000,500)` and the largest page `(0,2000)`, both warm. |
| search | `/search` on trees of 10k, 100k and 500k files (leaf folders of 100 files), with four queries: no match, a unique needle, a common word that hits the limit, and the glob `*.md` |
| searchcap | the shape of the time cap and the visit cap, scaled down (0.25 s and 100k visits), plus µs per visit and an estimate of the time to reach the 1M visit cap |
| upload | 1 MiB and 100 MiB through `uploads/start`, `uploads/chunk` and `uploads/finish` over real HTTP: MiB/s and the server's peak RSS growth |
| file | `GET /file` and `POST /file/save` of a 1 MiB Markdown file |
| drive | the subprocess floor, `drive/available` cold and warm, `drive/list` (200 items) and `drive/import` (1 MiB) |

Every case reports the median, p95, min and max over `--reps` timed repetitions, after one warm-up. Machine info, the filesystem, the Python and FastAPI versions, and the sha256 prefix of `plugin_api.py` are recorded.

## Reading results

Absolute numbers depend on the machine and on its load. Compare variants with `ab_list.py`, which runs every variant within each repetition. Do not compare two separate runs.
