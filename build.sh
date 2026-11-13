#!/bin/sh
# Sestaví web do složky dist (statické soubory pro GitHub Pages). Každé sestavení má vlastní verzi kvůli mezipaměti.
set -e
cd "$(dirname "$0")"
OUT=${1:-dist}
VER=$(date -u +%Y%m%d%H%M%S)
rm -rf "$OUT" && mkdir -p "$OUT"
bun build src/main.tsx --outdir "$OUT" --minify --target browser --define 'process.env.NODE_ENV="production"'
cp -r public/. "$OUT"/
sed -i "s/main\.js\"/main.js?v=$VER\"/; s/main\.css\"/main.css?v=$VER\"/; s/config\.js\"/config.js?v=$VER\"/" "$OUT"/index.html
sed -i "s/__VER__/$VER/g" "$OUT"/sw.js
ls -la "$OUT"
