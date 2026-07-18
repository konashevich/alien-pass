# AlienPass MCP (local sign-in)

Local stdio MCP server + CLI for Cursor sign-in subagents. Implements AlienPass **v2** derivation and Linux keyring storage so a **cloud main agent never receives passwords**.

Full design: [`../docs/mcp-local-signin-architecture.md`](../docs/mcp-local-signin-architecture.md).

## Requirements

- Linux (arm64 and x86_64)
- Node.js 20+
- Optional: `secret-tool` (`libsecret-tools`) for desktop keyring; otherwise a locked-down file fallback under `~/.local/share/alienpass-mcp/`

## Install

```bash
cd mcp
npm install
npm run test:engine
```

## Modes

| Env | Behavior |
| --- | --- |
| `ALIENPASS_MODE=alienpass` (default) | Keyring stores mnemonic / `InputString`; password derived with v2 |
| `ALIENPASS_MODE=keyring` | Keyring stores final passwords (simplification) |
| `ALIENPASS_ALLOW_REVEAL=0` (default) | `generate_password` refuses; prefer `fill_*` |
| `ALIENPASS_FORCE_FALLBACK=1` | Use file store instead of libsecret |

## Cursor MCP snippet (local subagent only)

See [`config/cursor-mcp.example.json`](./config/cursor-mcp.example.json).

**Do not** attach this server to the cloud main agent.

## CLI (terminal tool-calling)

```bash
export ALIENPASS_FORCE_FALLBACK=1
node src/cli.js store-mnemonic 'you@example.com' '*' 'GmailTower'
ALIENPASS_ALLOW_REVEAL=1 node src/cli.js generate 'you@example.com' 1
node src/cli.js report-ok 'you@example.com' 'https://example.com' alienpass-v2
```

## Subagent handoff (what the cloud agent may say)

```text
Sign in on the already-open page as you@example.com.
Use local alienpass MCP fill_login (domain=example.com, login_index=1).
Do not print passwords. Return only build_signin_report JSON.
```

## Status

- v2 engine + keyring + MCP tools: implemented (scaffold)
- Browser CDP injection into Cursor’s embedded browser: planned (see architecture Phase 5)
