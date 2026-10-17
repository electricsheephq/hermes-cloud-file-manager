# B2: preview time to visible, v0.4.7 (2026-10-17)

The real Hermes Desktop app on a local agent (same machine, loopback). Each row shows three opens, measured inside the
page from the double-click on the row until the preview is present:
- image: an `<img>` with a `blob:` source, loaded with a natural width;
- PDF: an `<iframe>` with a `blob:` source;
- CSV: a rendered table.

Machine: Mac mini M4 Pro, 64 GB. The Desktop and the agent ran normal work alongside.

The fixtures are random-noise JPEGs and image-only PDFs sized just under 1, 4 and 10 MiB (the preview limit is 10 MiB), plus a
CSV of 1,000 rows × 50 columns (288 KiB).

| File | Size | Opens (ms) |
| --- | --- | --- |
| JPEG 1076×1076 | 1.0 MiB | 157, 63, 64 |
| JPEG 2160×2160 | 4.0 MiB | 135, 100, 103 |
| JPEG 3382×3382 | 9.8 MiB | 254, 157, 193 |
| PDF | 1.0 MiB | 112, 60, 69 |
| PDF | 4.0 MiB | 128, 79, 116 |
| PDF | 9.8 MiB | 225, 168, 162 |
| CSV 1000×50 | 288 KiB | 1400, 1399, 1479 |

Reading:
- Images and PDFs up to the 10 MiB limit show in a quarter of a second on loopback.
- The CSV is slower because of rendering 50,000 table cells, not transfer. It is still well inside any timeout.
- No preview failed, so the preview timeout stays as it is (roadmap R1: bump only if B2 reproduces a failure).
- Loopback says nothing about a slow link. A real-WAN journey is B4, at v0.5.0.
