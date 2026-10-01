#!/usr/bin/env bash
# Render docs/media/banner.png (1200x600) from docs/media/banner.html with headless Chrome.
# Uses a throwaway Chrome profile so it never touches your own browser profile.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
OUT="$PROFILE/banner.png"
# Headless Chrome writes the screenshot but does not always exit, so watch for the file and stop it ourselves.
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --user-data-dir="$PROFILE" --window-size=1200,600 --virtual-time-budget=3000 \
  --screenshot="$OUT" "file://$PWD/docs/media/banner.html" >/dev/null 2>&1 &
pid=$!
for _ in $(seq 1 120); do [ -s "$OUT" ] && break; sleep 0.25; done
sleep 0.5; kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
[ -s "$OUT" ] || { echo "banner render failed" >&2; exit 1; }
mv "$OUT" docs/media/banner.png
python3 - <<'PY'
import struct
with open("docs/media/banner.png", "rb") as f:
    head = f.read(24)
w, h = struct.unpack(">II", head[16:24])
assert (w, h) == (1200, 600), f"banner is {w}x{h}, expected 1200x600"
print(f"docs/media/banner.png {w}x{h}")
PY
