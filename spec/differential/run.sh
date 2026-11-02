#!/usr/bin/env bash
# Differential test: run identical random inputs through the TypeScript and Python
# calculators and fail on any difference. Usage: spec/differential/run.sh [SEED] [COUNT]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
python3 "$here/gen.py" "${1:-1}" "${2:-1000}" "$tmp/cases.json"
node "$here/run_ts.mjs" "$tmp/cases.json" "$tmp/ts.json"
python3 "$here/run_py.py" "$tmp/cases.json" "$tmp/py.json"
python3 "$here/compare.py" "$tmp/cases.json" "$tmp/ts.json" "$tmp/py.json"
