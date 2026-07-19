# AlienPass MCP — local sign-in product

Local **stdio MCP server + CLI** for Cursor. Keeps AlienPass mnemonics and passwords off cloud models.

- **Mode A / compose (default):** encrypted site→token directory + keyring master → assemble `cased(token)+master` → AlienPass v2 → browser fill
- **Mode A / legacy:** full InputString in keyring
- **Mode B:** final passwords in keyring
- **Browser:** Playwright + system Chrome (launch or CDP attach)

Design: [`../docs/mcp-local-signin-architecture.md`](../docs/mcp-local-signin-architecture.md).

**End-to-end install (vault + Ollama + Cursor MCP + subagent):**  
[`../docs/mcp-install-and-configure.md`](../docs/mcp-install-and-configure.md)

**RK3588 NPU (FriendlyElec) local model:**  
[`../docs/rk3588-local-model.md`](../docs/rk3588-local-model.md)

## Requirements

- Linux (x86_64 or arm64)
- Node.js 20+
- Google Chrome or Chromium (for sign-in)
- Optional: `secret-tool` / libsecret (otherwise file fallback under `~/.local/share/alienpass-mcp/`)

## Install

```bash
cd mcp
bash scripts/install.sh
# or: npm install && npm test
```

Prefer a working desktop keyring (`secret-tool`). Use `ALIENPASS_FORCE_FALLBACK=1` only for CI/dev — the file backend is encrypted, but weaker than libsecret.

## Quick start (compose)

```bash
# Prefer libsecret when available. FORCE_FALLBACK is for CI/dev only.
node src/cli.js init-master 'YourUniversalSecret'
node src/cli.js add-site google-mail gmail \
  accounts.google.com,mail.google.com,google.com \
  --user you@example.com --casing last_upper

# Full sign-in (opens Chrome, fills, reports JSON without password)
node src/cli.js sign-in 'https://accounts.google.com' --headed

node src/cli.js doctor
node src/cli.js list-sites
```

Assembly example: token `gmail` + `last_upper` + master `Tower35` → `gmaiLTower35`.

## Mode B

```bash
node src/cli.js store-password you@example.com example.com 'site-password'
ALIENPASS_MODE=keyring node src/cli.js sign-in 'https://example.com/login' you@example.com --headed
```

## Cursor MCP (local subagent only)

Copy [`config/cursor-mcp.example.json`](./config/cursor-mcp.example.json) and set the absolute path to `mcp/src/server.js`.

```json
{
  "mcpServers": {
    "alienpass": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/alien-pass/mcp/src/server.js"],
      "env": {
        "ALIENPASS_MODE": "compose",
        "ALIENPASS_ALLOW_REVEAL": "0",
        "ALIENPASS_AGENT_SAFE": "1"
      }
    }
  }
}
```

**Do not** attach this server to a cloud proprietary main agent.

Optional: point at Cursor/Chrome remote debugging:

```bash
export ALIENPASS_CDP_URL=http://127.0.0.1:9222
```

System prompt for the local subagent: [`config/local-subagent-system-prompt.md`](./config/local-subagent-system-prompt.md).

### Recommended cloud → local handoff

Cloud agent sends only:

```text
Sign in at <url> as <email>. Use alienpass sign_in_session.
Return only the report JSON. Never print passwords.
```

Local subagent calls MCP `sign_in_session` and returns the safe report.

## MCP tools

| Tool | Role |
| --- | --- |
| `doctor` | Environment check |
| `store_master_secret` / `upsert_site_profile` / `delete_site_profile` | Compose vault setup |
| `store_password` / `store_mnemonic` | Mode B / legacy |
| `sign_in_session` | **Primary:** resolve + browser sign-in + safe report |
| `fill_login` / `fill_stored_password` | Fill via CDP or launch |
| `auth_status` / `list_accounts` | Non-secret status |
| `generate_password` | Reveal (off by default) |
| `build_signin_report` | Format cloud-safe report |

## Security defaults

- `ALIENPASS_ALLOW_REVEAL=0` — passwords never returned to the model
- `ALIENPASS_ALLOW_REVEAL_MNEMONIC` stays off — assembled InputString is never returned with normal reveal
- `ALIENPASS_AGENT_SAFE=1` in Cursor agent config — blocks vault mutation + reveal tools (use CLI for setup)
- Site tokens live in AES-256-GCM `sites.vault`; vault key + master in keyring (or encrypted file fallback)
- File fallback encrypts secrets at rest but is **weaker than libsecret** — prefer a desktop keyring; do not treat fallback as production-grade
- Reports scrub suspicious content; no password fingerprints
- CDP fill targets a host-matching tab (refuses ambiguous/mismatched pages)
- Sign-in `ok: true` only with explicit success selector/URL verification

## Cursor note

`sign_in_session` without `ALIENPASS_CDP_URL` launches a temporary Chrome and closes it — that does **not** authenticate Cursor’s embedded browser. For the IDE session, attach CDP to the browser you want to keep.

## Tests

```bash
npm run test:engine    # crypto + compose vault
npm run test:signin    # real Chrome against fixtures/login.html
npm test
```

## Layout

```text
mcp/
  src/           engine, compose, vault, keyring, browser, MCP, CLI
  fixtures/      local login pages for e2e
  config/        Cursor MCP + subagent prompt examples
  scripts/       install.sh
```
