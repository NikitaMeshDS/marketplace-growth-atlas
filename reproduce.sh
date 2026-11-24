#!/usr/bin/env bash
set -euo pipefail
local_source=""
if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [directory containing both original files]\n' "$0" >&2
  exit 2
fi
if [[ $# -eq 1 ]]; then
  local_source="$(cd "$1" && pwd)"
fi
cd "$(dirname "$0")"
source_rev=04948354fadac437c50a25b461c603581a7279f4
base="https://raw.githubusercontent.com/NikitaMeshDS/sberindex-task2/$source_rev"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [[ -n "$local_source" ]]; then
  cp "$local_source/consumption.parquet" "$local_source/municipal_lookup.csv" "$tmp/"
else
  curl -fsSL --retry 3 --retry-all-errors "$base/data/consumption.parquet" -o "$tmp/consumption.parquet"
  curl -fsSL --retry 3 --retry-all-errors "$base/results/municipal_lookup.csv" -o "$tmp/municipal_lookup.csv"
fi
(
  cd "$tmp"
  shasum -a 256 -c <<'SUMS'
9833ddaaee7b2a182ed4cceeed16469031700ea87d508bd976150c6770ef8a61  consumption.parquet
0164a1d6479cce33fb7affe2e2b0b05c850bf93e2a32b9e84b1fdcd815aefb91  municipal_lookup.csv
SUMS
)
python -m unittest discover -s tests
python analysis.py --data "$tmp/consumption.parquet" --geography "$tmp/municipal_lookup.csv"
python build_demo.py
npm --prefix app test
npm --prefix app run build
