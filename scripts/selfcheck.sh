#!/usr/bin/env bash
#
# selfcheck.sh - run the self-check for the policy logic.
#
# rule.selfcheck.ts asks c15t's REAL offline policy engine to resolve our rule
# for several countries, so a rule the runtime rejects (`invalid-configuration`,
# the bug that once hid the banner) fails here instead of in production.
# Bundled with esbuild so @c15t/* resolves from node_modules. No test framework.
#
# Usage:  bash scripts/selfcheck.sh      (run `npm install` first)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

if [ ! -x "$ROOT/node_modules/.bin/esbuild" ]; then
	echo "ERROR: esbuild not found. Run 'npm install' first." >&2
	exit 1
fi

"$ROOT/node_modules/.bin/esbuild" "$ROOT/src/rule.selfcheck.ts" \
	--bundle --platform=node --format=esm --outfile="$OUT/selfcheck.mjs" --log-level=warning
node "$OUT/selfcheck.mjs"
