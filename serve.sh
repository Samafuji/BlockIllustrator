#!/bin/sh
# Block Illustrator - start a local server for dist/index.html (macOS / Linux)
# Uses whatever is available: python3, python, or Node.js. Usage: ./serve.sh [port]
PORT="${1:-8000}"
DIR="$(cd "$(dirname "$0")" && pwd)/dist"
if [ ! -f "$DIR/index.html" ]; then
  echo "dist/index.html not found. Download it from GitHub or run 'npm run build'." >&2
  exit 1
fi
URL="http://localhost:$PORT/"
echo "Block Illustrator: $URL  (Ctrl+C to stop)"
( sleep 1; (command -v xdg-open >/dev/null && xdg-open "$URL") || (command -v open >/dev/null && open "$URL") ) >/dev/null 2>&1 &
cd "$DIR" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes serve -l "$PORT" .
else
  echo "No python3 / python / node found. You can simply open dist/index.html in Chrome or Edge instead." >&2
  exit 1
fi
