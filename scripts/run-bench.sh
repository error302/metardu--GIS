#!/usr/bin/env bash
# Run the Phase A performance benchmark harness (hard budgets, CI-gateable).
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p .test-build
npx esbuild benchmarks/bench.ts --bundle --platform=node --format=esm --outfile=.test-build/bench.mjs --log-level=warning
node .test-build/bench.mjs
status=$?
rm -rf .test-build
exit $status
