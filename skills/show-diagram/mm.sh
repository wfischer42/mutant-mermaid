#!/bin/sh
# Usage: mm.sh ARGS...  Runs the mutant-mermaid CLI from this plugin (render, list, guide), installing its
# runtime packages next to it on first use. Node runs the TypeScript source directly, so nothing is built.
set -e
root=$(cd "$(dirname "$0")/../.." && pwd)
node -e 'process.exit(process.features.typescript ? 0 : 1)' 2>/dev/null || {
  echo "mutant-mermaid needs a Node that runs TypeScript (22.18+ or 23.6+); found $(node -v 2>/dev/null || echo none)." >&2
  exit 1
}
if [ ! -d "$root/node_modules/mermaid" ] || [ ! -d "$root/node_modules/jsdom" ]; then
  [ -e "$root/node_modules" ] && { echo "$root/node_modules is incomplete: delete it and run again." >&2; exit 1; }
  echo "Installing mutant-mermaid's packages (first run only)..." >&2
  tmp=$(mktemp -d)
  # npm refuses the repo's own package.json (it asks for pnpm), so install from a copy of its runtime deps.
  node -e 'const p = require(process.argv[1]); console.log(JSON.stringify({ name: "mutant-mermaid-deps", private: true, dependencies: { ...p.dependencies, mermaid: p.peerDependencies.mermaid } }))' "$root/package.json" > "$tmp/package.json"
  (cd "$tmp" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >&2)
  # shortcut: two first renders at once can race here; the loser fails once and works on retry.
  mv "$tmp/node_modules" "$root/node_modules"
  rm -rf "$tmp"
fi
exec node "$root/src/cli.ts" "$@"
