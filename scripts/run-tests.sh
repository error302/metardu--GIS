#!/usr/bin/env bash
# Bundle and run every test suite with esbuild (no heavyweight test runner needed).
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p .test-build
fail=0
for f in tests/*.test.ts; do
  name=$(basename "$f" .test.ts)
  out=".test-build/$name.mjs"
  echo "── $name ─────────────────────────────────────────"
  if npx esbuild "$f" --bundle --platform=node --format=esm --outfile="$out" --log-level=warning; then
    node "$out" || fail=1
  else
    echo "FAIL: bundling $name"
    fail=1
  fi
done
rm -rf .test-build
if [ "$fail" -ne 0 ]; then
  echo "SOME TEST SUITES FAILED"
  exit 1
fi
echo "ALL TEST SUITES PASSED"
