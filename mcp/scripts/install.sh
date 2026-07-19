#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Installing alienpass-mcp dependencies"
npm install

echo "==> Running unit/self tests"
npm run test:engine

echo "==> Running browser integration test (skipped if no Chrome)"
npm run test:signin || true

echo "==> Doctor"
ALIENPASS_FORCE_FALLBACK=1 node src/cli.js doctor

cat <<EOF

Install complete.

Next:
  1) Store master:  node src/cli.js init-master 'YourUniversalSecret'
  2) Add site:      node src/cli.js add-site google-mail gmail accounts.google.com,mail.google.com --user you@example.com
  3) Sign in:       node src/cli.js sign-in 'https://accounts.google.com' --headed
  4) Cursor MCP:    copy config/cursor-mcp.example.json into local-agent MCP settings
     (absolute path to $ROOT/src/server.js)

Never attach this MCP server to a cloud proprietary agent.
EOF
