#!/usr/bin/env bash
#
# selfcheck.sh — run the dependency-free self-check for the policy logic.
#
# Covers rule.ts: the only non-trivial logic in the plugin (strict opt-in,
# accept+reject, GPC denies optional, no PII in proof, validity from the
# operator setting with a fail-safe, version bump re-asks). No test framework.
#
# Usage:  bash scripts/selfcheck.sh
# Requires: node, and a tsc (project devDependency `typescript` or a global one).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

if [ -x "$ROOT/node_modules/.bin/tsc" ]; then
	TSC="$ROOT/node_modules/.bin/tsc"
elif command -v tsc >/dev/null 2>&1; then
	TSC="tsc"
else
	echo "ERROR: no tsc found. Run 'pnpm install' (or 'npm install') first." >&2
	exit 1
fi

# Compile only rule.ts + its self-check (dependency-free) to plain JS.
"$TSC" \
	--target ES2022 --module ESNext --moduleResolution Bundler \
	--types node --strict --skipLibCheck \
	--outDir "$OUT" \
	"$ROOT/src/rule.ts" "$ROOT/src/rule.selfcheck.ts"

node "$OUT/rule.selfcheck.js"
