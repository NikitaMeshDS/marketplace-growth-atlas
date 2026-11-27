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
if [[ -n "$local_source" ]]; then
  data_dir="$local_source"
  sums_file="$PWD/data/SHA256SUMS"
  if ! (cd "$data_dir" && shasum -a 256 -c "$sums_file") >/dev/null 2>&1; then
    (
      cd "$data_dir"
      shasum -a 256 -c <<'SUMS'
9833ddaaee7b2a182ed4cceeed16469031700ea87d508bd976150c6770ef8a61  consumption.parquet
0164a1d6479cce33fb7affe2e2b0b05c850bf93e2a32b9e84b1fdcd815aefb91  municipal_lookup.csv
SUMS
    )
  fi
else
  data_dir="$PWD/data"
  (cd "$data_dir" && shasum -a 256 -c SHA256SUMS)
fi
python -m unittest discover -s tests
python analysis.py --data "$data_dir/consumption.parquet" --geography "$data_dir/municipal_lookup.csv"
python build_demo.py
npm --prefix app test
npm --prefix app run build
